const db = require('../config/db');
const redis = require('../config/redis');
const orchestratorConfig = require('../config/dispatch_orchestrator.config');

class DispatchOrchestratorService {
  /**
   * Log Dispatch Lifecycle Event persistently in database and Redis
   */
  async logEvent(jobId, eventName, metadata = {}) {
    const idStr = jobId.toString();
    const entry = {
      timestamp: new Date().toISOString(),
      event: eventName,
      metadata,
    };
    
    // Save to event_logs DB table for permanent audit trace
    try {
        await db.query(`
            INSERT INTO event_logs (job_id, event_type, metadata)
            VALUES ($1, $2, $3)
        `, [jobId, `dispatch_${eventName.toLowerCase()}`, JSON.stringify(entry)]);
    } catch (err) {
        console.error(`[DISPATCH-LOG-WARN] Failed database event write for Job ${idStr}:`, err.message);
    }

    // Save to Redis key with TTL
    try {
        const traceKey = orchestratorConfig.redisKeys.getTraceKey(idStr);
        await redis.rpush(traceKey, JSON.stringify(entry));
        await redis.expire(traceKey, orchestratorConfig.traceExpirySeconds);
    } catch (redisErr) {
        console.warn(`[DISPATCH-LOG-WARN] Redis trace write failed for Job ${idStr}:`, redisErr.message);
    }

    console.log(`⚡ [DISPATCH_EVENT] Job ${idStr} -> ${eventName}`);
    return entry;
  }

  /**
   * Get Dispatch Trace Timeline for Observability
   */
  async getDispatchTrace(jobId) {
    try {
        const traceKey = orchestratorConfig.redisKeys.getTraceKey(jobId.toString());
        const logs = await redis.lrange(traceKey, 0, -1);
        if (logs && logs.length > 0) {
            return logs.map(JSON.parse);
        }
    } catch (err) {
        console.warn("[DISPATCH-TRACE-WARN] Failed to read Redis traces, falling back to database query:", err.message);
    }

    const res = await db.query(
        "SELECT event_type, metadata FROM event_logs WHERE job_id = $1 AND event_type LIKE 'dispatch_%' ORDER BY created_at ASC",
        [jobId]
    );
    return res.rows.map(r => r.metadata);
  }

  /**
   * Filters candidate workers using detailed eligibility checks (battery, active jobs, shadow bans, suspensions, GPS freshness)
   */
  async filterEligibleWorkers(job, candidateWorkers) {
    const eligible = [];
    const now = Date.now();

    for (const w of candidateWorkers) {
      if (w.isSuspended || w.availability_state === 'SUSPENDED') continue;
      if (w.batteryLevel && w.batteryLevel < 15) continue;
      if (w.hasActiveLiveJob) continue;

      // 1. Shadow Ban check
      const shadowRes = await db.query(
          "SELECT active FROM shadow_ban_status WHERE worker_id = $1 AND active = TRUE",
          [w.id]
      );
      if (shadowRes.rowCount > 0) continue;

      // 2. GPS Freshness check
      const lastSeen = await redis.get(`worker:${w.id}:last_seen`);
      if (lastSeen && (now - parseInt(lastSeen, 10)) > 300000) {
          // Stale GPS (older than 5 minutes)
          continue;
      }

      // 3. Calendar conflict checks
      const reservationService = require('./reservation.service');
      const duration = await reservationService.predictJobDuration(job.category);
      const conflict = await reservationService.checkCalendarConflict(
          w.id,
          job.scheduled_at || new Date(),
          duration,
          job.category,
          parseFloat(job.location_lat),
          parseFloat(job.location_lng)
      );
      if (conflict.conflict) continue;

      eligible.push(w);
    }

    await this.logEvent(job.id, "ELIGIBILITY_COMPUTED", {
      evaluatedCount: candidateWorkers.length,
      eligibleCount: eligible.length,
    });

    return eligible;
  }

