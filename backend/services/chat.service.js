const db = require('../config/db');
const redis = require('../config/redis');

class ChatService {
    async saveMessage(jobId, senderId, message, type = 'text', metadata = {}, senderType = 'USER') {
        const result = await db.query(
            `INSERT INTO messages (job_id, sender_id, sender_type, message, type, metadata, status, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, 'SENT', NOW()) 
             RETURNING *`,
            [jobId, senderId, senderType, message, type, JSON.stringify(metadata)]
        );
        
        return result.rows[0];
    }

    async sendOffer(jobId, workerId, amount) {
        // Create a structured offer message
        const metadata = {
            amount,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 30000).toISOString() // 30s TTL
        };

        const messageText = `Price Offer: ₹${amount}`;
        const msg = await this.saveMessage(jobId, workerId, messageText, 'offer', metadata, 'WORKER');

        // Store offer in Redis for fast validation and TTL
        await redis.setex(`offer:job:${jobId}`, 30, JSON.stringify(metadata));

        return msg;
    }

    async acceptOffer(jobId, userId, amount) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Atomic Price Update
            const result = await client.query(
                `UPDATE jobs 
                 SET price = $1, updated_at = NOW() 
                 WHERE id = $2 AND user_id = $3 AND status IN ('ACCEPTED', 'STARTED')
                 RETURNING *`,
                [amount, jobId, userId]
            );

            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "Job not found or invalid state" };
            }

            // 2. Invalidate Offer in Redis
            await redis.del(`offer:job:${jobId}`);

            // 3. Log Negotiation Event for ML
            await client.query(
                'INSERT INTO job_history (job_id, status) VALUES ($1, $2)',
                [jobId, 'PRICE_NEGOTIATED']
            );

            // 4. Update offer status inside messages table
            await client.query(
                `UPDATE messages 
                 SET metadata = jsonb_set(metadata, '{status}', '"ACCEPTED"')
                 WHERE job_id = $1 AND type = 'offer'`,
                [jobId]
            );

            await client.query('COMMIT');
            return { success: true, job: result.rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getChatHistory(jobId, readerType = null) {
        if (readerType) {
            const senderToMarkRead = readerType === 'WORKER' ? 'USER' : 'WORKER';
            try {
                await db.query(
                    `UPDATE messages 
                     SET status = 'READ' 
                     WHERE job_id = $1 AND sender_type = $2 AND status != 'READ'`,
                    [jobId, senderToMarkRead]
                );
            } catch (e) {
                console.error("Error marking messages as read:", e.message);
            }
        }

        const result = await db.query(
            `SELECT 
                m.id,
                m.job_id,
                m.sender_id,
                m.sender_type,
                m.message,
                m.type,
                m.metadata,
                m.status,
                m.created_at,
                CASE 
                    WHEN m.sender_type = 'USER' THEN u.full_name
                    WHEN m.sender_type = 'WORKER' THEN w.full_name
                    ELSE 'System'
                END as sender_name,
                CASE 
                    WHEN m.sender_type = 'USER' THEN COALESCE(u.photo_url, u.avatar_url)
                    WHEN m.sender_type = 'WORKER' THEN w.photo_url
                    ELSE null
                END as sender_photo
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id AND m.sender_type = 'USER'
             LEFT JOIN workers w ON m.sender_id = w.id AND m.sender_type = 'WORKER'
             WHERE m.job_id = $1
             ORDER BY m.created_at ASC`,
            [jobId]
        );
        return result.rows;
    }

    async getQuickReplies(jobId) {
        const jobResult = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
        if (jobResult.rowCount === 0) return [];
        
        const status = jobResult.rows[0].status;
        
        const suggestions = {
            'ACCEPTED': ["I'm on my way!", "I'll reach in 10 mins", "Confirming details"],
            'REASSIGNING': ["Checking availability", "Re-routing now"],
            'STARTED': ["Work started!", "Taking a quick break", "Almost done"],
            'COMPLETED': ["Thank you!", "Please rate my service", "Payment received"],
            'OPEN': ["I can help with this!", "Checking location"]
        };

        return suggestions[status] || ["Hello!", "I'm checking details"];
    }

    async getWorkerChats(workerIdOrPhone, req) {
        let workerId = workerIdOrPhone;
        if (!workerIdOrPhone.includes('-')) {
            const wRes = await db.query("SELECT id FROM workers WHERE phone_number = $1", [workerIdOrPhone]);
            if (wRes.rowCount > 0) {
                workerId = wRes.rows[0].id;
            } else {
                return [];
            }
        }

        const result = await db.query(
            `WITH last_messages AS (
               SELECT 
                 job_id,
                 message,
                 created_at,
                 sender_type,
                 status,
                 ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY created_at DESC) as rn
               FROM messages
             ),
             unread_counts AS (
               SELECT 
                 job_id,
                 COUNT(*) as unread_count
               FROM messages
               WHERE sender_type = 'USER' AND status != 'READ'
               GROUP BY job_id
             )
             SELECT 
               j.id as job_id,
               j.status as job_status,
               j.category as service_type,
               u.full_name as user_name,
               COALESCE(u.photo_url, u.avatar_url) as user_photo,
               lm.message as last_message,
               lm.created_at as last_message_time,
               lm.status as last_message_status,
               COALESCE(uc.unread_count, 0) as unread_count
             FROM jobs j
             JOIN users u ON j.user_id = u.id
             LEFT JOIN last_messages lm ON j.id = lm.job_id AND lm.rn = 1
             LEFT JOIN unread_counts uc ON j.id = uc.job_id
             WHERE j.worker_id = $1
             ORDER BY COALESCE(lm.created_at, j.created_at) DESC`,
            [workerId]
        );

        return result.rows.map(row => {
            const photo = row.user_photo;
            let photoUrl = `https://i.pravatar.cc/150?u=${encodeURIComponent(row.user_name)}`;
            if (photo) {
                photoUrl = photo.startsWith('http') ? photo : `${req.protocol}://${req.get('host')}${photo}`;
            }
            return {
                job_id: row.job_id,
                userName: row.user_name,
                userPhoto: photoUrl,
                time: row.last_message_time ? new Date(row.last_message_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '',
                serviceType: row.service_type,
                lastMessage: row.last_message || 'Tap to chat',
                unreadCount: parseInt(row.unread_count) || 0,
                status: row.last_message_status === 'READ' ? 'read' : 'delivered'
            };
        });
    }

    async getUserChats(userIdOrPhone, req) {
        let userId = userIdOrPhone;
        if (!userIdOrPhone.includes('-')) {
            const uRes = await db.query("SELECT id FROM users WHERE phone_number = $1", [userIdOrPhone]);
            if (uRes.rowCount > 0) {
                userId = uRes.rows[0].id;
            } else {
                return [];
            }
        }

        const result = await db.query(
            `WITH last_messages AS (
               SELECT 
                 job_id,
                 message,
                 created_at,
                 sender_type,
                 status,
                 ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY created_at DESC) as rn
               FROM messages
             ),
             unread_counts AS (
               SELECT 
                 job_id,
                 COUNT(*) as unread_count
               FROM messages
               WHERE sender_type = 'WORKER' AND status != 'READ'
               GROUP BY job_id
             )
             SELECT 
               j.id as job_id,
               j.status as job_status,
               j.category as service_type,
               w.full_name as worker_name,
               w.photo_url as worker_photo,
               lm.message as last_message,
               lm.created_at as last_message_time,
               lm.status as last_message_status,
               COALESCE(uc.unread_count, 0) as unread_count
             FROM jobs j
             JOIN workers w ON j.worker_id = w.id
             LEFT JOIN last_messages lm ON j.id = lm.job_id AND lm.rn = 1
             LEFT JOIN unread_counts uc ON j.id = uc.job_id
             WHERE j.user_id = $1
             ORDER BY COALESCE(lm.created_at, j.created_at) DESC`,
            [userId]
        );

        return result.rows.map(row => {
            const photo = row.worker_photo;
            let photoUrl = `https://i.pravatar.cc/150?u=${encodeURIComponent(row.worker_name)}`;
            if (photo) {
                photoUrl = photo.startsWith('http') ? photo : `${req.protocol}://${req.get('host')}${photo}`;
            }
            return {
                job_id: row.job_id,
                name: row.worker_name,
                image: photoUrl,
                time: row.last_message_time ? new Date(row.last_message_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '',
                service: row.service_type,
                lastMsg: row.last_message || 'Tap to chat',
                unreadCount: parseInt(row.unread_count) || 0,
                status: row.last_message_status === 'READ' ? 'read' : 'delivered'
            };
        });
    }

    async getOrCreateDirectChatJob(userId, workerId) {
        // 1. Check if there is already an active job between this user and worker
        const activeJobRes = await db.query(
            `SELECT id FROM jobs 
             WHERE user_id = $1 AND worker_id = $2 
             AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
             ORDER BY created_at DESC LIMIT 1`,
            [userId, workerId]
        );

        if (activeJobRes.rowCount > 0) {
            return activeJobRes.rows[0].id;
        }

        // 2. Fetch worker info to customize the job
        const workerRes = await db.query(
            `SELECT skills, expected_price, current_lat, current_lng FROM workers WHERE id = $1`,
            [workerId]
        );
        
        let category = 'General Service';
        let price = 500;
        let lat = 12.9716;
        let lng = 77.5946;

        if (workerRes.rowCount > 0) {
            const w = workerRes.rows[0];
            if (w.skills && w.skills.length > 0) {
                category = w.skills[0];
            }
            if (w.expected_price) {
                price = w.expected_price;
            }
            if (w.current_lat && w.current_lng) {
                lat = w.current_lat;
                lng = w.current_lng;
            }
        }

        // 3. Create a new job with status 'ACCEPTED'
        const insertRes = await db.query(
            `INSERT INTO jobs (
                user_id, worker_id, category, title, description, 
                location_lat, location_lng, status, price, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACCEPTED', $8, NOW(), NOW())
             RETURNING id`,
            [userId, workerId, category, `${category} service`, `Direct chat with specialist`, lat, lng, price]
        );

        return insertRes.rows[0].id;
    }
}

module.exports = new ChatService();
