const { Client } = require('pg');
require('dotenv').config();

const schema = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Workers Table
CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT UNIQUE NOT NULL,
    full_name TEXT,
    skills TEXT[] DEFAULT '{}',
    rating DECIMAL(3,2) DEFAULT 4.5,
    completion_rate INTEGER DEFAULT 100,
    is_online BOOLEAN DEFAULT false,
    is_available BOOLEAN DEFAULT true,
    current_lat DECIMAL(9,6),
    current_lng DECIMAL(9,6),
    jobs_completed INTEGER DEFAULT 0,
    is_profile_complete BOOLEAN DEFAULT false,
    tasks TEXT[] DEFAULT '{}',
    languages TEXT[] DEFAULT '{}',
    state TEXT,
    experience TEXT,
    work_radius INTEGER DEFAULT 15,
    photo_url TEXT,
    id_url TEXT,
    verification_status TEXT DEFAULT 'UNVERIFIED',
    last_login_gps JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Jobs Table
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    worker_id UUID REFERENCES workers(id),
    category TEXT NOT NULL,
    description TEXT,
    location_lat DECIMAL(9,6) NOT NULL,
    location_lng DECIMAL(9,6) NOT NULL,
    address TEXT,
    price INTEGER NOT NULL,
    status TEXT DEFAULT 'OPEN', -- OPEN, SCHEDULED, ON_THE_WAY, ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED
    scheduled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expiry_time TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 hours'),
    payment_method TEXT DEFAULT 'ONLINE'
);

-- 5. Event Logs Table (Mandatory for ML tracking)
CREATE TABLE IF NOT EXISTS event_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL, -- new_worker_assigned, new_worker_accepted, etc.
    user_id UUID,
    worker_id UUID,
    job_id UUID,
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Job Offers Table (Tracks individual dispatches)
CREATE TABLE IF NOT EXISTS job_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id),
    worker_id UUID REFERENCES workers(id),
    status TEXT DEFAULT 'PENDING', -- PENDING, ACCEPTED, REJECTED, EXPIRED
    score DECIMAL(5,2),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 minutes'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bids/Offers Table (For negotiations)
CREATE TABLE IF NOT EXISTS bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id),
    worker_id UUID REFERENCES workers(id),
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert Demo User and Worker if not exists
INSERT INTO users (id, phone_number, full_name) 
VALUES ('c56a4180-65aa-42ec-a945-5fd21dec0538', '9100000000', 'Demo User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workers (id, phone_number, full_name, skills, is_online) 
VALUES ('fd74bfa8-692a-4467-9750-f80e550e6878', '9731016442', 'Demo Worker', '{Electrician, Agriculture Work, Plumbing}', true)
ON CONFLICT (id) DO NOTHING;
`;

async function initDB() {
    // 1. Connect to 'postgres' to create 'gigs_db'
    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: 'postgres',
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
    });

    try {
        await client.connect();
        console.log('🐘 Connected to PostgreSQL server.');

        console.log('🛠️ Initializing Schema...');
        
        // Enable UUID extension
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

        // Check if database exists
        const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'gigs_db'");
        if (res.rowCount === 0) {
            console.log("📂 Creating 'gigs_db'...");
            await client.query('CREATE DATABASE gigs_db');
        }
        await client.end();

        // 2. Connect to 'gigs_db' to initialize schema
        const gigClient = new Client({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: 'gigs_db',
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT,
        });

        await gigClient.connect();
        console.log("🛠️ Initializing Schema...");
        await gigClient.query(schema);
        console.log("🚀 Database Initialized Successfully!");
        await gigClient.end();
        process.exit(0);
    } catch (err) {
        console.error("❌ Initialization Failed:", err.message);
        process.exit(1);
    }
}

initDB();
