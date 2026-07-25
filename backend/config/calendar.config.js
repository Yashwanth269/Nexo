/**
 * Nexo AI Calendar Engine Configuration
 * 
 * Configurable shift timings, lunch breaks, slot durations,
 * and travel/buffer calculations for worker scheduling.
 */

module.exports = {
    // Standard worker daily shift timing window
    shiftStart: process.env.CALENDAR_SHIFT_START || "08:00",
    shiftEnd: process.env.CALENDAR_SHIFT_END || "20:00",

    // Default duration of a service if not predicted
    defaultDurationMinutes: parseInt(process.env.CALENDAR_DEFAULT_DURATION_MIN || "60", 10),

    // Standard lunch break block window
    lunchBreakStart: process.env.CALENDAR_LUNCH_BREAK_START || "14:00",
    lunchBreakDurationMinutes: parseInt(process.env.CALENDAR_LUNCH_BREAK_DURATION_MIN || "30", 10),

    // Minimum consecutive free minutes required to list a slot as FREE
    minFreeSlotDurationMinutes: parseInt(process.env.CALENDAR_MIN_FREE_SLOT_MIN || "30", 10)
};
