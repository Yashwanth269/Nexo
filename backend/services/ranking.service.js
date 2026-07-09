const db = require('../config/db');
const redis = require('../config/redis');
const http = require('http');
require('dotenv').config();
const { isSkillMatch } = require('../utils/skill_matcher');
const skillConfidenceService = require('./skill_confidence.service');
const userTrustService = require('./user_trust.service');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

let mlServiceOfflineUntil = 0;

class RankingService {
    async getTopRatedWorkers(lat, lng, userId = null, category = null) {
        const start = Date.now();
        let radius = 5;
        let candidates = [];

        const maxRadius = process.env.NODE_ENV === 'development' ? 500 : 25;
        while (radius <= maxRadius) {
            candidates = await this.fetchGeoCandidates(lat, lng, radius, category, userId);
            if (candidates.length >= 3 || radius === maxRadius) break;
            radius = radius === 5 ? 10 : (radius === 10 ? 25 : maxRadius);
        }

        let customerTrustMultiplier = 0.5;
        if (userId) {
            try {
                const trustLevel = await userTrustService.getTrustLevel(userId);
                customerTrustMultiplier = trustLevel.trustScore / 100.0;
            } catch (e) {
                console.warn(`[DISPATCH_SCORE] Trust lookup failed for user ${userId}: ${e.message}`);
            }
        }

        const scorePromises = candidates.map(async (worker) => {
            const scorePayload = await this.computeWorkerScore(worker, lat, lng, userId, category, customerTrustMultiplier);
            return {
                id: worker.id,
                fullName: worker.full_name,
                phoneNumber: worker.phone_number,
                photoUrl: worker.photo_url,
                skills: worker.skills || [],
                experience: worker.experience || '1+ Years',
                rating: parseFloat(scorePayload.bayesianRating.toFixed(2)),
                completionRate: Math.round(scorePayload.completionRate * 100),
                jobsCompleted: worker.jobs_completed || 0,
                distance: parseFloat(worker.distance.toFixed(1)),
                responseTime: parseFloat(scorePayload.avgResponseTime.toFixed(1)),
                skillConfidenceScore: scorePayload.skillConfidenceScore,
                acceptanceProbability: scorePayload.acceptanceProbability,
                customerTrustMultiplier: scorePayload.customerTrustMultiplier,
                badges: scorePayload.badges,
                explainability: scorePayload.explanations,
                finalRankScore: parseFloat(scorePayload.finalScore.toFixed(4)),
                expectedPrice: worker.expected_price ? parseFloat(worker.expected_price) : 250.0,
            };
        });

        const scoredWorkers = await Promise.all(scorePromises);
        scoredWorkers.sort((a, b) => b.finalRankScore - a.finalRankScore);
        const latency = Date.now() - start;
        console.log(`[RANKING] Scored ${scoredWorkers.length} workers in ${latency}ms at radius ${radius}km`);
        return scoredWorkers.slice(0, 10);
    }

    async fetchGeoCandidates(lat, lng, radiusKm, category = null, userId = null) {
        try {
            let query = `
                SELECT
                    w.id, w.full_name, w.phone_number, w.photo_url, w.skills, w.tasks, w.experience, w.expected_price,
                    w.rating as raw_rating, w.jobs_completed, w.is_online, w.is_available,
                    w.current_lat, w.current_lng, w.verification_status, w.updated_at,
                    f.completion_rate, f.cancellation_rate, f.avg_rating, f.total_ratings_count,
                    f.avg_response_time, f.reliability_score, f.eta_confidence_score,
                    f.worker_load_score, f.active_jobs_count,
                    f.fatigue_24h, f.fatigue_7d, f.fatigue_30d,
                    f.fraud_risk_score, f.is_shadow_banned, f.trust_decay_factor,
                    f.last_job_event_at, f.category_scores, f.last_event_at,
                    r.trust_score as rep_trust_score, r.reliability_score as rep_reliability_score,
                    r.quality_score as rep_quality_score, r.response_score as rep_response_score,
                    r.overall_score as rep_overall_score,
                    COALESCE(a.hire_count, 0) as affinity_count,
                    COALESCE(earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0, 0.1) AS distance
                FROM workers w
                LEFT JOIN worker_features f ON w.id = f.worker_id
                LEFT JOIN worker_reputation_scores r ON w.id = r.worker_id
                LEFT JOIN user_worker_affinity a ON a.worker_id = w.id AND a.user_id = $4
                WHERE w.is_online = true AND w.is_available = true
                  AND earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 <= $3
            `;

            const params = [lat, lng, radiusKm, userId];
            const res = await db.query(query, params);
            if (category) {
                return res.rows.filter(worker => isSkillMatch(worker.skills, worker.tasks, category));
            }
            return res.rows;
        } catch (err) {
            console.error('[GEO-CANDIDATES-ERROR]', err.message);
            return [];
        }
    }

