/**
 * Acceptance Prediction (Simulated Logistic Regression)
 */
const predictAcceptance = (worker, job) => {
    const dist = worker.currentDistance || 25;
    const distFactor = Math.max(0, 1 - (dist / 25));
    const ratingFactor = (worker.rating || 4.0) / 5;
    const historyFactor = worker.acceptanceRate || 0.7;
    
    // Weighted Probabilistic Model
    const prob = (0.4 * distFactor) + (0.3 * ratingFactor) + (0.3 * historyFactor);
    return Math.min(0.98, Math.max(0.05, prob));
};

/**
 * Cancellation Prediction (Simulated XGBoost)
 */
const predictCancellation = (worker, job) => {
    const historyFactor = worker.cancellationRate || 0.05;
    const dist = worker.currentDistance || 25;
    const urgencyFactor = job.isUrgent ? 0.12 : 0.02;
    
    const distRisk = Math.min(1, dist / 30);
    const prob = (0.6 * historyFactor) + (0.2 * distRisk) + (0.2 * urgencyFactor);
    return Math.min(0.85, Math.max(0.01, prob));
};

module.exports = {
    predictAcceptance,
    predictCancellation
};
