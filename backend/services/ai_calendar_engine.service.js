const db = require('../config/db');
const calendarConfig = require('../config/calendar.config');

// Helper Utilities for Time Conversions
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function dateToMinutesFromMidnight(dateObj) {
  const date = new Date(dateObj);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Resolves a worker identifier (UUID or phone number) to its database UUID
 */
async function resolveWorkerId(workerId) {
  if (!workerId) return null;
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId);
  if (isUUID) return workerId;

  let phone = workerId;
  if (phone.startsWith("+91")) {
    phone = phone.replace("+91", "");
  }

  const res = await db.query(
    "SELECT id FROM workers WHERE phone_number = $1 OR phone_number = $2",
    [workerId, phone]
  );
  if (res.rowCount > 0) {
    return res.rows[0].id;
  }
  return workerId; // fallback
}

class AICalendarEngine {
  /**
   * Get Worker Daily Timeline dynamically constructed from real database reservations
   */
  async getWorkerTimeline(workerId, dateStr = new Date().toISOString().split('T')[0]) {
    const resolvedWorkerId = await resolveWorkerId(workerId);
    
    // Validate UUID format before running DB queries
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedWorkerId);
    if (!isUUID) {
      return [];
    }

    // 1. Establish start and end boundary dates
    const startOfDay = new Date(`${dateStr}T00:00:00`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999`);

    // 2. Fetch confirmed worker calendar events from the database
    const calendarRes = await db.query(
      `SELECT * FROM worker_calendar
       WHERE worker_id = $1
         AND status = 'CONFIRMED'
         AND scheduled_start >= $2 AND scheduled_start <= $3
       ORDER BY scheduled_start ASC`,
      [resolvedWorkerId, startOfDay, endOfDay]
    );

    const occupiedBlocks = [];

    // 3. Populate occupied sub-blocks (travel, buffer, job booked blocks)
    for (const record of calendarRes.rows) {
      const startMin = dateToMinutesFromMidnight(record.scheduled_start);
      const duration = record.estimated_duration_minutes;
      const travelBefore = record.travel_time_before_minutes || 0;
      const bufferBefore = record.buffer_before_minutes || 0;
      const travelAfter = record.travel_time_after_minutes || 0;
      const bufferAfter = record.buffer_after_minutes || 0;

      // Dynamically lookup the nearest zone locality name
      let area = "Customer Location";
      if (record.location_lat && record.location_lng) {
        try {
          const zoneRes = await db.query(
            `SELECT locality FROM marketplace_zones
             ORDER BY (ll_to_earth(center_lat, center_lng) <-> ll_to_earth($1, $2)) ASC
             LIMIT 1`,
            [parseFloat(record.location_lat), parseFloat(record.location_lng)]
          );
          if (zoneRes.rowCount > 0) {
            area = zoneRes.rows[0].locality;
          }
        } catch (zoneErr) {
          console.warn("Failed to resolve locality for calendar entry:", zoneErr.message);
        }
      }

      // TRAVEL before the job
      if (travelBefore > 0) {
        occupiedBlocks.push({
          id: `tr_bef_${record.id}`,
          type: "TRAVEL",
          title: "Travel to next area",
          startTime: minutesToTime(startMin - travelBefore - bufferBefore),
          endTime: minutesToTime(startMin - bufferBefore),
          area,
          startMin: startMin - travelBefore - bufferBefore,
          endMin: startMin - bufferBefore
        });
      }

      // BUFFER before the job
      if (bufferBefore > 0) {
        occupiedBlocks.push({
          id: `buf_bef_${record.id}`,
          type: "BUFFER",
          title: `Dynamic Buffer (${record.service_category})`,
          startTime: minutesToTime(startMin - bufferBefore),
          endTime: minutesToTime(startMin),
          area,
          startMin: startMin - bufferBefore,
          endMin: startMin
        });
      }

      // The actual BOOKED job
      occupiedBlocks.push({
        id: record.id,
        type: "BOOKED",
        title: record.service_category,
        startTime: minutesToTime(startMin),
        endTime: minutesToTime(startMin + duration),
        area,
        startMin,
        endMin: startMin + duration
      });

      // BUFFER after the job
      if (bufferAfter > 0) {
        occupiedBlocks.push({
          id: `buf_aft_${record.id}`,
          type: "BUFFER",
          title: `Dynamic Buffer (${record.service_category})`,
          startTime: minutesToTime(startMin + duration),
          endTime: minutesToTime(startMin + duration + bufferAfter),
          area,
          startMin: startMin + duration,
          endMin: startMin + duration + bufferAfter
        });
      }

      // TRAVEL after the job
      if (travelAfter > 0) {
        occupiedBlocks.push({
          id: `tr_aft_${record.id}`,
          type: "TRAVEL",
          title: "Travel to next area",
          startTime: minutesToTime(startMin + duration + bufferAfter),
          endTime: minutesToTime(startMin + duration + bufferAfter + travelAfter),
          area,
          startMin: startMin + duration + bufferAfter,
          endMin: startMin + duration + bufferAfter + travelAfter
        });
      }
    }

    // Sort all populated blocks chronologically
    occupiedBlocks.sort((a, b) => a.startMin - b.startMin);

    const timeline = [];
    const shiftStartMin = timeToMinutes(calendarConfig.shiftStart);
    const shiftEndMin = timeToMinutes(calendarConfig.shiftEnd);
    let currentMin = shiftStartMin;

    const lunchStartMin = timeToMinutes(calendarConfig.lunchBreakStart);
    const lunchEndMin = lunchStartMin + calendarConfig.lunchBreakDurationMinutes;
    let lunchAdded = false;

    // Helper to push FREE slot dynamically
    const addFreeSlot = (start, end) => {
      const dur = end - start;
      if (dur >= calendarConfig.minFreeSlotDurationMinutes) {
        let title = "Free Window";
        if (start >= timeToMinutes("17:00")) {
          title = "Free Evening Window";
        } else if (dur >= 120) {
          title = "Free Slot (Fits 2 Jobs)";
        }
        timeline.push({
          id: `free_${start}_${end}`,
          type: "FREE",
          title,
          startTime: minutesToTime(start),
          endTime: minutesToTime(end)
        });
      }
    };

    // Helper to evaluate and insert lunch break & free windows in a gap
    const processGap = (start, end) => {
      if (start >= end) return;

      if (!lunchAdded && start < lunchEndMin && end > lunchStartMin) {
        // Lunch break overlaps with the gap
        if (start < lunchStartMin) {
          addFreeSlot(start, lunchStartMin);
        }
        timeline.push({
          id: "lunch_break",
          type: "BREAK",
          title: "Lunch Break",
          startTime: minutesToTime(lunchStartMin),
          endTime: minutesToTime(lunchEndMin)
        });
        lunchAdded = true;
        if (end > lunchEndMin) {
          addFreeSlot(lunchEndMin, end);
        }
      } else {
        addFreeSlot(start, end);
      }
    };

    // 4. Fill in the FREE and BREAK slots between shift hours
    for (const block of occupiedBlocks) {
      if (block.startMin > currentMin) {
        processGap(currentMin, block.startMin);
      }
      timeline.push({
        id: block.id,
        type: block.type,
        title: block.title,
        startTime: block.startTime,
        endTime: block.endTime,
        area: block.area
      });
      currentMin = block.endMin;
    }

    if (currentMin < shiftEndMin) {
      processGap(currentMin, shiftEndMin);
    }

    return timeline;
  }

  /**
   * Calculate Dynamic Buffer based on traffic & property type
   */
  calculateDynamicBuffer(propertyType = 'INDEPENDENT_HOUSE', trafficRisk = 'LOW') {
    let baseBufferMins = 10;
    if (propertyType === 'LUXURY_APARTMENT' || propertyType === 'HIGH_RISE_COMMERCIAL') {
      baseBufferMins += 10; // Extra lift wait time & security gate check
    }
    if (trafficRisk === 'HIGH' || trafficRisk === 'SEVERE') {
      baseBufferMins += 15;
    }
    return baseBufferMins;
  }

  /**
   * Detect Free Slots & match suitable opportunities using dynamic variables
   */
  async detectFreeSlotsAndMatch(workerId, candidateOpportunities) {
    const resolvedWorkerId = await resolveWorkerId(workerId);
    const timeline = await this.getWorkerTimeline(resolvedWorkerId);
    const freeSlots = timeline.filter(b => b.type === 'FREE');

    const matchedOpportunities = [];
    const reservationService = require('./reservation.service');

    for (const opp of candidateOpportunities) {
      // Predict estimated duration dynamically based on category
      let estDurationMins = calendarConfig.defaultDurationMinutes;
      if (opp.category) {
        try {
          estDurationMins = await reservationService.predictJobDuration(opp.category);
        } catch (e) {
          console.warn("Failed to dynamically predict job duration:", e.message);
        }
      }

      // Check if job fits inside any free window
      let fitsSlot = false;
      let matchedSlot = null;

      for (const slot of freeSlots) {
        const slotStartMin = timeToMinutes(slot.startTime);
        const slotEndMin = timeToMinutes(slot.endTime);
        const slotDuration = slotEndMin - slotStartMin;

        if (slotDuration >= estDurationMins) {
          fitsSlot = true;
          matchedSlot = slot;
          break;
        }
      }

      if (fitsSlot) {
        // Determine traffic conditions dynamically using MarketplaceIntelligenceService
        let trafficRisk = 'LOW';
        let propertyType = opp.property_type || opp.propertyType || 'INDEPENDENT_HOUSE';

        try {
          const intelService = require('./marketplace_intelligence.service');
          const workerRes = await db.query("SELECT current_lat, current_lng FROM workers WHERE id = $1", [resolvedWorkerId]);
          if (workerRes.rowCount > 0 && workerRes.rows[0].current_lat && (opp.location_lat || opp.lat)) {
            const w = workerRes.rows[0];
            const wZone = await db.query(
              `SELECT locality FROM marketplace_zones
               ORDER BY (ll_to_earth(center_lat, center_lng) <-> ll_to_earth($1, $2)) ASC
               LIMIT 1`,
              [parseFloat(w.current_lat), parseFloat(w.current_lng)]
            );
            const jZone = await db.query(
              `SELECT locality FROM marketplace_zones
               ORDER BY (ll_to_earth(center_lat, center_lng) <-> ll_to_earth($1, $2)) ASC
               LIMIT 1`,
              [parseFloat(opp.location_lat || opp.lat), parseFloat(opp.location_lng || opp.lng)]
            );
            if (wZone.rowCount > 0 && jZone.rowCount > 0) {
              const trafficAnalysis = intelService.predictTrafficRisk(wZone.rows[0].locality, jZone.rows[0].locality);
              trafficRisk = trafficAnalysis.riskLevel || 'LOW';
            }
          }
        } catch (e) {
          console.warn("Failed to dynamically calculate traffic risk for buffer:", e.message);
        }

        const dynamicBuffer = this.calculateDynamicBuffer(propertyType, trafficRisk);

        matchedOpportunities.push({
          ...opp,
          fitsCalendar: true,
          matchedFreeWindow: `${matchedSlot.startTime}–${matchedSlot.endTime}`,
          dynamicBufferMins: dynamicBuffer,
          calendarFitBadge: "⭐ Perfect Calendar Fit",
        });
      }
    }

    return {
      freeSlotsCount: freeSlots.length,
      freeSlots,
      matchedOpportunities,
    };
  }

  /**
   * Conflict Detection: Check if a requested time conflicts with reserved blocks
   */
  async hasBookingConflict(workerId, reqStartTime, reqEndTime) {
    const resolvedWorkerId = await resolveWorkerId(workerId);
    const timeline = await this.getWorkerTimeline(resolvedWorkerId);
    const reqStartMin = typeof reqStartTime === 'string' ? timeToMinutes(reqStartTime) : dateToMinutesFromMidnight(reqStartTime);
    const reqEndMin = typeof reqEndTime === 'string' ? timeToMinutes(reqEndTime) : dateToMinutesFromMidnight(reqEndTime);

    for (const block of timeline) {
      if (block.type === 'BOOKED' || block.type === 'RESERVED' || block.type === 'LIVE_JOB') {
        const blockStartMin = timeToMinutes(block.startTime);
        const blockEndMin = timeToMinutes(block.endTime);

        if (reqStartMin < blockEndMin && reqEndMin > blockStartMin) {
          return true; // Conflict exists!
        }
      }
    }
    return false;
  }

  /**
   * Reserve a calendar block upon customer selection using actual ReservationService
   */
  async reserveSlot(workerId, job) {
    const resolvedWorkerId = await resolveWorkerId(workerId);
    const reservationService = require('./reservation.service');
    const jobId = job.id || job.bookingId;
    const scheduledStart = job.scheduledAt || job.scheduled_at || job.startTime || new Date();
    const category = job.category || job.title || 'General';
    const lat = parseFloat(job.location_lat || job.lat || 12.9716);
    const lng = parseFloat(job.location_lng || job.lng || 77.5946);

    const result = await reservationService.reserveTimeBlock(resolvedWorkerId, jobId, scheduledStart, category, lat, lng);
    
    if (result.success) {
      const dateStr = new Date(scheduledStart).toISOString().split('T')[0];
      const timeline = await this.getWorkerTimeline(resolvedWorkerId, dateStr);
      return { success: true, message: "Calendar slot reserved!", timeline };
    } else {
      return { success: false, message: result.error || "Reservation failed" };
    }
  }
}

module.exports = new AICalendarEngine();
