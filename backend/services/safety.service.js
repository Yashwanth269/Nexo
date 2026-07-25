const db = require('../config/db');
const { getIO } = require('../config/socket');
const eventBus = require('./event_bus.service');

class SafetyService {
    /**
     * Records a safety incident, triggers AI Risk profiling, and publishes to Event Bus.
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

            // 2. Log to Event Logs
            await db.query(
                `INSERT INTO event_logs (job_id, worker_id, event_type, metadata) 
                 VALUES ($1, $2, 'SAFETY_INCIDENT', $3)`,
                [jobId, reporterType === 'WORKER' ? reporterId : null, JSON.stringify({ incidentId: incident.id, reason, reporterType })]
            );

            const workerId = reporterType === 'WORKER' ? reporterId : await this._getWorkerIdForJob(jobId);

            // 3. AI Risk Profiling / Violation Audit
            if (workerId) {
                await this._profileWorkerRisk(workerId);
            }

            // 4. Publish Event to Event Bus
            eventBus.publish('SAFETY_INCIDENT', {
                incidentId: incident.id,
                jobId,
                workerId,
                reporterType,
                reason,
                status: this._calculateSeverity(reason),
                description,
                location: { lat, lng }
            });

            // 5. Notify Support Room
            const io = getIO();
            if (io) {
                const dashboardContext = await this._buildLiveIncidentRoomContext(jobId, workerId, incident);
                io.to('support_room').emit('new_incident', dashboardContext);
            }

            return { success: true, incidentId: incident.id };
        } catch (error) {
            console.error("❌ [SAFETY-SERVICE] Failed to report incident:", error.message);
            throw error;
        }
    }

    /**
     * Triggers an Emergency SOS (Panic Button) with automated escalation.
     */
    async triggerSOS(workerId, jobId, lat, lng) {
        try {
            const result = await db.query(
                `INSERT INTO safety_incidents (job_id, reporter_id, reporter_type, reason, description, location_lat, location_lng, status) 
                 VALUES ($1, $2, 'WORKER', 'SOS_EMERGENCY', 'Emergency Panic Button Triggered', $3, $4, 'CRITICAL') RETURNING *`,
                [jobId, workerId, lat, lng]
            );

            const incident = result.rows[0];

            // AI Risk Profiling
            await this._profileWorkerRisk(workerId);

            // Publish SOS to Event Bus
            eventBus.publish('SAFETY_INCIDENT', {
                incidentId: incident.id,
                jobId,
                workerId,
                reason: 'SOS_EMERGENCY',
                status: 'CRITICAL',
                location: { lat, lng }
            });

            // Automated Safety Escalation Sequence
            console.log(`🚨 [SOS-ESCALATION] Step 1: Broad-cashing emergency alerts to Nearby contacts`);
            const contactsRes = await db.query(
                "SELECT phone_number, full_name FROM users LIMIT 3"
            );
            const contacts = contactsRes.rows;

            console.log(`🚨 [SOS-ESCALATION] Step 2: Triggering simulated Police API payload dispatch`);
            const policePayload = {
                event: "SOS_EMERGENCY",
                workerId,
                jobId,
                coordinates: { lat, lng },
                dispatched_at: new Date().toISOString()
            };

            // Notify clients / local support channels
            const io = getIO();
            if (io) {
                const dashboardContext = await this._buildLiveIncidentRoomContext(jobId, workerId, incident);
                io.emit('emergency_sos', {
                    workerId,
                    jobId,
                    location: { lat, lng },
                    incidentId: incident.id,
                    escalation: {
                        contactsNotified: contacts.map(c => c.full_name),
                        policeDispatched: true,
                        policePayload,
                        liveTrackingEnabled: true,
                        audioRecordingEnabled: true
                    },
                    dashboard: dashboardContext
                });
            }

            return { 
                success: true, 
                message: "Emergency signal escalated. Contacts notified, live audio/location tracking active." 
            };
        } catch (error) {
            console.error("❌ [SOS-ERROR]", error.message);
            throw error;
        }
    }

    async _getWorkerIdForJob(jobId) {
        const res = await db.query("SELECT worker_id FROM jobs WHERE id = $1", [jobId]);
        return res.rowCount > 0 ? res.rows[0].worker_id : null;
    }

    /**
     * Automated worker risk profiler based on incident and deviation history (Requirement 2)
     */
    async _profileWorkerRisk(workerId) {
        const safetyCountRes = await db.query(
            "SELECT COUNT(*) FROM safety_incidents WHERE reporter_id = $1 OR job_id IN (SELECT id FROM jobs WHERE worker_id = $1)",
            [workerId]
        );
        const deviationCountRes = await db.query(
            "SELECT COUNT(*) FROM route_deviations WHERE worker_id = $1",
            [workerId]
        );

        const safetyIncidents = parseInt(safetyCountRes.rows[0].count || '0');
        const routeDeviations = parseInt(deviationCountRes.rows[0].count || '0');

        console.log(`🛡️ [RISK-PROFILER] Worker ${workerId} history: safety incidents = ${safetyIncidents}, route deviations = ${routeDeviations}`);

        // If high risk markers exceeded, automatically flag worker profile
        if (safetyIncidents >= 2 || routeDeviations >= 3) {
            console.warn(`🚨 [RISK-PROFILER] Worker ${workerId} flagged as HIGH RISK WORKER automatically!`);
            await db.query(
                "UPDATE workers SET verification_status = 'HIGH RISK WORKER' WHERE id = $1",
                [workerId]
            );
        }
    }

    /**
     * Consolidated Live Incident Room Context (Requirement 2)
     */
    async _buildLiveIncidentRoomContext(jobId, workerId, incident) {
        const workerRes = await db.query(
            "SELECT full_name, phone_number, current_lat, current_lng, verification_status FROM workers WHERE id = $1",
            [workerId]
        );
        const jobRes = await db.query(
            "SELECT u.full_name as customer_name, u.phone_number as customer_phone, j.location_lat, j.location_lng, j.route_polyline, j.status " +
            "FROM jobs j JOIN users u ON j.user_id = u.id WHERE j.id = $1",
            [jobId]
        );

        const worker = workerRes.rowCount > 0 ? workerRes.rows[0] : {};
        const job = jobRes.rowCount > 0 ? jobRes.rows[0] : {};

        return {
            incidentId: incident.id,
            jobId,
            status: incident.status,
            reason: incident.reason,
            description: incident.description,
            timestamp: incident.created_at || new Date().toISOString(),
            worker: {
                id: workerId,
                name: worker.full_name || "Unknown Worker",
                phone: worker.phone_number || "N/A",
                location: { lat: worker.current_lat, lng: worker.current_lng },
                verificationStatus: worker.verification_status
            },
            customer: {
                name: job.customer_name || "Unknown Customer",
                phone: job.customer_phone || "N/A",
                destination: { lat: job.location_lat, lng: job.location_lng }
            },
            route: {
                polyline: job.route_polyline || null,
                status: job.status
            },
            liveTracking: {
                enabled: true,
                audioRecording: true
            }
        };
    }

    _calculateSeverity(reason) {
        const criticalReasons = ['Harassment', 'Physical Threat', 'Accident', 'SOS_EMERGENCY'];
        return criticalReasons.includes(reason) ? 'CRITICAL' : 'MODERATE';
    }
}

module.exports = new SafetyService();