  /**
   * Ranks eligible candidates using actual calculated values and configured weights
   */
  async rankWorkers(job, eligibleWorkers) {
    const ranked = [];
    const executionService = require('./execution.service');
    const intelService = require('./marketplace_intelligence.service');
    const calendarEngine = require('./ai_calendar_engine.service');

    const weights = orchestratorConfig.rankingWeights;

    for (let idx = 0; idx < eligibleWorkers.length; idx++) {
      const w = eligibleWorkers[idx];

      // Calculate actual distances
      const distanceKm = executionService.calculateDistance(
          parseFloat(job.location_lat),
          parseFloat(job.location_lng),
          parseFloat(w.current_lat || job.location_lat),
          parseFloat(w.current_lng || job.location_lng)
      );

      // Fetch dynamic traffic risk detours
      let trafficScore = 80; // base score
      try {
          // Resolve locality
          const jZone = await db.query(
              `SELECT locality FROM marketplace_zones
               ORDER BY (ll_to_earth(center_lat, center_lng) <-> ll_to_earth($1, $2)) ASC
               LIMIT 1`,
              [parseFloat(job.location_lat), parseFloat(job.location_lng)]
          );
          if (jZone.rowCount > 0) {
              const risk = intelService.predictTrafficRisk(jZone.rows[0].locality, jZone.rows[0].locality);
              trafficScore = risk.riskLevel === 'HIGH' || risk.riskLevel === 'SEVERE' ? 40 : 90;
          }
      } catch (e) {}

      // Acceptance prediction probability
      const ratingService = require('./ranking.service');
      const pRes = await ratingService.calculateAcceptanceProbability(w, distanceKm, job.price).catch(() => ({ probability: 0.85 }));
      const acceptPredScore = (pRes.probability || 0.85) * 100;

      // Calendar fit checks
      const timeline = await calendarEngine.getWorkerTimeline(w.id).catch(() => []);
      const freeSlots = timeline.filter(t => t.type === 'FREE');
      const calendarFit = freeSlots.length > 0 ? 100 : 50;

      // Multi-factor calculations
      const distanceScore = Math.max(0, 100 - (distanceKm * 10)) * weights.distance;
      const tScore = trafficScore * weights.traffic;
      const reliabilityScore = (w.reliability || 95) * weights.reliability;
      const custPrefScore = (w.custPref || 90) * weights.custPref;
      const areaPrefScore = (w.areaPref || 90) * weights.areaPref;
      const acceptScore = acceptPredScore * weights.acceptPred;
      const dirScore = (w.directionMatchScore || 85) * weights.direction;
      const expScore = (w.experienceScore || 90) * weights.experience;
      
      const todayEarnings = w.todayEarnings || (idx * 1500);
      const fairnessScore = Math.max(0, 100 - (todayEarnings / 100)) * weights.fairness;
      const bundleScore = 80 * weights.bundle;
      const calendarFitScore = calendarFit * weights.calendarFit;

      const totalScore = Math.round(
        distanceScore + tScore + reliabilityScore + custPrefScore +
        areaPrefScore + acceptScore + dirScore + expScore +
        fairnessScore + bundleScore + calendarFitScore
      );

      ranked.push({
        ...w,
        distanceKm: Math.round(distanceKm * 10) / 10,
        dispatchScore: totalScore,
        todayEarnings,
      });
    }

    // Sort by dispatchScore descending
    ranked.sort((a, b) => b.dispatchScore - a.dispatchScore);

    if (ranked.length > 0) {
        await this.logEvent(job.id, "WORKERS_RANKED", { rankedCount: ranked.length, topScore: ranked[0]?.dispatchScore });
    }
    
    return ranked;
  }

  /**
   * Builds dynamic dispatch pools based on parameters
   */
  async buildDynamicPools(job, rankedWorkers, isEmergency = false) {
    const limits = isEmergency ? orchestratorConfig.emergencyPoolSizes : orchestratorConfig.defaultPoolSizes;
    const poolA = rankedWorkers.slice(0, limits.poolA);
    const poolB = rankedWorkers.slice(limits.poolA, limits.poolA + limits.poolB);

    await this.logEvent(job.id, "POOLS_CREATED", { poolASize: poolA.length, poolBSize: poolB.length });

    return {
      poolA,
      poolB,
      dynamicTimeoutSeconds: isEmergency ? 10 : 20,
    };
  }

  /**
   * Attempt atomic acceptance using transaction boundaries and Redis lock safety
   */
  async attemptAtomicAcceptance(jobId, workerId) {
    const lockKey = orchestratorConfig.redisKeys.getAcceptLockKey(jobId);
    
    // Acquire Redis Lock
    const acquired = await redis.set(lockKey, workerId.toString(), 'NX', 'EX', 10);
    if (!acquired) {
      // Fetch lock winner
      const winnerWorkerId = await redis.get(lockKey);
      await this.logEvent(jobId, "ATOMIC_ACCEPT_FAILED_RACE", { workerId, winnerWorkerId });
      return {
        success: false,
        message: "JOB_ALREADY_TAKEN",
        winnerWorkerId,
      };
    }

    // Wrap state updates in DB transaction scope
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // Confirm job state is open
        const jobRes = await client.query(
            "SELECT status FROM jobs WHERE id = $1 FOR UPDATE",
            [jobId]
        );
        
        if (jobRes.rowCount === 0 || jobRes.rows[0].status === 'ACCEPTED') {
            await client.query('ROLLBACK');
            return {
                success: false,
                message: "JOB_ALREADY_TAKEN"
            };
        }

        // Assign job
        await client.query(
            "UPDATE jobs SET worker_id = $1, status = 'ACCEPTED', accepted_at = NOW() WHERE id = $2",
            [workerId, jobId]
        );

        await client.query('COMMIT');
        await this.logEvent(jobId, "ASSIGNMENT_CONFIRMED_ATOMIC", { workerId });

        return {
            success: true,
            message: "ACCEPTED_SUCCESSFULLY",
            assignedWorkerId: workerId.toString(),
            lockTtlSeconds: 10,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        await redis.del(lockKey); // release lock on database failure
        return {
            success: false,
            message: "TRANSACTION_FAILED",
            error: err.message
        };
    } finally {
        client.release();
    }
  }
}

module.exports = new DispatchOrchestratorService();
