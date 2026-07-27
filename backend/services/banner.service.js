const db = require('../config/db');
const redis = require('../config/redis');

class BannerService {
    /**
     * Get active banners matching scheduling, geo-targeting, and user segmentation
     */
    async getActiveBanners({ city = 'ALL', userSegment = 'ALL' } = {}) {
        const cacheKey = `banner:active:${city}:${userSegment}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (_) {}

        const query = `
            SELECT id, title, subtitle, description, cta_text, image_url, bg_color, text_color, badge_text,
                   target_action, action_payload, priority, start_at, end_at
            FROM banner_campaigns
            WHERE is_active = true
              AND start_at <= CURRENT_TIMESTAMP
              AND end_at >= CURRENT_TIMESTAMP
              AND ('ALL' = ANY(target_cities) OR $1 = ANY(target_cities))
              AND ('ALL' = ANY(target_user_segments) OR $2 = ANY(target_user_segments))
            ORDER BY priority ASC, created_at DESC;
        `;

        const result = await db.query(query, [city, userSegment]);
        const banners = result.rows;

        try {
            await redis.set(cacheKey, JSON.stringify(banners), 'EX', 120); // 2 min cache
        } catch (_) {}

        return banners;
    }

    /**
     * Track Banner Impression
     */
    async trackImpression(bannerId, userId = null, city = 'ALL') {
        try {
            await db.query(
                `INSERT INTO banner_impressions (banner_id, user_id, city) VALUES ($1, $2, $3)`,
                [bannerId, userId, city]
            );
        } catch (err) {
            console.warn('[BANNER_TRACK] Impression track failed:', err.message);
        }
    }

    /**
     * Track Banner Click
     */
    async trackClick(bannerId, userId = null, action = 'OPEN_SEARCH', actionPayload = '', city = 'ALL') {
        try {
            await db.query(
                `INSERT INTO banner_clicks (banner_id, user_id, action, action_payload, city) VALUES ($1, $2, $3, $4, $5)`,
                [bannerId, userId, action, actionPayload, city]
            );
        } catch (err) {
            console.warn('[BANNER_TRACK] Click track failed:', err.message);
        }
    }

    /**
     * Admin: Create New Banner Campaign
     */
    async createBanner(bannerData) {
        const { title, subtitle, description, ctaText, imageUrl, bgColor, textColor, badgeText, targetAction, actionPayload, priority, startAt, endAt, targetCities, targetUserSegments } = bannerData;

        const query = `
            INSERT INTO banner_campaigns 
                (title, subtitle, description, cta_text, image_url, bg_color, text_color, badge_text, target_action, action_payload, priority, start_at, end_at, target_cities, target_user_segments, is_active)
            VALUES 
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, CURRENT_TIMESTAMP), COALESCE($13, CURRENT_TIMESTAMP + INTERVAL '1 year'), $14, $15, true)
            RETURNING *;
        `;

        const result = await db.query(query, [
            title, subtitle || null, description || null, ctaText || 'Book Now ->', imageUrl || null,
            bgColor || '#FFF7ED', textColor || '#1E293B', badgeText || null, targetAction || 'OPEN_SEARCH',
            actionPayload || null, priority || 1, startAt || null, endAt || null,
            targetCities || ['ALL'], targetUserSegments || ['ALL']
        ]);

        await this._invalidateBannerCache();
        return result.rows[0];
    }

    /**
     * Admin: Update Banner Campaign
     */
    async updateBanner(id, bannerData) {
        const { title, subtitle, ctaText, imageUrl, bgColor, textColor, badgeText, targetAction, actionPayload, priority, isActive } = bannerData;

        const query = `
            UPDATE banner_campaigns SET
                title = COALESCE($1, title),
                subtitle = COALESCE($2, subtitle),
                cta_text = COALESCE($3, cta_text),
                image_url = COALESCE($4, image_url),
                bg_color = COALESCE($5, bg_color),
                text_color = COALESCE($6, text_color),
                badge_text = COALESCE($7, badge_text),
                target_action = COALESCE($8, target_action),
                action_payload = COALESCE($9, action_payload),
                priority = COALESCE($10, priority),
                is_active = COALESCE($11, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
            RETURNING *;
        `;

        const result = await db.query(query, [title, subtitle, ctaText, imageUrl, bgColor, textColor, badgeText, targetAction, actionPayload, priority, isActive, id]);
        await this._invalidateBannerCache();
        return result.rows[0];
    }

    async _invalidateBannerCache() {
        try {
            const keys = await redis.keys('banner:active:*');
            if (keys.length > 0) await redis.del(...keys);
        } catch (_) {}
    }
}

module.exports = new BannerService();
