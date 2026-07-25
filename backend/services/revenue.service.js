/**
 * Nexo Revenue Streams & Surcharge Engine
 */

const db = require('../config/db');
const incentivesConfig = require('../config/incentives.config');

class RevenueService {
    /**
     * Calculates pricing surcharges (Night Surcharge & Urgent Booking Fee).
     */
    calculateJobSurcharges({ basePrice, isUrgent = false, bookingTime = new Date() }) {
        let finalPrice = parseFloat(basePrice || 0);
        let urgentFee = 0;
        let nightSurcharge = 0;
        let workerUrgentBonus = 0;
        let workerNightBonus = 0;

        // Load surcharges dynamically from centralized configuration (Point 2)
        const surchargesConfig = incentivesConfig.surcharges || {
            urgentBookingFee: 150,
            urgentWorkerBonusPct: 80,
            nightStartHour: 22,
            nightEndHour: 6,
            nightMultiplier: 1.25,
            nightWorkerBonusPct: 60
        };

        // 1. Urgent Booking Surcharge
        if (isUrgent) {
            urgentFee = surchargesConfig.urgentBookingFee;
            workerUrgentBonus = (urgentFee * surchargesConfig.urgentWorkerBonusPct) / 100.0;
            finalPrice += urgentFee;
        }

        // 2. Night Surcharge (10 PM - 6 AM)
        const hour = bookingTime.getHours();
        const isNight = hour >= surchargesConfig.nightStartHour || hour < surchargesConfig.nightEndHour;
        
        if (isNight) {
            nightSurcharge = basePrice * (surchargesConfig.nightMultiplier - 1.0);
            workerNightBonus = (nightSurcharge * surchargesConfig.nightWorkerBonusPct) / 100.0;
            finalPrice += nightSurcharge;
        }

        return {
            basePrice: parseFloat(basePrice),
            finalPrice: parseFloat(finalPrice.toFixed(2)),
            urgentFee: parseFloat(urgentFee.toFixed(2)),
            nightSurcharge: parseFloat(nightSurcharge.toFixed(2)),
            workerUrgentBonus: parseFloat(workerUrgentBonus.toFixed(2)),
            workerNightBonus: parseFloat(workerNightBonus.toFixed(2)),
            isNight
        };
    }

    /**
     * Calculates cancellation fee split between Platform & Worker Compensation.
     */
    calculateCancellationFeeSplit(jobStatus) {
        let totalFee = 0;
        let workerSharePct = 0;

        const cancellationConfig = incentivesConfig.cancellation || {
            acceptedFee: 100,
            workerSharePctAccepted: 70,
            onTheWayFee: 200,
            workerSharePctOnWay: 80
        };

        if (jobStatus === 'ACCEPTED' || jobStatus === 'RESERVED') {
            totalFee = cancellationConfig.acceptedFee;
            workerSharePct = cancellationConfig.workerSharePctAccepted;
        } else if (jobStatus === 'ON_THE_WAY' || jobStatus === 'ARRIVED') {
            totalFee = cancellationConfig.onTheWayFee;
            workerSharePct = cancellationConfig.workerSharePctOnWay;
        }

        const workerCompensation = (totalFee * workerSharePct) / 100.0;
        const platformRevenue = totalFee - workerCompensation;

        return {
            totalFee: parseFloat(totalFee.toFixed(2)),
            workerCompensation: parseFloat(workerCompensation.toFixed(2)),
            platformRevenue: parseFloat(platformRevenue.toFixed(2))
        };
    }

    /**
     * Subscribes customer to a membership tier.
     * Table creation removed from runtime business logic (Point 1).
     */
    async subscribeCustomerMembership(userId, tier) {
        const membershipInfo = incentivesConfig.memberships[tier];
        if (!membershipInfo) {
            return { success: false, message: "INVALID_MEMBERSHIP_TIER" };
        }

        const durationDays = tier === 'MONTHLY' ? 30 : tier === 'QUARTERLY' ? 90 : 365;
        const expiresAt = new Date(Date.now() + durationDays * 86400000);

        const res = await db.query(`
            INSERT INTO customer_memberships (user_id, tier, price, fee_discount_pct, free_cancellations_remaining, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [userId, tier, membershipInfo.price, membershipInfo.feeDiscountPct, membershipInfo.freeCancellationsCount, expiresAt]);

        return { success: true, membership: res.rows[0] };
    }
}

module.exports = new RevenueService();
