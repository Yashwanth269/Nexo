const db = require('../config/db');

// In-memory active travel home sessions store: workerId -> session
const travelHomeSessions = new Map();

class TravelHomeEngine {
  /**
   * Start Travel Home Mode for a worker
   */
  startTravelHomeMode(workerId, homeLocation) {
    const session = {
      workerId: workerId.toString(),
      homeAddress: homeLocation.address || 'Home',
      homeLat: parseFloat(homeLocation.lat || 12.9141),
      homeLng: parseFloat(homeLocation.lng || 77.6412),
      startLat: parseFloat(homeLocation.startLat || 12.9352),
      startLng: parseFloat(homeLocation.startLng || 77.6245),
      startTime: new Date(),
      gpsUpdateIntervalSeconds: 15, // Battery saver mode
      isActive: true,
    };

    travelHomeSessions.set(workerId.toString(), session);
    console.log(`🏠 [TRAVEL_HOME_ENGINE] Started Travel Home Mode for worker ${workerId} -> ${session.homeAddress}`);
    return { success: true, session };
  }

  /**
   * Stop Travel Home Mode
   */
  stopTravelHomeMode(workerId) {
    travelHomeSessions.delete(workerId.toString());
    console.log(`🏠 [TRAVEL_HOME_ENGINE] Stopped Travel Home Mode for worker ${workerId}`);
    return { success: true, message: "Travel Home Mode ended" };
  }

  /**
   * Get active Travel Home Session
   */
  getSession(workerId) {
    return travelHomeSessions.get(workerId.toString()) || null;
  }

  /**
   * Calculate distance between two lat/lng points (Haversine formula in KM)
   */
  calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round((R * c) * 10) / 10;
  }

  /**
   * Match candidate jobs along worker's home route corridor
   */
  filterAndRankRouteJobs(workerId, candidateJobs, currentWorkerLocation) {
    const session = this.getSession(workerId);
    if (!session || !session.isActive) {
      return { isInTravelHomeMode: false, jobs: candidateJobs };
    }

    const workerLat = parseFloat(currentWorkerLocation?.lat || session.startLat);
    const workerLng = parseFloat(currentWorkerLocation?.lng || session.startLng);
    const homeLat = session.homeLat;
    const homeLng = session.homeLng;

    // Direct distance to home without jobs
    const directDistanceHome = this.calculateDistanceKm(workerLat, workerLng, homeLat, homeLng);
    const directTimeMins = Math.round(directDistanceHome * 2.5); // ~2.5 min/km

    const routeJobs = [];

    for (const job of candidateJobs) {
      const jobLat = parseFloat(job.location_lat || job.lat || workerLat + 0.01);
      const jobLng = parseFloat(job.location_lng || job.lng || workerLng + 0.01);

      // Distance from worker to job + job to home
      const distToJob = this.calculateDistanceKm(workerLat, workerLng, jobLat, jobLng);
      const distJobToHome = this.calculateDistanceKm(jobLat, jobLng, homeLat, homeLng);
      const totalDetourDistance = Math.round((distToJob + distJobToHome) * 10) / 10;

      const extraKm = Math.max(0, Math.round((totalDetourDistance - directDistanceHome) * 10) / 10);
      const detourTimeMins = Math.round(extraKm * 2.5) + 5; // +5 mins for slowdown

      const price = parseFloat(job.price || 500);

      // Detour Constraint: Max 15 mins detour unless payout >= ₹800
      if (detourTimeMins > 15 && price < 800) {
        continue;
      }

      // Acceptance Probability ML model score
      // Logit model: P(accept) = 1 / (1 + e^-(price/200 - detourTime/5))
      const logit = (price / 250) - (detourTimeMins / 6);
      const acceptanceProbability = Math.round((1 / (1 + Math.exp(-logit))) * 100);

      // Suppress low acceptance probability (< 20%)
      if (acceptanceProbability < 20) {
        continue;
      }

      // Route Corridor Score
      const routeScore = Math.round((price * 0.4) + (acceptanceProbability * 0.4) - (detourTimeMins * 2));

      // AI Rationale Explanation
      const rationale = [
        `🏠 Fits your route home to ${session.homeAddress}`,
        `⏱️ Only adds ${detourTimeMins} mins detour`,
        `💰 Earnings: ₹${price.toFixed(0)} (${acceptanceProbability}% acceptance match)`,
        `📍 Job location is ${distToJob} km along your path`
      ];

      routeJobs.push({
        ...job,
        detourTimeMins,
        extraKm,
        acceptanceProbability,
        routeScore,
        rationale,
        isAlongRouteHome: true,
      });
    }

    // Sort by Route Score descending
    routeJobs.sort((a, b) => b.routeScore - a.routeScore);

    const totalPotentialEarnings = routeJobs.reduce((sum, j) => sum + parseFloat(j.price || 0), 0);

    return {
      isInTravelHomeMode: true,
      homeAddress: session.homeAddress,
      estimatedMinsRemaining: directTimeMins,
      potentialEarnings: totalPotentialEarnings,
      jobsCount: routeJobs.length,
      jobs: routeJobs,
    };
  }
}

module.exports = new TravelHomeEngine();
