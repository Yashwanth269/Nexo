const db = require('../config/db');
const redis = require('../config/redis');

class SearchRadiusService {
    getMultipliers() {
        const hour = new Date().getHours();
        const isNightMode = hour >= 22 || hour < 5;
        const isPeakHours = (hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21);

        let multiplier = 1.0;
        if (isNightMode) multiplier *= 1.2;
        if (isPeakHours) multiplier *= 0.8;

        return { multiplier, isNightMode, isPeakHours };
    }

    getDispatchStages(category, isEmergency = false) {
        const isRural = ['Agriculture', 'Labour', 'Transport', 'Construction'].includes(category);
        const { multiplier } = this.getMultipliers();

        let baseStages;
        if (isEmergency) {
            baseStages = [
                { elapsed: 0,   radius: 8,  tiers: ['A'],                notifyCount: 5,  statusMsg: "Emergency dispatch: closest responders...", searchState: 1 },
                { elapsed: 20,  radius: 15, tiers: ['A'],                notifyCount: 8,  statusMsg: "Emergency dispatch: expanding responder circle...", searchState: 2 },
                { elapsed: 40,  radius: 25, tiers: ['A', 'B'],           notifyCount: 12, statusMsg: "Emergency dispatch: contacting all nearby responders...", searchState: 3 },
                { elapsed: 60,  radius: 40, tiers: ['A', 'B', 'C'],      notifyCount: 20, statusMsg: "Emergency dispatch: broadcast wider area...", searchState: 4 },
                { elapsed: 80,  radius: 50, tiers: ['A', 'B', 'C'],      notifyCount: 30, statusMsg: "Emergency dispatch: final expansion...", searchState: 4 },
                { elapsed: 100, radius: 60, tiers: ['A', 'B', 'C', 'D'], notifyCount: 50, statusMsg: "Emergency dispatch: seeking any available responder...", searchState: 4 }
            ];
        } else if (isRural) {
            baseStages = [
                { elapsed: 0,   radius: 5,  tiers: ['A'],                notifyCount: 3,  statusMsg: "Finding the best workers near you...",            searchState: 1 },
                { elapsed: 20,  radius: 10, tiers: ['A'],                notifyCount: 5,  statusMsg: "Expanding search nearby...",                      searchState: 2 },
                { elapsed: 40,  radius: 15, tiers: ['A'],                notifyCount: 5,  statusMsg: "Searching more nearby professionals...",          searchState: 2 },
                { elapsed: 60,  radius: 20, tiers: ['A', 'B'],           notifyCount: 7,  statusMsg: "We're finding more professionals around your area...", searchState: 3 },
                { elapsed: 80,  radius: 30, tiers: ['A', 'B'],           notifyCount: 7,  statusMsg: "Almost there. Searching in nearby towns.",        searchState: 3 },
                { elapsed: 100, radius: 40, tiers: ['A', 'B', 'C'],      notifyCount: 10, statusMsg: "Searching across a wider area...",                 searchState: 4 }
            ];
        } else {
            // Urban
            baseStages = [
                { elapsed: 0,   radius: 3,  tiers: ['A'],                notifyCount: 3,  statusMsg: "Finding the best workers near you...",            searchState: 1 },
                { elapsed: 20,  radius: 5,  tiers: ['A'],                notifyCount: 5,  statusMsg: "Expanding search nearby...",                      searchState: 2 },
                { elapsed: 40,  radius: 8,  tiers: ['A'],                notifyCount: 5,  statusMsg: "Searching more nearby professionals...",          searchState: 2 },
                { elapsed: 60,  radius: 12, tiers: ['A', 'B'],           notifyCount: 7,  statusMsg: "We're finding more professionals around your area...", searchState: 3 },
                { elapsed: 80,  radius: 20, tiers: ['A', 'B'],           notifyCount: 7,  statusMsg: "Almost there. Searching in nearby towns.",        searchState: 3 },
                { elapsed: 100, radius: 30, tiers: ['A', 'B', 'C'],      notifyCount: 10, statusMsg: "Searching across a wider area...",                 searchState: 4 }
            ];
        }

        // Apply night/peak multipliers to the radii (keeping within safe bounds of 1km to 100km)
        return baseStages.map(stage => {
            const adjustedRadius = Math.max(1, Math.min(100, Math.round(stage.radius * multiplier)));
            return {
                ...stage,
                radius: adjustedRadius
            };
        });
    }

    getMaxRadius(category, isEmergency = false) {
        const stages = this.getDispatchStages(category, isEmergency);
        return stages[stages.length - 1].radius;
    }

    getRankingRadius(category) {
        // Double the maximum dispatch radius for ranking/top-rated search to give a broad coverage
        return this.getMaxRadius(category) * 2;
    }

    async calculateRadius(lat, lng, category = null) {
        // Keep compatibility with legacy callers
        const stages = this.getDispatchStages(category);
        return stages[2].radius; // return a middle stage radius as baseline
    }

    async logRadius(jobId, category, baseRadius, adjustedRadius, demandPressure, workerSupply, candidatesFound) {
        try {
            await db.query(`
                INSERT INTO search_radius_log (job_id, category, base_radius_km, adjusted_radius_km, demand_pressure, worker_supply, hour_of_day, candidates_found)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [jobId, category, baseRadius, adjustedRadius, demandPressure, workerSupply, new Date().getHours(), candidatesFound]);
        } catch (e) {
            // Non-critical
        }
    }
}

module.exports = new SearchRadiusService();
