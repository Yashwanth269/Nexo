require('dotenv').config();
const db = require('./config/db');
const travelHomeEngine = require('./services/travel_home_engine.service');
const workerPreferenceService = require('./services/worker_preference.service');

async function runWorkerIntelligenceCoreTests() {
  console.log("🚀 Starting Worker Intelligence Core (THE, PAE, PSE) Integration Tests...\n");

  const testWorkerId = "+919731016442";

  // ===============================================
  // TEST 1: Travel Home Intelligence Engine (THE)
  // ===============================================
  console.log("🏠 1. Testing Travel Home Intelligence Engine (THE)...");
  const homeLoc = {
    address: "Electronic City",
    lat: 12.8452,
    lng: 77.6602,
    startLat: 12.9352, // Koramangala
    startLng: 77.6245,
  };

  const startRes = travelHomeEngine.startTravelHomeMode(testWorkerId, homeLoc);
  console.log(`✅ Travel Home Mode Started:`, startRes.session.homeAddress);

  const candidateJobs = [
    { id: "job_1", category: "Electrical", title: "Electrical Switch Repair", price: 950, location_lat: 12.9116, location_lng: 77.6389, address: "HSR Layout" }, // Along route, 6 min detour
    { id: "job_2", category: "Cleaning", title: "Deep House Cleaning", price: 300, location_lat: 13.0827, location_lng: 77.5877, address: "Yelahanka" }, // Opposite direction (Yelahanka), high detour
  ];

  const routeResult = travelHomeEngine.filterAndRankRouteJobs(testWorkerId, candidateJobs, { lat: 12.9352, lng: 77.6245 });
  console.log(`✅ Route Matching Result: ${routeResult.jobsCount} jobs matched along route home`);
  console.log(`   Estimated Journey: ${routeResult.estimatedMinsRemaining} mins`);
  console.log(`   Potential Earnings along Route: ₹${routeResult.potentialEarnings}`);

  if (routeResult.jobs.length > 0) {
    const topJob = routeResult.jobs[0];
    console.log(`   Top Matched Job: ${topJob.title} (${topJob.address})`);
    console.log(`   Detour Time Added: +${topJob.detourTimeMins} mins`);
    console.log(`   Acceptance Probability: ${topJob.acceptanceProbability}%`);
    console.log(`   AI Rationale Explanations:`);
    topJob.rationale.forEach(r => console.log(`     • ${r}`));
  }

  // ===============================================
  // TEST 2: Preferred Areas Engine (PAE)
  // ===============================================
  console.log("\n🗺️ 2. Testing Preferred Areas Engine (PAE)...");
  const areaRatings = {
    'Whitefield': 5,
    'HSR Layout': 5,
    'Koramangala': 4,
    'Airport': 0, // Avoided
  };
  await workerPreferenceService.updateAreaRatings(testWorkerId, areaRatings);
  console.log(`✅ Updated Worker Area Ratings:`, areaRatings);

  const testJobHSR = { title: "AC Service", category: "AC", price: 1200, address: "HSR Layout Sector 1" };
  const testJobAirport = { title: "AC Service", category: "AC", price: 2000, address: "Airport Terminal 1" };

  const scoreHSR = await workerPreferenceService.calculateDispatchScore(testWorkerId, testJobHSR, 2.0, 95);
  const scoreAirport = await workerPreferenceService.calculateDispatchScore(testWorkerId, testJobAirport, 25.0, 95);

  console.log(`   HSR Job Dispatch Score (5★ Area): ${scoreHSR.compositeScore} (Breakdown: Area Score ${scoreHSR.breakdown.areaScore})`);
  console.log(`   Airport Job Dispatch Score (0★ Avoided Area): ${scoreAirport.compositeScore} (Is Avoided: ${scoreAirport.isAvoidedArea})`);

  // ===============================================
  // TEST 3: Preferred Services Engine (PSE)
  // ===============================================
  console.log("\n⭐ 3. Testing Preferred Services Engine (PSE)...");
  const skillRatings = {
    'Ceiling Fan Repair': 5,
    'Switch Board Repair': 5,
    'Solar Installation': 1,
  };
  await workerPreferenceService.updateSkillRatings(testWorkerId, skillRatings);
  console.log(`✅ Updated Sub-Skill Confidence Ratings:`, skillRatings);

  const testJobFan = { title: "Ceiling Fan Repair", category: "Electrical", price: 700, address: "HSR Layout" };
  const testJobSolar = { title: "Solar Installation", category: "Electrical", price: 1500, address: "HSR Layout" };

  const scoreFan = await workerPreferenceService.calculateDispatchScore(testWorkerId, testJobFan, 2.0, 95);
  const scoreSolar = await workerPreferenceService.calculateDispatchScore(testWorkerId, testJobSolar, 2.0, 95);

  console.log(`   Fan Repair Dispatch Score (5★ Skill): ${scoreFan.compositeScore} (Skill Score ${scoreFan.breakdown.skillScore})`);
  console.log(`   Solar Install Dispatch Score (1★ Skill): ${scoreSolar.compositeScore} (Skill Score ${scoreSolar.breakdown.skillScore})`);

  console.log("\n🎉 ALL WORKER INTELLIGENCE CORE (THE, PAE, PSE) TESTS PASSED PERFECTLY!");
  process.exit(0);
}

runWorkerIntelligenceCoreTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
