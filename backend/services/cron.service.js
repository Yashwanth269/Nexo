const cron = require('node-cron');
const db = require('../config/db');
const http = require('http');
const https = require('https');
const paymentService = require('./payment.service');
const disputeService = require('./dispute.service');
const metrics = require('../middleware/metrics');
const paymentTrustService = require('./payment-trust.service');

class CronService {
    start() {
        const dbValidator = require('./db_validator.service');
        if (!dbValidator.isValid) {
            console.error('⏰ [CRON-ABORT] Database schema validation is currently failing/invalid. Skipping cron scheduling.');
            return;
        }
        // Run every 5 minutes: auto-confirm cash payments older than 24h
        cron.schedule('*/5 * * * *', async () => {
            await this._autoConfirmCashPayments();
        });

        // Run every 15 minutes: check SLA breaches on open disputes
        cron.schedule('*/15 * * * *', async () => {
            await this._checkDisputeSlaBreaches();
        });

        // Run every hour: update Prometheus metrics for cash confirmations and disputes
        cron.schedule('0 * * * *', async () => {
            await this._updateMetrics();
        });

        // Run daily at 2:00 AM: automated ML retraining
        cron.schedule('0 2 * * *', async () => {
            await this._autoRetrainML('acceptance_model');
            await this._autoRetrainML('dispute_model');
        });

        // Run every 6 hours: check if enough new data for incremental training
        cron.schedule('0 */6 * * *', async () => {
            await this._checkAndRetrainIncremental('acceptance_model');
        });

        // Run weekly for anomaly detection models (GPS, Fraud)
        cron.schedule('0 3 * * 0', async () => {
            await this._retrainAnomalyModels();
        });

        // Run dispute model retrain check every 12 hours
        cron.schedule('0 */12 * * *', async () => {
            await this._checkAndRetrainIncremental('dispute_model');
        });

        // Run backup pool cleanup every hour
        cron.schedule('0 * * * *', async () => {
            await this._cleanupBackupPools();
        });

        // ─── Phase 14: Advanced Fatigue every 15 minutes ───────────────
        cron.schedule('*/15 * * * *', async () => {
            await this._calculateFatigueScores();
        });

        // ─── Phase 15: Weekly skill confidence recalculation (Sunday 4 AM) ─
        cron.schedule('0 4 * * 0', async () => {
            await this._autoRetrainML('skill_confidence_model');
        });

        // ─── Phase 17: Hourly availability forecasts ───────────────────
        cron.schedule('0 * * * *', async () => {
            await this._autoRetrainML('availability_model');
        });

        // ─── Phase 18: Hourly demand forecasts ─────────────────────────
        cron.schedule('15 * * * *', async () => {
            await this._autoRetrainML('demand_forecast_model');
        });

        // ─── Phase 28: Weekly gamification evaluation (Monday 5 AM) ────
        cron.schedule('0 5 * * 1', async () => {
            await this._evaluateGamification();
        });

        // ─── Phase 29: Hourly heatmap snapshots ────────────────────────
        cron.schedule('30 * * * *', async () => {
            await this._captureHeatmapSnapshot();
        });

        // ─── Phase 30: Daily service recommendation training (3 AM) ────
        cron.schedule('0 3 * * *', async () => {
            await this._autoRetrainML('recommendation_model');
        });

        // ─── Phase 31: Weekly model maturity evaluation (Saturday 4 AM) ─
        cron.schedule('0 4 * * 6', async () => {
            await this._evaluateModelMaturity();
        });

        // ─── Phase 11: Daily reliability scoring (2:30 AM) ────────────
        cron.schedule('30 2 * * *', async () => {
            await this._autoRetrainML('reliability_model');
        });

        // ─── Phase 12: Daily no-show retraining (3:30 AM) ─────────────
        cron.schedule('30 3 * * *', async () => {
            await this._autoRetrainML('no_show_model');
        });

        console.log('⏰ [CRON] Scheduled tasks registered (auto-confirm, SLA breaches, metrics, ML retraining, fraud, dispute, fatigue, gamification, maturity, heatmap, availability, demand, recommendation)');
    }

    async _autoConfirmCashPayments() {
        try {
            const pending = await paymentService.getPendingCashConfirmations();
            let autoConfirmed = 0;

            for (const confirmation of pending) {
                const hoursSinceMarked = (Date.now() - new Date(confirmation.worker_marked_at).getTime()) / (1000 * 60 * 60);
                if (hoursSinceMarked >= 24) {
                    const result = await paymentService.autoConfirmCash(confirmation.payment_id);
                    if (result.success) autoConfirmed++;
                }
            }

            if (autoConfirmed > 0) {
                console.log(`⏰ [CRON] Auto-confirmed ${autoConfirmed} cash payment(s) (24h elapsed)`);
            }
        } catch (e) {
            console.error('⏰ [CRON] Auto-confirm cash error:', e.message);
        }
    }

