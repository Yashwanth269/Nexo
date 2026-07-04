const db = require('./config/db');

async function checkTables() {
    try {
        const res = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name IN ('workers', 'jobs')");
        console.log('📋 Column Types:', res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkTables();
