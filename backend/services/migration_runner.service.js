const db = require('../config/db');

// Explicit versioned migration script registry
const MIGRATIONS = [
    {
        version: 1,
        name: 'uuid_and_availability',
        up: [
            'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
            'CREATE EXTENSION IF NOT EXISTS cube;',
            'CREATE EXTENSION IF NOT EXISTS earthdistance;',
            "ALTER TABLE workers ADD COLUMN IF NOT EXISTS availability_state VARCHAR(50) DEFAULT 'OFFLINE';"
        ],
        down: [
            "ALTER TABLE workers DROP COLUMN IF EXISTS availability_state;"
        ]
    },
    {
        version: 2,
        name: 'worker_calendar',
        up: [
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
            "CREATE INDEX IF NOT EXISTS idx_worker_calendar_booking ON worker_calendar(booking_id);"
        ],
        down: [
            "DROP TABLE IF EXISTS worker_calendar CASCADE;"
        ]
    },
    {
        version: 3,
        name: 'marketplace_zones',
        up: [
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
            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
             SELECT 'Bangalore', 'South', 'Koramangala', 12.9352, 77.6244, 4.0 
             WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'Koramangala');`,
            `INSERT INTO marketplace_zones (city, zone_name, locality, center_lat, center_lng, radius_km)
             SELECT 'Bangalore', 'South', 'HSR Layout', 12.9105, 77.6450, 4.0 
             WHERE NOT EXISTS (SELECT 1 FROM marketplace_zones WHERE locality = 'HSR Layout');`
        ],
        down: [
            "DROP TABLE IF EXISTS marketplace_zones CASCADE;"
        ]
    },
    {
        version: 4,
        name: 'incentive_recommendations_and_slas',
        up: [
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
            `CREATE TABLE IF NOT EXISTS job_slas (
                job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
                sla_type VARCHAR(50) NOT NULL,
                assignment_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
                arrival_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(30) DEFAULT 'ACTIVE',
                predicted_failure_reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`
        ],
        down: [
            "DROP TABLE IF EXISTS incentive_recommendations CASCADE;",
            "DROP TABLE IF EXISTS job_slas CASCADE;"
        ]
    },
    {
        version: 5,
        name: 'job_lifecycle_columns',
        up: [
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
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_otp_verified BOOLEAN DEFAULT false;"
        ],
        down: [
            "ALTER TABLE jobs DROP COLUMN IF EXISTS state_timestamps;",
            "ALTER TABLE jobs DROP COLUMN IF EXISTS service_timer;"
        ]
    },
    {
        version: 6,
        name: 'scheduled_bidding_extensions',
        up: [
            "ALTER TABLE workers ADD COLUMN IF NOT EXISTS commitment_score DECIMAL(5, 2) DEFAULT 100.0;",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS offer_price DECIMAL(10, 2);",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS proposed_scheduled_at TIMESTAMP WITH TIME ZONE;",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS counter_notes TEXT;",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE;",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMP WITH TIME ZONE;",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS worker_confirmed_at TIMESTAMP WITH TIME ZONE;",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;"
        ],
        down: [
            "ALTER TABLE workers DROP COLUMN IF EXISTS commitment_score;"
        ]
    },
    {
        version: 7,
        name: 'observability_and_dispatch',
        up: [
            "CREATE INDEX IF NOT EXISTS idx_marketplace_zones_geo ON marketplace_zones USING gist (ll_to_earth(center_lat, center_lng));",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS queue_refresh_count INTEGER DEFAULT 0;",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS queue_build_time_ms INTEGER DEFAULT 0;",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS pools_used INTEGER DEFAULT 0;",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS offers_expired_count INTEGER DEFAULT 0;",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS offers_declined_count INTEGER DEFAULT 0;",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS standby_used BOOLEAN DEFAULT FALSE;",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS emergency_recovery_count INTEGER DEFAULT 0;",
            "ALTER TABLE search_analytics_logs ADD COLUMN IF NOT EXISTS duplicate_acceptance_attempts INTEGER DEFAULT 0;",
            "ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS dispatch_pool_id INTEGER DEFAULT 1;",
            "CREATE INDEX IF NOT EXISTS idx_job_offers_dispatch_pool ON job_offers(job_id, dispatch_pool_id);"
        ],
        down: [
            "ALTER TABLE job_offers DROP COLUMN IF EXISTS dispatch_pool_id;"
        ]
    },
    {
        version: 8,
        name: 'preferences_achievements_and_flags',
        up: [
            `CREATE TABLE IF NOT EXISTS worker_zone_preferences (
                worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
                primary_zone VARCHAR(100),
                work_radius INTEGER DEFAULT 15,
                secondary_zones TEXT[] DEFAULT '{}',
                avoid_areas TEXT[] DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            "ALTER TABLE worker_zone_preferences ADD COLUMN IF NOT EXISTS skill_ratings JSONB DEFAULT '{}'::jsonb;",
            `CREATE TABLE IF NOT EXISTS worker_achievements (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                achievement_type VARCHAR(100) NOT NULL,
                title VARCHAR(100) NOT NULL,
                description TEXT,
                icon VARCHAR(50),
                awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(worker_id, achievement_type)
            );`,
            "ALTER TABLE disputes ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN DEFAULT FALSE;",
            "ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS rules JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS prerequisites TEXT[] DEFAULT '{}';"
        ],
        down: [
            "DROP TABLE IF EXISTS worker_zone_preferences CASCADE;",
            "DROP TABLE IF EXISTS worker_achievements CASCADE;"
        ]
    },
    {
        version: 9,
        name: 'idempotency_keys_and_minimum_guarantee',
        up: [
            "ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'COMPLETED';",
            "ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);",
            `CREATE TABLE IF NOT EXISTS minimum_guarantee_payouts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                payout_date DATE NOT NULL,
                jobs_completed INT NOT NULL,
                actual_earnings DECIMAL(10,2) NOT NULL,
                guarantee_target DECIMAL(10,2) NOT NULL,
                top_up_amount DECIMAL(10,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            "CREATE INDEX IF NOT EXISTS idx_min_guarantee_worker_date ON minimum_guarantee_payouts(worker_id, payout_date);"
        ],
        down: [
            "DROP TABLE IF EXISTS minimum_guarantee_payouts CASCADE;"
        ]
    },
    {
        version: 10,
        name: 'minimum_guarantee_extensions',
        up: [
            "ALTER TABLE minimum_guarantee_payouts ADD COLUMN IF NOT EXISTS eligible BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE minimum_guarantee_payouts ADD COLUMN IF NOT EXISTS rejection_reason TEXT;",
            "ALTER TABLE minimum_guarantee_payouts ADD COLUMN IF NOT EXISTS qualification_reason TEXT;",
            "ALTER TABLE minimum_guarantee_payouts ADD CONSTRAINT unique_worker_payout_date UNIQUE(worker_id, payout_date);"
        ],
        down: [
            "ALTER TABLE minimum_guarantee_payouts DROP CONSTRAINT IF EXISTS unique_worker_payout_date;",
            "ALTER TABLE minimum_guarantee_payouts DROP COLUMN IF EXISTS eligible;",
            "ALTER TABLE minimum_guarantee_payouts DROP COLUMN IF EXISTS rejection_reason;",
            "ALTER TABLE minimum_guarantee_payouts DROP COLUMN IF EXISTS qualification_reason;"
        ]
    },
    {
        version: 11,
        name: 'dispatch_breakdown_metadata',
        up: [
            "ALTER TABLE dispatch_ranking_breakdowns ADD COLUMN IF NOT EXISTS model_version VARCHAR(50) DEFAULT '1.2.0-bandit';",
            "ALTER TABLE dispatch_ranking_breakdowns ADD COLUMN IF NOT EXISTS feature_version VARCHAR(50) DEFAULT '2.0.1';",
            "ALTER TABLE dispatch_ranking_breakdowns ADD COLUMN IF NOT EXISTS dispatch_policy_version VARCHAR(50) DEFAULT '1.0.0';"
        ],
        down: [
            "ALTER TABLE dispatch_ranking_breakdowns DROP COLUMN IF EXISTS model_version;",
            "ALTER TABLE dispatch_ranking_breakdowns DROP COLUMN IF EXISTS feature_version;",
            "ALTER TABLE dispatch_ranking_breakdowns DROP COLUMN IF EXISTS dispatch_policy_version;"
        ]
    },
    {
        version: 12,
        name: 'ml_training_data_schema_extensions',
        up: [
            "ALTER TABLE ml_training_data ADD COLUMN IF NOT EXISTS prediction_id UUID UNIQUE DEFAULT gen_random_uuid();",
            "ALTER TABLE ml_training_data ADD COLUMN IF NOT EXISTS feature_store_version VARCHAR(50) DEFAULT '1.0.0';",
            "ALTER TABLE ml_training_data ADD COLUMN IF NOT EXISTS feature_schema_version VARCHAR(50) DEFAULT '1.0.0';",
            "ALTER TABLE ml_training_data ADD COLUMN IF NOT EXISTS model_version VARCHAR(50) DEFAULT '1.0.0';",
            "ALTER TABLE ml_training_data ADD COLUMN IF NOT EXISTS weather VARCHAR(50);",
            "ALTER TABLE ml_training_data ADD COLUMN IF NOT EXISTS holiday_flag BOOLEAN DEFAULT FALSE;",
            "ALTER TABLE ml_training_data ADD COLUMN IF NOT EXISTS dispatch_policy_version VARCHAR(50);"
        ],
        down: [
            "ALTER TABLE ml_training_data DROP COLUMN IF EXISTS weather;",
            "ALTER TABLE ml_training_data DROP COLUMN IF EXISTS holiday_flag;",
            "ALTER TABLE ml_training_data DROP COLUMN IF EXISTS dispatch_policy_version;"
        ]
    },
    {
        version: 13,
        name: 'secure_otp_schema_extensions',
        up: [
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_otp_expiry TIMESTAMP;",
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_otp_expiry TIMESTAMP;",
            "ALTER TABLE jobs ALTER COLUMN start_otp TYPE VARCHAR(64);",
            "ALTER TABLE jobs ALTER COLUMN completion_otp TYPE VARCHAR(64);"
        ],
        down: [
            "ALTER TABLE jobs DROP COLUMN IF EXISTS start_otp_expiry;",
            "ALTER TABLE jobs DROP COLUMN IF EXISTS completion_otp_expiry;",
            "ALTER TABLE jobs ALTER COLUMN start_otp TYPE VARCHAR(50);",
            "ALTER TABLE jobs ALTER COLUMN completion_otp TYPE VARCHAR(50);"
        ]
    },
    {
        version: 14,
        name: 'double_entry_ledger_and_payment_events',
        up: [
            "DELETE FROM razorpay_webhooks a USING razorpay_webhooks b WHERE a.ctid < b.ctid AND a.razorpay_id = b.razorpay_id;",
            "ALTER TABLE razorpay_webhooks ADD CONSTRAINT unique_razorpay_event_id UNIQUE(razorpay_id);",
            `CREATE TABLE IF NOT EXISTS double_entry_ledger (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                account_id UUID NOT NULL,
                account_type VARCHAR(50) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                entry_type VARCHAR(10) NOT NULL, -- DEBIT/CREDIT
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS payment_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_type VARCHAR(50) NOT NULL,
                payload JSONB NOT NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`
        ],
        down: [
            "ALTER TABLE razorpay_webhooks DROP CONSTRAINT IF EXISTS unique_razorpay_event_id;",
            "DROP TABLE IF EXISTS double_entry_ledger CASCADE;",
            "DROP TABLE IF EXISTS payment_events CASCADE;"
        ]
    },
    {
        version: 15,
        name: 'customer_memberships_table',
        up: [
            `CREATE TABLE IF NOT EXISTS customer_memberships (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                tier VARCHAR(50) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                fee_discount_pct DECIMAL(5,2) NOT NULL,
                free_cancellations_remaining INT NOT NULL,
                starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`
        ],
        down: [
            "DROP TABLE IF EXISTS customer_memberships CASCADE;"
        ]
    },
    {
        version: 16,
        name: 'multi_service_booking_engine',
        up: [
            `CREATE TABLE IF NOT EXISTS worker_skill_confidence (
                worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                category VARCHAR(100) NOT NULL,
                confidence_score DECIMAL(5,2) DEFAULT 0.00,
                jobs_completed INTEGER DEFAULT 0,
                avg_rating DECIMAL(3,2) DEFAULT 0.00,
                dispute_count INTEGER DEFAULT 0,
                repeat_customer_count INTEGER DEFAULT 0,
                calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (worker_id, category)
            );`,
            `CREATE TABLE IF NOT EXISTS multi_service_bookings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'PENDING_PLAN', -- PENDING_PLAN, PLAN_READY, ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED
                location_lat DECIMAL(9,6) NOT NULL,
                location_lng DECIMAL(10,6) NOT NULL,
                address TEXT,
                total_price DECIMAL(10,2) DEFAULT 0.00,
                plan_type VARCHAR(20) DEFAULT 'SINGLE_WORKER', -- SINGLE_WORKER, MULTI_WORKER
                selected_plan_index INT,
                estimated_duration_minutes INT DEFAULT 0,
                scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS multi_service_booking_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                booking_id UUID REFERENCES multi_service_bookings(id) ON DELETE CASCADE,
                service_category VARCHAR(100) NOT NULL,
                description TEXT,
                base_price DECIMAL(10,2) NOT NULL,
                status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, ASSIGNED, IN_PROGRESS, COMPLETED
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS multi_service_assignments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                booking_id UUID REFERENCES multi_service_bookings(id) ON DELETE CASCADE,
                worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                assigned_categories JSONB NOT NULL, -- e.g. ["AC Repair", "Fan Installation"]
                status VARCHAR(50) DEFAULT 'PENDING_ACCEPTANCE', -- PENDING_ACCEPTANCE, ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED
                worker_payout DECIMAL(10,2) DEFAULT 0.00,
                arrival_eta_minutes INT DEFAULT 30,
                accepted_at TIMESTAMP WITH TIME ZONE,
                completed_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS multi_service_addon_offers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                booking_id UUID REFERENCES multi_service_bookings(id) ON DELETE CASCADE,
                worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
                service_category VARCHAR(100) NOT NULL,
                description TEXT,
                proposed_price DECIMAL(10,2) NOT NULL,
                source VARCHAR(20) DEFAULT 'WORKER_SUGGESTED', -- WORKER_SUGGESTED, AI_DETECTED
                status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, ACCEPTED, DECLINED
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                responded_at TIMESTAMP WITH TIME ZONE
            );`,
            "CREATE INDEX IF NOT EXISTS idx_multi_booking_user ON multi_service_bookings(user_id);",
            "CREATE INDEX IF NOT EXISTS idx_multi_booking_items_booking ON multi_service_booking_items(booking_id);",
            "CREATE INDEX IF NOT EXISTS idx_multi_booking_assign_worker ON multi_service_assignments(worker_id);",
            "CREATE INDEX IF NOT EXISTS idx_multi_booking_addon_booking ON multi_service_addon_offers(booking_id);",
            "ALTER TABLE worker_calendar ADD COLUMN IF NOT EXISTS multi_service_booking_id UUID REFERENCES multi_service_bookings(id) ON DELETE CASCADE;"
        ],
        down: [
            "ALTER TABLE worker_calendar DROP COLUMN IF EXISTS multi_service_booking_id;",
            "DROP TABLE IF EXISTS multi_service_addon_offers CASCADE;",
            "DROP TABLE IF EXISTS multi_service_assignments CASCADE;",
            "DROP TABLE IF EXISTS multi_service_booking_items CASCADE;",
            "DROP TABLE IF EXISTS multi_service_bookings CASCADE;",
            "DROP TABLE IF EXISTS worker_skill_confidence CASCADE;"
        ]
    },
    {
        version: 17,
        name: 'disputes_payment_id_column',
        up: [
            "ALTER TABLE disputes ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;"
        ],
        down: [
            "ALTER TABLE disputes DROP COLUMN IF EXISTS payment_id;"
        ]
    },
    {
        version: 18,
        name: 'training_schedule_and_disputes_update',
        up: [
            `CREATE TABLE IF NOT EXISTS training_schedule (
                model_name VARCHAR(100) PRIMARY KEY,
                last_trained_at TIMESTAMP WITH TIME ZONE,
                last_data_count INT DEFAULT 0,
                total_training_runs INT DEFAULT 0,
                last_auc DECIMAL(5,4),
                best_auc DECIMAL(5,4) DEFAULT 0.0,
                status VARCHAR(50) DEFAULT 'idle',
                error_message TEXT,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            "ALTER TABLE disputes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;"
        ],
        down: [
            "DROP TABLE IF EXISTS training_schedule CASCADE;",
            "ALTER TABLE disputes DROP COLUMN IF EXISTS updated_at;"
        ]
    },
    {
        version: 19,
        name: 'clean_stock_photo_placeholders',
        up: [
            "UPDATE workers SET photo_url = NULL WHERE photo_url LIKE '%unsplash%' OR photo_url LIKE '%pravatar%' OR photo_url LIKE '%adventurer%' OR photo_url LIKE '%i.pravatar.cc%';",
            "UPDATE users SET photo_url = NULL WHERE photo_url LIKE '%unsplash%' OR photo_url LIKE '%pravatar%' OR photo_url LIKE '%adventurer%' OR photo_url LIKE '%i.pravatar.cc%';",
            "UPDATE users SET avatar_url = NULL WHERE avatar_url LIKE '%unsplash%' OR avatar_url LIKE '%pravatar%' OR avatar_url LIKE '%adventurer%' OR avatar_url LIKE '%i.pravatar.cc%';"
        ],
        down: []
    },
    {
        version: 20,
        name: 'seed_all_in_one_marketplace',
        up: [
            `CREATE TABLE IF NOT EXISTS marketplace_categories (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(100) NOT NULL UNIQUE,
                slug VARCHAR(100) NOT NULL UNIQUE,
                icon VARCHAR(100),
                description TEXT,
                sort_order INT DEFAULT 0,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS marketplace_subcategories (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                category_id UUID NOT NULL REFERENCES marketplace_categories(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                slug VARCHAR(100) NOT NULL UNIQUE,
                icon VARCHAR(100),
                image TEXT,
                description TEXT,
                default_pricing_type VARCHAR(20) DEFAULT 'FIXED',
                min_price NUMERIC(10,2) DEFAULT 0.00,
                max_price NUMERIC(10,2) DEFAULT 0.00,
                keywords TEXT[],
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS worker_skills (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
                category_id UUID REFERENCES marketplace_categories(id) ON DELETE CASCADE,
                subcategory_id UUID REFERENCES marketplace_subcategories(id) ON DELETE CASCADE,
                skill_name VARCHAR(100) NOT NULL,
                experience_years INT DEFAULT 1,
                certifications TEXT[],
                hourly_rate NUMERIC(10,2),
                fixed_rate NUMERIC(10,2),
                pricing_type VARCHAR(20) DEFAULT 'HOURLY',
                is_emergency BOOLEAN DEFAULT false,
                experience_level VARCHAR(20) DEFAULT 'INTERMEDIATE',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_worker_subcategory UNIQUE (worker_id, subcategory_id, skill_name)
            );`
        ],
        down: [
            "DROP TABLE IF EXISTS worker_skills CASCADE;",
            "DROP TABLE IF EXISTS marketplace_subcategories CASCADE;",
            "DROP TABLE IF EXISTS marketplace_categories CASCADE;"
        ]
    },
    {
        version: 21,
        name: 'homepage_layout_engine_and_banner_cms',
        up: [
            `CREATE TABLE IF NOT EXISTS homepage_layouts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(100) NOT NULL UNIQUE,
                version INT DEFAULT 1,
                is_active BOOLEAN DEFAULT true,
                ab_split_pct INT DEFAULT 100,
                target_user_segment VARCHAR(50) DEFAULT 'ALL',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS homepage_sections (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                layout_id UUID REFERENCES homepage_layouts(id) ON DELETE CASCADE,
                section_type VARCHAR(50) NOT NULL,
                title VARCHAR(100),
                subtitle VARCHAR(150),
                sort_order INT DEFAULT 0,
                is_enabled BOOLEAN DEFAULT true,
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS banner_campaigns (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR(150) NOT NULL,
                subtitle VARCHAR(200),
                description TEXT,
                cta_text VARCHAR(50) DEFAULT 'Book Now ->',
                image_url TEXT,
                bg_color VARCHAR(30) DEFAULT '#FFF7ED',
                text_color VARCHAR(30) DEFAULT '#1E293B',
                badge_text VARCHAR(50),
                target_action VARCHAR(50) DEFAULT 'OPEN_SEARCH',
                action_payload TEXT,
                priority INT DEFAULT 1,
                start_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                end_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 year'),
                target_cities TEXT[] DEFAULT ARRAY['ALL'],
                target_user_segments TEXT[] DEFAULT ARRAY['ALL'],
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS banner_impressions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                banner_id UUID REFERENCES banner_campaigns(id) ON DELETE CASCADE,
                user_id VARCHAR(100),
                city VARCHAR(100),
                device_type VARCHAR(50) DEFAULT 'MOBILE',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS banner_clicks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                banner_id UUID REFERENCES banner_campaigns(id) ON DELETE CASCADE,
                user_id VARCHAR(100),
                action VARCHAR(50),
                action_payload TEXT,
                city VARCHAR(100),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`
        ],
        down: [
            "DROP TABLE IF EXISTS banner_clicks CASCADE;",
            "DROP TABLE IF EXISTS banner_impressions CASCADE;",
            "DROP TABLE IF EXISTS banner_campaigns CASCADE;",
            "DROP TABLE IF EXISTS homepage_sections CASCADE;",
            "DROP TABLE IF EXISTS homepage_layouts CASCADE;"
        ]
    },
    {
        version: 22,
        name: 'ai_prompt_library_and_asset_versioning',
        up: [
            `CREATE TABLE IF NOT EXISTS category_prompts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                category_id UUID REFERENCES marketplace_categories(id) ON DELETE CASCADE,
                subcategory_id UUID REFERENCES marketplace_subcategories(id) ON DELETE CASCADE,
                job_title VARCHAR(150) NOT NULL,
                job_tool VARCHAR(150) NOT NULL,
                master_prompt TEXT NOT NULL,
                negative_prompt TEXT NOT NULL,
                style_version INT DEFAULT 1,
                provider VARCHAR(50) DEFAULT 'GEMINI',
                is_approved BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_subcat_prompt UNIQUE (subcategory_id)
            );`,
            `CREATE TABLE IF NOT EXISTS category_images (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                category_id UUID REFERENCES marketplace_categories(id) ON DELETE CASCADE,
                subcategory_id UUID REFERENCES marketplace_subcategories(id) ON DELETE CASCADE,
                version INT DEFAULT 1,
                provider VARCHAR(50) DEFAULT 'GEMINI',
                prompt_id UUID REFERENCES category_prompts(id) ON DELETE SET NULL,
                prompt_used TEXT,
                image_url TEXT NOT NULL,
                thumbnail_url TEXT,
                status VARCHAR(30) DEFAULT 'GENERATING',
                approved BOOLEAN DEFAULT false,
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );`
        ],
        down: [
            "DROP TABLE IF EXISTS category_images CASCADE;",
            "DROP TABLE IF EXISTS category_prompts CASCADE;"
        ]
    }
];

const crypto = require('crypto');

class MigrationRunnerService {
    /**
     * Incremental Version-aware Migrations Runner (with rollback support)
     */
    async runAllMigrations() {
        if (process.env.SKIP_MIGRATIONS === 'true') {
            console.log("ℹ️ [MIGRATION-SKIP] Migration execution skipped due to SKIP_MIGRATIONS environment flag.");
            return;
        }

        console.log("🛠️ [MIGRATION-START] Running database auto-migrations...");

        // 1. Create schema_migrations tracking audit table if missing
        await db.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Alter schema_migrations table to add checksum column if missing
        await db.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);");

        // 2. Fetch applied migrations
        const appliedRes = await db.query("SELECT version, checksum FROM schema_migrations ORDER BY version ASC");
        const appliedMap = {};
        appliedRes.rows.forEach(r => {
            appliedMap[r.version] = r.checksum;
        });

        // 3. Filter and execute pending versioned scripts sequentially
        for (const m of MIGRATIONS) {
            // Compute MD5 hash of this migration definition to track changes
            const checksum = crypto.createHash('md5').update(JSON.stringify(m.up)).digest('hex');

            if (appliedMap[m.version] !== undefined) {
                const dbChecksum = appliedMap[m.version];
                // Checksum mismatch: migration code was edited after initial deployment.
                // The migration will NOT re-run (we continue regardless), so this is safe to auto-repair.
                if (dbChecksum && dbChecksum !== checksum) {
                    console.warn(`⚠️ [MIGRATION-CHECKSUM-WARN] Version ${m.version} (${m.name}) checksum mismatch — code was edited post-deployment. Auto-repairing stored checksum.`);
                    await db.query("UPDATE schema_migrations SET checksum = $1 WHERE version = $2", [checksum, m.version]);
                }
                continue;
            }

            console.log(`[MIGRATION] Applying Version ${m.version}: ${m.name}...`);
            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                
                for (const query of m.up) {
                    await client.query(query);
                }

                await client.query(
                    "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
                    [m.version, m.name, checksum]
                );

                await client.query('COMMIT');
                console.log(`[MIGRATION-SUCCESS] Version ${m.version} applied.`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[MIGRATION-FAILED] Rollback complete. Failed at Version ${m.version}:`, err.message);
                throw err;
            } finally {
                client.release();
            }
        }

        console.log("✅ [MIGRATION-SUCCESS] All incremental schema migrations successfully verified.");
    }

    /**
     * Rollback migrations to a target version
     */
    async rollbackTo(targetVersion) {
        console.log(`[ROLLBACK] Reverting schema migrations to version: ${targetVersion}`);
        
        // Environment policy protection: Prevent destructive drops in production environments
        if (process.env.NODE_ENV === 'production') {
            console.error("🚨 [ROLLBACK-DENIED] Rollbacks involving potential data drop are strictly restricted on production environments.");
            throw new Error("ROLLBACK_FORBIDDEN_IN_PRODUCTION");
        }

        const appliedRes = await db.query("SELECT version FROM schema_migrations ORDER BY version DESC");
        const appliedVersions = appliedRes.rows.map(r => r.version);

        for (const ver of appliedVersions) {
            if (ver <= targetVersion) break;

            const m = MIGRATIONS.find(item => item.version === ver);
            if (!m) continue;

            console.log(`[ROLLBACK] Reverting Version ${m.version}: ${m.name}...`);
            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');

                for (const query of m.down) {
                    await client.query(query);
                }

                await client.query("DELETE FROM schema_migrations WHERE version = $1", [m.version]);

                await client.query('COMMIT');
                console.log(`[ROLLBACK-SUCCESS] Reverted Version ${m.version}.`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[ROLLBACK-FAILED] Revert failed at Version ${m.version}:`, err.message);
                throw err;
            } finally {
                client.release();
            }
        }
    }
}

module.exports = new MigrationRunnerService();
