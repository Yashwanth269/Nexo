const db = require('../config/db');

class CommissionService {
    async getCommissionRate(category) {
        const res = await db.query(
            `SELECT commission_rate, min_fee, max_fee FROM commission_config WHERE category = $1 AND is_active = TRUE`,
            [category]
        );

        if (res.rowCount === 0) {
            const defaultRes = await db.query(
                `SELECT commission_rate, min_fee, max_fee FROM commission_config WHERE category = 'OTHER' AND is_active = TRUE`
            );
            if (defaultRes.rowCount === 0) {
                return { rate: 0.10, minFee: 0, maxFee: null };
            }
            const row = defaultRes.rows[0];
            return { rate: parseFloat(row.commission_rate), minFee: parseFloat(row.min_fee), maxFee: row.max_fee ? parseFloat(row.max_fee) : null };
        }

        const row = res.rows[0];
        return { rate: parseFloat(row.commission_rate), minFee: parseFloat(row.min_fee), maxFee: row.max_fee ? parseFloat(row.max_fee) : null };
    }

    calculateFee(amount, commissionConfig) {
        let fee = amount * commissionConfig.rate;
        if (fee < commissionConfig.minFee) fee = commissionConfig.minFee;
        if (commissionConfig.maxFee && fee > commissionConfig.maxFee) fee = commissionConfig.maxFee;
        return Math.round(fee * 100) / 100;
    }

    async computeCommission(amount, category) {
        const config = await this.getCommissionRate(category);
        const fee = this.calculateFee(amount, config);
        return {
            platformFee: fee,
            workerEarnings: amount - fee,
            rate: config.rate,
            minFee: config.minFee,
            maxFee: config.maxFee,
        };
    }

    async updateCommissionRate(category, commissionRate, minFee = 0, maxFee = null) {
        const res = await db.query(
            `INSERT INTO commission_config (category, commission_rate, min_fee, max_fee)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (category)
             DO UPDATE SET commission_rate = $2, min_fee = $3, max_fee = $4, updated_at = NOW()
             RETURNING *`,
            [category, commissionRate, minFee, maxFee]
        );
        return res.rows[0];
    }

    async getAllRates() {
        const res = await db.query(
            `SELECT * FROM commission_config WHERE is_active = TRUE ORDER BY category`
        );
        return res.rows;
    }
}

module.exports = new CommissionService();
