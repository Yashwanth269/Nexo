/**
 * Nexo Fatigue Service Configuration
 */

module.exports = {
    // Cache configuration
    cacheTtlSeconds: parseInt(process.env.FATIGUE_CACHE_TTL || "600", 10), // 10 minutes

    // Scoring weights
    weights: {
        completedJobs: 0.25,
        hoursOnline: 0.20,
        travelDistance: 0.15,
        offerLoad: 0.15,
        activeJobs: 0.20,
        stressEvents: 0.20
    },

    // Context-aware parameters
    contextMultipliers: {
        nightShift: 1.25, // 25% higher fatigue accumulation at night
        consecutiveDays: 1.10, // 10% penalty per consecutive day worked
        emergencyJob: 1.20 // 20% fatigue penalty for emergency tasks
    },

    // Maximum cap on online hours per day (caps anomalies/app crashes)
    maxOnlineHoursPerDay: 16
};
