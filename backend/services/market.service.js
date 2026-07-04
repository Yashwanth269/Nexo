/**
 * ═══════════════════════════════════════════════════════════════════
 *  PRODUCTION-GRADE REALTIME TRENDING ENGINE
 *  Shramik Shakti — Market Intelligence Service v3.0
 *
 *  Architecture:
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  Job / Worker Events ──► Redis Streams ──► Async Consumer   │
 *  │                                            │                │
 *  │  GET /trending ─► Redis geo-cache (TTL 3 min)               │
 *  │                    └─► Database SQL Query Engine            │
 *  │                         • B-Tree Indexed Bounding Boxes     │
 *  │                         • Mathematical Haversine in DB      │
 *  │                         • Exponential Decay Demand Scores   │
 *  │                         • Time-Segment Boosting             │
 *  │                         • Saturation Decay (Redis hash)     │
 *  │                         • Anti-Fraud unique devices         │
 *  │                         • Predictive Demand Forecast        │
 *  │                         • Personalization Overlay           │
 *  └─────────────────────────────────────────────────────────────┘
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

const { haversineDistance } = require('../utils/geo.utils');
const { logEvent } = require('./ml_events.service');
const { trendingCacheKey, districtCacheKey, cityCacheKey } = require('./geo_hash.service');
const redis = require('../config/redis');
const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const RADIUS_KM              = 7;
const DISTRICT_RADIUS_KM     = 30;
const CACHE_TTL_SECONDS      = 180;          // 3 minutes
const TREND_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const VELOCITY_CAP           = 50;           // max requests/hr per category
const EXPLORATION_INJECT_PCT = 0.15;         // 15% slots for emerging category injection
const CONFIDENCE_SATURATION  = 40;           // confidence saturates at 40 data points

// Trend score formula weights (sum = 1.0)
const WEIGHTS = {
    bookingVelocity   : 0.35,
    requests24h       : 0.20,
    realtimeGrowth    : 0.20,
    completionVolume  : 0.15,
    supplyPressure    : 0.05,
    activeWorkers     : 0.05,
};

// All valid service categories in the system
const ALL_CATEGORIES = [
    'Agriculture', 'Construction', 'Delivery', 'Events',
    'Home Services', 'Household', 'Mechanic', 'Shops',
    'Skilled', 'Smart Tech', 'Transport',
    'Electrical', 'Plumbing', 'Cleaning', 'Painting', 'AC Repair',
    'Labour', 'Security', 'Healthcare',
];

// Rural-indicator categories
const RURAL_INDICATORS  = new Set(['Agriculture', 'Labour', 'Transport', 'Construction']);
const URBAN_INDICATORS  = new Set(['Electrical', 'Plumbing', 'Cleaning', 'Smart Tech', 'AC Repair', 'Events', 'Household']);

// ─────────────────────────────────────────────────────────────────────────────
//  TIME-DECAY & TIME SEGMENT BOOSTS
// ─────────────────────────────────────────────────────────────────────────────
const DECAY_LAMBDA = Math.LN2 / 2; // half-life = 2 hours (0.34657359)

const getTimeSegment = (hour) => {
    if (hour >= 4  && hour < 7)  return 'dawn';
    if (hour >= 7  && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    if (hour >= 21 && hour < 24) return 'night';
    return 'latenight';
};

const SEGMENT_BOOSTS = {
    dawn       : { Agriculture: 1.6, Labour: 1.4, Transport: 1.3, Delivery: 1.2 },
    morning    : { Cleaning: 1.5, Household: 1.4, Agriculture: 1.3, Construction: 1.3, Healthcare: 1.2 },
    afternoon  : { Labour: 1.4, Agriculture: 1.3, Construction: 1.3, Delivery: 1.2, Transport: 1.2 },
    evening    : { Electrical: 1.5, 'AC Repair': 1.5, Plumbing: 1.3, Mechanic: 1.2, 'Home Services': 1.3, Events: 1.2 },
    night      : { Delivery: 1.5, Security: 1.4, Electrical: 1.2, Mechanic: 1.2 },
    latenight  : { Delivery: 1.3, Security: 1.5 },
};

// SQL Queries for Spatial Search using PostGIS
const jobsQuery = `
    WITH geo_jobs AS (
        SELECT 
            category,
            created_at,
            status,
            earth_distance(ll_to_earth($1::double precision, $2::double precision), location_cube) / 1000.0 AS distance
        FROM jobs
        WHERE 
            location_cube IS NOT NULL
            AND earth_distance(ll_to_earth($1::double precision, $2::double precision), location_cube) / 1000.0 <= $3::double precision
            AND created_at >= NOW() - INTERVAL '24 hours'
    )
    SELECT 
        category,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '15 minutes' THEN 1 END) AS count_15m,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '1 hour' THEN 1 END) AS count_1h,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '4 hours' THEN 1 END) AS count_4h,
        COUNT(1) AS count_24h,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_24h,
        SUM(EXP(-0.34657359 * (EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0))) AS decay_demand,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '1 hour' AND created_at < NOW() - INTERVAL '15 minutes' THEN 1 END) AS count_prev_45m
    FROM geo_jobs 
    WHERE distance <= $3::double precision
    GROUP BY category
`;

const workersQuery = `
    WITH geo_workers AS (
        SELECT 
            skills
        FROM workers
        WHERE 
            is_online = true 
            AND is_available = true
            AND location_cube IS NOT NULL
            AND earth_distance(ll_to_earth($1::double precision, $2::double precision), location_cube) / 1000.0 <= $3::double precision
    )
    SELECT 
        c.category,
        COUNT(w.skills) AS active_workers
    FROM (SELECT unnest($4::text[]) AS category) c
    LEFT JOIN geo_workers w ON EXISTS (
        SELECT 1 FROM unnest(w.skills) s 
        WHERE LOWER(s) LIKE LOWER('%' || c.category || '%') 
           OR LOWER(c.category) LIKE LOWER('%' || s || '%')
    )
    GROUP BY c.category
`;

// ─────────────────────────────────────────────────────────────────────────────
//  STARTUP CACHE WARMER
// ─────────────────────────────────────────────────────────────────────────────
const refreshTrendStore = async () => {
    try {
        console.log("🌊 [POPULAR_CATEGORIES] Startup trend cache warming beginning...");
        const jobLocs = await db.query(
            "SELECT DISTINCT location_lat, location_lng FROM jobs WHERE created_at > NOW() - INTERVAL '24 hours' LIMIT 50"
        );
        const workerLocs = await db.query(
            "SELECT DISTINCT current_lat, current_lng FROM workers WHERE is_online = true AND current_lat IS NOT NULL LIMIT 50"
        );

        const seenHashes = new Set();
        const locations = [];

        for (const row of [...jobLocs.rows, ...workerLocs.rows]) {
            const lat = parseFloat(row.location_lat || row.current_lat);
            const lng = parseFloat(row.location_lng || row.current_lng);
            if (!isNaN(lat) && !isNaN(lng)) {
                const geoKey6 = require('./geo_hash.service').encode(lat, lng, 6);
                if (!seenHashes.has(geoKey6)) {
                    seenHashes.add(geoKey6);
                    locations.push({ lat, lng });
                }
            }
        }

        for (const loc of locations) {
            await getTrendingCategories(loc.lat, loc.lng, null, { bypassCache: true }).catch(() => {});
        }

        console.log(`✅ [POPULAR_CATEGORIES] Trend store warmed up successfully for ${locations.length} coordinates.`);
    } catch (err) {
        console.error('[POPULAR_CATEGORIES] Trend store warmup error:', err.message);
    }
};

// Run boot warmup task
setTimeout(refreshTrendStore, 5000);

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIDENCE & SATURATION SCORE MATH
// ─────────────────────────────────────────────────────────────────────────────
const computeConfidence = (localJobCount, activeWorkerCount) => {
    const dataPts = localJobCount + activeWorkerCount * 2;
    return Math.min(1.0, dataPts / CONFIDENCE_SATURATION);
};

const getHistoricalHourlyAvg = async (category, hour, userLat, userLng, radius) => {
    try {
        const q = `
            SELECT COUNT(*) AS count
            FROM jobs
            WHERE 
                category = $1
                AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') = $2::integer
                AND created_at >= NOW() - INTERVAL '7 days'
                AND earth_distance(ll_to_earth($3::double precision, $4::double precision), location_cube) / 1000.0 <= $5::double precision
        `;
        const res = await db.query(q, [category, hour, userLat, userLng, radius]);
        const total = parseInt(res.rows[0].count || 0);
        return total / 7.0;
    } catch (err) {
        console.error('Error in getHistoricalHourlyAvg:', err.message);
        return 0;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  SEARCH INTENT TRACKER (Redis Hash + Anti-Poisoning unique sets)
// ─────────────────────────────────────────────────────────────────────────────
const trackSearchIntent = async (geoHash6, category, ip = 'unknown', fingerprint = 'unknown') => {
    try {
        const deviceKey = `intent_devices:${geoHash6}:${category}`;
        const deviceId = `${ip}:${fingerprint}`;

        const isDuplicate = await redis.sismember(deviceKey, deviceId);
        if (isDuplicate) {
            console.log(`[ANTI-POISONING] Duplicate intent rejected for category ${category} in ${geoHash6} from ${deviceId}`);
            return;
        }

        await redis.sadd(deviceKey, deviceId);
        await redis.expire(deviceKey, 3600); // 1 hour device TTL

        const intentKey = `search_intent:${geoHash6}`;
        await redis.hincrby(intentKey, category, 1);
        await redis.expire(intentKey, 7200); // 2 hours intent score TTL
    } catch (err) {
        console.warn('[SEARCH_INTENT] Tracker failed:', err.message);
    }
};

const getSearchIntentScore = async (geoHash6, category) => {
    try {
        const intentKey = `search_intent:${geoHash6}`;
        const count = await redis.hget(intentKey, category);
        return Math.min(parseInt(count || 0) / 20, 1.0);
    } catch (err) {
        return 0.0;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  SATURATION DECAY (Redis Cooldown mapping)
// ─────────────────────────────────────────────────────────────────────────────
const getSaturationMultiplier = async (category) => {
    try {
        const key = `cooldown:${category}`;
        const cached = await redis.get(key);
        if (!cached) return 1.0;

        const entry = JSON.parse(cached);
        const ageMs = Date.now() - entry.since;
        return Math.max(0.65, 1.0 - (ageMs / (20 * 60_000)) * 0.35); // 1.0 -> 0.65 over 20 min
    } catch (err) {
        return 1.0;
    }
};

const updateCooldown = async (category, score) => {
    try {
        const key = `cooldown:${category}`;
        const cached = await redis.get(key);
        if (!cached) {
            await redis.set(key, JSON.stringify({ score, since: Date.now() }), 'EX', 1800);
        } else {
            const entry = JSON.parse(cached);
            if (score < entry.score * 0.8) {
                await redis.del(key);
            }
        }
    } catch (err) {
        console.warn('[COOLDOWN_MAP] Failed to update:', err.message);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  BADGE GENERATOR & SOFT EXPLORATION INJECTOR
// ─────────────────────────────────────────────────────────────────────────────
const generateBadges = ({ trendScore, growthPct, activeWorkers, reqCount1h, supplyPressure, confidence, isHotZone }) => {
    const tags = [];
    let primaryBadge     = '';
    let primaryBadgeType = 'TRENDING';

    if (trendScore >= 0.80 && isHotZone) {
        primaryBadge     = '🔥 HOT RIGHT NOW';
        primaryBadgeType = 'HOT';
        tags.push({ text: '🔥 HOT RIGHT NOW',  bg: '#FFF1F2', fg: '#E11D48' });
    } else if (growthPct >= 80) {
        primaryBadge     = '🚀 RISING FAST';
        primaryBadgeType = 'RISING';
        tags.push({ text: '🚀 RISING FAST',    bg: '#ECFDF5', fg: '#059669' });
    } else if (supplyPressure >= 0.7) {
        primaryBadge     = '⚡ HIGH DEMAND';
        primaryBadgeType = 'HIGH_DEMAND';
        tags.push({ text: '⚡ HIGH DEMAND',    bg: '#FEF3C7', fg: '#D97706' });
    } else if (trendScore >= 0.55) {
        primaryBadge     = '📈 TRENDING NEARBY';
        primaryBadgeType = 'TRENDING';
        tags.push({ text: '📈 TRENDING NEARBY', bg: '#EFF6FF', fg: '#2563EB' });
    } else {
        primaryBadge     = '⭐ POPULAR';
        primaryBadgeType = 'POPULAR';
        tags.push({ text: '⭐ POPULAR',         bg: '#F5F3FF', fg: '#7C3AED' });
    }

    if (growthPct >= 40)       tags.push({ text: `📈 +${Math.round(growthPct)}% GROWTH`,       bg: '#ECFDF5', fg: '#059669' });
    if (activeWorkers >= 10)   tags.push({ text: `👷 ${activeWorkers} ACTIVE`,                  bg: '#EFF6FF', fg: '#2563EB' });
    if (activeWorkers <= 3 && reqCount1h >= 5)
                               tags.push({ text: '🔴 ONLY FEW WORKERS',                          bg: '#FFF1F2', fg: '#E11D48' });
    if (confidence >= 0.85)    tags.push({ text: '✅ VERIFIED TREND',                            bg: '#ECFDF5', fg: '#059669' });
    if (reqCount1h >= 20)      tags.push({ text: `⚡ ${reqCount1h} BOOKINGS/HOUR`,               bg: '#FFF7ED', fg: '#EA580C' });

    return { primaryBadge, primaryBadgeType, tags };
};

const formatResult = (r, rank) => {
    const { primaryBadge, primaryBadgeType, tags } = generateBadges({
        trendScore    : r.trendScore,
        growthPct     : r.growthPct,
        activeWorkers : r.activeWorkers,
        reqCount1h    : r.reqCount1h,
        supplyPressure: r.supplyPressure,
        confidence    : r.confidence,
        isHotZone     : r.isHotZone,
    });

    const reqCountText   = r.reqCount24h > 0
        ? `${r.reqCount24h} requests today`
        : `Trending in your area`;
    const growthText     = r.growthPct > 5
        ? `+${Math.round(r.growthPct)}% this ${r.segment}`
        : r.reqCount15m > 0
            ? `${r.reqCount15m} requests in last 15 min`
            : 'Active nearby';
    const workersText    = r.activeWorkers > 0
        ? `${r.activeWorkers} worker${r.activeWorkers === 1 ? '' : 's'} active`
        : 'No workers currently online';
    const workerShortage = r.activeWorkers <= 2 && r.reqCount1h >= 5;

    // No synthetic tag padding — only real tags are shown

    return {
        name             : r.category,
        rank             : `#${rank} Rank`,
        trendScore       : parseFloat(r.trendScore.toFixed(3)),
        confidence       : parseFloat(r.confidence.toFixed(2)),
        badge            : primaryBadge,
        badgeType        : primaryBadgeType,
        tags,
        reqCountText,
        reqCountToday    : r.reqCount24h,
        growthText,
        growthPct        : Math.round(r.growthPct),
        activeWorkers    : r.activeWorkers,
        activeWorkersText: workersText,
        workerShortage,
        completionRate   : Math.round(r.completionRate),
        avgResponseMinutes: r.avgResponseMinutes,
        isHotZone        : r.isHotZone,
        isExploration    : r.isExploration || false,
        isFallback       : r.isFallback || false,
        areaType         : r.areaType,
        segment          : r.segment,
        userBoosted      : r.userBoosted || false,
        reqCount: `${r.reqCount24h} requests today`,
        detailRow2: workersText,
        detailIcon: 'circle',
        detailIconColor: r.activeWorkers > 0 ? '#10B981' : '#94A3B8',
        detailRow3: `${Math.round(r.completionRate)}% completion rate`,
        detailRow3Icon: 'check_circle_outline_rounded',
        detailRow3IconColor: '#3B82F6',
        bookedToday: `${Math.max(r.reqCount1h, 0)} booked this hour`,
        usersBooked: r.reqCount24h > 0 ? `${r.reqCount24h} requests today` : 'Trending',
        avgPrice: 'See prices',
        satisfaction: `${Math.round(r.completionRate || 75)}% satisfaction`,
        responseTime: `~${r.avgResponseMinutes} min response`,
    };
};

// buildFallbackTrends removed — no synthetic trending data.
// If computeRegionTrends returns no data, the endpoint returns an empty array.

const injectExploration = (topResults, allResults, n) => {
    const topCats = new Set(topResults.map(r => r.category));
    const emergingPool = allResults
        .filter(r => !topCats.has(r.category) && r.trendScore > 0.1)
        .sort((a, b) => b.trendScore - a.trendScore);

    const explorationSlots = Math.max(1, Math.round(n * EXPLORATION_INJECT_PCT));
    const topSlots = n - explorationSlots;

    const final = [...topResults.slice(0, topSlots)];
    emergingPool.slice(0, explorationSlots).forEach(r => {
        final.push({ ...r, isExploration: true });
    });
    return final;
};

// ─────────────────────────────────────────────────────────────────────────────
//  CORE: COMPUTE TREND SCORES FOR A REGION (Postgres/Redis Powered)
// ─────────────────────────────────────────────────────────────────────────────
const computeRegionTrends = async (userLat, userLng, userId, userHistory = {}) => {
    const now        = Date.now();
    const hour       = new Date().getHours();
    const segment    = getTimeSegment(hour);
    const segBoosts  = SEGMENT_BOOSTS[segment] || {};
    const geoKey6    = require('./geo_hash.service').encode(userLat, userLng, 6);

    let radius = RADIUS_KM;

    let jobsRes = await db.query(jobsQuery, [userLat, userLng, radius]);

    if (jobsRes.rowCount < 3) {
        console.log(`[POPULAR_CATEGORIES] Insufficient hyperlocal data. Expanding to ${DISTRICT_RADIUS_KM}km radius...`);
        radius = DISTRICT_RADIUS_KM;
        jobsRes = await db.query(jobsQuery, [userLat, userLng, radius]);
    }

    const jobStats = {};
    for (const row of jobsRes.rows) {
        jobStats[row.category] = {
            count15m: parseInt(row.count_15m || 0),
            count1h: parseInt(row.count_1h || 0),
            count4h: parseInt(row.count_4h || 0),
            count24h: parseInt(row.count_24h || 0),
            completed24h: parseInt(row.completed_24h || 0),
            decayWeightedDemand: parseFloat(row.decay_demand || 0),
            countPrev45m: parseInt(row.count_prev_45m || 0)
        };
    }

    const localCats = Object.keys(jobStats);
    const catsToScore = localCats.length >= 3 ? localCats : ALL_CATEGORIES;

    const workersRes = await db.query(workersQuery, [userLat, userLng, radius, catsToScore]);
    const workerCounts = {};
    for (const row of workersRes.rows) {
        workerCounts[row.category] = parseInt(row.active_workers || 0);
    }

    let ruralCount = 0, urbanCount = 0;
    for (const cat of localCats) {
        const count = jobStats[cat].count24h;
        if (RURAL_INDICATORS.has(cat)) ruralCount += count;
        if (URBAN_INDICATORS.has(cat)) urbanCount += count;
    }
    const areaType = ruralCount === 0 && urbanCount === 0 ? 'mixed' : (ruralCount > urbanCount ? 'rural' : 'urban');

    const maxCatJobs24h = Math.max(...catsToScore.map(c => jobStats[c]?.count24h || 0), 1);

    const results = [];

    for (const cat of catsToScore) {
        const stats = jobStats[cat] || { count15m: 0, count1h: 0, count4h: 0, count24h: 0, completed24h: 0, decayWeightedDemand: 0, countPrev45m: 0 };
        const activeWorkers = workerCounts[cat] || 0;

        if (stats.count24h === 0 && !ALL_CATEGORIES.includes(cat)) continue;

        const bookingVelocity = stats.count1h / Math.max(stats.count4h / 4, 1);
        const requests24hNorm = stats.count24h / maxCatJobs24h;

        const prevRate = stats.countPrev45m / 45;
        const currRate = stats.count15m / 15;
        const acceleration = prevRate > 0 ? (currRate - prevRate) / prevRate : (currRate > 0 ? 1 : 0);
        const accelerationNorm = Math.min(Math.max(acceleration, 0), 2) / 2;

        const baselineHourly = stats.count4h / 4;
        const growthPct = baselineHourly > 0
            ? ((stats.count1h - baselineHourly) / baselineHourly) * 100
            : (stats.count1h > 0 ? 100 : 0);
        const growthNorm = Math.min(Math.max(growthPct, 0), 200) / 200;

        const completionVolumeNorm = stats.count24h > 0
            ? stats.completed24h / stats.count24h
            : 0;

        const supplyPressure = stats.count1h / Math.max(activeWorkers, 1);
        const supplyPressureNorm = Math.min(supplyPressure / 10, 1);

        const intentScore = await getSearchIntentScore(geoKey6, cat);

        const predictedHourlyAvg = await getHistoricalHourlyAvg(cat, hour, userLat, userLng, radius);
        const predictiveUplift = predictedHourlyAvg > 0
            ? Math.min(stats.count1h / (predictedHourlyAvg + 0.1), 2) / 2
            : 0;

        const userAffinityBoost = (userHistory[cat] || 0) > 0
            ? Math.min((userHistory[cat] || 0) / 5, 0.15)
            : 0;

        const confidence = computeConfidence(stats.count24h, activeWorkers);
        const segmentBoost = segBoosts[cat] || 1.0;
        const saturationMult = await getSaturationMultiplier(cat);

        const rawScore = (
            WEIGHTS.bookingVelocity  * Math.min(bookingVelocity, 1) +
            WEIGHTS.requests24h      * requests24hNorm +
            WEIGHTS.realtimeGrowth   * (growthNorm * 0.6 + accelerationNorm * 0.4) +
            WEIGHTS.completionVolume * completionVolumeNorm +
            WEIGHTS.supplyPressure   * supplyPressureNorm +
            WEIGHTS.activeWorkers    * Math.min(activeWorkers / 15, 1)
        );

        const trendScore = Math.min(
            rawScore * segmentBoost * saturationMult * (1 + confidence * 0.2) +
            intentScore * 0.08 +
            predictiveUplift * 0.05 +
            userAffinityBoost,
            1.0
        );

        const isHotZone = trendScore >= 0.65 && stats.count15m >= 3;
        const freshnessScore = stats.count15m >= 2 ? trendScore * 1.2 : trendScore;

        if (trendScore > 0.05 || stats.count24h > 0) {
            results.push({
                category: cat,
                trendScore,
                freshnessScore,
                confidence,
                areaType,
                segment,
                reqCount1h: stats.count1h,
                reqCount15m: stats.count15m,
                reqCount24h: stats.count24h,
                growthPct,
                activeWorkers,
                completionRate: completionVolumeNorm * 100,
                supplyPressure,
                avgResponseMinutes: Math.round(3 + (1 - confidence) * 10),
                isHotZone,
                predictedHourlyAvg,
                userBoosted: userAffinityBoost > 0,
            });
        }
    }

    results.sort((a, b) => b.freshnessScore - a.freshnessScore);

    for (const r of results.slice(0, 3)) {
        await updateCooldown(r.category, r.trendScore);
    }

    return results;
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API: getTrendingCategories
// ─────────────────────────────────────────────────────────────────────────────
const getTrendingCategories = async (userLat, userLng, userId = null, options = {}) => {
    const limit       = options.limit || 6;
    const bypassCache = options.bypassCache || false;
    const now         = Date.now();
    const hour        = new Date().getHours();
    const segment     = getTimeSegment(hour);
    const cacheKey    = trendingCacheKey(userLat, userLng);

    if (!bypassCache) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                console.log(`[POPULAR_CATEGORIES] Cache HIT for ${cacheKey}`);
                logEvent(userId, 'TRENDING_VIEWED', { userLat, userLng, cached: true, trends: parsed.trending.map(t => t.name) });
                return { ...parsed, meta: { ...parsed.meta, cached: true } };
            }
        } catch (cacheErr) {
            console.warn('[POPULAR_CATEGORIES] Redis cache read error:', cacheErr.message);
        }
    }

    let userHistory = {};
    if (userId) {
        try {
            let userUuid = userId;
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
                const userRes = await db.query("SELECT id FROM users WHERE phone_number = $1", [userId]);
                if (userRes.rowCount > 0) userUuid = userRes.rows[0].id;
            }
            const res = await db.query(
                "SELECT category, COUNT(*) as count FROM jobs WHERE user_id = $1::uuid GROUP BY category",
                [userUuid]
            );
            for (const row of res.rows) {
                userHistory[row.category] = parseInt(row.count);
            }
        } catch (_) {}
    }

    let allResults = await computeRegionTrends(userLat, userLng, userId, userHistory);
    const areaType = allResults[0]?.areaType || 'mixed';

    if (allResults.length === 0) {
        console.log(`[POPULAR_CATEGORIES] No trending data available for segment=${segment}, area=${areaType}`);
        // Return empty results — no synthetic data
    }

    const topResults  = allResults.slice(0, Math.ceil(limit * (1 - EXPLORATION_INJECT_PCT)));
    const finalList   = injectExploration(topResults, allResults, limit);

    const trending = finalList.slice(0, limit).map((r, i) => formatResult(r, i + 1));

    const payload = {
        success : true,
        trending,
        meta: {
            segment,
            areaType,
            radius    : RADIUS_KM,
            generatedAt: new Date().toISOString(),
            cached    : false,
            cacheTtlSeconds: CACHE_TTL_SECONDS,
            storeAge  : 0,
        },
    };

    try {
        await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
        console.log(`[POPULAR_CATEGORIES] Cached result for ${cacheKey} (TTL=${CACHE_TTL_SECONDS}s)`);
    } catch (cacheErr) {
        console.warn('[POPULAR_CATEGORIES] Redis cache write error:', cacheErr.message);
    }

    console.log(`[POPULAR_CATEGORIES] Result: ${trending.map(t => `${t.name}(${t.trendScore})`).join(', ')}`);
    logEvent(userId, 'TRENDING_VIEWED', {
        userLat, userLng,
        segment, areaType,
        trends: trending.map(t => ({ name: t.name, score: t.trendScore, badge: t.badge })),
    });

    return payload;
};

// ─────────────────────────────────────────────────────────────────────────────
//  CACHE INVALIDATION
// ─────────────────────────────────────────────────────────────────────────────
const invalidateTrendCache = async (lat, lng) => {
    try {
        const keys = [
            trendingCacheKey(lat, lng, 6),
            districtCacheKey(lat, lng),
            cityCacheKey(lat, lng),
        ];
        for (const k of keys) {
            await redis.del(k);
        }
        console.log(`[POPULAR_CATEGORIES] Cache invalidated for lat=${lat}, lng=${lng}: ${keys.join(', ')}`);
    } catch (err) {
        console.warn('[POPULAR_CATEGORIES] Cache invalidation error:', err.message);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  REALTIME EVENT INGESTION
// ─────────────────────────────────────────────────────────────────────────────
const ingestEvent = async (event, io) => {
    const { type, category, lat, lng, userId, ip, fingerprint } = event;

    console.log(`[REALTIME_REQUESTS] Event ingested: type=${type} cat=${category} lat=${lat} lng=${lng}`);

    if (['search', 'category_open', 'profile_view'].includes(type) && category && lat && lng) {
        const geoKey6 = require('./geo_hash.service').encode(lat, lng, 6);
        await trackSearchIntent(geoKey6, category, ip || 'unknown', fingerprint || 'unknown');
    }

    if (lat && lng) {
        await invalidateTrendCache(lat, lng);
    }

    if (io && lat && lng) {
        const geoKey6 = require('./geo_hash.service').encode(lat, lng, 6);
        const room = `trending:${geoKey6}`;
        io.to(room).emit('trending_updated', {
            region   : geoKey6,
            trigger  : type,
            category,
            timestamp: new Date().toISOString(),
        });
        console.log(`[BOOKING_VELOCITY] Socket push to room ${room} — trigger=${type}`);
    }

    logEvent(userId || null, 'MARKET_EVENT', { type, category, lat, lng });
};

// ─────────────────────────────────────────────────────────────────────────────
//  BACKGROUND REFRESH JOB
// ─────────────────────────────────────────────────────────────────────────────
const startBackgroundRefresh = (io) => {
    setInterval(async () => {
        console.log('[POPULAR_CATEGORIES] Background trend store refresh starting...');
        await refreshTrendStore();
    }, TREND_REFRESH_INTERVAL);

    console.log(`✅ [POPULAR_CATEGORIES] Background trend refresh started (every ${TREND_REFRESH_INTERVAL / 60_000} min)`);
};

// ─────────────────────────────────────────────────────────────────────────────
//  LEGACY SYNC EXPORTS -> NOW ASYNC POSTGRES POWERED
// ─────────────────────────────────────────────────────────────────────────────
const getLiveActivity = async (userLat, userLng) => {
    const radius = 7;
    try {
        const q = `
            SELECT 
                category,
                created_at AS time,
                earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 AS distance,
                (EXP(-0.34657359 * (EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0)) * 1.5) AS score
            FROM jobs
            WHERE 
                status IN ('OPEN', 'REDISTRIBUTING', 'REASSIGNING', 'REQUESTED')
                AND created_at >= NOW() - INTERVAL '24 hours'
                AND earth_distance(ll_to_earth($1, $2), location_cube) / 1000.0 <= $3
            ORDER BY score DESC
            LIMIT 10
        `;
        const res = await db.query(q, [userLat, userLng, radius]);
        return res.rows.map(row => ({
            type: 'LIVE_JOB',
            category: row.category,
            time: row.time,
            distance: parseFloat(row.distance),
            score: parseFloat(row.score)
        }));
    } catch (err) {
        console.error('[getLiveActivity] Error:', err.message);
        return [];
    }
};

const getRecommendations = async (userId, userLat, userLng) => {
    try {
        let userUuid = null;
        if (userId) {
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
                userUuid = userId;
            } else {
                const userRes = await db.query("SELECT id FROM users WHERE phone_number = $1", [userId]);
                if (userRes.rowCount > 0) {
                    userUuid = userRes.rows[0].id;
                }
            }
        }

        const targetVector = {};
        if (userUuid) {
            const res = await db.query(
                "SELECT category, COUNT(*) as count FROM jobs WHERE user_id = $1::uuid GROUP BY category",
                [userUuid]
            );
            for (const row of res.rows) {
                targetVector[row.category] = parseInt(row.count);
            }
        }

        const radius = 7;

        const params = [userLat, userLng, radius];
        if (userUuid) {
            params.push(userUuid);
        }

        const nearbyUsersRes = await db.query(`
            SELECT DISTINCT user_id 
            FROM jobs 
            WHERE 
                user_id IS NOT NULL
                ${userUuid ? `AND user_id != $${params.length}::uuid` : ''}
                AND location_lat IS NOT NULL AND location_lng IS NOT NULL
                AND earth_distance(ll_to_earth($1::double precision, $2::double precision), ll_to_earth(location_lat, location_lng)) / 1000.0 <= $3::double precision
        `, params);

        const userIds = nearbyUsersRes.rows.map(r => r.user_id);
        const categoryScores = {};

        if (userIds.length > 0) {
            const vectorsRes = await db.query(
                "SELECT user_id, category, COUNT(*) as count FROM jobs WHERE user_id = ANY($1::uuid[]) GROUP BY user_id, category",
                [userIds]
            );

            const otherVectors = {};
            for (const row of vectorsRes.rows) {
                if (!otherVectors[row.user_id]) otherVectors[row.user_id] = {};
                otherVectors[row.user_id][row.category] = parseInt(row.count);
            }

            for (const otherUserId of userIds) {
                const otherVector = otherVectors[otherUserId] || {};
                let dot = 0, mag1 = 0, mag2 = 0;
                const allCats = new Set([...Object.keys(targetVector), ...Object.keys(otherVector)]);
                allCats.forEach(c => {
                    dot += (targetVector[c] || 0) * (otherVector[c] || 0);
                    mag1 += (targetVector[c] || 0) ** 2;
                    mag2 += (otherVector[c] || 0) ** 2;
                });

                const similarity = dot / (Math.sqrt(mag1) * Math.sqrt(mag2) || 1);
                if (similarity > 0) {
                    Object.keys(otherVector).forEach(c => {
                        categoryScores[c] = (categoryScores[c] || 0) + similarity * otherVector[c];
                      });
                }
            }
        }

        const localFreqRes = await db.query(`
            SELECT category, COUNT(*) as count 
            FROM jobs
            WHERE 
                created_at >= NOW() - INTERVAL '24 hours'
                AND location_lat IS NOT NULL AND location_lng IS NOT NULL
                AND earth_distance(ll_to_earth($1, $2), ll_to_earth(location_lat, location_lng)) / 1000.0 <= $3
            GROUP BY category
        `, [userLat, userLng, radius]);

        const localFreqs = {};
        for (const row of localFreqRes.rows) {
            localFreqs[row.category] = parseInt(row.count);
        }

        const allCategoriesQueryRes = await db.query("SELECT DISTINCT category FROM jobs");
        const cats = [...new Set([...allCategoriesQueryRes.rows.map(r => r.category), ...ALL_CATEGORIES])];

        const hour = new Date().getHours();

        const recs = cats.map(cat => {
            const collabScore = categoryScores[cat] || 0;
            const localFreq = localFreqs[cat] || 0;
            let timeWeight = 0;
            if (hour >= 5 && hour <= 11) {
                if (['Agriculture', 'Construction'].includes(cat)) timeWeight = 1.0;
            } else if (hour >= 17 && hour <= 22) {
                if (['Home Services', 'Delivery'].includes(cat)) timeWeight = 1.0;
            }

            return {
                category: cat,
                score: 0.4 * Math.min(collabScore / 10, 1) + 0.25 * Math.min(localFreq / 5, 1) + 0.15 * timeWeight + 0.2 * 0.5
            };
        });

        return recs.sort((a, b) => b.score - a.score).slice(0, 7).map(r => r.category);
    } catch (err) {
        console.error('[getRecommendations] Error:', err.message);
        return [];
    }
};

const getRecentlyUsed = async (userId) => {
    try {
        let userUuid = null;
        if (userId) {
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
                userUuid = userId;
            } else {
                const userRes = await db.query("SELECT id FROM users WHERE phone_number = $1", [userId]);
                if (userRes.rowCount > 0) {
                    userUuid = userRes.rows[0].id;
                }
            }
        }

        if (!userUuid) return [];

        const q = `
            SELECT 
                category, 
                created_at,
                (EXP(-0.34657359 * (EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0))) as recency
            FROM jobs
            WHERE user_id = $1::uuid AND created_at >= NOW() - INTERVAL '30 days'
            ORDER BY created_at DESC
            LIMIT 20
        `;
        const res = await db.query(q, [userUuid]);
        if (res.rowCount === 0) return [];

        const categoryStats = {};
        for (const row of res.rows) {
            const cat = row.category;
            if (!categoryStats[cat]) {
                categoryStats[cat] = { recencyScore: parseFloat(row.recency), frequency: 0, lastUsed: row.created_at };
            }
            categoryStats[cat].frequency++;
        }

        return Object.entries(categoryStats)
            .map(([cat, stats]) => {
                const score = 0.7 * stats.recencyScore + 0.3 * Math.min(stats.frequency / 5, 1);
                return { category: cat, score, lastUsed: stats.lastUsed };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(r => ({
                name: r.category,
                subtitle: `Last used ${_formatTimeAgo(r.lastUsed)}`,
            }));
    } catch (err) {
        console.error('[getRecentlyUsed] Error:', err.message);
        return [];
    }
};

const _formatTimeAgo = (timestamp) => {
    const diff = new Date() - new Date(timestamp);
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
};

module.exports = {
    getTrendingCategories,
    getLiveActivity,
    getRecommendations,
    getRecentlyUsed,
    ingestEvent,
    invalidateTrendCache,
    startBackgroundRefresh,
    trackSearchIntent,
    refreshTrendStore,
};