    async computeWorkerScore(worker, customerLat, customerLng, userId = null, category = null, precomputedTrustMultiplier = null) {
        const completionRate = parseFloat(worker.completion_rate !== null ? worker.completion_rate : 100.0) / 100.0;
        const cancellationRate = parseFloat(worker.cancellation_rate !== null ? worker.cancellation_rate : 0.0);
        const rawRating = parseFloat(worker.avg_rating !== null ? worker.avg_rating : (worker.raw_rating || 4.0));
        const totalRatings = parseInt(worker.total_ratings_count || 0);
        const avgResponseTime = parseFloat(worker.avg_response_time !== null ? worker.avg_response_time : 2.5);
        const reliabilityScore = parseFloat(worker.reliability_score !== null ? worker.reliability_score : 1.0);
        const activeJobs = parseInt(worker.active_jobs_count || 0);
        const fatigue24h = parseFloat(worker.fatigue_24h || 0.0);
        const fatigue7d = parseFloat(worker.fatigue_7d || 0.0);
        const fatigue30d = parseFloat(worker.fatigue_30d || 0.0);
        const fraudRisk = parseFloat(worker.fraud_risk_score || 0.0);
        const isShadowBanned = worker.is_shadow_banned || false;
        const affinityCount = parseInt(worker.affinity_count || 0);
        const distanceKm = parseFloat(worker.distance || 0.1);
 
        const globalAvgRating = 4.0;
        const minReviewsThreshold = 5;
        const bayesianRating = ((totalRatings / (totalRatings + minReviewsThreshold)) * rawRating) +
                               ((minReviewsThreshold / (totalRatings + minReviewsThreshold)) * globalAvgRating);
 
        const distanceScore = 1.0 / (1.0 + distanceKm);
 
        const hourOfDay = new Date().getHours();
        const isPeakHours = (hourOfDay >= 8 && hourOfDay <= 11) || (hourOfDay >= 17 && hourOfDay <= 21);
 
        let categoryBoost = 0.0;
        if (category && worker.category_scores && worker.category_scores[category] !== undefined) {
            categoryBoost = parseFloat(worker.category_scores[category]) * 0.1;
        }
 
        const compositeFatigue = (fatigue24h * 0.6) + (fatigue7d * 0.3) + (fatigue30d * 0.1);
        const overloadPenalty = Math.min(0.4, (activeJobs * 0.15) + (compositeFatigue * 0.10));
 
        const lastEvent = worker.last_job_event_at || worker.last_event_at || worker.updated_at || new Date();
        const daysInactive = Math.max(0, (Date.now() - new Date(lastEvent).getTime()) / (1000 * 60 * 60 * 24));
        const trustDecay = Math.pow(0.97, Math.min(60, daysInactive));
 
        const lastSeen = await redis.get(`worker:${worker.id}:last_seen`);
        const onlineConfidence = lastSeen ? 1.0 : 0.5;
 
        let skillConfidenceScore = 0;
        try {
            if (category) {
                const sc = await skillConfidenceService.getCategoryConfidence(worker.id, category);
                skillConfidenceScore = (sc.confidence_score || 0) / 100.0;
            }
        } catch (e) {
            console.warn(`[DISPATCH_SCORE] Skill confidence lookup failed for ${worker.id}: ${e.message}`);
        }
 
        let acceptanceProbability = 0.5;
        try {
            const acceptanceResult = await this.calculateAcceptanceProbability(
                worker, distanceKm, worker.expected_price || 250
            );
            acceptanceProbability = acceptanceResult.probability || 0.5;
        } catch (e) {
            console.warn(`[DISPATCH_SCORE] Acceptance prob failed for ${worker.id}: ${e.message}`);
        }
 
        let customerTrustMultiplier = precomputedTrustMultiplier;
        if (customerTrustMultiplier === null) {
            customerTrustMultiplier = 0.5;
            try {
                if (userId) {
                    const trustLevel = await userTrustService.getTrustLevel(userId);
                    customerTrustMultiplier = trustLevel.trustScore / 100.0;
                }
            } catch (e) {
                console.warn(`[DISPATCH_SCORE] Trust lookup failed for user ${userId}: ${e.message}`);
            }
        }

        const availabilityScore = (worker.is_online ? 0.5 : 0) + (worker.is_available ? 0.3 : 0) + Math.max(0, 0.2 - (activeJobs * 0.05));
        const fraudPenalty = fraudRisk > 0.5 ? fraudRisk * 0.5 : 0;

        const unifiedScore =
            (completionRate * 0.20) +
            (reliabilityScore * 0.20) +
            (skillConfidenceScore * 0.20) +
            (acceptanceProbability * 0.15) +
            (distanceScore * 0.10) +
            (customerTrustMultiplier * 0.10) +
            (Math.min(1.0, availabilityScore) * 0.05);

        const fatiguePenalty = compositeFatigue * 0.15;
        const fraudRiskPenalty = fraudPenalty * 0.10;
        const noShowPenalty = Math.max(0, (1 - (worker.completion_rate || 100) / 100)) * 0.05;
        const overloadPenaltyV2 = Math.min(0.15, (activeJobs * 0.05) + (compositeFatigue * 0.05));

        let score = unifiedScore - fatiguePenalty - fraudRiskPenalty - noShowPenalty - overloadPenaltyV2;

        score *= trustDecay;

        if (affinityCount > 0) {
            score += Math.min(0.10, affinityCount * 0.03);
        }

        if (isShadowBanned) {
            score = Math.max(0, score - 0.9);
        }

        if (fraudRisk > 0.7) {
            score = Math.max(0, score - 0.8);
        }

        if (isNaN(score) || !isFinite(score)) {
            score = 0.0;
        }

        const explanations = [];
        const badges = [];

        if (completionRate >= 0.95) {
            badges.push("Highly Reliable");
            explanations.push("high_completion_rate");
        }
        if (bayesianRating >= 4.7) {
            badges.push("Top Rated");
            explanations.push("stellar_ratings");
        }
        if (distanceKm <= 3.0) {
            badges.push("Trusted Nearby");
            explanations.push("very_close_by");
        }
        if (avgResponseTime <= 3.0) {
            badges.push("Fast Response");
            explanations.push("quick_acceptances");
        }
        if (affinityCount >= 2) {
            badges.push("Customer Favorite");
            explanations.push("frequently_hired_by_you");
        }
        if (worker.jobs_completed >= 30 && bayesianRating >= 4.8) {
            badges.push("Gold Worker");
            explanations.push("experienced_pro");
        }

        if (skillConfidenceScore >= 0.7) {
            badges.push("Highly Skilled");
            explanations.push("high_skill_confidence");
        }

        if (acceptanceProbability >= 0.8) {
            badges.push("Quick Acceptor");
            explanations.push("high_acceptance_probability");
        }

        if (customerTrustMultiplier >= 0.9) {
            badges.push("Trusted Customer");
            explanations.push("high_customer_trust");
        }

        if (badges.length === 0) {
            badges.push("Verified Expert");
            explanations.push("verified_status");
        }

        return {
            finalScore: Math.min(1.0, score),
            bayesianRating,
            completionRate,
            avgResponseTime,
            skillConfidenceScore: Math.round(skillConfidenceScore * 100) / 100,
            acceptanceProbability: Math.round(acceptanceProbability * 100) / 100,
            customerTrustMultiplier: Math.round(customerTrustMultiplier * 100) / 100,
            badges,
            explanations
        };
    }

