const db = require('../config/db');

class WorkerPreferenceService {
  /**
   * Get worker preferences (PAE & PSE)
   */
  async getPreferences(workerId) {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
    let resolvedId = workerId;
    if (!isUUID) {
      let phone = workerId;
      if (phone.startsWith("+91")) {
        phone = phone.replace("+91", "");
      }
      const workerRes = await db.query(
        "SELECT id FROM workers WHERE phone_number = $1 OR phone_number = $2",
        [workerId, phone]
      );
      if (workerRes.rowCount > 0) {
        resolvedId = workerRes.rows[0].id;
      }
    }

    const prefRes = await db.query(
      "SELECT * FROM worker_zone_preferences WHERE worker_id = $1",
      [resolvedId]
    );

    let dbPref = prefRes.rows[0];
    if (!dbPref) {
      // Default initial preferences (completely empty/null to avoid fake statistics)
      try {
        const insertRes = await db.query(
          `INSERT INTO worker_zone_preferences (worker_id, primary_zone, work_radius, secondary_zones, avoid_areas, skill_ratings)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [resolvedId, null, 15, [], [], {}]
        );
        dbPref = insertRes.rows[0];
      } catch (err) {
        console.warn("⚠️ Failed to insert default preferences:", err.message);
        dbPref = {
          worker_id: resolvedId,
          primary_zone: null,
          work_radius: 15,
          secondary_zones: [],
          avoid_areas: [],
          skill_ratings: {}
        };
      }
    }

    const areaRatings = {};
    if (dbPref.primary_zone) {
      areaRatings[dbPref.primary_zone] = 5;
    }
    if (dbPref.secondary_zones) {
      dbPref.secondary_zones.forEach(z => { areaRatings[z] = 4; });
    }
    if (dbPref.avoid_areas) {
      dbPref.avoid_areas.forEach(z => { areaRatings[z] = 0; });
    }

    const skillRatings = dbPref.skill_ratings || {};

    return {
      workerId: resolvedId,
      primaryZone: dbPref.primary_zone,
      secondaryZones: dbPref.secondary_zones || [],
      avoidAreas: dbPref.avoid_areas || [],
      workRadius: dbPref.work_radius || 15,
      areaRatings,
      skillRatings
    };
  }

  /**
   * Update Zone Preferences
   */
  async updateZonePreferences(workerId, { primaryZone, secondaryZones, avoidAreas, workRadius }) {
    const prefs = await this.getPreferences(workerId);
    await db.query(
      `INSERT INTO worker_zone_preferences (worker_id, primary_zone, work_radius, secondary_zones, avoid_areas)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (worker_id) DO UPDATE SET
         primary_zone = EXCLUDED.primary_zone,
         work_radius = EXCLUDED.work_radius,
         secondary_zones = EXCLUDED.secondary_zones,
         avoid_areas = EXCLUDED.avoid_areas,
         updated_at = CURRENT_TIMESTAMP`,
      [prefs.workerId, primaryZone, workRadius || 15, secondaryZones || [], avoidAreas || []]
    );
    return { success: true };
  }

  /**
   * Update Area Ratings (PAE)
   */
  async updateAreaRatings(workerId, areaRatings) {
    const primary = Object.keys(areaRatings).find(k => areaRatings[k] === 5);
    const secondary = Object.keys(areaRatings).filter(k => areaRatings[k] === 4);
    const avoid = Object.keys(areaRatings).filter(k => areaRatings[k] === 0);
    const prefs = await this.getPreferences(workerId);
    
    await this.updateZonePreferences(prefs.workerId, {
      primaryZone: primary || prefs.primaryZone,
      secondaryZones: secondary.length > 0 ? secondary : prefs.secondaryZones,
      avoidAreas: avoid.length > 0 ? avoid : prefs.avoidAreas,
      workRadius: prefs.workRadius
    });
    return { success: true, areaRatings };
  }

  /**
   * Update Sub-Skill Ratings (PSE)
   */
  async updateSkillRatings(workerId, skillRatings) {
    const prefs = await this.getPreferences(workerId);
    await db.query(
      `INSERT INTO worker_zone_preferences (worker_id, skill_ratings)
       VALUES ($1, $2)
       ON CONFLICT (worker_id) DO UPDATE SET
         skill_ratings = EXCLUDED.skill_ratings,
         updated_at = CURRENT_TIMESTAMP`,
      [prefs.workerId, JSON.stringify(skillRatings)]
    );
    return { success: true, skillRatings };
  }

  /**
   * Calculate Composite Dispatch Score integrating PAE & PSE formulas
   * Formula: Distance 20% + Preferred Area 25% + Skill Confidence 25% + Payout 15% + Reliability 15%
   */
  async calculateDispatchScore(workerId, job, workerDistanceKm, workerReliability = 95) {
    const prefs = await this.getPreferences(workerId);

    // 1. Distance Score (0-100)
    const distanceScore = Math.max(0, 100 - (workerDistanceKm * 10));

    // 2. PAE Area Rating Score (0-100)
    const jobArea = job.address || job.location_name || 'General';
    let areaStars = 3; // Default 3 stars if unknown
    for (const [area, stars] of Object.entries(prefs.areaRatings)) {
      if (jobArea.toLowerCase().includes(area.toLowerCase())) {
        areaStars = stars;
        break;
      }
    }
    // If area is marked 0 stars (Avoided), severe penalty score
    const areaScore = areaStars === 0 ? -100 : (areaStars / 5.0) * 100;

    // 3. PSE Skill Confidence Score (0-100)
    const jobTitle = job.title || job.category || 'General';
    let skillStars = 4;
    for (const [skill, stars] of Object.entries(prefs.skillRatings)) {
      if (jobTitle.toLowerCase().includes(skill.toLowerCase())) {
        skillStars = stars;
        break;
      }
    }
    const skillScore = (skillStars / 5.0) * 100;

    // 4. Payout Score (0-100)
    const price = parseFloat(job.price || 500);
    const payoutScore = Math.min(100, (price / 2000) * 100);

    // 5. Reliability Score (0-100)
    const reliabilityScore = workerReliability;

    // Weighted Formula
    const compositeScore = Math.round(
      (distanceScore * 0.20) +
      (areaScore * 0.25) +
      (skillScore * 0.25) +
      (payoutScore * 0.15) +
      (reliabilityScore * 0.15)
    );

    return {
      compositeScore: Math.max(0, compositeScore),
      areaStars,
      skillStars,
      isAvoidedArea: areaStars === 0,
      breakdown: {
        distanceScore: Math.round(distanceScore),
        areaScore: Math.round(areaScore),
        skillScore: Math.round(skillScore),
        payoutScore: Math.round(payoutScore),
        reliabilityScore: Math.round(reliabilityScore),
      }
    };
  }
}

module.exports = new WorkerPreferenceService();
