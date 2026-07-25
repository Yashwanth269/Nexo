const db = require('../config/db');
const crypto = require('crypto');

class MLDataLogger {
    constructor() {
        this.predictionQueue = [];
        this.traceQueue = [];
        this.flushInterval = setInterval(() => this.flushQueues(), 3000);
    }

    async logPrediction(modelType, entityId, features, prediction, confidence = null, meta = {}) {
        const predictionId = crypto.randomUUID();
        const payload = {
            predictionId,
            modelType,
            entityId,
            features: JSON.stringify(features),
            prediction,
            confidence,
            featureStoreVersion: meta.featureStoreVersion || '1.0.0',
            featureSchemaVersion: meta.featureSchemaVersion || '1.0.0',
            modelVersion: meta.modelVersion || '1.0.0',
            weather: meta.weather || null,
            holidayFlag: meta.holidayFlag || false,
            dispatchPolicyVersion: meta.dispatchPolicyVersion || '1.0.0',
            loggedAt: new Date()
        };

        this.predictionQueue.push(payload);
        if (this.predictionQueue.length >= 20) {
            this.flushQueues();
        }
        return predictionId;
    }

    async recordOutcome(modelType, entityId, actualOutcome, outcomeLabel = null) {
        try {
            await db.query(`
                UPDATE ml_training_data
                SET actual_outcome = $1, outcome_label = $2, outcome_recorded_at = NOW()
                WHERE model_type = $3 AND entity_id = $4 AND actual_outcome IS NULL
            `, [actualOutcome, outcomeLabel, modelType, entityId]);
        } catch (e) {
            console.warn(`[ML-DATA-LOG] Failed to record ${modelType} outcome:`, e.message);
        }
    }

    async recordOutcomeByPredictionId(predictionId, actualOutcome, outcomeLabel = null) {
        try {
            await db.query(`
                UPDATE ml_training_data
                SET actual_outcome = $1, outcome_label = $2, outcome_recorded_at = NOW()
                WHERE prediction_id = $3
            `, [actualOutcome, outcomeLabel, predictionId]);
        } catch (e) {
            console.warn(`[ML-DATA-LOG] Failed to record prediction ${predictionId} outcome:`, e.message);
        }
    }

    async logGpsTrace(workerId, jobId, lat, lng, speedKmh, accuracy, mockLocation, signalStrength, heading) {
        // Validate Coordinates & Speed before storage (Point 3)
        const latVal = parseFloat(lat);
        const lngVal = parseFloat(lng);
        const speedVal = parseFloat(speedKmh);

        if (isNaN(latVal) || latVal < -90 || latVal > 90) return;
        if (isNaN(lngVal) || lngVal < -180 || lngVal > 180) return;
        if (isNaN(speedVal) || speedVal < 0 || speedVal > 200) return; // ignore impossible speed

        const payload = {
            workerId,
            jobId,
            lat: latVal,
            lng: lngVal,
            speedKmh: speedVal,
            accuracy: accuracy || 5,
            mockLocation: !!mockLocation,
            signalStrength: signalStrength || 'good',
            heading: heading || 0,
            recordedAt: new Date()
        };

        this.traceQueue.push(payload);
        if (this.traceQueue.length >= 50) {
            this.flushQueues();
        }
    }

    async logPriceTest(jobId, basePrice, offeredPrice, multiplier, testGroup, workerId = null) {
        try {
            await db.query(`
                INSERT INTO price_elasticity_tests (job_id, base_price, offered_price, multiplier, test_group, worker_id, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [jobId, basePrice, offeredPrice, multiplier, testGroup, workerId]);
        } catch (e) {
            console.warn('[PRICE-TEST] Failed to log:', e.message);
        }
    }

    async recordPriceTestOutcome(jobId, wasAccepted, workerId = null) {
        try {
            await db.query(`
                UPDATE price_elasticity_tests
                SET was_accepted = $1, worker_id = COALESCE($2, worker_id), responded_at = NOW()
                WHERE job_id = $3 AND responded_at IS NULL
            `, [wasAccepted, workerId, jobId]);
        } catch (e) {
            console.warn('[PRICE-TEST] Failed to record outcome:', e.message);
        }
    }

    async flushQueues() {
        if (this.predictionQueue.length > 0) {
            const batch = [...this.predictionQueue];
            this.predictionQueue = [];
            
            try {
                // Batch insert using single database query transaction
                const client = await db.pool.connect();
                try {
                    await client.query('BEGIN');
                    for (const item of batch) {
                        await client.query(`
                            INSERT INTO ml_training_data (
                                prediction_id, model_type, entity_id, features, prediction, confidence,
                                feature_store_version, feature_schema_version, model_version, weather, holiday_flag, dispatch_policy_version, logged_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                            ON CONFLICT (prediction_id) DO NOTHING
                        `, [
                            item.predictionId, item.modelType, item.entityId, item.features, item.prediction, item.confidence,
                            item.featureStoreVersion, item.featureSchemaVersion, item.modelVersion, item.weather, item.holidayFlag, item.dispatchPolicyVersion, item.loggedAt
                        ]);
                    }
                    await client.query('COMMIT');
                } catch (txErr) {
                    await client.query('ROLLBACK');
                    throw txErr;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.warn('[ML-DATA-LOG-FLUSH-ERR] Failed to flush predictions:', err.message);
            }
        }

        if (this.traceQueue.length > 0) {
            const batch = [...this.traceQueue];
            this.traceQueue = [];

            try {
                const client = await db.pool.connect();
                try {
                    await client.query('BEGIN');
                    for (const item of batch) {
                        await client.query(`
                            INSERT INTO gps_traces (worker_id, job_id, lat, lng, speed_kmh, accuracy_m, mock_location, signal_strength, heading, recorded_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        `, [
                            item.workerId, item.jobId, item.lat, item.lng, item.speedKmh, item.accuracy, item.mockLocation, item.signalStrength, item.heading, item.recordedAt
                        ]);
                    }
                    await client.query('COMMIT');
                } catch (txErr) {
                    await client.query('ROLLBACK');
                    throw txErr;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.warn('[ML-DATA-LOG-FLUSH-ERR] Failed to flush GPS traces:', err.message);
            }
        }
    }
}

module.exports = new MLDataLogger();
