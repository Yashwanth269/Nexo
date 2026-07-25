/**
 * Nexo Emergency & SOS Engine Configuration
 */

module.exports = {
    // SOS duplicate check interval (ms)
    throttlingIntervalMs: parseInt(process.env.EMERGENCY_THROTTLE_MS || "30000", 10), // 30 seconds

    // Escalation warning timer for unacknowledged alerts (ms)
    escalationTimerMs: parseInt(process.env.EMERGENCY_ESCALATION_MS || "300000", 10), // 5 minutes

    // GPS location bounding limits
    locationBoundaries: {
        minLat: 8.0,
        maxLat: 38.0,
        minLng: 68.0,
        maxLng: 98.0
    },

    // Priority mapping policy
    priorityPolicy: {
        'SOS': 'CRITICAL',
        'HARASSMENT': 'HIGH',
        'ACCIDENT': 'HIGH',
        'SAFETY': 'MEDIUM',
        'OTHER': 'MEDIUM'
    },

    // Allowed statuses for Emergency incident lifecycle
    lifecycleStates: {
        OPEN: 'OPEN',
        ACKNOWLEDGED: 'ACKNOWLEDGED',
        INVESTIGATING: 'INVESTIGATING',
        ESCALATED: 'ESCALATED',
        RESOLVED: 'RESOLVED',
        CLOSED: 'CLOSED'
    }
};
