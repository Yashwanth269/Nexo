const db = require('./config/db');

async function runMigration() {
    try {
        // Add columns to jobs table
        await db.query(`
            ALTER TABLE jobs 
            ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
            ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
        `);
        console.log("✅ [MIGRATION] Added cancellation columns to jobs table.");

        // Create job_cancellations table
        await db.query(`
            CREATE TABLE IF NOT EXISTS job_cancellations (
                cancellation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_id UUID NOT NULL REFERENCES jobs(id),
                worker_id UUID NOT NULL REFERENCES workers(id),
                reason TEXT NOT NULL,
                note TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✅ [MIGRATION] job_cancellations table verified.");

        // Ensure workers table has reliability columns
        await db.query(`
            ALTER TABLE workers
            ADD COLUMN IF NOT EXISTS reliability_score NUMERIC DEFAULT 1.0,
            ADD COLUMN IF NOT EXISTS cancellation_count INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS completion_count INTEGER DEFAULT 0;
        `);
        console.log("✅ [MIGRATION] Worker reliability columns verified.");

        process.exit(0);
    } catch (e) {
        console.error("❌ [MIGRATION-ERROR]", e.message);
        process.exit(1);
    }
}

runMigration();
