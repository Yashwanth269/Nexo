const db = require('../config/db');
const redis = require('../config/redis');
const https = require('https');
const http = require('http');
const routeDeviationService = require('./route_deviation.service');
const backupWorkerService = require('./backup_worker.service');
const executionConfig = require('../config/execution.config');

async function callMLService(endpoint, bodyData) {
    const body = JSON.stringify(bodyData);
    let attempts = 0;
    const maxRetries = executionConfig.mlMaxRetries;
    const timeout = executionConfig.mlTimeoutMs;

    while (attempts < maxRetries) {
        attempts++;
        try {
            return await new Promise((resolve, reject) => {
                const urlObj = new URL(`${executionConfig.mlServiceUrl}${endpoint}`);
                const transport = urlObj.protocol === 'https:' ? https : http;
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                    timeout,
                };
                const req = transport.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { reject(new Error("Invalid JSON response from ML")); }
                    });
                });
                req.on('error', (err) => reject(err));
                req.on('timeout', () => { req.destroy(); reject(new Error("Timeout")); });
                req.write(body);
                req.end();
            });
        } catch (err) {
            console.warn(`[EXECUTION-ML-CLIENT-WARN] Attempt ${attempts} failed: ${err.message}`);
            if (attempts >= maxRetries) {
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempts)));
        }
    }
}

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
     * Keeps non-critical notifications, cache writes, and event publishes outside the DB transaction.
     */
    async transitionStatus(jobId, workerId, newStatus, metadata = {}) {
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) {
            return { success: false, error: "Worker not found in database" };
        }

        // 1. Run external ML Checks BEFORE starting the DB transaction (avoids holding locks during HTTP calls)
        let gpsCheck = { gpsTrustScore: 100, alerts: [], isSuspicious: false };
        try {
            gpsCheck = await this._checkGpsSpoof({
                lat: metadata.lat || 0,
                lng: metadata.lng || 0,
                prevLat: metadata.prevLat || null,
                prevLng: metadata.prevLng || null,
                mockLocation: metadata.isMocked === true || metadata.mockLocation === true,
                gpsAccuracy: metadata.gpsAccuracy || 10,
                headingChange: metadata.headingChange || 0,
                signalStrength: metadata.signalStrength || -70,
            });
        } catch (err) {
            console.warn("[EXECUTION-GPS-ML-WARN] GPS Check fallback to heuristics:", err.message);
        }

        const client = await db.pool.connect();
        let userToNotify = null;
        let jobCategory = '';
        let originalLat = 0;
        let originalLng = 0;
        let distanceMeters = null;

        try {
            await client.query('BEGIN');

            const jobResult = await client.query(
                "SELECT status, location_lat, location_lng, scheduled_at, user_id, category FROM jobs WHERE id = $1::uuid AND worker_id = $2::uuid FOR UPDATE",
                [jobId, worker.id]
            );

            if (jobResult.rowCount === 0) throw new Error("Job not found or worker unauthorized");
            
            const currentStatus = jobResult.rows[0].status;
            userToNotify = jobResult.rows[0].user_id;
            jobCategory = jobResult.rows[0].category;
            originalLat = jobResult.rows[0].location_lat;
            originalLng = jobResult.rows[0].location_lng;
            
            const jobStateMachine = require('./job_state_machine.service');
            if (!jobStateMachine.isValidTransition(currentStatus, newStatus)) {
                throw new Error(`Invalid transition: ${currentStatus} -> ${newStatus}`);
            }

            const gpsScore = gpsCheck.gpsTrustScore;
            let gpsStatus = 'SAFE';
            if (gpsScore < executionConfig.gpsTrustThresholds.fraudAlert) gpsStatus = 'FRAUD_ALERT';
            else if (gpsScore < executionConfig.gpsTrustThresholds.suspicious) gpsStatus = 'SUSPICIOUS';
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

            const ruleBasedSuspicious = gpsCheck.alerts && gpsCheck.alerts.length > 0;
            if (ruleBasedSuspicious) {
                await client.query(
                    "INSERT INTO event_logs (job_id, worker_id, event_type, metadata) VALUES ($1, $2, $3, $4)",
                    [jobId, worker.id, 'GPS_SPOOFING_DETECTED', JSON.stringify({ ...gpsCheck, timestamp: new Date() })]
                );
                await client.query(
                    "UPDATE workers SET rating = GREATEST(1.0, rating - 0.1) WHERE id = $1",
                    [worker.id]
                );
            }

            if (newStatus === 'ARRIVED' || newStatus === 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
                const { lat, lng } = metadata;
                if (!lat || !lng) {
                    throw new Error("GPS coordinates are required to mark arrival");
                }
                const distanceKm = this.calculateDistance(lat, lng, originalLat, originalLng);
                distanceMeters = Math.round(distanceKm * 1000);

                const lowSpeedSince = await redis.get(`worker:${worker.id}:low_speed_since`);
                const isStationary = (metadata.isMocked === true) || (metadata.customerConfirmed === true) || 
                                     (lowSpeedSince && (Date.now() - parseInt(lowSpeedSince) >= executionConfig.stationaryDurationSeconds * 1000));

                if (newStatus === 'ARRIVED') {
                    if (distanceMeters > executionConfig.arrivalRadiusMeters || !isStationary) {
                        if (metadata.force === true) {
                            newStatus = 'FORCE_ARRIVAL_PENDING_CONFIRMATION';
                        } else {
                            const detailErr = distanceMeters > executionConfig.arrivalRadiusMeters ? "TOO_FAR" : "SPEED_NOT_STATIONARY";
                            await client.query('ROLLBACK');
                            return { 
                                success: false, 
                                error: detailErr, 
                                message: distanceMeters > executionConfig.arrivalRadiusMeters ? 
                                    "You are too far from the destination." : 
                                    `You must remain stationary near destination for ${executionConfig.stationaryDurationSeconds} seconds before marking arrival.`,
                                distance: distanceMeters 
                            };
                        }
                    }
                }
            }

            await jobStateMachine.transition(jobId, newStatus, {
                workerId: worker.id,
                userId: userToNotify,
                client,
                metadata
            });

            if (newStatus === 'COMPLETED') {
                const paymentMethod = (metadata.paymentMethod || 'ONLINE').toUpperCase();
                await client.query(
                    "UPDATE jobs SET payment_method = $1 WHERE id = $2",
                    [paymentMethod, jobId]
                );
                await client.query(
                    "UPDATE workers SET availability_state = 'AVAILABLE' WHERE id = $1",
                    [worker.id]
                );
                await client.query(
                    "UPDATE worker_calendar SET status = 'COMPLETED' WHERE booking_id = $1 AND worker_id = $2",
                    [jobId, worker.id]
                );
            }

            await client.query(
                "INSERT INTO event_logs (job_id, worker_id, event_type, metadata) VALUES ($1, $2, $3, $4)",
                [jobId, worker.id, `status_change_${newStatus}`, JSON.stringify({ ...metadata, distanceMeters })]
            );

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            return { success: false, error: error.message };
        } finally {
            client.release();
        }

        // 2. Execute POST-COMMIT non-blocking tasks outside transaction (saves database locks)
        if (newStatus === 'COMPLETED') {
            try {
                const { invalidateAllHomeServicesCaches } = require('../routes/home.routes');
                await invalidateAllHomeServicesCaches().catch(() => {});
                
                const feedService = require('./feed.service');
                await feedService.invalidateFeedCache(originalLat, originalLng).catch(() => {});
                await feedService.createOrUpdateCompletedPost(jobId).catch(() => {});
                
                const eventStream = require('../utils/event_stream');
                await eventStream.publish('job_completed', {
                    jobId,
                    workerId: worker.id,
                    lat: originalLat,
                    lng: originalLng,
                    category: jobCategory,
                    userId: userToNotify
                });

                const matchingService = require('./matching.service');
                matchingService.logDispatchEvent(jobId, 'job_completed', { workerId: worker.id }).catch(() => {});

                await db.query(
                    "UPDATE search_analytics_logs SET is_completed = true WHERE job_id = $1",
                    [jobId]
                ).catch(() => {});
            } catch (postErr) {
                console.error("⚠️ [EXECUTION] Post-commit completion tasks failed:", postErr.message);
            }
        }

        // Update Redis status cache
        await redis.set(`job:${jobId}:status`, newStatus, 'EX', 3600).catch(() => {});

        // Broadcast Status Change
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`user:${userToNotify}`).emit('job_status_updated', {
                    jobId,
                    status: newStatus,
                    metadata: { ...metadata, distanceMeters }
                });
                io.to(`job:${jobId}`).emit('job_status_updated', {
                    jobId,
                    status: newStatus,
                    metadata: { ...metadata, distanceMeters }
                });
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

                if (newStatus === 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
                    const forcePayload = {
                        jobId,
                        workerId: worker.id,
                        distance: distanceMeters,
                        message: "The worker marked arrival but appears away from your location."
                    };
                    io.to(`user:${userToNotify}`).emit('WORKER_FORCE_MARKED_ARRIVAL', forcePayload);
                    io.to(`job:${jobId}`).emit('WORKER_FORCE_MARKED_ARRIVAL', forcePayload);
                }
            }
        } catch (socketErr) {
            console.warn("[EXECUTION-SOCKET-WARN] Broadcast failed:", socketErr.message);
        }

        return { success: true, status: newStatus };
    }

    async _checkGpsSpoof(params) {
        try {
            const response = await callMLService('/predict/gps-spoof', {
                lat: params.lat,
                lng: params.lng,
                prev_lat: params.prevLat,
                prev_lng: params.prevLng,
                mock_location: params.mockLocation,
                gps_accuracy: params.gpsAccuracy,
                heading_change: params.headingChange,
                signal_strength: params.signalStrength,
            });
            
            let finalScore = response.gps_trust_score || 100;
            let finalAlerts = response.alerts || [];
            let finalSuspicious = response.is_suspicious || false;

            if (params.mockLocation) {
                finalScore = Math.min(finalScore, 30);
                if (!finalAlerts.includes('MOCK_LOCATION_DETECTED')) {
                    finalAlerts.push('MOCK_LOCATION_DETECTED');
                }
                finalSuspicious = true;
            }

            return {
                gpsTrustScore: finalScore,
                alerts: finalAlerts,
                isSuspicious: finalSuspicious,
                mlScore: response.ml_score,
                ruleScore: response.rule_score || (params.mockLocation ? 30 : 100),
            };
        } catch {
            return {
                gpsTrustScore: params.mockLocation ? 30 : 100,
                alerts: params.mockLocation ? ['MOCK_LOCATION_DETECTED'] : [],
                isSuspicious: params.mockLocation ? true : false
            };
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
     * ETA Prediction using directions and ML client fallbacks
     */
    async predictETA(workerLat, workerLng, jobLat, jobLng, workerId = null, jobId = null, category = null) {
        const { getDirections } = require('../utils/google_maps');
        try {
            const directions = await getDirections(workerLat, workerLng, jobLat, jobLng);
            const distanceKm = (directions.distanceMeters / 1000).toFixed(2);
            const etaMins = Math.round(directions.durationSeconds / 60);

            try {
                const hour = new Date().getHours();
                const catMap = {
                    "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2, "PAINTING": 3,
                    "CARPENTRY": 4, "MOVING": 5, "GARDENING": 6, "APPLIANCE_REPAIR": 7,
                    "IT_SUPPORT": 8, "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
                    "DELIVERY": 12, "OTHER": 13
                };
                const mlResponse = await callMLService('/predict/eta', {
                    features: {
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
                    }
                });

                if (mlResponse && mlResponse.predicted_eta_minutes) {
                    console.log(`[SHADOW-ETA] Google=${etaMins}min, ML=${mlResponse.predicted_eta_minutes.toFixed(1)}min, distance=${distanceKm}km`);
                }
            } catch (mlErr) {}

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
     * Updates worker location during an active job.
     * Fixes ReferenceError by loading active accepted jobs BEFORE logging GPS traces.
     */
    async syncWorkerLocation(workerId, lat, lng, metadata = {}) {
        const matchingService = require('./matching.service');
        const worker = await matchingService.resolveWorker(workerId);
        if (!worker) return;

        const nowMs = Date.now();
        
        // 1. Retrieve last GPS position for speed tracking
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
        
        // Track stationary time
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

        // 2. Find active accepted job FIRST (fixes ReferenceError where jobId was undefined)
        const jobRes = await db.query(
            `SELECT id, user_id, location_lat, location_lng, status, route_polyline, route_distance, route_duration 
             FROM jobs 
             WHERE worker_id = $1 
             AND status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'FORCE_ARRIVAL_PENDING_CONFIRMATION')
             LIMIT 1`,
            [worker.id]
        );

        const activeJob = jobRes.rows[0] || null;
        const jobId = activeJob ? activeJob.id : null;

        // 3. Log GPS trace safely
        try {
            await db.query(
                `INSERT INTO gps_traces (worker_id, job_id, lat, lng, speed_kmh, accuracy_m, mock_location, heading, recorded_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                [worker.id, jobId, lat, lng, Math.round(speedKmh * 100) / 100,
                 metadata.gpsAccuracy || 10, metadata.isMocked === true || metadata.mockLocation === true || false,
                 metadata.heading || 0]
            );
        } catch (e) {
            // Safe logging fallback
        }

        if (!activeJob) return;

        // Throttling Directions recalculations
        const lastDirectionsTime = await redis.get(`job:${jobId}:last_directions_time`);
        const lastDirectionsLat = await redis.get(`job:${jobId}:last_directions_lat`);
        const lastDirectionsLng = await redis.get(`job:${jobId}:last_directions_lng`);

        let shouldRefresh = false;
        let timeElapsed = lastDirectionsTime ? (nowMs - parseInt(lastDirectionsTime)) / 1000 : Infinity;
        let distanceMoved = (lastDirectionsLat && lastDirectionsLng) ? 
            this.calculateDistance(lat, lng, parseFloat(lastDirectionsLat), parseFloat(lastDirectionsLng)) * 1000 : Infinity;

        let routeDeviationDetected = false;
        if (activeJob.route_polyline) {
            routeDeviationDetected = detectRouteDeviation(lat, lng, activeJob.route_polyline);
        }

        if (!lastDirectionsTime) {
            shouldRefresh = true;
        } else if (timeElapsed >= executionConfig.directionsCacheTtlSeconds) {
            if (timeElapsed >= 60 || distanceMoved > executionConfig.directionsRefreshMinDistanceMeters || routeDeviationDetected) {
                shouldRefresh = true;
            }
        }

        let currentPolyline = activeJob.route_polyline;
        let currentDistanceMeters = activeJob.route_distance;
        let currentDurationSeconds = activeJob.route_duration;

        if (shouldRefresh) {
            const { getDirections } = require('../utils/google_maps');
            try {
                const directions = await getDirections(
                    lat, lng, 
                    parseFloat(activeJob.location_lat), 
                    parseFloat(activeJob.location_lng)
                );
                currentPolyline = directions.polyline;
                currentDistanceMeters = directions.distanceMeters;
                currentDurationSeconds = directions.durationSeconds;

                await db.query(
                    "UPDATE jobs SET route_polyline = $1, route_distance = $2, route_duration = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
                    [currentPolyline, currentDistanceMeters, currentDurationSeconds, jobId]
                );

                await redis.set(`job:${jobId}:last_directions_time`, nowMs);
                await redis.set(`job:${jobId}:last_directions_lat`, lat);
                await redis.set(`job:${jobId}:last_directions_lng`, lng);
            } catch (err) {
                console.error("⚠️ [syncWorkerLocation] Directions recalculation failed:", err.message);
            }
        }

        let updatePayload = {
            jobId,
            job_id: jobId,
            lat,
            lng,
            distance: (currentDistanceMeters || 0) / 1000 < 1 ? `${Math.round(currentDistanceMeters || 0)}m` : `${((currentDistanceMeters || 0) / 1000).toFixed(1)} km`,
            eta: `${Math.round((currentDurationSeconds || 0) / 60)} mins`,
            polyline: currentPolyline,
            distanceMeters: currentDistanceMeters,
            duration: currentDurationSeconds,
            speedKmh
        };

        // Route deviation check
        try {
            const deviationResult = await routeDeviationService.checkDeviation(jobId, worker.id, lat, lng);
            if (deviationResult && deviationResult.isDeviating) {
                updatePayload.routeDeviation = deviationResult;
            }
        } catch (devErr) {}

        // Broadcast to rooms
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`job:${jobId}`).emit('worker_location_update', updatePayload);
                io.to(`user:${activeJob.user_id}`).emit('worker_location_update', updatePayload);
                io.to(`worker:${worker.id}`).emit('worker_location_update', updatePayload);
                io.to(`worker:${worker.phone_number}`).emit('worker_location_update', updatePayload);
            }
        } catch (err) {}
    }

    /**
     * Customer Unreachable Wait Timer (10 minutes)
     */
    async startUnreachableTimer(jobId, workerId) {
        const arrivalKey = `job:${jobId}:arrived_at`;
        let arrivedAt = await redis.get(arrivalKey).catch(() => null);

        if (!arrivedAt) {
            const jobRes = await db.query("SELECT arrived_at FROM jobs WHERE id = $1 AND worker_id = $2", [jobId, workerId]);
            if (jobRes.rowCount === 0 || !jobRes.rows[0].arrived_at) {
                return { success: false, message: "WORKER_NOT_ARRIVED" };
            }
            arrivedAt = new Date(jobRes.rows[0].arrived_at).getTime();
        } else {
            arrivedAt = parseInt(arrivedAt, 10);
        }

        const elapsedMins = (Date.now() - arrivedAt) / 60000.0;
        const requiredWaitMins = parseInt(process.env.CUSTOMER_UNREACHABLE_WAIT_MIN || '10', 10);

        if (elapsedMins < requiredWaitMins) {
            const remainingSecs = Math.round((requiredWaitMins * 60) - (elapsedMins * 60));
            return {
                success: false,
                canCancelWithCompensation: false,
                remainingSeconds: remainingSecs,
                message: `Please wait ${Math.ceil(remainingSecs / 60)} more minute(s) before cancelling with base fee compensation.`
            };
        }

        return {
            success: true,
            canCancelWithCompensation: true,
            elapsedMinutes: Math.round(elapsedMins),
            message: "10-minute wait threshold reached. You can now cancel with base fee compensation."
        };
    }
}

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
        const R = 6371e3;
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
