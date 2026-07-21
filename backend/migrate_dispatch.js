const db = require('./config/db');

const MIGRATE_SQL = `
-- 1. Add dispatch_pool_id to job_offers
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS dispatch_pool_id INTEGER DEFAULT 1;

-- 2. Add index for dispatch_pool_id
CREATE INDEX IF NOT EXISTS idx_job_offers_dispatch_pool ON job_offers(job_id, dispatch_pool_id);

-- 3. Add observability fields to search_analytics_logs
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS duplicate_acceptance_attempts INTEGER DEFAULT 0;
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS pools_used INTEGER DEFAULT 0;
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS offers_expired_count INTEGER DEFAULT 0;
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS offers_declined_count INTEGER DEFAULT 0;
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS standby_used BOOLEAN DEFAULT FALSE;
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS emergency_recovery_count INTEGER DEFAULT 0;
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS queue_refresh_count INTEGER DEFAULT 0;
ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS queue_build_time_ms INTEGER DEFAULT 0;
`;

async function main() {
    try {
        console.log("🛠️ Running Staged Dispatch database migrations...");
        await db.query(MIGRATE_SQL);
        console.log("✅ Database migration completed successfully.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Database migration failed:", e.message);
        process.exit(1);
    }
}

main();