    async _checkDisputeSlaBreaches() {
        try {
            const breached = await disputeService.checkSlaBreaches();
            if (breached.length > 0) {
                for (const dispute of breached) {
                    metrics.disputeSlaBreachedTotal.inc();
                }
                console.log(`⏰ [CRON] Escalated ${breached.length} dispute(s) due to SLA breach (48h elapsed)`);
            }
        } catch (e) {
            console.error('⏰ [CRON] SLA breach check error:', e.message);
        }
    }

    async _autoRetrainML(modelName = 'acceptance_model') {
        try {
            const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';

            const schedRes = await db.query(
                `SELECT * FROM training_schedule WHERE model_name = $1`,
                [modelName]
            );

            let schedule;
            if (schedRes.rowCount === 0) {
                await db.query(
                    `INSERT INTO training_schedule (model_name) VALUES ($1) ON CONFLICT (model_name) DO NOTHING`,
                    [modelName]
                );
                schedule = null;
            } else {
                schedule = schedRes.rows[0];
            }

            let dataCount, endpoint, minSamples;
            if (modelName === 'acceptance_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM job_offers WHERE status IN ('ACCEPTED', 'REJECTED') AND created_at > NOW() - INTERVAL '90 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 20;
                endpoint = '/train';
            } else if (modelName === 'dispute_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM disputes WHERE created_at > NOW() - INTERVAL '180 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 5;
                endpoint = '/train/dispute';
            } else if (modelName === 'reliability_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM jobs WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at > NOW() - INTERVAL '180 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 50;
                endpoint = '/train/reliability';
            } else if (modelName === 'no_show_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM jobs WHERE status = 'CANCELLED' AND cancellation_reason LIKE '%no_show%' AND created_at > NOW() - INTERVAL '180 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 10;
                endpoint = '/train/no-show';
            } else if (modelName === 'fatigue_model') {
                dataCount = 100;
                minSamples = 10;
                endpoint = '/train/fatigue';
            } else if (modelName === 'skill_confidence_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM ratings WHERE rating_type = 'USER_TO_WORKER' AND created_at > NOW() - INTERVAL '180 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 50;
                endpoint = '/train/skill-confidence';
            } else if (modelName === 'availability_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM event_logs WHERE event_type = 'worker_online' AND created_at > NOW() - INTERVAL '90 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 50;
                endpoint = '/train/availability';
            } else if (modelName === 'demand_forecast_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM jobs WHERE created_at > NOW() - INTERVAL '90 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 100;
                endpoint = '/train/demand-forecast';
            } else if (modelName === 'recommendation_model') {
                const dataCountRes = await db.query(
                    `SELECT COUNT(*) as count FROM job_offers WHERE created_at > NOW() - INTERVAL '180 days'`
                );
                dataCount = parseInt(dataCountRes.rows[0].count);
                minSamples = 100;
                endpoint = '/train/recommendation';
            } else {
                return;
            }

            if (dataCount < minSamples) {
                console.log(`⏰ [CRON] ${modelName} retraining skipped: only ${dataCount} samples (< ${minSamples} minimum)`);
                return;
            }

            const newDataSince = schedule?.last_trained_at
                ? await db.query(
                    modelName === 'acceptance_model'
                        ? `SELECT COUNT(*) as count FROM job_offers WHERE status IN ('ACCEPTED', 'REJECTED') AND created_at > $1`
                        : `SELECT COUNT(*) as count FROM disputes WHERE created_at > $1`,
                    [schedule.last_trained_at]
                  )
                : { rows: [{ count: dataCount }] };
            const newCount = parseInt(newDataSince.rows[0].count);

            const forceFull = !schedule?.last_trained_at || newCount > dataCount * 0.5;

            await db.query(
                `UPDATE training_schedule SET status = 'training', updated_at = NOW() WHERE model_name = $1`,
                [modelName]
            );

            const body = JSON.stringify({
                force_full_retrain: forceFull,
                model_name: modelName,
            });

            const result = await new Promise((resolve, reject) => {
                const urlObj = new URL(`${mlUrl}${endpoint}`);
                const transport = urlObj.protocol === 'https:' ? https : http;
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                    timeout: 300000,
                };
                const req = transport.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve({ success: false, error: data }); }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
                req.write(body);
                req.end();
            });

