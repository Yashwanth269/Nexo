const db = require('../config/db');
const redis = require('../config/redis');
const https = require('https');
const http = require('http');
const routeDeviationService = require('./route_deviation.service');
const backupWorkerService = require('./backup_worker.service');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// =============================================================
// EXECUTION SERVICE — Production Grade State Machine
// =============================================================

class ExecutionService {
    constructor() {
        this.statusChain = [
            'ACCEPTED',
            'ON_THE_WAY',
            'ARRIVED',
            'WORK_IN_PROGRESS',
            'COMPLETED'
        ];
    }

    /**
     * Validates and transitions job status.
     * Uses SELECT FOR UPDATE row lock for strict concurrency control.
     */
    async transitionStatus(jobId, workerId, newStatus, metadata = {}) {
        // Resolve worker profile (handles both UUID and phone number formats)
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) {
            return { success: false, error: "Worker not found in database" };
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Row-level lock prevents concurrent status updates
            const jobResult = await client.query(
                "SELECT status, location_lat, location_lng, scheduled_at, user_id FROM jobs WHERE id = $1::uuid AND worker_id = $2::uuid FOR UPDATE",
                [jobId, worker.id]
            );

            if (jobResult.rowCount === 0) throw new Error("Job not found or worker unauthorized");
            
            const currentStatus = jobResult.rows[0].status;
            
            // Define allowable state transitions
            const allowedTransitions = {
                'ACCEPTED': ['ON_THE_WAY'],
                'ON_THE_WAY': ['ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION'],
                'FORCE_ARRIVAL_PENDING_CONFIRMATION': ['ARRIVED', 'ON_THE_WAY'],
                'ARRIVED': ['WORK_IN_PROGRESS'],
                'WORK_IN_PROGRESS': ['COMPLETED', 'WAITING_FOR_PAYMENT'],
                'WAITING_FOR_PAYMENT': ['COMPLETED']
            };

            if (!allowedTransitions[currentStatus] || !allowedTransitions[currentStatus].includes(newStatus)) {
                throw new Error(`Invalid transition: ${currentStatus} -> ${newStatus}`);
            }

            // GPS Spoof Detection — Rule engine in production, ML in shadow mode
            const gpsCheck = await this._checkGpsSpoof({
                lat: metadata.lat || 0,
                lng: metadata.lng || 0,
                prevLat: metadata.prevLat || null,
                prevLng: metadata.prevLng || null,
                mockLocation: metadata.isMocked === true || metadata.mockLocation === true,
                gpsAccuracy: metadata.gpsAccuracy || 10,
                headingChange: metadata.headingChange || 0,
                signalStrength: metadata.signalStrength || -70,
            });

            const ruleBasedSuspicious = gpsCheck.alerts && gpsCheck.alerts.length > 0;
            if (gpsCheck.mlScore !== undefined) {
                console.log(`[SHADOW-GPS] Worker=${worker.id} rule=${gpsCheck.ruleScore} ml=${gpsCheck.mlScore} final=${gpsCheck.gpsTrustScore} alerts=${JSON.stringify(gpsCheck.alerts)}`);
            }

            const gpsScore = gpsCheck.gpsTrustScore;
            let gpsStatus = 'SAFE';
            if (gpsScore < 40) gpsStatus = 'FRAUD_ALERT';
            else if (gpsScore < 60) gpsStatus = 'SUSPICIOUS';
            else if (gpsScore < 80) gpsStatus = 'MONITOR';

            await client.query(`
                INSERT INTO worker_gps_risk (worker_id, gps_trust_score, anomaly_count, alerts, status, last_anomaly_at)
                VALUES ($1, $2, 1, $3, $4, NOW())
                ON CONFLICT (worker_id) DO UPDATE SET
                    gps_trust_score = EXCLUDED.gps_trust_score,
                    anomaly_count = CASE WHEN EXCLUDED.gps_trust_score < 60 THEN worker_gps_risk.anomaly_count + 1 ELSE worker_gps_risk.anomaly_count END,
                    alerts = CASE WHEN EXCLUDED.alerts IS NOT NULL AND array_length(EXCLUDED.alerts, 1) > 0 THEN EXCLUDED.alerts ELSE worker_gps_risk.alerts END,
                    status = EXCLUDED.status,
                    last_anomaly_at = CASE WHEN EXCLUDED.gps_trust_score < 60 THEN NOW() ELSE worker_gps_risk.last_anomaly_at END
            `, [worker.id, gpsScore, gpsCheck.alerts || [], gpsStatus]);

            if (ruleBasedSuspicious) {
                console.warn(`🚨 [GPS_RULE_ENGINE] Rule-based alert for worker: ${worker.id}. Score: ${gpsCheck.gpsTrustScore}`);
                await client.query(
                    "INSERT INTO event_logs (job_id, worker_id, event_type, metadata) VALUES ($1, $2, $3, $4)",
                    [jobId, worker.id, 'GPS_SPOOFING_DETECTED', JSON.stringify({ ...gpsCheck, timestamp: new Date() })]
                );
                await client.query(
                    "UPDATE workers SET rating = GREATEST(1.0, rating - 0.1) WHERE id = $1",
                    [worker.id]
                );
            }

            // Radius limits (100 meters)
            const ARRIVAL_RADIUS_METERS = 100;
            let distanceMeters = null;

            if (newStatus === 'ARRIVED' || newStatus === 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
                const { lat, lng } = metadata;
                if (!lat || !lng) {
                    throw new Error("GPS coordinates are required to mark arrival");
                }
                const distanceKm = this.calculateDistance(
                    lat, lng, 
                    jobResult.rows[0].location_lat, 
                    jobResult.rows[0].location_lng
                );
                distanceMeters = Math.round(distanceKm * 1000);
                console.log(`[ARRIVAL_DISTANCE] Worker distance from destination: ${distanceMeters}m`);

                // Check speed and stationary time eligibility in Redis
                const lowSpeedSince = await redis.get(`worker:${worker.id}:low_speed_since`);
                const isStationary20s = (metadata.isMocked === true) || (metadata.customerConfirmed === true) || (lowSpeedSince && (Date.now() - parseInt(lowSpeedSince) >= 20000));

                if (newStatus === 'ARRIVED') {
                    if (distanceMeters > ARRIVAL_RADIUS_METERS || !isStationary20s) {
                        if (metadata.force === true) {
                            newStatus = 'FORCE_ARRIVAL_PENDING_CONFIRMATION';
                            console.log(`[GPS_OVERRIDE] Worker not fully eligible but force-marking arrival. Status set to FORCE_ARRIVAL_PENDING_CONFIRMATION.`);
                        } else {
                            const detailErr = distanceMeters > ARRIVAL_RADIUS_METERS ? "TOO_FAR" : "SPEED_NOT_STATIONARY";
                            console.log(`[GPS_VALIDATION_FAILED] Worker not eligible for ARRIVED status (${detailErr}). Distance: ${distanceMeters}m`);
                            await client.query('ROLLBACK');
                            return { 
                                success: false, 
                                error: detailErr, 
                                message: distanceMeters > ARRIVAL_RADIUS_METERS ? 
                                    "You are too far from the destination." : 
                                    "You must remain stationary (< 5 km/h) near destination for 20 seconds before marking arrival.",
                                distance: distanceMeters 
                            };
                        }
                    }
                }
            }

            // Perform Update
            let updateFields = "status = $1, updated_at = CURRENT_TIMESTAMP";
            let queryParams = [newStatus, jobId];
            if (newStatus === 'ON_THE_WAY') {
                updateFields = "status = $1, on_the_way_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP";
            } else if (newStatus === 'ARRIVED' || newStatus === 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
                updateFields = "status = $1, arrived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP";
            } else if (newStatus === 'WORK_IN_PROGRESS' || newStatus === 'STARTED' || newStatus === 'IN_PROGRESS') {
                updateFields = "status = $1, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP";
            } else if (newStatus === 'COMPLETED') {
                const paymentMethod = (metadata.paymentMethod || 'ONLINE').toUpperCase();
                updateFields = "status = $1, completed_at = CURRENT_TIMESTAMP, payment_method = $3, updated_at = CURRENT_TIMESTAMP";
                queryParams.push(paymentMethod);
            }

            await client.query(
                `UPDATE jobs SET ${updateFields} WHERE id = $2::uuid`,
                queryParams
            );

            // Log Event
            await client.query(
                "INSERT INTO event_logs (job_id, worker_id, event_type, metadata) VALUES ($1, $2, $3, $4)",
                [jobId, worker.id, `status_change_${newStatus}`, JSON.stringify({ ...metadata, distanceMeters })]
            );

            await client.query('COMMIT');

            if (newStatus === 'COMPLETED') {
                try {
                    const { invalidateAllHomeServicesCaches } = require('../routes/home.routes');
                    await invalidateAllHomeServicesCaches().catch(() => {});
                    
                    const feedService = require('./feed.service');
                    await feedService.invalidateFeedCache(jobResult.rows[0].location_lat, jobResult.rows[0].location_lng).catch(() => {});
                    
                    const eventStream = require('../utils/event_stream');
                    await eventStream.publish('job_completed', {
                        jobId,
                        workerId: worker.id,
                        lat: jobResult.rows[0].location_lat,
                        lng: jobResult.rows[0].location_lng,
                        category: jobResult.rows[0].category,
                        userId: jobResult.rows[0].user_id
                    });

                    // Log completed dispatch event and worker response for analytics
                    const matchingService = require('./matching.service');
                    matchingService.logDispatchEvent(jobId, 'job_completed', { workerId: worker.id }).catch(() => {});

                    // Update search analytics to mark is_completed
                    try {
                        await db.query(
                            "UPDATE search_analytics_logs SET is_completed = true WHERE job_id = $1",
                            [jobId]
                        );
                    } catch (_) {}
                } catch (streamErr) {
                    console.error("⚠️ [EXECUTION_SERVICE] Failed to publish job_completed event:", streamErr.message);
                }
            }

            // Automatically create a completed job post in the social feed if the status transitions to COMPLETED
            if (newStatus === 'COMPLETED') {
                try {
                    const feedService = require('./feed.service');
                    await feedService.createOrUpdateCompletedPost(jobId);
                } catch (feedErr) {
                    console.error("⚠️ [EXECUTION_SERVICE] Failed to create completed job post:", feedErr.message);
                }
            }

            // Update Redis status cache
            await redis.set(`job:${jobId}:status`, newStatus, 'EX', 3600);

            // Broadcast Status Change
            const { getIO } = require('../config/socket');
            const io = getIO();
            const userId = jobResult.rows[0].user_id;
            
            // Core standard state updates
            io.to(`user:${userId}`).emit('job_status_updated', {
                jobId,
                status: newStatus,
                metadata: { ...metadata, distanceMeters }
            });
            io.to(`job:${jobId}`).emit('job_status_updated', {
                jobId,
                status: newStatus,
                metadata: { ...metadata, distanceMeters }
            });

            // Emit to both formats to be 100% robust for worker
            io.to(`worker:${worker.phone_number}`).emit('active_job_updated', {
                jobId,
                status: newStatus,
                metadata: { ...metadata, distanceMeters }
            });
            io.to(`worker:${worker.id}`).emit('active_job_updated', {
                jobId,
                status: newStatus,
                metadata: { ...metadata, distanceMeters }
            });

            // Specific event emission for forced arrivals
            if (newStatus === 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
                console.log(`[FORCE_ARRIVAL_TRIGGERED] Worker ${worker.id} force marked arrival at ${distanceMeters}m`);
                
                const forcePayload = {
                    jobId,
                    workerId: worker.id,
                    distance: distanceMeters,
                    message: "The worker marked arrival but appears away from your location."
                };
                
                io.to(`user:${userId}`).emit('WORKER_FORCE_MARKED_ARRIVAL', forcePayload);
                io.to(`job:${jobId}`).emit('WORKER_FORCE_MARKED_ARRIVAL', forcePayload);
            }

            return { success: true, status: newStatus };
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            return { success: false, error: error.message };
        } finally {
            if (client) client.release();
        }
    }

    async _checkGpsSpoof(params) {
        try {
            const body = JSON.stringify({
                lat: params.lat,
                lng: params.lng,
                prev_lat: params.prevLat,
                prev_lng: params.prevLng,
                mock_location: params.mockLocation,
                gps_accuracy: params.gpsAccuracy,
                heading_change: params.headingChange,
                signal_strength: params.signalStrength,
            });
            const response = await new Promise((resolve, reject) => {
                const urlObj = new URL(`${ML_SERVICE_URL}/predict/gps-spoof`);
                const transport = urlObj.protocol === 'https:' ? https : http;
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                    timeout: 2000,
                };
                const req = transport.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve({ gps_trust_score: 100, alerts: [], is_suspicious: false }); }
                    });
                });
                req.on('error', () => resolve({ gps_trust_score: 100, alerts: [], is_suspicious: false }));
                req.on('timeout', () => { req.destroy(); resolve({ gps_trust_score: 100, alerts: [], is_suspicious: false }); });
                req.write(body);
                req.end();
            });
            return {
                gpsTrustScore: response.gps_trust_score || 100,
                alerts: response.alerts || [],
                isSuspicious: response.is_suspicious || false,
                mlScore: response.ml_score,
                ruleScore: response.rule_score,
            };
        } catch {
            return { gpsTrustScore: 100, alerts: [], isSuspicious: false };
        }
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * ETA Prediction using OSRM (Open Source Routing Machine).
     * Falls back to heuristic if OSRM is unavailable.
     */
    async predictETA(workerLat, workerLng, jobLat, jobLng, workerId = null, jobId = null, category = null) {
        const { getDirections } = require('../utils/google_maps');
        try {
            const directions = await getDirections(workerLat, workerLng, jobLat, jobLng);
            const distanceKm = (directions.distanceMeters / 1000).toFixed(2);
            const etaMins = Math.round(directions.durationSeconds / 60);

            // Call ML service for refined prediction
            try {
                const hour = new Date().getHours();
                const catMap = {
                    "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2, "PAINTING": 3,
                    "CARPENTRY": 4, "MOVING": 5, "GARDENING": 6, "APPLIANCE_REPAIR": 7,
                    "IT_SUPPORT": 8, "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
                    "DELIVERY": 12, "OTHER": 13
                };
                const features = {
                    distance_km: parseFloat(distanceKm),
                    hour_of_day: hour,
                    day_of_week: new Date().getDay(),
                    category_encoded: catMap[category] !== undefined ? catMap[category] : 13,
                    urgency_encoded: 1,
                    demand_pressure: 0.3,
                    is_peak_hours: (hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21) ? 1 : 0,
                    is_weekend: [0, 6].includes(new Date().getDay()) ? 1 : 0,
                    worker_speed_profile: 0.7,
                    historical_eta_accuracy: 0.8,
                    traffic_factor: etaMins > 0 ? etaMins / ((parseFloat(distanceKm) / 20) * 60) : 1.0,
                };

                const body = JSON.stringify({ features });
                    const mlResponse = await new Promise((resolve, reject) => {
                    const urlObj = new URL(`${ML_SERVICE_URL}/predict/eta`);
                    const transport = urlObj.protocol === 'https:' ? https : http;
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

                if (mlResponse && mlResponse.predicted_eta_minutes) {
                    console.log(`[SHADOW-ETA] Google=${etaMins}min, ML=${mlResponse.predicted_eta_minutes.toFixed(1)}min, distance=${distanceKm}km` + 
                        (workerId ? ` worker=${workerId}` : '') + (jobId ? ` job=${jobId}` : ''));
                }
            } catch (mlErr) {
                console.warn("⚠️ [predictETA-ML] ML fallback:", mlErr.message);
            }

            return { etaMins, distanceKm };
        } catch (e) {
            console.warn("⚠️ [predictETA] Heuristic fallback:", e.message);
            const distance = this.calculateDistance(workerLat, workerLng, jobLat, jobLng);
            const roadDistance = distance * 1.3;
            const etaMins = Math.round((roadDistance / 20) * 60) + 2;
            return { etaMins, distanceKm: roadDistance.toFixed(2) };
        }
    }

    /**
     * Updates worker location during an active job and performs throttled Directions API queries.
     */
    async syncWorkerLocation(workerId, lat, lng) {
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) return;

        const nowMs = Date.now();
        
        // Retrieve last GPS position for speed tracking
        const prevLat = await redis.get(`worker:${worker.id}:last_gps_lat`);
        const prevLng = await redis.get(`worker:${worker.id}:last_gps_lng`);
        const prevTime = await redis.get(`worker:${worker.id}:last_gps_time`);
        
        let speedKmh = 0;
        if (prevLat && prevLng && prevTime) {
            const timeSec = (nowMs - parseInt(prevTime)) / 1000;
            if (timeSec > 1) {
                const distKm = this.calculateDistance(lat, lng, parseFloat(prevLat), parseFloat(prevLng));
                speedKmh = (distKm / (timeSec / 3600));
            }
        }
        
        // Track stationary time (< 5 km/h)
        if (speedKmh < 5.0) {
            const lowSpeedSince = await redis.get(`worker:${worker.id}:low_speed_since`);
            if (!lowSpeedSince) {
                await redis.set(`worker:${worker.id}:low_speed_since`, nowMs);
            }
        } else {
            await redis.del(`worker:${worker.id}:low_speed_since`);
        }
        
        // Save current location/time in Redis
        await redis.set(`worker:${worker.id}:last_gps_lat`, lat);
        await redis.set(`worker:${worker.id}:last_gps_lng`, lng);
        await redis.set(`worker:${worker.id}:last_gps_time`, nowMs);

        // Log GPS trace for ML training data
        try {
            await db.query(
                `INSERT INTO gps_traces (worker_id, job_id, lat, lng, speed_kmh, accuracy_m, mock_location, heading, recorded_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                [worker.id, jobId || null, lat, lng, Math.round(speedKmh * 100) / 100,
                 metadata?.gpsAccuracy || 10, metadata?.isMocked === true || metadata?.mockLocation === true || false,
                 metadata?.heading || 0]
            );
        } catch (e) {
            // Non-critical; silent fail
        }

        // Find active accepted job
        const jobRes = await db.query(
            `SELECT id, user_id, location_lat, location_lng, status, route_polyline, route_distance, route_duration 
             FROM jobs 
             WHERE worker_id = $1 
             AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION')
             LIMIT 1`,
            [worker.id]
        );

        if (jobRes.rowCount === 0) return;
        const job = jobRes.rows[0];
        const jobId = job.id;

        // Throttling Logic
        const lastDirectionsTime = await redis.get(`job:${jobId}:last_directions_time`);
        const lastDirectionsLat = await redis.get(`job:${jobId}:last_directions_lat`);
        const lastDirectionsLng = await redis.get(`job:${jobId}:last_directions_lng`);

        let shouldRefresh = false;
        let timeElapsed = lastDirectionsTime ? (nowMs - parseInt(lastDirectionsTime)) / 1000 : Infinity;
        let distanceMoved = (lastDirectionsLat && lastDirectionsLng) ? 
            this.calculateDistance(lat, lng, parseFloat(lastDirectionsLat), parseFloat(lastDirectionsLng)) * 1000 : Infinity;

        let routeDeviationDetected = false;
        if (job.route_polyline) {
            routeDeviationDetected = detectRouteDeviation(lat, lng, job.route_polyline);
        }

        if (!lastDirectionsTime) {
            shouldRefresh = true;
        } else if (timeElapsed >= 30) { // Enforce 30s cooldown
            if (timeElapsed >= 60 || distanceMoved > 100 || routeDeviationDetected) {
                shouldRefresh = true;
            }
        }

        let currentPolyline = job.route_polyline;
        let currentDistanceMeters = job.route_distance;
        let currentDurationSeconds = job.route_duration;

        if (shouldRefresh) {
            const { getDirections } = require('../utils/google_maps');
            try {
                const directions = await getDirections(
                    lat, lng, 
                    parseFloat(job.location_lat), 
                    parseFloat(job.location_lng)
                );
                currentPolyline = directions.polyline;
                currentDistanceMeters = directions.distanceMeters;
                currentDurationSeconds = directions.durationSeconds;

                // Update database
                await db.query(
                    "UPDATE jobs SET route_polyline = $1, route_distance = $2, route_duration = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
                    [currentPolyline, currentDistanceMeters, currentDurationSeconds, jobId]
                );

                // Cache coordinates and time of Directions query
                await redis.set(`job:${jobId}:last_directions_time`, nowMs);
                await redis.set(`job:${jobId}:last_directions_lat`, lat);
                await redis.set(`job:${jobId}:last_directions_lng`, lng);
            } catch (err) {
                console.error("⚠️ [syncWorkerLocation] Directions recalculation failed:", err.message);
            }
        }

        // Route deviation check
        try {
            const deviationResult = await routeDeviationService.checkDeviation(jobId, worker.id, lat, lng);
            if (deviationResult && deviationResult.isDeviating) {
                updatePayload.routeDeviation = deviationResult;
            }
        } catch (devErr) {
            // Non-critical
        }

        // Formatted strings
        const km = (currentDistanceMeters || 0) / 1000;
        const formattedDistance = km < 1 ? `${Math.round(currentDistanceMeters || 0)}m` : `${km.toFixed(1)} km`;
        const formattedEta = `${Math.round((currentDurationSeconds || 0) / 60)} mins`;

        const updatePayload = {
            jobId,
            job_id: jobId,
            lat,
            lng,
            distance: formattedDistance,
            eta: formattedEta,
            polyline: currentPolyline,
            distanceMeters: currentDistanceMeters,
            duration: currentDurationSeconds,
            speedKmh
        };

        // Broadcast to rooms
        const { getIO } = require('../config/socket');
        const io = getIO();
        if (io) {
            io.to(`job:${jobId}`).emit('worker_location_update', updatePayload);
            io.to(`user:${job.user_id}`).emit('worker_location_update', updatePayload);
            io.to(`worker:${worker.id}`).emit('worker_location_update', updatePayload);
            io.to(`worker:${worker.phone_number}`).emit('worker_location_update', updatePayload);
        }
    }
}

// Polyline and route deviation helper functions
function decodePolyline(str) {
    let index = 0, len = str.length;
    let lat = 0, lng = 0;
    let coordinates = [];
    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        coordinates.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return coordinates;
}

function detectRouteDeviation(workerLat, workerLng, polylineStr) {
    if (!polylineStr) return false;
    const points = decodePolyline(polylineStr);
    if (points.length === 0) return false;
    
    let minDistance = Infinity;
    for (const point of points) {
        const R = 6371e3; // meters
        const phi1 = workerLat * Math.PI / 180;
        const phi2 = point.latitude * Math.PI / 180;
        const deltaPhi = (point.latitude - workerLat) * Math.PI / 180;
        const deltaLambda = (point.longitude - workerLng) * Math.PI / 180;

        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const dist = R * c;

        if (dist < minDistance) {
            minDistance = dist;
        }
    }
    return minDistance > 100;
}

module.exports = new ExecutionService();
