const pg = require('pg');
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DB_DSN || 'postgresql://postgres:postgres@localhost:5432/gigs_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

let isDbReady = false;

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query(`
-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    email VARCHAR(100),
    password_hash VARCHAR(255),
    photo_url VARCHAR(500),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);

-- 2. Workers
CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    email VARCHAR(100),
    password_hash VARCHAR(255),
    photo_url VARCHAR(500),
    skills TEXT[],
    tasks TEXT[],
    experience VARCHAR(50),
    expected_price DECIMAL(10, 2),
    rating DECIMAL(3, 2) DEFAULT 4.0,
    jobs_completed INTEGER DEFAULT 0,
    is_online BOOLEAN DEFAULT FALSE,
    is_available BOOLEAN DEFAULT TRUE,
    verification_status VARCHAR(20) DEFAULT 'PENDING',
    current_lat DECIMAL(10, 8),
    current_lng DECIMAL(11, 8),
    location_cube cube,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_workers_phone ON workers(phone_number);
CREATE INDEX IF NOT EXISTS idx_workers_location ON workers USING GIST (location_cube);

-- 3. Jobs
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    location_lat DECIMAL(10, 8) NOT NULL,
    location_lng DECIMAL(11, 8) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    urgency VARCHAR(20) DEFAULT 'normal',
    schedule_type VARCHAR(20) DEFAULT 'now',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(30) DEFAULT 'OPEN',
    payment_method VARCHAR(20) DEFAULT 'ONLINE',
    demand_pressure DECIMAL(5, 4) DEFAULT 0,
    task_id UUID,
    route_polyline TEXT,
    route_distance INTEGER,
    route_duration INTEGER,
    cancellation_reason VARCHAR(200),
    cancelled_by VARCHAR(20),
    accepted_at TIMESTAMP WITH TIME ZONE,
    on_the_way_at TIMESTAMP WITH TIME ZONE,
    arrived_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs USING GIST (ll_to_earth(location_lat, location_lng));

-- Add remaining tables...
        `);
        console.log('Migrations completed');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        client.release();
        isDbReady = true;
    }
}

runMigrations();

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    isHealthy: () => isDbReady,
};