const db = require('../config/db');
const localityConfig = require('../config/locality.config');

class LocalityMatchingService {
    constructor() {
        this.levelRadii = localityConfig.levelRadii;
        this.levelsOrder = localityConfig.levelsOrder;
    }

    getRadii() {
        return this.levelRadii;
    }

    /**
     * Resolves matching workers using exactly ONE database query, then partitions them in memory (prevents N+1 database loops!)
     */
    async getWorkersAtLocalityLevel(lat, lng, level, category = null) {
        const radiusKm = this.levelRadii[level];
        if (!radiusKm) {
            throw new Error(`Invalid locality level: ${level}`);
        }

        // Push skill/category filtering directly into SQL query (Step 2: Database indexing optimization)
        let queryText = `
            SELECT w.id, w.full_name, w.phone_number, w.photo_url, w.skills, w.experience, w.rating,
                   w.is_online, w.is_available, w.current_lat, w.current_lng, w.tasks, w.availability_state,
                   earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 AS distance_km
            FROM workers w
            WHERE w.location_cube IS NOT NULL
              AND w.is_online = true
              AND w.is_available = true
              AND w.verification_status = 'VERIFIED'
              AND w.availability_state NOT IN ('SUSPENDED', 'BREAK')
              AND earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 <= $3`;

        const params = [lat, lng, radiusKm];
        
        if (category) {
            queryText += " AND (w.skills ? $4 OR $4 = ANY(w.tasks))";
            params.push(category);
        }

        queryText += " ORDER BY distance_km ASC";

        const res = await db.query(queryText, params);
        
        return res.rows.map(w => ({
            ...w,
            distance_km: parseFloat(w.distance_km || 0)
        }));
    }

    /**
     * Optimized Closest Locality Expansion: Runs a single queries query at the maximum expansion radius, 
     * then sections candidates into Village, Town, etc. in memory.
     */
    async findClosestLocalityLevel(lat, lng, category = null, minCount = 3) {
        const maxLevel = this.levelsOrder[this.levelsOrder.length - 1];
        const maxRadius = this.levelRadii[maxLevel];

        // 1. Fetch all workers up to max radius in one call
        const allWorkers = await this.getWorkersAtLocalityLevel(lat, lng, maxLevel, category);

        // 2. Partition in memory dynamically (avoids multiple sequential database trips)
        for (const lvl of this.levelsOrder) {
            const limit = this.levelRadii[lvl];
            const matchingWorkers = allWorkers.filter(w => w.distance_km <= limit);
            if (matchingWorkers.length >= minCount) {
                return { level: lvl, radiusKm: limit, workers: matchingWorkers };
            }
        }

        return {
            level: 'District',
            radiusKm: this.levelRadii['District'],
            workers: allWorkers.filter(w => w.distance_km <= this.levelRadii['District'])
        };
    }
}

module.exports = new LocalityMatchingService();
