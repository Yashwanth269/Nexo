const db = require('../config/db');

class MigrationRunnerService {
    async runAllMigrations() {
        console.log("🛠️ [MIGRATION-START] Running database auto-migrations...");

        const queries = [
            // Extensions
            "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";",
            "CREATE EXTENSION IF NOT EXISTS cube;",
            "CREATE EXTENSION IF NOT EXISTS earthdistance;",

            // 1. Worker availability state
            "ALTER TABLE workers ADD COLUMN IF NOT EXISTS availability_state VARCHAR(50) DEFAULT 'OFFLINE';",

            // 2. worker_calendar table
            `CREATE TABLE IF NOT EXISTS worker_calendar (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                booking_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
                customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
                service_category VARCHAR(100) NOT NULL,
                scheduled_start TIMESTAMP WITH TIME ZONE NOT NULL,
                estimated_duration_minutes INTEGER NOT NULL,
                travel_time_before_minutes INTEGER DEFAULT 0,
                travel_time_after_minutes INTEGER DEFAULT 0,
                buffer_before_minutes INTEGER DEFAULT 0,
                buffer_after_minutes INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'CONFIRMED',
                location_lat DECIMAL(9, 6),
                location_lng DECIMAL(9, 6),
                priority VARCHAR(50) DEFAULT 'NORMAL',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,

            "CREATE INDEX IF NOT EXISTS idx_worker_calendar_worker_time ON worker_calendar(worker_id, scheduled_start);",
            "CREATE INDEX IF NOT EXISTS idx_worker_calendar_booking ON worker_calendar(booking_id);",

            // 3. Marketplace Zones
            `CREATE TABLE IF NOT EXISTS marketplace_zones (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                city VARCHAR(100) NOT NULL,
                zone_name VARCHAR(100) NOT NULL,
                locality VARCHAR(100) NOT NULL,
                center_lat DECIMAL(10, 8) NOT NULL,
                center_lng DECIMAL(11, 8) NOT NULL,
                radius_km DECIMAL DEFAULT 5.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,

            // Seed default Bangalore zones if empty
            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'Central', 'MG Road', 12.9756, 77.6067, 3.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'MG Road');`,

            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'South', 'Koramangala', 12.9352, 77.6244, 4.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Koramangala');`,

            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'South', 'HSR Layout', 12.9105, 77.6450, 4.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'HSR Layout');`,

            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'South', 'Jayanagar', 12.9307, 77.5824, 4.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Jayanagar');`,

            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'East', 'Indiranagar', 12.9719, 77.6412, 4.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Indiranagar');`,

            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'East', 'Whitefield', 12.9698, 77.7499, 6.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Whitefield');`,

            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'West', 'Rajajinagar', 12.9882, 77.5540, 4.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Rajajinagar');`,

            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
            SELECT 'Bangalore', 'North', 'Hebbal', 13.0358, 77.5970, 5.0 
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Hebbal');`,

            // 4. Incentive Recommendations
            `CREATE TABLE IF NOT EXISTS incentive_recommendations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                zone_id UUID REFERENCES marketplace_zones(id) ON DELETE CASCADE,
                incentive_type VARCHAR(50) NOT NULL,
                recommended_value DECIMAL(10, 2) NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(30) DEFAULT 'PENDING_APPROVAL',
                approved_by UUID,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,

            // 5. Job SLAs
            `CREATE TABLE IF NOT EXISTS job_slas (
                job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
                sla_type VARCHAR(50) NOT NULL,
                assignment_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
                arrival_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(30) DEFAULT 'ACTIVE',
                predicted_failure_reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,

            // 6. Alter Jobs table for lifecycle
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS state_timestamps JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_timer JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS before_photos TEXT[] DEFAULT '{}'::TEXT[];",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS after_photos TEXT[] DEFAULT '{}'::TEXT[];",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'::jsonb;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_signature TEXT;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS worker_signature TEXT;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payout_status VARCHAR(30) DEFAULT 'PENDING';",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_otp TEXT;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_otp_verified BOOLEAN DEFAULT false;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_otp TEXT;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_otp_verified BOOLEAN DEFAULT false;",

            // Create PostGIS / Earth distance indexes on marketplace_zones center coordinate
            "CREATE INDEX IF NOT EXISTS idx_marketplace_zones_geo ON marketplace_zones USING gist (ll_to_earth(center_lat, center_lng));",
        ];

        for (const query of queries) {
            try {
                await db.query(query);
            } catch (err) {
                // If PostGIS functions are missing, log a warning but proceed
                if (query.includes("ll_to_earth") && err.message.includes("does not exist")) {
                    console.warn("⚠️ [MIGRATION-WARN] Earth distance query failed (missing earthdistance extension). Skipping earth distance index.");
                } else {
                    console.error("❌ [MIGRATION-ERROR] Query failed:", query.substring(0, 100), "Error:", err.message);
                    throw err;
                }
            }
        }

        console.log("✅ [MIGRATION-SUCCESS] All auto-migrations applied successfully.");
    }
}

module.exports = new MigrationRunnerService();
