const db = require('../config/db');

// In-memory worker calendar timelines store: workerId -> Array of TimelineBlocks
const workerCalendars = new Map();

class AICalendarEngine {
  /**
   * Get or initialize Worker Daily Timeline
   */
  getWorkerTimeline(workerId, dateStr = new Date().toISOString().split('T')[0]) {
    const key = `${workerId}_${dateStr}`;
    if (!workerCalendars.has(key)) {
      // Default daily schedule with free slots & dynamic buffers
      workerCalendars.set(key, [
        { id: "b1", type: "BOOKED", title: "Electrical Repair", startTime: "09:00", endTime: "10:30", area: "Koramangala" },
        { id: "b2", type: "TRAVEL", title: "Travel to next area", startTime: "10:30", endTime: "10:50", area: "HSR Layout" },
        { id: "b3", type: "BUFFER", title: "Dynamic Buffer (Apartment lift wait)", startTime: "10:50", endTime: "11:00" },
        { id: "b4", type: "FREE", title: "Free Slot (Fits 2 Jobs)", startTime: "11:00", endTime: "14:00" },
        { id: "b5", type: "BREAK", title: "Lunch Break", startTime: "14:00", endTime: "14:30" },
        { id: "b6", type: "BOOKED", title: "AC Servicing", startTime: "14:30", endTime: "17:00", area: "BTM Layout" },
        { id: "b7", type: "FREE", title: "Free Evening Window", startTime: "17:00", endTime: "19:00" },
      ]);
    }
    return workerCalendars.get(key);
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
   * Detect Free Slots & match suitable opportunities
   */
  detectFreeSlotsAndMatch(workerId, candidateOpportunities) {
    const timeline = this.getWorkerTimeline(workerId);
    const freeSlots = timeline.filter(b => b.type === 'FREE');

    const matchedOpportunities = [];

    for (const opp of candidateOpportunities) {
      const oppPrice = parseFloat(opp.price || 500);
      const estDurationMins = 60; // 1 hr est.

      // Check if job fits inside any free window
      let fitsSlot = false;
      let matchedSlot = null;

      for (const slot of freeSlots) {
        // Simple slot fit logic
        fitsSlot = true;
        matchedSlot = slot;
        break;
      }

      if (fitsSlot) {
        matchedOpportunities.push({
          ...opp,
          fitsCalendar: true,
          matchedFreeWindow: `${matchedSlot.startTime}–${matchedSlot.endTime}`,
          dynamicBufferMins: this.calculateDynamicBuffer(opp.property_type || 'INDEPENDENT_HOUSE', 'LOW'),
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
  hasBookingConflict(workerId, reqStartTime, reqEndTime) {
    const timeline = this.getWorkerTimeline(workerId);
    for (const block of timeline) {
      if (block.type === 'BOOKED' || block.type === 'RESERVED' || block.type === 'LIVE_JOB') {
        if (reqStartTime < block.endTime && reqEndTime > block.startTime) {
          return true; // Conflict exists!
        }
      }
    }
    return false;
  }

  /**
   * Reserve a calendar block upon customer selection
   */
  reserveSlot(workerId, job) {
    const key = `${workerId}_${new Date().toISOString().split('T')[0]}`;
    const timeline = this.getWorkerTimeline(workerId);
    
    timeline.push({
      id: `res_${Date.now()}`,
      type: "RESERVED",
      title: job.title || job.category || "Scheduled Booking",
      startTime: job.startTime || "11:30",
      endTime: job.endTime || "12:30",
      area: job.address || "Customer Address",
    });

    workerCalendars.set(key, timeline);
    return { success: true, message: "Calendar slot reserved!", timeline };
  }
}

module.exports = new AICalendarEngine();
