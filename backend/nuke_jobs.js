const db = require('./config/db');
const redis = require('./config/redis');
const fs = require('fs');
const path = require('path');

async function nukeAllJobs() {
    try {
        console.log("🧹 [CLEANUP] Starting total wipe of all job data...");

        // 1. Wipe PostgreSQL (In order of dependencies)
        await db.query('DELETE FROM event_logs');
        await db.query('DELETE FROM job_offers');
        await db.query('DELETE FROM bids');
        await db.query('DELETE FROM jobs');
        console.log("🐘 [DATABASE] All jobs, bids, and logs deleted.");

        // 2. Wipe Mock Persistence
        const mockPath = path.join(__dirname, 'data/mock_jobs.json');
        if (fs.existsSync(mockPath)) {
            fs.unlinkSync(mockPath);
            console.log("📂 [FILESYSTEM] Mock persistence file removed.");
        }

        // 3. Wipe Redis
        await redis.del('jobs:active');
        console.log("📡 [REDIS] Discovery keys flushed.");

        console.log("✨ [SUCCESS] System is now clean and ready for fresh requests.");
        process.exit(0);
    } catch (err) {
        console.error("❌ [CLEANUP ERROR]", err.message);
        process.exit(1);
    }
}

nukeAllJobs();
