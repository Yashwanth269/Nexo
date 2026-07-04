const db = require('../config/db');

class RatingService {
    async rateUser(jobId, workerId, userId, rating, tags, feedback) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Check if rating already exists for this job
            const check = await client.query(
                "SELECT id FROM ratings WHERE job_id = $1 AND from_id = $2 AND to_id = $3",
                [jobId, workerId, userId]
            );

            if (check.rowCount > 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "Rating already submitted for this job" };
            }

            // 2. Insert Rating
            await client.query(
                `INSERT INTO ratings (job_id, from_id, to_id, rating_type, rating, tags, feedback) 
                 VALUES ($1, $2, $3, 'WORKER_TO_USER', $4, $5, $6)`,
                [jobId, workerId, userId, rating, JSON.stringify(tags), feedback]
            );

            // 3. Update User Score (Weighted Average)
            // Using a simplified Bayesian-lite approach: (Total Rating + 3*5) / (Total Count + 3)
            // Assuming 3 ratings of 5 as a prior for stability
            await client.query(
                `UPDATE users 
                 SET rating = (SELECT (SUM(rating) + 15)::decimal / (COUNT(*) + 3) 
                              FROM ratings WHERE to_id = $1 AND rating_type = 'WORKER_TO_USER')
                 WHERE id = $1`,
                [userId]
            );

            // 4. Log for ML reliability model
            if (rating <= 2) {
                console.log(`⚠️ [RISK ALERT] Low rating (${rating}) for User ${userId}. Flagging for review.`);
                // In production, insert into a user_risk_logs table
            }

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async rateWorker(jobId, userId, workerId, rating, tags, feedback) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Check if rating already exists for this job
            const check = await client.query(
                "SELECT id FROM ratings WHERE job_id = $1 AND from_id = $2 AND to_id = $3",
                [jobId, userId, workerId]
            );

            if (check.rowCount > 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "Rating already submitted for this job" };
            }

            // 2. Insert Rating
            await client.query(
                `INSERT INTO ratings (job_id, from_id, to_id, rating_type, rating, tags, feedback) 
                 VALUES ($1, $2, $3, 'USER_TO_WORKER', $4, $5, $6)`,
                [jobId, userId, workerId, rating, JSON.stringify(tags), feedback]
            );

            // Update Worker Score
            await client.query(
                `UPDATE workers 
                 SET rating = (SELECT (SUM(rating) + 15)::decimal / (COUNT(*) + 3) 
                              FROM ratings WHERE to_id = $1 AND rating_type = 'USER_TO_WORKER')
                 WHERE id = $1`,
                [workerId]
            );

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new RatingService();
