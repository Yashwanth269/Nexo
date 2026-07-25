const db = require('../config/db');
const redis = require('../config/redis');
const geoHash = require('./geo_hash.service');

// Constants for feed scoring weights (Locality-first hybrid formula)
const W_LOCALITY = 0.35;
const W_FRESHNESS = 0.25;
const W_ENGAGEMENT = 0.15;
const W_QUALITY = 0.10;
const W_RELIABILITY = 0.05;
const W_VELOCITY = 0.05;
const W_PERSONALIZATION = 0.05;

class FeedService {
    /**
     * Fetch nearby completed jobs ranked dynamically using our hybrid scoring algorithm.
     * Incorporates geohash-based Redis caching and cursor pagination.
     */
    async getFeedNearby(lat, lng, userId = null, cursor = null, limit = 10) {
        const start = Date.now();
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        
        // Geohash cache region precision 5 (~4.9km)
        const hash = geoHash.encode(userLat, userLng, 5);
        const cacheKey = `feed_region:${hash}`;
        
        let rankedPostIds = [];
        let cached = false;
        
        const cachedData = await redis.get(cacheKey).catch(() => null);
        if (cachedData) {
            try {
                rankedPostIds = JSON.parse(cachedData);
                cached = true;
                console.log(`[FEED_RANKING] Geo-cache HIT for region key ${cacheKey}. Found ${rankedPostIds.length} posts.`);
            } catch (e) {
                console.error('⚠️ [FEED_RANKING] Failed to parse geo-cached feed:', e.message);
            }
        }
        
        if (!cached || rankedPostIds.length === 0) {
            console.log(`[FEED_RANKING] Geo-cache MISS for region key ${cacheKey}. Recalculating ranking...`);
            
            const allCandidates = await this.fetchGeoFeedCandidates(userLat, userLng, 50.0);
            
            let candidates = allCandidates.filter(c => parseFloat(c.distance_km) <= 5.0);
            let expansionLevel = 'locality (0-5km)';
            
            if (candidates.length < 3) {
                candidates = allCandidates.filter(c => parseFloat(c.distance_km) <= 15.0);
                expansionLevel = 'district (0-15km)';
            }
            if (candidates.length < 3) {
                candidates = allCandidates;
                expansionLevel = 'city (0-50km)';
            }
            
            console.log(`[LOCALITY_MATCH] Selected ${candidates.length} candidates using expansion level: ${expansionLevel}`);
            
            // Batch Pre-load user affinities and category stats to avoid N+1 query loop
            const affinities = {};
            let preferredCategory = null;

            if (userId && candidates.length > 0) {
                const workerIds = candidates.map(c => c.worker_id).filter(Boolean);
                const [affinityRes, prefRes] = await Promise.all([
                    db.query("SELECT worker_id, hire_count FROM user_worker_affinity WHERE user_id = $1 AND worker_id = ANY($2::uuid[])", [userId, workerIds]),
                    db.query(`
                        SELECT category, COUNT(*) as count 
                        FROM jobs 
                        WHERE user_id = $1 AND status = 'COMPLETED' 
                        GROUP BY category 
                        ORDER BY count DESC 
                        LIMIT 1
                    `, [userId])
                ]);
                
                affinityRes.rows.forEach(r => {
                    affinities[r.worker_id] = r.hire_count;
                });
                if (prefRes.rows.length > 0) {
                    preferredCategory = prefRes.rows[0].category;
                }
            }

            // Score candidates
            const scored = [];
            for (const post of candidates) {
                const userHires = affinities[post.worker_id] || 0;
                const scoreDetails = this.calculateFeedScoreSync(post, userLat, userLng, userId, userHires, preferredCategory);
                
                if (scoreDetails.fraudRiskScore > 0.70 || scoreDetails.finalScore <= 0.0 || post.is_flagged) {
                    continue;
                }
                
                scored.push({
                    id: post.id,
                    score: scoreDetails.finalScore,
                    details: scoreDetails
                });
            }
            
            scored.sort((a, b) => b.score - a.score);
            rankedPostIds = scored.map(item => ({ id: item.id, score: item.score }));
            
            await redis.set(cacheKey, JSON.stringify(rankedPostIds), 'EX', 30).catch(() => {});
        }
        
        // Cursor Pagination
        let startIndex = 0;
        if (cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('ascii'));
                const lastIndex = rankedPostIds.findIndex(item => item.id === decoded.lastId);
                if (lastIndex !== -1) {
                    startIndex = lastIndex + 1;
                }
            } catch (err) {
                console.warn('⚠️ [FEED_RANKING] Invalid cursor ignored:', err.message);
            }
        }
        
        const pageSlice = rankedPostIds.slice(startIndex, startIndex + limit);
        const nextCursor = pageSlice.length > 0 && (startIndex + pageSlice.length < rankedPostIds.length)
            ? Buffer.from(JSON.stringify({ lastId: pageSlice[pageSlice.length - 1].id })).toString('base64')
            : null;
            
        // 4. Retrieve Full Details in a Single Batch (fixes critical N+1 DB lookup loop!)
        const postIds = pageSlice.map(item => item.id);
        const posts = await this.getPostDetailsBatch(postIds, userId, userLat, userLng);
        
        const activeWorkers = await this.fetchActiveLocalWorkers(userLat, userLng);
        
        return {
            success: true,
            posts,
            nextCursor,
            activeWorkers,
            meta: {
                cached,
                latencyMs: Date.now() - start,
                totalAvailable: rankedPostIds.length
            }
        };
    }

    /**
     * Batch retrieves post details using single query mappings to completely avoid N+1 DB lookups
     */
    async getPostDetailsBatch(postIds, userId = null, userLat = null, userLng = null) {
        if (!postIds || postIds.length === 0) return [];
        try {
            const res = await db.query(`
                SELECT 
                    p.*,
                    w.full_name as worker_name,
                    w.photo_url as worker_photo,
                    w.rating as worker_rating,
                    w.jobs_completed as worker_jobs_completed
                FROM completed_job_posts p
                LEFT JOIN workers w ON p.worker_id = w.id
                WHERE p.id = ANY($1::uuid[]) AND p.is_flagged = false
            `, [postIds]);

            const likedSet = new Set();
            const savedSet = new Set();

            if (userId) {
                const [likesRes, savesRes] = await Promise.all([
                    db.query("SELECT post_id FROM completed_post_likes WHERE user_id = $1 AND post_id = ANY($2::uuid[])", [userId, postIds]),
                    db.query("SELECT post_id FROM completed_post_saves WHERE user_id = $1 AND post_id = ANY($2::uuid[])", [userId, postIds])
                ]);
                likesRes.rows.forEach(r => likedSet.add(r.post_id));
                savesRes.rows.forEach(r => savedSet.add(r.post_id));
            }

            const postsMap = {};
            res.rows.forEach(post => {
                const isLiked = likedSet.has(post.id);
                const isSaved = savedSet.has(post.id);
                
                let distanceText = "Nearby";
                let distanceKm = 0.0;
                if (userLat && userLng && post.location_lat && post.location_lng) {
                    distanceKm = this.calculateDistance(userLat, userLng, parseFloat(post.location_lat), parseFloat(post.location_lng));
                    distanceText = distanceKm < 1.0 ? "Under 1 km away" : `${distanceKm.toFixed(1)} km away`;
                }

                postsMap[post.id] = {
                    id: post.id,
                    jobId: post.job_id,
                    workerId: post.worker_id,
                    userId: post.user_id,
                    category: post.category,
                    title: post.title || 'Completed Job',
                    caption: post.caption || 'Job successfully verified and closed!',
                    address: this.obfuscateAddress(post.address),
                    imageUrls: post.image_urls || [],
                    likesCount: parseInt(post.likes_count || 0, 10),
                    commentsCount: parseInt(post.comments_count || 0, 10),
                    savesCount: parseInt(post.saves_count || 0, 10),
                    viewsCount: parseInt(post.views_count || 0, 10),
                    isLiked,
                    isSaved,
                    distanceText,
                    distanceKm,
                    completedAt: post.completed_at || post.created_at,
                    worker: {
                        name: post.worker_name || 'Verified Pro',
                        photoUrl: post.worker_photo || '',
                        rating: parseFloat(post.worker_rating || 4.5),
                        jobsCompleted: parseInt(post.worker_jobs_completed || 5, 10)
                    }
                };
            });

            return postIds.map(id => postsMap[id]).filter(Boolean);
        } catch (err) {
            console.error('❌ [FEED_BATCH_ERROR] Failed batch lookup:', err.message);
            return [];
        }
    }

    /**
     * Database-driven geo feed candidates selection
     */
    async fetchGeoFeedCandidates(userLat, userLng, maxRadiusKm = 50.0) {
        try {
            const query = `
                SELECT 
                    p.*,
                    w.full_name as worker_name,
                    w.photo_url as worker_photo,
                    w.rating as worker_rating,
                    w.reliability_score as worker_reliability,
                    (6371 * acos(
                        LEAST(1.0, GREATEST(-1.0, 
                            cos(radians($1)) * cos(radians(p.location_lat)) *
                            cos(radians(p.location_lng) - radians($2)) +
                            sin(radians($1)) * sin(radians(p.location_lat))
                        ))
                    )) AS distance_km
                FROM completed_job_posts p
                LEFT JOIN workers w ON p.worker_id = w.id
                WHERE p.is_flagged = false
                  AND (6371 * acos(
                        LEAST(1.0, GREATEST(-1.0, 
                            cos(radians($1)) * cos(radians(p.location_lat)) *
                            cos(radians(p.location_lng) - radians($2)) +
                            sin(radians($1)) * sin(radians(p.location_lat))
                        ))
                    )) <= $3
            `;
            const res = await db.query(query, [userLat, userLng, maxRadiusKm]);
            return res.rows;
        } catch (err) {
            console.error('❌ [FEED_RANKING_ERROR] Failed to fetch feed candidates:', err.message);
            return [];
        }
    }

    /**
     * Synchronous execution of feed scoring using preloaded user affinity factors (removes query loop N+1 calls)
     */
    calculateFeedScoreSync(post, userLat, userLng, userId = null, userHires = 0, preferredCategory = null) {
        const completedTime = new Date(post.completed_at || post.created_at).getTime();
        const hoursAgo = Math.max(0, (Date.now() - completedTime) / (1000 * 60 * 60));
        const freshnessScore = Math.exp(-hoursAgo / 12.0);
        
        const rawLikes = parseInt(post.likes_count || 0, 10);
        const rawComments = parseInt(post.comments_count || 0, 10);
        const rawSaves = parseInt(post.saves_count || 0, 10);
        const engagementWeight = (rawLikes * 1.0) + (rawComments * 2.0) + (rawSaves * 3.0);
        const engagementScore = Math.min(1.0, engagementWeight / 200.0);
        
        const viewsCount = Math.max(1, parseInt(post.views_count || 1, 10));
        const trendingVelocity = Math.min(1.0, (rawLikes / viewsCount) * (1.0 + rawComments * 0.1));
        
        const distance = parseFloat(post.distance_km || 0.1);
        let localityScore = 0.0;
        
        if (distance <= 2.0) {
            localityScore = 1.0 - (distance * 0.05); 
        } else if (distance <= 5.0) {
            localityScore = 0.9 - ((distance - 2.0) * 0.067);
        } else if (distance <= 10.0) {
            localityScore = 0.7 - ((distance - 5.0) * 0.06);
        } else if (distance <= 25.0) {
            localityScore = 0.4 - ((distance - 10.0) * 0.0167);
        } else {
            const isViral = trendingVelocity >= 0.6 || rawLikes >= 50;
            if (!isViral) {
                return { finalScore: 0.0, freshnessScore: 0.0, engagementScore: 0.0, localityScore: 0.0, completionQualityScore: 0.0, workerReliabilityScore: 0.0, trendingVelocity: 0.0, personalizationScore: 0.0, fraudRiskScore: 0.0 };
            }
            localityScore = 0.15 * trendingVelocity;
        }
        
        const ratingVal = parseFloat(post.worker_rating || 4.5);
        const completionQualityScore = Math.min(1.0, ratingVal / 5.0);
        const workerReliabilityScore = Math.min(1.0, parseFloat(post.worker_reliability || 1.0));
        
        let personalizationScore = 0.5;
        if (userId) {
            const categoryMatch = preferredCategory && preferredCategory.toLowerCase() === post.category.toLowerCase();
            if (userHires > 0 || categoryMatch) {
                personalizationScore = 1.0;
            }
        }
        
        const finalScore = 
            (localityScore * W_LOCALITY) +
            (freshnessScore * W_FRESHNESS) +
            (engagementScore * W_ENGAGEMENT) +
            (completionQualityScore * W_QUALITY) +
            (workerReliabilityScore * W_RELIABILITY) +
            (trendingVelocity * W_VELOCITY) +
            (personalizationScore * W_PERSONALIZATION);
            
        const fraudRiskScore = parseFloat(post.fraud_risk_score || 0.0);
        
        return {
            finalScore: Math.min(1.0, finalScore),
            freshnessScore,
            engagementScore,
            localityScore,
            completionQualityScore,
            workerReliabilityScore,
            trendingVelocity,
            personalizationScore,
            fraudRiskScore
        };
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; 
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    obfuscateAddress(addr) {
        if (!addr) return 'Nearby Locality';
        const parts = addr.split(',');
        if (parts.length > 2) {
            const cleanParts = parts
                .map(p => p.trim())
                .filter(p => {
                    const low = p.toLowerCase();
                    const hasDigit = /\d+/.test(p);
                    const hasAptWord = low.includes('flat') || low.includes('floor') || low.includes('apartment') || 
                                       low.includes('block') || low.includes('road') || low.includes('street') || 
                                       low.includes('lane') || low.includes('house');
                    return !hasDigit && !hasAptWord;
                });
            if (cleanParts.length >= 2) {
                return cleanParts.slice(-2).join(', ');
            }
            return parts.slice(-2).map(p => p.trim()).join(', ');
        }
        return addr;
    }

    async fetchActiveLocalWorkers(userLat, userLng) {
        try {
            const query = `
                SELECT 
                    id, photo_url, full_name
                FROM workers
                WHERE is_online = true AND photo_url IS NOT NULL
                  AND (6371 * acos(
                        LEAST(1.0, GREATEST(-1.0, 
                            cos(radians($1)) * cos(radians(current_lat)) *
                            cos(radians(current_lng) - radians($2)) +
                            sin(radians($1)) * sin(radians(current_lat))
                        ))
                    )) <= 15.0
                LIMIT 5
            `;
            const res = await db.query(query, [userLat, userLng]);
            return res.rows.map(w => ({
                id: w.id,
                name: w.full_name,
                photoUrl: w.photo_url
            }));
        } catch (e) {
            return [];
        }
    }

    async invalidateFeedCache(lat, lng) {
        try {
            if (!lat || !lng) return;
            const hash = geoHash.encode(parseFloat(lat), parseFloat(lng), 5);
            const cacheKey = `feed_region:${hash}`;
            await redis.del(cacheKey);
            console.log(`[FEED_CACHE] Invalidated feed cache for key ${cacheKey}`);
        } catch (e) {
            console.warn('[FEED_CACHE] Invalidation error:', e.message);
        }
    }

    /**
     * Safe cursor-based SCAN loop for Redis global invalidation (does not block Redis)
     */
    async invalidateAllFeedCaches() {
        try {
            let cursor = '0';
            const keysToDelete = [];
            
            do {
                const reply = await redis.scan(cursor, 'MATCH', 'feed_region:*', 'COUNT', 100);
                cursor = reply[0];
                const keys = reply[1];
                if (keys.length > 0) {
                    keysToDelete.push(...keys);
                }
            } while (cursor !== '0');

            if (keysToDelete.length > 0) {
                // Delete in small chunk batches of 50 to maintain Redis connection stability
                for (let i = 0; i < keysToDelete.length; i += 50) {
                    const chunk = keysToDelete.slice(i, i + 50);
                    await redis.del(...chunk);
                }
            }
            console.log(`[FEED_CACHE] Safe global invalidation: deleted ${keysToDelete.length} keys`);
        } catch (e) {
            console.warn('[FEED_CACHE] Global invalidation error:', e.message);
        }
    }

    async likePost(postId, userId, io) {
        const selectRes = await db.query(
            "SELECT 1 FROM completed_post_likes WHERE post_id = $1 AND user_id = $2",
            [postId, userId]
        );
        
        const liked = selectRes.rows.length > 0;
        let delta = liked ? -1 : 1;
        
        if (liked) {
            await db.query("DELETE FROM completed_post_likes WHERE post_id = $1 AND user_id = $2", [postId, userId]);
        } else {
            await db.query("INSERT INTO completed_post_likes (post_id, user_id) VALUES ($1, $2)", [postId, userId]);
        }
        
        const updateRes = await db.query(
            "UPDATE completed_job_posts SET likes_count = GREATEST(0, likes_count + $1) WHERE id = $2 RETURNING location_lat, location_lng, likes_count",
            [delta, postId]
        );
        
        if (updateRes.rows.length > 0) {
            const row = updateRes.rows[0];
            await this.invalidateFeedCache(row.location_lat, row.location_lng);
            
            const geohash = geoHash.encode(parseFloat(row.location_lat), parseFloat(row.location_lng), 6);
            if (io) {
                io.to(`trending:${geohash}`).emit('feed_updated', {
                    postId,
                    likesCount: row.likes_count,
                    action: liked ? 'unlike' : 'like'
                });
            }
        }
        
        return { success: true, liked: !liked };
    }

    async viewPost(postId, userId) {
        await db.query("INSERT INTO completed_post_views (post_id, user_id) VALUES ($1, $2)", [postId, userId]);
        
        const updateRes = await db.query(
            "UPDATE completed_job_posts SET views_count = views_count + 1 WHERE id = $1 RETURNING location_lat, location_lng",
            [postId]
        );
        
        if (updateRes.rows.length > 0) {
            const row = updateRes.rows[0];
            await this.invalidateFeedCache(row.location_lat, row.location_lng);
        }
        return { success: true };
    }

    async savePost(postId, userId) {
        const selectRes = await db.query(
            "SELECT 1 FROM completed_post_saves WHERE post_id = $1 AND user_id = $2",
            [postId, userId]
        );
        
        const saved = selectRes.rows.length > 0;
        let delta = saved ? -1 : 1;
        
        if (saved) {
            await db.query("DELETE FROM completed_post_saves WHERE post_id = $1 AND user_id = $2", [postId, userId]);
        } else {
            await db.query("INSERT INTO completed_post_saves (post_id, user_id) VALUES ($1, $2)", [postId, userId]);
        }
        
        const updateRes = await db.query(
            "UPDATE completed_job_posts SET saves_count = GREATEST(0, saves_count + $1) WHERE id = $2 RETURNING location_lat, location_lng",
            [delta, postId]
        );
        
        if (updateRes.rows.length > 0) {
            const row = updateRes.rows[0];
            await this.invalidateFeedCache(row.location_lat, row.location_lng);
        }
        
        return { success: true, saved: !saved };
    }

    async bootstrapCompletedPosts() {
        return;
    }

    async createOrUpdateCompletedPost(jobId) {
        try {
            const jobRes = await db.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
            if (jobRes.rows.length === 0) return;
            const job = jobRes.rows[0];
 
            if (job.status !== 'COMPLETED') return;
 
            const imageUrls = job.completion_photo ? [job.completion_photo] : [];
 
            const checkRes = await db.query("SELECT id FROM completed_job_posts WHERE job_id = $1", [jobId]);
 
            let postId;
            if (checkRes.rows.length > 0) {
                postId = checkRes.rows[0].id;
                await db.query(
                    `UPDATE completed_job_posts 
                     SET worker_id = $1, user_id = $2, category = $3, title = $4, caption = $5, 
                         location_lat = $6, location_lng = $7, address = $8, image_urls = $9::jsonb, 
                         completed_at = COALESCE($10, completed_at)
                     WHERE id = $11`,
                    [
                        job.worker_id, job.user_id, job.category, job.title || `${job.category} Job`,
                        job.description || 'Job completed successfully!', job.location_lat, job.location_lng,
                        job.address, JSON.stringify(imageUrls), job.completed_at || new Date(), postId
                    ]
                );
            } else {
                const insertRes = await db.query(
                    `INSERT INTO completed_job_posts (
                        job_id, worker_id, user_id, category, title, caption, 
                        location_lat, location_lng, address, image_urls, completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
                    RETURNING id`,
                    [
                        jobId, job.worker_id, job.user_id, job.category, job.title || `${job.category} Job`,
                        job.description || 'Job completed successfully!', job.location_lat, job.location_lng,
                        job.address, JSON.stringify(imageUrls), job.completed_at || new Date()
                    ]
                );
                postId = insertRes.rows[0].id;
            }
 
            await this.invalidateFeedCache(job.location_lat, job.location_lng);
 
            const geoHash6 = geoHash.encode(parseFloat(job.location_lat), parseFloat(job.location_lng), 6);
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`trending:${geoHash6}`).emit('feed_updated', {
                    postId,
                    action: 'complete'
                });
            }
        } catch (err) {
            console.error('❌ [FEED_SERVICE] Error in createOrUpdateCompletedPost:', err.message);
        }
    }
}

module.exports = new FeedService();
