module.exports = {
    // Service Level Agreements (SLAs) for different service urgency levels
    slas: {
        EMERGENCY: {
            assignmentLimitMs: 5 * 60 * 1000, // 5 minutes
            arrivalLimitMs: 20 * 60 * 1000,   // 20 minutes
        },
        NORMAL: {
            assignmentLimitMs: 15 * 60 * 1000, // 15 minutes
            arrivalLimitMs: 60 * 60 * 1000,    // 60 minutes
        },
        SCHEDULED: {
            assignmentLimitMs: 120 * 60 * 1000, // Must be assigned 2 hours before scheduled time
            arrivalLimitMs: 10 * 60 * 1000,     // 10 minutes leeway for scheduled arrival
            onTimeTargetPct: 99.0
        }
    },

    // Zone Health Score parameters
    health: {
        weights: {
            supplyDemandRatio: 0.25,
            avgEta: 0.20,
            slaMetRate: 0.20,
            acceptanceRate: 0.15,
            cancellationRate: 0.10,
            ratings: 0.10
        },
        thresholds: {
            excellent: 90,
            healthy: 70,
            warning: 50
        }
    },

    // Forecasting parameters
    forecast: {
        decayHalfLifeHours: 2.0,
        multipliers: {
            weather: {
                RAINY: { indoor: 1.30, outdoor: 0.50, supply: 0.70 },
                STORMY: { indoor: 1.50, outdoor: 0.20, supply: 0.40 },
                SUNNY: { indoor: 1.0, outdoor: 1.0, supply: 1.0 }
            },
            weekend: { demand: 1.20, supply: 0.90 },
            holiday: { demand: 1.40, supply: 0.70 },
            salaryDays: { demand: 1.15 } // 1st to 5th of the month
        }
    },

    // Load Balancing Weights for Candidate Ranking
    loadBalancer: {
        dailyEarningsLimit: 3000,   // Indian Rupees/Local Currency
        weeklyEarningsLimit: 15000,
        idleTimeTargetMins: 180,    // 3 hours
        maxDailyPenalty: 0.15,
        maxWeeklyPenalty: 0.10,
        maxIdleBonus: 0.10
    },

    // Early Intervention & SLA Recovery Rules
    earlyIntervention: {
        checkIntervalMs: 30000, // check every 30 seconds
        emergencyAssignmentBufferMs: 1 * 60 * 1000, // 1 minute warning
        normalAssignmentBufferMs: 3 * 60 * 1000,    // 3 minutes warning
        poolExpansionMultiplier: 1.5,
        radiusExpansionKm: 5.0
    },

    // Self-Healing Trigger Thresholds
    selfHealing: {
        maxConsecutiveFailures: 3,
        socketReconnectionTimeoutMs: 15000,
        gpsLostTimeoutMs: 60000
    }
};