    async calculateDLRankingScore(worker, distanceKm, jobPrice, jobId = null) {
        let workerFeatures = worker;
        if (worker.completion_rate === undefined) {
            const featureStore = require('./feature_store.service');
            workerFeatures = await featureStore.getWorkerFeatures(worker.id);
        }
        const jobFeatures = jobId ? await featureStore.getJobFeatures(jobId) : { isUrgent: false, demand_pressure: 0.0 };

        let rep = {};
        if (worker.rep_overall_score !== undefined) {
            rep = {
                overall_score: worker.rep_overall_score,
                trust_score: worker.rep_trust_score,
                reliability_score: worker.rep_reliability_score,
                response_score: worker.rep_response_score
            };
        } else {
            const repRes = await db.query(
                "SELECT overall_score, trust_score FROM worker_reputation_scores WHERE worker_id = $1",
                [worker.id]
            );
            rep = repRes.rows[0] || {};
        }

        const features = {
            distance: distanceKm,
            completion_rate: workerFeatures.completion_rate || 100.0,
            cancellation_rate: workerFeatures.cancellation_rate || 0.0,
            avg_response_time: workerFeatures.avg_response_time || 2.0,
            reliability_score: parseFloat(rep.overall_score || 50) / 100.0,
            jobs_completed: worker.jobs_completed || 0,
            online_consistency: workerFeatures.online_consistency || 1.0,
            worker_load: workerFeatures.worker_load_score || 0.0,
            fatigue_24h: workerFeatures.fatigue_24h || 0.0,
            fatigue_7d: workerFeatures.fatigue_7d || 0.0,
            fatigue_30d: workerFeatures.fatigue_30d || 0.0,
            acceptance_rate: workerFeatures.acceptance_rate || (workerFeatures.completion_rate ? parseFloat(workerFeatures.completion_rate) / 100.0 : 1.0),
            trust_score: parseFloat(rep.trust_score || 50) / 100.0,
            category_encoded: 0,
            urgency_encoded: jobFeatures.isUrgent ? 3 : 1,
            price: jobPrice || 0,
            schedule_type_encoded: 0,
            demand_pressure: jobFeatures.demand_pressure || 0.0,
        };

        const body = {
            workers: [features],
            model_version: null,
            use_exploration: true,
            exploration_rate: 0.10
        };

        try {
            const response = await this.postRequest('/predict/ranking', body);
            if (response && response.scores && response.scores.length > 0) {
                return response.scores[0].score;
            }
        } catch (e) {
            console.warn('[ML-FALLBACK] ML service unavailable, using lightweight fallback');
        }

        return this.lightweightFallbackScore(features);
    }

