const db = require('../config/db');
const { getIO } = require('../config/socket');

class EmergencyService {
    async createReport(reporterId, reporterRole, reportType, description, lat, lng, jobId = null) {
        const validTypes = ['SOS', 'SAFETY', 'HARASSMENT', 'ACCIDENT', 'OTHER'];
        const safeType = validTypes.includes(reportType) ? reportType : 'OTHER';
        const priority = safeType === 'SOS' ? 'CRITICAL' : safeType === 'HARASSMENT' ? 'HIGH' : 'MEDIUM';

        const res = await db.query(`
            INSERT INTO emergency_reports (job_id, reporter_id, reporter_role, report_type, description, location_lat, location_lng, priority)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [jobId, reporterId, reporterRole, safeType, description, lat, lng, priority]);

        const report = res.rows[0];

        const io = getIO();
        io.to('admin:emergency').emit('emergency_report', {
            id: report.id,
            type: safeType,
            priority,
            reporterRole,
            jobId,
            description: description?.substring(0, 200),
            createdAt: report.created_at,
        });

        if (safeType === 'SOS' || safeType === 'HARASSMENT') {
            io.to('admin:emergency').emit('sos_alert', {
                id: report.id,
                reporterRole,
                location: { lat, lng },
                message: `${reporterRole === 'WORKER' ? 'Worker' : 'User'} triggered SOS`,
            });
            await this._autoAssignPriority(report.id, 'CRITICAL');
        }
        return report;
    }

    async acknowledgeReport(reportId, adminId) {
        await db.query(
            "UPDATE emergency_reports SET status = 'ACKNOWLEDGED', assigned_admin_id = $1 WHERE id = $2 AND status = 'OPEN'",
            [adminId, reportId]
        );
    }

    async resolveReport(reportId, resolution) {
        await db.query(
            "UPDATE emergency_reports SET status = 'RESOLVED', resolved_at = NOW() WHERE id = $1",
            [reportId]
        );
    }

    async getOpenReports(priority = null) {
        let query = "SELECT * FROM emergency_reports WHERE status IN ('OPEN', 'ACKNOWLEDGED')";
        const params = [];
        if (priority) {
            query += " AND priority = $1 ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END, created_at ASC";
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
