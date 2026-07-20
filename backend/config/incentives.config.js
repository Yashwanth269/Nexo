/**
 * Nexo Centralized Revenue, Incentive & Verification Configuration
 * 
 * Centralizes all customer membership tiers, cancellation fee splits, urgent/night surcharges,
 * dynamic ML incentive rules, minimum earnings guarantee rules, and selfie verification triggers.
 */

module.exports = {
    // 1. Customer Membership Tiers
    memberships: {
        MONTHLY: { price: 199, feeDiscountPct: 10, freeCancellationsCount: 2, priorityDispatch: true },
        QUARTERLY: { price: 499, feeDiscountPct: 15, freeCancellationsCount: 6, priorityDispatch: true },
        YEARLY: { price: 1499, feeDiscountPct: 20, freeCancellationsCount: 30, priorityDispatch: true }
    },

    // 2. Cancellation Fee Splits
    cancellation: {
        acceptedFee: parseFloat(process.env.CANCELLATION_FEE_ACCEPTED || '100.00'),
        onTheWayFee: parseFloat(process.env.CANCELLATION_FEE_ON_WAY || '200.00'),
        workerSharePctAccepted: 50, // 50% to worker, 50% to platform
        workerSharePctOnWay: 70,    // 70% to worker compensation, 30% to platform
    },

    // 3. Urgent & Night Surcharges
    surcharges: {
        urgentBookingFee: parseFloat(process.env.URGENT_BOOKING_FEE || '150.00'),
        urgentWorkerBonusPct: 70,   // 70% to worker bonus
        nightStartHour: 22,          // 10 PM
        nightEndHour: 6,             // 6 AM
        nightMultiplier: 1.20,       // 20% price surcharge
        nightWorkerBonusPct: 80     // 80% to worker
    },

    // 4. Minimum Earnings Guarantee
    guarantee: {
        dailyGuaranteeAmount: parseFloat(process.env.MIN_DAILY_GUARANTEE || '800.00'),
        dailyRequiredHours: 8.0,
        dailyRequiredJobs: 6,
        weeklyGuaranteeAmount: parseFloat(process.env.MIN_WEEKLY_GUARANTEE || '6000.00'),
        weeklyRequiredHours: 48.0,
        weeklyRequiredJobs: 35,
        minAcceptanceRatePct: 85.0,
        minCompletionRatePct: 90.0,
        maxSelfieMisses: 2
    },

    // 5. Periodic Selfie Verification Rules
    selfie: {
        maxRetries: parseInt(process.env.SELFIE_MAX_RETRIES || '3', 10),
        sessionCheckIntervalHours: parseInt(process.env.SELFIE_SESSION_INTERVAL_HOURS || '6', 10),
        highValueJobThreshold: parseFloat(process.env.SELFIE_HIGH_VALUE_JOB || '2000.00'),
        confidenceThresholdPct: 80.0,
        s3BucketName: process.env.AWS_S3_BUCKET || 'nexo-verification-images'
    }
};
