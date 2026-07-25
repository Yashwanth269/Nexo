const db = require('./config/db');
const redis = require('./config/redis');

// Set Mock Env variables
process.env.WEATHER = 'RAIN';
process.env.FESTIVAL = 'true';

const eventBus = require('./services/event_bus.service');
const policyEngine = require('./services/policy_engine.service');
const safetyService = require('./services/safety.service');
const deviationService = require('./services/route_deviation.service');
const scheduledProtection = require('./services/scheduled_job_protection.service');
const scopeChangeService = require('./services/scope_change.service');

// Mock socket.io server instance for standalone testing
const { setIO } = require('./config/socket');
setIO({
    to: () => ({
        emit: (event, data) => {
            console.log(`[MOCK SOCKET EMIT] event=${event}`, JSON.stringify(data));
        }
    }),
    emit: (event, data) => {
        console.log(`[MOCK SOCKET BROADCAST] event=${event}`, JSON.stringify(data));
    }
});

async function runTests() {
    console.log("🧪 Starting Nexo Event-Driven Policy & Platform Hardening Integration Tests...");
    
    // Initialize Policy Engine rules
    policyEngine.init();

    const workerId = '4e8b3941-893d-4c3e-8687-0b1a03c3961f';
    const jobId = '8c22502f-b4de-4d0f-8567-de5c1b5a2bf9';
    const userId = '11111111-1111-1111-1111-111111111111';

    try {
        // Setup initial mock DB state
        await db.query("DELETE FROM safety_incidents WHERE job_id = $1", [jobId]);
        await db.query("DELETE FROM route_deviations WHERE job_id = $1", [jobId]);
        await db.query("DROP TABLE IF EXISTS job_scope_change_requests CASCADE");

        await db.query(`
            INSERT INTO workers (id, phone_number, full_name, is_online, is_available, verification_status, current_lat, current_lng)
            VALUES ($1, '9999999999', 'Mock Worker Test', true, true, 'VERIFIED', 12.9716, 77.5946)
            ON CONFLICT (id) DO UPDATE SET verification_status = 'VERIFIED', is_available = true
        `, [workerId]);

        await db.query(`
            INSERT INTO worker_reputation_scores (worker_id, reliability_score, trust_score, overall_score)
            VALUES ($1, 0.95, 0.95, 4.8)
            ON CONFLICT (worker_id) DO UPDATE SET reliability_score = 0.95, trust_score = 0.95
        `, [workerId]);

        await db.query(`
            CREATE TABLE IF NOT EXISTS worker_features (
                worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
                cancellation_rate DECIMAL(5,2) DEFAULT 0.00,
                completion_rate DECIMAL(5,2) DEFAULT 0.00,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            INSERT INTO worker_features (worker_id, cancellation_rate, completion_rate)
            VALUES ($1, 0.05, 0.95)
            ON CONFLICT (worker_id) DO UPDATE SET cancellation_rate = 0.05, completion_rate = 0.95
        `, [workerId]);

        await db.query(`
            INSERT INTO worker_skill_confidence (worker_id, category, confidence_score)
            VALUES ($1, 'AC REPAIR', 85.00)
            ON CONFLICT (worker_id, category) DO UPDATE SET confidence_score = 85.00
        `, [workerId]);

        await db.query(`
            INSERT INTO users (id, phone_number, full_name)
            VALUES ($1, '8888888888', 'Mock Client')
            ON CONFLICT (id) DO NOTHING
        `, [userId]);

        await db.query(`
            INSERT INTO jobs (id, user_id, worker_id, status, category, price, location_lat, location_lng, scheduled_at)
            VALUES ($1, $2, $3, 'ACCEPTED', 'AC REPAIR', 400.00, '12.9716', '77.5946', NOW() + INTERVAL '1 hour')
            ON CONFLICT (id) DO UPDATE SET status = 'ACCEPTED', worker_id = $3, price = 400.00
        `, [jobId, userId, workerId]);

        // Clean up Redis keys
        await redis.del(`route_deviation:consecutive_count:${jobId}:${workerId}`);
        await redis.del(`route_deviation:last_dist:${jobId}:${workerId}`);

        // --- TEST 1: Decoupled Event Bus & Policy Safety Suspension ---
        console.log("\n--- TEST 1: SAFETY_INCIDENT Event Safety Suspension Rule ---");
        
        await safetyService.reportIncident(
            jobId,
            userId,
            'CLIENT',
            'Harassment',
            'Worker misbehaved on site',
            12.9716,
            77.5946
        );

        // Wait brief ms for async event bus delivery
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if Policy suspension acted on database
        const checkSuspended = await db.query("SELECT verification_status FROM workers WHERE id = $1", [workerId]);
        console.log(`Worker status in DB post incident: "${checkSuspended.rows[0].verification_status}"`);
        if (checkSuspended.rows[0].verification_status !== 'SUSPENDED') {
            throw new Error("Worker should have been suspended by Policy rules!");
        }
        console.log("✅ Test 1 Passed: Policy suspension executed successfully.");

        // Restore worker for remainder of tests
        await db.query("UPDATE workers SET verification_status = 'VERIFIED' WHERE id = $1", [workerId]);

        // --- TEST 2: Consecutive Route Deviation Check & Rerouting filter ---
        console.log("\n--- TEST 2: Route Deviation Consecutive Filtering & Google Rerouting ---");
        
        // 2a. Trigger deviation 1
        console.log("Simulating deviation check 1 (consecutive count 1)...");
        let devRes = await deviationService.checkDeviation(jobId, workerId, 12.9916, 77.6146); // ~3km away
        
        let count = await redis.get(`route_deviation:consecutive_count:${jobId}:${workerId}`);
        console.log(`Consecutive deviation count in Redis: ${count}`);
        if (parseInt(count) !== 1) throw new Error("Consecutive count should be 1");

        // Verify reputation remains unchanged (no event bus notification yet)
        let checkRep1 = await db.query("SELECT reliability_score FROM worker_reputation_scores WHERE worker_id = $1", [workerId]);
        console.log(`Worker reliability post deviation 1: ${checkRep1.rows[0].reliability_score}`);
        if (parseFloat(checkRep1.rows[0].reliability_score) !== 0.95) {
            throw new Error("Reputation should not be penalized on first deviation warning.");
        }

        // 2b. Context Awareness: Move closer to target (simulated rerouting)
        console.log("Simulating deviation check 2: Worker heading back to route (distToDest decreasing)...");
        devRes = await deviationService.checkDeviation(jobId, workerId, 12.9816, 77.6046); // closer to dest
        console.log(`Is Google rerouting: ${devRes.isGoogleRerouting}`);
        if (!devRes.isGoogleRerouting) {
            throw new Error("Google Rerouting context check failed to identify path progression.");
        }

        count = await redis.get(`route_deviation:consecutive_count:${jobId}:${workerId}`);
        console.log(`Consecutive deviation count in Redis after reroute: ${count}`); // Reset to 0
        if (parseInt(count) !== 0) throw new Error("Consecutive count should be reset to 0 after reroute");

        // 2c. Build 3 consecutive deviations to trigger penalty policy
        console.log("Building consecutive deviations...");
        await deviationService.checkDeviation(jobId, workerId, 12.9916, 77.6146); // dev 1
        await deviationService.checkDeviation(jobId, workerId, 12.9926, 77.6156); // dev 2
        await deviationService.checkDeviation(jobId, workerId, 12.9936, 77.6166); // dev 3
        
        await new Promise(resolve => setTimeout(resolve, 100)); // wait for policy action

        // Verify penalty has been applied
        let checkRep2 = await db.query("SELECT reliability_score, trust_score FROM worker_reputation_scores WHERE worker_id = $1", [workerId]);
        console.log(`Worker reliability post 3 consecutive deviations: ${checkRep2.rows[0].reliability_score}`);
        if (parseFloat(checkRep2.rows[0].reliability_score) >= 0.95) {
            throw new Error("Reliability score should have been penalized!");
        }

        console.log("✅ Test 2 Passed: Consecutive checking and Rerouting detection verified.");

        // --- TEST 3: SOS Escalation & Risk Flag tagging ---
        console.log("\n--- TEST 3: SOS Emergency Escalations & AI Risk Profiling ---");
        
        const sosResult = await safetyService.triggerSOS(workerId, jobId, 12.9716, 77.5946);
        console.log(`SOS message: "${sosResult.message}"`);

        // Check if worker was automatically profiled as HIGH RISK WORKER due to accumulated safety + route deviations
        const checkRiskWorker = await db.query("SELECT verification_status FROM workers WHERE id = $1", [workerId]);
        console.log(`Worker risk state in DB: "${checkRiskWorker.rows[0].verification_status}"`);
        if (checkRiskWorker.rows[0].verification_status !== 'HIGH RISK WORKER' && checkRiskWorker.rows[0].verification_status !== 'SUSPENDED') {
            throw new Error("Worker should have been flagged as HIGH RISK WORKER or SUSPENDED!");
        }
        console.log("✅ Test 3 Passed: SOS safety escalations and AI Risk profiling verified.");

        // --- TEST 4: Dynamic Standby Pool sizes ---
        console.log("\n--- TEST 4: Dynamic Standby Reserves ---");
        const jobObject = {
            id: jobId,
            scheduled_at: new Date('2026-07-26T10:00:00Z').toISOString() // Sunday peak hour
        };
        const poolSize = scheduledProtection._getDynamicStandbyPoolSize(jobObject);
        console.log(`Dynamic calculated pool size for Sunday Peak Hour: ${poolSize} backups`);
        if (poolSize < 5) {
            throw new Error("Standby pool should expand on Sunday peak time!");
        }
        console.log("✅ Test 4 Passed: Dynamic reserve pool calculations verified.");

        // --- TEST 5: Scope Change material split & AI price validation ---
        console.log("\n--- TEST 5: Scope change pricing splits & AI validation ---");
        
        const scopeRes = await scopeChangeService.requestAdditionalWork(jobId, workerId, {
            title: "AC Capacitor replacement",
            description: "Capacitor burnt out",
            materialPrice: 500.00, // exceeds upper AC REPAIR range max of 380
            labourPrice: 150.00,
            evidencePhotoUrl: "https://nexo-media.s3.amazonaws.com/evidence-burnt-cap.jpg"
        });

        console.log(`Scope request response success: ${scopeRes.success}`);
        console.log(`Material price: ${scopeRes.request.material_price}, Labour price: ${scopeRes.request.labour_price}`);
        console.log(`AI price validation warning: "${scopeRes.request.ai_validation_warning}"`);

        if (!scopeRes.request.ai_validation_warning.includes("Higher than average")) {
            throw new Error("AI price validation warning not generated!");
        }
        console.log("✅ Test 5 Passed: Material vs Labour splits and AI price validation warnings verified.");

        console.log("\n🎉 All Nexo Event-Driven Policy & Platform Hardening Integration Tests Passed Successfully!");
        process.exit(0);
    } catch (e) {
        console.error("\n❌ TEST FAILED:", e.message, e.stack);
        process.exit(1);
    }
}

runTests();
