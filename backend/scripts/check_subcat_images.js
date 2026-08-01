'use strict';

const db = require('../config/db');

async function checkSubcategoryImages() {
    try {
        const res = await db.query(`
            SELECT id, name, slug, image 
            FROM marketplace_subcategories 
            ORDER BY name ASC 
            LIMIT 50;
        `);
        console.log('--- SUBCATEGORY IMAGES ---');
        console.log(res.rows);
    } catch (e) {
        console.error('Error fetching subcategories:', e.message);
    } finally {
        process.exit(0);
    }
}

checkSubcategoryImages();
