const db = require('./config/db');

async function checkTimeline(jobId) {
    try {
        console.log(`🔍 Checking timeline for Job: ${jobId}`);
        
        // 1. Check Job Status
        const jobRes = await db.query("SELECT status, user_id, worker_id FROM jobs WHERE id = $1", [jobId]);
        if (jobRes.rowCount === 0) {
            console.error("❌ Job not found");
            return;
        }
        console.log("📄 Job Status:", jobRes.rows[0]);

        // 2. Check Event Logs
        const logsRes = await db.query(
            "SELECT event_type, created_at FROM event_logs WHERE job_id = $1 ORDER BY created_at ASC", 
            [jobId]
        );
        console.log(`📋 Found ${logsRes.rowCount} events:`);
        logsRes.rows.forEach(log => {
            console.log(`  - ${log.event_type} at ${log.created_at}`);
        });

    } catch (e) {
        console.error("❌ Error:", e.message);
    } finally {
        process.exit(0);
    }
}

const jobId = process.argv[2];
if (!jobId) {
    console.error("Please provide a jobId");
    process.exit(1);
}
checkTimeline(jobId);
