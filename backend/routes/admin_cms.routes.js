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

// AI Prompt Library: List Master Prompts
router.get('/ai-assets/prompts', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                p.*, 
                s.name as subcategory_name, 
                s.slug as subcategory_slug, 
                s.image as current_image,
                c.name as category_name,
                COALESCE(img.version, 0) as current_version,
                COALESCE(img.status, 'DEFAULT') as current_status,
                img.created_at as last_generated_at
            FROM category_prompts p
            JOIN marketplace_subcategories s ON p.subcategory_id = s.id
            JOIN marketplace_categories c ON s.category_id = c.id
            LEFT JOIN LATERAL (
                SELECT version, status, created_at 
                FROM category_images 
                WHERE subcategory_id = s.id 
                ORDER BY version DESC, created_at DESC 
                LIMIT 1
            ) img ON true
            ORDER BY c.name ASC, s.name ASC;
        `);
        res.json({ success: true, count: result.rowCount, prompts: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// AI Prompt Library: Create or Update Master Prompt
router.post('/ai-assets/prompts', async (req, res) => {
    try {
        const promptGeneratorService = require('../services/prompt_generator.service');
        const { subcategoryId, jobTitle, jobTool } = req.body;

        if (!subcategoryId || !jobTitle || !jobTool) {
            return res.status(400).json({ success: false, error: 'subcategoryId, jobTitle, and jobTool are required' });
        }

        const subRes = await db.query('SELECT category_id FROM marketplace_subcategories WHERE id = $1', [subcategoryId]);
        if (subRes.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Subcategory not found' });
        }
        const categoryId = subRes.rows[0].category_id;

        const masterPrompt = promptGeneratorService.generateMasterPrompt(jobTitle, jobTool);
        const negativePrompt = promptGeneratorService.STANDARD_NEGATIVE_PROMPT;

        const validation = promptGeneratorService.validatePrompt({ jobTitle, jobTool, masterPrompt, negativePrompt });
        if (!validation.isValid) {
            return res.status(400).json({ success: false, errors: validation.errors });
        }

        const result = await db.query(`
            INSERT INTO category_prompts 
                (category_id, subcategory_id, job_title, job_tool, master_prompt, negative_prompt, style_version, provider, is_approved)
            VALUES 
                ($1, $2, $3, $4, $5, $6, 1, 'GEMINI', true)
            ON CONFLICT (subcategory_id) DO UPDATE SET
                job_title = EXCLUDED.job_title,
                job_tool = EXCLUDED.job_tool,
                master_prompt = EXCLUDED.master_prompt,
                negative_prompt = EXCLUDED.negative_prompt,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `, [categoryId, subcategoryId, jobTitle, jobTool, masterPrompt, negativePrompt]);

        res.json({ success: true, prompt: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// AI Asset Generation: Trigger Generation for Subcategory
router.post('/ai-assets/generate', async (req, res) => {
    try {
        const categoryAssetService = require('../services/category_asset.service');
        const aiAssetCronService = require('../services/ai_asset_cron.service');
        const { subcategoryId, subcategoryIds } = req.body;

        if (subcategoryId) {
            const result = await categoryAssetService.generateCategoryAsset(subcategoryId);
            return res.json(result);
        }

        if (Array.isArray(subcategoryIds)) {
            const summary = await aiAssetCronService.runMonthlyRegeneration({ subcategoryIds });
            return res.json(summary);
        }

        const summary = await aiAssetCronService.runMonthlyRegeneration();
        res.json(summary);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// AI Asset Versions: Get Asset Version History for Subcategory
router.get('/ai-assets/versions/:subcategoryId', async (req, res) => {
    try {
        const { subcategoryId } = req.params;
        const result = await db.query(`
            SELECT i.*, p.job_title, p.job_tool
            FROM category_images i
            LEFT JOIN category_prompts p ON i.prompt_id = p.id
            WHERE i.subcategory_id = $1::uuid OR i.subcategory_id IN (SELECT id FROM marketplace_subcategories WHERE slug = $1)
            ORDER BY i.version DESC, i.created_at DESC;
        `, [subcategoryId]);

        res.json({ success: true, count: result.rowCount, versions: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
