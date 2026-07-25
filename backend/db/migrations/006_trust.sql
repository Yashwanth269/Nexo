-- Advanced Fatigue Scores Table
CREATE TABLE IF NOT EXISTS advanced_fatigue_scores (
    worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
    hours_online_24h DECIMAL DEFAULT 0.0,
    jobs_completed_24h INTEGER DEFAULT 0,
    travel_distance_24h_km DECIMAL DEFAULT 0.0,
    rejections_24h INTEGER DEFAULT 0,
    timeouts_24h INTEGER DEFAULT 0,
    breaks_duration_minutes_24h INTEGER DEFAULT 0,
    composite_fatigue_score DECIMAL DEFAULT 0.0,
    risk_level VARCHAR(50) DEFAULT 'LOW',
    recommended_action TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Trust Scores Table
CREATE TABLE IF NOT EXISTS user_trust_scores (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    trust_score DECIMAL DEFAULT 100.0,
    fake_bookings INTEGER DEFAULT 0,
    cancellations INTEGER DEFAULT 0,
    disputes_initiated INTEGER DEFAULT 0,
    payment_failures INTEGER DEFAULT 0,
    payment_abuses INTEGER DEFAULT 0,
    refund_abuses INTEGER DEFAULT 0,
    no_shows INTEGER DEFAULT 0,
    harassment_reports INTEGER DEFAULT 0,
    abuse_reports INTEGER DEFAULT 0,
    fraud_reports INTEGER DEFAULT 0,
    fraud_flags INTEGER DEFAULT 0,
    total_jobs_posted INTEGER DEFAULT 0,
    jobs_completed INTEGER DEFAULT 0,
    disputes_won INTEGER DEFAULT 0,
    trust_level VARCHAR(50) DEFAULT 'NORMAL',
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GPS Traces Table
CREATE TABLE IF NOT EXISTS gps_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    lat DECIMAL(10,8) NOT NULL,
    lng DECIMAL(11,8) NOT NULL,
    speed_kmh DECIMAL(5,2),
    accuracy_m DECIMAL(5,2),
    mock_location BOOLEAN,
    heading DECIMAL(5,2),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Route Deviations Table
CREATE TABLE IF NOT EXISTS route_deviations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    deviation_distance_meters INTEGER,
    deviation_score DECIMAL(3,2),
    worker_lat DECIMAL(10,8),
    worker_lng DECIMAL(11,8),
    destination_lat DECIMAL(10,8),
    destination_lng DECIMAL(11,8),
    notified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Completed Job Posts Table
CREATE TABLE IF NOT EXISTS completed_job_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(255),
    caption TEXT,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    address TEXT,
    image_urls JSONB DEFAULT '[]'::jsonb,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    saves_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    is_flagged BOOLEAN DEFAULT FALSE,
    fraud_risk_score DECIMAL(3, 2) DEFAULT 0.0,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS completed_post_likes (
    post_id UUID REFERENCES completed_job_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS completed_post_saves (
    post_id UUID REFERENCES completed_job_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS completed_post_views (
    post_id UUID REFERENCES completed_job_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

-- User Worker Affinity Table
CREATE TABLE IF NOT EXISTS user_worker_affinity (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    hire_count INTEGER DEFAULT 1,
    last_hired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, worker_id)
);

-- Worker Reputation Scores Table
CREATE TABLE IF NOT EXISTS worker_reputation_scores (
    worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
    trust_score DECIMAL DEFAULT 50.0,
    reliability_score DECIMAL DEFAULT 50.0,
    quality_score DECIMAL DEFAULT 50.0,
    response_score DECIMAL DEFAULT 50.0,
    overall_score DECIMAL DEFAULT 50.0,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
