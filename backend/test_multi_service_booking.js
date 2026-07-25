const db = require('./config/db');
const redis = require('./config/redis');
const { setIO } = require('./config/socket');
const optimizer = require('./services/multi_service_optimizer.service');
const bookingService = require('./services/multi_service_booking.service');
const assert = require('assert');

// 1. Mock socket.io to log notifications
setIO({
    to: (room) => ({
        emit: (event, data) => {
            console.log(`[MOCK SOCKET EMIT] room=${room} event=${event}`, data);
        }
    })
});

async function runTests() {
    console.log("🧪 Starting Multi-Service Booking Engine Integration Tests...");

    // Clean up database
    await db.query("DELETE FROM multi_service_addon_offers");
    await db.query("DELETE FROM multi_service_assignments");
    await db.query("DELETE FROM multi_service_booking_items");
    await db.query("DELETE FROM multi_service_bookings");
    await db.query("DELETE FROM worker_calendar");
    await db.query("DELETE FROM worker_skill_confidence WHERE worker_id IN (SELECT id FROM workers WHERE phone_number IN ('8888888881', '8888888882', '8888888883'))");
    await db.query("DELETE FROM workers WHERE phone_number IN ('8888888881', '8888888882', '8888888883')");
    await db.query("DELETE FROM users WHERE phone_number = '8888888880'");

    // Create User
    const userRes = await db.query(
        "INSERT INTO users (full_name, phone_number) VALUES ('Multi Customer', '8888888880') RETURNING id"
    );
    const userId = userRes.rows[0].id;

    // Create Workers:
    // Worker A: AC Repair, Fan Installation
    const wARes = await db.query(`
        INSERT INTO workers (full_name, phone_number, skills, is_online, is_available, verification_status, location_cube)
        VALUES ('Worker A', '8888888881', '{"AC Repair", "Fan Installation"}', true, true, 'VERIFIED', ll_to_earth(12.9716, 77.5946))
        RETURNING id
    `);
    const wAId = wARes.rows[0].id;

    // Worker B: Plumbing, Painting
    const wBRes = await db.query(`
        INSERT INTO workers (full_name, phone_number, skills, is_online, is_available, verification_status, location_cube)
        VALUES ('Worker B', '8888888882', '{"Plumbing", "Painting"}', true, true, 'VERIFIED', ll_to_earth(12.9716, 77.5946))
        RETURNING id
    `);
    const wBId = wBRes.rows[0].id;

    // Worker C: AC Repair, Fan Installation, Plumbing, Painting (Complete match)
    const wCRes = await db.query(`
        INSERT INTO workers (full_name, phone_number, skills, is_online, is_available, verification_status, location_cube)
        VALUES ('Worker C', '8888888883', '{"AC Repair", "Fan Installation", "Plumbing", "Painting"}', true, true, 'VERIFIED', ll_to_earth(12.9716, 77.5946))
        RETURNING id
    `);
    const wCId = wCRes.rows[0].id;

    // Seed skill confidence scores
    const skills = [
        { id: wAId, cat: 'AC REPAIR' },
        { id: wAId, cat: 'FAN INSTALLATION' },
        { id: wBId, cat: 'PLUMBING' },
        { id: wBId, cat: 'PAINTING' },
        { id: wCId, cat: 'AC REPAIR' },
        { id: wCId, cat: 'FAN INSTALLATION' },
        { id: wCId, cat: 'PLUMBING' },
        { id: wCId, cat: 'PAINTING' }
    ];

    for (const s of skills) {
        await db.query(`
            INSERT INTO worker_skill_confidence (worker_id, category, confidence_score, jobs_completed, avg_rating, dispute_count, repeat_customer_count, calculated_at)
            VALUES ($1, $2, 90.00, 10, 4.8, 0, 1, NOW())
        `, [s.id, s.cat]);
    }

    // --- TEST 1: Optimizer Single Worker (Complete match) ---
    console.log("--- TEST 1: Optimizer Complete Match ---");
    const requested = ['AC Repair', 'Fan Installation', 'Plumbing', 'Painting'];
    const optResult1 = await optimizer.findOptimalPlans(requested, 12.9716, 77.5946, userId);
    const plans1 = optResult1.plans;
    
    assert.ok(plans1.length > 0, "Should generate at least one plan");
    // The top plan should ideally be the SINGLE_WORKER plan with Worker C
    const topPlan = plans1[0];
    console.log(`Top plan type: ${topPlan.planType}, cost: ${topPlan.totalPrice}`);
    assert.strictEqual(topPlan.planType, 'SINGLE_WORKER');
    assert.strictEqual(topPlan.assignments.length, 1);
    assert.strictEqual(topPlan.assignments[0].workerId, wCId);

    // --- TEST 2: Optimizer Multi-Worker Set Cover fallback ---
    console.log("--- TEST 2: Set Cover Fallback (Worker C Offline) ---");
    // Make Worker C offline
    await db.query("UPDATE workers SET is_online = false WHERE id = $1", [wCId]);

    const optResult2 = await optimizer.findOptimalPlans(requested, 12.9716, 77.5946, userId);
    const plans2 = optResult2.plans;
    assert.ok(plans2.length > 0);
    // The top plan should now be a MULTI_WORKER plan using Worker A and Worker B
    const topMultiPlan = plans2.find(p => p.planType === 'MULTI_WORKER');
    assert.ok(topMultiPlan, "Should have a multi-worker set cover solution");
    console.log(`Multi-worker plan size: ${topMultiPlan.assignments.length}`);
    assert.strictEqual(topMultiPlan.assignments.length, 2);
    const assignedIds = topMultiPlan.assignments.map(a => a.workerId);
    assert.ok(assignedIds.includes(wAId));
    assert.ok(assignedIds.includes(wBId));

    // --- TEST 3: Booking Workflow Lifecycle ---
    console.log("--- TEST 3: Booking Creation and Plan Acceptance ---");
    // Restore Worker C online
    await db.query("UPDATE workers SET is_online = true WHERE id = $1", [wCId]);

    const services = [
        { category: 'AC Repair', price: 300 },
        { category: 'Painting', price: 500 }
    ];

    // Create booking draft
    const bookingRes = await bookingService.createBooking(userId, services, {
        lat: 12.9716,
        lng: 77.5946,
        address: '123 Tech Park',
        notes: 'Hurry up!'
    });

    console.log(`Booking created: ID ${bookingRes.bookingId}, plans found: ${bookingRes.plans.length}`);
    assert.ok(bookingRes.bookingId);
    assert.ok(bookingRes.plans.length > 0);

    // Accept Plan 0 (Single worker plan with Worker C covering both AC Repair and Painting)
    const acceptRes = await bookingService.acceptPlan(bookingRes.bookingId, 0, userId);
    assert.ok(acceptRes.success);
    assert.strictEqual(acceptRes.assignments.length, 1);
    assert.strictEqual(acceptRes.assignments[0].worker_id, wCId);

    // Verify booking items are created and status updated
    const items = await db.query("SELECT * FROM multi_service_booking_items WHERE booking_id = $1", [bookingRes.bookingId]);
    assert.strictEqual(items.rowCount, 2);
    assert.ok(items.rows.every(r => r.status === 'ASSIGNED'));

    // Worker C accepts assignment
    console.log("Worker C accepting assignment...");
    const acceptAssignmentRes = await bookingService.workerAcceptsAssignment(acceptRes.assignments[0].id, wCId);
    assert.strictEqual(acceptAssignmentRes.bookingStatus, 'ACCEPTED');

    // Verify calendar block is added
    const calendar = await db.query("SELECT * FROM worker_calendar WHERE multi_service_booking_id = $1", [bookingRes.bookingId]);
    assert.strictEqual(calendar.rowCount, 1);
    assert.strictEqual(calendar.rows[0].worker_id, wCId);

    // --- TEST 4: Add-on Suggestions ---
    console.log("--- TEST 4: Suggesting and Accepting Addons ---");
    // Worker C suggests a Plumbing addon for 400
    const addon = await bookingService.suggestAddon(bookingRes.bookingId, wCId, 'Plumbing', 400.00, 'Fix sink leak');
    assert.ok(addon.id);
    assert.strictEqual(addon.status, 'PENDING');

    // Customer accepts the addon
    const addonResponse = await bookingService.respondToAddon(addon.id, userId, true);
    assert.strictEqual(addonResponse.status, 'ACCEPTED');

    // Verify booking total price is updated
    const updatedBooking = await db.query("SELECT total_price FROM multi_service_bookings WHERE id = $1", [bookingRes.bookingId]);
    // Base price was 250 (AC) + 250 (Painting) + 400 (Plumbing Addon) = 900, plus 50 travel, 40 platform, -50 discount = 940
    console.log(`Updated booking total price: ${updatedBooking.rows[0].total_price}`);
    assert.strictEqual(parseFloat(updatedBooking.rows[0].total_price), 940.00);

    // Verify new booking item is created
    const addonItem = await db.query("SELECT * FROM multi_service_booking_items WHERE booking_id = $1 AND service_category = 'PLUMBING'", [bookingRes.bookingId]);
    assert.strictEqual(addonItem.rowCount, 1);
    assert.strictEqual(addonItem.rows[0].status, 'ASSIGNED');

    // --- TEST 5: Worker Cancellation and Dynamic Replanning ---
    console.log("--- TEST 5: Worker Declines Assignment and Triggers Replanning ---");
    // Let's create a new multi-worker booking with AC Repair and Plumbing assigned to Worker A and Worker B
    // Worker C goes offline to force multi-worker plan selection
    await db.query("UPDATE workers SET is_online = false WHERE id = $1", [wCId]);

    const newBooking = await bookingService.createBooking(userId, [
        { category: 'AC Repair', price: 300 },
        { category: 'Plumbing', price: 400 }
    ], { lat: 12.9716, lng: 77.5946 });

    // Accept multi-worker plan
    const newAccept = await bookingService.acceptPlan(newBooking.bookingId, 0, userId);
    // Find the assignment for Worker A
    const assignA = newAccept.assignments.find(a => a.worker_id === wAId);
    assert.ok(assignA, "Should have assignment for Worker A");

    // Worker A declines the assignment -> triggers replanning
    console.log("Worker A declining assignment... trigger replan");
    const declineRes = await bookingService.workerDeclinesAssignment(assignA.id, wAId);
    assert.ok(declineRes.success);

    // Verify replanned assignment is created for another candidate (e.g. Worker B or another online worker)
    const newAssignments = await db.query("SELECT * FROM multi_service_assignments WHERE booking_id = $1 AND status = 'PENDING_ACCEPTANCE'", [newBooking.bookingId]);
    console.log(`Replanned pending assignments count: ${newAssignments.rowCount}`);
    assert.ok(newAssignments.rowCount > 0, "Should have created new assignments during replanning");

    console.log("🎉 All Multi-Service Booking integration tests passed successfully!");
    process.exit(0);
}

runTests().catch(e => {
    console.error("❌ Test run failed:", e);
    process.exit(1);
});
