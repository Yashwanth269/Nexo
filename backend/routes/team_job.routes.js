'use strict';

const express = require('express');
const router = express.Router();
const teamJobService = require('../services/team_job.service');
const teamRecommendationService = require('../services/team_recommendation.service');
const db = require('../config/db');

// Create a team job posting
router.post('/create', async (req, res) => {
    try {
        const userId = req.user.userId;
        const job = await teamJobService.createTeamJob({ ...req.body, userId });
        res.status(201).json({ success: true, job });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-jobs/create:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Fetch user's active team jobs
router.get('/active', async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await db.query(
            "SELECT * FROM team_jobs WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );
        res.json({ success: true, teamJobs: result.rows });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-jobs/active:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Compare incoming proposals with AI Recommendation Engine
router.get('/:id/proposals', async (req, res) => {
    try {
        const teamJobId = req.params.id;
        const result = await db.query(
            `SELECT tp.*, w.full_name as leader_name, w.rating as leader_rating 
             FROM team_proposals tp
             JOIN workers w ON tp.leader_id = w.id
             WHERE tp.team_job_id = $1`,
            [teamJobId]
        );
        
        const proposals = result.rows;
        const rankedProposals = await teamRecommendationService.rankProposals(teamJobId, proposals);
        res.json({ success: true, proposals: rankedProposals });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-jobs/:id/proposals:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Accept a proposal
router.post('/proposals/:proposalId/accept', async (req, res) => {
    try {
        const proposalId = req.params.proposalId;
        const userId = req.user.userId;
        const result = await teamJobService.acceptProposal(proposalId, userId);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-jobs/proposals/:proposalId/accept:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Respond to additional work requests
router.post('/:id/additional-work/:requestId/respond', async (req, res) => {
    try {
        const requestId = req.params.requestId;
        const { accept } = req.body;
        const userId = req.user.userId;
        
        if (accept === undefined) {
            return res.status(400).json({ success: false, error: 'Please specify accept (true/false)' });
        }

        const result = await teamJobService.respondToAdditionalWork(requestId, userId, accept);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-jobs/:id/additional-work/:requestId/respond:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Fetch Daily timeline and logs
router.get('/:id/timeline', async (req, res) => {
    try {
        const teamJobId = req.params.id;
        const teamAttendanceService = require('../services/team_attendance.service');
        const timeline = await teamAttendanceService.getDailyTimeline(teamJobId);
        res.json({ success: true, timeline });
    } catch (e) {
        console.error('[ROUTE-ERROR] /team-jobs/:id/timeline:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
