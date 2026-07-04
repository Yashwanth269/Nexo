const db = require('./config/db');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
    console.log("🧪 STARTING TRUST AND SAFETY INTEGRATION TESTS...");

    const testUserId = uuidv4();
    const testWorkerId = uuidv4();
    const testTaskId = uuidv4();
    const testUserPhone = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const testWorkerPhone = Math.floor(1000000000 + Math.random() * 9000000000).toString();

    try {
        // 1. Reset/Prepare database records
        console.log("🧹 Preparing clean database state...");
        await db.query("DELETE FROM job_cancellation_audit WHERE cancelled_by_id IN ($1, $2)", [testUserId, testWorkerId]);
        await db.query("DELETE FROM user_reliability_events WHERE user_id = $1", [testUserId]);
        await db.query("DELETE FROM worker_reliability_events WHERE worker_id = $1", [testWorkerId]);
        await db.query("DELETE FROM job_offers WHERE job_id IN (SELECT id FROM jobs WHERE user_id = $1 OR worker_id = $2)", [testUserId, testWorkerId]);
        await db.query("DELETE FROM jobs WHERE user_id = $1 OR worker_id = $2", [testUserId, testWorkerId]);
        
        await db.query("DELETE FROM users WHERE id = $1 OR phone_number = $2", [testUserId, testUserPhone]);
        await db.query("INSERT INTO users (id, phone_number, full_name, status, reliability_score) VALUES ($1, $2, 'Test User', 'ACTIVE', 100)", [testUserId, testUserPhone]);
        
        await db.query("DELETE FROM workers WHERE id = $1 OR phone_number = $2", [testWorkerId, testWorkerPhone]);
        await db.query("INSERT INTO workers (id, phone_number, full_name, reliability_score) VALUES ($1, $2, 'Test Worker', 5.0)", [testWorkerId, testWorkerPhone]);

        // ==========================================
        // TEST CASE 1: Normal Job Creation
        // ==========================================
        console.log("\n🔹 Test Case 1: Job Creation");
        const createRes = await fetch(`${BASE_URL}/jobs/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: testUserId,
                serviceType: 'Plumber',
                description: 'Leaking pipe under kitchen sink',
                lat: 12.9715987,
                lng: 77.5945627,
                price: 500,
                taskId: testTaskId
            })
        });
        const createData = await createRes.json();
        if (!createData.success) throw new Error("Job creation failed: " + JSON.stringify(createData));
        const jobId = createData.job.id;
        console.log(`✅ Job created successfully: ${jobId}`);

        // ==========================================
        // TEST CASE 2: Accept Job and Start Journey
        // ==========================================
        console.log("\n🔹 Test Case 2: Accept Job & Start Journey");
        // Assign worker manually
        await db.query("UPDATE jobs SET worker_id = $1, status = 'ACCEPTED' WHERE id = $2", [testWorkerId, jobId]);
        
        // Transition status to ON_THE_WAY
        const oRes = await fetch(`${BASE_URL}/jobs/${jobId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workerId: testWorkerId,
                newStatus: 'ON_THE_WAY',
                lat: 12.9715987,
                lng: 77.5945627
            })
        });
        const oData = await oRes.json();
        if (!oData.success) throw new Error("Failed to transition status to ON_THE_WAY: " + JSON.stringify(oData));
        console.log("✅ Job status transitioned to ON_THE_WAY");

        // ==========================================
        // TEST CASE 3: Late Cancellation without Reason
        // ==========================================
        console.log("\n🔹 Test Case 3: Late Cancellation without Reason (Expected 400)");
        const cancelNoReasonRes = await fetch(`${BASE_URL}/jobs/${testUserId}/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'CANCELLED'
            })
        });
        const cancelNoReasonData = await cancelNoReasonRes.json();
        if (cancelNoReasonRes.status === 400 && cancelNoReasonData.error === 'LATE_CANCEL_REASON_REQUIRED') {
            console.log("✅ API correctly rejected late cancellation without reason.");
        } else {
            throw new Error(`Expected LATE_CANCEL_REASON_REQUIRED, got: ${cancelNoReasonRes.status} - ${JSON.stringify(cancelNoReasonData)}`);
        }

        // ==========================================
        // TEST CASE 4: Late Cancellation with Reason
        // ==========================================
        console.log("\n🔹 Test Case 4: Late Cancellation with Reason (Expected 200, Score deduction)");
        const cancelWithReasonRes = await fetch(`${BASE_URL}/jobs/${testUserId}/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'CANCELLED',
                reason: 'Emergency situation',
                notes: 'Family emergency, must cancel'
            })
        });
        const cancelWithReasonData = await cancelWithReasonRes.json();
        if (!cancelWithReasonData.success) throw new Error("Late cancellation failed: " + JSON.stringify(cancelWithReasonData));
        
        // Check reliability score in DB
        const scoreRes = await db.query("SELECT reliability_score, status FROM users WHERE id = $1", [testUserId]);
        const score = scoreRes.rows[0].reliability_score;
        if (score !== 95) throw new Error(`Expected score 95, got ${score}`);
        console.log(`✅ Late cancellation succeeded. User reliability score reduced to: ${score}`);

        // Verify audit logs
        const auditRes = await db.query("SELECT * FROM job_cancellation_audit WHERE job_id = $1", [jobId]);
        if (auditRes.rowCount === 0) throw new Error("Cancellation audit log not found");
        console.log(`✅ Cancellation audit logged: Reason: ${auditRes.rows[0].reason}`);

        // Verify reliability event logs
        const eventRes = await db.query("SELECT * FROM user_reliability_events WHERE user_id = $1", [testUserId]);
        if (eventRes.rowCount === 0) throw new Error("Reliability event log not found");
        console.log(`✅ User reliability event logged: Points Delta: ${eventRes.rows[0].points_delta}`);

        // ==========================================
        // TEST CASE 5: Restricting user (3 cancellations)
        // ==========================================
        console.log("\n🔹 Test Case 5: Restricting user on repeated cancellations");
        
        // Trigger 2 more late cancellations
        for (let i = 0; i < 2; i++) {
            const jId = uuidv4();
            await db.query(
                "INSERT INTO jobs (id, user_id, category, description, location_lat, location_lng, price, status, worker_id) VALUES ($1, $2, 'Plumber', 'Leak', 12.9, 77.5, 500, 'ON_THE_WAY', $3)",
                [jId, testUserId, testWorkerId]
            );
            await fetch(`${BASE_URL}/jobs/${testUserId}/${jId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'CANCELLED',
                    reason: 'Repeated cancellation test'
                })
            });
        }

        const restrictedCheck = await db.query("SELECT status, reliability_score FROM users WHERE id = $1", [testUserId]);
        if (restrictedCheck.rows[0].status !== 'RESTRICTED') {
            throw new Error(`Expected RESTRICTED status, got: ${restrictedCheck.rows[0].status}`);
        }
        console.log(`✅ User account restricted successfully. Status: ${restrictedCheck.rows[0].status}, Score: ${restrictedCheck.rows[0].reliability_score}`);

        // ==========================================
        // TEST CASE 6: Post Job as Restricted User (Expected 403)
        // ==========================================
        console.log("\n🔹 Test Case 6: Block Job Creation for Restricted User (Expected 403)");
        const restrictedPostRes = await fetch(`${BASE_URL}/jobs/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: testUserId,
                serviceType: 'Plumber',
                description: 'Leaking pipe under kitchen sink',
                lat: 12.9715987,
                lng: 77.5945627,
                price: 500,
                taskId: testTaskId
            })
        });
        const restrictedPostData = await restrictedPostRes.json();
        if (restrictedPostRes.status === 403 && restrictedPostData.error === 'ACCOUNT_RESTRICTED') {
            console.log("✅ API successfully blocked restricted user from booking new jobs.");
        } else {
            throw new Error(`Expected 403 ACCOUNT_RESTRICTED, got: ${restrictedPostRes.status} - ${JSON.stringify(restrictedPostData)}`);
        }

        // ==========================================
        // TEST CASE 7: Worker Emergency Reassignment
        // ==========================================
        console.log("\n🔹 Test Case 7: Worker Emergency Reassignment");
        
        // Reset user status to active to create job
        await db.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [testUserId]);
        
        const newJobRes = await fetch(`${BASE_URL}/jobs/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: testUserId,
                serviceType: 'Plumber',
                description: 'Kitchen sink pipe repair',
                lat: 12.9715987,
                lng: 77.5945627,
                price: 500,
                taskId: testTaskId
            })
        });
        const newJobData = await newJobRes.json();
        if (!newJobData.success) {
            console.error("DEBUG: Job creation in Test Case 7 failed with response:", newJobData);
        }
        const reassignJobId = newJobData.job.id;
        
        // Assign worker & set status to ON_THE_WAY
        await db.query("UPDATE jobs SET worker_id = $1, status = 'ON_THE_WAY' WHERE id = $2", [testWorkerId, reassignJobId]);

        // Call reassign endpoint
        const reassignRes = await fetch(`${BASE_URL}/jobs/${reassignJobId}/worker-reassign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workerId: testWorkerId,
                reason: 'Vehicle breakdown / flat tire',
                note: 'Rear tire got punctured'
            })
        });
        const reassignData = await reassignRes.json();
        if (!reassignData.success) throw new Error("Reassignment failed: " + JSON.stringify(reassignData));

        // Verify DB updates
        const updatedJobRes = await db.query("SELECT status, worker_id FROM jobs WHERE id = $1", [reassignJobId]);
        const updatedJob = updatedJobRes.rows[0];
        if (updatedJob.status !== 'OPEN' || updatedJob.worker_id !== null) {
            throw new Error(`Expected status 'OPEN' and worker_id NULL, got status: ${updatedJob.status}, worker_id: ${updatedJob.worker_id}`);
        }
        console.log(`✅ Job reverted to status: ${updatedJob.status}, Worker assignment cleared: ${updatedJob.worker_id === null}`);

        // Verify worker reliability score and event logs
        const updatedWorkerRes = await db.query("SELECT reliability_score FROM workers WHERE id = $1", [testWorkerId]);
        const workerScore = parseFloat(updatedWorkerRes.rows[0].reliability_score);
        if (workerScore !== 4.9) throw new Error(`Expected worker reliability rating 4.9, got ${workerScore}`);
        console.log(`✅ Worker reliability rating penalized. New rating: ${workerScore}`);

        const workerEventRes = await db.query("SELECT * FROM worker_reliability_events WHERE worker_id = $1", [testWorkerId]);
        if (workerEventRes.rowCount === 0) throw new Error("Worker reliability event log not found");
        console.log(`✅ Worker reliability event logged: Points Delta: ${workerEventRes.rows[0].points_delta}`);

        const reassignAuditRes = await db.query("SELECT * FROM job_cancellation_audit WHERE job_id = $1", [reassignJobId]);
        if (reassignAuditRes.rowCount === 0) throw new Error("Reassignment audit log not found");
        console.log(`✅ Reassignment audit logged: Reason: ${reassignAuditRes.rows[0].reason}`);

        // Clean up test data
        console.log("\n🧹 Cleaning up test data...");
        await db.query("DELETE FROM job_cancellation_audit WHERE cancelled_by_id IN ($1, $2)", [testUserId, testWorkerId]);
        await db.query("DELETE FROM user_reliability_events WHERE user_id = $1", [testUserId]);
        await db.query("DELETE FROM worker_reliability_events WHERE worker_id = $1", [testWorkerId]);
        await db.query("DELETE FROM job_offers WHERE job_id IN (SELECT id FROM jobs WHERE user_id = $1 OR worker_id = $2)", [testUserId, testWorkerId]);
        await db.query("DELETE FROM jobs WHERE user_id = $1 OR worker_id = $2", [testUserId, testWorkerId]);
        await db.query("DELETE FROM users WHERE id = $1", [testUserId]);
        await db.query("DELETE FROM workers WHERE id = $1", [testWorkerId]);

        console.log("\n🎉 ALL TRUST & SAFETY INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n");
        process.exit(0);
    } catch (err) {
        console.error("\n❌ TEST FAILURE:", err.message);
        process.exit(1);
    }
}

runTests();
