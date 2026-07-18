'use strict';

const express = require('express');
const router = express.Router();
const redis = require('../config/redis');
const db = require('../config/db');
const { getIO } = require('../config/socket');
const { logEvent } = require('../services/ml_events.service');
const { invalidateTrendCache } = require('../services/market.service');

const CACHE_TTL_SECONDS = 45;

const ALL_CATEGORIES = [
    'Agriculture', 'Construction', 'Delivery', 'Events',
    'Home Services', 'Household', 'Mechanic', 'Shops',
    'Skilled', 'Smart Tech', 'Transport',
    'Electrical', 'Plumbing', 'Cleaning', 'Painting', 'AC Repair',
    'Labour', 'Security', 'Healthcare',
];

const getTimeSegment = (hour) => {
    if (hour >= 4  && hour < 7)  return 'dawn';
    if (hour >= 7  && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    if (hour >= 21 && hour < 24) return 'night';
    return 'latenight';
};

const getSegmentBoosts = (segment) => {
    const boosts = {
        dawn: { Agriculture: 1.6, Labour: 1.4, Transport: 1.3, Delivery: 1.2 },
        morning: { Cleaning: 1.5, Household: 1.4, Agriculture: 1.3, Construction: 1.3, Healthcare: 1.2 },
        afternoon: { Labour: 1.4, Agriculture: 1.3, Construction: 1.3, Delivery: 1.2, Transport: 1.2 },
        evening: { Electrical: 1.5, 'AC Repair': 1.5, Plumbing: 1.3, Mechanic: 1.2, 'Home Services': 1.3, Events: 1.2 },
        night: { Delivery: 1.5, Security: 1.4, Electrical: 1.2, Mechanic: 1.2 },
        latenight: { Delivery: 1.3, Security: 1.5 },
    };
    return boosts[segment] || {};
};

const computeHomeRankingScore = (cat, segment) => {
    const segBoosts = getSegmentBoosts(segment);
    const timeBoost = segBoosts[cat.name] || 1.0;

    return (
        0.30 * cat.availabilityScore +
        0.25 * ({ LOW: 0.2, NORMAL: 0.5, HIGH: 0.8, VERY_HIGH: 1.0 }[cat.demand] || 0.5) +
        0.20 * cat.acceptanceProbability +
        0.15 * (cat.avgReputation / 5.0) +
        0.10 * timeBoost
    );
};

const mapServiceStatus = (availabilityScore) => {
    if (availabilityScore > 0.90) return { status: 'AVAILABLE', label: 'Available Now' };
    if (availabilityScore > 0.70) return { status: 'AVAILABLE', label: 'Available' };
    if (availabilityScore > 0.50) return { status: 'BUSY', label: 'Busy' };
    if (availabilityScore > 0.30) return { status: 'LIMITED', label: 'Limited' };
    return { status: 'UNAVAILABLE', label: 'Unavailable' };
};

const mapDemandLabel = (demand) => {
    const labels = {
        LOW: { badge: 'Low Demand', color: '#94A3B8' },
        NORMAL: { badge: 'Normal', color: '#3B82F6' },
        HIGH: { badge: 'High Demand', color: '#F97316' },
        VERY_HIGH: { badge: 'Peak Hours', color: '#EF4444' },
    };
    return labels[demand] || labels.NORMAL;
};

const mapAcceptanceLabel = (prob) => {
    if (prob > 0.95) return { badge: 'Fast Response', color: '#10B981' };
    if (prob > 0.90) return { badge: 'Likely Available', color: '#3B82F6' };
    if (prob > 0.75) return { badge: 'Response Expected', color: '#F97316' };
    return { badge: 'Limited Availability', color: '#EF4444' };
};

const mapSkillLabel = (confidence) => {
    if (confidence > 0.90) return { badge: 'Verified Experts', color: '#10B981' };
    if (confidence > 0.80) return { badge: 'Highly Skilled', color: '#3B82F6' };
    if (confidence > 0.70) return { badge: 'Experienced', color: '#F97316' };
    return { badge: 'Available', color: '#94A3B8' };
};

// GET /api/home/services
router.get('/services', async (req, res) => {
    const startTime = Date.now();
    try {
        const { lat, lng, userId } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, error: 'Location coordinates required (lat, lng)' });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const hour = new Date().getHours();
        const segment = getTimeSegment(hour);
        const cacheKey = `home_services:${userLat.toFixed(4)}:${userLng.toFixed(4)}`;

        // Try cache
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                const responseTime = Date.now() - startTime;
                logEvent(userId, 'HOME_SERVICES_VIEWED', { cached: true, responseTime, categoryCount: parsed.categories?.length });
                return res.json({ ...parsed, meta: { ...parsed.meta, cached: true } });
            }
        } catch (cacheErr) {
            console.warn('[HOME_SERVICES] Redis cache read error:', cacheErr.message);
        }

        // Determine real categories from the system
        let activeCategories = [];
        try {
            const catRes = await db.query("SELECT DISTINCT category FROM jobs WHERE created_at >= NOW() - INTERVAL '30 days'");
            activeCategories = catRes.rows.map(r => r.category);
        } catch (_) {}

        if (activeCategories.length < 5) {
            activeCategories = [...ALL_CATEGORIES];
        }

        // Call ML service for predictions
        let mlResults = [];
        let mlMeta = {};
        try {
            const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';
            const axios = require('axios');
            const mlResponse = await axios.post(`${mlServiceUrl}/predict/home-services`, {
                categories: activeCategories,
                lat: userLat,
                lng: userLng,
                user_id: userId || null,
            }, { timeout: 10000 });

            if (mlResponse.data && mlResponse.data.success) {
                mlResults = mlResponse.data.categories || [];
                mlMeta = mlResponse.data.meta || {};
            }
        } catch (mlErr) {
            console.log('ℹ️ [ML-FALLBACK] ML service offline, using DB-only fallback.');
            mlResults = await computeFallbackMetrics(userLat, userLng, activeCategories);
        }

        // Compute home ranking scores and sort
        const enriched = mlResults.map(cat => {
            const statusInfo = mapServiceStatus(cat.availabilityScore || 0);
            const demandInfo = mapDemandLabel(cat.demand || 'NORMAL');
            const acceptanceInfo = mapAcceptanceLabel(cat.acceptanceProbability || 0);
            const skillInfo = mapSkillLabel(cat.skillConfidence || 0);

            const homeRankingScore = computeHomeRankingScore(
                { ...cat, name: cat.name },
                segment
            );

            return {
                id: cat.id || cat.name?.toLowerCase().replace(/\s+/g, '_'),
                name: cat.name,
                icon: null,
                status: statusInfo.status,
                statusLabel: statusInfo.label,
                onlineWorkers: cat.onlineWorkers || 0,
                availableWorkers: cat.availableWorkers || 0,
                avgETA: cat.avgETA || null,
                availabilityScore: cat.availabilityScore || 0,
                acceptanceProbability: cat.acceptanceProbability || 0,
                avgReputation: cat.avgReputation || 0,
                skillConfidence: cat.skillConfidence || 0,
                demand: cat.demand || 'NORMAL',
                demandBadge: demandInfo.badge,
                demandColor: demandInfo.color,
                acceptanceBadge: acceptanceInfo.badge,
                acceptanceColor: acceptanceInfo.color,
                skillBadge: skillInfo.badge,
                skillColor: skillInfo.color,
                serviceHealth: cat.serviceHealth || 'GOOD',
                homeRankingScore: Math.round(homeRankingScore * 100) / 100,
                jobsLastHour: cat.jobsLastHour || 0,
                jobsLast24h: cat.jobsLast24h || 0,
            };
        });

        // Sort by home ranking score descending
        enriched.sort((a, b) => b.homeRankingScore - a.homeRankingScore);

        // Assign ranks
        enriched.forEach((cat, i) => {
            cat.rank = i + 1;
        });

        const payload = {
            success: true,
            categories: enriched,
            meta: {
                segment,
                generatedAt: new Date().toISOString(),
                cached: false,
                cacheTtlSeconds: CACHE_TTL_SECONDS,
                responseTimeMs: Date.now() - startTime,
                modelsUsed: mlMeta.models || {},
                categoryCount: enriched.length,
            },
        };

        // Cache in Redis
        try {
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
        } catch (cacheErr) {
            console.warn('[HOME_SERVICES] Redis cache write error:', cacheErr.message);
        }

        // Log metrics
        logEvent(userId, 'HOME_SERVICES_VIEWED', {
            cached: false,
            responseTime: Date.now() - startTime,
            categoryCount: enriched.length,
            topCategories: enriched.slice(0, 5).map(c => ({ name: c.name, score: c.homeRankingScore })),
            segment,
        });

        res.json(payload);
    } catch (error) {
        console.error('[HOME_SERVICES] Error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

async function computeFallbackMetrics(userLat, userLng, categories) {
    try {
        const results = [];
        
        // 1. Get total online/available workers count once
        const totalRes = await db.query("SELECT COUNT(*) as count FROM workers WHERE is_online = true AND is_available = true");
        const totalAvailable = parseInt(totalRes.rows[0]?.count || 1);

        // Compute bounding box coordinates for 30km radius (~0.27 degrees lat)
        const latRange = 30.0 / 111.0; 
        const cosLat = Math.cos(userLat * Math.PI / 180.0);
        const lngRange = 30.0 / (111.0 * (cosLat > 0.01 ? cosLat : 0.01));

        const minLat = userLat - latRange;
        const maxLat = userLat + latRange;
        const minLng = userLng - lngRange;
        const maxLng = userLng + lngRange;

        // 2. Fetch all online/available workers within 30km bounding box once
        const workersRes = await db.query(`
            SELECT skills, rating FROM workers
            WHERE is_online = true AND is_available = true
              AND current_lat >= $1 AND current_lat <= $2
              AND current_lng >= $3 AND current_lng <= $4
        `, [minLat, maxLat, minLng, maxLng]);
        const localWorkers = workersRes.rows || [];

        // 3. Fetch all jobs in the last 24h within 30km bounding box once
        const jobsRes = await db.query(`
            SELECT category, created_at FROM jobs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
              AND location_lat >= $1 AND location_lat <= $2
              AND location_lng >= $3 AND location_lng <= $4
        `, [minLat, maxLat, minLng, maxLng]);
        const localJobs = jobsRes.rows || [];

        const now = Date.now();
        const oneHourAgo = now - 3600000;

        for (const category of categories) {
            const catLower = category.toLowerCase();

            // Filter workers matching category in skills in-memory
            const matchingWorkers = localWorkers.filter(w => {
                if (!w.skills || !Array.isArray(w.skills)) return false;
                return w.skills.some(s => {
                    const sLower = s.toLowerCase();
                    return sLower.includes(catLower) || catLower.includes(sLower);
                });
            });
            const onlineWorkers = matchingWorkers.length;

            // Calculate average reputation in-memory
            const sumRep = matchingWorkers.reduce((sum, w) => sum + parseFloat(w.rating || 0), 0);
            const avgRep = matchingWorkers.length > 0 ? (sumRep / matchingWorkers.length) : 0;

            // Filter jobs matching category in-memory
            const matchingJobs = localJobs.filter(j => {
                if (!j.category) return false;
                return j.category.toLowerCase().includes(catLower);
            });
            const jobsLast24h = matchingJobs.length;

            // Filter jobs in last 1 hour in-memory
            const jobsLast1h = matchingJobs.filter(j => {
                const jobTime = new Date(j.created_at).getTime();
                return jobTime >= oneHourAgo;
            }).length;

            const availabilityScore = Math.min(1, onlineWorkers / Math.max(totalAvailable, 1));
            const demand = jobsLast1h > 15 ? 'VERY_HIGH' : jobsLast1h > 8 ? 'HIGH' : jobsLast1h > 3 ? 'NORMAL' : 'LOW';

            results.push({
                name: category,
                onlineWorkers,
                availableWorkers: totalAvailable,
                avgETA: null,
                availabilityScore,
                acceptanceProbability: Math.min(0.95, 0.5 + (onlineWorkers / Math.max(totalAvailable, 1)) * 0.3),
                avgReputation: avgRep,
                skillConfidence: Math.min(1, avgRep / 5),
                demand,
                serviceHealth: availabilityScore > 0.5 ? 'GOOD' : availabilityScore > 0.3 ? 'WARNING' : 'CRITICAL',
                jobsLastHour: jobsLast1h,
                jobsLast24h,
            });
        }
        return results;
    } catch (err) {
        console.error('[HOME_SERVICES] Fallback computation error:', err.message);
        return [];
    }
}

// POST /api/home/invalidate-cache
router.post('/invalidate-cache', async (req, res) => {
    try {
        const { lat, lng } = req.body;
        if (lat && lng) {
            await invalidateServiceCache(lat, lng);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[HOME_SERVICES] Cache invalidation error:', err.message);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

async function invalidateServiceCache(lat, lng) {
    try {
        const keys = [
            `home_services:${parseFloat(lat).toFixed(4)}:${parseFloat(lng).toFixed(4)}`,
        ];
        for (const k of keys) {
            await redis.del(k);
        }
    } catch (err) {
        console.warn('[HOME_SERVICES] Cache invalidation error:', err.message);
    }
}

async function invalidateAllHomeServicesCaches() {
    try {
        const keys = await redis.keys('home_services:*');
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        console.log(`[HOME_SERVICES] Invalidated ${keys.length} home services caches`);
        
        const { getIO } = require('../config/socket');
        const io = getIO();
        if (io) {
            io.emit('services_updated', { trigger: 'data_changed' });
            console.log("[HOME_SERVICES] Broadcasted 'services_updated' socket event");
        }
    } catch (err) {
        console.warn('[HOME_SERVICES] Global cache invalidation error:', err.message);
    }
}

const { optionalAuth } = require('../utils/auth.middleware');
const rankingService = require('../services/ranking.service');
const walletService = require('../services/wallet.service');
const feedService = require('../services/feed.service');
const marketService = require('../services/market.service');

router.get('/dashboard', optionalAuth, async (req, res) => {
    const startTime = Date.now();
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({ success: false, error: 'Coordinates required (lat, lng)' });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const userId = req.user?.userId || req.user?.workerId || req.query.userId || null;
        const role = req.user?.role || req.query.role || 'USER';

        // Cache Key
        const cacheKey = `dashboard:${userId || 'anon'}:${userLat.toFixed(4)}:${userLng.toFixed(4)}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return res.json(JSON.parse(cached));
            }
        } catch (e) {
            console.warn('[DASHBOARD] Redis read error:', e.message);
        }

        // Parallel execution
        const [
            servicesData,
            trendingCategories,
            recommendations,
            walletData,
            recentJobs,
            topWorkers,
            feedData
        ] = await Promise.all([
            // 1. Home services
            computeFallbackMetrics(userLat, userLng, ALL_CATEGORIES).catch(() => []),
            // 2. Trending categories
            marketService.getTrendingCategories?.(userLat, userLng).catch(() => []),
            // 3. User recommendations
            (async () => {
                if (!userId) return ALL_CATEGORIES.slice(0, 3);
                const prev = await db.query(
                    "SELECT category, COUNT(*) as count FROM jobs WHERE user_id = $1 GROUP BY category ORDER BY count DESC LIMIT 3",
                    [userId]
                );
                if (prev.rowCount > 0) return prev.rows.map(r => r.category);
                return ALL_CATEGORIES.slice(0, 3);
            })().catch(() => ALL_CATEGORIES.slice(0, 3)),
            // 4. Wallet balance
            (async () => {
                if (!userId) return { balance: 0.0, cashHeld: 0.0 };
                return walletService.getBalance(userId, role);
            })().catch(() => ({ balance: 0.0, cashHeld: 0.0 })),
            // 5. Recent jobs history
            (async () => {
                if (!userId) return [];
                const hist = await db.query(
                    "SELECT * FROM jobs WHERE user_id = $1 OR worker_id = $1 ORDER BY created_at DESC LIMIT 5",
                    [userId]
                );
                return hist.rows;
            })().catch(() => []),
            // 6. Top rated workers nearby
            rankingService.getTopRatedWorkers(userLat, userLng, userId, null).catch(() => []),
            // 7. Feed posts
            feedService.getFeedNearby(userLat, userLng, userId).catch(() => [])
        ]);

        const payload = {
            success: true,
            dashboard: {
                services: servicesData,
                trending: trendingCategories,
                recommendations: recommendations,
                wallet: walletData,
                history: recentJobs,
                topWorkers: topWorkers,
                feed: feedData
            },
            meta: {
                generatedAt: new Date().toISOString(),
                responseTimeMs: Date.now() - startTime
            }
        };

        // Cache in Redis (TTL = 30 seconds)
        try {
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', 30);
        } catch (e) {
            console.warn('[DASHBOARD] Redis cache write error:', e.message);
        }

        res.json(payload);

    } catch (err) {
        console.error('[DASHBOARD] Fetch error:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

module.exports = {
    router,
    invalidateServiceCache,
    invalidateAllHomeServicesCaches,
};
