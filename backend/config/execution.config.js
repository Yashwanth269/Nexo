/**
 * Nexo Execution Service Configuration
 */

module.exports = {
    // Arrival confirmation radius (meters)
    arrivalRadiusMeters: parseInt(process.env.ARRIVAL_RADIUS_METERS || "100", 10),

    // Mandatory stationary duration before arrival can be marked (seconds)
    stationaryDurationSeconds: parseInt(process.env.STATIONARY_DURATION_SEC || "20", 10),

    // GPS trust scoring thresholds
    gpsTrustThresholds: {
        suspicious: 60,
        fraudAlert: 40
    },

    // OSRM/Google Maps Directions cache settings
    directionsCacheTtlSeconds: parseInt(process.env.DIRECTIONS_CACHE_TTL || "30", 10),
    directionsRefreshMinDistanceMeters: 100, // Refreshes directions if moved > 100m

    // ML predictions configuration
    mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
    mlTimeoutMs: parseInt(process.env.EXECUTION_ML_TIMEOUT_MS || "2000", 10),
    mlMaxRetries: 3
};
