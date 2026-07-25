/**
 * Nexo Marketplace Optimization Config Settings
 */

module.exports = {
    // Dynamic heat map coefficients
    heatmap: {
        updateIntervalMinutes: 1,
        deficitThreshold: 10,
        busyThreshold: 20
    },

    // Job bundling preferences
    bundling: {
        maxTravelKm: 2.5,
        maxJobsPerBundle: 3,
        minPayoutMultiplier: 1.10
    },

    // Duration predictor presets
    duration: {
        defaultMins: 60,
        acMins: 90,
        cleaningMins: 120,
        luxuryApartmentBuffer: 15
    },

    // Reassignment risks
    reassignment: {
        criticalProbability: 35,
        moderateProbability: 65
    }
};
