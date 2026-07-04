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
        
        // 1. Generate Cache Key using Geohash precision 5 (~4.9km district block)
        const hash = geoHash.encode(userLat, userLng, 5);
        const cacheKey = `feed_region:${hash}`;
        
        let rankedPostIds = [];
        let cached = false;
        
        // Try getting cached post IDs
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
            try {
                rankedPostIds = JSON.parse(cachedData);
                cached = true;
                console.log(`[FEED_RANKING] Geo-cache HIT for region key ${cacheKey}. Found ${rankedPostIds.length} posts.`);
            } catch (e) {
                console.error('⚠️ [FEED_RANKING] Failed to parse geo-cached feed:', e.message);
            }
        }
        
        // 2. Cache Miss: Recompute hybrid ranking from DB
        if (!cached || rankedPostIds.length === 0) {
            console.log(`[FEED_RANKING] Geo-cache MISS for region key ${cacheKey}. Recalculating ranking...`);
            
            // Fetch candidates up to city scale (50.0 km) in one single database scan
            const allCandidates = await this.fetchGeoFeedCandidates(userLat, userLng, 50.0);
            
            // Gradual Radius Expansion Handling: filter based on geo scoping rules
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
            
            // Score candidates
            const scored = [];
            for (const post of candidates) {
                const scoreDetails = await this.calculateFeedScore(post, userLat, userLng, userId);
                
                // Suppress flagged or zero-scored items (e.g. far-away un-trending posts or fraud)
                if (scoreDetails.fraudRiskScore > 0.70 || scoreDetails.finalScore <= 0.0 || post.is_flagged) {
                    console.log(`[FRAUD_DETECTED] completed_job_post ${post.id} suppressed. Fraud risk: ${scoreDetails.fraudRiskScore}, Score: ${scoreDetails.finalScore}`);
                    continue; // Skip entirely
                }
                
                scored.push({
                    id: post.id,
                    score: scoreDetails.finalScore,
                    details: scoreDetails
                });
            }
            
            // Sort by finalScore DESC
            scored.sort((a, b) => b.score - a.score);
            rankedPostIds = scored.map(item => ({ id: item.id, score: item.score }));
            
            // Store in Redis (TTL = 120s / 2 minutes)
            await redis.set(cacheKey, JSON.stringify(rankedPostIds), 'EX', 120);
            console.log(`[FEED_RANKING] Recalculated & cached ${rankedPostIds.length} ranked posts for ${cacheKey}. Latency: ${Date.now() - start}ms`);
        }
        
        // 3. Cursor-based Pagination
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
            
        // 4. Retrieve Full Details of Paginated Posts
        const posts = [];
        for (const item of pageSlice) {
            const postDetail = await this.getPostDetailById(item.id, userId, userLat, userLng);
            if (postDetail) {
                posts.push(postDetail);
            }
        }
        
        // 5. Query Active Local Worker Avatars (within 15km) for the dynamic header facepile
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
     * Database-driven geo feed candidates selection within a wide 25km radius.
     */
    async fetchGeoFeedCandidates(userLat, userLng, maxRadiusKm = 50.0) {
        try {
            // Haversine geo filter up to maxRadiusKm
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
     * Compute multi-factor hybrid ranking score for completed posts
     */
    async calculateFeedScore(post, userLat, userLng, userId = null) {
        // 1. Freshness Score (exponential decay, faster decay curve to make newest items dominate)
        const completedTime = new Date(post.completed_at || post.created_at).getTime();
        const hoursAgo = Math.max(0, (Date.now() - completedTime) / (1000 * 60 * 60));
        const freshnessScore = Math.exp(-hoursAgo / 12.0); // 12-hour half-life makes recent jobs stand out significantly
        
        // 2. Engagement Score (normalized likes, comments, and saves)
        const rawLikes = parseInt(post.likes_count || 0);
        const rawComments = parseInt(post.comments_count || 0);
        const rawSaves = parseInt(post.saves_count || 0);
        const engagementWeight = (rawLikes * 1.0) + (rawComments * 2.0) + (rawSaves * 3.0);
        const engagementScore = Math.min(1.0, engagementWeight / 200.0); // Cap normalized engagement
        
        // 3. Trending Velocity (velocity increase of engagement metrics)
        const viewsCount = Math.max(1, parseInt(post.views_count || 1));
        const trendingVelocity = Math.min(1.0, (rawLikes / viewsCount) * (1.0 + rawComments * 0.1));
        
        // 4. Locality Relevance Score (Strong Geo-Weighting / Distance Priority Buckets)
        const distance = parseFloat(post.distance_km || 0.1);
        let localityScore = 0.0;
        
        if (distance <= 2.0) {
            // 0–2 km: VERY HIGH priority (0.9 to 1.0)
            localityScore = 1.0 - (distance * 0.05); 
        } else if (distance <= 5.0) {
            // 2–5 km: HIGH priority (0.7 to 0.9)
            localityScore = 0.9 - ((distance - 2.0) * 0.067);
        } else if (distance <= 10.0) {
            // 5–10 km: MEDIUM priority (0.4 to 0.7)
            localityScore = 0.7 - ((distance - 5.0) * 0.06);
        } else if (distance <= 25.0) {
            // 10–25 km: LOWER priority (0.15 to 0.4)
            localityScore = 0.4 - ((distance - 10.0) * 0.0167);
        } else {
            // 25km+: ONLY if highly viral/trending
            const isViral = trendingVelocity >= 0.6 || rawLikes >= 50;
            if (!isViral) {
                // Return 0 overall score to suppress far-away posts that aren't trending
                console.log(`[LOCALITY_MATCH] Suppressing far-away completed_job_post ${post.id} (distance: ${distance.toFixed(1)}km) due to lack of trending velocity.`);
                return { finalScore: 0.0, freshnessScore: 0.0, engagementScore: 0.0, localityScore: 0.0, completionQualityScore: 0.0, workerReliabilityScore: 0.0, trendingVelocity: 0.0, personalizationScore: 0.0, fraudRiskScore: 0.0 };
            }
            // If highly viral, give a low base geo-score
            localityScore = 0.15 * trendingVelocity;
        }
        
        console.log(`[LOCALITY_MATCH] completed_job_post ${post.id} distance: ${distance.toFixed(2)}km, localityScore: ${localityScore.toFixed(3)}`);
        
        // 5. Completion Quality Score (worker rating based)
        const ratingVal = parseFloat(post.worker_rating || 4.5);
        const completionQualityScore = Math.min(1.0, ratingVal / 5.0);
        
        // 6. Worker Reliability Score
        const reliabilityVal = parseFloat(post.worker_reliability || 1.0);
        const workerReliabilityScore = Math.min(1.0, reliabilityVal);
        
        // 7. Personalization Score (locality, history, category affinity boosts)
        let personalizationScore = 0.5;
        if (userId) {
            // A. Check worker affinity (has hired in the past)
            const affinityRes = await db.query(
                "SELECT hire_count FROM user_worker_affinity WHERE user_id = $1 AND worker_id = $2",
                [userId, post.worker_id]
            );
            
            // B. Check user preferred categories from completed job history
            const prefRes = await db.query(`
                SELECT category, COUNT(*) as count 
                FROM jobs 
                WHERE user_id = $1 AND status = 'COMPLETED' 
                GROUP BY category 
                ORDER BY count DESC 
                LIMIT 1
            `, [userId]);
            
            let preferredCategory = null;
            if (prefRes.rows.length > 0) {
                preferredCategory = prefRes.rows[0].category;
            }
            
            const categoryMatch = preferredCategory && preferredCategory.toLowerCase() === post.category.toLowerCase();
            
            if (affinityRes.rows.length > 0 || categoryMatch) {
                personalizationScore = 1.0;
                console.log(`[PERSONALIZATION_SCORE] Category match / worker affinity boost applied for post ${post.id} user ${userId}`);
            }
        }
        
        // Locality-first Unified Score Formula (Sum to 1.0)
        const finalScore = 
            (localityScore * W_LOCALITY) +
            (freshnessScore * W_FRESHNESS) +
            (engagementScore * W_ENGAGEMENT) +
            (completionQualityScore * W_QUALITY) +
            (workerReliabilityScore * W_RELIABILITY) +
            (trendingVelocity * W_VELOCITY) +
            (personalizationScore * W_PERSONALIZATION);
            
        const fraudRiskScore = parseFloat(post.fraud_risk_score || 0.0);
        
        console.log(`[ENGAGEMENT_SCORE] completed_job_post ${post.id} final_score=${finalScore.toFixed(4)} [L=${localityScore.toFixed(2)}, F=${freshnessScore.toFixed(2)}, E=${engagementScore.toFixed(2)}, Q=${completionQualityScore.toFixed(2)}]`);
        
        return {
            finalScore: Math.min(1.0, finalScore),
            freshnessScore,
            engagementScore,
            localityScore,
            completionQualityScore: completionQualityScore,
            workerReliabilityScore,
            trendingVelocity,
            personalizationScore,
            fraudRiskScore
        };
    }

    /**
     * Get a single post detail with user specific contextual fields (like `isLiked`, `isSaved`).
     */
    async getPostDetailById(postId, userId = null, userLat = null, userLng = null) {
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
                WHERE p.id = $1 AND p.is_flagged = false
            `, [postId]);
            
            if (res.rows.length === 0) return null;
            const post = res.rows[0];
            
            let isLiked = false;
            let isSaved = false;
            
            if (userId) {
                const likeCheck = await db.query(
                    "SELECT 1 FROM completed_post_likes WHERE post_id = $1 AND user_id = $2",
                    [postId, userId]
                );
                isLiked = likeCheck.rows.length > 0;
                
                const saveCheck = await db.query(
                    "SELECT 1 FROM completed_post_saves WHERE post_id = $1 AND user_id = $2",
                    [postId, userId]
                );
                isSaved = saveCheck.rows.length > 0;
            }
            
            // Calculate real distance if GPS provided
            let distanceText = "Nearby";
            let distanceKm = 0.0;
            if (userLat && userLng && post.location_lat && post.location_lng) {
                const calculateDistance = (lat1, lon1, lat2, lon2) => {
                    const R = 6371; 
                    const dLat = (lat2 - lat1) * Math.PI / 180;
                    const dLon = (lon2 - lon1) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                              Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return R * c;
                };
                distanceKm = calculateDistance(userLat, userLng, parseFloat(post.location_lat), parseFloat(post.location_lng));
                distanceText = distanceKm < 1.0 
                    ? "Under 1 km away" 
                    : `${distanceKm.toFixed(1)} km away`;
            }
            
            // Obfuscate exact addresses to protect user privacy (Only show approximate zone/locality)
            const obfuscateAddress = (addr) => {
                if (!addr) return 'Nearby Locality';
                const parts = addr.split(',');
                if (parts.length > 2) {
                    const cleanParts = parts
                        .map(p => p.trim())
                        .filter(p => {
                            const low = p.toLowerCase();
                            const hasDigit = /\d+/.test(p);
                            const hasAptWord = low.includes('flat') || low.includes('floor') || low.includes('apartment') || low.includes('block') || low.includes('road') || low.includes('street') || low.includes('lane') || low.includes('house');
                            return !hasDigit && !hasAptWord;
                        });
                    if (cleanParts.length >= 2) {
                        return cleanParts.slice(-2).join(', ');
                    }
                    return parts.slice(-2).map(p => p.trim()).join(', ');
                }
                return addr;
            };

            // Format dynamic completion review block
            return {
                id: post.id,
                jobId: post.job_id,
                workerId: post.worker_id,
                userId: post.user_id,
                category: post.category,
                title: post.title || 'Completed Job',
                caption: post.caption || 'Job successfully verified and closed!',
                address: obfuscateAddress(post.address),
                imageUrls: post.image_urls || [],
                likesCount: parseInt(post.likes_count),
                commentsCount: parseInt(post.comments_count),
                savesCount: parseInt(post.saves_count),
                viewsCount: parseInt(post.views_count),
                isLiked,
                isSaved,
                distanceText,
                distanceKm,
                completedAt: post.completed_at || post.created_at,
                worker: {
                    name: post.worker_name || 'Verified Pro',
                    photoUrl: post.worker_photo || '',
                    rating: parseFloat(post.worker_rating || 4.5),
                    jobsCompleted: parseInt(post.worker_jobs_completed || 5)
                }
            };
        } catch (err) {
            console.error('❌ [FEED_RANKING_ERROR] Failed to fetch post detail:', err.message);
            return null;
        }
    }

    /**
     * Query online active worker profiles within a 15km local radius.
     */
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

    /**
     * Invalidate feed caches matching a coordinates geohash.
     */
    async invalidateFeedCache(lat, lng) {
        const uLat = parseFloat(lat);
        const uLng = parseFloat(lng);
        if (isNaN(uLat) || isNaN(uLng)) return;
        
        // Bust key for precision 5 (~4.9km)
        const hash = geoHash.encode(uLat, uLng, 5);
        const cacheKey = `feed_region:${hash}`;
        await redis.del(cacheKey);
        console.log(`🧹 [FEED_RANKING] Invalidated cache for region key: ${cacheKey}`);
    }

    /**
     * Dynamic like toggle.
     */
    async likePost(postId, userId, io) {
        // Toggle record in completed_post_likes
        const selectRes = await db.query(
            "SELECT 1 FROM completed_post_likes WHERE post_id = $1 AND user_id = $2",
            [postId, userId]
        );
        
        const liked = selectRes.rows.length > 0;
        let delta = 0;
        
        if (liked) {
            await db.query("DELETE FROM completed_post_likes WHERE post_id = $1 AND user_id = $2", [postId, userId]);
            delta = -1;
        } else {
            await db.query("INSERT INTO completed_post_likes (post_id, user_id) VALUES ($1, $2)", [postId, userId]);
            delta = 1;
        }
        
        // Update total likes count atomically
        const updateRes = await db.query(
            "UPDATE completed_job_posts SET likes_count = GREATEST(0, likes_count + $1) WHERE id = $2 RETURNING location_lat, location_lng, likes_count",
            [delta, postId]
        );
        
        if (updateRes.rows.length > 0) {
            const row = updateRes.rows[0];
            await this.invalidateFeedCache(row.location_lat, row.location_lng);
            
            // Broadcast live socket updates to geohash room
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

    /**
     * Record dynamic post view.
     */
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

    /**
     * Toggle bookmark save on post.
     */
    async savePost(postId, userId) {
        const selectRes = await db.query(
            "SELECT 1 FROM completed_post_saves WHERE post_id = $1 AND user_id = $2",
            [postId, userId]
        );
        
        const saved = selectRes.rows.length > 0;
        let delta = 0;
        
        if (saved) {
            await db.query("DELETE FROM completed_post_saves WHERE post_id = $1 AND user_id = $2", [postId, userId]);
            delta = -1;
        } else {
            await db.query("INSERT INTO completed_post_saves (post_id, user_id) VALUES ($1, $2)", [postId, userId]);
            delta = 1;
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
        // No-op: production bootstrap uses real completed jobs only
        return;
    }

    /**
     * Create or update completed job post in the social feed when a job is completed or proof is uploaded.
     */
    async createOrUpdateCompletedPost(jobId) {
        try {
            // Fetch job
            const jobRes = await db.query(
                "SELECT * FROM jobs WHERE id = $1",
                [jobId]
            );
            if (jobRes.rows.length === 0) return;
            const job = jobRes.rows[0];

            if (job.status !== 'COMPLETED') {
                console.log(`[FEED_SERVICE] Skipping feed post creation: Job ${jobId} status is ${job.status}`);
                return;
            }

            const imageUrls = job.completion_photo ? [job.completion_photo] : [];

            // Check if post already exists
            const checkRes = await db.query(
                "SELECT id FROM completed_job_posts WHERE job_id = $1",
                [jobId]
            );

            let postId;
            if (checkRes.rows.length > 0) {
                postId = checkRes.rows[0].id;
                // Update existing post
                await db.query(
                    `UPDATE completed_job_posts 
                     SET worker_id = $1, user_id = $2, category = $3, title = $4, caption = $5, 
                         location_lat = $6, location_lng = $7, address = $8, image_urls = $9::jsonb, 
                         completed_at = COALESCE($10, completed_at)
                     WHERE id = $11`,
                    [
                        job.worker_id,
                        job.user_id,
                        job.category,
                        job.title || `${job.category} Job`,
                        job.description || 'Job completed successfully!',
                        job.location_lat,
                        job.location_lng,
                        job.address,
                        JSON.stringify(imageUrls),
                        job.completed_at || new Date(),
                        postId
                    ]
                );
                console.log(`[FEED_SERVICE] Updated completed_job_posts for job ${jobId}`);
            } else {
                // Insert new post
                const insertRes = await db.query(
                    `INSERT INTO completed_job_posts (
                        job_id, worker_id, user_id, category, title, caption, 
                        location_lat, location_lng, address, image_urls, completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
                    RETURNING id`,
                    [
                        jobId,
                        job.worker_id,
                        job.user_id,
                        job.category,
                        job.title || `${job.category} Job`,
                        job.description || 'Job completed successfully!',
                        job.location_lat,
                        job.location_lng,
                        job.address,
                        JSON.stringify(imageUrls),
                        job.completed_at || new Date()
                    ]
                );
                postId = insertRes.rows[0].id;
                console.log(`[FEED_SERVICE] Created completed_job_posts for job ${jobId} (Post ID: ${postId})`);
            }

            // Invalidate regional cache
            await this.invalidateFeedCache(job.location_lat, job.location_lng);

            // Broadcast Socket Event to trending region
            const geoHash6 = geoHash.encode(parseFloat(job.location_lat), parseFloat(job.location_lng), 6);
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`trending:${geoHash6}`).emit('feed_updated', {
                    postId,
                    action: 'complete'
                });
                console.log(`[FEED_SERVICE] Broadcasted feed_updated event to room trending:${geoHash6}`);
            }
        } catch (err) {
            console.error('❌ [FEED_SERVICE] Error in createOrUpdateCompletedPost:', err.message);
        }
    }
}

module.exports = new FeedService();
