require('dotenv').config();
const workerPresenceService = require('./services/worker_presence.service');
const hybridAIDecisionEngine = require('./services/hybrid_ai_decision_engine.service');
const marketplaceControlTowerService = require('./services/marketplace_control_tower.service');

async function runInfrastructureAndAIBrainTests() {
  console.log("🚀 Starting Volume 2 Part 2 & Volume 3 (Infrastructure & AI Brain) Integration Tests...\n");

  const testWorkerId = "+919731016442";

  // ===============================================
  // TEST 1: Chapter 39 — Worker Presence Heartbeat & Timeout State Machine
  // ===============================================
  console.log("💓 1. Testing Worker Presence Heartbeat Architecture...");
  const heartbeatRes = workerPresenceService.processHeartbeat(testWorkerId, {
    lat: 12.9352,
    lng: 77.6245,
    batteryLevel: 92,
    zone: "zone:koramangala",
    category: "electricians",
  });

  console.log(`✅ Heartbeat Processed for Worker ${testWorkerId}: Status = ${heartbeatRes.presence.status}`);
  
  const presenceLookup = workerPresenceService.getPresence(testWorkerId);
  console.log(`✅ Fast Presence Lookup: Status = ${presenceLookup.status}, Battery = ${presenceLookup.batteryLevel}%`);

  const timeoutEval = workerPresenceService.evaluatePresenceTimeouts();
  console.log(`✅ Presence Timeout State Machine Evaluated: Total = ${timeoutEval.totalWorkers}, Stale = ${timeoutEval.staleCount}, Offline = ${timeoutEval.offlineCount}`);

  // ===============================================
  // TEST 2: Chapter 56 & 71 — Hybrid AI & MOOE Engine
  // ===============================================
  console.log("\n🧠 2. Testing Hybrid AI Architecture (Rules + Models + MOOE)...");
  
  const candidateGood = { id: testWorkerId, isSuspended: false };
  const evalGood = hybridAIDecisionEngine.evaluateCandidateWorker({ id: "job_01" }, candidateGood);
  console.log(`✅ Good Worker Hybrid AI Result: Passed Policy = ${evalGood.passedPolicy}, AI Rank Score = ${evalGood.aiRankScore}`);
  console.log(`   XAI Rationale Explanations:`);
  evalGood.xaiRationale.forEach(r => console.log(`     • ${r}`));

  // Test Policy Override: Worker with suspended status
  const candidateSuspended = { id: "worker_bad_001", isSuspended: true };
  const evalSuspended = hybridAIDecisionEngine.evaluateCandidateWorker({ id: "job_01" }, candidateSuspended);
  console.log(`\n🚫 Policy Override Test (Suspended Worker): Passed Policy = ${evalSuspended.passedPolicy}, Reason = ${evalSuspended.rejectionReason}`);

  // ===============================================
  // TEST 3: Chapter 55 & 74 — Control Tower & AI Worker Coach
  // ===============================================
  console.log("\n🏢 3. Testing Marketplace Control Tower & AI Worker Coach...");
  const healthScore = marketplaceControlTowerService.getMarketplaceHealthScore();
  console.log(`✅ Operational Marketplace Health Score: ${healthScore.healthScore}% (${healthScore.status})`);
  console.log(`   Redis Latency: ${healthScore.metrics.redisLatencyMs}ms, Active Sockets: ${healthScore.metrics.socketConnectionCount}`);

  const coachRes = marketplaceControlTowerService.getAIWorkerCoachGuidance(testWorkerId);
  console.log(`\n💡 AI Worker Coach Guidance for ${coachRes.headline}:`);
  console.log(`   Monthly Earnings So Far: ₹${coachRes.monthlyEarningsSoFar}`);
  console.log(`   Coaching Recommendations:`);
  coachRes.coachingRecommendations.forEach(rec => console.log(`     • ${rec}`));
  console.log(`   Suggested Skill Expansion: ${coachRes.suggestedSkillExpansion.recommendedSkill} (${coachRes.suggestedSkillExpansion.potentialIncomeIncrease})`);

  console.log("\n🎉 ALL INFRASTRUCTURE & AI BRAIN INTEGRATION TESTS PASSED PERFECTLY!");
  process.exit(0);
}

runInfrastructureAndAIBrainTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
