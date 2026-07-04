const db = require('./config/db');

async function migrate() {
    console.log("🛠️ Starting Database Migration...");
    try {
        // 1. Add expires_at if missing
        await db.query(`
            ALTER TABLE job_offers 
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE 
            DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 minutes')
        `);
        console.log("✅ Column 'expires_at' added or already exists.");

        // 2. Ensure status can handle our new states
        await db.query(`
            ALTER TABLE job_offers 
            ALTER COLUMN status SET DEFAULT 'PENDING'
        `);
        console.log("✅ Table 'job_offers' hardened.");

        process.exit(0);
    } catch (e) {
        console.error("❌ Migration failed:", e.message);
        process.exit(1);
    }
}

migrate();
