const db = require('./config/db');
const scheduledBiddingService = require('./services/scheduled_bidding.service');
const dispatchQueueService = require('./services/dispatch_queue.service');
const migrationRunner = require('./services/migration_runner.service');

async function testScheduledBiddingEngine() {
    console.log("🚀 [TEST-START] Starting Scheduled Bidding Engine Integration Tests...");

    try {
        // Run database migrations
        await migrationRunner.runAllMigrations();

        // 1. Create mock Customer
        const userPhone = `+9199999${Math.floor(10000 + Math.random() * 90000)}`;
        const userRes = await db.query(
            `INSERT INTO users (full_name, phone_number) VALUES ($1, $2) RETURNING id`,
            ["Test Customer", userPhone]
        );
        const userId = userRes.rows[0].id;
        console.log(`👤 Created Test Customer: ${userId}`);

        // 2. Create mock Workers (Worker A & Worker B)
        const workerAPhone = `+9188888${Math.floor(10000 + Math.random() * 90000)}`;
        const workerBPhone = `+9177777${Math.floor(10000 + Math.random() * 90000)}`;

        const wARes = await db.query(
            `INSERT INTO workers (full_name, phone_number, rating, jobs_completed, verification_status, languages, current_lat, current_lng)
             VALUES ('Rajesh Kumar', $1, 4.9, 142, 'VERIFIED', ARRAY['Kannada', 'English'], 12.9716, 77.5946) RETURNING id`,
            [workerAPhone]
        );
        const workerAId = wARes.rows[0].id;

        const wBRes = await db.query(
            `INSERT INTO workers (full_name, phone_number, rating, jobs_completed, verification_status, languages, current_lat, current_lng)
             VALUES ('Anil Sharma', $1, 4.7, 89, 'VERIFIED', ARRAY['Hindi', 'English'], 12.9725, 77.5950) RETURNING id`,
            [workerBPhone]
        );
        const workerBId = wBRes.rows[0].id;
        console.log(`👷 Created Test Workers: Worker A (${workerAId}), Worker B (${workerBId})`);

        // 3. Create a Scheduled Job starting 5 Hours in the Future
        const scheduledTime = new Date(Date.now() + 5 * 3600 * 1000); // +5 hours
        const jobRes = await db.query(
            `INSERT INTO jobs (user_id, category, title, description, location_lat, location_lng, address, price, status, scheduled_at)
             VALUES ($1, 'Plumbing', 'Master Plumbing Maintenance', 'Fix pipe leaks and valves in residential complex', 12.9750, 77.5960, 'Koramangala, Bangalore', 1500.00, 'SCHEDULED', $2)
             RETURNING *`,
            [userId, scheduledTime]
        );
        const job = jobRes.rows[0];
        console.log(`📅 Created Scheduled Job ${job.id} starting at ${scheduledTime.toISOString()}`);

        // 4. Test Eligibility Function
        const isEligible = scheduledBiddingService.isScheduledBiddingEligible(job.scheduled_at);
        console.log(`🔍 Scheduled Bidding Eligibility Check: ${isEligible ? 'PASSED (Eligible)' : 'FAILED'}`);
        if (!isEligible) throw new Error("Job should be eligible for scheduled bidding!");

        // 5. Worker A accepts standard price
        console.log("\n📩 Worker A submitting acceptance...");
        const offerA = await scheduledBiddingService.submitScheduledOffer(job.id, workerAId, {
            offerPrice: 1500.00,
            isAcceptance: true
        });
        console.log(`Offer A Result:`, offerA);
        if (!offerA.success) throw new Error(`Offer A submission failed: ${offerA.error || offerA.message}`);

        // 6. Worker B submits counter offer with custom price & note
        console.log("\n📩 Worker B submitting counter offer...");
        const offerB = await scheduledBiddingService.submitScheduledOffer(job.id, workerBId, {
            offerPrice: 1350.00,
            notes: "Can start 15 mins early if needed. Specialized in leak repairs.",
            isAcceptance: false
        });
        console.log(`Offer B Result:`, offerB);
        if (!offerB.success) throw new Error(`Offer B submission failed: ${offerB.error || offerB.message}`);

        // 7. Verify Job Status remains open / SCHEDULED_BIDDING and not locked to single worker
        const checkJobRes = await db.query("SELECT status, worker_id FROM jobs WHERE id = $1", [job.id]);
        console.log(`\n📊 Job Status after 2 offers: Status='${checkJobRes.rows[0].status}', WorkerId=${checkJobRes.rows[0].worker_id}`);
        if (checkJobRes.rows[0].worker_id !== null) {
            throw new Error("Scheduled job worker_id should remain NULL until customer makes a selection!");
        }

        // 8. Fetch Comparison Offers for Customer
        console.log("\n📋 Customer fetching worker comparison offers...");
        const comparisonList = await scheduledBiddingService.fetchJobOffers(job.id, userId);
        console.log(`Offers Count: ${comparisonList.offers_count}`);
        console.log(`First Offer Worker: ${comparisonList.offers[0]?.worker_name} (₹${comparisonList.offers[0]?.price})`);
        console.log(`Second Offer Worker: ${comparisonList.offers[1]?.worker_name} (₹${comparisonList.offers[1]?.price}, Note: "${comparisonList.offers[1]?.counter_notes}")`);

        if (comparisonList.offers_count !== 2) throw new Error("Expected 2 offers in comparison list!");

        // 9. Customer Selects Worker B (Counter Offer Winner)
        console.log("\n🏆 Customer selecting Worker B...");
        const selectionResult = await scheduledBiddingService.selectWinningWorker(job.id, userId, workerBId, offerB.offerId);
        console.log(`Selection Result:`, selectionResult);
        if (!selectionResult.success) throw new Error(`Worker selection failed: ${selectionResult.error || selectionResult.message}`);

        // 10. Verify Final Job & Worker State
        const finalJobRes = await db.query("SELECT status, worker_id, price FROM jobs WHERE id = $1", [job.id]);
        console.log(`\n✅ Final Job State: Status='${finalJobRes.rows[0].status}', WorkerId=${finalJobRes.rows[0].worker_id}, Price=₹${finalJobRes.rows[0].price}`);
        if (finalJobRes.rows[0].status !== 'ACCEPTED' || finalJobRes.rows[0].worker_id !== workerBId) {
            throw new Error("Job state did not update to ACCEPTED with winning worker!");
        }

        // Verify Worker Calendar Reservation
        const calendarRes = await db.query("SELECT * FROM worker_calendar WHERE booking_id = $1", [job.id]);
        console.log(`📅 Worker Calendar Reservations Created: ${calendarRes.rowCount}`);
        if (calendarRes.rowCount === 0) throw new Error("Worker calendar block was not reserved!");

        // Verify Non-Selected Offer Status
        const nonSelectedOfferRes = await db.query("SELECT status FROM job_offers WHERE id = $1", [offerA.offerId]);
        console.log(`Offer A Status after selection: ${nonSelectedOfferRes.rows[0].status}`);
        if (nonSelectedOfferRes.rows[0].status !== 'NOT_SELECTED') {
            throw new Error("Remaining offers should be marked as NOT_SELECTED!");
        }

        console.log("\n⭐ ALL SCHEDULED BIDDING ENGINE TESTS PASSED PERFECTLY! ⭐");
    } catch (err) {
        console.error("❌ [TEST-FAILURE]", err);
        process.exit(1);
    } finally {
        await db.pool.end();
    }
}

testScheduledBiddingEngine();
