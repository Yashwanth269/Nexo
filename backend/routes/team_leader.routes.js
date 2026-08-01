'use strict';

const express = require('express');
const router = express.Router();
const teamJobService = require('../services/team_job.service');
const teamAttendanceService = require('../services/team_attendance.service');
const teamPaymentService = require('../services/team_payment.service');
const db = require('../config/db');

// View active team jobs broadcast to leaders
router.get('/broadcasts', async (req, res) => {
    try {
        const broadcasts = await db.query(
            "SELECT * FROM team_jobs WHERE status = 'BROADCASTING' ORDER BY created_at DESC"
        );
        res.json({ success: true, broadcasts: broadcasts.rows });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-leader/broadcasts:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Submit a proposal/bid
router.post('/proposals/submit', async (req, res) => {
    try {
        const leaderId = req.user.userId;
        const proposal = await teamJobService.submitProposal({ ...req.body, leaderId });
        res.status(201).json({ success: true, proposal });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-leader/proposals/submit:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Invite member to crew
router.post('/team/invite', async (req, res) => {
    try {
        const leaderId = req.user.userId;
        const { teamJobId, workerId, expectedEarnings } = req.body;
        const invitation = await teamJobService.inviteWorker(teamJobId, leaderId, workerId, expectedEarnings);
        res.status(201).json({ success: true, invitation });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-leader/team/invite:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Upload daily progress log
router.post('/progress/upload', async (req, res) => {
    try {
        const leaderId = req.user.userId;
        const progress = await teamAttendanceService.uploadDailyProgress({ ...req.body, leaderId });
        res.status(201).json({ success: true, progress });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-leader/progress/upload:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Raise request for extra budget, materials, or time
router.post('/additional-work/request', async (req, res) => {
    try {
        const leaderId = req.user.userId;
        const request = await teamJobService.raiseAdditionalWorkRequest({ ...req.body, leaderId });
        res.status(201).json({ success: true, request });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-leader/additional-work/request:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Complete project & trigger payment distribution from escrow
router.post('/payment/release', async (req, res) => {
    try {
        const { teamJobId } = req.body;
        if (!teamJobId) return res.status(400).json({ success: false, error: 'teamJobId is required' });
        
        const result = await teamPaymentService.distributePayment(teamJobId);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-leader/payment/release:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Create verified permanent team
router.post('/team/create-permanent', async (req, res) => {
    try {
        const leaderId = req.user.userId;
        const { teamName } = req.body;
        if (!teamName) return res.status(400).json({ success: false, error: 'teamName is required' });

        const verifiedTeam = await teamJobService.createVerifiedTeam(leaderId, teamName);
        res.status(201).json({ success: true, team: verifiedTeam });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-leader/team/create-permanent:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
