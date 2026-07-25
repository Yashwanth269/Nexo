const db = require('./config/db');
const redis = require('./config/redis');

// Mock socket.io instance
const { setIO } = require('./config/socket');
setIO({
    to: () => ({ emit: () => {} }),
    emit: () => {}
});

const decisionIntelligence = require('./services/decision_intelligence.service');
const shadowBan = require('./services/shadow_ban.service');
const userTrust = require('./services/user_trust.service');
const walletService = require('./services/wallet.service');

async function runTests() {
    console.log("🧪 Starting Nexo Decision Intelligence, Double-Entry & Multi-Dimensional Ban Tests...");

    const workerId = '4e8b3941-893d-4c3e-8687-0b1a03c3961f';
    const customerId = '11111111-1111-1111-1111-111111111111';
    const jobId = '8c22502f-b4de-4d0f-8567-de5c1b5a2bf9';

    try {
        // --- Setup mock tables & records ---
        await db.query("DELETE FROM wallets WHERE owner_id IN ($1, $2)", [workerId, customerId]);
        await db.query("DELETE FROM shadow_ban_status WHERE worker_id = $1", [workerId]);
        await db.query("DELETE FROM user_trust_scores WHERE user_id = $1", [customerId]);
        await db.query("DELETE FROM event_logs WHERE user_id = $1 OR worker_id = $1", [customerId]);

        await db.query(`
            INSERT INTO workers (id, phone_number, full_name, is_online, is_available, verification_status, current_lat, current_lng)
            VALUES ($1, '9999999999', 'Decision Engine Worker', true, true, 'VERIFIED', 12.9716, 77.5946)
            ON CONFLICT (id) DO UPDATE SET verification_status = 'VERIFIED'
        `, [workerId]);

        await db.query(`
            INSERT INTO worker_reputation_scores (worker_id, reliability_score, trust_score, overall_score)
            VALUES ($1, 95.0, 95.0, 4.8)
            ON CONFLICT (worker_id) DO UPDATE SET reliability_score = 95.0, trust_score = 95.0
        `, [workerId]);

        await db.query(`
            INSERT INTO worker_skill_confidence (worker_id, category, confidence_score)
            VALUES ($1, 'AC REPAIR', 90.00)
            ON CONFLICT (worker_id, category) DO UPDATE SET confidence_score = 90.00
        `, [workerId]);

        await db.query(`
            INSERT INTO jobs (id, user_id, worker_id, status, category, price, location_lat, location_lng, scheduled_at)
            VALUES ($1, $2, $3, 'ACCEPTED', 'AC REPAIR', 400.00, '12.9716', '77.5946', NOW() + INTERVAL '1 hour')
            ON CONFLICT (id) DO UPDATE SET category = 'AC REPAIR'
        `, [jobId, customerId, workerId]);

        // --- TEST 1: Decision Intelligence Scoring ---
        console.log("\n--- TEST 1: Decision Intelligence Score compilation ---");
        const composite = await decisionIntelligence.getDispatchRankScore(workerId, jobId, 2.0); // 2 km away
        console.log("Composite rank score output:", JSON.stringify(composite));
        if (composite.finalScore < 60.0) {
            throw new Error(`Dispatch score should be high for verified near worker, got: ${composite.finalScore}`);
        }
        console.log("✅ Test 1 Passed: Decision Intelligence compiled successfully.");

        // --- TEST 2: Targeted Shadow Ban Restrictions ---
        console.log("\n--- TEST 2: Targeted Multi-Dimensional Shadow Bans ---");
        // Apply safety restriction
        await shadowBan.updateRestrictions(workerId, { safety: true, spam: false });
        
        const testStatus = await shadowBan.getStatus(workerId);
        console.log("Shadow ban restrictions in DB:", JSON.stringify(testStatus.restrictions));
        if (testStatus.restrictions.safety !== true) {
            throw new Error("Targeted safety restriction not saved!");
        }

        // Verify dispatch multiplier drops
        const dispatchPenalty = await shadowBan.applyBanPenalties(workerId, 1.0, 1.0);
        console.log("Dispatch multiplier post safety block:", dispatchPenalty.dispatch);
        if (dispatchPenalty.dispatch !== 0.10) {
            throw new Error("Dispatch multiplier should drop to 0.10 on safety restriction!");
        }
        console.log("✅ Test 2 Passed: Multi-dimensional shadow bans verified.");

        // --- TEST 3: Time-Decayed User Trust & Category Overrides ---
        console.log("\n--- TEST 3: User Trust Time Decay & Category Overrides ---");
        
        // Log a recent event (today)
        await db.query(`
            INSERT INTO event_logs (job_id, user_id, event_type, metadata, created_at)
            VALUES ($1, $2, 'CANCELLATION', '{}', NOW())
        `, [jobId, customerId]);

        // Log an old event (120 days ago)
        await db.query(`
            INSERT INTO event_logs (job_id, user_id, event_type, metadata, created_at)
            VALUES ($1, $2, 'FAKE_BOOKING', '{}', NOW() - INTERVAL '120 days')
        `, [jobId, customerId]);

        // Create user trust score row first
        await userTrust.getOrCreateScore(customerId);
        // Recalculate
        await userTrust._recalculateScore(customerId);
        const trustStatus = await userTrust.getTrustLevel(customerId);
        console.log(`Calculated trust score with decay: ${trustStatus.trustScore}`); // 100 - (5*1.0) - (15*0.2) = 92
        if (parseFloat(trustStatus.trustScore) !== 92) {
            throw new Error(`Expected time decayed score of 92, got ${trustStatus.trustScore}`);
        }

        // Test category trust override
        await db.query(`
            UPDATE user_trust_scores
            SET category_trust = '{"Electrical": 60, "Cleaning": 98}'::jsonb
            WHERE user_id = $1
        `, [customerId]);

        const electricalTrust = await userTrust.getCategoryTrust(customerId, "Electrical");
        const defaultTrust = await userTrust.getCategoryTrust(customerId, "AC REPAIR");
        console.log(`Electrical category trust: ${electricalTrust}, AC REPAIR trust: ${defaultTrust}`);
        if (electricalTrust !== 60 || defaultTrust !== 92) {
            throw new Error("Category trust override lookup failed.");
        }
        console.log("✅ Test 3 Passed: User trust decay and category overrides verified.");

        // --- TEST 4: Double-Entry Wallet Accounting & Reconciliation ---
        console.log("\n--- TEST 4: Double-Entry Transfers & Nightly Reconciliation ---");
        
        const customerWallet = await walletService.getOrCreateWallet(customerId, 'CLIENT');
        const workerWallet = await walletService.getOrCreateWallet(workerId, 'WORKER');

        // Add initial funds to customer
        await walletService.addFunds(customerId, 'CLIENT', 500.00, 'DEPOSIT', null, 'Initial deposit');

        // Transfer funds using double-entry method
        await walletService.transferFunds(
            customerId, 'CLIENT',
            workerId, 'WORKER',
            200.00,
            'PAYOUT',
            null,
            'Job execution transfer'
        );

        // Run reconciliation
        let recon = await walletService.runReconciliationCheck();
        console.log(`Initial reconciliation audit completed.`);
        const customerAnomaly = recon.anomalies.find(a => a.ownerId === customerId);
        const workerAnomaly = recon.anomalies.find(a => a.ownerId === workerId);
        if (customerAnomaly || workerAnomaly) {
            throw new Error("Initial reconciliation should not find anomalies for our test wallets.");
        }

        // Manually pollute client wallet balance (create mismatch/anomaly)
        await db.query("UPDATE wallets SET balance = balance + 10.00 WHERE id = $1", [customerWallet.id]);

        recon = await walletService.runReconciliationCheck();
        const customerAnomalyPost = recon.anomalies.find(a => a.ownerId === customerId);
        console.log(`Reconciliation result post pollution: customerAnomalyFound = ${customerAnomalyPost !== undefined}`);
        if (!customerAnomalyPost) {
            throw new Error("Reconciliation engine failed to detect the manually introduced wallet mismatch!");
        }

        console.log("✅ Test 4 Passed: Double-entry transfers and reconciliation audit verified.");

        console.log("\n🎉 All Decision, Accounting & targeted shadow restrictions integration tests passed successfully!");
        process.exit(0);
    } catch (e) {
        console.error("\n❌ TEST FAILED:", e.message, e.stack);
        process.exit(1);
    }
}

runTests();
