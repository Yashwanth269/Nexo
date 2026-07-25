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
