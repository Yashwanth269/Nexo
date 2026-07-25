/**
 * Nexo Dispute Engine Configuration
 */

module.exports = {
    slaHours: parseInt(process.env.DISPUTE_SLA_HOURS || "48", 10),
    mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
    mlTimeoutMs: parseInt(process.env.DISPUTE_ML_TIMEOUT_MS || "2000", 10),
    mlMaxRetries: parseInt(process.env.DISPUTE_ML_MAX_RETRIES || "3", 10),
    defaultUserTenureDays: parseInt(process.env.DISPUTE_DEFAULT_USER_TENURE_DAYS || "30", 10),
    defaultJobDurationMinutes: parseInt(process.env.DISPUTE_DEFAULT_JOB_DURATION_MINUTES || "30", 10),
    highValueThreshold: parseFloat(process.env.DISPUTE_HIGH_VALUE_THRESHOLD || "1000.00"),

    categoryMap: {
        "PLUMBING": 0,
        "ELECTRICIAN": 1,
        "CLEANING": 2,
        "PAINTING": 3,
        "CARPENTRY": 4,
        "MOVING": 5,
        "GARDENING": 6,
        "APPLIANCE_REPAIR": 7,
        "IT_SUPPORT": 8,
        "TUTORING": 9,
        "PHOTOGRAPHY": 10,
        "EVENT": 11,
        "DELIVERY": 12,
        "OTHER": 13
    },

    evidenceRanks: {
        GPS: 0.95,
        PAYMENT: 1.00,
        CHAT: 0.60,
        IMAGES: 0.70,
        ROUTE_DEVIATIONS: 0.85
    },

    limits: {
        maxGpsPoints: 100,
        maxChatMessages: 200,
        maxImages: 10,
        maxRouteDeviations: 20
    }
};