    lightweightFallbackScore(features) {
        const wCompletion = 0.35;
        const wReliability = 0.20;
        const wDistance = 0.15;
        const wResponse = 0.10;
        const wTrust = 0.10;
        const wLoad = 0.10;

        const completionNorm = (features.completion_rate || 100) / 100.0;
        const reliability = features.reliability_score || 1.0;
        const distanceNorm = 1.0 / (1.0 + (features.distance || 5));
        const responseNorm = Math.max(0, 1.0 - (features.avg_response_time || 5) / 30.0);
        const trust = features.trust_score || 1.0;
        const loadPenalty = Math.max(0, 1.0 - (features.worker_load || 0) * 0.3);

        return Math.min(1.0,
            wCompletion * completionNorm +
            wReliability * reliability +
            wDistance * distanceNorm +
            wResponse * responseNorm +
            wTrust * trust +
            wLoad * loadPenalty
        );
    }

    async calculateAcceptanceProbability(worker, distanceKm, jobPrice, jobId = null) {
        let workerFeatures = worker;
        if (worker.completion_rate === undefined) {
            const featureStore = require('./feature_store.service');
            workerFeatures = await featureStore.getWorkerFeatures(worker.id);
        }
        const jobFeatures = jobId ? await featureStore.getJobFeatures(jobId) : { isUrgent: false, demand_pressure: 0.0 };

        let rep = {};
        if (worker.rep_overall_score !== undefined) {
            rep = {
                overall_score: worker.rep_overall_score,
                trust_score: worker.rep_trust_score,
                reliability_score: worker.rep_reliability_score,
                response_score: worker.rep_response_score
            };
        } else {
            const repRes = await db.query(
                "SELECT overall_score, trust_score, reliability_score, response_score FROM worker_reputation_scores WHERE worker_id = $1",
                [worker.id]
            );
            rep = repRes.rows[0] || {};
        }

        const features = {
            distance: distanceKm,
            completion_rate: workerFeatures.completion_rate || 100.0,
            cancellation_rate: workerFeatures.cancellation_rate || 0.0,
            avg_response_time: workerFeatures.avg_response_time || 2.0,
            reliability_score: parseFloat(rep.reliability_score || 50) / 100.0,
            jobs_completed: worker.jobs_completed || 0,
            online_consistency: workerFeatures.online_consistency || 1.0,
            worker_load: workerFeatures.worker_load_score || 0.0,
            fatigue_24h: workerFeatures.fatigue_24h || 0.0,
            fatigue_7d: workerFeatures.fatigue_7d || 0.0,
            fatigue_30d: workerFeatures.fatigue_30d || 0.0,
            acceptance_rate: workerFeatures.acceptance_rate || (workerFeatures.completion_rate ? parseFloat(workerFeatures.completion_rate) / 100.0 : 1.0),
            trust_score: parseFloat(rep.trust_score || 50) / 100.0,
            category_encoded: 0,
            urgency_encoded: jobFeatures.isUrgent ? 3 : 1,
            price: jobPrice || 0,
            schedule_type_encoded: 0,
            demand_pressure: jobFeatures.demand_pressure || 0.0,
        };

        try {
            const response = await this.postRequest('/predict/acceptance', features);
            if (response && response.acceptance_probability !== undefined) {
                return this.applyAcceptanceThreshold(response.acceptance_probability, worker);
            }
        } catch (e) {
            console.warn('[ACCEPTANCE-FALLBACK] ML service unavailable, using heuristic');
        }

        const pAccept = this.heuristicAcceptance(features);
        return this.applyAcceptanceThreshold(pAccept, worker);
    }

