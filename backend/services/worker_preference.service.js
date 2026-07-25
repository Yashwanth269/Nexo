// In-memory preference store: workerId -> { areaRatings: {}, skillRatings: {} }
const workerPreferencesStore = new Map();

class WorkerPreferenceService {
  /**
   * Get worker preferences (PAE & PSE)
   */
  getPreferences(workerId) {
    const wId = workerId.toString();
    if (!workerPreferencesStore.has(wId)) {
      // Default preferences if none set
      workerPreferencesStore.set(wId, {
        areaRatings: {
          'Koramangala': 5,
          'HSR Layout': 5,
          'BTM Layout': 4,
          'Whitefield': 4,
          'Indiranagar': 5,
          'Yelahanka': 2,
          'Airport': 0, // Avoided
        },
        skillRatings: {
          'Ceiling Fan Repair': 5,
          'Switch Board Repair': 5,
          'House Wiring': 4,
          'MCB Installation': 4,
          'Solar Installation': 1,
          'Industrial Electrical': 1,
        }
      });
    }
    return workerPreferencesStore.get(wId);
  }

  /**
   * Update Area Ratings (PAE)
   */
  updateAreaRatings(workerId, areaRatings) {
    const prefs = this.getPreferences(workerId);
    prefs.areaRatings = { ...prefs.areaRatings, ...areaRatings };
    workerPreferencesStore.set(workerId.toString(), prefs);
    return { success: true, areaRatings: prefs.areaRatings };
  }

  /**
   * Update Sub-Skill Ratings (PSE)
   */
  updateSkillRatings(workerId, skillRatings) {
    const prefs = this.getPreferences(workerId);
    prefs.skillRatings = { ...prefs.skillRatings, ...skillRatings };
    workerPreferencesStore.set(workerId.toString(), prefs);
    return { success: true, skillRatings: prefs.skillRatings };
  }

  /**
   * Calculate Composite Dispatch Score integrating PAE & PSE formulas
   * Formula: Distance 20% + Preferred Area 25% + Skill Confidence 25% + Payout 15% + Reliability 15%
   */
  calculateDispatchScore(workerId, job, workerDistanceKm, workerReliability = 95) {
    const prefs = this.getPreferences(workerId);

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
    // If area is marked 0 stars (Avoided), severely penalty score
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
