'use strict';

const express = require('express');
const router = express.Router();
const teamJobService = require('../services/team_job.service');
const teamAttendanceService = require('../services/team_attendance.service');
const db = require('../config/db');

// View pending crew recruitment invites
router.get('/invitations', async (req, res) => {
    try {
        const workerId = req.user.userId;
        const invites = await db.query(
            `SELECT ti.*, w.full_name as leader_name, tj.category, tj.description 
             FROM team_invitations ti
             JOIN workers w ON ti.leader_id = w.id
             JOIN team_jobs tj ON ti.team_job_id = tj.id
             WHERE ti.worker_id = $1 AND ti.status = 'PENDING'`,
            [workerId]
        );
        res.json({ success: true, invitations: invites.rows });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-worker/invitations:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Respond to invitation (Accept/Decline)
router.post('/invitations/:id/respond', async (req, res) => {
    try {
        const workerId = req.user.userId;
        const invitationId = req.params.id;
        const { accept } = req.body;

        if (accept === undefined) {
            return res.status(400).json({ success: false, error: 'Please specify accept (true/false)' });
        }

        const result = await teamJobService.respondToInvitation(invitationId, workerId, accept);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-worker/invitations/:id/respond:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Shift check-in with GPS verification
router.post('/attendance/check-in', async (req, res) => {
    try {
        const workerId = req.user.userId;
        const { teamJobId, lat, lng, faceVerified } = req.body;

        if (!teamJobId || !lat || !lng) {
            return res.status(400).json({ success: false, error: 'teamJobId, lat and lng are required' });
        }

        const result = await teamAttendanceService.checkIn(teamJobId, workerId, lat, lng, faceVerified || false);
        res.json({ success: true, attendance: result });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-worker/attendance/check-in:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Shift check-out with GPS verification
router.post('/attendance/check-out', async (req, res) => {
    try {
        const workerId = req.user.userId;
        const { teamJobId, lat, lng } = req.body;

        if (!teamJobId || !lat || !lng) {
            return res.status(400).json({ success: false, error: 'teamJobId, lat and lng are required' });
        }

        const result = await teamAttendanceService.checkOut(teamJobId, workerId, lat, lng);
        res.json({ success: true, attendance: result });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-worker/attendance/check-out:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
