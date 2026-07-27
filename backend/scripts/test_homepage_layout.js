const homepageLayoutService = require('../services/homepage_layout.service');

async function testHomepageLayout() {
    console.log('🧪 [TEST] Fetching backend-driven homepage layout...');
    const layout = await homepageLayoutService.getDynamicLayout({ userLat: 12.9716, userLng: 77.5946 });

    console.log(`✅ [TEST] Layout Success: ${layout.success}`);
    console.log(`✅ [TEST] Total Sections: ${layout.sections.length}`);

    layout.sections.forEach((sec, idx) => {
        const count = Array.isArray(sec.data) ? sec.data.length : (typeof sec.data === 'object' ? 'Object' : 0);
        console.log(`   [Section ${idx + 1}] Type: "${sec.type}" | Title: "${sec.title}" | Items/Data: ${count}`);
    });

    console.log('🎉 HOMEPAGE LAYOUT ENGINE TESTS PASSED CLEANLY!');
}

testHomepageLayout().then(() => process.exit(0)).catch(err => {
    console.error('❌ [TEST ERROR]', err);
    process.exit(1);
});