            if (result?.success) {
                const auc = result.metrics?.auc || result.metrics?.best?.auc || 0;
                await db.query(
                    `UPDATE training_schedule
                     SET last_trained_at = NOW(), last_data_count = $1, total_training_runs = total_training_runs + 1,
                         last_auc = $2, best_auc = GREATEST(best_auc, $2), status = 'success', error_message = NULL,
                         updated_at = NOW()
                     WHERE model_name = $3`,
                    [dataCount, auc, modelName]
                );
                console.log(`⏰ [CRON] ${modelName} retraining complete. AUC: ${auc}, samples: ${dataCount}, version: ${result.model_version}`);
            } else {
                throw new Error(result?.error || 'Training returned failure');
            }
        } catch (e) {
            await db.query(
                `UPDATE training_schedule SET status = 'failed', error_message = $1, updated_at = NOW() WHERE model_name = $2`,
                [e.message, modelName]
            );
            console.error(`⏰ [CRON] ${modelName} retraining error:`, e.message);
        }
    }

    async _checkAndRetrainIncremental(modelName = 'acceptance_model') {
        try {
            const schedRes = await db.query(
                `SELECT * FROM training_schedule WHERE model_name = $1`,
                [modelName]
            );
            const schedule = schedRes.rows[0];

            if (!schedule?.last_trained_at) {
                await this._autoRetrainML(modelName);
                return;
            }

            const queryMap = {
                'acceptance_model': `SELECT COUNT(*) as count FROM job_offers WHERE status IN ('ACCEPTED', 'REJECTED') AND created_at > $1`,
                'dispute_model': `SELECT COUNT(*) as count FROM disputes WHERE created_at > $1`,
                'reliability_model': `SELECT COUNT(*) as count FROM jobs WHERE status IN ('COMPLETED', 'CANCELLED') AND created_at > $1`,
                'no_show_model': `SELECT COUNT(*) as count FROM jobs WHERE status = 'CANCELLED' AND cancellation_reason LIKE '%no_show%' AND created_at > $1`,
                'skill_confidence_model': `SELECT COUNT(*) as count FROM ratings WHERE rating_type = 'USER_TO_WORKER' AND created_at > $1`,
                'availability_model': `SELECT COUNT(*) as count FROM event_logs WHERE event_type = 'worker_online' AND created_at > $1`,
                'demand_forecast_model': `SELECT COUNT(*) as count FROM jobs WHERE created_at > $1`,
                'recommendation_model': `SELECT COUNT(*) as count FROM job_offers WHERE created_at > $1`,
            };
            const query = queryMap[modelName] || queryMap['acceptance_model'];
            const newDataRes = await db.query(query, [schedule.last_trained_at]);
            const newCount = parseInt(newDataRes.rows[0].count);

            const thresholdMap = {
                'dispute_model': 3,
                'no_show_model': 3,
            };
            const threshold = thresholdMap[modelName] !== undefined ? thresholdMap[modelName] : 10;
            if (newCount >= threshold) {
                console.log(`⏰ [CRON] ${newCount} new training samples found for ${modelName}. Triggering incremental retrain.`);
                await this._autoRetrainML(modelName);
            }
        } catch (e) {
            console.error(`⏰ [CRON] Incremental retrain check error for ${modelName}:`, e.message);
        }
    }

    async _retrainAnomalyModels() {
        const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';
        const models = ['/train/gps', '/train/fraud'];
        for (const endpoint of models) {
            try {
                const body = JSON.stringify({ force_full_retrain: true });
                const result = await new Promise((resolve, reject) => {
                    const urlObj = new URL(`${mlUrl}${endpoint}`);
                    const transport = urlObj.protocol === 'https:' ? https : http;
                    const options = {
                        hostname: urlObj.hostname,
                        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                        path: urlObj.pathname,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                        timeout: 120000,
                    };
                    const req = transport.request(options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => data += chunk);
                        res.on('end', () => {
                            try { resolve(JSON.parse(data)); }
                            catch { resolve({ success: false, error: data }); }
                        });
                    });
                    req.on('error', reject);
                    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
                    req.write(body);
                    req.end();
                });
                if (result?.success) {
                    console.log(`⏰ [CRON] ${endpoint} retraining complete. Version: ${result.version}`);
                }
            } catch (e) {
                console.error(`⏰ [CRON] ${endpoint} retraining error:`, e.message);
            }
        }
    }

    async _calculateFatigueScores() {
        try {
            const fatigueService = require('./fatigue.service');
            const activeWorkers = await db.query(
                "SELECT id FROM workers WHERE is_online = true AND is_available = true"
            );
            for (const worker of activeWorkers.rows) {
                await fatigueService.calculateAdvancedFatigue(worker.id);
            }
            console.log(`⏰ [CRON] Fatigue scores calculated for ${activeWorkers.rowCount} workers`);
        } catch (e) {
            console.error('⏰ [CRON] Fatigue calculation error:', e.message);
        }
    }

    async _evaluateGamification() {
        try {
            const gamificationService = require('./gamification.service');
            const activeWorkers = await db.query(
                "SELECT id FROM workers WHERE is_online = true AND jobs_completed > 0"
            );
            let evaluated = 0;
            for (const worker of activeWorkers.rows) {
                await gamificationService.evaluateWorker(worker.id);
                evaluated++;
            }
            console.log(`⏰ [CRON] Gamification evaluated for ${evaluated} workers`);
        } catch (e) {
            console.error('⏰ [CRON] Gamification evaluation error:', e.message);
        }
    }

    async _captureHeatmapSnapshot() {
        try {
            const snapshot = {
                active_workers: 0,
                open_jobs: 0,
                timestamp: new Date(),
            };
            const activeRes = await db.query("SELECT COUNT(*) as count FROM workers WHERE is_online = true AND is_available = true");
            snapshot.active_workers = parseInt(activeRes.rows[0].count);
            const jobsRes = await db.query("SELECT COUNT(*) as count FROM jobs WHERE status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING')");
            snapshot.open_jobs = parseInt(jobsRes.rows[0].count);
            await db.query(`
                INSERT INTO heatmap_snapshots (snapshot_data, captured_at)
                VALUES ($1, NOW())
            `, [JSON.stringify(snapshot)]);
            console.log(`⏰ [CRON] Heatmap snapshot captured: ${snapshot.active_workers} workers, ${snapshot.open_jobs} jobs`);
        } catch (e) {
            console.error('⏰ [CRON] Heatmap snapshot error:', e.message);
        }
    }

    async _evaluateModelMaturity() {
        try {
            const modelMaturityService = require('./model_maturity.service');
            const modelTypes = ['acceptance_model', 'dispute_model', 'no_show_model', 'reliability_model',
                'fatigue_model', 'skill_confidence_model', 'availability_model', 'demand_forecast_model',
                'recommendation_model'];
            for (const modelName of modelTypes) {
                const result = await modelMaturityService.evaluateModel(modelName);
                if (result.isProductionReady) {
                    console.log(`⏰ [CRON] ${modelName} is production ready! F1=${result.f1}`);
                }
            }
            console.log(`⏰ [CRON] Model maturity evaluated for ${modelTypes.length} models`);
        } catch (e) {
            console.error('⏰ [CRON] Model maturity evaluation error:', e.message);
        }
    }

    async _cleanupBackupPools() {
        try {
            const backupWorkerService = require('./backup_worker.service');
            const stalePools = await db.query(`
                SELECT job_id FROM backup_worker_pool
                WHERE status = 'RESERVED'
                AND created_at < NOW() - INTERVAL '24 hours'
            `);
            let cleaned = 0;
            for (const pool of stalePools.rows) {
                await backupWorkerService.releaseBackup(pool.job_id);
                cleaned++;
            }
            if (cleaned > 0) {
                console.log(`⏰ [CRON] Cleaned ${cleaned} stale backup worker pools`);
            }
            const activePools = await db.query(`
                SELECT COUNT(DISTINCT job_id) as count FROM backup_worker_pool WHERE status = 'RESERVED'
            `);
            metrics.backupPoolActive.set(parseInt(activePools.rows[0].count));
        } catch (e) {
            console.error('⏰ [CRON] Backup pool cleanup error:', e.message);
        }
    }

    async _updateMetrics() {
        try {
            const pendingCountRes = await db.query(
                `SELECT COUNT(*) as count FROM cash_confirmations WHERE status = 'PENDING'`
            );
            metrics.setCashConfirmationsPending(parseInt(pendingCountRes.rows[0].count));

            const openDisputesRes = await db.query(
                `SELECT COUNT(*) as count FROM disputes WHERE status = 'OPEN'`
            );
            metrics.setDisputeOpenCount(parseInt(openDisputesRes.rows[0].count));

            const workerTrustAvg = await paymentTrustService.getAverageScore('WORKER');
            metrics.setTrustScoreAvg('WORKER', workerTrustAvg);

            const userTrustAvg = await paymentTrustService.getAverageScore('USER');
            metrics.setTrustScoreAvg('USER', userTrustAvg);
        } catch (e) {
            console.error('⏰ [CRON] Metrics update error:', e.message);
        }
    }

}

module.exports = new CronService();
