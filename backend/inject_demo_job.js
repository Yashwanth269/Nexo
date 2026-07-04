const db = require('./config/db');
const redis = require('./config/redis');
const { v4: uuidv4 } = require('uuid');

async function inject() {
    const jobId = uuidv4();
    const userId = uuidv4();
    const lat = 13.1414867;
    const lng = 78.14465;

    console.log("💉 Injecting Demo Job at:", lat, lng);

    try {
        // 0. Ensure user exists
        await db.query(
            "INSERT INTO users (id, phone_number) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [userId, '9999999999']
        );

        // 1. Insert into DB
        await db.query(
            "INSERT INTO jobs (id, user_id, category, description, location_lat, location_lng, price, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            [jobId, userId, 'Electrician', 'URGENT: Main board short circuit. Need immediate help.', lat, lng, 850, 'OPEN']
        );

        // 2. Sync to Redis Mock
        await redis.geoadd('jobs:active', lng, lat, jobId);

        console.log("✅ Demo Job Injected Successfully! ID:", jobId);
        process.exit(0);
    } catch (e) {
        console.error("❌ Injection failed:", e.message);
        process.exit(1);
    }
}

inject();
