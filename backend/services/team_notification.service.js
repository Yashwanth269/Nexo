'use strict';

const db = require('../config/db');

class TeamNotificationService {
    /**
     * Records and broadcasts a notification related to a Team Job.
     */
    async sendNotification(data) {
        const { userId, workerId, teamJobId, title, message, type } = data;

        const query = `
            INSERT INTO team_notifications (user_id, worker_id, team_job_id, title, message, notification_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;

        const res = await db.query(query, [userId || null, workerId || null, teamJobId || null, title, message, type]);
        const notification = res.rows[0];

        // Emit Socket event
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                if (userId) {
                    io.to(`user:${userId}`).emit('new_team_notification', notification);
                }
                if (workerId) {
                    io.to(`worker:${workerId}`).emit('new_team_notification', notification);
                }
            }
        } catch (socketErr) {
            console.warn('[TEAM_NOTIFICATION] Socket emit failed:', socketErr.message);
        }

        return notification;
    }
}

module.exports = new TeamNotificationService();
