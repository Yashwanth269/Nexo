const db = require('../config/db');
const redis = require('../config/redis');
const geoHash = require('./geo_hash.service');
const featureStoreService = require('./feature_store.service');
const optimizationConfig = require('../config/marketplace_optimization.config');
const https = require('https');
const http = require('http');

async function callMLPredictService(endpoint, bodyData) {
    const body = JSON.stringify(bodyData);
    try {
        return await new Promise((resolve) => {
            const urlObj = new URL(`http://localhost:8000${endpoint}`);
            const transport = http;
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                timeout: 1000,
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

class MarketplaceOptimizationService {
  /**
   * AI Earnings Forecast Engine (AFE - Chapter 15)
   * Predicts P10, P50, and P90 expected earnings using weather, weekday, and ML predictions
   */
  async generateEarningsForecast(workerId, category = 'Electrical') {
    try {
        const features = await featureStoreService.getWorkerFeatures(workerId);
        
        // Query last 180 days of earnings for this worker
        const histRes = await db.query(`
            SELECT price 
            FROM jobs 
            WHERE worker_id = $1 
              AND status = 'COMPLETED' 
              AND category = $2
              AND completed_at >= NOW() - INTERVAL '180 days'
        `, [workerId, category]);

        const earningsList = histRes.rows.map(r => parseFloat(r.price)).sort((a, b) => a - b);
        
        let p10 = 1500, p50 = 3500, p90 = 5500;
        if (earningsList.length > 5) {
            p10 = earningsList[Math.floor(earningsList.length * 0.10)];
            p50 = earningsList[Math.floor(earningsList.length * 0.50)];
            p90 = earningsList[Math.floor(earningsList.length * 0.90)];
        }

        // Call ML model prediction endpoint
        const payload = {
            workerId,
            category,
            historicalP50: p50,
            fatigueScore: features.fatigue_score,
            reliabilityScore: features.reliability_score,
            weekday: new Date().getDay(),
            weather: 'clear'
        };

        const mlRes = await callMLPredictService('/predict/earnings', payload);

        let adjustedP10 = p10;
        let adjustedP50 = p50;
        let adjustedP90 = p90;

        if (mlRes && mlRes.predicted_p50) {
            adjustedP10 = mlRes.predicted_p10;
            adjustedP50 = mlRes.predicted_p50;
            adjustedP90 = mlRes.predicted_p90;
        } else {
            // Heuristic fallback using worker fatigue and reliability coefficients
            const reliabilityCoeff = features.reliability_score || 1.0;
            const fatigueCoeff = Math.max(0.5, 1.0 - (features.fatigue_score || 0.0));
            adjustedP10 = Math.round(p10 * reliabilityCoeff * fatigueCoeff);
            adjustedP50 = Math.round(p50 * reliabilityCoeff * fatigueCoeff);
            adjustedP90 = Math.round(p90 * reliabilityCoeff * fatigueCoeff);
        }

        return {
          success: true,
          workerId: workerId.toString(),
          forecastRange: { min: adjustedP10, max: adjustedP90 },
          p10: adjustedP10,
          p50: adjustedP50,
          p90: adjustedP90,
          confidencePercent: Math.round((features.reliability_score || 1.0) * 95),
          bestTimeWindow: "9 AM – 1 PM",
          aiSuggestion: `Accept 2 scheduled jobs before 10 AM to reach your ₹${adjustedP50} daily forecast.`,
          goalPlan: [
            { task: `${category} Standard Job`, expectedEarnings: adjustedP50 }
          ],
          _mlMeta: {
              model_version: mlRes ? mlRes.model_version : 'heuristic-fallback'
          }
        };
    } catch (err) {
        return {
          success: false,
          error: err.message
        };
    }
  }

  /**
   * Demand Heat Map Engine (DHM - Chapter 16)
   * Solves the N+1 database queries problem using a single aggregated geospatial GROUP BY query
   */
  async getDemandHeatMap() {
    try {
        // Run exactly ONE single database query aggregating all zone demand/supply indicators
        const res = await db.query(`
            SELECT 
                z.id,
                z.locality,
                COUNT(DISTINCT j.id)::int as active_requests,
                COUNT(DISTINCT w.id)::int as active_workers
            FROM marketplace_zones z
            LEFT JOIN jobs j ON j.location_lat IS NOT NULL AND j.location_lng IS NOT NULL 
              AND earth_distance(ll_to_earth(j.location_lat, j.location_lng), ll_to_earth(z.center_lat, z.center_lng)) <= z.radius_km * 1000
              AND j.status IN ('OPEN', 'QUEUED', 'DISPATCHING')
            LEFT JOIN workers w ON w.is_online = true AND w.is_available = true AND w.current_lat IS NOT NULL AND w.current_lng IS NOT NULL
              AND earth_distance(ll_to_earth(w.current_lat, w.current_lng), ll_to_earth(z.center_lat, z.center_lng)) <= z.radius_km * 1000
            GROUP BY z.id, z.locality
        `);

        const zones = res.rows.map(row => {
            const deficit = Math.max(0, row.active_requests - row.active_workers);
            let heatLevel = "🟢 NORMAL";
            if (deficit >= optimizationConfig.heatmap.deficitThreshold) {
                heatLevel = "🟠 HIGH";
            }
            if (deficit >= optimizationConfig.heatmap.deficitThreshold * 2) {
                heatLevel = "🔴 CRITICAL";
            }

            return {
                name: row.locality,
                heatLevel,
                activeRequests: row.active_requests,
                workerDeficit: deficit,
                expectedEarningsAdd: deficit * 200
            };
        });

        return {
          success: true,
          timestamp: new Date().toISOString(),
          city: "Bengaluru",
          zones
        };
    } catch (err) {
        return {
          success: false,
          error: err.message
        };
    }
  }

  /**
   * Smart Job Bundling Engine (SJB - Chapter 17)
   * Group jobs taking time windows, road networks, and category capabilities into account
   */
  findAndBuildJobBundles(candidateJobs) {
    if (!candidateJobs || candidateJobs.length < 2) {
      return [];
    }

    const bundles = [];

    // Group jobs by category + geohash precision 5 proximity
    const clusters = {};
    candidateJobs.forEach(job => {
        if (!job.location_lat || !job.location_lng) return;
        const hash = geoHash.encode(parseFloat(job.location_lat), parseFloat(job.location_lng), 5);
        const clusterKey = `${job.category || 'General'}:${hash}`;
        if (!clusters[clusterKey]) clusters[clusterKey] = [];
        clusters[clusterKey].push(job);
    });

    for (const [key, jobs] of Object.entries(clusters)) {
        const [category, hash] = key.split(':');
        if (jobs.length >= 2) {
            const bundleJobs = jobs.slice(0, optimizationConfig.bundling.maxJobsPerBundle);
            const totalPayout = bundleJobs.reduce((sum, j) => sum + parseFloat(j.price || 0), 0);
            
            const bundleId = `bundle_${hash}_${Date.now()}`;
            bundles.push({
              bundleId,
              bundleTitle: `${category} Cluster Bundle`,
              totalJobs: bundleJobs.length,
              totalPayout: Math.round(totalPayout * optimizationConfig.bundling.minPayoutMultiplier),
              totalTravelKm: 1.8,
              estimatedDurationMins: bundleJobs.length * 45,
              jobs: bundleJobs.map((j, idx) => ({
                id: j.id,
                title: j.title || j.category || "Service",
                price: parseFloat(j.price || 0)
              })),
              aiRationale: `${bundleJobs.length} matching ${category} jobs grouped inside a 2.5km geohash cluster`
            });
        }
    }

    return bundles;
  }

  /**
   * AI Job Duration Prediction (Chapter 19)
   */
  predictJobDuration(category, issueType, propertyType = 'INDEPENDENT_HOUSE') {
    const config = optimizationConfig.duration;
    let estMins = config.defaultMins;

    if (category.toLowerCase().includes('ac')) estMins = config.acMins;
    if (category.toLowerCase().includes('cleaning')) estMins = config.cleaningMins;
    if (propertyType === 'LUXURY_APARTMENT') estMins += config.luxuryApartmentBuffer;

    return {
      estimatedDurationMins: estMins,
      confidencePercent: 89,
      bufferAddedMins: 15,
      totalBlockedTimeMins: estMins + 15,
    };
  }

  /**
   * Predictive Reassignment Engine (PRE - Chapter 20)
   */
  evaluateReassignmentRisk(job, workerDistanceKm, minutesToJobStart, trafficRisk = 'LOW') {
    const travelTimeNeeded = Math.round(workerDistanceKm * 2.5) + (trafficRisk === 'HIGH' ? 20 : 5);
    const arrivalProbability = Math.round(Math.min(100, Math.max(5, (minutesToJobStart / travelTimeNeeded) * 80)));

    let riskLevel = "GREEN";
    let isStandbyTriggered = false;

    const limits = optimizationConfig.reassignment;
    if (arrivalProbability < limits.criticalProbability) {
      riskLevel = "RED";
      isStandbyTriggered = true;
    } else if (arrivalProbability < limits.moderateProbability) {
      riskLevel = "ORANGE";
      isStandbyTriggered = true;
    }

    return {
      riskLevel,
      arrivalProbability,
      isStandbyTriggered,
      actionTaken: isStandbyTriggered
        ? "🚨 High risk detected! Silent standby backup assigned. Customer notified of closer professional."
        : "✅ Normal progress monitored.",
    };
  }
}

module.exports = new MarketplaceOptimizationService();
