const db = require('../config/db');

class ModelMaturityService {
    async recordPrediction(modelName, entityId, features, prediction, confidence = null) {
        try {
            await db.query(`
                INSERT INTO ml_training_data (model_type, entity_id, features, prediction, confidence, logged_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
            `, [modelName, entityId, JSON.stringify(features), prediction, confidence]);
        } catch (e) {
            // Non-critical
        }
    }

    async recordOutcome(modelName, entityId, actualOutcome, outcomeLabel = null) {
        try {
            await db.query(`
                UPDATE ml_training_data
                SET actual_outcome = $1, outcome_label = $2, outcome_recorded_at = NOW()
                WHERE model_type = $3 AND entity_id = $4 AND actual_outcome IS NULL
                ORDER BY logged_at DESC LIMIT 1
            `, [actualOutcome, outcomeLabel, modelName, entityId]);
        } catch (e) {
            // Non-critical
        }
    }

    async evaluateModel(modelName) {
        const statsRes = await db.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN actual_outcome IS NOT NULL THEN 1 ELSE 0 END) as with_outcomes,
                COUNT(*) FILTER (WHERE prediction >= 0.5 AND actual_outcome = 1) as tp,
                COUNT(*) FILTER (WHERE prediction >= 0.5 AND actual_outcome = 0) as fp,
                COUNT(*) FILTER (WHERE prediction < 0.5 AND actual_outcome = 1) as fn,
                COUNT(*) FILTER (WHERE prediction < 0.5 AND actual_outcome = 0) as tn
            FROM ml_training_data
            WHERE model_type = $1 AND actual_outcome IS NOT NULL
        `, [modelName]);
        const stats = statsRes.rows[0];
        const total = parseInt(stats.total || 0);
        const outcomes = parseInt(stats.with_outcomes || 0);

        if (outcomes < 10) {
            await this._updateMaturity(modelName, total, outcomes, null, null, null, null, null, 5000, false);
            return { modelName, totalPredictions: total, recordedOutcomes: outcomes, isProductionReady: false, reason: 'Insufficient data' };
        }

        const tp = parseInt(stats.tp || 0);
        const fp = parseInt(stats.fp || 0);
        const fn = parseInt(stats.fn || 0);
        const tn = parseInt(stats.tn || 0);

        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
        const accuracy = (tp + tn) / Math.max(1, outcomes);
        const isProductionReady = total >= 5000 && f1 >= 0.75;

        await this._updateMaturity(modelName, total, outcomes, precision, recall, f1, accuracy, null, 5000, isProductionReady);

        return {
            modelName,
            totalPredictions: total,
            recordedOutcomes: outcomes,
            precision: Math.round(precision * 10000) / 10000,
            recall: Math.round(recall * 10000) / 10000,
            f1: Math.round(f1 * 10000) / 10000,
            accuracy: Math.round(accuracy * 10000) / 10000,
            isProductionReady,
        };
    }

    async _updateMaturity(modelName, totalPredictions, recordedOutcomes, precision, recall, f1, auc, calibError, minSamples, isProductionReady) {
        await db.query(`
            INSERT INTO model_maturity (model_name, total_predictions, recorded_outcomes,
                precision, recall, f1_score, auc_roc, calibration_error,
                min_samples_required, is_production_ready, calculated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (model_name) DO UPDATE SET
                total_predictions = EXCLUDED.total_predictions,
                recorded_outcomes = EXCLUDED.recorded_outcomes,
                precision = EXCLUDED.precision,
                recall = EXCLUDED.recall,
                f1_score = EXCLUDED.f1_score,
                auc_roc = EXCLUDED.auc_roc,
                calibration_error = EXCLUDED.calibration_error,
                is_production_ready = EXCLUDED.is_production_ready,
                calculated_at = NOW()
        `, [modelName, totalPredictions, recordedOutcomes, precision, recall, f1, auc, calibError, minSamples, isProductionReady]);
    }

    async getAllMaturityScores() {
        const res = await db.query("SELECT * FROM model_maturity ORDER BY calculated_at DESC");
        return res.rows;
    }
}

module.exports = new ModelMaturityService();
