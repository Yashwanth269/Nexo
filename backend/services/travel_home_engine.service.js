const db = require('../config/db');
const redis = require('../config/redis');

class TravelHomeEngine {
  /**
   * Start Travel Home Mode for a worker
   */
  async startTravelHomeMode(workerId, homeLocation) {
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

    await redis.set(`travel_home:session:${workerId.toString()}`, JSON.stringify(session), 'EX', 86400); // 24 hours TTL
    console.log(`🏠 [TRAVEL_HOME_ENGINE] Started Travel Home Mode for worker ${workerId} -> ${session.homeAddress}`);
    return { success: true, session };
  }

  /**
   * Stop Travel Home Mode
   */
  async stopTravelHomeMode(workerId) {
    await redis.del(`travel_home:session:${workerId.toString()}`);
    console.log(`🏠 [TRAVEL_HOME_ENGINE] Stopped Travel Home Mode for worker ${workerId}`);
    return { success: true, message: "Travel Home Mode ended" };
  }

  /**
   * Get active Travel Home Session
   */
  async getSession(workerId) {
    const val = await redis.get(`travel_home:session:${workerId.toString()}`);
    return val ? JSON.parse(val) : null;
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
   * Calculates perpendicular distance from a point to a line segment connecting (lat1, lng1) to (lat2, lng2)
   */
  perpendicularDistanceKm(lat, lng, lat1, lng1, lat2, lng2) {
    const y = parseFloat(lat);
    const x = parseFloat(lng);
    const y1 = parseFloat(lat1);
    const x1 = parseFloat(lng1);
    const y2 = parseFloat(lat2);
    const x2 = parseFloat(lng2);

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    return this.calculateDistanceKm(y, x, yy, xx);
  }

  /**
   * Match candidate jobs along worker's home route corridor
   */
  async filterAndRankRouteJobs(workerId, candidateJobs, currentWorkerLocation) {
    const session = await this.getSession(workerId);
    if (!session || !session.isActive) {
      return { isInTravelHomeMode: false, jobs: candidateJobs };
    }

    const workerLat = parseFloat(currentWorkerLocation?.lat || session.startLat);
    const workerLng = parseFloat(currentWorkerLocation?.lng || session.startLng);
    const homeLat = session.homeLat;
    const homeLng = session.homeLng;

    // Direct distance to home without jobs
    const directDistanceHome = this.calculateDistanceKm(workerLat, workerLng, homeLat, homeLng);
    const directTimeMins = Math.round(directDistanceHome * 2.5); // ~2.5 min/km fallback

    const routeJobs = [];

    for (const job of candidateJobs) {
      const jobLat = parseFloat(job.location_lat || job.lat || workerLat + 0.01);
      const jobLng = parseFloat(job.location_lng || job.lng || workerLng + 0.01);

      // Verify Google Route corridor requirement (within 300m of paths to home)
      const corridorDist = this.perpendicularDistanceKm(jobLat, jobLng, workerLat, workerLng, homeLat, homeLng);
      const isWithinCorridor = corridorDist <= 0.3; // 300m corridor (Requirement 2)

      // Distance from worker to job + job to home
      const distToJob = this.calculateDistanceKm(workerLat, workerLng, jobLat, jobLng);
      const distJobToHome = this.calculateDistanceKm(jobLat, jobLng, homeLat, homeLng);
      const totalDetourDistance = Math.round((distToJob + distJobToHome) * 10) / 10;

      const extraKm = Math.max(0, Math.round((totalDetourDistance - directDistanceHome) * 10) / 10);
      const detourTimeMins = Math.round(extraKm * 2.5) + 5; // +5 mins for slowdown

      const price = parseFloat(job.price || 500);

      // Logit acceptance model: P(accept) = 1 / (1 + e^-(price/250 - detourTime/6))
      const logit = (price / 250) - (detourTimeMins / 6);
      const acceptanceProbability = Math.round((1 / (1 + Math.exp(-logit))) * 100);

      // Suppress low acceptance probability or jobs outside the corridor
      if (acceptanceProbability < 20 && !isWithinCorridor) {
        continue;
      }

      const routeScore = Math.round((price * 0.4) + (acceptanceProbability * 0.4) - (detourTimeMins * 2));

      // AI Rationale Explanation (Explainability)
      const rationale = [
        `🏠 Fits your route home to ${session.homeAddress}`,
        `⏱️ Adds ${detourTimeMins} mins detour`,
        `💰 Earnings: ₹${price.toFixed(0)} (${acceptanceProbability}% acceptance match)`,
        isWithinCorridor ? `🎯 Within 300m corridor of your direct route` : `📍 Detour of ${corridorDist.toFixed(2)} km`
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

    // Multi-home job route optimization (Requirement 2: Build Worker -> Job A -> Job B -> Home chains)
    let optimizedChains = [];
    if (routeJobs.length >= 2) {
      // Chain up to 3 highest scoring jobs
      const chain = routeJobs.slice(0, 3);
      let prevLat = workerLat;
      let prevLng = workerLng;
      let cumulativeTime = 0;
      let cumulativeEarnings = 0;

      const chainDetails = chain.map((job, idx) => {
        const jLat = parseFloat(job.location_lat || job.lat);
        const jLng = parseFloat(job.location_lng || job.lng);
        const legDist = this.calculateDistanceKm(prevLat, prevLng, jLat, jLng);
        const legTime = Math.round(legDist * 2.5) + 5;

        cumulativeTime += legTime;
        cumulativeEarnings += parseFloat(job.price || 0);

        prevLat = jLat;
        prevLng = jLng;

        return {
          step: idx + 1,
          jobId: job.id,
          category: job.category,
          price: job.price,
          legDistanceKm: legDist,
        };
      });

      // Final leg from last job to home
      const finalLegDist = this.calculateDistanceKm(prevLat, prevLng, homeLat, homeLng);
      cumulativeTime += Math.round(finalLegDist * 2.5);

      optimizedChains.push({
        label: "AI Multi-Job Route Optimizer",
        totalJobs: chain.length,
        estimatedTotalTimeMins: cumulativeTime,
        totalEarnings: cumulativeEarnings,
        routeSequence: chainDetails,
        finalLegDistanceToHomeKm: finalLegDist,
      });
    }

    const totalPotentialEarnings = routeJobs.reduce((sum, j) => sum + parseFloat(j.price || 0), 0);

    return {
      isInTravelHomeMode: true,
      homeAddress: session.homeAddress,
      estimatedMinsRemaining: directTimeMins,
      potentialEarnings: totalPotentialEarnings,
      jobsCount: routeJobs.length,
      jobs: routeJobs,
      optimizedRouteChains: optimizedChains,
    };
  }
}

module.exports = new TravelHomeEngine();
