const marketplaceService = require('../services/marketplace.service');

async function testEndpoints() {
    console.log('🧪 [TEST] Fetching categories from DB...');
    const categories = await marketplaceService.getCategories({ bypassCache: true });
    console.log(`✅ [TEST] Total Category Verticals: ${categories.length}`);

    const sampleCat = categories[0];
    console.log(`📌 First Vertical: ${sampleCat.name} (${sampleCat.subcategories.length} subcategories)`);

    console.log('🧪 [TEST] Searching for "drone"...');
    const droneResults = await marketplaceService.searchServices('drone');
    console.log(`✅ [TEST] Search "drone" count: ${droneResults.length}`);
    droneResults.forEach(r => console.log(`   -> ${r.category_name} > ${r.subcategory_name}`));

    console.log('🧪 [TEST] Searching for "electrician"...');
    const elecResults = await marketplaceService.searchServices('electrician');
    console.log(`✅ [TEST] Search "electrician" count: ${elecResults.length}`);

    console.log('🧪 [TEST] Fetching marketplace stats...');
    const stats = await marketplaceService.getMarketplaceStats();
    console.log('✅ [TEST] Stats:', stats);

    console.log('🎉 ALL MARKETPLACE TESTS PASSED CLEANLY!');
}

testEndpoints().then(() => process.exit(0)).catch(err => {
    console.error('❌ [TEST ERROR]', err);
    process.exit(1);
});
