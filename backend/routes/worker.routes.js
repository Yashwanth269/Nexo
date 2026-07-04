const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { haversineDistance } = require('../utils/geo.utils');
const rankingService = require('../services/ranking.service');
const matchingService = require('../services/matching.service');
const db = require('../config/db');
const { SECRET_KEY } = require('../utils/auth.middleware');

// Helper to optionally extract authenticated customer userId
const getOptionalUserId = (req) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            const decoded = jwt.verify(token, SECRET_KEY);
            return decoded.userId || null;
        }
    } catch (err) {
        // Safe fail: ignore invalid tokens for guest flow
    }
    return null;
};

// Update worker location (Real-time Redis Sync)
router.post('/location', async (req, res) => {
    try {
        const { workerId, lat, lng } = req.body;
        if (!workerId || !lat || !lng) return res.status(400).json({ error: "Missing params" });

        await matchingService.updateWorkerLocation(workerId, lat, lng);
        
        // Continuous Discovery: Check if any long-lived jobs are now in radius
        matchingService.checkNearbyJobsForWorker(workerId, lat, lng);

        res.json({ success: true, message: "Location updated & discovery triggered" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Worker Matching Pipeline (Postgres + ML Scored Candidates)
router.post('/match', async (req, res) => {
    try {
        const { category, customerLat, customerLng, radius = 25, isUrgent = true } = req.body;
        if (!category || !customerLat || !customerLng) return res.status(400).json({ error: 'Category and location required' });

        const userId = getOptionalUserId(req);

        // Fetch PostgreSQL ranked candidates near this coordinate
        const rankedCandidates = await rankingService.getTopRatedWorkers(customerLat, customerLng, userId, category);

        // Standardize returning structure to be 100% compatible with matching UI
        const matchedWorkers = rankedCandidates.map(w => ({
            id: w.id,
            name: w.fullName,
            phoneNumber: w.phoneNumber,
            photoUrl: w.photoUrl,
            skills: w.skills,
            experience: w.experience,
            rating: w.rating,
            completionRate: w.completionRate,
            jobs_completed: w.jobsCompleted,
            distance: w.distance,
            responseTime: w.responseTime,
            badges: w.badges,
            explainability: w.explainability,
            finalRankScore: w.finalRankScore
        }));

        res.json({ 
            success: true, 
            totalFound: matchedWorkers.length, 
            workers: matchedWorkers.slice(0, 5) 
        });
    } catch (error) {
        console.error("❌ [MATCH-ENGINE-ERROR] Matching engine failure:", error.message);
        res.status(500).json({ error: 'Matching engine failure' });
    }
});

// Top Rated Workers for Home Screen (Database & Redis Accelerated)
router.get('/top-rated', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat) || 12.988672;
        const lng = parseFloat(req.query.lng) || 78.183186;
        const category = req.query.category || null;
        
        const userId = getOptionalUserId(req);

        // Call the advanced precomputed/cached PG ML scoring engine
        const rankedWorkers = await rankingService.getTopRatedWorkers(lat, lng, userId, category);

        // Map fields to match exact Flutter keys used by cards
        const formattedWorkers = rankedWorkers.map(w => ({
            id: w.id,
            name: w.fullName,
            phoneNumber: w.phoneNumber,
            photoUrl: w.photoUrl,
            skills: w.skills,
            experience: w.experience,
            rating: w.rating,
            completionRate: w.completionRate,
            jobs_completed: w.jobsCompleted,
            distance: w.distance,
            responseTime: w.responseTime,
            badges: w.badges,
            explainability: w.explainability,
            finalRankScore: w.finalRankScore,
            expectedPrice: w.expectedPrice
        }));

        res.json({ success: true, workers: formattedWorkers });
    } catch (error) {
        console.error("❌ [TOP-RATED-ERROR] Failed to fetch top-rated workers:", error.message);
        res.status(500).json({ error: 'Failed to fetch top-rated workers' });
    }
});

// Feedback Loop Learning Endpoint (CTR, invites, booking conversions)
router.post('/feedback/click', async (req, res) => {
    try {
        const { workerId, actionType } = req.body;
        if (!workerId || !actionType) return res.status(400).json({ error: "Missing workerId or actionType" });

        const userId = getOptionalUserId(req);
        await rankingService.recordFeedbackClick(userId, workerId, actionType);
        
        res.json({ success: true, message: "Feedback click logged successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
