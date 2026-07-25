const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');
const emergencyConfig = require('../config/emergency.config');

class EmergencyService {
    /**
     * Coordinate validation & Spoof check
     */
    _validateCoordinates(lat, lng) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        if (isNaN(latitude) || isNaN(longitude)) {
            throw new Error("[EMERGENCY-VALIDATION-ERROR] Coordinates must be valid numbers");
        }

        const { minLat, maxLat, minLng, maxLng } = emergencyConfig.locationBoundaries;
        if (latitude < minLat || latitude > maxLat || longitude < minLng || longitude > maxLng) {
            throw new Error("[EMERGENCY-VALIDATION-ERROR] Coordinate range is invalid or spoofed");
        }
        return { lat: latitude, lng: longitude };
    }

    /**
     * Decoupled Notification Delivery (Event Bus / Messaging layer abstraction)
     */
    _dispatchNotification(event, payload) {
        try {
            const io = getIO();
            if (io) {
                io.to('admin:emergency').emit(event, payload);
            }
        } catch (err) {
            console.error("[EMERGENCY-NOTIFY-WARN] Failed to deliver socket broadcast:", err.message);
        }
    }

    /**
     * Write audit record to event_logs table
     */
    async _logIncidentEvent(reportId, action, actorId, metadata = {}) {
        try {
            await db.query(`
                INSERT INTO event_logs (event_type, metadata)
                VALUES ($1, $2)
            `, [
                `emergency_${action}`, 
                JSON.stringify({ reportId, actorId, metadata, timestamp: new Date().toISOString() })
            ]);
        } catch (err) {
            console.error("[EMERGENCY-LOG-WARN] Failed to write incident event log:", err.message);
        }
    }

    /**
     * Create emergency report with location validation, abuse throttling, and priority mapping
     */
    async createReport(reporterId, reporterRole, reportType, description, lat, lng, jobId = null) {
        // 1. Coordinates validation
        const { lat: safeLat, lng: safeLng } = this._validateCoordinates(lat, lng);

        // 2. SOS Duplicate check & Throttling
        const throttleKey = `emergency:throttle:${reporterId}`;
        const throttled = await redis.get(throttleKey);
        if (throttled) {
            throw new Error(`[EMERGENCY-THROTTLE] SOS report rate-limited. Please wait before triggering another alert.`);
        }

        // Apply throttling lock
        await redis.set(throttleKey, '1', 'PX', emergencyConfig.throttlingIntervalMs);

        // 3. Priority Mapping Policy
        const safeType = emergencyConfig.priorityPolicy[reportType] ? reportType : 'OTHER';
        const priority = emergencyConfig.priorityPolicy[safeType];

        const res = await db.query(`
            INSERT INTO emergency_reports (job_id, reporter_id, reporter_role, report_type, description, location_lat, location_lng, priority, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [jobId, reporterId, reporterRole, safeType, description, safeLat, safeLng, priority, emergencyConfig.lifecycleStates.OPEN]);

        const report = res.rows[0];

        // 4. Decoupled socket broadcast
        this._dispatchNotification('emergency_report', {
            id: report.id,
            type: safeType,
            priority,
            reporterRole,
            jobId,
            description: description?.substring(0, 200),
            createdAt: report.created_at,
        });

        if (safeType === 'SOS' || safeType === 'HARASSMENT') {
            this._dispatchNotification('sos_alert', {
                id: report.id,
                reporterRole,
                location: { lat: safeLat, lng: safeLng },
                message: `${reporterRole === 'WORKER' ? 'Worker' : 'User'} triggered SOS`,
            });
            await this._autoAssignPriority(report.id, 'CRITICAL');
        }

        // 5. Audit Log creation
        await this._logIncidentEvent(report.id, 'created', reporterId, { type: safeType, priority });
        
        return report;
    }

    /**
     * Acknowledge report and assign resolver admin
     */
    async acknowledgeReport(reportId, adminId) {
        const stateOpen = emergencyConfig.lifecycleStates.OPEN;
        const stateAck = emergencyConfig.lifecycleStates.ACKNOWLEDGED;
        
        const res = await db.query(
            `UPDATE emergency_reports SET status = $1, assigned_admin_id = $2 
             WHERE id = $3 AND status = $4 RETURNING *`,
            [stateAck, adminId, reportId, stateOpen]
        );
        if (res.rowCount > 0) {
            await this._logIncidentEvent(reportId, 'acknowledged', adminId);
        }
    }

    /**
     * Resolve incident and close lifecycle
     */
    async resolveReport(reportId, resolution, adminId = null) {
        const stateResolved = emergencyConfig.lifecycleStates.RESOLVED;

        const res = await db.query(
            `UPDATE emergency_reports SET status = $1, resolved_at = NOW() 
             WHERE id = $2 RETURNING *`,
            [stateResolved, reportId]
        );
        if (res.rowCount > 0) {
            await this._logIncidentEvent(reportId, 'resolved', adminId, { resolution });
        }
    }

    /**
     * Update incident state (Incident Lifecycle Engine)
     */
    async transitionStatus(reportId, nextState, adminId = null, metadata = {}) {
        const states = Object.values(emergencyConfig.lifecycleStates);
        if (!states.includes(nextState)) {
            throw new Error(`[EMERGENCY-STATE-ERROR] Invalid lifecycle transition to '${nextState}'`);
        }

        const res = await db.query(
            `UPDATE emergency_reports SET status = $1, updated_at = NOW() 
             WHERE id = $2 RETURNING *`,
            [nextState, reportId]
        );
        if (res.rowCount > 0) {
            await this._logIncidentEvent(reportId, `transition_${nextState.toLowerCase()}`, adminId, metadata);
        }
        return res.rows[0];
    }

    /**
     * Fetch open reports sorted by priority
     */
    async getOpenReports(priority = null) {
        let query = "SELECT * FROM emergency_reports WHERE status IN ($1, $2, $3)";
        const params = [
            emergencyConfig.lifecycleStates.OPEN,
            emergencyConfig.lifecycleStates.ACKNOWLEDGED,
            emergencyConfig.lifecycleStates.INVESTIGATING
        ];
        
        if (priority) {
            query += " AND priority = $4 ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END, created_at ASC";
            params.push(priority);
        } else {
            query += " ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END, created_at ASC";
        }
        const res = await db.query(query, params);
        return res.rows;
    }

    async _autoAssignPriority(reportId, priority) {
        await db.query(
            "UPDATE emergency_reports SET priority = $1 WHERE id = $2",
            [priority, reportId]
        );
    }
}

module.exports = new EmergencyService();
