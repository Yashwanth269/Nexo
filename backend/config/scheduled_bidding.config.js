module.exports = {
    // Scheduled Bidding Engine Configuration
    minScheduledHoursForBidding: 3.0, // Scheduled start time must be > 3 hours from current time
    finalSelectionDeadlineMinutes: 60, // Customer must select worker before scheduled_at - 60 minutes (e.g. 5:00 PM for 6:00 PM job)
    fallbackDeadlineMinutes: 45, // Automatic fallback triggers at scheduled_at - 45 minutes if customer hasn't selected
    
    // Configurable Fallback Strategy: 'AUTO_ASSIGN_HIGHEST_RANKED' | 'CANCEL_BOOKING' | 'ESCALATE_OPS'
    fallbackStrategy: process.env.SCHEDULED_BIDDING_FALLBACK || 'AUTO_ASSIGN_HIGHEST_RANKED',

    // Automated Reminders Schedule (minutes before service)
    reminderIntervalsMinutes: [
        180, // 3 hours before service
        120, // 2 hours before service
        90,  // 90 minutes before service
        75,  // 75 minutes before service
        60   // 60 minutes before service (Final mandatory selection prompt)
    ]
};
