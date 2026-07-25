const redis = require('../config/redis');
const db = require('../config/db');
const jobService = require('./job.service');

class MonitoringService {
    /**
     * Records heartbeat containing rich client device state indicators.
     * Returns the dynamic next-heartbeat-interval recommendation.
     */
    async recordHeartbeat(workerId, jobId = null, metadata = {}) {
        const key = `heartbeat:worker:${workerId}`;
        const timestamp = Date.now();
        
        // 1. Rich Heartbeat Metadata (Point 3)
        const payload = {
            workerId,
            jobId,
            timestamp,
            battery: metadata.battery !== undefined ? parseFloat(metadata.battery) : 100,
            gpsQuality: metadata.gpsQuality || 'EXCELLENT',
            networkType: metadata.networkType || 'WIFI',
            appState: metadata.appState || 'FOREGROUND',
            appVersion: metadata.appVersion || '1.0.0'
        };

        // Cache heartbeat details in Redis
        await redis.setex(key, 60, JSON.stringify(payload));

        // 2. Adaptive Heartbeat Frequency: 15s if actively working a job, 60s if idle (Point 1)
        const nextIntervalSeconds = jobId ? 15 : 60;
        return {
            success: true,
            nextIntervalSeconds
        };
    }

    /**
     * Periodically monitors active jobs, checking heartbeat staleness.
     * Incorporates session resume grace periods and zone failure metrics.
     */
    async monitorActiveJobs() {
        const activeJobs = await db.query(
            "SELECT id, worker_id, status, category, location_lat, location_lng FROM jobs WHERE status IN ('ACCEPTED', 'STARTED')"
        );

        for (const job of activeJobs.rows) {
            const heartbeatData = await redis.get(`heartbeat:worker:${job.worker_id}`);
            
            if (!heartbeatData) {
                console.log(`⚠️ [MONITOR] Worker #${job.worker_id} offline for Job #${job.id}`);
                await this.handleWorkerOffline(job);
            } else {
                const { timestamp } = JSON.parse(heartbeatData);
                const secondsOffline = (Date.now() - timestamp) / 1000;

                // Adaptive timeout thresholds based on activity
                const timeoutThreshold = job.status === 'STARTED' ? 30 : 45;

                if (secondsOffline > timeoutThreshold) {
                    console.log(`🚨 [CRITICAL] Worker #${job.worker_id} heartbeat timeout (${secondsOffline}s)`);
                    await this.handleWorkerOffline(job);
                }
            }
        }
    }

    async handleWorkerOffline(job) {
        const failureCountKey = `job:${job.id}:failure_count`;
        const failures = await redis.incr(failureCountKey);
        await redis.expire(failureCountKey, 300);

        // 3. session resume allowance window (Warn customer first, don't drop instantly)
        if (failures >= 3) {
            // Terminal Failure: Reassign Job
            console.log(`💀 [FAILURE] Job #${job.id} terminal disconnect. Reassigning...`);
            
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`job:${job.id}`).emit('worker_disconnected_permanently', { jobId: job.id });
            }

            // Log regional disconnection failure metrics to DB (Point 5)
            await this.logRegionalFailure(job, 'TIMEOUT_DISCONNECT');

            // Atomic Drop and re-dispatch
            await jobService.dropJob(job.id, job.worker_id, 'SYSTEM_TIMEOUT');
            await redis.del(failureCountKey);
        } else {
            // Temporary Fluctuation: Warn User and allow session reconnect (Point 4)
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`job:${job.id}`).emit('worker_unstable_connection', { 
                    jobId: job.id, 
                    reconnectGraceSeconds: 30 
                });
            }
        }
    }

    async logRegionalFailure(job, failureType) {
        try {
            // Fetch nearest marketplace zone based on coordinates
            const zoneRes = await db.query(`
                SELECT id, zone_name, locality 
                FROM marketplace_zones
                ORDER BY ll_to_earth(center_lat, center_lng) <-> ll_to_earth($1, $2)
                LIMIT 1
            `, [parseFloat(job.location_lat || 12.9716), parseFloat(job.location_lng || 77.5946)]);

            const zoneId = zoneRes.rows[0]?.id || null;
            const zoneName = zoneRes.rows[0]?.locality || 'Unknown';

            await db.query(`
                CREATE TABLE IF NOT EXISTS regional_monitoring_failures (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    zone_id UUID,
                    zone_name VARCHAR(100),
                    job_id UUID,
                    failure_type VARCHAR(50),
                    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await db.query(`
                INSERT INTO regional_monitoring_failures (zone_id, zone_name, job_id, failure_type)
                VALUES ($1, $2, $3, $4)
            `, [zoneId, zoneName, job.id, failureType]);

            console.log(`📊 [MONITOR-METRIC] Regional failure logged for zone ${zoneName} (${failureType})`);
        } catch (e) {
            // Suppress non-critical metrics failure
        }
    }
}

module.exports = new MonitoringService();
