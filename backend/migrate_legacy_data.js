const db = require('./config/db');
const fs = require('fs');
const path = require('path');

async function migrateData() {
    try {
        const usersPath = path.join(__dirname, 'data', 'users.json');
        if (!fs.existsSync(usersPath)) {
            console.log('⚠️ No users.json found, skipping migration.');
            return;
        }

        const rawData = fs.readFileSync(usersPath, 'utf8');
        const legacyUsers = JSON.parse(rawData);

        console.log(`🔍 Found ${Object.keys(legacyUsers).length} legacy users to migrate.`);

        for (const phone in legacyUsers) {
            const u = legacyUsers[phone];
            console.log(`\n⏳ Migrating ${phone}...`);

            // 1. Sync with Users table (if exists or new)
            await db.query(`
                INSERT INTO users (phone_number, full_name, last_login_gps)
                VALUES ($1, $2, $3)
                ON CONFLICT (phone_number) 
                DO UPDATE SET full_name = EXCLUDED.full_name
            `, [phone, u.name || 'Legacy User', JSON.stringify(u.locations?.[0] || {})]);

            // 2. Sync with Workers table (if role is worker or has worker fields)
            if (u.role === 'WORKER' || u.skills?.length > 0) {
                console.log(`   🛠️ Migrating as Worker...`);
                await db.query(`
                    INSERT INTO workers (
                        phone_number, full_name, skills, tasks, languages, 
                        state, experience, work_radius, photo_url, id_url, 
                        is_profile_complete, verification_status, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    ON CONFLICT (phone_number) 
                    DO UPDATE SET 
                        full_name = EXCLUDED.full_name,
                        skills = EXCLUDED.skills,
                        tasks = EXCLUDED.tasks,
                        languages = EXCLUDED.languages,
                        state = EXCLUDED.state,
                        experience = EXCLUDED.experience,
                        work_radius = EXCLUDED.work_radius,
                        photo_url = EXCLUDED.photo_url,
                        id_url = EXCLUDED.id_url,
                        is_profile_complete = EXCLUDED.is_profile_complete,
                        verification_status = EXCLUDED.verification_status,
                        updated_at = EXCLUDED.updated_at
                `, [
                    phone,
                    u.name || 'Legacy Worker',
                    u.skills || [],
                    u.tasks || [],
                    u.languages || [],
                    u.state || null,
                    u.experience || null,
                    u.workRadius || 15,
                    u.photoUrl || null,
                    u.idUrl || null,
                    u.isProfileComplete || false,
                    u.verificationStatus || 'UNVERIFIED',
                    u.updatedAt || new Date().toISOString()
                ]);
            }
        }

        console.log('\n✅ Data migration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration error:', err.message);
        process.exit(1);
    }
}

migrateData();
