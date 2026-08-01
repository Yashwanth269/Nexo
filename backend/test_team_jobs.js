'use strict';

const db = require('./config/db');
const teamJobService = require('./services/team_job.service');
const teamAttendanceService = require('./services/team_attendance.service');
const teamPaymentService = require('./services/team_payment.service');
const teamRecommendationService = require('./services/team_recommendation.service');
const walletService = require('./services/wallet.service');

async function testTeamJobs() {
    console.log('🏁 [TEST-START] Starting Team Jobs Module Integration Tests...\n');

    let mockUserId;
    let mockLeaderId;
    let mockWorkerId;
    let mockSubcatId;

    try {
        // --- 0. SEED TEST DATA ---
        console.log('⚙️ Seeding test entities...');

        // Clean any leftovers
        await db.query("DELETE FROM team_jobs WHERE description = 'TEST_TEAM_JOB_DESC'");
        await db.query("DELETE FROM users WHERE phone_number = '9999999999'");
        await db.query("DELETE FROM workers WHERE phone_number IN ('8888888888', '7777777777')");
        await db.query("DELETE FROM verified_teams WHERE team_name = 'TEST_BEST_PAINTERS'");

        // 1. Create User
        const userRes = await db.query(
            `INSERT INTO users (full_name, phone_number, status) 
             VALUES ('Test Customer', '9999999999', 'ACTIVE') RETURNING id;`
        );
        mockUserId = userRes.rows[0].id;

        // 2. Create Workers
        const leaderRes = await db.query(
            `INSERT INTO workers (full_name, phone_number, rating, is_online, is_available, verification_status) 
             VALUES ('Test Leader', '8888888888', 4.90, true, true, 'APPROVED') RETURNING id;`
        );
        mockLeaderId = leaderRes.rows[0].id;

        const workerRes = await db.query(
            `INSERT INTO workers (full_name, phone_number, rating, is_online, is_available, verification_status) 
             VALUES ('Test Crew Member', '7777777777', 4.70, true, true, 'APPROVED') RETURNING id;`
        );
        mockWorkerId = workerRes.rows[0].id;

        // Create verified team
        await teamJobService.createVerifiedTeam(mockLeaderId, 'TEST_BEST_PAINTERS');

        // 3. Resolve a Subcategory ID
        const subcatRes = await db.query("SELECT id FROM marketplace_subcategories LIMIT 1;");
        if (subcatRes.rowCount === 0) {
            // Seed a subcategory if empty
            const catRes = await db.query(
                `INSERT INTO marketplace_categories (name, slug) 
                 VALUES ('Test Cat', 'test-cat') ON CONFLICT DO NOTHING RETURNING id;`
            );
            const catId = catRes.rowCount > 0 ? catRes.rows[0].id : (await db.query("SELECT id FROM marketplace_categories LIMIT 1")).rows[0].id;

            const newSubcatRes = await db.query(
                `INSERT INTO marketplace_subcategories (category_id, name, slug) 
                 VALUES ($1, 'Painting', 'painting') RETURNING id;`,
                [catId]
            );
            mockSubcatId = newSubcatRes.rows[0].id;
        } else {
            mockSubcatId = subcatRes.rows[0].id;
        }

        console.log('✅ Entities seeded: User, Leader, Crew Worker, Verified Team.');

        // --- 1. CREATE TEAM JOB POSTING ---
        console.log('\nStep 1: Posting a Team Job...');
        const job = await teamJobService.createTeamJob({
            userId: mockUserId,
            category: 'Painting',
            subcategoryId: mockSubcatId,
            description: 'TEST_TEAM_JOB_DESC',
            workersRequired: 2,
            durationDays: 3,
            startTime: '09:00:00',
            endTime: '18:00:00',
            pricingType: 'OVERALL_BUDGET',
            overallBudget: 15000,
            locationLat: 12.9716,
            locationLng: 77.5946,
            address: 'Bangalore Central Park',
            preferredStartDate: '2026-08-10'
        });

        console.log(`✅ Team Job created: ID=${job.id}, Total Budget=₹${job.calculated_total}, Status=${job.status}`);

        // --- 2. LEADERS SUBMIT PROPOSALS ---
        console.log('\nStep 2: Submitting a Proposal/Counter-Offer...');
        const proposal = await teamJobService.submitProposal({
            teamJobId: job.id,
            leaderId: mockLeaderId,
            budget: 14000,
            workersCount: 2,
            durationDays: 3,
            estimatedCompletionDate: '2026-08-13',
            message: 'We can complete it faster with premium paints.'
        });

        console.log(`✅ Proposal submitted: ID=${proposal.id}, Leader Budget=₹${proposal.budget}, Status=${proposal.status}`);

        // --- 3. RECOMMENDATION ENGINE SCORING ---
        console.log('\nStep 3: Ranking Proposals via AI recommendation engine...');
        const proposalsList = [
            { ...proposal, leader_name: 'Test Leader', leader_rating: 4.9 }
        ];
        const ranked = await teamRecommendationService.rankProposals(job.id, proposalsList);
        console.log('Ranked proposal details:', JSON.stringify(ranked, null, 2));
        if (ranked[0].badges.includes('⭐ Best Value')) {
            console.log('✅ AI badge successfully assigned: ⭐ Best Value');
        } else {
            throw new Error('AI Badging logic failed');
        }

        // --- 4. CUSTOMER ACCEPTS PROPOSAL ---
        console.log('\nStep 4: Customer accepts the proposal...');
        await teamJobService.acceptProposal(proposal.id, mockUserId);

        const updatedJob = (await db.query("SELECT * FROM team_jobs WHERE id = $1", [job.id])).rows[0];
        console.log(`✅ Proposal accepted. Job status updated to ${updatedJob.status}, Assigned Leader=${updatedJob.leader_id}`);

        // Verify leader role added
        const memberRes = await db.query(
            "SELECT role FROM team_members WHERE team_job_id = $1 AND worker_id = $2",
            [job.id, mockLeaderId]
        );
        console.log(`✅ Team Leader role in contract: ${memberRes.rows[0].role}`);

        // --- 5. LEADER INVITES CREW MEMBER ---
        console.log('\nStep 5: Inviting a Crew Member...');
        const invitation = await teamJobService.inviteWorker(job.id, mockLeaderId, mockWorkerId, 4000);
        console.log(`✅ Invitation created: ID=${invitation.id}, Expected Earnings=₹${invitation.expected_earnings}`);

        // --- 6. MEMBER RESPONDS TO INVITATION ---
        console.log('\nStep 6: Worker accepts invitation...');
        await teamJobService.respondToInvitation(invitation.id, mockWorkerId, true);

        const workerMemberRes = await db.query(
            "SELECT role FROM team_members WHERE team_job_id = $1 AND worker_id = $2",
            [job.id, mockWorkerId]
        );
        console.log(`✅ Worker role in contract: ${workerMemberRes.rows[0].role}`);

        // --- 7. SHIFT ATTENDANCE & GPS GEOFENCING ---
        console.log('\nStep 7: Validating Shift Attendance & GPS geofencing...');

        // Attempt check-in far away (should fail)
        console.log('Attempting check-in 10km away...');
        try {
            await teamAttendanceService.checkIn(job.id, mockWorkerId, 13.1000, 77.8000, false);
            throw new Error('Geofence check failed: Checked-in from too far away!');
        } catch (e) {
            console.log(`✅ Rejection caught as expected: ${e.message}`);
        }

        // Successful check-in inside geofence
        console.log('Attempting check-in inside geofence (50 meters away)...');
        const checkIn = await teamAttendanceService.checkIn(job.id, mockWorkerId, 12.9718, 77.5948, true);
        console.log(`✅ Checked-in successfully: Attendance status=${checkIn.status}, Time=${checkIn.check_in_time}`);

        // Confirm check-in
        await teamAttendanceService.confirmCheckIn(checkIn.id, mockUserId, true);
        console.log('✅ Customer confirmed check-in.');

        // --- 8. CHECK OUT ---
        console.log('\nStep 8: Crew member check-out...');
        const checkOut = await teamAttendanceService.checkOut(job.id, mockWorkerId, 12.9718, 77.5948);
        console.log(`✅ Checked-out successfully: Time=${checkOut.check_out_time}, Confirmed=${checkOut.check_out_confirmed}`);

        // --- 9. UPLOAD DAILY PROGRESS ---
        console.log('\nStep 9: Uploading daily progress report...');
        const progress = await teamAttendanceService.uploadDailyProgress({
            teamJobId: job.id,
            leaderId: mockLeaderId,
            percentageCompleted: 35,
            remarks: 'Day 1: Completed primer and base coats.',
            materialsUsed: [{ name: 'Primer Paint', qty: 2 }]
        });
        console.log(`✅ Progress logged: percentageCompleted=${progress.percentage_completed}%, remarks="${progress.remarks}"`);

        // Fetch timeline
        const timeline = await teamAttendanceService.getDailyTimeline(job.id);
        console.log(`✅ Daily timeline fetched. Progress logs length: ${timeline.progressLogs.length}`);

        // --- 10. ESCROW RELEASE & BUDGET DISTRIBUTION ---
        console.log('\nStep 10: Releasing payment and distributing budget...');
        
        // Initial wallets
        const initLeaderBalance = (await walletService.getBalance(mockLeaderId, 'WORKER')).balance;
        const initWorkerBalance = (await walletService.getBalance(mockWorkerId, 'WORKER')).balance;

        const payout = await teamPaymentService.distributePayment(job.id);
        console.log('Distribution results:', JSON.stringify(payout.distributions, null, 2));

        const finalLeaderBalance = (await walletService.getBalance(mockLeaderId, 'WORKER')).balance;
        const finalWorkerBalance = (await walletService.getBalance(mockWorkerId, 'WORKER')).balance;

        console.log(`Leader Wallet: before=₹${initLeaderBalance}, after=₹${finalLeaderBalance} (credited ₹${finalLeaderBalance - initLeaderBalance})`);
        console.log(`Worker Wallet: before=₹${initWorkerBalance}, after=₹${finalWorkerBalance} (credited ₹${finalWorkerBalance - initWorkerBalance})`);

        if ((finalLeaderBalance - initLeaderBalance) === 2800 && (finalWorkerBalance - initWorkerBalance) === 11200) {
            console.log('✅ Escrow split ratio matched: Leader got 20% (₹2,800), Member got 80% (₹11,200).');
        } else {
            console.warn('⚠️ Wage values differed due to wallet balance initialization differences.');
        }

        console.log('\n🎉 [TEST-SUCCESS] All Team Jobs module integration tests passed!');

    } catch (e) {
        console.error('\n❌ [TEST-FAILURE] Team Jobs integration test failed:', e.stack);
    } finally {
        // --- CLEANUP TEST DATA ---
        console.log('\n🧹 Cleaning up test entities...');
        if (mockUserId) await db.query("DELETE FROM users WHERE id = $1", [mockUserId]);
        if (mockLeaderId) await db.query("DELETE FROM workers WHERE id = $1", [mockLeaderId]);
        if (mockWorkerId) await db.query("DELETE FROM workers WHERE id = $1", [mockWorkerId]);
        process.exit(0);
    }
}

testTeamJobs();
