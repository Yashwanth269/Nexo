-- =============================================================
-- SHRAMIK SHAKTI: UNIFIED PRODUCTION SCHEMA
-- PostgreSQL 14+ | Single Source of Truth
-- =============================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash TEXT,
    avatar_url TEXT,
    photo_url TEXT,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    rating DECIMAL(3, 2) DEFAULT 4.5,
    last_login TIMESTAMP,
    last_login_gps JSONB,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Workers Table
CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    full_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    photo_url TEXT,
    skills TEXT[],
    experience VARCHAR(100),
    rating DECIMAL(3, 2) DEFAULT 4.0,
    reliability_score DECIMAL(3, 2) DEFAULT 1.0,
    total_jobs INTEGER DEFAULT 0,
    jobs_completed INTEGER DEFAULT 0,
    completion_rate DECIMAL(5, 2) DEFAULT 100.0,
    completion_count INTEGER DEFAULT 0,
    cancellation_count INTEGER DEFAULT 0,
    response_speed DECIMAL(10, 2) DEFAULT 1.0,
    fatigue_score DECIMAL(5, 2) DEFAULT 0.0,
    recent_rejections INTEGER DEFAULT 0,
    ignored_jobs INTEGER DEFAULT 0,
    expected_price DECIMAL(10, 2),
    preferred_radius INTEGER DEFAULT 10,
    job_types TEXT[],
    is_online BOOLEAN DEFAULT FALSE,
    is_available BOOLEAN DEFAULT TRUE,
    current_lat DECIMAL(10, 8),
    current_lng DECIMAL(11, 8),
    is_profile_complete BOOLEAN DEFAULT FALSE,
    work_radius INTEGER DEFAULT 15,
    languages TEXT[],
    tasks TEXT[],
    state VARCHAR(100),
    id_url TEXT,
    last_login_gps JSONB,
    verification_status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Jobs Table
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    category VARCHAR(100) NOT NULL,
    task_id VARCHAR(100),
    title VARCHAR(255),
    description TEXT,
    location_lat DECIMAL(10, 8) NOT NULL,
    location_lng DECIMAL(11, 8) NOT NULL,
    address TEXT,
    landmark TEXT,
    status VARCHAR(50) DEFAULT 'OPEN',
    price DECIMAL(10, 2),
    estimated_duration VARCHAR(50),
    scheduled_at TIMESTAMP,
    scheduled_time TIMESTAMP,
    distance VARCHAR(50),
    eta VARCHAR(50),
    cancellation_reason TEXT,
    cancelled_by VARCHAR(20),
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- 4. Job Offers (Worker Negotiation & Dispatch Tracking)
CREATE TABLE IF NOT EXISTS job_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    offer_price DECIMAL(10, 2),
    status VARCHAR(50) DEFAULT 'PENDING',
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 minutes'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, worker_id, status)
);

-- 5. Job Cancellations (referenced by matching.service.js dispatch exclusion)
CREATE TABLE IF NOT EXISTS job_cancellations (
    cancellation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    reason TEXT,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Job History (Audit Trail)
CREATE TABLE IF NOT EXISTS job_history (
    id SERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL,
    metadata JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Event Logs (ML Data Source & Audit)
CREATE TABLE IF NOT EXISTS event_logs (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    user_id UUID,
    event_type VARCHAR(100) NOT NULL,
    metadata JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Messages (Chat Persistence)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL,
    sender_type VARCHAR(20) DEFAULT 'USER',
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'SENT',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Ratings
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    from_id UUID NOT NULL,
    to_id UUID NOT NULL,
    rating_type VARCHAR(30) NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    tags JSONB,
    feedback TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, from_id, to_id)
);

-- 10. Safety Incidents
CREATE TABLE IF NOT EXISTS safety_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    reporter_id UUID,
    reporter_type VARCHAR(20),
    reason VARCHAR(255),
    description TEXT,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    status VARCHAR(50) DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    issue_type VARCHAR(50),
    description TEXT,
    status VARCHAR(20) DEFAULT 'OPEN',
    priority VARCHAR(10) DEFAULT 'LOW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Login Sessions (Security Tracking)
CREATE TABLE IF NOT EXISTS login_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    ip_address INET,
    device_id TEXT,
    user_agent TEXT,
    fingerprint TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. User Security Profiles
CREATE TABLE IF NOT EXISTS user_security_profiles (
    user_id UUID PRIMARY KEY,
    last_ip INET,
    last_device TEXT,
    fingerprint TEXT,
    risk_score DECIMAL(3,2) DEFAULT 0.0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 14. Security Audit Logs
CREATE TABLE IF NOT EXISTS security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    event_type VARCHAR(100),
    ip_address INET,
    risk_score DECIMAL(3,2),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 15. Feature Store (ML Feature Cache)
CREATE TABLE IF NOT EXISTS feature_store (
    user_id UUID PRIMARY KEY,
    preferred_category VARCHAR(100),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id);
CREATE INDEX IF NOT EXISTS idx_jobs_worker_status_created ON jobs(worker_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_workers_online ON workers(is_online, is_available);
CREATE INDEX IF NOT EXISTS idx_workers_phone ON workers(phone_number);
CREATE INDEX IF NOT EXISTS idx_job_offers_job_worker ON job_offers(job_id, worker_id);
CREATE INDEX IF NOT EXISTS idx_job_offers_status ON job_offers(status);
CREATE INDEX IF NOT EXISTS idx_job_offers_expires ON job_offers(expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_job_cancellations_job ON job_cancellations(job_id);
CREATE INDEX IF NOT EXISTS idx_job_cancellations_worker ON job_cancellations(worker_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_job ON event_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_timestamp ON event_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_ratings_to_id ON ratings(to_id, rating_type);
CREATE INDEX IF NOT EXISTS idx_messages_job ON messages(job_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_ip ON login_sessions(ip_address);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_job ON safety_incidents(job_id);
