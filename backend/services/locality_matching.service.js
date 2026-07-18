const db = require('../config/db');

class LocalityMatchingService {
    constructor() {
        this.levelRadii = {
            'Village': 2.0,
            'Gram Panchayat': 5.0,
            'Town': 10.0,
            'Taluk': 20.0,
            'District': 40.0,
            'Nearby District': 100.0,
            'State': 300.0
        };
        this.levelsOrder = ['Village', 'Gram Panchayat', 'Town', 'Taluk', 'District', 'Nearby District', 'State'];
    }

    getRadii() {
        return this.levelRadii;
    }

    async getWorkersAtLocalityLevel(lat, lng, level, category = null) {
        const radiusKm = this.levelRadii[level];
        if (!radiusKm) {
            throw new Error(`Invalid locality level: ${level}`);
        }

        let queryText = `
            SELECT w.*,
                   earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 AS distance_km
            FROM workers w
            WHERE w.location_cube IS NOT NULL
              AND w.is_online = true
              AND w.is_available = true
              AND w.verification_status = 'VERIFIED'
              AND earth_distance(ll_to_earth($1, $2), w.location_cube) / 1000.0 <= $3
            ORDER BY distance_km ASC`;

        const res = await db.query(queryText, [lat, lng, radiusKm]);
        
        let workers = res.rows.map(w => ({
            ...w,
            distance_km: parseFloat(w.distance_km || 0)
        }));

        if (category) {
            const catLower = category.toLowerCase();
            const matchingService = require('./matching.service');
            workers = workers.filter(w => {
                if (!w.skills || !Array.isArray(w.skills)) return false;
                return w.skills.some(s => {
                    const sLower = s.toLowerCase();
                    return sLower.includes(catLower) || catLower.includes(sLower);
                });
            });
        }

        return workers;
    }

    async findClosestLocalityLevel(lat, lng, category = null, minCount = 3) {
        for (const level of this.levelsOrder) {
            const workers = await this.getWorkersAtLocalityLevel(lat, lng, level, category);
            if (workers.length >= minCount) {
                return { level, radiusKm: this.levelRadii[level], workers };
            }
        }
        // Fallback to district if none found
        return {
            level: 'District',
            radiusKm: this.levelRadii['District'],
            workers: []
        };
    }
}

module.exports = new LocalityMatchingService();
