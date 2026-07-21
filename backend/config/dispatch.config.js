/**
 * Nexo Centralized Dispatch Engine Configuration
 * 
 * Configurable thresholds for dispatch pools, timeouts, search radii,
 * fairness weights, and cancellation accountability. Overridable via environment variables.
 */

module.exports = {
    // Pool-Based Dispatch
    pools: {
        pool1Size: parseInt(process.env.DISPATCH_POOL1_SIZE || '3', 10),
        pool2Size: parseInt(process.env.DISPATCH_POOL2_SIZE || '5', 10),
        pool3Size: parseInt(process.env.DISPATCH_POOL3_SIZE || '8', 10),
        offerTtlSeconds: parseInt(process.env.DISPATCH_OFFER_TTL_SEC || '20', 10),
        cooldownSeconds: parseInt(process.env.DISPATCH_WORKER_COOLDOWN_SEC || '900', 10), // 15 mins
        categoryOverrides: {
            'Emergency': { pool1Size: 5, pool2Size: 10, pool3Size: 15, offerTtlSeconds: 15 },
            'Critical': { pool1Size: 5, pool2Size: 10, pool3Size: 15, offerTtlSeconds: 15 },
            'Plumbing': { pool1Size: 2, pool2Size: 4, pool3Size: 6, offerTtlSeconds: 30 }
        }
    },

    // Search Radius Steps (km)
    radii: {
        urban: [3.0, 5.0, 8.0, 12.0, 20.0, 30.0],
        rural: [5.0, 10.0, 15.0, 25.0, 35.0, 50.0],
        emergency: [5.0, 10.0, 20.0, 35.0, 50.0],
    },

    // Redistribution Mode
    redistribution: {
        activeWindowSeconds: parseInt(process.env.DISPATCH_ACTIVE_WINDOW_SEC || '120', 10), // 2 minutes
        scanIntervalSeconds: parseInt(process.env.DISPATCH_SCAN_INTERVAL_SEC || '30', 10),  // 30 seconds
        fullReevalIntervalSeconds: parseInt(process.env.DISPATCH_REEVAL_INTERVAL_SEC || '120', 10), // 2 minutes
        workerCooldownSeconds: parseInt(process.env.DISPATCH_WORKER_COOLDOWN_SEC || '900', 10), // 15 minutes
        maxSearchDays: parseInt(process.env.DISPATCH_MAX_SEARCH_DAYS || '3', 10), // 3 days
    },

    // Multi-Factor Ranking Weights (Sum to 1.0)
    weights: {
        skillConfidence: 0.25,
        reputation: 0.20,
        acceptanceProbability: 0.15,
        distance: 0.10,
        fairnessEarnings: 0.10,
        fairnessIdle: 0.10,
        availability: 0.05,
        eta: 0.05,
    },

    // Worker Accountability & Penalties
    accountability: {
        postAcceptancePenaltyScore: parseFloat(process.env.POST_ACCEPT_PENALTY_SCORE || '0.15'),
        consecutiveCancellationLimit: parseInt(process.env.CONSECUTIVE_CANCEL_LIMIT || '3', 10),
        tempBanCooldownMinutes: parseInt(process.env.TEMP_BAN_COOLDOWN_MIN || '60', 10),
    },

    // Batching Multi-Job Dispatch Readiness
    batching: {
        enabled: process.env.ENABLE_MULTI_JOB_BATCHING === 'true',
        maxConcurrentJobsPerWorker: parseInt(process.env.MAX_BATCHED_JOBS || '2', 10),
        maxRouteDeviationKm: parseFloat(process.env.MAX_ROUTE_DEVIATION_KM || '3.0'),
        maxEtaIncreaseMinutes: parseInt(process.env.MAX_ETA_INCREASE_MIN || '10', 10),
    },

    // Multi-Queue Dispatch Priority Levels
    queues: {
        priorities: ['EMERGENCY', 'HIGH_PRIORITY', 'INSTANT', 'SCHEDULED_RECOVERY', 'SCHEDULED_FUTURE'],
        refreshIntervalsMs: {
            EMERGENCY: 3000,          // 3 seconds aggressive refresh
            HIGH_PRIORITY: 5000,      // 5 seconds
            INSTANT: 10000,           // 10 seconds
            SCHEDULED_RECOVERY: 10000,// 10 seconds
            SCHEDULED_FUTURE: 30000   // 30 seconds
        }
    },

    // Reservation & Worker Availability Engine Configuration
    reservations: {
        defaultTravelTimeMinutes: 20,
        defaultBufferMinutes: 15,
        categoryBuffers: {
            'Simple Cleaning': 10,
            'Cleaning': 15,
            'AC Installation': 45,
            'Plumbing': 20,
            'Moving Service': 90,
            'Emergency': 5,
        },
        dispatchWindows: [
            1440, // 24 hours
            720,  // 12 hours
            360,  // 6 hours
            180,  // 3 hours
            60,   // 1 hour
            30,   // 30 minutes
            15    // 15 minutes
        ],
        activeDispatchWindowMinutes: 30, // Start actual pool dispatch 30 mins before start
        standbyBackupCount: 5,
        lateArrivalThresholdMinutes: 15, // Reassign if predicted delay > 15 mins
        maxDailyWorkingHours: 10,
        maxDailyTravelHours: 4,
        maxDailyDistanceKm: 150
    }
};
