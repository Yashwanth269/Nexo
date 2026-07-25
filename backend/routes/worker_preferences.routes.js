const express = require('express');
const router = express.Router();
const workerPreferenceService = require('../services/worker_preference.service');
const zoneEngine = require('../services/zone_engine.service');

// Search zones/localities
router.get('/search', async (req, res) => {
    try {
        const { lat, lng, query } = req.query;
        const results = await zoneEngine.suggestZones(
            lat ? parseFloat(lat) : null,
            lng ? parseFloat(lng) : null,
            query
        );
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update zone config
router.post('/zone-config', async (req, res) => {
    try {
        const { workerId, primaryZone, secondaryZones, avoidAreas, workRadius } = req.body;
        if (!workerId) {
            return res.status(400).json({ success: false, error: "Missing workerId" });
        }
        const result = await workerPreferenceService.updateZonePreferences(workerId, {
            primaryZone,
            secondaryZones,
            avoidAreas,
            workRadius
        });
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get preferences
router.get('/:workerId', async (req, res) => {
    try {
        const prefs = await workerPreferenceService.getPreferences(req.params.workerId);
        res.json({ success: true, preferences: prefs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update area ratings
router.post('/areas', async (req, res) => {
    try {
        const { workerId, areaRatings } = req.body;
        const result = await workerPreferenceService.updateAreaRatings(workerId, areaRatings);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Update skill ratings
router.post('/skills', async (req, res) => {
    try {
        const { workerId, skillRatings } = req.body;
        const result = await workerPreferenceService.updateSkillRatings(workerId, skillRatings);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
