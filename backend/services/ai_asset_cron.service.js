'use strict';

const cron = require('node-cron');
const db = require('../config/db');
const categoryAssetService = require('./category_asset.service');

class AiAssetCronService {
    start() {
        console.log('⏰ [AI_ASSET_CRON] Registering monthly category asset regeneration scheduler (1st of every month at 00:00)...');

        // Run monthly on 1st day of month at 00:00
        cron.schedule('0 0 1 * *', async () => {
            await this.runMonthlyRegeneration();
        });
    }

    /**
     * Executes monthly asset regeneration for subcategories
     */
    async runMonthlyRegeneration({ subcategoryIds = null } = {}) {
        console.log('🚀 [AI_REGENERATION_START] Starting monthly AI category asset regeneration job...');

        try {
            let subcats = [];
            if (Array.isArray(subcategoryIds) && subcategoryIds.length > 0) {
                const res = await db.query(
                    `SELECT id, name, slug FROM marketplace_subcategories WHERE id = ANY($1::uuid[]) AND is_active = true`,
                    [subcategoryIds]
                );
                subcats = res.rows;
            } else {
                const res = await db.query(
                    `SELECT id, name, slug FROM marketplace_subcategories WHERE is_active = true ORDER BY name ASC`
                );
                subcats = res.rows;
            }

            console.log(`📋 Processing asset regeneration for ${subcats.length} subcategories...`);

            let successCount = 0;
            let failureCount = 0;

            for (const sub of subcats) {
                try {
                    const result = await categoryAssetService.generateCategoryAsset(sub.id);
                    if (result.success) {
                        successCount++;
                    } else {
                        failureCount++;
                    }
                } catch (e) {
                    failureCount++;
                    console.warn(`⚠️ Asset regeneration error for ${sub.name}:`, e.message);
                }
            }

            console.log(`🎉 [AI_REGENERATION_COMPLETE] Regeneration finished. Successes: ${successCount}, Retained Old Versions: ${failureCount}`);
            return { success: true, total: subcats.length, successCount, failureCount };
        } catch (err) {
            console.error('❌ [AI_REGENERATION_ERROR]', err.message);
            throw err;
        }
    }
}

module.exports = new AiAssetCronService();
