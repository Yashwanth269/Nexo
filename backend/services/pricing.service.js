const redis = require('../config/redis');
const mlDataLogger = require('./ml_data_logger.service');

const A_B_TEST_RATE = 0.30;

class PricingService {
    async calculateSurge(lat, lng, category = null) {
        const activeWorkers = await redis.get('metrics:active_workers') || 10;
        const pendingJobs = await redis.get('metrics:pending_jobs') || 5;

        const demand = parseFloat(pendingJobs);
        const supply = Math.max(1, parseFloat(activeWorkers));
        const ratio = demand / supply;

        const hour = new Date().getHours();
        const isPeakHours = (hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21);

        let surge = 1.0;
        let surgeReason = null;
        if (ratio > 0.8) {
            surge = Math.min(1 + (ratio * 0.25), 2.0);
            surgeReason = "High demand in your area";
        } else if (isPeakHours) {
            surge = 1.2;
            surgeReason = "Peak hours multiplier";
        }
        return {
            multiplier: parseFloat(surge.toFixed(2)),
            reason: surgeReason,
            isSurgeActive: surge > 1.0,
        };
    }

    async getPriceDetails(basePrice, lat, lng, category = null, jobId = null) {
        const { multiplier, reason, isSurgeActive } = await this.calculateSurge(lat, lng, category);
        const baseMultiplier = multiplier;

        let finalMultiplier = baseMultiplier;
        let testGroup = 'CONTROL';

        if (Math.random() < A_B_TEST_RATE) {
            const variation = (Math.random() * 0.2) - 0.1;
            testGroup = variation < 0 ? 'VARIANT_A' : 'VARIANT_B';
            finalMultiplier = Math.max(0.5, Math.min(3.0, baseMultiplier * (1 + variation)));
        }

        const finalPrice = Math.round(basePrice * finalMultiplier);
        const surgeAmount = finalPrice - basePrice;

        if (jobId) {
            await mlDataLogger.logPriceTest(jobId, basePrice, finalPrice, finalMultiplier, testGroup);
        }

        return {
            basePrice,
            finalPrice,
            surgeAmount,
            multiplier: finalMultiplier,
            reason,
            isSurgeActive,
            testGroup,
        };
    }
}

module.exports = new PricingService();
