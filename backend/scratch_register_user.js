const db = require('./config/db');

async function registerTestUser() {
    try {
        const userId = '4d1a3b5c-2e9f-4b0d-8a7e-1f6b2c3d4e5f';
        const phone = '9731016442';
        
        await db.query(
            'INSERT INTO users (id, phone_number) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
            [userId, phone]
        );
        console.log('✅ [SCRATCH] Test user registered successfully.');
        process.exit(0);
    } catch (err) {
        console.error('❌ [SCRATCH] Error registering user:', err.message);
        process.exit(1);
    }
}

registerTestUser();
