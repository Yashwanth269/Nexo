const db = require('../config/db');

class RatingService {
    async rateUser(jobId, workerId, userId, rating, tags, feedback) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify Job Completion, assigned worker, and customer match (Point 1)
            const jobRes = await client.query(
                "SELECT status, user_id, worker_id, completed_at FROM jobs WHERE id = $1",
                [jobId]
            );
            if (jobRes.rowCount === 0) {
                throw new Error("Job not found");
            }
            const job = jobRes.rows[0];

            if (job.status !== 'COMPLETED') {
                throw new Error("Cannot rate user for an uncompleted job");
            }
            if (job.worker_id !== workerId || job.user_id !== userId) {
                throw new Error("Unauthorized rating request: worker or customer mismatch");
            }

            // 2. Enforce 30-day review window (Point 2)
            const completedTime = new Date(job.completed_at).getTime();
            const elapsedDays = (Date.now() - completedTime) / (1000 * 3600 * 24);
            if (elapsedDays > 30) {
                throw new Error("Rating window expired. Reviews must be submitted within 30 days of completion");
            }

            // 3. Check if rating already exists for this job
            const check = await client.query(
                "SELECT id FROM ratings WHERE job_id = $1 AND from_id = $2 AND to_id = $3",
                [jobId, workerId, userId]
            );

            if (check.rowCount > 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "Rating already submitted for this job" };
            }

            // 4. Insert Rating
            await client.query(
                `INSERT INTO ratings (job_id, from_id, to_id, rating_type, rating, tags, feedback) 
                 VALUES ($1, $2, $3, 'WORKER_TO_USER', $4, $5, $6)`,
                [jobId, workerId, userId, rating, JSON.stringify(tags), feedback]
            );

            // 5. Update User Score (Weighted Average)
            await client.query(
                `UPDATE users 
                 SET rating = (SELECT (SUM(rating) + 15)::decimal / (COUNT(*) + 3) 
                              FROM ratings WHERE to_id = $1 AND rating_type = 'WORKER_TO_USER')
                 WHERE id = $1`,
                [userId]
            );

            // Log for ML reliability model
            if (rating <= 2) {
                console.log(`⚠️ [RISK ALERT] Low rating (${rating}) for User ${userId}. Flagging for review.`);
            }

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            return { success: false, message: error.message };
        } finally {
            client.release();
        }
    }

    async rateWorker(jobId, userId, workerId, rating, tags, feedback) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify Job Completion, assigned worker, and customer match (Point 1)
            const jobRes = await client.query(
                "SELECT status, user_id, worker_id, completed_at FROM jobs WHERE id = $1",
                [jobId]
            );
            if (jobRes.rowCount === 0) {
                throw new Error("Job not found");
            }
            const job = jobRes.rows[0];

            if (job.status !== 'COMPLETED') {
                throw new Error("Cannot rate worker for an uncompleted job");
            }
            if (job.worker_id !== workerId || job.user_id !== userId) {
                throw new Error("Unauthorized rating request: worker or customer mismatch");
            }

            // 2. Enforce 30-day review window (Point 2)
            const completedTime = new Date(job.completed_at).getTime();
            const elapsedDays = (Date.now() - completedTime) / (1000 * 3600 * 24);
            if (elapsedDays > 30) {
                throw new Error("Rating window expired. Reviews must be submitted within 30 days of completion");
            }

            // 3. Check if rating already exists for this job
            const check = await client.query(
                "SELECT id FROM ratings WHERE job_id = $1 AND from_id = $2 AND to_id = $3",
                [jobId, userId, workerId]
            );

            if (check.rowCount > 0) {
                await client.query('ROLLBACK');
                return { success: false, message: "Rating already submitted for this job" };
            }

            // 4. Insert Rating
            await client.query(
                `INSERT INTO ratings (job_id, from_id, to_id, rating_type, rating, tags, feedback) 
                 VALUES ($1, $2, $3, 'USER_TO_WORKER', $4, $5, $6)`,
                [jobId, userId, workerId, rating, JSON.stringify(tags), feedback]
            );

            // 5. Update Worker Score
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
            return { success: false, message: error.message };
        } finally {
            client.release();
        }
    }
}

module.exports = new RatingService();
