// In-memory Redis simulation for worker presence store: workerId -> presenceObject
const workerPresenceMap = new Map();
const idempotencyStore = new Map(); // idempotencyKey -> response

class WorkerPresenceService {
  /**
   * Process 20s Heartbeat from Worker App (Chapter 39)
   */
  processHeartbeat(workerId, payload) {
    const wId = workerId.toString();
    const now = new Date();

    const presence = {
      workerId: wId,
      status: "ONLINE", // ACTIVE
      lat: parseFloat(payload.lat || 12.9352),
      lng: parseFloat(payload.lng || 77.6245),
      batteryLevel: payload.batteryLevel || 85,
      speed: payload.speed || 0,
      isSocketConnected: payload.isSocketConnected !== false,
      lastSeen: now.toISOString(),
      lastHeartbeatTime: now.getTime(),
      activeZone: payload.zone || "zone:koramangala",
      category: payload.category || "electricians",
    };

    workerPresenceMap.set(wId, presence);
    console.log(`💓 [PRESENCE_HEARTBEAT] Worker ${wId} heartbeat received. Battery: ${presence.batteryLevel}%`);
    return { success: true, presence };
  }

  /**
   * Evaluate Presence Timeout State Machine (60s -> STALE, 90s -> OFFLINE)
   */
  evaluatePresenceTimeouts() {
    const now = Date.now();
    let staleCount = 0;
    let offlineCount = 0;

    for (const [wId, presence] of workerPresenceMap.entries()) {
      const elapsedSeconds = (now - presence.lastHeartbeatTime) / 1000;

      if (elapsedSeconds >= 90) {
        presence.status = "OFFLINE";
        offlineCount++;
      } else if (elapsedSeconds >= 60) {
        presence.status = "STALE";
        staleCount++;
      }
    }

    return { totalWorkers: workerPresenceMap.size, staleCount, offlineCount };
  }

  /**
   * Get Active Worker Presence
   */
  getPresence(workerId) {
    const presence = workerPresenceMap.get(workerId.toString());
    if (!presence) return null;

    // Check if stale/offline dynamically
    const elapsedSeconds = (Date.now() - presence.lastHeartbeatTime) / 1000;
    if (elapsedSeconds >= 90) presence.status = "OFFLINE";
    else if (elapsedSeconds >= 60) presence.status = "STALE";

    return presence;
  }

  /**
   * Chapter 40 — Targeted Socket Room Resolution
   */
  getTargetedRooms(job) {
    const category = (job.category || 'electricians').toLowerCase();
    const zone = (job.address || job.location_name || 'koramangala').toLowerCase().replace(/\s+/g, '_');

    return [
      `category:${category}`,
      `zone:${zone}`,
      `job:${job.id || 'new'}`,
    ];
  }

  /**
   * Chapter 44 — Idempotency Engine
   */
  checkIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null;
    return idempotencyStore.get(idempotencyKey) || null;
  }

  saveIdempotency(idempotencyKey, response) {
    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, response);
    }
  }
}

module.exports = new WorkerPresenceService();
