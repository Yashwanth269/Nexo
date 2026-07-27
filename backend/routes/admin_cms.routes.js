const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bannerService = require('../services/banner.service');
const homepageLayoutService = require('../services/homepage_layout.service');

// Get All Banners (Admin)
router.get('/banners', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM banner_campaigns ORDER BY priority ASC, created_at DESC');
        res.json({ success: true, count: result.rowCount, banners: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create Banner Campaign (Admin)
router.post('/banners', async (req, res) => {
    try {
        const banner = await bannerService.createBanner(req.body);
        res.json({ success: true, banner });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update Banner Campaign (Admin)
router.put('/banners/:id', async (req, res) => {
    try {
        const banner = await bannerService.updateBanner(req.params.id, req.body);
        res.json({ success: true, banner });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Homepage Sections Config (Admin)
router.get('/sections', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM homepage_sections ORDER BY sort_order ASC');
        res.json({ success: true, sections: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Reorder Homepage Sections (Admin)
router.put('/sections/reorder', async (req, res) => {
    try {
        const { sectionOrders } = req.body; // Array of { id, sortOrder, isEnabled }
        if (!Array.isArray(sectionOrders)) {
            return res.status(400).json({ success: false, error: 'Invalid sectionOrders array' });
        }

        for (const s of sectionOrders) {
            await db.query(
                `UPDATE homepage_sections SET sort_order = $1, is_enabled = COALESCE($2, is_enabled), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
                [s.sortOrder, s.isEnabled, s.id]
            );
        }

        res.json({ success: true, message: 'Section layout reordered successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Track Banner Click Endpoint (Public / Client)
router.post('/banner-click', async (req, res) => {
    try {
        const { bannerId, userId, action, actionPayload, city } = req.body;
        if (!bannerId) return res.status(400).json({ success: false, error: 'bannerId required' });

        await bannerService.trackClick(bannerId, userId, action, actionPayload, city);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
