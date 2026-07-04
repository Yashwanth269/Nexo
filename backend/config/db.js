const { Pool } = require('pg');
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

let postgisAvailable = false;

async function checkPostgis() {
    try {
        const res = await pool.query('SELECT PostGIS_Version()');
        postgisAvailable = true;
        console.log('[DB] PostGIS available:', res.rows[0].postgis_version);
    } catch (e) {
        postgisAvailable = false;
        console.log('[DB] PostGIS not available, using cube+earthdistance');
    }
}

function isPostgisAvailable() {
    return postgisAvailable;
}

pool.on('connect', () => {
    console.log('[DB] New client connected to pool');
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
        console.warn('[DB-SLOW] Query took', duration, 'ms');
    }
    return res;
}

const SCHEMA_SQL = "-- =============================================================\n-- SHRAMIK SHAKTI: UNIFIED PRODUCTION SCHEMA\n-- PostgreSQL 14+ | Single Source of Truth\n-- =============================================================\n\n-- 1. Users Table\nCREATE TABLE IF NOT EXISTS users (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    full_name VARCHAR(255) NOT NULL,\n    phone_number VARCHAR(20) UNIQUE NOT NULL,\n    email VARCHAR(255) UNIQUE,\n    password_hash TEXT,\n    avatar_url TEXT,\n    photo_url TEXT,\n    location_lat DECIMAL(10, 8),\n    location_lng DECIMAL(11, 8),\n    rating DECIMAL(3, 2) DEFAULT 4.5,\n    last_login TIMESTAMP,\n    last_login_gps JSONB,\n    status VARCHAR(50) DEFAULT 'ACTIVE',\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 2. Workers Table\nCREATE TABLE IF NOT EXISTS workers (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id UUID REFERENCES users(id) ON DELETE SET NULL,\n    full_name VARCHAR(255) NOT NULL,\n    phone_number VARCHAR(20) UNIQUE NOT NULL,\n    photo_url TEXT,\n    skills TEXT[],\n    experience VARCHAR(100),\n    rating DECIMAL(3, 2) DEFAULT 4.0,\n    reliability_score DECIMAL(3, 2) DEFAULT 1.0,\n    total_jobs INTEGER DEFAULT 0,\n    jobs_completed INTEGER DEFAULT 0,\n    completion_rate DECIMAL(5, 2) DEFAULT 100.0,\n    completion_count INTEGER DEFAULT 0,\n    cancellation_count INTEGER DEFAULT 0,\n    response_speed DECIMAL(10, 2) DEFAULT 1.0,\n    fatigue_score DECIMAL(5, 2) DEFAULT 0.0,\n    recent_rejections INTEGER DEFAULT 0,\n    ignored_jobs INTEGER DEFAULT 0,\n    expected_price DECIMAL(10, 2),\n    preferred_radius INTEGER DEFAULT 10,\n    job_types TEXT[],\n    is_online BOOLEAN DEFAULT FALSE,\n    is_available BOOLEAN DEFAULT TRUE,\n    current_lat DECIMAL(10, 8),\n    current_lng DECIMAL(11, 8),\n    is_profile_complete BOOLEAN DEFAULT FALSE,\n    work_radius INTEGER DEFAULT 15,\n    languages TEXT[],\n    tasks TEXT[],\n    state VARCHAR(100),\n    id_url TEXT,\n    last_login_gps JSONB,\n    verification_status VARCHAR(20) DEFAULT 'PENDING',\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 3. Jobs Table\nCREATE TABLE IF NOT EXISTS jobs (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id UUID REFERENCES users(id) ON DELETE SET NULL,\n    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,\n    category VARCHAR(100) NOT NULL,\n    task_id VARCHAR(100),\n    title VARCHAR(255),\n    description TEXT,\n    location_lat DECIMAL(10, 8) NOT NULL,\n    location_lng DECIMAL(11, 8) NOT NULL,\n    address TEXT,\n    landmark TEXT,\n    status VARCHAR(50) DEFAULT 'OPEN',\n    price DECIMAL(10, 2),\n    estimated_duration VARCHAR(50),\n    scheduled_at TIMESTAMP,\n    scheduled_time TIMESTAMP,\n    distance VARCHAR(50),\n    eta VARCHAR(50),\n    cancellation_reason TEXT,\n    cancelled_by VARCHAR(20),\n    cancelled_at TIMESTAMP WITH TIME ZONE,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    completed_at TIMESTAMP\n);\n\n-- 4. Job Offers (Worker Negotiation & Dispatch Tracking)\nCREATE TABLE IF NOT EXISTS job_offers (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,\n    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,\n    offer_price DECIMAL(10, 2),\n    status VARCHAR(50) DEFAULT 'PENDING',\n    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 minutes'),\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    UNIQUE(job_id, worker_id, status)\n);\n\n-- 5. Job Cancellations (referenced by matching.service.js dispatch exclusion)\nCREATE TABLE IF NOT EXISTS job_cancellations (\n    cancellation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,\n    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,\n    reason TEXT,\n    note TEXT,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 6. Job History (Audit Trail)\nCREATE TABLE IF NOT EXISTS job_history (\n    id SERIAL PRIMARY KEY,\n    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,\n    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,\n    status VARCHAR(50) NOT NULL,\n    metadata JSONB,\n    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 7. Event Logs (ML Data Source & Audit)\nCREATE TABLE IF NOT EXISTS event_logs (\n    id BIGSERIAL PRIMARY KEY,\n    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,\n    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,\n    user_id UUID,\n    event_type VARCHAR(100) NOT NULL,\n    metadata JSONB,\n    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 8. Messages (Chat Persistence)\nCREATE TABLE IF NOT EXISTS messages (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,\n    sender_id UUID NOT NULL,\n    sender_type VARCHAR(20) DEFAULT 'USER',\n    message TEXT NOT NULL,\n    status VARCHAR(20) DEFAULT 'SENT',\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 9. Ratings\nCREATE TABLE IF NOT EXISTS ratings (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,\n    from_id UUID NOT NULL,\n    to_id UUID NOT NULL,\n    rating_type VARCHAR(30) NOT NULL,\n    rating INTEGER CHECK (rating >= 1 AND rating <= 5),\n    tags JSONB,\n    feedback TEXT,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    UNIQUE(job_id, from_id, to_id)\n);\n\n-- 10. Safety Incidents\nCREATE TABLE IF NOT EXISTS safety_incidents (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,\n    reporter_id UUID,\n    reporter_type VARCHAR(20),\n    reason VARCHAR(255),\n    description TEXT,\n    location_lat DECIMAL(10, 8),\n    location_lng DECIMAL(11, 8),\n    status VARCHAR(50) DEFAULT 'OPEN',\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 11. Support Tickets\nCREATE TABLE IF NOT EXISTS support_tickets (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id UUID,\n    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,\n    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,\n    issue_type VARCHAR(50),\n    description TEXT,\n    status VARCHAR(20) DEFAULT 'OPEN',\n    priority VARCHAR(10) DEFAULT 'LOW',\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 12. Login Sessions (Security Tracking)\nCREATE TABLE IF NOT EXISTS login_sessions (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id UUID,\n    ip_address INET,\n    device_id TEXT,\n    user_agent TEXT,\n    fingerprint TEXT,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 13. User Security Profiles\nCREATE TABLE IF NOT EXISTS user_security_profiles (\n    user_id UUID PRIMARY KEY,\n    last_ip INET,\n    last_device TEXT,\n    fingerprint TEXT,\n    risk_score DECIMAL(3,2) DEFAULT 0.0,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 14. Security Audit Logs\nCREATE TABLE IF NOT EXISTS security_audit_logs (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id UUID,\n    event_type VARCHAR(100),\n    ip_address INET,\n    risk_score DECIMAL(3,2),\n    details JSONB,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 15. Feature Store (ML Feature Cache)\nCREATE TABLE IF NOT EXISTS feature_store (\n    user_id UUID PRIMARY KEY,\n    preferred_category VARCHAR(100),\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\n-- =============================================================\n-- INDEXES FOR PERFORMANCE\n-- =============================================================\nCREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);\nCREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);\nCREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id);\nCREATE INDEX IF NOT EXISTS idx_jobs_worker_status_created ON jobs(worker_id, status, created_at);\nCREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);\nCREATE INDEX IF NOT EXISTS idx_workers_online ON workers(is_online, is_available);\nCREATE INDEX IF NOT EXISTS idx_workers_phone ON workers(phone_number);\nCREATE INDEX IF NOT EXISTS idx_job_offers_job_worker ON job_offers(job_id, worker_id);\nCREATE INDEX IF NOT EXISTS idx_job_offers_status ON job_offers(status);\nCREATE INDEX IF NOT EXISTS idx_job_offers_expires ON job_offers(expires_at) WHERE status = 'PENDING';\nCREATE INDEX IF NOT EXISTS idx_job_cancellations_job ON job_cancellations(job_id);\nCREATE INDEX IF NOT EXISTS idx_job_cancellations_worker ON job_cancellations(worker_id);\nCREATE INDEX IF NOT EXISTS idx_event_logs_job ON event_logs(job_id);\nCREATE INDEX IF NOT EXISTS idx_event_logs_timestamp ON event_logs(timestamp);\nCREATE INDEX IF NOT EXISTS idx_ratings_to_id ON ratings(to_id, rating_type);\nCREATE INDEX IF NOT EXISTS idx_messages_job ON messages(job_id);\nCREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);\nCREATE INDEX IF NOT EXISTS idx_login_sessions_ip ON login_sessions(ip_address);\nCREATE INDEX IF NOT EXISTS idx_safety_incidents_job ON safety_incidents(job_id);\n";

async function initializeDatabase() {
    console.log('[DB] Running schema initialization...');
    await pool.query(SCHEMA_SQL);
    console.log('[DB] Schema initialized successfully');
}

module.exports = { query, pool, isPostgisAvailable, initializeDatabase, checkPostgis };