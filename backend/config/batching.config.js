/**
 * Nexo Batching Compatibility Service Configuration
 * 
 * Configurable rules, compatibility matrices, exclusive conditions,
 * and redis caching times for combining multiple jobs per worker.
 */

module.exports = {
    // Enable or disable multi-job batching dispatch
    enabled: process.env.ENABLE_MULTI_JOB_BATCHING !== 'false',

    // Max concurrent active jobs a worker is allowed to carry simultaneously
    maxConcurrentJobsPerWorker: parseInt(process.env.MAX_BATCHED_JOBS || "2", 10),

    // Maximum distance deviation (in km) allowed for route additions
    maxRouteDeviationKm: parseFloat(process.env.MAX_ROUTE_DEVIATION_KM || "5.0"),

    // Maximum extra ETA delay (in minutes) added to current customers
    maxEtaIncreaseMinutes: parseInt(process.env.MAX_ETA_INCREASE_MIN || "15", 10),

    // Maximum fatigue score allowed for double booking eligibility
    maxFatigueScore: parseFloat(process.env.BATCHING_MAX_FATIGUE || "8.0"),

    // Allowed delay (in milliseconds) for worker GPS coordination updates
    gpsFreshnessThresholdMs: parseInt(process.env.BATCHING_GPS_FRESHNESS_MS || "300000", 10), // 5 minutes

    // Redis active jobs list caching TTL (in seconds)
    redisCacheTtlSeconds: parseInt(process.env.BATCHING_CACHE_TTL_SEC || "10", 10),

    // Category compatibility lookup matrix
    compatibilityMatrix: {
        'Plumbing': ['Plumbing', 'General Maintenance', 'Leak Repair'],
        'General Maintenance': ['Plumbing', 'General Maintenance', 'Leak Repair'],
        'Leak Repair': ['Plumbing', 'General Maintenance', 'Leak Repair'],
        'Electrical': ['Electrical', 'AC Installation', 'AC Service', 'Appliance Repair'],
        'AC Installation': ['Electrical', 'AC Installation', 'AC Service', 'Appliance Repair'],
        'AC Service': ['Electrical', 'AC Installation', 'AC Service', 'Appliance Repair'],
        'Appliance Repair': ['Electrical', 'AC Installation', 'AC Service', 'Appliance Repair'],
        'Cleaning': ['Cleaning', 'Housekeeping', 'Deep Cleaning'],
        'Housekeeping': ['Cleaning', 'Housekeeping', 'Deep Cleaning'],
        'Deep Cleaning': ['Cleaning', 'Housekeeping', 'Deep Cleaning']
    },

    // Categories that are exclusive and CANNOT be batched with other jobs
    exclusiveCategories: ['Emergency', 'VIP', 'Moving Service'],

    // Job statuses that count as active bookings
    activeStatuses: ['ACCEPTED', 'READY_TO_START', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'WORK_IN_PROGRESS', 'STARTED']
};
