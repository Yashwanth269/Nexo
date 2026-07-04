const db = require('../config/db');

class MLDataLogger {
    async logPrediction(modelType, entityId, features, prediction, confidence = null) {
        try {
            await db.query(`
                INSERT INTO ml_training_data (model_type, entity_id, features, prediction, confidence, logged_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
            `, [modelType, entityId, JSON.stringify(features), prediction, confidence]);
        } catch (e) {
            console.warn(`[ML-DATA-LOG] Failed to log ${modelType} prediction:`, e.message);
        }
    }

    async recordOutcome(modelType, entityId, actualOutcome, outcomeLabel = null) {
        try {
            await db.query(`
                UPDATE ml_training_data
                SET actual_outcome = $1, outcome_label = $2, outcome_recorded_at = NOW()
                WHERE model_type = $3 AND entity_id = $4 AND actual_outcome IS NULL
                ORDER BY logged_at DESC LIMIT 1
            `, [actualOutcome, outcomeLabel, modelType, entityId]);
        } catch (e) {
            console.warn(`[ML-DATA-LOG] Failed to record ${modelType} outcome:`, e.message);
        }
    }

    async logGpsTrace(workerId, jobId, lat, lng, speedKmh, accuracy, mockLocation, signalStrength, heading) {
        try {
            await db.query(`
                INSERT INTO gps_traces (worker_id, job_id, lat, lng, speed_kmh, accuracy_m, mock_location, signal_strength, heading, recorded_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            `, [workerId, jobId, lat, lng, speedKmh, accuracy, mockLocation, signalStrength, heading]);
        } catch (e) {
            // Non-critical
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
}

module.exports = new MLDataLogger();
