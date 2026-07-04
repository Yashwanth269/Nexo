const db = require('../config/db');
const redis = require('../config/redis');
const http = require('http');
const https = require('https');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const CACHE_TTL = 3600;

class SkillConfidenceService {
    async getConfidenceScores(workerId) {
        const cacheKey = `skill_confidence:${workerId}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }

        const res = await db.query(`
            SELECT category, confidence_score, jobs_completed, avg_rating, dispute_count, repeat_customer_count, calculated_at
            FROM worker_skill_confidence
            WHERE worker_id = $1
        `, [workerId]);

        if (res.rowCount === 0) {
            return this._generateDefaultScores(workerId);
        }

        const scores = {};
        for (const row of res.rows) {
            scores[row.category] = {
                confidence_score: parseFloat(row.confidence_score),
                jobs_completed: parseInt(row.jobs_completed),
                avg_rating: parseFloat(row.avg_rating || 0),
                dispute_count: parseInt(row.dispute_count || 0),
                repeat_customer_count: parseInt(row.repeat_customer_count || 0),
                calculated_at: row.calculated_at,
            };
        }

        await redis.set(cacheKey, JSON.stringify(scores), 'EX', CACHE_TTL);
        return scores;
    }

    async getCategoryConfidence(workerId, category) {
        const scores = await this.getConfidenceScores(workerId);
        return scores[category] || { confidence_score: 0, jobs_completed: 0 };
    }

    async recalculateWorkerConfidence(workerId) {
        try {
            const response = await this._callMLService('/predict/skill-confidence/batch', {
                features_list: [{ worker_id: workerId }]
            });

            if (response && response.confidence_scores) {
                const categories = [
                    'PLUMBING', 'ELECTRICIAN', 'CLEANING', 'PAINTING',
                    'CARPENTRY', 'MOVING', 'GARDENING', 'APPLIANCE_REPAIR',
                    'IT_SUPPORT', 'TUTORING', 'PHOTOGRAPHY', 'EVENT', 'DELIVERY', 'OTHER'
                ];

                for (let i = 0; i < categories.length; i++) {
                    const category = categories[i];
                    const confidence = response.confidence_scores[i] || 0;
                    await this._storeConfidence(workerId, category, confidence);
                }

                await redis.del(`skill_confidence:${workerId}`);
                return { success: true, workerId, categories: categories.length };
            }
        } catch (e) {
            console.error('[SKILL_CONFIDENCE] ML service error, using heuristic:', e.message);
            return this._heuristicRecalculation(workerId);
        }
    }

    async _heuristicRecalculation(workerId) {
        const categories = [
            'PLUMBING', 'ELECTRICIAN', 'CLEANING', 'PAINTING',
            'CARPENTRY', 'MOVING', 'GARDENING', 'APPLIANCE_REPAIR',
            'IT_SUPPORT', 'TUTORING', 'PHOTOGRAPHY', 'EVENT', 'DELIVERY', 'OTHER'
        ];

        for (const category of categories) {
            const res = await db.query(`
                SELECT
                    COUNT(*) FILTER (WHERE j.status = 'COMPLETED') as jobs_completed,
                    COALESCE(AVG(r.rating) FILTER (WHERE r.rating_type = 'USER_TO_WORKER'), 0) as avg_rating,
                    COUNT(*) FILTER (WHERE d.id IS NOT NULL) as dispute_count,
                    COUNT(DISTINCT j.user_id) as repeat_customer_count
                FROM workers w
                LEFT JOIN jobs j ON j.worker_id = w.id AND j.category = $1
                LEFT JOIN ratings r ON r.to_id = w.id AND r.rating_type = 'USER_TO_WORKER'
                LEFT JOIN disputes d ON d.job_id = j.id
                WHERE w.id = $2
                GROUP BY w.id
            `, [category, workerId]);

            if (res.rowCount > 0) {
                const row = res.rows[0];
                const jobs = parseInt(row.jobs_completed || 0);
                const rating = parseFloat(row.avg_rating || 0);
                const disputes = parseInt(row.dispute_count || 0);
                const repeat = parseInt(row.repeat_customer_count || 0);

                let confidence = 0;
                if (jobs > 0) {
                    confidence += Math.min(40, jobs * 2);
                    confidence += (rating / 5 - 0.6) * 30;
                    confidence += Math.min(20, repeat * 3);
                    confidence -= disputes * 5;
                }
                confidence = Math.max(0, Math.min(100, confidence));

                await this._storeConfidence(workerId, category, confidence);
            }
        }

        await redis.del(`skill_confidence:${workerId}`);
        return { success: true, workerId, method: 'heuristic' };
    }

    async _storeConfidence(workerId, category, confidence) {
        const res = await db.query(`
            SELECT COUNT(*) FILTER (WHERE j.status = 'COMPLETED') as jobs_completed,
                   COALESCE(AVG(r.rating) FILTER (WHERE r.rating_type = 'USER_TO_WORKER'), 0) as avg_rating,
                   COUNT(*) FILTER (WHERE d.id IS NOT NULL) as dispute_count,
                   COUNT(DISTINCT j.user_id) as repeat_customer_count
            FROM workers w
            LEFT JOIN jobs j ON j.worker_id = w.id AND j.category = $1
            LEFT JOIN ratings r ON r.to_id = w.id AND r.rating_type = 'USER_TO_WORKER'
            LEFT JOIN disputes d ON d.job_id = j.id
            WHERE w.id = $2
            GROUP BY w.id
        `, [category, workerId]);

        const stats = res.rows[0] || {};
        await db.query(`
            INSERT INTO worker_skill_confidence (worker_id, category, confidence_score, jobs_completed, avg_rating, dispute_count, repeat_customer_count, calculated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (worker_id, category) DO UPDATE SET
                confidence_score = EXCLUDED.confidence_score,
                jobs_completed = EXCLUDED.jobs_completed,
                avg_rating = EXCLUDED.avg_rating,
                dispute_count = EXCLUDED.dispute_count,
                repeat_customer_count = EXCLUDED.repeat_customer_count,
                calculated_at = NOW()
        `, [
            workerId,
            category,
            confidence,
            parseInt(stats.jobs_completed || 0),
            parseFloat(stats.avg_rating || 0),
            parseInt(stats.dispute_count || 0),
            parseInt(stats.repeat_customer_count || 0),
        ]);
    }

    _generateDefaultScores(workerId) {
        const categories = [
            'PLUMBING', 'ELECTRICIAN', 'CLEANING', 'PAINTING',
            'CARPENTRY', 'MOVING', 'GARDENING', 'APPLIANCE_REPAIR',
            'IT_SUPPORT', 'TUTORING', 'PHOTOGRAPHY', 'EVENT', 'DELIVERY', 'OTHER'
        ];
        const scores = {};
        for (const cat of categories) {
            scores[cat] = { confidence_score: 0, jobs_completed: 0 };
        }
        return scores;
    }

    async _callMLService(endpoint, body) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(ML_SERVICE_URL + endpoint);
            const transport = urlObj.protocol === 'https:' ? https : http;
            const data = JSON.stringify(body);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
                timeout: 2000,
            };
            const req = transport.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => responseData += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(responseData));
                    } catch {
                        resolve(null);
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(data);
            req.end();
        });
    }

    async getTopWorkersBySkill(category, limit = 10) {
        const res = await db.query(`
            SELECT w.id, w.full_name, w.photo_url, w.rating, w.jobs_completed,
                   wsc.confidence_score, wsc.jobs_completed as category_jobs
            FROM workers w
            JOIN worker_skill_confidence wsc ON wsc.worker_id = w.id
            WHERE wsc.category = $1
              AND w.is_online = true
              AND w.is_available = true
            ORDER BY wsc.confidence_score DESC, w.rating DESC
            LIMIT $2
        `, [category, limit]);
        return res.rows;
    }

    async getWorkerSkillSummary(workerId) {
        const scores = await this.getConfidenceScores(workerId);
        const sorted = Object.entries(scores)
            .filter(([_, v]) => v.confidence_score > 0)
            .sort((a, b) => b[1].confidence_score - a[1].confidence_score)
            .map(([category, data]) => ({ category, ...data }));

        const primarySkill = sorted[0] || null;
        const avgConfidence = sorted.length > 0
            ? sorted.reduce((sum, s) => sum + s.confidence_score, 0) / sorted.length
            : 0;

        return {
            workerId,
            primarySkill,
            skillCount: sorted.length,
            avgConfidence: Math.round(avgConfidence * 100) / 100,
            skills: sorted,
        };
    }

    async batchRecalculateAll() {
        const res = await db.query("SELECT id FROM workers WHERE is_online = true AND jobs_completed > 0");
        let updated = 0;
        for (const row of res.rows) {
            await this.recalculateWorkerConfidence(row.id);
            updated++;
        }
        console.log(`[SKILL_CONFIDENCE] Batch recalculated ${updated} workers`);
        return { success: true, updated };
    }
}

module.exports = new SkillConfidenceService();