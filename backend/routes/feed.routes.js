const express = require('express');
const router = express.Router();
const feedService = require('../services/feed.service');

// Default developer/test user ID fallback to match user profile checks
const MOCK_USER_ID = '32f38c0f-9b67-4fea-8aa1-a8ef48b4ee4c';

/**
 * GET /api/feed/nearby
 * Returns ranked, localized social feed based on coordinates and custom ML ranking formula.
 */
router.get('/nearby', async (req, res) => {
    try {
        const { lat, lng, userId, cursor, limit } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({ success: false, error: 'Latitude and Longitude coordinates are required.' });
        }
        
        const feedData = await feedService.getFeedNearby(
            parseFloat(lat),
            parseFloat(lng),
            userId || MOCK_USER_ID,
            cursor,
            limit ? parseInt(limit) : 10
        );
        res.json(feedData);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/feed/:postId/like
 * Toggle like status on a completed job post. Invalidates cache & triggers geo socket broadcasts.
 */
router.post('/:postId/like', async (req, res) => {
    try {
        const { postId } = req.params;
        const { userId } = req.body;
        
        const { getIO } = require('../config/socket');
        
        const io = getIO();
        const result = await feedService.likePost(postId, userId || MOCK_USER_ID, io);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/feed/:postId/view
 * Record a post view to track active engagement.
 */
router.post('/:postId/view', async (req, res) => {
    try {
        const { postId } = req.params;
        const { userId } = req.body;
        
        const result = await feedService.viewPost(postId, userId || MOCK_USER_ID);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/feed/:postId/save
 * Toggle bookmark save status on a completed job post.
 */
router.post('/:postId/save', async (req, res) => {
    try {
        const { postId } = req.params;
        const { userId } = req.body;
        
        const result = await feedService.savePost(postId, userId || MOCK_USER_ID);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
