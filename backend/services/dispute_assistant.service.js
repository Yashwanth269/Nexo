const db = require('../config/db');
const disputeConfig = require('../config/dispute.config');

class DisputeAssistantService {
    /**
     * Gathers all dispute evidence concurrently, projecting specific fields and enforcing size limits
     */
    async gatherEvidence(disputeId, requester = {}) {
        // 1. Authorization checks (Only admin or initiator/respondent can query evidence)
        const disputeRes = await db.query(
            "SELECT id, job_id, payment_id, initiator_id, respondent_id, reason, description, status FROM disputes WHERE id = $1", 
            [disputeId]
        );
        if (disputeRes.rowCount === 0) return null;
        const dispute = disputeRes.rows[0];

        const isUserAuthorized = requester.role === 'ADMIN' || 
                                 requester.id === dispute.initiator_id || 
                                 requester.id === dispute.respondent_id;
        if (requester.role && !isUserAuthorized) {
            throw new Error("[DISPUTE-AUTH-ERROR] Unauthorized access to dispute evidence.");
        }

        const evidence = {};

        // 2. Parallelized db queries with projection and constraints mapping (avoid memory crashes)
        const [
            jobRes,
            gpsRes,
            paymentRes,
            chatRes,
            imagesRes,
            routeRes
        ] = await Promise.all([
            db.query("SELECT id, category, price, status, location_lat, location_lng FROM jobs WHERE id = $1", [dispute.job_id]),
            db.query(`
                SELECT lat, lng, speed_kmh, recorded_at FROM gps_traces
                WHERE job_id = $1 ORDER BY recorded_at ASC LIMIT $2
            `, [dispute.job_id, disputeConfig.limits.maxGpsPoints]),
            db.query("SELECT id, amount, payment_status FROM payments WHERE id = $1", [dispute.payment_id]),
            db.query(`
                SELECT sender_role, message, created_at FROM chat_messages
                WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2
            `, [dispute.job_id, disputeConfig.limits.maxChatMessages]),
            db.query(`
                SELECT image_url, image_type, created_at FROM image_verification_scores
                WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2
            `, [dispute.job_id, disputeConfig.limits.maxImages]),
            db.query(`
                SELECT deviation_distance_meters, deviation_score, created_at FROM route_deviations
                WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2
            `, [dispute.job_id, disputeConfig.limits.maxRouteDeviations])
        ]);

        evidence.job = jobRes.rows[0] || null;
        evidence.gps_history = gpsRes.rows;
        evidence.payment = paymentRes.rows[0] || null;
        evidence.chat_history = chatRes.rows;
        evidence.images = imagesRes.rows;
        evidence.route_deviations = routeRes.rows;

        // 3. Merged Chronological Timeline Builder
        const timeline = [];

        evidence.chat_history.forEach(c => {
            timeline.push({
                timestamp: c.created_at,
                type: 'CHAT_MESSAGE',
                description: `[${c.sender_role}] ${c.message}`
            });
        });

        evidence.images.forEach(img => {
            timeline.push({
                timestamp: img.created_at,
                type: 'IMAGE_UPLOAD',
                description: `Verification image uploaded: ${img.image_type}`
            });
        });

        evidence.route_deviations.forEach(dev => {
            timeline.push({
                timestamp: dev.created_at,
                type: 'ROUTE_DEVIATION',
                description: `Worker deviated by ${dev.deviation_distance_meters} meters (Score: ${dev.deviation_score})`
            });
        });

        timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        evidence.timeline = timeline;

        // 4. Dynamic AI Summary & Fraud/Confidence Scoring
        const summary = await this._generateSummary(dispute, evidence);

        // Commit gathered datasets
        for (const [type, data] of Object.entries(evidence)) {
            await db.query(`
                INSERT INTO dispute_evidence (dispute_id, evidence_type, data, summary)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (dispute_id, evidence_type) DO UPDATE SET data = EXCLUDED.data, summary = EXCLUDED.summary
            `, [disputeId, type, JSON.stringify(data), null]);
        }

        return { evidence, summary };
    }

    /**
     * Formulate mock AI analytics summaries, confidence ratings, and fraud risks
     */
    async _generateSummary(dispute, evidence) {
        // Calculate mock fraud risk metrics
        let fraudIndicatorScore = 0.05; // Base 5%
        let confidenceRating = 0.90; // 90% confidence on evidence

        if (evidence.route_deviations?.length > 0) {
            fraudIndicatorScore += 0.20; // Route deviation adds fraud index
        }
        if (evidence.chat_history?.some(msg => msg.message.toLowerCase().includes('cancel') || msg.message.toLowerCase().includes('refund'))) {
            fraudIndicatorScore += 0.15;
        }
        if (evidence.gps_history?.length === 0) {
            fraudIndicatorScore += 0.30; // Missing GPS is highly suspicious
            confidenceRating -= 0.20;
        }

        const parts = [];
        parts.push(`=== Dispute ${dispute.id} Analysis ===`);
        parts.push(`Initiator: ${dispute.initiator_role} (${dispute.initiator_id})`);
        parts.push(`Reason: ${dispute.reason}`);
        parts.push(`Description: ${dispute.description || 'N/A'}`);
        parts.push(`Status: ${dispute.status}`);
        
        parts.push(`\n=== AI Predictions ===`);
        parts.push(`Confidence Rating: ${(confidenceRating * 100).toFixed(0)}%`);
        parts.push(`Fraud Probability: ${(fraudIndicatorScore * 100).toFixed(0)}%`);
        parts.push(`Recommended Winner: ${fraudIndicatorScore > 0.40 ? 'RESPONDENT' : 'INITIATOR'}`);

        if (evidence.job) {
            parts.push(`\nJob details: Category: ${evidence.job.category} | Price: ₹${evidence.job.price}`);
        }
        if (evidence.timeline?.length > 0) {
            parts.push(`\nTimeline Events Count: ${evidence.timeline.length}`);
        }

        const summaryText = parts.join('\n');

        await db.query(
            "INSERT INTO dispute_evidence (dispute_id, evidence_type, data, summary) VALUES ($1, 'ai_summary', '{}'::jsonb, $2) ON CONFLICT (dispute_id, evidence_type) DO UPDATE SET summary = EXCLUDED.summary",
            [dispute.id, summaryText]
        );

        return summaryText;
    }

    async getEvidence(disputeId, requester = {}) {
        // Authorization check
        const disputeRes = await db.query("SELECT initiator_id, respondent_id FROM disputes WHERE id = $1", [disputeId]);
        if (disputeRes.rowCount > 0) {
            const disp = disputeRes.rows[0];
            const isAuthorized = requester.role === 'ADMIN' || 
                                 requester.id === disp.initiator_id || 
                                 requester.id === disp.respondent_id;
            if (requester.role && !isAuthorized) {
                throw new Error("[DISPUTE-AUTH-ERROR] Unauthorized access to dispute evidence.");
            }
        }

        const res = await db.query(
            "SELECT id, dispute_id, evidence_type, data, summary, collected_at FROM dispute_evidence WHERE dispute_id = $1 ORDER BY collected_at ASC",
            [disputeId]
        );
        return res.rows;
    }
}

module.exports = new DisputeAssistantService();
