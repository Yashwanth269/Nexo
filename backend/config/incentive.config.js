/**
 * Nexo Incentive & surges Config Settings
 */

module.exports = {
    // Configurable thresholds
    milestones: [
        { targetJobs: 20, rewardAmount: 500 },
        { targetJobs: 40, rewardAmount: 1000 },
        { targetJobs: 50, rewardAmount: 1500 }
    ],

    // Localized surge factors
    surges: {
        criticalRatio: 2.0, // demand/supply ratio threshold
        moderateRatio: 1.2,
        criticalMultiplier: 1.35,
        moderateMultiplier: 1.15
    },

    // ML incentive parameters
    mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
    mlTimeoutMs: 2000
};
