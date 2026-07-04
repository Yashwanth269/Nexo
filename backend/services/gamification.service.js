const db = require('../config/db');
const { getIO } = require('../config/socket');

const ACHIEVEMENTS = {
    TOP_WORKER: { title: 'Top Worker', desc: 'Consistently high ratings and completions', icon: 'trophy' },
    FASTEST_RESPONDER: { title: 'Fastest Responder', desc: 'Responds to job offers within 2 minutes on average', icon: 'lightning' },
    MOST_RELIABLE: { title: 'Most Reliable', desc: '100% completion rate over 30+ jobs', icon: 'shield' },
    CUSTOMER_FAVORITE: { title: 'Customer Favorite', desc: 'Highest repeat hire rate', icon: 'heart' },
    MONTHLY_CHAMPION: { title: 'Monthly Champion', desc: 'Most jobs completed this month', icon: 'crown' },
    IRON_WORKER: { title: 'Iron Worker', desc: 'Completed 500+ jobs', icon: 'medal' },
    FIVE_STAR: { title: 'Five Star', desc: 'Maintained 5.0 rating for 30+ jobs', icon: 'star' },
    EARLY_BIRD: { title: 'Early Bird', desc: 'Accepts jobs before 7 AM', icon: 'sunrise' },
    NIGHT_OWL: { title: 'Night Owl', desc: 'Completes jobs after 10 PM', icon: 'moon' },
    SPEED_DEMON: { title: 'Speed Demon', desc: 'Completes jobs 30% faster than average', icon: 'rocket' },
};

class GamificationService {
    async evaluateWorker(workerId) {
        const workerRes = await db.query("SELECT * FROM workers WHERE id = $1", [workerId]);
        if (workerRes.rowCount === 0) return;
        const worker = workerRes.rows[0];

        const statsRes = await db.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'COMPLETED') as total_completed,
                COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= NOW() - INTERVAL '30 days') as monthly_completed,
                COALESCE(AVG(r.rating) FILTER (WHERE r.rating_type = 'USER_TO_WORKER'), 0) as avg_rating,
                COUNT(*) FILTER (WHERE r.rating = 5) as five_star_count,
                COUNT(DISTINCT jo.user_id) FILTER (WHERE jo.status = 'ACCEPTED') as unique_customers
            FROM jobs j
            LEFT JOIN ratings r ON r.to_id = j.worker_id AND r.rating_type = 'USER_TO_WORKER'
            LEFT JOIN job_offers jo ON jo.job_id = j.id AND jo.worker_id = j.worker_id
            WHERE j.worker_id = $1
        `, [workerId]);
        const stats = statsRes.rows[0];

        const responseRes = await db.query(`
            SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (jo.updated_at - jo.created_at))), 0) as avg_response_seconds
            FROM job_offers jo WHERE jo.worker_id = $1 AND jo.status = 'ACCEPTED'
        `, [workerId]);
        const avgResponse = parseFloat(responseRes.rows[0]?.avg_response_seconds || 999);

        const evaluations = [
            {
                type: 'TOP_WORKER',
                check: stats.total_completed >= 50 && parseFloat(stats.avg_rating) >= 4.5,
            },
            {
                type: 'FASTEST_RESPONDER',
                check: avgResponse < 120 && stats.total_completed >= 20,
            },
            {
                type: 'MOST_RELIABLE',
                check: stats.total_completed >= 30,
            },
            {
                type: 'CUSTOMER_FAVORITE',
                check: parseInt(stats.unique_customers || 0) >= 20,
            },
            {
                type: 'MONTHLY_CHAMPION',
                check: parseInt(stats.monthly_completed || 0) >= 30,
            },
            {
                type: 'IRON_WORKER',
                check: stats.total_completed >= 500,
            },
            {
                type: 'FIVE_STAR',
                check: parseInt(stats.five_star_count || 0) >= 30,
            },
            {
                type: 'EARLY_BIRD',
                check: false,
            },
            {
                type: 'NIGHT_OWL',
                check: false,
            },
            {
                type: 'SPEED_DEMON',
                check: false,
            },
        ];

        for (const ev of evaluations) {
            if (!ev.check) continue;
            const config = ACHIEVEMENTS[ev.type];
            await db.query(`
                INSERT INTO worker_achievements (worker_id, achievement_type, title, description, icon, awarded_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (worker_id, achievement_type) DO NOTHING
            `, [workerId, ev.type, config.title, config.desc, config.icon]);
        }

        return { workerId, stats, avgResponse };
    }

    async getWorkerAchievements(workerId) {
        const res = await db.query(
            "SELECT * FROM worker_achievements WHERE worker_id = $1 ORDER BY awarded_at DESC",
            [workerId]
        );
        return res.rows;
    }

    async getLeaderboard(category = null, limit = 20) {
        let query = `
            SELECT w.id, w.full_name, w.photo_url,
                   COUNT(DISTINCT wa.id) as achievements_count,
                   COALESCE(r.overall_score, 50) as reputation_score
            FROM workers w
            LEFT JOIN worker_achievements wa ON wa.worker_id = w.id
            LEFT JOIN worker_reputation_scores r ON r.worker_id = w.id
        `;
        const params = [];
        if (category) {
            query += " WHERE w.skills ? $1 OR $1 = ANY(w.tasks)";
            params.push(category);
        }
        query += " GROUP BY w.id, w.full_name, w.photo_url, r.overall_score ORDER BY achievements_count DESC, reputation_score DESC LIMIT $" + (params.length + 1);
        params.push(limit);
        const res = await db.query(query, params);
        return res.rows;
    }
}

module.exports = new GamificationService();
