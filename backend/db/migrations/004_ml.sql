-- Heatmap Snapshots Table
CREATE TABLE IF NOT EXISTS heatmap_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_data JSONB NOT NULL,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ML Model Monitoring Table
CREATE TABLE IF NOT EXISTS ml_model_monitoring (
    model_name VARCHAR(100) PRIMARY KEY,
    version VARCHAR(50) DEFAULT '1.0.0',
    avg_latency_ms DECIMAL DEFAULT 0.0,
    accuracy DECIMAL DEFAULT 0.0,
    last_trained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    prediction_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ML Training Data Table
CREATE TABLE IF NOT EXISTS ml_training_data (
    id BIGSERIAL PRIMARY KEY,
    model_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    features JSONB NOT NULL,
    prediction DECIMAL NOT NULL,
    confidence DECIMAL,
    actual_outcome DECIMAL,
    outcome_label VARCHAR(100),
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    outcome_recorded_at TIMESTAMP
);

-- Model Maturity Table
CREATE TABLE IF NOT EXISTS model_maturity (
    model_name VARCHAR(100) PRIMARY KEY,
    total_predictions INTEGER DEFAULT 0,
    recorded_outcomes INTEGER DEFAULT 0,
    precision DECIMAL,
    recall DECIMAL,
    f1_score DECIMAL,
    auc_roc DECIMAL,
    calibration_error DECIMAL,
    min_samples_required INTEGER DEFAULT 5000,
    is_production_ready BOOLEAN DEFAULT FALSE,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
