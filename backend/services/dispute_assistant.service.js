const db = require('../config/db');

class DisputeAssistantService {
    async gatherEvidence(disputeId) {
        const disputeRes = await db.query("SELECT * FROM disputes WHERE id = $1", [disputeId]);
        if (disputeRes.rowCount === 0) return null;
        const dispute = disputeRes.rows[0];

        const evidence = {};

        const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [dispute.job_id]);
        evidence.job = jobRes.rows[0] || null;

        const gpsRes = await db.query(`
            SELECT lat, lng, speed_kmh, recorded_at FROM gps_traces
            WHERE job_id = $1 ORDER BY recorded_at ASC
        `, [dispute.job_id]);
        evidence.gps_history = gpsRes.rows;

        const paymentRes = await db.query(`
            SELECT * FROM payments WHERE id = $1
        `, [dispute.payment_id]);
        evidence.payment = paymentRes.rows[0] || null;

        const chatRes = await db.query(`
            SELECT sender_role, message, created_at FROM chat_messages
            WHERE job_id = $1 ORDER BY created_at ASC LIMIT 200
        `, [dispute.job_id]);
        evidence.chat_history = chatRes.rows;

        const imagesRes = await db.query(`
            SELECT image_url, image_type, created_at FROM image_verification_scores
            WHERE job_id = $1 ORDER BY created_at ASC
        `, [dispute.job_id]);
        evidence.images = imagesRes.rows;

        const routeRes = await db.query(`
            SELECT deviation_distance_meters, deviation_score, created_at FROM route_deviations
            WHERE job_id = $1 ORDER BY created_at ASC
        `, [dispute.job_id]);
        evidence.route_deviations = routeRes.rows;

        const summary = await this._generateSummary(dispute, evidence);

        for (const [type, data] of Object.entries(evidence)) {
            await db.query(`
                INSERT INTO dispute_evidence (dispute_id, evidence_type, data, summary)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (dispute_id, evidence_type) DO UPDATE SET data = EXCLUDED.data, summary = EXCLUDED.summary
            `, [disputeId, type, JSON.stringify(data), null]);
        }

        return { evidence, summary };
    }

    async _generateSummary(dispute, evidence) {
        const parts = [];
        parts.push(`=== Dispute ${dispute.id} Summary ===`);
        parts.push(`Initiator: ${dispute.initiator_role} (${dispute.initiator_id})`);
        parts.push(`Reason: ${dispute.reason}`);
        parts.push(`Description: ${dispute.description || 'N/A'}`);
        parts.push(`Status: ${dispute.status}`);

        if (evidence.job) {
            parts.push(`Job: ${evidence.job.category} | Price: ₹${evidence.job.price} | Status: ${evidence.job.status}`);
        }

        if (evidence.gps_history?.length > 0) {
            const points = evidence.gps_history.length;
            const start = evidence.gps_history[0];
            const end = evidence.gps_history[points - 1];
            parts.push(`GPS: ${points} data points from ${start.recorded_at} to ${end.recorded_at}`);
        }

        if (evidence.route_deviations?.length > 0) {
            const maxDev = Math.max(...evidence.route_deviations.map(d => parseFloat(d.deviation_score || 0)));
            parts.push(`Route Deviations: ${evidence.route_deviations.length} events, max score ${maxDev.toFixed(2)}`);
        }

        if (evidence.chat_history?.length > 0) {
            parts.push(`Chat: ${evidence.chat_history.length} messages`);
        }

        if (evidence.payment) {
            parts.push(`Payment: ₹${evidence.payment.amount} | Status: ${evidence.payment.status}`);
        }

        const summaryText = parts.join('\n');

        await db.query(
            "INSERT INTO dispute_evidence (dispute_id, evidence_type, data, summary) VALUES ($1, 'ai_summary', '{}'::jsonb, $2) ON CONFLICT (dispute_id, evidence_type) DO UPDATE SET summary = EXCLUDED.summary",
            [dispute.id, summaryText]
        );

        return summaryText;
    }

    async getEvidence(disputeId) {
        const res = await db.query(
            "SELECT * FROM dispute_evidence WHERE dispute_id = $1 ORDER BY collected_at ASC",
            [disputeId]
        );
        return res.rows;
    }
}

module.exports = new DisputeAssistantService();