    applyAcceptanceThreshold(pAccept, worker) {
        console.log(`[SHADOW-ACCEPTANCE] Worker ${worker.id} pAccept=${pAccept.toFixed(4)} (logged, not gating)`);
        return { probability: pAccept, threshold: 0, isNewWorker: false, accepted: true };
    }

    heuristicAcceptance(features) {
        const wDistance = -0.35;
        const wRating = 1.20;
        const wFatigue = -0.80;
        const wCompletion = 0.50;
        const bias = 1.0;

        const z = ((features.distance || 5) * wDistance) +
                  ((features.completion_rate || 100) / 100.0 * wRating) +
                  ((features.fatigue_24h || 0) * wFatigue) +
                  ((features.completion_rate || 100) / 100.0 * wCompletion) + bias;
        return 1 / (1 + Math.exp(-z));
    }

    async shouldIncludeWorker(worker) {
        const isNew = (worker.jobs_completed || 0) < 5;
        if (!isNew) return true;
        const explorationQuota = parseFloat(await redis.get('exploration:new_worker_quota') || '0.15');
        return Math.random() < Math.min(0.85, 0.3 + explorationQuota);
    }

    async calculateFatigueScore(workerId) {
        const now = Math.floor(Date.now() / 1000);
        const windows = {
            '24h': 86400,
            '7d': 604800,
            '30d': 2592000,
        };
        const results = {};
        for (const [label, seconds] of Object.entries(windows)) {
            const since = now - seconds;
            let rejections = 0;
            let ignored = 0;
            let timeouts = 0;
            try {
                const rCount = parseInt(await redis.get(`worker:${workerId}:rejections`) || 0);
                const iCount = parseInt(await redis.get(`worker:${workerId}:ignored`) || 0);
                const tCount = parseInt(await redis.get(`worker:${workerId}:timeouts`) || 0);
                const z = (0.4 * rCount) + (0.3 * iCount) + (0.2 * tCount) - 2.0;
                results[label] = 1 / (1 + Math.exp(-z));
            } catch (e) {
                results[label] = 0.0;
            }
        }
        results.composite = (results['24h'] * 0.6) + (results['7d'] * 0.3) + (results['30d'] * 0.1);
        return results;
    }

