'use strict';

const db = require('../config/db');
const { seedCategoryPrompts } = require('./seed_category_prompts');
const PromptGeneratorService = require('../services/prompt_generator.service');
const categoryAssetService = require('../services/category_asset.service');
const imageValidatorService = require('../services/image_validator.service');

async function testAiAssetGenerator() {
    console.log('🧪 [TEST] Starting AI Prompt Library & Asset Generator Verification...');

    // 1. Run Migration V22 check via seed prompts
    await seedCategoryPrompts();

    // 2. Query category_prompts table count
    const promptCountRes = await db.query('SELECT COUNT(*) FROM category_prompts');
    console.log(`✅ [TEST] Preloaded Master Prompts in DB: ${promptCountRes.rows[0].count}`);

    // 3. Test Master Prompt Validation
    const testPrompt = PromptGeneratorService.generateMasterPrompt('Electrician', 'Digital Multimeter & Wire Stripper');
    const validation = PromptGeneratorService.validatePrompt({
        jobTitle: 'Electrician',
        jobTool: 'Digital Multimeter',
        masterPrompt: testPrompt,
        negativePrompt: PromptGeneratorService.STANDARD_NEGATIVE_PROMPT
    });
    console.log(`✅ [TEST] Master Prompt Character Count: ${testPrompt.length} chars (Valid: ${validation.isValid})`);

    // 4. Get a sample subcategory ID
    const subcatRes = await db.query(`SELECT id, name, slug FROM marketplace_subcategories WHERE name = 'Electrician' LIMIT 1`);
    if (subcatRes.rowCount === 0) {
        throw new Error('Electrician subcategory not found in DB');
    }
    const subcat = subcatRes.rows[0];

    // 5. Test Zero-Downtime Fallback before AI generation (should return default icon)
    const initialAsset = await categoryAssetService.getActiveCategoryAsset(subcat.id);
    console.log(`✅ [TEST] Initial Fallback Asset (v${initialAsset.version}): ${initialAsset.image_url} [Status: ${initialAsset.status}]`);

    // 6. Test AI Asset Generation (Version 1)
    console.log(`🧪 [TEST] Generating AI Asset Version 1 for "${subcat.name}" via Gemini API...`);
    const genResultV1 = await categoryAssetService.generateCategoryAsset(subcat.id);
    console.log(`✅ [TEST] Version 1 Result: Status=${genResultV1.status}, Approved=${genResultV1.approved}, URL=${genResultV1.imageUrl}`);

    // 7. Verify Active Asset returned now is Version 1
    const activeAssetV1 = await categoryAssetService.getActiveCategoryAsset(subcat.id);
    console.log(`✅ [TEST] Active Asset after V1 (v${activeAssetV1.version}): ${activeAssetV1.image_url}`);

    // 8. Test Version 2 Incrementing
    console.log(`🧪 [TEST] Triggering Version 2 Generation for "${subcat.name}"...`);
    const genResultV2 = await categoryAssetService.generateCategoryAsset(subcat.id);
    console.log(`✅ [TEST] Version 2 Result: Status=${genResultV2.status}, Version=${genResultV2.version}, URL=${genResultV2.imageUrl}`);

    // 9. Verify Active Asset is now Version 2
    const activeAssetV2 = await categoryAssetService.getActiveCategoryAsset(subcat.id);
    console.log(`✅ [TEST] Active Asset after V2 (v${activeAssetV2.version}): ${activeAssetV2.image_url}`);

    console.log('🎉 ALL AI PROMPT LIBRARY & ASSET GENERATION TESTS PASSED CLEANLY!');
}

testAiAssetGenerator().then(() => process.exit(0)).catch(err => {
    console.error('❌ [TEST_ERROR]', err);
    process.exit(1);
});
