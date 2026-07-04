const db = require('../config/db');
const { getIO } = require('../config/socket');
const io = getIO();

class SafetyService {
    /**
     * Records a safety incident and triggers immediate audit.
     */
    async reportIncident(jobId, reporterId, reporterType, reason, description, lat, lng) {
        try {
            // 1. Record in DB
            const result = await db.query(
                `INSERT INTO safety_incidents (job_id, reporter_id, reporter_type, reason, description, location_lat, location_lng) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [jobId, reporterId, reporterType, reason, description, lat, lng]
            );

            const incident = result.rows[0];

            // 2. Log to ML Event Store for Risk Profiling
            await db.query(
                `INSERT INTO event_logs (job_id, worker_id, event_type, metadata) 
                 VALUES ($1, $2, 'SAFETY_INCIDENT', $3)`,
                [jobId, reporterType === 'WORKER' ? reporterId : null, JSON.stringify({ incidentId: incident.id, reason, reporterType })]
            );

            // 3. Notify Support Team (Socket)
            io.to('support_room').emit('new_incident', {
                incidentId: incident.id,
                severity: this._calculateSeverity(reason),
                jobId
            });

            return { success: true, incidentId: incident.id };
        } catch (error) {
            console.error("❌ [SAFETY-SERVICE] Failed to report incident:", error.message);
            throw error;
        }
    }

    /**
     * Triggers an Emergency SOS (Panic Button)
     */
    async triggerSOS(workerId, jobId, lat, lng) {
        try {
            const result = await db.query(
                `INSERT INTO safety_incidents (job_id, reporter_id, reporter_type, reason, description, location_lat, location_lng, status) 
                 VALUES ($1, $2, 'WORKER', 'SOS_EMERGENCY', 'Emergency Panic Button Triggered', $3, $4, 'CRITICAL') RETURNING *`,
                [jobId, workerId, lat, lng]
            );

            const incident = result.rows[0];

            // Immediate Broadcast to Local Authorities/Emergency Room
            io.emit('emergency_sos', {
                workerId,
                jobId,
                location: { lat, lng },
                incidentId: incident.id
            });

            return { success: true, message: "Emergency signal sent. Help is on the way." };
        } catch (error) {
            console.error("❌ [SOS-ERROR]", error.message);
            throw error;
        }
    }

    _calculateSeverity(reason) {
        const criticalReasons = ['Harassment', 'Physical Threat', 'Accident', 'SOS_EMERGENCY'];
        return criticalReasons.includes(reason) ? 'CRITICAL' : 'MODERATE';
    }
}

module.exports = new SafetyService();
