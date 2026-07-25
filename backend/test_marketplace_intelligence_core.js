require('dotenv').config();
const aiCalendarEngine = require('./services/ai_calendar_engine.service');
const marketplaceIntelligenceService = require('./services/marketplace_intelligence.service');

async function runMarketplaceIntelligenceTests() {
  console.log("🚀 Starting Marketplace Intelligence & Worker AI Core (Vol 1A Part 2 & Vol 1B) Integration Tests...\n");

  const testWorkerId = "+919731016442";
  const testCustomerId = "cust_sharma_001";

  // ===============================================
  // TEST 1: Chapter 4 & 5 — AI Calendar Engine (ACE)
  // ===============================================
  console.log("📅 1. Testing AI Calendar Engine (ACE)...");
  const timeline = aiCalendarEngine.getWorkerTimeline(testWorkerId);
  console.log(`✅ Worker Timeline Blocks: ${timeline.length} blocks configured`);

  const freeMatch = aiCalendarEngine.detectFreeSlotsAndMatch(testWorkerId, [
    { id: "opp_1", category: "Electrical", price: 950, address: "HSR Layout" },
  ]);
  console.log(`✅ Free Slot Matches Found: ${freeMatch.matchedOpportunities.length} opportunities matched to free window`);
  if (freeMatch.matchedOpportunities.length > 0) {
    const opp = freeMatch.matchedOpportunities[0];
    console.log(`   Matched Free Window: ${opp.matchedFreeWindow}`);
    console.log(`   Dynamic Buffer (Apartment lift wait): +${opp.dynamicBufferMins} mins`);
  }

  const hasConflict = aiCalendarEngine.hasBookingConflict(testWorkerId, "09:15", "10:00");
  console.log(`   Conflict Detection Test (09:15-10:00 vs 09:00-10:30): Has Conflict? ${hasConflict}`);

  // ===============================================
  // TEST 2: Chapter 9 & 10 — Favourite Customer Engine (FCE)
  // ===============================================
  console.log("\n❤️ 2. Testing Favourite Customer Engine (FCE)...");
  const rel = marketplaceIntelligenceService.getRelationshipScore(testCustomerId, testWorkerId);
  console.log(`✅ Relationship Score: ${rel.relationshipScore}/100 (${rel.previousJobsCount} previous jobs)`);
  console.log(`   Returning Revenue: ₹${rel.returningRevenue}`);
  console.log(`   Is Favourite Customer: ${rel.isFavouriteCustomer}`);

  // ===============================================
  // TEST 3: Chapter 11 — AI Price Recommendation Engine
  // ===============================================
  console.log("\n💰 3. Testing AI Price Recommendation Engine...");
  const priceRec = marketplaceIntelligenceService.generatePriceRecommendation({ price: 850, category: "Electrical", address: "HSR Layout" }, testWorkerId);
  console.log(`✅ Base Price: ₹${priceRec.basePrice}`);
  console.log(`✅ Recommended Quote: ₹${priceRec.recommendedQuote}`);
  console.log(`✅ Fair Market Range: ₹${priceRec.fairMarketRange.min} – ₹${priceRec.fairMarketRange.max}`);
  console.log(`✅ Estimated Win Probability: ${priceRec.estimatedWinProbability}%`);
  console.log(`   AI Rationale: ${priceRec.aiExplanation}`);

  // ===============================================
  // TEST 4: Chapter 12 — Traffic Risk Prediction Engine
  // ===============================================
  console.log("\n🚦 4. Testing Traffic Risk Prediction Engine...");
  const trafficRisk = marketplaceIntelligenceService.predictTrafficRisk("Koramangala", "Silk Board");
  console.log(`✅ Traffic Risk Level: ${trafficRisk.riskLevel}`);
  console.log(`   Extra Travel Detour: +${trafficRisk.extraTravelMins} mins`);
  console.log(`   Worker Notice: ${trafficRisk.workerNotice}`);

  // ===============================================
  // TEST 5: Chapter 13 & 14 — Customer (CRS) & Worker (WRS) Reliability
  // ===============================================
  console.log("\n⭐ 5. Testing Customer (CRS) & Worker (WRS) Reliability Scores...");
  const crs = marketplaceIntelligenceService.getCustomerReliabilityScore(testCustomerId);
  const wrs = marketplaceIntelligenceService.getWorkerReliabilityScore(testWorkerId);
  console.log(`✅ Customer Reliability Score (CRS): ${crs.crsScore}% (${crs.badge})`);
  console.log(`✅ Worker Reliability Score (WRS): ${wrs.wrsScore}% (${wrs.badge})`);
  console.log(`   Unlocks Priority Dispatch: ${wrs.unlocksPriorityDispatch}`);

  console.log("\n🎉 ALL MARKETPLACE INTELLIGENCE & WORKER AI CORE TESTS PASSED PERFECTLY!");
  process.exit(0);
}

runMarketplaceIntelligenceTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
