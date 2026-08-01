const express = require('express');
const router = express.Router();
const marketplaceService = require('../services/marketplace.service');

// Get all marketplace categories with nested subcategories and jobs
router.get('/categories', async (req, res) => {
    try {
        const bypassCache = req.query.refresh === 'true';
        const categories = await marketplaceService.getCategories({ bypassCache });
        res.json({ success: true, count: categories.length, categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single category by ID or slug
router.get('/categories/:id', async (req, res) => {
    try {
        const category = await marketplaceService.getCategoryById(req.params.id);
        if (!category) {
            return res.status(404).json({ success: false, error: 'Category not found' });
        }
        res.json({ success: true, category });
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

// Get all jobs (flat list) — filterable by ?category=, ?subcategory=, ?team=true|false
router.get('/jobs', async (req, res) => {
    try {
        const { category, subcategory, team } = req.query;
        const jobs = await marketplaceService.getJobs({ category, subcategory, team });
        res.json({ success: true, count: jobs.length, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get only team jobs
router.get('/jobs/team', async (req, res) => {
    try {
        const jobs = await marketplaceService.getJobs({ team: true });
        res.json({ success: true, count: jobs.length, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get only normal (non-team) jobs
router.get('/jobs/normal', async (req, res) => {
    try {
        const jobs = await marketplaceService.getJobs({ team: false });
        res.json({ success: true, count: jobs.length, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single job by ID or slug
router.get('/jobs/:id', async (req, res) => {
    try {
        const job = await marketplaceService.getJobById(req.params.id);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }
        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Dynamic Search across categories, subcategories, jobs, keywords
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
