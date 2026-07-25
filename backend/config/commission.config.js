/**
 * Nexo platform commission settings
 * 
 * Centralized settings for fallback commissions, cache keys, redis TTL,
 * validation limits, and dynamic multipliers.
 */

module.exports = {
    // Configurable commission policy fallback rate and fees
    defaultPolicy: {
        rate: parseFloat(process.env.COMMISSION_DEFAULT_RATE || "0.10"),   // 10%
        minFee: parseFloat(process.env.COMMISSION_DEFAULT_MIN_FEE || "0.0"),
        maxFee: process.env.COMMISSION_DEFAULT_MAX_FEE ? parseFloat(process.env.COMMISSION_DEFAULT_MAX_FEE) : null,
        category: "OTHER"
    },

    // Redis cache configuration
    cache: {
        ttlSeconds: parseInt(process.env.COMMISSION_CACHE_TTL_SEC || "3600", 10), // 1 hour
        getCacheKey: (category) => `commission:config:${category}`
    },

    // Strict validation constraints for rates
    validation: {
        minRate: 0.0,
        maxRate: 0.50, // Max 50% commission
        minAmount: 0.01,
        minFee: 0.0
    },

    // Region-specific default overrides (optional configuration)
    regionDefaults: {
        'IN': { rate: 0.12, minFee: 10.0 }, // 12% in India
        'US': { rate: 0.15, minFee: 2.0 },  // 15% in US
    }
};
