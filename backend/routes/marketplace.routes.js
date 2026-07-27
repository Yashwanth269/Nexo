const express = require('express');
const router = express.Router();
const marketplaceService = require('../services/marketplace.service');

// Get all marketplace category verticals with nested subcategories
router.get('/categories', async (req, res) => {
    try {
        const bypassCache = req.query.refresh === 'true';
        const categories = await marketplaceService.getCategories({ bypassCache });
        res.json({ success: true, count: categories.length, categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get subcategories by category slug or ID
router.get('/subcategories', async (req, res) => {
    try {
        const { category } = req.query;
        if (!category) {
            return res.status(400).json({ success: false, error: 'Category identifier is required' });
        }
        const subcategories = await marketplaceService.getSubcategories(category);
        res.json({ success: true, count: subcategories.length, subcategories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Dynamic Search across categories, subcategories, keywords
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json({ success: true, results: [] });
        }
        const results = await marketplaceService.searchServices(q);
        res.json({ success: true, query: q, count: results.length, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Service Pricing Details
router.get('/pricing/:subcategoryId', async (req, res) => {
    try {
        const pricing = await marketplaceService.getServicePricing(req.params.subcategoryId);
        res.json({ success: true, pricing });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Marketplace Stats & Analytics
router.get('/stats', async (req, res) => {
    try {
        const stats = await marketplaceService.getMarketplaceStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
