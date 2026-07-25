const db = require('../config/db');

// Model-Specific Minimum Sample Thresholds (Point 1)
const MODEL_THRESHOLDS = {
    eta: { minSamples: 100000, f1Min: 0.80 },
    dispatch: { minSamples: 500000, f1Min: 0.85 },
    pricing: { minSamples: 30000, f1Min: 0.75 },
    acceptance: { minSamples: 30000, f1Min: 0.75 },
    default: { minSamples: 5000, f1Min: 0.70 }
};

function calculateROC_AUC(samples) {
    const sorted = [...samples].sort((a, b) => b.prediction - a.prediction);
    const n = sorted.length;
    let nPos = 0;
    let nNeg = 0;
    
    sorted.forEach(s => {
        if (s.actual === 1) nPos++;
        else nNeg++;
    });

    if (nPos === 0 || nNeg === 0) return 0.5;

    let sumRanks = 0;
    for (let i = 0; i < n; i++) {
        if (sorted[i].actual === 1) {
            sumRanks += (n - i);
        }
    }

    return (sumRanks - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function calculateECE(samples, binCount = 10) {
    const bins = Array.from({ length: binCount }, () => ({
        count: 0,
        sumConfidence: 0,
        sumActual: 0
    }));

    samples.forEach(s => {
        const binIndex = Math.min(binCount - 1, Math.floor(s.prediction * binCount));
        bins[binIndex].count++;
        bins[binIndex].sumConfidence += s.prediction;
        bins[binIndex].sumActual += s.actual;
    });

    let ece = 0;
    const total = samples.length;
    if (total === 0) return 0;

    bins.forEach(b => {
        if (b.count > 0) {
            const avgConf = b.sumConfidence / b.count;
            const avgActual = b.sumActual / b.count;
            ece += (b.count / total) * Math.abs(avgConf - avgActual);
        }
    });

    return ece;
}

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
        // Query samples to calculate ROC AUC and ECE calibration error
        const samplesRes = await db.query(`
            SELECT prediction, actual_outcome::int as actual
            FROM ml_training_data
            WHERE model_type = $1 AND actual_outcome IS NOT NULL
            ORDER BY logged_at DESC LIMIT 10000
        `, [modelName]);

        const samples = samplesRes.rows.map(r => ({
            prediction: parseFloat(r.prediction || 0),
            actual: r.actual === 1 ? 1 : 0
        }));

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

        const config = MODEL_THRESHOLDS[modelName.toLowerCase()] || MODEL_THRESHOLDS.default;

        if (outcomes < 10) {
            await this._updateMaturity(modelName, total, outcomes, null, null, null, null, null, config.minSamples, false);
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

        // Compute ROC AUC & ECE (Calibration Error) - Points 2 & 3
        const aucRoc = calculateROC_AUC(samples);
        const calibrationError = calculateECE(samples);

        const isProductionReady = outcomes >= config.minSamples && f1 >= config.f1Min;

        await this._updateMaturity(
            modelName, total, outcomes, precision, recall, f1, aucRoc, calibrationError, config.minSamples, isProductionReady
        );

        return {
            modelName,
            totalPredictions: total,
            recordedOutcomes: outcomes,
            precision: Math.round(precision * 10000) / 10000,
            recall: Math.round(recall * 10000) / 10000,
            f1: Math.round(f1 * 10000) / 10000,
            accuracy: Math.round(accuracy * 10000) / 10000,
            aucRoc: Math.round(aucRoc * 10000) / 10000,
            calibrationError: Math.round(calibrationError * 10000) / 10000,
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
