const db = require('./config/db');
const redis = require('./config/redis');
const { setIO } = require('./config/socket');

// Mock socket.io instance to avoid uninitialized errors during tests
setIO({
    to: (room) => ({
        emit: (event, data) => {
            console.log(`[MOCK SOCKET EMIT] room=${room} event=${event}`, data);
        }
    })
});

const jobStateMachine = require('./services/job_state_machine.service');
const otpService = require('./services/otp.service');
const executionService = require('./services/execution.service');
const marketplaceIntel = require('./services/marketplace_intelligence.service');

async function runTests() {
    console.log("🧪 Starting Marketplace Intelligence & Job Lifecycle Integration Tests...");

    // 1. Pre-Test Database Cleanup
    console.log("🧹 Cleaning up old mock test records...");
    await db.query("DELETE FROM job_offers WHERE worker_id IN (SELECT id FROM workers WHERE phone_number IN ('9999999901'))");
    await db.query("DELETE FROM job_slas WHERE job_id IN (SELECT id FROM jobs WHERE user_id IN (SELECT id FROM users WHERE phone_number = '9999999900'))");
    await db.query("DELETE FROM job_history WHERE job_id IN (SELECT id FROM jobs WHERE user_id IN (SELECT id FROM users WHERE phone_number = '9999999900'))");
    await db.query("DELETE FROM jobs WHERE user_id IN (SELECT id FROM users WHERE phone_number = '9999999900')");
    await db.query("DELETE FROM workers WHERE phone_number = '9999999901'");
    await db.query("DELETE FROM users WHERE phone_number = '9999999900'");
    await db.query("DELETE FROM incentive_recommendations");

    // 2. Insert mock customer and worker in Bangalore
    console.log("👤 Creating mock user and worker...");
    const userRes = await db.query(`
        INSERT INTO users (full_name, phone_number) 
        VALUES ('Test Customer', '9999999900') 
        RETURNING id
    `);
    const userId = userRes.rows[0].id;

    const workerRes = await db.query(`
        INSERT INTO workers (full_name, phone_number, skills, is_online, is_available, current_lat, current_lng, location_cube) 
        VALUES ('Test Worker', '9999999901', '{Electrical}', true, true, 12.9756, 77.6067, ll_to_earth(12.9756, 77.6067)) 
        RETURNING id
    `);
    const workerId = workerRes.rows[0].id;

    // 3. Create active Job
    console.log("📝 Creating mock job in 'BOOKED' status...");
    const jobRes = await db.query(`
        INSERT INTO jobs (user_id, worker_id, category, price, status, location_lat, location_lng, location_cube, urgency)
        VALUES ($1, $2, 'Electrical', 500, 'BOOKED', 12.9756, 77.6067, ll_to_earth(12.9756, 77.6067), 'emergency')
        RETURNING id
    `, [userId, workerId]);
    const jobId = jobRes.rows[0].id;

    // Create Job SLA mapping
    const deadline = new Date(Date.now() + 5 * 60 * 1000); // 5 min SLA
    await db.query(`
        INSERT INTO job_slas (job_id, sla_type, assignment_deadline, arrival_deadline)
        VALUES ($1, 'EMERGENCY', $2, $2)
    `, [jobId, deadline]);

    // 4. Validate Transitions (BOOKED -> VALIDATED -> QUEUED -> DISPATCHING)
    console.log("📈 Transitioning: BOOKED -> VALIDATED");
    let result = await jobStateMachine.transition(jobId, 'VALIDATED', { userId });
    if (result.to !== 'VALIDATED') throw new Error("Validation transition failed");

    console.log("📈 Transitioning: VALIDATED -> QUEUED");
    result = await jobStateMachine.transition(jobId, 'QUEUED', { userId });
    if (result.to !== 'QUEUED') throw new Error("Queued transition failed");

    console.log("📈 Transitioning: QUEUED -> DISPATCHING");
    result = await jobStateMachine.transition(jobId, 'DISPATCHING', { userId });
    if (result.to !== 'DISPATCHING') throw new Error("Dispatching transition failed");

    // 5. Worker Assignment (DISPATCHING -> WORKER_ASSIGNED -> WORKER_CONFIRMED -> WORKER_EN_ROUTE)
    console.log("👷 Assigning worker: DISPATCHING -> WORKER_ASSIGNED");
    result = await jobStateMachine.transition(jobId, 'WORKER_ASSIGNED', { workerId });
    if (result.to !== 'WORKER_ASSIGNED') throw new Error("Worker assignment transition failed");

    console.log("📈 Transitioning: WORKER_ASSIGNED -> WORKER_CONFIRMED");
    result = await jobStateMachine.transition(jobId, 'WORKER_CONFIRMED', { workerId });
    if (result.to !== 'WORKER_CONFIRMED') throw new Error("Worker confirmation transition failed");

    console.log("📈 Transitioning: WORKER_CONFIRMED -> WORKER_EN_ROUTE");
    result = await jobStateMachine.transition(jobId, 'WORKER_EN_ROUTE', { workerId });
    if (result.to !== 'WORKER_EN_ROUTE') throw new Error("En-route transition failed");

    // 6. Arrival validation using GPS calculations
    console.log("📍 Syncing location & marking Arrival...");
    await executionService.syncWorkerLocation(workerId, 12.9756, 77.6067);
    
    // Attempt Arrived transition using ExecutionService
    const arrivalCheck = await executionService.transitionStatus(jobId, workerId, 'ARRIVED', {
        lat: 12.9756,
        lng: 77.6067,
        isMocked: true
    });
    if (!arrivalCheck.success) throw new Error("Arrival status transition failed: " + arrivalCheck.error);
    console.log("✅ Worker Arrived successfully.");

    // 7. Verify start OTP logic
    console.log("🔑 Generating Start OTP...");
    const startOtp = await otpService.generateStartOtp(jobId);
    console.log(`🔑 Start OTP code: ${startOtp}. Verifying...`);
    const otpVerifyRes = await otpService.verifyStartOtp(jobId, workerId, startOtp);
    if (!otpVerifyRes.success) throw new Error("Start OTP verification failed");
    console.log("✅ Start OTP verified. Status transitioned automatically to SERVICE_STARTED.");

    // 8. Service timer checks (SERVICE_STARTED -> SERVICE_IN_PROGRESS -> SERVICE_PAUSED -> SERVICE_RESUMED)
    console.log("⏱️ Transitioning: SERVICE_STARTED -> SERVICE_IN_PROGRESS");
    result = await jobStateMachine.transition(jobId, 'SERVICE_IN_PROGRESS', { workerId });
    if (result.to !== 'SERVICE_IN_PROGRESS') throw new Error("In progress transition failed");

    console.log("⏱️ Transitioning: SERVICE_IN_PROGRESS -> SERVICE_PAUSED");
    result = await jobStateMachine.transition(jobId, 'SERVICE_PAUSED', { workerId });
    if (result.to !== 'SERVICE_PAUSED') throw new Error("Pause timer transition failed");

    console.log("⏱️ Transitioning: SERVICE_PAUSED -> SERVICE_RESUMED");
    result = await jobStateMachine.transition(jobId, 'SERVICE_RESUMED', { workerId });
    if (result.to !== 'SERVICE_RESUMED') throw new Error("Resume timer transition failed");

    // Upload evidence first before completion
    console.log("📸 Uploading photo evidence...");
    await db.query(`
        UPDATE jobs 
        SET before_photos = '{evidence_before.jpg}', 
            after_photos = '{evidence_after.jpg}',
            checklist = '["Check wires", "Verify voltage"]'::jsonb
        WHERE id = $1
    `, [jobId]);

    console.log("📈 Transitioning: SERVICE_RESUMED -> SERVICE_COMPLETED");
    result = await jobStateMachine.transition(jobId, 'SERVICE_COMPLETED', { workerId, signature: 'worker-signature-png' });
    if (result.to !== 'SERVICE_COMPLETED') throw new Error("Completion transition failed");

    // 9. Verify completion OTP verification
    console.log("🔑 Generating Completion OTP...");
    const compOtp = await otpService.generateCompletionOtp(jobId);
    console.log(`🔑 Completion OTP code: ${compOtp}. Verifying...`);
    const compOtpVerifyRes = await otpService.verifyCompletionOtp(jobId, workerId, compOtp);
    if (!compOtpVerifyRes.success) throw new Error("Completion OTP verification failed");
    console.log("✅ Completion OTP verified. Status transitioned automatically to CUSTOMER_VERIFIED.");

    // 10. Payout resolution (CUSTOMER_VERIFIED -> PAYMENT_CAPTURED -> WORKER_PAYOUT_PENDING -> WORKER_PAYOUT_COMPLETED -> JOB_CLOSED)
    console.log("💰 Transitioning: CUSTOMER_VERIFIED -> PAYMENT_CAPTURED");
    result = await jobStateMachine.transition(jobId, 'PAYMENT_CAPTURED', { userId });
    if (result.to !== 'PAYMENT_CAPTURED') throw new Error("Payment captured failed");

    console.log("💰 Transitioning: PAYMENT_CAPTURED -> WORKER_PAYOUT_PENDING");
    result = await jobStateMachine.transition(jobId, 'WORKER_PAYOUT_PENDING', { userId });
    if (result.to !== 'WORKER_PAYOUT_PENDING') throw new Error("Payout pending transition failed");

    console.log("💰 Transitioning: WORKER_PAYOUT_PENDING -> WORKER_PAYOUT_COMPLETED");
    result = await jobStateMachine.transition(jobId, 'WORKER_PAYOUT_COMPLETED', { userId });
    if (result.to !== 'WORKER_PAYOUT_COMPLETED') throw new Error("Payout completed transition failed");

    console.log("📈 Transitioning: WORKER_PAYOUT_COMPLETED -> JOB_CLOSED");
    result = await jobStateMachine.transition(jobId, 'JOB_CLOSED', { userId });
    if (result.to !== 'JOB_CLOSED') throw new Error("Job closed transition failed");

    console.log("🎉 Job successfully completed full 19-stage lifecycle!");

    // 11. Assert Timeline Audit History
    const historyRes = await db.query("SELECT status FROM job_history WHERE job_id = $1 ORDER BY timestamp ASC", [jobId]);
    console.log(`📋 Total timeline transitions recorded: ${historyRes.rowCount}`);
    if (historyRes.rowCount < 10) {
        throw new Error("Audit timeline logging is incomplete!");
    }

    // 12. Run Marketplace Scan & Forecast telemetry checks
    console.log("📊 Running marketplace telemetry engine scan...");
    const scanPayload = await marketplaceIntel.runGlobalMarketplaceScan();
    console.log(`📊 Scanned ${scanPayload.length} zones.`);

    const centralZone = scanPayload.find(z => z.locality === 'MG Road');
    if (!centralZone) throw new Error("Central Zone (MG Road) metrics missing!");

    console.log(`🏆 MG Road Health Score: ${centralZone.health.score} (${centralZone.health.classification})`);
    console.log(`📦 MG Road 1h Projections:`, centralZone.forecasts['1h']);

    // 13. Verify Load Balancer adjustments
    console.log("⚖️ Running worker load balancer ranking validation...");
    const lbResult = await marketplaceIntel.applyLoadBalancing(workerId, 0.85);
    console.log(`⚖️ Balanced Worker Score: ${lbResult.balancedScore.toFixed(3)} (Raw: 0.85, Idle minutes: ${lbResult.breakdown.idleMins.toFixed(1)})`);

    // Clean up
    console.log("🧹 Cleaning up post-test database records...");
    await db.query("DELETE FROM job_slas WHERE job_id = $1", [jobId]);
    await db.query("DELETE FROM job_history WHERE job_id = $1", [jobId]);
    await db.query("DELETE FROM jobs WHERE id = $1", [jobId]);
    await db.query("DELETE FROM workers WHERE id = $1", [workerId]);
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
    await db.query("DELETE FROM incentive_recommendations");

    console.log("⭐ ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ⭐");
    process.exit(0);
}

runTests().catch(err => {
    console.error("❌ Integration test failed:", err);
    process.exit(1);
});
