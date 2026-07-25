/**
 * Nexo Database Schema Validation Engine Configuration
 * 
 * Centralized settings for startup error handling, alerting thresholds,
 * metadata cache rules, and error classification filters.
 */

module.exports = {
    // Startup Policies: FAIL_FAST, DEGRADED, WARN_ONLY
    startupPolicy: process.env.DB_VALIDATION_POLICY || 'WARN_ONLY',

    // How often validation should run periodically (ms)
    revalidationIntervalMs: parseInt(process.env.DB_VALIDATION_INTERVAL_MS || '3600000', 10), // 1 hour

    // Minimum logs output delay to avoid spamming console
    loggingCooldownMs: parseInt(process.env.DB_LOGGING_COOLDOWN_MS || '300000', 10), // 5 minutes

    // Schema requirements version compatibility bounds
    expectedVersion: '1.2.0',

    // Error Classification Map
    errorClasses: {
        DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
        PERMISSION_DENIED: 'PERMISSION_DENIED',
        MIGRATION_MISMATCH: 'MIGRATION_MISMATCH',
        METADATA_CORRUPTION: 'METADATA_CORRUPTION',
        SCHEMA_MISSING: 'SCHEMA_MISSING',
        UNKNOWN_FAILURE: 'UNKNOWN_FAILURE'
    }
};
