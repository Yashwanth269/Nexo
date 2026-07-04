const db = require('./config/db');

async function migrate() {
    try {
        console.log("Starting Phase 3 Schema Hardening Migrations...");

        // 1. Add missing columns to users table
        console.log("Adding missing columns to 'users' table...");
        await db.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS reliability_score INTEGER DEFAULT 100,
            ADD COLUMN IF NOT EXISTS locations JSONB DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS location TEXT,
            ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'::jsonb;
        `);

        // 2. Add indexes for performance and querying
        console.log("Adding database indexes...");
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
            CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
            CREATE INDEX IF NOT EXISTS idx_event_logs_timestamp ON event_logs(timestamp);
            CREATE INDEX IF NOT EXISTS idx_workers_online ON workers(is_online) WHERE is_online = true;
        `);

        // 3. Worker feature columns
        await db.query(`
            CREATE TABLE IF NOT EXISTS worker_features (
                worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
                completion_rate DECIMAL(5,2) DEFAULT 100.00,
                cancellation_rate DECIMAL(5,2) DEFAULT 0.00,
                avg_rating DECIMAL(3,2) DEFAULT 5.00,
                total_ratings_count INTEGER DEFAULT 0,
                avg_response_time DECIMAL(5,2) DEFAULT 1.5,
                reliability_score DECIMAL(5,2) DEFAULT 1.0,
                eta_confidence_score DECIMAL(3,2) DEFAULT 0.9,
                worker_load_score DECIMAL(5,2) DEFAULT 0.0,
                active_jobs_count INTEGER DEFAULT 0,
                fatigue_score DECIMAL(5,2) DEFAULT 0.0,
                fraud_risk_score DECIMAL(3,2) DEFAULT 0.0,
                is_shadow_banned BOOLEAN DEFAULT false,
                trust_decay_factor DECIMAL(5,2) DEFAULT 1.0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. Add payment_method column to jobs table
        console.log("Adding 'payment_method' column to 'jobs' table...");
        await db.query(`
            ALTER TABLE jobs 
            ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'ONLINE';
        `);

        // 5. Populate existing jobs with randomized payment methods for testing
        console.log("Randomizing payment methods for existing jobs...");
        await db.query(`
            UPDATE jobs 
            SET payment_method = CASE 
                WHEN random() < 0.33 THEN 'CASH'
                WHEN random() < 0.66 THEN 'UPI'
                ELSE 'ONLINE'
            END
            WHERE payment_method IS NULL OR payment_method = 'ONLINE';
        `);

        // 6. Add type and metadata columns to messages table
        console.log("Adding 'type' and 'metadata' columns to 'messages' table...");
        await db.query(`
            ALTER TABLE messages 
            ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'text',
            ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
        `);

        // 7. Create wallets, transactions, payouts, and payments tables
        console.log("Creating wallet and payment system tables...");
        await db.query(`
            CREATE TABLE IF NOT EXISTS wallets (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                owner_id UUID NOT NULL,
                owner_type VARCHAR(20) NOT NULL,
                balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                hold_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_owner UNIQUE (owner_id, owner_type)
            );

            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
                type VARCHAR(20) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                reference_id TEXT,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS payouts (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
                amount DECIMAL(12,2) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                bank_account JSONB,
                utr TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS payments (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
                payer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
                amount DECIMAL(12,2) NOT NULL,
                payment_mode VARCHAR(20) NOT NULL,
                payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                gateway_reference TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_wallets_owner ON wallets(owner_id, owner_type);
            CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions(wallet_id);
            CREATE INDEX IF NOT EXISTS idx_payouts_worker ON payouts(worker_id);
            CREATE INDEX IF NOT EXISTS idx_payments_job ON payments(job_id);
            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);
        `);

        console.log("Migrations completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
