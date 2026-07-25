const redis = require('../config/redis');

class WorkerPresenceService {
  /**
   * Process 20s Heartbeat from Worker App (Chapter 39)
   */
  async processHeartbeat(workerId, payload) {
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

    // Store in Redis with a 5-minute (300s) TTL expiration fallback
    await redis.set(`worker_presence:${wId}`, JSON.stringify(presence), 'EX', 300);
    console.log(`💓 [PRESENCE_HEARTBEAT] Worker ${wId} heartbeat received. Battery: ${presence.batteryLevel}%`);
    return { success: true, presence };
  }

  /**
   * Evaluate Presence Timeout State Machine (60s -> STALE, 90s -> OFFLINE)
   */
  async evaluatePresenceTimeouts() {
    const now = Date.now();
    let staleCount = 0;
    let offlineCount = 0;

    const keys = await redis.keys("worker_presence:*");
    for (const key of keys) {
      const val = await redis.get(key);
      if (!val) continue;

      const presence = JSON.parse(val);
      const elapsedSeconds = (now - presence.lastHeartbeatTime) / 1000;

      if (elapsedSeconds >= 90) {
        presence.status = "OFFLINE";
        offlineCount++;
        await redis.set(key, JSON.stringify(presence), 'EX', 300);
      } else if (elapsedSeconds >= 60) {
        presence.status = "STALE";
        staleCount++;
        await redis.set(key, JSON.stringify(presence), 'EX', 300);
      }
    }

    return { totalWorkers: keys.length, staleCount, offlineCount };
  }

  /**
   * Get Active Worker Presence
   */
  async getPresence(workerId) {
    const val = await redis.get(`worker_presence:${workerId.toString()}`);
    if (!val) return null;

    const presence = JSON.parse(val);
    const elapsedSeconds = (Date.now() - presence.lastHeartbeatTime) / 1000;
    
    let changed = false;
    if (elapsedSeconds >= 90 && presence.status !== "OFFLINE") {
      presence.status = "OFFLINE";
      changed = true;
    } else if (elapsedSeconds >= 60 && presence.status === "ONLINE") {
      presence.status = "STALE";
      changed = true;
    }

    if (changed) {
      await redis.set(`worker_presence:${workerId.toString()}`, JSON.stringify(presence), 'EX', 300);
    }

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
  async checkIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null;
    const val = await redis.get(`idempotency:${idempotencyKey}`);
    return val ? JSON.parse(val) : null;
  }

  async saveIdempotency(idempotencyKey, response) {
    if (idempotencyKey) {
      await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify(response), 'EX', 86400); // 24 hours TTL
    }
  }
}

module.exports = new WorkerPresenceService();
