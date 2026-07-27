'use strict';

const db = require('../config/db');
const redis = require('../config/redis');
const geminiImageService = require('./gemini_image.service');
const imageValidatorService = require('./image_validator.service');
const promptGeneratorService = require('./prompt_generator.service');

class CategoryAssetService {
    /**
     * Zero-Downtime Image Selection Engine
     * Retrieves current active asset version or permanent static fallback
     */
    async getActiveCategoryAsset(subcategoryId) {
        if (!subcategoryId) return null;

        // 1. Fetch latest approved/ready AI asset version
        const query = `
            SELECT i.id, i.version, i.image_url, i.thumbnail_url, i.status, i.approved
            FROM category_images i
            JOIN marketplace_subcategories s ON i.subcategory_id = s.id
            WHERE (s.id::text = $1 OR s.slug = $1)
              AND (i.status = 'READY' OR i.approved = true)
            ORDER BY i.version DESC, i.created_at DESC
            LIMIT 1;
        `;

        try {
            const result = await db.query(query, [subcategoryId]);
            if (result.rowCount > 0) {
                return result.rows[0];
            }

            // 2. Fetch default subcategory baseline image path if no AI version ready
            const subcatRes = await db.query(
                `SELECT s.image, s.name FROM marketplace_subcategories s WHERE s.id::text = $1 OR s.slug = $1`,
                [subcategoryId]
            );

            if (subcatRes.rowCount > 0 && subcatRes.rows[0].image) {
                return {
                    version: 0,
                    image_url: subcatRes.rows[0].image,
                    status: 'DEFAULT_FALLBACK',
                    approved: true
                };
            }
        } catch (err) {
            console.warn('[CATEGORY_ASSET_WARN] Failed to fetch asset version:', err.message);
        }

        // 3. Permanent hardcoded fallback asset (never show blank)
        return {
            version: 0,
            image_url: 'assets/images/home services/electrical/wiring.webp',
            status: 'PERMANENT_FALLBACK',
            approved: true
        };
    }

    /**
     * Executes AI Generation pipeline for a given subcategory from stored master prompt
     */
    async generateCategoryAsset(subcategoryId) {
        // 1. Read stored master prompt from database
        const promptRes = await db.query(`
            SELECT p.*, s.category_id, s.name as subcat_name, s.slug as subcat_slug
            FROM category_prompts p
            JOIN marketplace_subcategories s ON p.subcategory_id = s.id
            WHERE s.id::text = $1 OR s.slug = $1;
        `, [subcategoryId]);

        if (promptRes.rowCount === 0) {
            throw new Error(`No preloaded master prompt found for subcategory: ${subcategoryId}`);
        }

        const promptRecord = promptRes.rows[0];

        // 2. Determine next version number (never overwrite existing rows)
        const versionRes = await db.query(`
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM category_images
            WHERE subcategory_id = $1;
        `, [promptRecord.subcategory_id]);
        const nextVersion = versionRes.rows[0].next_version;

        // 3. Create initial GENERATING record
        const insertRes = await db.query(`
            INSERT INTO category_images 
                (category_id, subcategory_id, version, provider, prompt_id, prompt_used, image_url, status, approved)
            VALUES 
                ($1, $2, $3, 'GEMINI', $4, $5, 'PENDING_GENERATION', 'GENERATING', false)
            RETURNING id;
        `, [promptRecord.category_id, promptRecord.subcategory_id, nextVersion, promptRecord.id, promptRecord.master_prompt]);
        const imageId = insertRes.rows[0].id;

        try {
            // 4. Call Gemini API to generate image
            const genResult = await geminiImageService.generateImage({
                masterPrompt: promptRecord.master_prompt,
                negativePrompt: promptRecord.negative_prompt,
                subcategorySlug: promptRecord.subcat_slug
            });

            // 5. Automated Quality Validation
            const validation = imageValidatorService.validateImageBuffer(genResult.imageBuffer);

            if (!validation.isValid) {
                // Quality Validation Failed -> Mark REJECTED & Retain Old Active Version
                await db.query(`
                    UPDATE category_images 
                    SET status = 'REJECTED', approved = false, metadata = $1
                    WHERE id = $2;
                `, [JSON.stringify({ reason: validation.reason }), imageId]);

                return {
                    success: false,
                    version: nextVersion,
                    status: 'REJECTED',
                    reason: validation.reason,
                    message: 'Quality check failed. Previous active image version retained without downtime.'
                };
            }

            // 6. Quality Validation Passed -> Update status READY & approve
            await db.query(`
                UPDATE category_images 
                SET status = 'READY', approved = true, image_url = $1, thumbnail_url = $1, metadata = $2
                WHERE id = $3;
            `, [genResult.imageUrl, JSON.stringify({ sizeBytes: validation.sizeBytes, format: validation.format }), imageId]);

            // Also update marketplace_subcategories.image column for instant sync
            await db.query(`
                UPDATE marketplace_subcategories SET image = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2;
            `, [genResult.imageUrl, promptRecord.subcategory_id]);

            // Invalidate Redis Cache
            await this._invalidateCache();

            return {
                success: true,
                version: nextVersion,
                imageUrl: genResult.imageUrl,
                status: 'READY',
                approved: true
            };
        } catch (err) {
            // Generation Error -> Mark FAILED & Retain Old Active Version
            await db.query(`
                UPDATE category_images 
                SET status = 'FAILED', approved = false, metadata = $1
                WHERE id = $2;
            `, [JSON.stringify({ error: err.message }), imageId]);

            return {
                success: false,
                version: nextVersion,
                status: 'FAILED',
                error: err.message,
                message: 'AI Generation failed. Previous active image version retained without downtime.'
            };
        }
    }

    /**
     * Invalidate marketplace Redis cache
     */
    async _invalidateCache() {
        try {
            await redis.del('marketplace:categories:all');
        } catch (_) {}
    }
}

module.exports = new CategoryAssetService();
