const db = require('./config/db');
async function check() {
    try {
        const res = await db.query("SELECT id, status, category FROM jobs WHERE user_id = '4d1a3b5c-2e9f-4b0d-8a7e-1f6b2c3d4e5f'");
        console.log("Jobs for user:", res.rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
