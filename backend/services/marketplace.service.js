const db = require('../config/db');
const redis = require('../config/redis');

class MarketplaceService {
    /**
     * Get all active categories with nested subcategories AND jobs (Redis cached)
     */
    async getCategories({ bypassCache = false } = {}) {
        const cacheKey = 'marketplace:categories:all:v2';

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
                c.id, c.name, c.slug, c.icon, c.emoji, c.description, c.color, c.sort_order,
                COALESCE(
                    (SELECT json_agg(sub_row ORDER BY sub_row.sort_order)
                     FROM (
                        SELECT 
                            s.id, s.name, s.slug, s.icon, s.image_1x1, s.image_16x9, s.sort_order,
                            COALESCE(
                                (SELECT json_agg(job_row ORDER BY job_row.sort_order)
                                 FROM (
                                    SELECT j.id, j.name, j.slug, j.image_1x1, j.image_16x9,
                                           j.is_team_job, j.min_workers, j.max_workers,
                                           j.default_pricing_type, j.min_price, j.max_price,
                                           j.keywords, j.sort_order
                                    FROM marketplace_jobs j
                                    WHERE j.subcategory_id = s.id AND j.is_active = true
                                 ) job_row
                                ), '[]'::json
                            ) as jobs
                        FROM marketplace_subcategories s
                        WHERE s.category_id = c.id AND s.is_active = true
                     ) sub_row
                    ), '[]'::json
                ) as subcategories
            FROM marketplace_categories c
            WHERE c.is_active = true
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
     * Get single category by ID or slug with full hierarchy
     */
    async getCategoryById(identifier) {
        const categories = await this.getCategories();
        return categories.find(c => c.id === identifier || c.slug === identifier) || null;
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
            ORDER BY s.sort_order ASC, s.name ASC;
        `;
        const result = await db.query(query, [categoryIdentifier]);
        return result.rows;
    }

    /**
     * Get all jobs (flat list, filterable)
     */
    async getJobs({ category, subcategory, team } = {}) {
        let query = `
            SELECT j.*, 
                   s.name as subcategory_name, s.slug as subcategory_slug,
                   c.name as category_name, c.slug as category_slug, c.color as category_color
            FROM marketplace_jobs j
            JOIN marketplace_subcategories s ON j.subcategory_id = s.id
            JOIN marketplace_categories c ON j.category_id = c.id
            WHERE j.is_active = true
        `;
        const params = [];
        let paramIdx = 1;

        if (category) {
            query += ` AND (c.slug = $${paramIdx} OR c.id::text = $${paramIdx})`;
            params.push(category);
            paramIdx++;
        }
        if (subcategory) {
            query += ` AND (s.slug = $${paramIdx} OR s.id::text = $${paramIdx})`;
            params.push(subcategory);
            paramIdx++;
        }
        if (team === 'true' || team === true) {
            query += ` AND j.is_team_job = true`;
        } else if (team === 'false' || team === false) {
            query += ` AND j.is_team_job = false`;
        }

        query += ` ORDER BY c.sort_order ASC, s.sort_order ASC, j.sort_order ASC;`;

        const result = await db.query(query, params);
        return result.rows;
    }

    /**
     * Get single job by ID or slug
     */
    async getJobById(identifier) {
        const query = `
            SELECT j.*, 
                   s.name as subcategory_name, s.slug as subcategory_slug,
                   c.name as category_name, c.slug as category_slug, c.color as category_color,
                   c.emoji as category_emoji
            FROM marketplace_jobs j
            JOIN marketplace_subcategories s ON j.subcategory_id = s.id
            JOIN marketplace_categories c ON j.category_id = c.id
            WHERE (j.id::text = $1 OR j.slug = $1) AND j.is_active = true;
        `;
        const result = await db.query(query, [identifier]);
        return result.rows[0] || null;
    }

    /**
     * Dynamic search across categories, subcategories, jobs, and keywords
     */
    async searchServices(searchTerm) {
        if (!searchTerm || !searchTerm.trim()) {
            return [];
        }

        const term = `%${searchTerm.trim().toLowerCase()}%`;
        const query = `
            SELECT 
                j.id as job_id,
                j.name as job_name,
                j.slug as job_slug,
                j.image_1x1,
                j.image_16x9,
                j.is_team_job,
                j.min_workers,
                j.max_workers,
                j.min_price,
                j.max_price,
                j.default_pricing_type,
                s.id as subcategory_id,
                s.name as subcategory_name,
                s.slug as subcategory_slug,
                c.id as category_id,
                c.name as category_name,
                c.slug as category_slug,
                c.color as category_color,
                c.emoji as category_emoji
            FROM marketplace_jobs j
            JOIN marketplace_subcategories s ON j.subcategory_id = s.id
            JOIN marketplace_categories c ON j.category_id = c.id
            WHERE j.is_active = true AND s.is_active = true AND c.is_active = true
              AND (
                LOWER(j.name) LIKE $1 
                OR LOWER(s.name) LIKE $1 
                OR LOWER(c.name) LIKE $1 
                OR LOWER(j.slug) LIKE $1 
                OR EXISTS (
                    SELECT 1 FROM unnest(j.keywords) kw WHERE LOWER(kw) LIKE $1
                )
              )
            ORDER BY 
              CASE WHEN LOWER(j.name) = LOWER($2) THEN 1 ELSE 2 END,
              c.sort_order ASC,
              j.name ASC
            LIMIT 30;
        `;

        const result = await db.query(query, [term, searchTerm.trim()]);
        return result.rows;
    }

    /**
     * Get overall marketplace analytics & category demand/supply
     */
    async getMarketplaceStats() {
        const categoryCountRes = await db.query('SELECT COUNT(*) FROM marketplace_categories WHERE is_active = true');
        const subcategoryCountRes = await db.query('SELECT COUNT(*) FROM marketplace_subcategories WHERE is_active = true');
        const jobCountRes = await db.query('SELECT COUNT(*) FROM marketplace_jobs WHERE is_active = true');
        const teamJobCountRes = await db.query('SELECT COUNT(*) FROM marketplace_jobs WHERE is_active = true AND is_team_job = true');
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
            totalJobs: parseInt(jobCountRes.rows[0].count, 10),
            totalTeamJobs: parseInt(teamJobCountRes.rows[0].count, 10),
            topBookedCategories: topBookedRes.rows
        };
    }
}

module.exports = new MarketplaceService();
