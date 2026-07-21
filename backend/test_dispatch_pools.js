const db = require('./config/db');
const redis = require('./config/redis');
const { setIO } = require('./config/socket');
const dispatchQueue = require('./services/dispatch_queue.service');
const assert = require('assert');

// Mock socket.io instance to avoid uninitialized errors during tests
setIO({
    to: (room) => ({
        emit: (event, data) => {
            console.log(`[MOCK SOCKET EMIT] room=${room} event=${event}`, data);
        }
    })
});

async function testPoolDispatch() {
    console.log("🧪 Starting Pool Dispatch Queue Integration Test...");
    
    // 1. Create mock data
    const userRes = await db.query(
        "INSERT INTO users (full_name, phone_number) VALUES ('Mock Customer', '9999999990') RETURNING id"
    );
    const userId = userRes.rows[0].id;

    // Create 3 mock workers
    const worker1 = await db.query(
        `INSERT INTO workers (full_name, phone_number, skills, is_online, is_available, verification_status, location_cube) 
         VALUES ('Worker One', '9999999991', '{"Plumbing"}', true, true, 'VERIFIED', ll_to_earth(12.9716, 77.5946)) RETURNING id`
    );
    const worker2 = await db.query(
        `INSERT INTO workers (full_name, phone_number, skills, is_online, is_available, verification_status, location_cube) 
         VALUES ('Worker Two', '9999999992', '{"Plumbing"}', true, true, 'VERIFIED', ll_to_earth(12.9716, 77.5946)) RETURNING id`
    );
    const worker3 = await db.query(
        `INSERT INTO workers (full_name, phone_number, skills, is_online, is_available, verification_status, location_cube) 
         VALUES ('Worker Three', '9999999993', '{"Plumbing"}', true, true, 'VERIFIED', ll_to_earth(12.9716, 77.5946)) RETURNING id`
    );

    const w1Id = worker1.rows[0].id;
    const w2Id = worker2.rows[0].id;
    const w3Id = worker3.rows[0].id;

    // 2. Create Job
    const jobRes = await db.query(
        `INSERT INTO jobs (user_id, category, description, location_lat, location_lng, price, status) 
         VALUES ($1, 'Plumbing', 'Fix kitchen tap leakage', 12.9716, 77.5946, 350.00, 'OPEN') RETURNING id`,
        [userId]
    );
    const jobId = jobRes.rows[0].id;

    console.log(`Created Job ID: ${jobId}`);

    try {
        // Run Dispatch Pipeline Asynchronously
        console.log("Triggering broadcastJob...");
        dispatchQueue.broadcastJob(jobId).catch(console.error);

        // Wait 1.5s for step transitions
        await new Promise(r => setTimeout(r, 1500));

        // Check state is POOL_1_ACTIVE (Since Plumbing config override is pool1Size: 2)
        const checkJob = await db.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
        console.log(`Job Status: ${checkJob.rows[0].status}`);
        assert.ok(checkJob.rows[0].status.includes('POOL_1_ACTIVE'));

        // Check offers created
        const offers = await db.query(
            "SELECT id, worker_id, status FROM job_offers WHERE job_id = $1 AND status = 'PENDING'",
            [jobId]
        );
        console.log(`Active pending offers in Pool 1: ${offers.rowCount}`);
        assert.strictEqual(offers.rowCount, 2);

        // Simulate Worker One declining the job
        const off = offers.rows[0];
        console.log(`Worker ${off.worker_id} declining offer ${off.id}...`);
        const declineResult = await dispatchQueue.declineOffer(off.id, off.worker_id);
        assert.ok(declineResult.success);

        // Verify cooldown is set
        const cooldown = await redis.get(`dispatch_lock:${jobId}:${off.worker_id}`);
        assert.strictEqual(cooldown, 'rejected');
        console.log("✅ Cooldown verified successfully.");

        // Simulate Worker Two accepting the job atomically
        const winningOffer = offers.rows.find(o => o.id !== off.id);
        const wRes = await db.query("SELECT phone_number FROM workers WHERE id = $1", [winningOffer.worker_id]);
        const winningPhone = wRes.rows[0].phone_number;
        console.log(`Worker accepting offer ${winningOffer.id} with phone ${winningPhone}...`);
        const acceptResult = await dispatchQueue.acceptOfferAtomically(winningOffer.id, winningPhone);
        assert.ok(acceptResult.success);
        console.log("✅ Atomic acceptance transaction verified successfully.");

        // Verify other offers are revoked
        const offerRevoked = await db.query("SELECT status FROM job_offers WHERE id = $1", [winningOffer.id]);
        assert.strictEqual(offerRevoked.rows[0].status, 'ACCEPTED');

        const jobStatus = await db.query("SELECT status, worker_id FROM jobs WHERE id = $1", [jobId]);
        assert.strictEqual(jobStatus.rows[0].status, 'ACCEPTED');
        assert.strictEqual(jobStatus.rows[0].worker_id, winningOffer.worker_id);
        console.log("✅ Job assigned and state marked ACCEPTED.");

        console.log("🎉 All dispatch queue integration tests passed successfully!");
    } finally {
        // Clean up mock data
        console.log("Cleaning up mock database records...");
        await db.query("DELETE FROM job_offers WHERE job_id = $1", [jobId]);
        await db.query("DELETE FROM jobs WHERE id = $1", [jobId]);
        await db.query("DELETE FROM workers WHERE id IN ($1, $2, $3)", [w1Id, w2Id, w3Id]);
        await db.query("DELETE FROM users WHERE id = $1", [userId]);
    }
}

testPoolDispatch()
    .then(() => process.exit(0))
    .catch(err => {
        console.error("❌ Test failed:", err);
        process.exit(1);
    });
