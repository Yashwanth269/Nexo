'use strict';

require('dotenv').config();
const db = require('../config/db');
const categoryAssetService = require('../services/category_asset.service');

async function batchGenerateLiveAssets(limit = 10) {
    console.log(`🚀 [BATCH_AI_GEN] Starting batch live AI asset generation for ${limit} subcategories...`);

    // Fetch subcategories with pre-loaded master prompts
    const res = await db.query(`
        SELECT p.subcategory_id, p.job_title, s.name as subcat_name, c.name as cat_name
        FROM category_prompts p
        JOIN marketplace_subcategories s ON p.subcategory_id = s.id
        JOIN marketplace_categories c ON s.category_id = c.id
        ORDER BY p.created_at ASC
        LIMIT $1;
    `, [limit]);

    const items = res.rows;
    if (items.length === 0) {
        console.log('⚠️ No subcategories found in category_prompts database.');
        process.exit(0);
    }

    console.log(`📋 Found ${items.length} subcategories to process.`);

    let successCount = 0;
    let fallbackCount = 0;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`\n[${i + 1}/${items.length}] Processing "${item.job_title}" (${item.subcat_name} in ${item.cat_name})...`);

        try {
            const result = await categoryAssetService.generateCategoryAsset(item.subcategory_id);
            if (result.success) {
                if (result.fallbackUsed) {
                    console.log(`⚠️ Result: Fallback asset used (v${result.version}). URL: ${result.imageUrl}`);
                    fallbackCount++;
                } else {
                    console.log(`🎉 Result: LIVE GEMINI SUCCESS! Version v${result.version} -> ${result.imageUrl}`);
                    successCount++;
                }
            } else {
                console.log(`❌ Result: FAILED / REJECTED (${result.reason || result.error})`);
            }
        } catch (err) {
            console.error(`❌ Exception during generation:`, err.message);
        }

        // Delay 2.5 seconds between batch calls to prevent Gemini API 429 Rate Limits
        if (i < items.length - 1) {
            console.log(`⏳ Pacing 2500ms delay before next Gemini API call...`);
            await new Promise(r => setTimeout(r, 2500));
        }
    }

    console.log(`\n==================================================`);
    console.log(`🎉 [BATCH_AI_GEN] Completed batch generation for ${items.length} subcategories.`);
    console.log(`✅ Live Gemini API Assets Generated: ${successCount}`);
    console.log(`⚠️ Fallback Engine Assets Retained: ${fallbackCount}`);
    console.log(`==================================================\n`);

    process.exit(0);
}

const targetCount = parseInt(process.argv[2] || '10', 10);
batchGenerateLiveAssets(targetCount).catch(err => {
    console.error('Fatal batch error:', err);
    process.exit(1);
});
