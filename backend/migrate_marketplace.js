const db = require('./config/db');

const SQL = `
-- 1. Marketplace Zones
CREATE TABLE IF NOT EXISTS marketplace_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city VARCHAR(100) NOT NULL,
    zone_name VARCHAR(100) NOT NULL,
    locality VARCHAR(100) NOT NULL,
    center_lat DECIMAL(10, 8) NOT NULL,
    center_lng DECIMAL(11, 8) NOT NULL,
    radius_km DECIMAL DEFAULT 5.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed default Bangalore zones if empty
INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'Central', 'MG Road', 12.9756, 77.6067, 3.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'MG Road');

INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'South', 'Koramangala', 12.9352, 77.6244, 4.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Koramangala');

INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'South', 'HSR Layout', 12.9105, 77.6450, 4.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'HSR Layout');

INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'South', 'Jayanagar', 12.9307, 77.5824, 4.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Jayanagar');

INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'East', 'Indiranagar', 12.9719, 77.6412, 4.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Indiranagar');

INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'East', 'Whitefield', 12.9698, 77.7499, 6.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Whitefield');

INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'West', 'Rajajinagar', 12.9882, 77.5540, 4.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Rajajinagar');

INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
SELECT 'Bangalore', 'North', 'Hebbal', 13.0358, 77.5970, 5.0 WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Hebbal');

-- 2. Incentive Recommendations
CREATE TABLE IF NOT EXISTS incentive_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID REFERENCES marketplace_zones(id) ON DELETE CASCADE,
    incentive_type VARCHAR(50) NOT NULL,
    recommended_value DECIMAL(10, 2) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING_APPROVAL',
    approved_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Job SLAs
CREATE TABLE IF NOT EXISTS job_slas (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    sla_type VARCHAR(50) NOT NULL,
    assignment_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    arrival_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(30) DEFAULT 'ACTIVE',
    predicted_failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Alter Jobs table for lifecycle
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS state_timestamps JSONB DEFAULT '{}'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_timer JSONB DEFAULT '{}'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS before_photos TEXT[] DEFAULT '{}'::TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS after_photos TEXT[] DEFAULT '{}'::TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_signature TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS worker_signature TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payout_status VARCHAR(30) DEFAULT 'PENDING';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_otp TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_otp_verified BOOLEAN DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_otp TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_otp_verified BOOLEAN DEFAULT false;

-- Create PostGIS / Earth distance indexes on marketplace_zones center coordinate
CREATE INDEX IF NOT EXISTS idx_marketplace_zones_geo ON marketplace_zones USING gist (ll_to_earth(center_lat, center_lng));
`;

async function main() {
    try {
        console.log("🛠️ Running Marketplace & Lifecycle schema updates...");
        await db.query(SQL);
        console.log("✅ Database schema migrated successfully.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Schema update failed:", err.message);
        process.exit(1);
    }
}

main();
