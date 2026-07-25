const db = require('../config/db');
const redis = require('../config/redis');
const commissionConfig = require('../config/commission.config');

// Financial Precision Helper (avoids float precision errors using smallest unit (cents/paise))
function toSmallestUnit(val) {
    if (val === null || val === undefined) return 0;
    return Math.round(parseFloat(val) * 100);
}

function fromSmallestUnit(cents) {
    return cents / 100.0;
}

// -------------------------------------------------------------
// COMMISSION DATABASE REPOSITORY (Data Access Layer)
// -------------------------------------------------------------
class CommissionRepository {
    async fetchRateConfig(category) {
        const cacheKey = commissionConfig.cache.getCacheKey(category);
        
        // Check cache first
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (cacheErr) {
            console.warn("[COMMISSION-CACHE-WARN] Failed to read from Redis:", cacheErr.message);
        }

        // Fetch from DB
        const res = await db.query(
            `SELECT commission_rate, min_fee, max_fee FROM commission_config 
             WHERE category = $1 AND is_active = TRUE`,
            [category]
        );

        if (res.rowCount > 0) {
            const row = res.rows[0];
            const config = {
                rate: parseFloat(row.commission_rate),
                minFee: parseFloat(row.min_fee),
                maxFee: row.max_fee ? parseFloat(row.max_fee) : null
            };
            
            // Save to cache
            try {
                await redis.set(cacheKey, JSON.stringify(config), 'EX', commissionConfig.cache.ttlSeconds);
            } catch (cacheErr) {
                console.warn("[COMMISSION-CACHE-WARN] Failed to write to Redis:", cacheErr.message);
            }
            return config;
        }
        
        return null;
    }

    async invalidateCache(category) {
        const cacheKey = commissionConfig.cache.getCacheKey(category);
        try {
            await redis.del(cacheKey);
        } catch (cacheErr) {
            console.warn("[COMMISSION-CACHE-WARN] Failed to invalidate Redis cache:", cacheErr.message);
        }
    }
}

// -------------------------------------------------------------
// COMMISSION CALCULATOR (Platform Fee Logic)
// -------------------------------------------------------------
class CommissionCalculator {
    calculatePlatformFee(amount, rateConfig) {
        const amountCents = toSmallestUnit(amount);
        const rate = parseFloat(rateConfig.rate);
        const minFeeCents = toSmallestUnit(rateConfig.minFee);
        const maxFeeCents = rateConfig.maxFee ? toSmallestUnit(rateConfig.maxFee) : null;

        // Platform fee logic in cents/paise
        let feeCents = Math.round(amountCents * rate);
        if (feeCents < minFeeCents) {
            feeCents = minFeeCents;
        }
        if (maxFeeCents !== null && feeCents > maxFeeCents) {
            feeCents = maxFeeCents;
        }

        return fromSmallestUnit(feeCents);
    }
}

