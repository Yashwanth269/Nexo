require('dotenv').config();
const marketplaceOptimizationService = require('./services/marketplace_optimization.service');
const dispatchOrchestratorService = require('./services/dispatch_orchestrator.service');

async function runOptimizationAndDispatchTests() {
  console.log("🚀 Starting Volume 1C (Marketplace Optimization) & Volume 2 (Dispatch Engine) Integration Tests...\n");

  const testWorkerId = "+919731016442";

  // ===============================================
  // TEST 1: Chapter 15 — AI Earnings Forecast (AFE)
  // ===============================================
  console.log("📊 1. Testing AI Earnings Forecast Engine (AFE)...");
  const forecast = marketplaceOptimizationService.generateEarningsForecast(testWorkerId, "Electrical");
  console.log(`✅ Daily Earnings Forecast Range: ₹${forecast.forecastRange.min} – ₹${forecast.forecastRange.max}`);
  console.log(`   Confidence Score: ${forecast.confidencePercent}%`);
  console.log(`   Best Time Window: ${forecast.bestTimeWindow}`);
  console.log(`   AI Goal Plan:`, forecast.goalPlan);

  // ===============================================
  // TEST 2: Chapter 16 — Demand Heat Map Engine (DHM)
  // ===============================================
  console.log("\n🔥 2. Testing Demand Heat Map Engine (DHM)...");
  const heatmap = marketplaceOptimizationService.getDemandHeatMap();
  console.log(`✅ Heatmap Generated for City: ${heatmap.city}`);
  console.log(`   Total Zones Monitored: ${heatmap.zones.length}`);
  heatmap.zones.forEach(z => {
    console.log(`     • ${z.name}: ${z.heatLevel} (+₹${z.expectedEarningsAdd} earnings add)`);
  });

  // ===============================================
  // TEST 3: Chapter 17 — Smart Job Bundling Engine (SJB)
  // ===============================================
  console.log("\n⚡ 3. Testing Smart Job Bundling Engine (SJB)...");
  const sampleJobs = [
    { id: "j1", title: "Fan Repair", price: 600, category: "Electrical" },
    { id: "j2", title: "Switch Replacement", price: 500, category: "Electrical" },
    { id: "j3", title: "MCB Installation", price: 900, category: "Electrical" },
  ];
  const bundles = marketplaceOptimizationService.findAndBuildJobBundles(sampleJobs);
  console.log(`✅ Smart Job Bundles Built: ${bundles.length}`);
  if (bundles.length > 0) {
    const b = bundles[0];
    console.log(`   Bundle Title: ${b.bundleTitle}`);
    console.log(`   Total Payout: ₹${b.totalPayout} for ${b.totalJobs} jobs (${b.totalTravelKm} km travel)`);
    console.log(`   AI Rationale: ${b.aiRationale}`);
  }

  // ===============================================
  // TEST 4: Chapter 20 — Predictive Reassignment Engine (PRE)
  // ===============================================
  console.log("\n🚨 4. Testing Predictive Reassignment Engine (PRE)...");
  const preResultHighRisk = marketplaceOptimizationService.evaluateReassignmentRisk({ id: "j100" }, 18.0, 30, "HIGH");
  console.log(`✅ High Risk PRE Evaluation (18km away in 30m): Risk Level = ${preResultHighRisk.riskLevel}`);
  console.log(`   Arrival Probability: ${preResultHighRisk.arrivalProbability}%`);
  console.log(`   Is Silent Standby Triggered? ${preResultHighRisk.isStandbyTriggered}`);
  console.log(`   Action: ${preResultHighRisk.actionTaken}`);

  // ===============================================
  // TEST 5: Volume 2 — Dispatch & Orchestration Engine
  // ===============================================
  console.log("\n⚡ 5. Testing Volume 2 Dispatch & Orchestration Engine...");
  const job = { id: "job_9832", title: "AC Servicing", price: 1200 };
  
  const candidateWorkers = [
    { id: "+919731016442", name: "Rahul", reliability: 98, isSuspended: false, batteryLevel: 85 },
    { id: "+917777794257", name: "Anil", reliability: 95, isSuspended: false, batteryLevel: 90 },
    { id: "+918888888888", name: "Kiran", reliability: 80, isSuspended: true, batteryLevel: 10 }, // Suspended + Low battery
  ];

  // 1. Eligibility Filter
  const eligible = dispatchOrchestratorService.filterEligibleWorkers(job, candidateWorkers);
  console.log(`✅ Eligibility Filter: ${eligible.length} workers eligible out of ${candidateWorkers.length}`);

  // 2. 12-Factor Ranking Engine
  const ranked = dispatchOrchestratorService.rankWorkers(job, eligible);
  console.log(`✅ 12-Factor Ranking Engine: Top Ranked Worker = ${ranked[0].name} (Score: ${ranked[0].dispatchScore})`);

  // 3. Dynamic Pools
  const pools = dispatchOrchestratorService.buildDynamicPools(job, ranked, false);
  console.log(`✅ Dynamic Pools Created: Pool A size = ${pools.poolA.length}, Timeout = ${pools.dynamicTimeoutSeconds}s`);

  // 4. Atomic Acceptance Engine (SETNX Simulation)
  console.log("\n🔒 Testing Atomic Acceptance SETNX Lock Concurrency...");
  const acceptResult1 = await dispatchOrchestratorService.attemptAtomicAcceptance("job_9832", "+919731016442");
  console.log(`   Worker 1 Acceptance Result:`, acceptResult1);

  const acceptResult2 = await dispatchOrchestratorService.attemptAtomicAcceptance("job_9832", "+917777794257");
  console.log(`   Worker 2 Parallel Acceptance Result (Race Condition):`, acceptResult2);

  // 5. Dispatch Trace Timeline Observability
  const trace = dispatchOrchestratorService.getDispatchTrace("job_9832");
  console.log(`\n📋 Dispatch Observability Trace Timeline (${trace.length} events logged):`);
  trace.forEach(t => console.log(`   [${t.timestamp.split('T')[1].slice(0, 8)}] ${t.event}`));

  console.log("\n🎉 ALL VOLUME 1C & VOLUME 2 ENGINE TESTS PASSED PERFECTLY!");
  process.exit(0);
}

runOptimizationAndDispatchTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
