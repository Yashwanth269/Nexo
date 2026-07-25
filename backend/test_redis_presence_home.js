const db = require('./config/db');
const redis = require('./config/redis');

const presenceService = require('./services/worker_presence.service');
const travelHome = require('./services/travel_home_engine.service');

async function runTests() {
    console.log("🧪 Starting Nexo Redis Presence and Travel Home Corridor Integration Tests...");

    const workerId = '4e8b3941-893d-4c3e-8687-0b1a03c3961f';
    const customerId = '11111111-1111-1111-1111-111111111111';
    const jobId1 = '8c22502f-b4de-4d0f-8567-de5c1b5a2bf9';
    const jobId2 = '99999999-9999-9999-9999-999999999999';

    try {
        // --- Setup mock database entities ---
        await db.query("DELETE FROM event_logs WHERE worker_id = $1", [workerId]);
        await db.query("DELETE FROM jobs WHERE id IN ($1, $2)", [jobId1, jobId2]);
        await db.query("DELETE FROM workers WHERE id = $1", [workerId]);

        await db.query(`
            INSERT INTO workers (id, phone_number, full_name, is_online, is_available, verification_status)
            VALUES ($1, '9999999999', 'Redis Presence Worker', true, true, 'VERIFIED')
        `, [workerId]);

        await db.query(`
            INSERT INTO jobs (id, user_id, status, category, price, location_lat, location_lng)
            VALUES ($1, $2, 'OPEN', 'AC REPAIR', 400.00, 12.9300, 77.6300)
        `, [jobId1, customerId]);

        await db.query(`
            INSERT INTO jobs (id, user_id, status, category, price, location_lat, location_lng)
            VALUES ($1, $2, 'OPEN', 'AC REPAIR', 500.00, 12.9200, 77.6350)
        `, [jobId2, customerId]);

        // Clean redis keys first
        await redis.del(`worker_presence:${workerId}`);
        await redis.del(`travel_home:session:${workerId}`);
        await redis.del(`idempotency:test_key_123`);

        // --- TEST 1: Redis Presence heartbeats & checks ---
        console.log("\n--- TEST 1: Redis Presence Heartbeats ---");
        const hb = await presenceService.processHeartbeat(workerId, {
            lat: 12.9352,
            lng: 77.6245,
            batteryLevel: 92,
            speed: 5,
            zone: "koramangala",
            category: "electricians"
        });

        console.log("Heartbeat processed successfully:", hb.success);
        if (!hb.success) {
            throw new Error("Heartbeat registration failed.");
        }

        // Verify presence is stored in Redis
        const presence = await presenceService.getPresence(workerId);
        console.log("Presence parsed from Redis:", JSON.stringify(presence));
        if (!presence || presence.batteryLevel !== 92 || presence.status !== "ONLINE") {
            throw new Error("Presence data in Redis is inconsistent or missing!");
        }

        // --- TEST 2: Redis Idempotency ---
        console.log("\n--- TEST 2: Redis Idempotency caching ---");
        const mockRes = { success: true, txnId: '999' };
        await presenceService.saveIdempotency('test_key_123', mockRes);

        const cached = await presenceService.checkIdempotency('test_key_123');
        console.log("Cached response retrieved:", JSON.stringify(cached));
        if (!cached || cached.txnId !== '999') {
            throw new Error("Idempotency cache lookup failed!");
        }
        console.log("✅ Idempotency test passed.");

        // --- TEST 3: Travel Home Corridor and Multi-Job Optimization ---
        console.log("\n--- TEST 3: Travel Home Navigation Corridors & Chaining ---");
        
        // Start travel home mode towards home (Koramangala South)
        const homeLoc = {
            address: 'South HSR Sector 3',
            lat: 12.9100, // home lat
            lng: 77.6400, // home lng
            startLat: 12.9400,
            startLng: 77.6200
        };

        const sessionRes = await travelHome.startTravelHomeMode(workerId, homeLoc);
        console.log("Travel Home session started:", sessionRes.success);
        if (!sessionRes.success) {
            throw new Error("Failed to start travel home session");
        }

        // Query jobs along the path
        const candidateJobs = [
            { id: jobId1, category: 'AC REPAIR', price: 400.00, location_lat: 12.9300, location_lng: 77.6300 }, // Along path
            { id: jobId2, category: 'AC REPAIR', price: 500.00, location_lat: 12.9200, location_lng: 77.6350 }  // Along path
        ];

        const analysis = await travelHome.filterAndRankRouteJobs(workerId, candidateJobs, { lat: 12.9400, lng: 77.6200 });
        console.log("Travel home analysis results:", JSON.stringify(analysis));
        
        if (!analysis.isInTravelHomeMode) {
            throw new Error("Analysis failed to recognize active travel home mode!");
        }
        if (analysis.jobs.length !== 2) {
            throw new Error("Failed to match jobs along the corridor!");
        }

        console.log("Optimized Multi-Job Chaining Output:", JSON.stringify(analysis.optimizedRouteChains));
        if (analysis.optimizedRouteChains.length === 0 || analysis.optimizedRouteChains[0].totalJobs !== 2) {
            throw new Error("Multi-job route optimizer failed to build the chain sequence!");
        }

        console.log("✅ Travel Home Corridor & Multi-job chaining verification passed.");

        console.log("\n🎉 All Redis presence and travel home corridor tests completed successfully!");
        process.exit(0);
    } catch (e) {
        console.error("\n❌ TEST FAILED:", e.message, e.stack);
        process.exit(1);
    }
}

runTests();
