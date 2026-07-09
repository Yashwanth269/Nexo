const db = require('./config/db');

const SQL = `
-- 1. Feature Flags
CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT false,
    rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    actor_type VARCHAR(20),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    before_data JSONB,
    after_data JSONB,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 3. Idempotency Keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(idempotency_key);

-- 4. Distributed Locks (fallback for Redis)
CREATE TABLE IF NOT EXISTS distributed_locks (
    lock_name VARCHAR(255) PRIMARY KEY,
    lock_holder VARCHAR(255),
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- 5. Worker GPS Risk
CREATE TABLE IF NOT EXISTS worker_gps_risk (
    worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
    gps_trust_score DECIMAL DEFAULT 100.0,
    anomaly_count INTEGER DEFAULT 0,
    alerts TEXT[] DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'SAFE',
    last_anomaly_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Shadow Ban Status
CREATE TABLE IF NOT EXISTS shadow_ban_status (
    worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
    ban_level INTEGER DEFAULT 0,
    visibility_multiplier DECIMAL(3,2) DEFAULT 1.0,
    dispatch_multiplier DECIMAL(3,2) DEFAULT 1.0,
    reason TEXT,
    active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    escalated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Backup Worker Pool
CREATE TABLE IF NOT EXISTS backup_worker_pool (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    primary_worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    backup_worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'RESERVED',
    distance_km DECIMAL,
    rank_score DECIMAL,
    failed_at TIMESTAMP,
    failure_reason TEXT,
    activated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backup_activations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    primary_worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    scenario VARCHAR(100),
    metadata JSONB,
    previous_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backup_activation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    backup_worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    scenario VARCHAR(100),
    recovery_time_ms INTEGER,
    success BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Advanced Fatigue Scores
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

-- 9. Heatmap Snapshots
CREATE TABLE IF NOT EXISTS heatmap_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_data JSONB NOT NULL,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. User Trust Scores
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

-- 11. GPS Traces
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

-- 12. Route Deviations
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

-- 13. Job Dispute Risk
CREATE TABLE IF NOT EXISTS job_dispute_risk (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    dispute_risk DECIMAL DEFAULT 0.0,
    risk_band VARCHAR(50) DEFAULT 'LOW',
    recommendation TEXT,
    requires_review BOOLEAN DEFAULT false,
    hold_amount DECIMAL DEFAULT 0.0,
    release_amount DECIMAL DEFAULT 0.0,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 14. Completed Job Posts (Social Feed)
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

-- 15. Completed Post Likes
CREATE TABLE IF NOT EXISTS completed_post_likes (
    post_id UUID REFERENCES completed_job_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

-- 16. Completed Post Saves
CREATE TABLE IF NOT EXISTS completed_post_saves (
    post_id UUID REFERENCES completed_job_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

-- 17. Completed Post Views
CREATE TABLE IF NOT EXISTS completed_post_views (
    post_id UUID REFERENCES completed_job_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

-- 18. User-Worker Affinity
CREATE TABLE IF NOT EXISTS user_worker_affinity (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    hire_count INTEGER DEFAULT 1,
    last_hired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, worker_id)
);

-- 19. Ensure worker_features has correct columns for ranking
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS last_job_event_at TIMESTAMP;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMP;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS category_scores JSONB DEFAULT '{}'::jsonb;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS fatigue_24h DECIMAL DEFAULT 0.0;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS fatigue_7d DECIMAL DEFAULT 0.0;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS fatigue_30d DECIMAL DEFAULT 0.0;

-- 20. Ensure worker_reputation_scores has correct columns
CREATE TABLE IF NOT EXISTS worker_reputation_scores (
    worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
    trust_score DECIMAL DEFAULT 50.0,
    reliability_score DECIMAL DEFAULT 50.0,
    quality_score DECIMAL DEFAULT 50.0,
    response_score DECIMAL DEFAULT 50.0,
    overall_score DECIMAL DEFAULT 50.0,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS quality_score DECIMAL DEFAULT 50.0;
ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS response_score DECIMAL DEFAULT 50.0;
ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS overall_score DECIMAL DEFAULT 50.0;
ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_radius_km DECIMAL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_state_stage INTEGER DEFAULT 1;

-- Payment Tables
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    payer_id UUID,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_mode VARCHAR(30) DEFAULT 'CASH',
    payment_status VARCHAR(30) DEFAULT 'PENDING',
    gateway_reference TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING',
    worker_marked_at TIMESTAMP,
    user_confirmed_at TIMESTAMP,
    auto_confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    owner_type VARCHAR(20) DEFAULT 'WORKER',
    balance DECIMAL(12, 2) DEFAULT 0.0,
    cash_held DECIMAL(12, 2) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_id, owner_type)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    type VARCHAR(30) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settlement_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS razorpay_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100),
    razorpay_id TEXT,
    payment_id TEXT,
    order_id TEXT,
    raw_payload JSONB,
    status VARCHAR(30) DEFAULT 'RECEIVED',
    processed_at TIMESTAMP,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(payment_id)
);

CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING',
    idempotency_key UUID UNIQUE DEFAULT gen_random_uuid(),
    upi_id TEXT,
    gateway_reference TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_trust_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    owner_type VARCHAR(20) NOT NULL,
    score DECIMAL(5, 2) DEFAULT 50.0,
    total_payments INTEGER DEFAULT 0,
    successful_payments INTEGER DEFAULT 0,
    disputed_payments INTEGER DEFAULT 0,
    failed_payments INTEGER DEFAULT 0,
    cash_confirmations INTEGER DEFAULT 0,
    disputes_initiated INTEGER DEFAULT 0,
    disputes_won INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_id, owner_type)
);

CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    initiator_id UUID NOT NULL,
    initiator_role VARCHAR(20) NOT NULL,
    respondent_id UUID,
    reason VARCHAR(255),
    description TEXT,
    status VARCHAR(30) DEFAULT 'OPEN',
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commission_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    platform_fee_pct DECIMAL(5, 2) DEFAULT 10.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category)
);

CREATE INDEX IF NOT EXISTS idx_workers_location_cube ON workers USING GIST (location_cube);
CREATE INDEX IF NOT EXISTS idx_jobs_location_cube ON jobs USING GIST (location_cube);
`;

async function main() {
    try {
        console.log("🛠️ Creating missing tables...");
        await db.query(SQL);
        console.log("✅ Missing tables created successfully.");

        console.log("⚡ Auto-verifying all workers in DB...");
        await db.query("UPDATE workers SET verification_status = 'VERIFIED' WHERE verification_status != 'VERIFIED'");
        console.log("✅ All workers verified successfully.");

        process.exit(0);
    } catch (e) {
        console.error("❌ Failed to create missing tables:", e.message);
        process.exit(1);
    }
}

main();
