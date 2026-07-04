const redis = require('../config/redis');
const db = require('../config/db');
const jobService = require('./job.service');

class MonitoringService {
    async recordHeartbeat(workerId, jobId) {
        const key = `heartbeat:worker:${workerId}`;
        await redis.setex(key, 60, JSON.stringify({
            workerId,
            jobId,
            timestamp: Date.now()
        }));
    }

    async monitorActiveJobs() {
        // This would run in a worker process or a setInterval
        const activeJobs = await db.query(
            "SELECT id, worker_id, status FROM jobs WHERE status IN ('ACCEPTED', 'STARTED')"
        );

        for (const job of activeJobs.rows) {
            const heartbeatData = await redis.get(`heartbeat:worker:${job.worker_id}`);
            
            if (!heartbeatData) {
                console.log(`⚠️ [MONITOR] Worker #${job.worker_id} offline for Job #${job.id}`);
                await this.handleWorkerOffline(job);
            } else {
                const { timestamp } = JSON.parse(heartbeatData);
                const secondsOffline = (Date.now() - timestamp) / 1000;

                if (secondsOffline > 30) {
                    console.log(`🚨 [CRITICAL] Worker #${job.worker_id} heartbeat timeout (${secondsOffline}s)`);
                    await this.handleWorkerOffline(job);
                }
            }
        }
    }

    async handleWorkerOffline(job) {
        // Graceful Recovery Check
        const failureCountKey = `job:${job.id}:failure_count`;
        const failures = await redis.incr(failureCountKey);
        await redis.expire(failureCountKey, 300);

        if (failures >= 3) {
            // Terminal Failure: Reassign Job
            console.log(`💀 [FAILURE] Job #${job.id} terminal disconnect. Reassigning...`);
            
            const { getIO } = require('../config/socket');
            
            const io = getIO();
            io.to(`job:${job.id}`).emit('worker_disconnected_permanently', { jobId: job.id });

            // Atomic Drop and re-dispatch
            await jobService.dropJob(job.id, job.worker_id, 'SYSTEM_TIMEOUT');
            
            await redis.del(failureCountKey);
        } else {
            // Temporary Fluctuation: Warn User
            const { getIO } = require('../config/socket');
            const io = getIO();
            io.to(`job:${job.id}`).emit('worker_unstable_connection', { jobId: job.id });
        }
    }
}

module.exports = new MonitoringService();
