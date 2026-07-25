const fs = require('fs');
const path = require('path');
const db = require('./config/db');

async function main() {
    try {
        console.log("🛠️ Running Database bootstrap versioned migrations...");
        
        const migrationFiles = [
            '001_initial.sql',
            '002_wallet.sql',
            '003_dispatch.sql',
            '004_ml.sql',
            '005_security.sql',
            '006_trust.sql',
            '007_payments.sql'
        ];

        for (const file of migrationFiles) {
            console.log(`Executing migration file: ${file}`);
            const filePath = path.join(__dirname, 'db', 'migrations', file);
            const sql = fs.readFileSync(filePath, 'utf8');
            await db.query(sql);
            console.log(`✅ Success: ${file}`);
        }

        console.log("⚡ Auto-verifying all workers in DB...");
        await db.query("UPDATE workers SET verification_status = 'VERIFIED' WHERE verification_status != 'VERIFIED'");
        console.log("✅ All workers verified successfully.");

        console.log("⚡ Restoring non-user-cancelled FAILED jobs to REDISTRIBUTING...");
        const restored = await db.query(`
            UPDATE jobs 
            SET status = 'REDISTRIBUTING', updated_at = CURRENT_TIMESTAMP 
            WHERE status = 'FAILED' 
              AND id NOT IN (SELECT job_id FROM job_cancellations)
            RETURNING id
        `);
        console.log(`✅ Restored ${restored.rowCount} non-cancelled jobs to REDISTRIBUTING state.`);

        process.exit(0);
    } catch (e) {
        console.error("❌ Failed database bootstrap:", e.message);
        process.exit(1);
    }
}

main();
