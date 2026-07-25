-- Payments Table
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

-- Cash Confirmations Table
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

-- Settlement Ledger Table
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

-- Razorpay Webhooks Table
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

-- Payment Trust Scores Table
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

-- Disputes Table
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

-- Commission Config Table
CREATE TABLE IF NOT EXISTS commission_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    platform_fee_pct DECIMAL(5, 2) DEFAULT 10.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category)
);

-- Index Adjustments
CREATE INDEX IF NOT EXISTS idx_workers_location_cube ON workers USING GIST (location_cube);
CREATE INDEX IF NOT EXISTS idx_jobs_location_cube ON jobs USING GIST (location_cube);

-- Column Adjustments for legacy tables
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS last_job_event_at TIMESTAMP;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMP;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS category_scores JSONB DEFAULT '{}'::jsonb;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS fatigue_24h DECIMAL DEFAULT 0.0;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS fatigue_7d DECIMAL DEFAULT 0.0;
ALTER TABLE worker_features ADD COLUMN IF NOT EXISTS fatigue_30d DECIMAL DEFAULT 0.0;

ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS quality_score DECIMAL DEFAULT 50.0;
ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS response_score DECIMAL DEFAULT 50.0;
ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS overall_score DECIMAL DEFAULT 50.0;
ALTER TABLE worker_reputation_scores ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_radius_km DECIMAL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_state_stage INTEGER DEFAULT 1;

ALTER TABLE advanced_fatigue_scores ADD COLUMN IF NOT EXISTS acceptance_load_24h INTEGER DEFAULT 0;
ALTER TABLE advanced_fatigue_scores ADD COLUMN IF NOT EXISTS active_jobs_current INTEGER DEFAULT 0;
ALTER TABLE advanced_fatigue_scores ADD COLUMN IF NOT EXISTS stress_events_24h INTEGER DEFAULT 0;
ALTER TABLE advanced_fatigue_scores ADD COLUMN IF NOT EXISTS fatigue_score DECIMAL DEFAULT 0.0;
ALTER TABLE advanced_fatigue_scores ADD COLUMN IF NOT EXISTS fatigue_band VARCHAR(50) DEFAULT 'NONE';
ALTER TABLE advanced_fatigue_scores ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE job_offers DROP CONSTRAINT IF EXISTS job_offers_job_id_worker_id_status_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_offers_pending_unique ON job_offers(job_id, worker_id) WHERE status = 'PENDING';

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '{}'::jsonb;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMP;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;
