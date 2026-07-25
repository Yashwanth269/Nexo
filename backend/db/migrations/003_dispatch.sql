-- Backup Worker Pool Table
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

-- Backup Activations Tables
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

-- Dispatch Rejections Logs
CREATE TABLE IF NOT EXISTS dispatch_rejection_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    dispatch_score DECIMAL DEFAULT 0.0,
    reject_reason VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dispatch_rejections_job ON dispatch_rejection_logs(job_id);

-- Worker Response Logs
CREATE TABLE IF NOT EXISTS worker_response_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    response_type VARCHAR(50) NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_worker_responses_worker ON worker_response_logs(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_responses_job ON worker_response_logs(job_id);

-- Search Analytics Logs
CREATE TABLE IF NOT EXISTS search_analytics_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    initial_radius_km DECIMAL,
    expansion_count INTEGER,
    workers_found INTEGER,
    workers_ranked INTEGER,
    notifications_sent INTEGER,
    acceptance_time_seconds INTEGER,
    average_eta_minutes DECIMAL,
    dispatch_time_seconds INTEGER,
    is_cancelled BOOLEAN DEFAULT FALSE,
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_search_analytics_job ON search_analytics_logs(job_id);

-- Dispatch Ranking Breakdowns
CREATE TABLE IF NOT EXISTS dispatch_ranking_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    final_score DECIMAL NOT NULL,
    skill_score DECIMAL DEFAULT 0.0,
    distance_score DECIMAL DEFAULT 0.0,
    acceptance_probability DECIMAL DEFAULT 0.0,
    trust_score DECIMAL DEFAULT 0.0,
    availability_score DECIMAL DEFAULT 0.0,
    eta_score DECIMAL DEFAULT 0.0,
    fatigue_penalty DECIMAL DEFAULT 0.0,
    fraud_penalty DECIMAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ranking_breakdown_job ON dispatch_ranking_breakdowns(job_id);
