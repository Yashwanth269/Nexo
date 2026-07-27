const db = require('../config/db');

async function seedHomepageCMS() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create normalized tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS homepage_layouts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL UNIQUE,
        version INT DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        ab_split_pct INT DEFAULT 100,
        target_user_segment VARCHAR(50) DEFAULT 'ALL',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS homepage_sections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        layout_id UUID REFERENCES homepage_layouts(id) ON DELETE CASCADE,
        section_type VARCHAR(50) NOT NULL,
        title VARCHAR(100),
        subtitle VARCHAR(150),
        sort_order INT DEFAULT 0,
        is_enabled BOOLEAN DEFAULT true,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS banner_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(150) NOT NULL,
        subtitle VARCHAR(200),
        description TEXT,
        cta_text VARCHAR(50) DEFAULT 'Book Now ->',
        image_url TEXT,
        bg_color VARCHAR(30) DEFAULT '#FFF7ED',
        text_color VARCHAR(30) DEFAULT '#1E293B',
        badge_text VARCHAR(50),
        target_action VARCHAR(50) DEFAULT 'OPEN_SEARCH',
        action_payload TEXT,
        priority INT DEFAULT 1,
        start_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        end_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 year'),
        target_cities TEXT[] DEFAULT ARRAY['ALL'],
        target_user_segments TEXT[] DEFAULT ARRAY['ALL'],
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS homepage_collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        banner_image TEXT,
        item_type VARCHAR(50) DEFAULT 'SUBCATEGORY',
        target_items TEXT[] DEFAULT ARRAY[]::TEXT[],
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS banner_impressions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        banner_id UUID REFERENCES banner_campaigns(id) ON DELETE CASCADE,
        user_id VARCHAR(100),
        city VARCHAR(100),
        device_type VARCHAR(50) DEFAULT 'MOBILE',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS banner_clicks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        banner_id UUID REFERENCES banner_campaigns(id) ON DELETE CASCADE,
        user_id VARCHAR(100),
        action VARCHAR(50),
        action_payload TEXT,
        city VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feature_flags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        flag_key VARCHAR(100) NOT NULL UNIQUE,
        is_enabled BOOLEAN DEFAULT true,
        description TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Insert Default Homepage Layout
    const layoutRes = await client.query(`
      INSERT INTO homepage_layouts (name, version, is_active)
      VALUES ('Default Adaptive Production Layout', 1, true)
      ON CONFLICT (name) DO UPDATE SET is_active = true, updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `);
    const layoutId = layoutRes.rows[0].id;

    // 3. Insert Homepage Sections
    const SECTIONS = [
      { type: 'hero_banner', title: 'Featured Promotions', sort: 1 },
      { type: 'quick_actions', title: 'Quick Actions', sort: 2 },
      { type: 'top_picks', title: 'Top Picks', subtitle: 'Most booked services near you', sort: 3 },
      { type: 'deals_and_events', title: 'Deals & Events', subtitle: 'Exclusive festive offers', sort: 4 },
      { type: 'all_categories', title: 'All Categories', subtitle: 'Browse by vertical', sort: 5 },
      { type: 'promo_toast', title: 'First Order Offer', sort: 6 }
    ];

    for (const sec of SECTIONS) {
      await client.query(`
        INSERT INTO homepage_sections (layout_id, section_type, title, subtitle, sort_order, is_enabled)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT DO NOTHING;
      `, [layoutId, sec.type, sec.title, sec.subtitle || null, sec.sort]);
    }

    // 4. Insert Default Hero Banner Campaigns
    const BANNERS = [
      {
        title: 'Trusted pros for every need!',
        subtitle: 'Book fast. Pay safe.',
        badge_text: 'SPECIAL OFFER',
        cta_text: 'Book Now ->',
        bg_color: '#FFF7ED',
        text_color: '#1E293B',
        target_action: 'OPEN_SEARCH',
        action_payload: 'home services',
        priority: 1
      },
      {
        title: 'Festive Care Bonanza',
        subtitle: 'Up to 40% OFF on Home & Appliance Services',
        badge_text: 'FESTIVAL',
        cta_text: 'Explore Deals ->',
        bg_color: '#FEF3C7',
        text_color: '#78350F',
        target_action: 'OPEN_CATEGORY',
        action_payload: 'Home Services',
        priority: 2
      },
      {
        title: '24/7 Emergency Services',
        subtitle: 'Arrival under 15 minutes guaranteed',
        badge_text: 'EMERGENCY',
        cta_text: 'Book Emergency ->',
        bg_color: '#FEF2F2',
        text_color: '#991B1B',
        target_action: 'OPEN_CATEGORY',
        action_payload: 'Emergency',
        priority: 3
      }
    ];

    for (const b of BANNERS) {
      await client.query(`
        INSERT INTO banner_campaigns (title, subtitle, badge_text, cta_text, bg_color, text_color, target_action, action_payload, priority, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        ON CONFLICT DO NOTHING;
      `, [b.title, b.subtitle, b.badge_text, b.cta_text, b.bg_color, b.text_color, b.target_action, b.action_payload, b.priority]);
    }

    // 5. Feature Flags
    await client.query(`
      INSERT INTO feature_flags (flag_name, enabled, description)
      VALUES 
        ('DYNAMIC_HOMEPAGE_ENGINE', true, 'Enable backend-driven dynamic section layout engine'),
        ('HERO_CAROUSEL_AUTOPLAY', true, 'Auto-rotate hero banners every 4 seconds'),
        ('AI_RECOMMENDATIONS_HOMEPAGE', true, 'Show personalized AI service recommendations')
      ON CONFLICT (flag_name) DO UPDATE SET enabled = true;
    `);

    await client.query('COMMIT');
    console.log('✅ [HOMEPAGE_CMS] Successfully seeded Homepage Layout Engine, Banners, and Feature Flags.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [HOMEPAGE_CMS_ERROR]', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedHomepageCMS().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { seedHomepageCMS };