    async contextualBanditSelect(workers, job) {
        try {
            const banditResponse = await this.postRequest('/predict/bandit/select', {
                workers: workers.map(w => ({ id: w.id, score: w.score || 0 })),
                exploration_rate: 0.15,
            });
            if (banditResponse && banditResponse.selected_worker) {
                const selectedId = banditResponse.selected_worker.id;
                const selected = workers.find(w => w.id === selectedId);
                if (selected) {
                    await this.logExploration(job.id, selected.id, true);
                    return selected;
                }
            }
        } catch (e) {
            console.warn('[BANDIT-FALLBACK] Bandit service unavailable, using heuristic');
        }

        const EXPLOITATION_RATE = 0.90;
        const EXPLORATION_RATE = 0.10;
        const rng = Math.random();
        if (rng < EXPLORATION_RATE && workers.length > 1) {
            const newWorkers = workers.filter(w => (w.jobs_completed || 0) < 5);
            if (newWorkers.length > 0) {
                const selected = newWorkers[Math.floor(Math.random() * newWorkers.length)];
                await this.logExploration(job.id, selected.id, true);
                return selected;
            }
            const selected = workers[Math.floor(Math.random() * workers.length)];
            await this.logExploration(job.id, selected.id, true);
            return selected;
        }
        const best = workers.reduce((a, b) => (a.score || 0) > (b.score || 0) ? a : b);
        await this.logExploration(job.id, best.id, false);
        return best;
    }

    async logExploration(jobId, workerId, wasExploration) {
        try {
            await db.query(
                `INSERT INTO exploration_log (job_id, worker_id, strategy, was_exploration)
                 VALUES ($1, $2, $3, $4)`,
                [jobId, workerId, wasExploration ? 'explore' : 'exploit', wasExploration]
            );
        } catch (e) {
            console.warn('[EXPLORATION-LOG] Failed:', e.message);
        }
    }

    async recordFeedbackClick(userId, workerId, jobId, actionType, actionValue = 0, sessionId = null) {
        try {
            await db.query(
                `INSERT INTO ranking_clicks (user_id, worker_id, job_id, action_type, action_value, session_id)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [userId, workerId, jobId, actionType, actionValue, sessionId]
            );
            console.log(`[FEEDBACK] ${actionType} for worker ${workerId} on job ${jobId}`);
        } catch (err) {
            console.error('[FEEDBACK-ERROR]', err.message);
        }
    }

    postRequest(endpoint, body) {
        if (Date.now() < mlServiceOfflineUntil) {
            return Promise.reject(new Error('ML service is currently offline (Circuit Breaker active)'));
        }
        return new Promise((resolve, reject) => {
            const urlObj = new URL(ML_SERVICE_URL + endpoint);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: 1000
            };
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(JSON.parse(data));
                        } else {
                            mlServiceOfflineUntil = Date.now() + 30000; // Mark offline for 30 seconds
                            reject(new Error(`Status ${res.statusCode}`));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (err) => {
                mlServiceOfflineUntil = Date.now() + 30000; // Mark offline for 30 seconds
                reject(err);
            });
            req.on('timeout', () => { 
                req.destroy(); 
                mlServiceOfflineUntil = Date.now() + 30000; // Mark offline for 30 seconds
                reject(new Error('Timeout')); 
            });
            req.write(JSON.stringify(body));
            req.end();
        });
    }
}

module.exports = new RankingService();
