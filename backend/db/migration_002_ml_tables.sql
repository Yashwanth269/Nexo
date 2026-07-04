-- =============================================================
-- MIGRATION 002: ML Service Infrastructure Tables & Columns
-- Adds tables/columns required by ML service but missing from
-- the original schema.sql.
-- =============================================================

-- 1. Add missing columns to jobs table (for ETA calculation + geospatial)
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS on_the_way_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS location_cube cube;

-- 1b. Add location_cube to workers table (for geospatial queries)
ALTER TABLE workers
    ADD COLUMN IF NOT EXISTS location_cube cube;

-- 2. Worker Features (pre-computed ML features per worker)
CREATE TABLE IF NOT EXISTS worker_features (
    worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
    completion_rate DECIMAL(5, 2) DEFAULT 100.0,
    cancellation_rate DECIMAL(5, 2) DEFAULT 0.0,
    avg_response_time DECIMAL(10, 2) DEFAULT 0.0,
    reliability_score DECIMAL(3, 2) DEFAULT 1.0,
    worker_load_score DECIMAL(5, 2) DEFAULT 0.0,
    fatigue_24h DECIMAL(5, 2) DEFAULT 0.0,
    fatigue_7d DECIMAL(5, 2) DEFAULT 0.0,
    fatigue_30d DECIMAL(5, 2) DEFAULT 0.0,
    trust_decay_factor DECIMAL(5, 4) DEFAULT 1.0,
    quality_score DECIMAL(5, 4) DEFAULT 0.0,
    online_consistency DECIMAL(5, 4) DEFAULT 0.0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Model Registry (tracks ML model deployments)
CREATE TABLE IF NOT EXISTS model_registry (
    id SERIAL PRIMARY KEY,
    model_name VARCHAR(100) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    model_type VARCHAR(50),
    artifact_path TEXT,
    feature_schema JSONB,
    training_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    training_duration_seconds DECIMAL(10, 2),
    training_rows_count INTEGER,
    evaluation_metrics JSONB,
    status VARCHAR(20) DEFAULT 'active',
    is_production BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_name, model_version)
);

-- 4. Model Metrics (time-series ML performance tracking)
CREATE TABLE IF NOT EXISTS model_metrics (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(10, 4) NOT NULL,
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Create the cube extension if not already enabled
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- 6. GiST indexes for geospatial queries
CREATE INDEX IF NOT EXISTS idx_workers_location_cube ON workers USING GIST (location_cube);
CREATE INDEX IF NOT EXISTS idx_jobs_location_cube ON jobs USING GIST (location_cube);

-- 7. Indexes for ML queries
CREATE INDEX IF NOT EXISTS idx_worker_features_quality ON worker_features(quality_score);
CREATE INDEX IF NOT EXISTS idx_worker_features_worker_id ON worker_features(worker_id);
CREATE INDEX IF NOT EXISTS idx_model_registry_name_version ON model_registry(model_name, model_version);
CREATE INDEX IF NOT EXISTS idx_model_registry_production ON model_registry(model_name, is_production) WHERE is_production = TRUE;
CREATE INDEX IF NOT EXISTS idx_jobs_arrived ON jobs(arrived_at) WHERE arrived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_on_the_way ON jobs(on_the_way_at) WHERE on_the_way_at IS NOT NULL;
