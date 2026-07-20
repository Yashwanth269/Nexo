/**
 * Nexo Revenue Streams & Surcharge Engine
 * 
 * Implements customer memberships, cancellation charge splits, urgent booking fees,
 * and night surcharges (10 PM - 6 AM) based on incentives.config.js.
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

        // 1. Urgent Booking Surcharge
        if (isUrgent) {
            urgentFee = incentivesConfig.surcharges.urgentBookingFee;
            workerUrgentBonus = (urgentFee * incentivesConfig.surcharges.urgentWorkerBonusPct) / 100.0;
            finalPrice += urgentFee;
        }

        // 2. Night Surcharge (10 PM - 6 AM)
        const hour = bookingTime.getHours();
        const isNight = hour >= incentivesConfig.surcharges.nightStartHour || hour < incentivesConfig.surcharges.nightEndHour;
        
        if (isNight) {
            nightSurcharge = basePrice * (incentivesConfig.surcharges.nightMultiplier - 1.0);
            workerNightBonus = (nightSurcharge * incentivesConfig.surcharges.nightWorkerBonusPct) / 100.0;
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

        if (jobStatus === 'ACCEPTED' || jobStatus === 'RESERVED') {
            totalFee = incentivesConfig.cancellation.acceptedFee;
            workerSharePct = incentivesConfig.cancellation.workerSharePctAccepted;
        } else if (jobStatus === 'ON_THE_WAY' || jobStatus === 'ARRIVED') {
            totalFee = incentivesConfig.cancellation.onTheWayFee;
            workerSharePct = incentivesConfig.cancellation.workerSharePctOnWay;
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
     */
    async subscribeCustomerMembership(userId, tier) {
        const membershipInfo = incentivesConfig.memberships[tier];
        if (!membershipInfo) {
            return { success: false, message: "INVALID_MEMBERSHIP_TIER" };
        }

        const durationDays = tier === 'MONTHLY' ? 30 : tier === 'QUARTERLY' ? 90 : 365;

        await db.query(`
            CREATE TABLE IF NOT EXISTS customer_memberships (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                tier VARCHAR(50) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                fee_discount_pct DECIMAL(5,2) NOT NULL,
                free_cancellations_remaining INT NOT NULL,
                starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
