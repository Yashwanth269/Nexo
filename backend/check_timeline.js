const db = require('./config/db');

async function checkTimeline(jobId) {
    try {
        console.log(`\n🔍 Checking timeline for Job: ${jobId}`);
        
        // 1. Check Job Status
        const jobRes = await db.query(
            "SELECT status, user_id, worker_id, category, price, created_at, completed_at FROM jobs WHERE id = $1", 
            [jobId]
        );
        if (jobRes.rowCount === 0) {
            console.error("❌ Job not found");
            return;
        }
        const job = jobRes.rows[0];
        console.log(`📄 Job Category: ${job.category} | Current Status: ${job.status} | Price: ₹${job.price}`);

        // 2. Fetch Event Logs
        const logsRes = await db.query(
            "SELECT event_type, created_at FROM event_logs WHERE job_id = $1 ORDER BY created_at ASC", 
            [jobId]
        );
        const logs = logsRes.rows;

        // 3. Fetch Payments & Settlements
        const payRes = await db.query("SELECT id, payment_status, payment_mode FROM payments WHERE job_id = $1", [jobId]);
        let hasSettlement = false;
        if (payRes.rowCount > 0) {
            const paymentId = payRes.rows[0].id;
            const setRes = await db.query(
                "SELECT COUNT(*) as count FROM settlement_ledger WHERE reference_id = $1 OR reference_id = $2",
                [paymentId, jobId]
            );
            hasSettlement = parseInt(setRes.rows[0].count) > 0;
        }

        // 4. Construct execution stages
        const stages = [
            { key: 'JOB_CREATED', label: 'JOB_CREATED', eventTypes: ['JOB_CREATED', 'JOB_POSTED'] },
            { key: 'MATCHING_STARTED', label: 'MATCHING_STARTED', eventTypes: ['MATCHING_STARTED', 'MATCHING_RUN', 'DISPATCH_CYCLE_START'] },
            { key: 'WORKER_NOTIFIED', label: 'WORKER_NOTIFIED', eventTypes: ['WORKER_NOTIFIED', 'OFFER_CREATED'] },
            { key: 'WORKER_ACCEPTED', label: 'WORKER_ACCEPTED', eventTypes: ['WORKER_ACCEPTED', 'OFFER_ACCEPTED'] },
            { key: 'ON_THE_WAY', label: 'ON_THE_WAY', eventTypes: ['ON_THE_WAY', 'WORKER_TRAVEL_START'] },
            { key: 'ARRIVED', label: 'ARRIVED', eventTypes: ['ARRIVED', 'WORKER_ARRIVED'] },
            { key: 'COMPLETED', label: 'COMPLETED', eventTypes: ['COMPLETED', 'JOB_COMPLETED'] },
            { key: 'PAYMENT', label: 'PAYMENT', eventTypes: ['PAYMENT_SUCCESS', 'PAYMENT_COMPLETED', 'PAYMENT_RECEIVED'] },
            { key: 'SETTLEMENT', label: 'SETTLEMENT', eventTypes: ['SETTLEMENT_RECORDED', 'SETTLEMENT_COMPLETED'] }
        ];

        console.log(`\n📋 Operational debug execution timeline for Job ${jobId}:`);
        console.log("=".repeat(80));

        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];
            let isDone = false;
            let timestamp = null;

            // Find matching event from logs
            const matchedLog = logs.find(l => stage.eventTypes.includes(l.event_type.toUpperCase()));
            if (matchedLog) {
                isDone = true;
                timestamp = new Date(matchedLog.created_at).toLocaleString();
            }

            // Fallback status mappings directly from tables
            if (!isDone) {
                if (stage.key === 'JOB_CREATED' && job.created_at) {
                    isDone = true;
                    timestamp = new Date(job.created_at).toLocaleString();
                } else if (stage.key === 'WORKER_ACCEPTED' && ['ACCEPTED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'].includes(job.status)) {
                    isDone = true;
                } else if (stage.key === 'ON_THE_WAY' && ['ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'].includes(job.status)) {
                    isDone = true;
                } else if (stage.key === 'ARRIVED' && ['ARRIVED', 'IN_PROGRESS', 'COMPLETED'].includes(job.status)) {
                    isDone = true;
                } else if (stage.key === 'COMPLETED' && (job.status === 'COMPLETED' || job.completed_at)) {
                    isDone = true;
                    timestamp = job.completed_at ? new Date(job.completed_at).toLocaleString() : null;
                } else if (stage.key === 'PAYMENT' && payRes.rowCount > 0 && payRes.rows[0].payment_status === 'CONFIRMED') {
                    isDone = true;
                } else if (stage.key === 'SETTLEMENT' && hasSettlement) {
                    isDone = true;
                }
            }

            const checkbox = isDone ? "[✔]" : "[ ]";
            const timeStr = timestamp ? `(Completed at ${timestamp})` : isDone ? "(Completed)" : "(Pending)";
            console.log(`  ${checkbox} ${stage.label.padEnd(20)} --------------------- ${timeStr}`);

            // Print arrow connectors
            if (i < stages.length - 1) {
                console.log("         ↓");
            }
        }
        console.log("=".repeat(80));

    } catch (e) {
        console.error("❌ Timeline check error:", e.message);
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
