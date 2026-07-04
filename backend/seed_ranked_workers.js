const db = require('./config/db');
const redis = require('./config/redis');
const workerService = require('./services/worker.service');

const seed = async () => {
    try {
        console.log("⏳ Initializing database and cache connections (allowing Redis fallback to settle)...");
        await new Promise(r => setTimeout(r, 2000));

        console.log("🌱 Seeding Premium Workers in PostgreSQL Database...");
        
        // Define workers
        const workers = [
            {
                id: 'fd74bfa8-692a-4467-9750-f80e550e6871',
                phone_number: '9900000001',
                full_name: 'Vikram Malhotra',
                skills: ['Electrician', 'AC Technician', 'Wiring', 'Home Services'],
                rating: 4.90,
                jobs_completed: 62,
                current_lat: 12.993672,
                current_lng: 78.186186,
                is_online: true,
                is_available: true,
                photo_url: 'https://images.unsplash.com/photo-1540569014015-19a7be504e3a?w=150&auto=format&fit=crop&q=80',
                experience: '6 Years'
            },
            {
                id: 'fd74bfa8-692a-4467-9750-f80e550e6872',
                phone_number: '9900000002',
                full_name: 'Priya Sharma',
                skills: ['Cleaning', 'Housekeeping', 'Deep Cleaning', 'Home Services'],
                rating: 4.85,
                jobs_completed: 45,
                current_lat: 12.981672,
                current_lng: 78.178186,
                is_online: true,
                is_available: true,
                photo_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
                experience: '4 Years'
            },
            {
                id: 'fd74bfa8-692a-4467-9750-f80e550e6873',
                phone_number: '9900000003',
                full_name: 'Arjun Patel',
                skills: ['Plumber', 'Leak Repair', 'Appliance Repair', 'Skilled'],
                rating: 4.92,
                jobs_completed: 88,
                current_lat: 13.000672,
                current_lng: 78.175186,
                is_online: true,
                is_available: true,
                photo_url: 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150&auto=format&fit=crop&q=80',
                experience: '8 Years'
            },
            {
                id: 'fd74bfa8-692a-4467-9750-f80e550e6874',
                phone_number: '9900000004',
                full_name: 'Neha Reddy',
                skills: ['Smart Tech Support', 'Wi-Fi Setup', 'IT Support', 'Skilled'],
                rating: 4.89,
                jobs_completed: 3,
                current_lat: 12.973672,
                current_lng: 78.194186,
                is_online: true,
                is_available: true,
                photo_url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
                experience: '1 Year'
            }
        ];

        for (const w of workers) {
            // Check if phone or ID already exists to avoid conflict
            await db.query(`
                INSERT INTO workers (id, phone_number, full_name, skills, rating, jobs_completed, current_lat, current_lng, is_online, is_available, photo_url, experience, verification_status, is_profile_complete)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'VERIFIED', true)
                ON CONFLICT (phone_number) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    skills = EXCLUDED.skills,
                    rating = EXCLUDED.rating,
                    jobs_completed = EXCLUDED.jobs_completed,
                    current_lat = EXCLUDED.current_lat,
                    current_lng = EXCLUDED.current_lng,
                    is_online = EXCLUDED.is_online,
                    is_available = EXCLUDED.is_available,
                    photo_url = EXCLUDED.photo_url,
                    experience = EXCLUDED.experience,
                    verification_status = 'VERIFIED',
                    is_profile_complete = true
            `, [
                w.id, w.phone_number, w.full_name, w.skills, w.rating, w.jobs_completed, w.current_lat, w.current_lng, w.is_online, w.is_available, w.photo_url, w.experience
            ]);

            // Retrieve the database UUID
            const idRes = await db.query("SELECT id FROM workers WHERE phone_number = $1", [w.phone_number]);
            const dbId = idRes.rows[0].id;
            
            // Hydrate Redis with heartbeat & active geoindex
            await redis.set(`worker:${dbId}:last_seen`, Date.now(), 'EX', 3600);
            await redis.geoadd('workers:active', w.current_lng, w.current_lat, dbId);

            // Recompute features to PostgreSQL feature store & Redis cache
            await workerService.recomputeAndStoreFeatures(dbId);
        }

        console.log("✅ Seeding completed! Database is packed with 4 premium verified workers.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Seeding failed:", e.message);
        process.exit(1);
    }
};

seed();
