const db = require('../config/db');
const featureStoreService = require('./feature_store.service');

class HybridAIDecisionEngine {
  /**
   * Hybrid AI Pipeline: Business Rules Policy Validation + Dynamic ML Scoring (Chapter 56)
   */
  async evaluateCandidateWorker(job, candidateWorker) {
    const workerId = candidateWorker.id || candidateWorker.workerId;
    
    // 1. Fetch real features from FeatureStoreService (removes mock features map)
    const features = await featureStoreService.getWorkerFeatures(workerId);

    // ==========================================
    // STEP 1: BUSINESS RULES POLICY OVERRIDES
    // AI cannot bypass these hard security/trust rules!
    // ==========================================
    if (features.reliability_score < 0.70) {
      return {
        passedPolicy: false,
        rejectionReason: "RELIABILITY_BELOW_THRESHOLD_70",
        aiRankScore: 0,
        modelVersion: '1.2.0-mooe',
        timestamp: new Date().toISOString()
      };
    }

    if (candidateWorker.isSuspended || features.is_shadow_banned) {
      return {
        passedPolicy: false,
        rejectionReason: "WORKER_ACCOUNT_SUSPENDED",
        aiRankScore: 0,
        modelVersion: '1.2.0-mooe',
        timestamp: new Date().toISOString()
      };
    }

    // ==========================================
    // STEP 2: MULTI-OBJECTIVE OPTIMIZATION ENGINE (MOOE)
    // Evaluates Customer Sat, Worker Sat, Platform Profit, & Marketplace Balance
    // ==========================================
    const custSatScore = (features.avg_rating / 5.0) * 100 * 0.30;
    const workerSatScore = (features.acceptance_rate * 100) * 0.25;
    const platformProfitScore = features.completion_rate * 0.25;
    
    // Fairness: Prefer workers who haven't completed a lot of active jobs today to balance load
    const activeJobs = features.active_jobs_count || 0;
    const fairnessScore = Math.max(0, 100 - (activeJobs * 25)) * 0.20;

    const totalAIRankScore = Math.round(custSatScore + workerSatScore + platformProfitScore + fairnessScore);

    // ==========================================
    // STEP 3: EXPLAINABLE AI (XAI)
    // Generate rationale dynamically based on real features
    // ==========================================
    const xaiRationale = [];
    if (features.avg_rating >= 4.7) {
        xaiRationale.push(`⭐ Recommended because of high average rating (${features.avg_rating} / 5.0)`);
    }
    if (features.completion_rate >= 95) {
        xaiRationale.push(`📅 Excellent completion rate (${features.completion_rate}% of accepted tasks)`);
    }
    if (features.reliability_score >= 0.90) {
        xaiRationale.push(`⚡ Top Pro reliability rating (${(features.reliability_score * 100).toFixed(0)}% WRS)`);
    }
    if (features.fatigue_score < 0.30) {
        xaiRationale.push(`🔋 Fresh availability (low fatigue index: ${features.fatigue_score})`);
    } else {
        xaiRationale.push(`⚠️ Moderate fatigue level detected`);
    }

    // Determine prediction confidence based on feature availability
    const featureCount = Object.values(features).filter(v => v !== null && v !== undefined).length;
    const confidence = Math.min(1.0, featureCount / 18);

    return {
      passedPolicy: true,
      aiRankScore: totalAIRankScore,
      features,
      xaiRationale,
      predictionConfidence: parseFloat(confidence.toFixed(2)),
      modelVersion: '1.2.0-mooe',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new HybridAIDecisionEngine();
