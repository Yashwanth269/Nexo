const db = require('../config/db');
const redis = require('../config/redis');
const geoHash = require('./geo_hash.service');
const incentiveConfig = require('../config/incentive.config');
const featureStoreService = require('./feature_store.service');
const https = require('https');
const http = require('http');

async function callIncentiveMLService(endpoint, bodyData) {
    const body = JSON.stringify(bodyData);
    try {
        return await new Promise((resolve, reject) => {
            const urlObj = new URL(`${incentiveConfig.mlServiceUrl}${endpoint}`);
            const transport = urlObj.protocol === 'https:' ? https : http;
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                timeout: incentiveConfig.mlTimeoutMs,
            };
            const req = transport.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.write(body);
            req.end();
        });
    } catch (err) {
        return null;
    }
}

class IncentiveMLService {
    /**
     * Recommends localized dynamic incentives using machine learning and historical worker profiles
     */
    async recommendIncentives(workerId, lat, lng) {
        try {
            // 1. Calculate LOCALIZED demand vs supply ratio (geohash level 5)
            const safeLat = parseFloat(lat);
            const safeLng = parseFloat(lng);
            const hash = geoHash.encode(safeLat, safeLng, 5);

            // Fetch active workers in this geohash
            const activeWorkers = await redis.scard(`workers:active:region:${hash}`).catch(() => 5) || 5;

            // Query open jobs in this region from database
            const openJobsRes = await db.query(
                `SELECT COUNT(*) FROM jobs 
                 WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING') 
                   AND earth_distance(ll_to_earth($1, $2), ll_to_earth(location_lat, location_lng)) <= 5000.0`,
                [safeLat, safeLng]
            );
            const openJobsCount = parseInt(openJobsRes.rows[0].count || '0', 10);
            
            const demandSupplyRatio = activeWorkers > 0 ? (openJobsCount / activeWorkers) : 1.0;

            // 2. Fetch worker weekly stats and features (for personalized incentives)
            const [statsRes, features] = await Promise.all([
                db.query(`
                    SELECT COUNT(*) as jobs_this_week, COALESCE(SUM(price), 0) as earnings_this_week
                    FROM jobs
                    WHERE worker_id = $1
                      AND status = 'COMPLETED'
                      AND completed_at >= date_trunc('week', CURRENT_DATE)
                `, [workerId]),
                featureStoreService.getWorkerFeatures(workerId)
            ]);

            const jobsThisWeek = parseInt(statsRes.rows[0].jobs_this_week || '0', 10);
            const earningsThisWeek = parseFloat(statsRes.rows[0].earnings_this_week || '0');

            // 3. Make ML Inference call
            const featuresPayload = {
                worker_id: workerId,
                demand_supply_ratio: parseFloat(demandSupplyRatio.toFixed(2)),
                jobs_completed_this_week: jobsThisWeek,
                worker_reliability: features.reliability_score,
                worker_rating: features.avg_rating,
                worker_fatigue: features.fatigue_score,
                geohash: hash
            };

            const mlResponse = await callIncentiveMLService('/predict/incentive', { features: featuresPayload });

            let areaMultiplier = 1.0;
            const configSurges = incentiveConfig.surges;

            if (mlResponse && mlResponse.recommended_multiplier) {
                areaMultiplier = mlResponse.recommended_multiplier;
                console.log(`[ML-INCENTIVE] Recommended multiplier for worker ${workerId}: ${areaMultiplier} (ML service)`);
            } else {
                // Fallback to configurable dynamic heuristic surge
                if (demandSupplyRatio > configSurges.criticalRatio) {
                    areaMultiplier = configSurges.criticalMultiplier;
                } else if (demandSupplyRatio > configSurges.moderateRatio) {
                    areaMultiplier = configSurges.moderateMultiplier;
                }
            }

            // 4. Dynamic Milestone matching
            let nextMilestoneJobs = 20;
            let milestoneReward = 500;

            const configMilestones = incentiveConfig.milestones;
            for (const m of configMilestones) {
                if (jobsThisWeek < m.targetJobs) {
                    nextMilestoneJobs = m.targetJobs;
                    milestoneReward = m.rewardAmount;
                    break;
                }
            }

            return {
                workerId,
                demandSupplyRatio: parseFloat(demandSupplyRatio.toFixed(2)),
                areaMultiplier: parseFloat(areaMultiplier.toFixed(2)),
                jobsThisWeek,
                earningsThisWeek: parseFloat(earningsThisWeek.toFixed(2)),
                nextMilestone: {
                    targetJobs: nextMilestoneJobs,
                    jobsRemaining: Math.max(0, nextMilestoneJobs - jobsThisWeek),
                    bonusReward: milestoneReward
                },
                _mlMeta: {
                    modelVersion: mlResponse ? mlResponse.model_version : 'heuristic-fallback',
                    latencyMs: mlResponse ? mlResponse.latency_ms : 0
                }
            };
        } catch (e) {
            console.error('[INCENTIVE-ML-ERROR]', e.message);
            return { workerId, areaMultiplier: 1.0, nextMilestone: { targetJobs: 20, jobsRemaining: 20, bonusReward: 500 } };
        }
    }
}

module.exports = new IncentiveMLService();
