const db = require('../config/db');

// In-memory Redis mock for atomic SETNX acceptance locks: jobId -> assignedWorkerId
const atomicJobLocks = new Map();
const dispatchTraceLogs = new Map(); // jobId -> trace timeline array

class DispatchOrchestratorService {
  /**
   * Log Dispatch Lifecycle Event (Chapter 23 & 33)
   */
  logEvent(jobId, eventName, metadata = {}) {
    const idStr = jobId.toString();
    if (!dispatchTraceLogs.has(idStr)) {
      dispatchTraceLogs.set(idStr, []);
    }
    const trace = dispatchTraceLogs.get(idStr);
    const entry = {
      timestamp: new Date().toISOString(),
      event: eventName,
      metadata,
    };
    trace.push(entry);
    console.log(`⚡ [DISPATCH_EVENT] Job ${idStr} -> ${eventName}`);
    return entry;
  }

  /**
   * Get Dispatch Trace Timeline for Observability (Chapter 33)
   */
  getDispatchTrace(jobId) {
    return dispatchTraceLogs.get(jobId.toString()) || [];
  }

  /**
   * Chapter 24 — Eligibility Engine
   * Filters thousands of workers down to eligible candidates
   */
  filterEligibleWorkers(job, candidateWorkers) {
    const eligible = candidateWorkers.filter(w => {
      if (w.isSuspended) return false;
      if (w.batteryLevel && w.batteryLevel < 15) return false;
      if (w.hasActiveLiveJob) return false;
      return true;
    });

    this.logEvent(job.id, "ELIGIBILITY_COMPUTED", {
      evaluatedCount: candidateWorkers.length,
      eligibleCount: eligible.length,
    });

    return eligible;
  }

  /**
   * Chapter 25 — 12-Factor Ranking Engine
   */
  rankWorkers(job, eligibleWorkers) {
    const ranked = eligibleWorkers.map((w, idx) => {
      const distanceKm = Math.round((1.5 + (idx * 0.7)) * 10) / 10;

      // 12-Factor Composite Score Formula
      const distanceScore = Math.max(0, 100 - (distanceKm * 10)) * 0.18;
      const trafficScore = 80 * 0.08;
      const reliabilityScore = (w.reliability || 95) * 0.15;
      const custPrefScore = (w.custPref || 90) * 0.10;
      const areaPrefScore = (w.areaPref || 90) * 0.07;
      const acceptPredScore = 95 * 0.12;
      const dirScore = 85 * 0.08;
      const expScore = 90 * 0.07;
      
      // Dispatch Fairness Factor (Chapter 32): Prefer workers with lower earnings today
      const todayEarnings = w.todayEarnings || (idx * 1500);
      const fairnessScore = Math.max(0, 100 - (todayEarnings / 100)) * 0.05;
      const bundleScore = 80 * 0.05;
      const calendarFitScore = 95 * 0.10;

      const totalScore = Math.round(
        distanceScore + trafficScore + reliabilityScore + custPrefScore +
        areaPrefScore + acceptPredScore + dirScore + expScore +
        fairnessScore + bundleScore + calendarFitScore
      );

      return {
        ...w,
        distanceKm,
        dispatchScore: totalScore,
        todayEarnings,
      };
    });

    // Sort by dispatchScore descending
    ranked.sort((a, b) => b.dispatchScore - a.dispatchScore);

    this.logEvent(job.id, "WORKERS_RANKED", { rankedCount: ranked.length, topScore: ranked[0]?.dispatchScore });
    return ranked;
  }

  /**
   * Chapter 26 & 27 — Dynamic Pool Builder
   */
  buildDynamicPools(job, rankedWorkers, isEmergency = false) {
    const poolSize = isEmergency ? 8 : 3;
    const poolA = rankedWorkers.slice(0, poolSize);
    const poolB = rankedWorkers.slice(poolSize, poolSize * 2);

    this.logEvent(job.id, "POOLS_CREATED", { poolASize: poolA.length, poolBSize: poolB.length });

    return {
      poolA,
      poolB,
      dynamicTimeoutSeconds: isEmergency ? 10 : 20,
    };
  }

  /**
   * Chapter 29 — Atomic Acceptance Engine using SETNX Redis Lock Simulation
   * Guarantees strictly ONE winner even under parallel concurrency
   */
  async attemptAtomicAcceptance(jobId, workerId) {
    const key = `lock_job_${jobId}`;
    
    // Check atomic lock state
    if (atomicJobLocks.has(key)) {
      const winnerWorkerId = atomicJobLocks.get(key);
      this.logEvent(jobId, "ATOMIC_ACCEPT_FAILED_RACE", { workerId, winnerWorkerId });
      return {
        success: false,
        message: "JOB_ALREADY_TAKEN",
        winnerWorkerId,
      };
    }

    // Acquire atomic SETNX lock
    atomicJobLocks.set(key, workerId.toString());
    this.logEvent(jobId, "ASSIGNMENT_CONFIRMED_ATOMIC", { workerId });

    return {
      success: true,
      message: "ACCEPTED_SUCCESSFULLY",
      assignedWorkerId: workerId.toString(),
      lockTtlSeconds: 5,
    };
  }
}

module.exports = new DispatchOrchestratorService();
