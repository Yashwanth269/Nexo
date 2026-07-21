const db = require('./config/db');

const MIGRATE_SQL = `
-- 1. Add availability_state to workers
ALTER TABLE workers ADD COLUMN IF NOT EXISTS availability_state VARCHAR(50) DEFAULT 'OFFLINE';

-- 2. Create worker_calendar table
CREATE TABLE IF NOT EXISTS worker_calendar (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    service_category VARCHAR(100) NOT NULL,
    scheduled_start TIMESTAMP WITH TIME ZONE NOT NULL,
    estimated_duration_minutes INTEGER NOT NULL,
    travel_time_before_minutes INTEGER DEFAULT 0,
    travel_time_after_minutes INTEGER DEFAULT 0,
    buffer_before_minutes INTEGER DEFAULT 0,
    buffer_after_minutes INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'CONFIRMED', -- CONFIRMED, CANCELLED, COMPLETED
    location_lat DECIMAL(9, 6),
    location_lng DECIMAL(9, 6),
    priority VARCHAR(50) DEFAULT 'NORMAL',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create indexes for quick scheduling and lookup
CREATE INDEX IF NOT EXISTS idx_worker_calendar_worker_time ON worker_calendar(worker_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_worker_calendar_booking ON worker_calendar(booking_id);
`;

async function main() {
    try {
        console.log("🛠️ Running Worker Reservation database migrations...");
        await db.query(MIGRATE_SQL);
        console.log("✅ Database migration completed successfully.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Database migration failed:", e.message);
        process.exit(1);
    }
}

main();
