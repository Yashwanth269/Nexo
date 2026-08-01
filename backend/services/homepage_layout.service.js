const db = require('../config/db');
const redis = require('../config/redis');
const bannerService = require('./banner.service');
const marketplaceService = require('./marketplace.service');
const rankingService = require('./ranking.service');

class HomepageLayoutService {
    /**
     * Build backend-driven dynamic homepage section layout payload
     */
    async getDynamicLayout({ userLat, userLng, userId = null, city = 'ALL', userSegment = 'ALL' } = {}) {
        const cacheKey = `homepage:layout:${city}:${userSegment}:${userLat ? userLat.toFixed(2) : '0'}:${userLng ? userLng.toFixed(2) : '0'}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (_) {}

        // 1. Fetch active layout sections
        const layoutRes = await db.query(`
            SELECT s.id, s.section_type, s.title, s.subtitle, s.sort_order, s.metadata
            FROM homepage_sections s
            JOIN homepage_layouts l ON s.layout_id = l.id
            WHERE l.is_active = true AND s.is_enabled = true
            ORDER BY s.sort_order ASC;
        `);

        const rawSections = layoutRes.rows;

        // 2. Fetch section data payloads in parallel
        const [activeBanners, categories, topWorkers] = await Promise.all([
            bannerService.getActiveBanners({ city, userSegment }).catch(() => []),
            marketplaceService.getCategories().catch(() => []),
            userLat && userLng ? rankingService.getTopRatedWorkers(userLat, userLng, userId, null).catch(() => []) : Promise.resolve([])
        ]);

        // Static or Dynamic Data Payloads per Section Type
        const sections = [];

        for (const sec of rawSections) {
            let dataPayload = null;

            switch (sec.section_type) {
                case 'hero_banner':
                    dataPayload = activeBanners.length > 0 ? activeBanners : [
                        {
                            id: 'default_hero_1',
                            title: 'Trusted pros for every need!',
                            subtitle: 'Book fast. Pay safe.',
                            badge_text: 'SPECIAL OFFER',
                            cta_text: 'Book Now ->',
                            bg_color: '#FFF7ED',
                            text_color: '#1E293B',
                            target_action: 'OPEN_SEARCH',
                            action_payload: 'home services'
                        }
                    ];
                    break;

                case 'quick_actions':
                    dataPayload = [
                        { id: 'qa_1', label: 'Instant Book', icon: 'bolt', color: '#F97316', action: 'OPEN_CATEGORY', payload: 'Home Care' },
                        { id: 'qa_2', label: 'Near You', icon: 'location_on', color: '#10B981', action: 'OPEN_SEARCH', payload: 'nearby' },
                        { id: 'qa_3', label: 'Best Rated', icon: 'star', color: '#F59E0B', action: 'OPEN_SEARCH', payload: 'top_rated' },
                        { id: 'qa_4', label: 'Offers', icon: 'local_offer', color: '#EF4444', action: 'OPEN_OFFER', payload: 'deals' },
                        { id: 'qa_5', label: 'Home Repair', icon: 'build', color: '#DC2626', action: 'OPEN_CATEGORY', payload: 'Home Repair' },
                        { id: 'qa_6', label: 'My Jobs', icon: 'assignment', color: '#2563EB', action: 'OPEN_ACTION', payload: 'my_jobs' }
                    ];
                    break;
 
                case 'top_picks':
                    dataPayload = [
                        { name: 'Electrician', category: 'Home Repair', rating: 4.6, prosCount: '120+ pros', image: 'https://nexoassets.s3.ap-south-1.amazonaws.com/images/1:1/Electrician2.jpeg', action: 'OPEN_CATEGORY', payload: 'Electrician' },
                        { name: 'Plumber', category: 'Home Repair', rating: 4.7, prosCount: '95+ pros', image: 'https://nexoassets.s3.ap-south-1.amazonaws.com/images/1:1/Plumber2.jpeg', action: 'OPEN_CATEGORY', payload: 'Plumber' },
                        { name: 'Home Cleaning', category: 'Home Care', rating: 4.6, prosCount: '180+ pros', image: 'https://nexoassets.s3.ap-south-1.amazonaws.com/images/1:1/House%20Cleaning2.jpeg', action: 'OPEN_CATEGORY', payload: 'House Cleaning' },
                        { name: 'AC Repair', category: 'Appliance Repair', rating: 4.5, prosCount: '80+ pros', image: 'https://nexoassets.s3.ap-south-1.amazonaws.com/images/1:1/AC%20Repair2.jpeg', action: 'OPEN_CATEGORY', payload: 'AC Repair' },
                        { name: 'Car Wash', category: 'Automotive Services', rating: 4.6, prosCount: '60+ pros', image: 'https://nexoassets.s3.ap-south-1.amazonaws.com/images/1:1/Car%20Wash2.jpeg', action: 'OPEN_CATEGORY', payload: 'Car Wash' }
                    ];
                    break;
 
                case 'deals_and_events':
                    dataPayload = [
                        { id: 'deal_1', badge: 'MEGA SAVINGS', title: 'Up to 50% OFF', subtitle: 'On Home Care', bg_color: '#F3E8FF', text_color: '#6B21A8', action: 'OPEN_CATEGORY', payload: 'Home Care' },
                        { id: 'deal_2', badge: 'FESTIVAL', title: 'Care Bonanza', subtitle: 'Special offers for Festive season', bg_color: '#FEF3C7', text_color: '#92400E', action: 'OPEN_CATEGORY', payload: 'Home Care' },
                        { id: 'deal_3', badge: 'WEEKEND', title: 'Maintenance', subtitle: 'Flat 20% OFF on Repairs', bg_color: '#E0F2FE', text_color: '#075985', action: 'OPEN_CATEGORY', payload: 'Appliance Repair' }
                    ];
                    break;
 
                case 'all_categories':
                    dataPayload = categories.length > 0 ? categories : [
                        { name: 'Home Care', icon: 'home' },
                        { name: 'Home Repair', icon: 'build' },
                        { name: 'Appliance Repair', icon: 'kitchen' },
                        { name: 'Automotive Services', icon: 'directions_car' },
                        { name: 'Beauty & Wellness', icon: 'spa' }
                    ];
                    break;

                case 'top_workers':
                    dataPayload = topWorkers;
                    break;

                case 'promo_toast':
                    dataPayload = {
                        title: 'Get FREE delivery',
                        subtitle: 'on your first booking above ₹199',
                        cta_text: 'Apply ->',
                        action: 'OPEN_OFFER',
                        payload: 'FREE_DELIVERY'
                    };
                    break;

                default:
                    dataPayload = sec.metadata || {};
                    break;
            }

            sections.push({
                id: sec.id,
                type: sec.section_type,
                title: sec.title,
                subtitle: sec.subtitle,
                sortOrder: sec.sort_order,
                data: dataPayload
            });
        }

        const payload = {
            success: true,
            layoutVersion: 1,
            sections,
            generatedAt: new Date().toISOString()
        };

        try {
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', 120);
        } catch (_) {}

        return payload;
    }
}

module.exports = new HomepageLayoutService();
