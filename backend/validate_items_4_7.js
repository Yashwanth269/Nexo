const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres', host: 'localhost', database: 'gigs_db',
    password: 'Yashwanth@123', port: 5432
});
const http = require('http');

function apiPost(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const opts = {
            hostname: 'localhost', port: 5000, path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 10000
        };
        const req = http.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
                catch(e) { resolve({ status: res.statusCode, data: d }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function apiGet(path) {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:5000' + path, { timeout: 10000 }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
                catch(e) { resolve({ status: res.statusCode, data: d }); }
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log('========================================');
    console.log('  VALIDATION AUDIT - Items 4-7');
    console.log('========================================\n');

    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    const userId = userRes.rows[0].id;
    const jobId = 'a0000000-0000-0000-0000-000000000000';

    // Insert temporary open job
    await pool.query(
        "INSERT INTO jobs (id, user_id, category, description, location_lat, location_lng, price, status) VALUES ($1, $2, 'Electrician', 'Short circuit', 12.9, 77.5, 500, 'OPEN') ON CONFLICT (id) DO NOTHING",
        [jobId, userId]
    );

    const workers = (await pool.query('SELECT id, full_name, jobs_completed FROM workers')).rows;
    const openJobs = (await pool.query("SELECT id, category FROM jobs WHERE status = 'OPEN'")).rows;

    // ═══════════ ITEM 4: CONTEXTUAL BANDIT ═══════════
    console.log('--- ITEM 4: Contextual Bandit Validation ---');
    const rankingService = require('./services/ranking.service');
    const mockJob = { id: openJobs[0]?.id || '00000000-0000-0000-0000-000000000000', category: 'Electrician' };
    const mockWorkers = workers.map(w => ({
        id: w.id,
        jobs_completed: parseInt(w.jobs_completed) || 0,
        score: Math.random() * 0.5 + 0.5
    }));

    const selectedWorkers = {};
    for (let i = 0; i < 100; i++) {
        const selected = await rankingService.contextualBanditSelect(mockWorkers, mockJob);
        if (!selectedWorkers[selected.id]) selectedWorkers[selected.id] = 0;
        selectedWorkers[selected.id]++;
    }

    const logEntries = await pool.query('SELECT * FROM exploration_log');
    console.log('Exploration log entries:', logEntries.rowCount);
    const expCount = logEntries.rows.filter(r => r.was_exploration).length;
    console.log('  Exploration:', expCount, '| Exploitation:', logEntries.rows.length - expCount);

    const newWorkerExposures = Object.entries(selectedWorkers).filter(([wid]) => {
        const w = workers.find(w2 => w2.id === wid);
        return (parseInt(w?.jobs_completed) || 0) < 5;
    });
    console.log('  New workers exposed:', newWorkerExposures.length, 'of', workers.filter(w => (parseInt(w.jobs_completed)||0) < 5).length);

    // ═══════════ ITEM 5: FEEDBACK PIPELINE ═══════════
    console.log('\n--- ITEM 5: Feedback Pipeline Validation ---');
    const feedbackService = require('./services/feedback.service');
    const sampleWorker = workers[0];
    const sampleJob = openJobs[0];

    const events = ['click', 'view', 'accept', 'complete', 'rate', 'reject', 'cancel', 'timeout'];
    for (const evt of events) {
        await feedbackService.recordEvent(userId, sampleWorker.id, sampleJob.id, evt, {
            value: evt === 'rate' ? 4.5 : 1,
            sessionId: 'test-session-001',
            rating: evt === 'rate' ? 4.5 : null
        });
    }
    console.log('  Recorded 8 event types');

    const clicks = await pool.query("SELECT action_type, COUNT(*) as cnt FROM ranking_clicks GROUP BY action_type ORDER BY action_type");
    console.log('ranking_clicks distribution:');
    clicks.rows.forEach(r => console.log('  ' + r.action_type + ': ' + r.cnt));

    const summary = await feedbackService.getWorkerFeedbackSummary(sampleWorker.id);
    console.log('Feedback summary entries:', summary.length);

    // ═══════════ ITEM 6: RETRAINING PIPELINE ═══════════
    console.log('\n--- ITEM 6: Retraining Pipeline Validation ---');

    // Call ML /train endpoint (directly via HTTP to ML service port 8000)
    function mlTrain() {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({ force_full_retrain: true, model_name: 'acceptance_model' });
            const opts = {
                hostname: 'localhost', port: 8000, path: '/train',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                timeout: 30000
            };
            const req = http.request(opts, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    try {
        const trainResult = await mlTrain();
        console.log('ML /train response:', JSON.stringify(trainResult).slice(0, 400));
    } catch (e) {
        console.log('ML /train error:', e.message);
    }

    const registry = await pool.query('SELECT model_version, model_type, training_rows_count, is_production, evaluation_metrics FROM model_registry');
    console.log('model_registry entries:', registry.rowCount);
    registry.rows.forEach(r => console.log('  v' + r.model_version + ' | ' + r.model_type + ' | rows: ' + r.training_rows_count + ' | prod: ' + r.is_production));

    const metricsTable = await pool.query('SELECT model_version, metric_name, metric_value FROM model_metrics LIMIT 10');
    console.log('model_metrics entries:', metricsTable.rowCount);

    // Test model list
    function mlGet(path) {
        return new Promise((resolve, reject) => {
            http.get('http://localhost:8000' + path, { timeout: 5000 }, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); }
                });
            }).on('error', reject);
        });
    }

    const modelsList = await mlGet('/models');
    console.log('ML /models versions:', modelsList.versions?.length || 0);

    // ═══════════ ITEM 7: FATIGUE ENGINE ═══════════
    console.log('\n--- ITEM 7: Fatigue Engine Validation ---');
    const workerService = require('./services/worker.service');

    const beforeWF = await pool.query('SELECT worker_id, fatigue_24h, fatigue_7d, fatigue_30d FROM worker_features');
    console.log('Initial fatigue (sample):', JSON.stringify(beforeWF.rows[0]));

    const testWorker = workers[0];
    const redis = require('./config/redis');
    await redis.incr('worker:' + testWorker.id + ':rejections');
    await redis.incr('worker:' + testWorker.id + ':rejections');
    await redis.incr('worker:' + testWorker.id + ':ignored');
    await redis.incr('worker:' + testWorker.id + ':timeouts');
    console.log('  Set Redis counters');

    await workerService.updateFatigueScore(testWorker.id, 'JOB_REJECTED');
    await workerService.updateFatigueScore(testWorker.id, 'JOB_TIMEOUT');
    console.log('  Called updateFatigueScore');

    const fatigueScore = await rankingService.calculateFatigueScore(testWorker.id);
    console.log('  Fatigue:', JSON.stringify(fatigueScore));

    const afterWF = await pool.query('SELECT fatigue_24h, fatigue_7d, fatigue_30d FROM worker_features WHERE worker_id = $1', [testWorker.id]);
    console.log('  worker_features after:', JSON.stringify(afterWF.rows[0]));

    await workerService.updateLastJobEventAt(testWorker.id);
    const updatedAt = await pool.query('SELECT last_job_event_at FROM worker_features WHERE worker_id = $1', [testWorker.id]);
    console.log('  last_job_event_at:', updatedAt.rows[0].last_job_event_at);

    // ═══════════ SUMMARY ═══════════
    console.log('\n========================================');
    console.log('  VALIDATION SUMMARY');
    console.log('========================================');
    console.log('Item 4 (Bandit): ' + (logEntries.rowCount > 0 ? 'PASS' : 'FAIL') + ' - ' + logEntries.rowCount + ' log entries');
    const totalClicks = clicks.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
    console.log('Item 5 (Feedback): ' + (totalClicks > 0 ? 'PASS' : 'FAIL') + ' - ' + totalClicks + ' total events');
    console.log('Item 6 (Training): ' + (registry.rowCount > 0 ? 'PASS' : 'FAIL') + ' - ' + registry.rowCount + ' model(s)');
    console.log('Item 7 (Fatigue): ' + (fatigueScore.composite > 0 ? 'PASS' : 'FAIL') + ' - composite=' + fatigueScore.composite.toFixed(4));

    await pool.query("DELETE FROM ranking_clicks WHERE job_id = $1", [jobId]).catch(() => {});
    await pool.query("DELETE FROM exploration_log WHERE job_id = $1", [jobId]).catch(() => {});
    await pool.query("DELETE FROM jobs WHERE id = $1", [jobId]).catch(() => {});

    await pool.end();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