// -------------------------------------------------------------
// COMMISSION ADMINISTRATION (Configuration & Audit Logs)
// -------------------------------------------------------------
class CommissionAdministration {
    async updateRate(category, rate, minFee, maxFee, options = {}) {
        const { changedBy, changeReason } = options;
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');

            // 1. Get current config for historical audit
            const currentRes = await client.query(
                `SELECT commission_rate, min_fee, max_fee FROM commission_config 
                 WHERE category = $1 FOR UPDATE`,
                [category]
            );

            let previousRate = null;
            let previousMinFee = null;
            let previousMaxFee = null;

            if (currentRes.rowCount > 0) {
                const prev = currentRes.rows[0];
                previousRate = parseFloat(prev.commission_rate);
                previousMinFee = parseFloat(prev.min_fee);
                previousMaxFee = prev.max_fee ? parseFloat(prev.max_fee) : null;
            }

            // 2. Perform insert/update
            const updateRes = await client.query(
                `INSERT INTO commission_config (category, commission_rate, min_fee, max_fee, updated_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (category)
                 DO UPDATE SET commission_rate = $2, min_fee = $3, max_fee = $4, updated_at = NOW()
                 RETURNING *`,
                [category, rate, minFee, maxFee]
            );

            // 3. Write to versioning history table
            await client.query(
                `INSERT INTO commission_history (
                    category, previous_rate, new_rate, previous_min_fee, new_min_fee,
                    previous_max_fee, new_max_fee, changed_by, change_reason
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    category, 
                    previousRate, 
                    rate, 
                    previousMinFee, 
                    minFee, 
                    previousMaxFee, 
                    maxFee, 
                    changedBy || null, 
                    changeReason || 'Administration Config Update'
                ]
            );

            await client.query('COMMIT');
            return updateRes.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw new Error(`[COMMISSION-ADMIN-ERROR] Failed transaction update: ${err.message}`);
        } finally {
            client.release();
        }
    }
}

// -------------------------------------------------------------
// UNIFIED PLATFORM COMMISSION SERVICE
// -------------------------------------------------------------
class CommissionService {
    constructor() {
        this.repository = new CommissionRepository();
        this.calculator = new CommissionCalculator();
        this.admin = new CommissionAdministration();
    }

    /**
     * Resolves appropriate commission configuration supporting regional & default fallbacks
     */
    async getCommissionConfig(category, region = null) {
        // Try category lookup
        let config = await this.repository.fetchRateConfig(category);

        if (!config) {
            // Category fallback
            console.log(`[COMMISSION-FALLBACK] No commission config for ${category}. Logging fallback usage.`);
            
            // Regional default overrides
            if (region && commissionConfig.regionDefaults[region]) {
                const reg = commissionConfig.regionDefaults[region];
                config = {
                    rate: reg.rate,
                    minFee: reg.minFee,
                    maxFee: null
                };
                console.log(`[COMMISSION-FALLBACK] Region-specific fallback applied for ${region}.`);
            } else {
                // Global fallback from centralized configuration
                config = await this.repository.fetchRateConfig(commissionConfig.defaultPolicy.category);
                if (!config) {
                    config = {
                        rate: commissionConfig.defaultPolicy.rate,
                        minFee: commissionConfig.defaultPolicy.minFee,
                        maxFee: commissionConfig.defaultPolicy.maxFee
                    };
                }
            }
        }

        return config;
    }

    // Retained for backwards compatibility with payment systems
    async getCommissionRate(category) {
        return this.getCommissionConfig(category);
    }

    // Retained for backwards compatibility with payment systems
    calculateFee(amount, commissionConfigObj) {
        return this.calculator.calculatePlatformFee(amount, commissionConfigObj);
    }

    /**
     * Computes platform commission fee and worker earnings
     */
    async computeCommission(amount, category, options = {}) {
        const { region } = options;

        // 1. Inputs validation
        if (!amount || parseFloat(amount) < commissionConfig.validation.minAmount) {
            throw new Error(`[COMMISSION-VALIDATION-ERROR] Amount must be positive and >= ${commissionConfig.validation.minAmount}`);
        }

        // 2. Fetch config
        const config = await this.getCommissionConfig(category, region);

        // 3. Calculate Platform Fee
        const fee = this.calculator.calculatePlatformFee(amount, config);

        return {
            platformFee: fee,
            workerEarnings: fromSmallestUnit(toSmallestUnit(amount) - toSmallestUnit(fee)),
            rate: config.rate,
            minFee: config.minFee,
            maxFee: config.maxFee,
        };
    }

    /**
     * Updates category commission rate config atomically and records version history
     */
    async updateCommissionRate(category, commissionRate, minFee = 0, maxFee = null, options = {}) {
        // 1. Configuration inputs validation
        const rateVal = parseFloat(commissionRate);
        const minFeeVal = parseFloat(minFee);
        const maxFeeVal = maxFee !== null ? parseFloat(maxFee) : null;

        if (rateVal < commissionConfig.validation.minRate || rateVal > commissionConfig.validation.maxRate) {
            throw new Error(`[COMMISSION-VALIDATION-ERROR] Rate must be between ${commissionConfig.validation.minRate} and ${commissionConfig.validation.maxRate}`);
        }
        if (minFeeVal < commissionConfig.validation.minFee) {
            throw new Error(`[COMMISSION-VALIDATION-ERROR] Min fee must be >= ${commissionConfig.validation.minFee}`);
        }
        if (maxFeeVal !== null && maxFeeVal < minFeeVal) {
            throw new Error(`[COMMISSION-VALIDATION-ERROR] Max fee must be greater than or equal to min fee`);
        }

        // 2. Perform atomic transaction
        const updatedConfig = await this.admin.updateRate(category, rateVal, minFeeVal, maxFeeVal, options);

        // 3. Clear Redis Cache
        await this.repository.invalidateCache(category);

        return updatedConfig;
    }

    /**
     * Fetches all active commission rates
     */
    async getAllRates() {
        const res = await db.query(
            `SELECT * FROM commission_config WHERE is_active = TRUE ORDER BY category`
        );
        return res.rows;
    }
}

module.exports = new CommissionService();
