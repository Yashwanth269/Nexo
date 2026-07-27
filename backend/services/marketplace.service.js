const db = require('../config/db');
const redis = require('../config/redis');

class MarketplaceService {
    /**
     * Get all active category verticals with nested subcategories (Redis cached)
     */
    async getCategories({ bypassCache = false } = {}) {
        const cacheKey = 'marketplace:categories:all';

        if (!bypassCache) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    return JSON.parse(cached);
                }
            } catch (err) {
                console.warn('[MARKETPLACE] Redis cache get failed:', err.message);
            }
        }

        const query = `
            SELECT 
                c.id, c.name, c.slug, c.icon, c.description, c.sort_order,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', s.id,
                            'name', s.name,
                            'slug', s.slug,
                            'icon', s.icon,
                            'image', s.image,
                            'defaultPricingType', s.default_pricing_type,
                            'minPrice', s.min_price,
                            'maxPrice', s.max_price,
                            'keywords', s.keywords
                        ) ORDER BY s.name ASC
                    ) FILTER (WHERE s.id IS NOT NULL), '[]'
                ) as subcategories
            FROM marketplace_categories c
            LEFT JOIN marketplace_subcategories s ON s.category_id = c.id AND s.is_active = true
            WHERE c.is_active = true
            GROUP BY c.id
            ORDER BY c.sort_order ASC, c.name ASC;
        `;

        const result = await db.query(query);
        const categories = result.rows;

        try {
            await redis.set(cacheKey, JSON.stringify(categories), 'EX', 3600);
        } catch (err) {
            console.warn('[MARKETPLACE] Redis cache set failed:', err.message);
        }

        return categories;
    }

    /**
     * Get subcategories by category slug or ID
     */
    async getSubcategories(categoryIdentifier) {
        const query = `
            SELECT s.*, c.name as category_name, c.slug as category_slug
            FROM marketplace_subcategories s
            JOIN marketplace_categories c ON s.category_id = c.id
            WHERE (c.slug = $1 OR c.id::text = $1) AND s.is_active = true
            ORDER BY s.name ASC;
        `;
        const result = await db.query(query, [categoryIdentifier]);
        return result.rows;
    }

    /**
     * Dynamic search across categories, subcategories, keywords, and synonyms
     */
    async searchServices(searchTerm) {
        if (!searchTerm || !searchTerm.trim()) {
            return [];
        }

        const term = `%${searchTerm.trim().toLowerCase()}%`;
        const query = `
            SELECT 
                s.id as subcategory_id,
                s.name as subcategory_name,
                s.slug as subcategory_slug,
                s.icon,
                s.min_price,
                s.max_price,
                s.default_pricing_type,
                c.id as category_id,
                c.name as category_name,
                c.slug as category_slug
            FROM marketplace_subcategories s
            JOIN marketplace_categories c ON s.category_id = c.id
            WHERE s.is_active = true AND c.is_active = true
              AND (
                LOWER(s.name) LIKE $1 
                OR LOWER(c.name) LIKE $1 
                OR LOWER(s.slug) LIKE $1 
                OR EXISTS (
                    SELECT 1 FROM unnest(s.keywords) kw WHERE LOWER(kw) LIKE $1
                )
              )
            ORDER BY 
              CASE WHEN LOWER(s.name) = LOWER($2) THEN 1 ELSE 2 END,
              s.name ASC
            LIMIT 30;
        `;

        const result = await db.query(query, [term, searchTerm.trim()]);
        return result.rows;
    }

    /**
     * Get pricing for a subcategory
     */
    async getServicePricing(subcategoryId) {
        const query = `
            SELECT p.*, s.name as subcategory_name, s.default_pricing_type
            FROM service_pricing p
            RIGHT JOIN marketplace_subcategories s ON p.subcategory_id = s.id
            WHERE s.id = $1::uuid OR s.slug = $1;
        `;
        const result = await db.query(query, [subcategoryId]);
        return result.rows[0] || null;
    }

    /**
     * Get overall marketplace analytics & category demand/supply
     */
    async getMarketplaceStats() {
        const categoryCountRes = await db.query('SELECT COUNT(*) FROM marketplace_categories WHERE is_active = true');
        const subcategoryCountRes = await db.query('SELECT COUNT(*) FROM marketplace_subcategories WHERE is_active = true');
        const topBookedRes = await db.query(`
            SELECT category, COUNT(*) as booking_count 
            FROM jobs 
            GROUP BY category 
            ORDER BY booking_count DESC 
            LIMIT 10;
        `);

        return {
            totalCategories: parseInt(categoryCountRes.rows[0].count, 10),
            totalSubcategories: parseInt(subcategoryCountRes.rows[0].count, 10),
            topBookedCategories: topBookedRes.rows
        };
    }
}

module.exports = new MarketplaceService();
