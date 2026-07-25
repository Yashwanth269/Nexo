const db = require('../config/db');
const redis = require('../config/redis');
const crypto = require('crypto');
const flagConfig = require('../config/feature_flag.config');

class FeatureFlagService {
    _getRedisKey(flagName) {
        return `${flagConfig.redisNamespace}${flagName}`;
    }

    /**
     * Checks if a feature flag is enabled for the provided context
     */
    async isEnabled(flagName, context = {}) {
        // 1. Evaluate emergency global kill switch list first
        if (flagConfig.globalKillSwitches[flagName]) {
            return false;
        }

        try {
            const cacheKey = this._getRedisKey(flagName);
            let flagData = await redis.get(cacheKey);

            if (!flagData) {
                // Cache Miss: Query DB
                const res = await db.query(
                    "SELECT enabled, rollout_percentage, rules, prerequisites FROM feature_flags WHERE flag_name = $1", 
                    [flagName]
                );
                if (res.rowCount === 0) return false;
                
                flagData = res.rows[0];
                // Save to Redis
                await redis.set(cacheKey, JSON.stringify(flagData), 'EX', flagConfig.cacheTtlSeconds);
            } else {
                flagData = JSON.parse(flagData);
            }

            const { enabled, rollout_percentage, rules, prerequisites } = flagData;
            if (!enabled) return false;

            // 2. Evaluate Prerequisite dependencies
            if (prerequisites && prerequisites.length > 0) {
                for (const prereq of prerequisites) {
                    const isPrereqEnabled = await this.isEnabled(prereq, context);
                    if (!isPrereqEnabled) return false;
                }
            }

            // 3. Evaluate Targeting Rules (Tier, Version, Region, City, Role)
            if (rules) {
                const parsedRules = typeof rules === 'string' ? JSON.parse(rules) : rules;
                if (parsedRules.targeting) {
                    for (const [key, value] of Object.entries(parsedRules.targeting)) {
                        const contextVal = context[key];
                        // If rule value is an array, check inclusion
                        if (Array.isArray(value)) {
                            if (!value.includes(contextVal)) return false;
                        } else if (contextVal !== value) {
                            return false;
                        }
                    }
                }
            }

            if (rollout_percentage >= 100) return true;

            // 4. Deterministic anonymous rollouts via robust cryptographic hashing (FNV-1a equivalent)
            const identifier = context.userId || context.workerId || context.deviceId || context.sessionId;
            if (identifier) {
                const hash = this._deterministicHash(identifier, flagName);
                return hash < rollout_percentage;
            }

            // Fallback to random if no identification context provided
            return Math.random() * 100 < rollout_percentage;
        } catch (e) {
            console.error('[FEATURE_FLAG] Check failed:', flagName, e.message);
            return false;
        }
    }

    async enable(flagName, rolloutPercentage = 100, actorId = 'system') {
        try {
            await db.query(
                `INSERT INTO feature_flags (flag_name, enabled, rollout_percentage, updated_at) 
                 VALUES ($1, true, $2, NOW()) 
                 ON CONFLICT (flag_name) 
                 DO UPDATE SET enabled = true, rollout_percentage = $2, updated_at = NOW()`,
                [flagName, rolloutPercentage]
            );
            
            // Invalidate/Write-through Cache
            await redis.del(this._getRedisKey(flagName));

            // Log Audit Event
            await db.query(
                "INSERT INTO event_logs (event_type, metadata) VALUES ($1, $2)",
                ['feature_flag_enabled', JSON.stringify({ flagName, rolloutPercentage, actorId, timestamp: new Date() })]
            );

            console.log('[FEATURE_FLAG] Enabled:', flagName, 'at', rolloutPercentage + '%');
        } catch (e) {
            console.error('[FEATURE_FLAG] Enable failed:', e.message);
        }
    }

    async disable(flagName, actorId = 'system') {
        try {
            await db.query("UPDATE feature_flags SET enabled = false, updated_at = NOW() WHERE flag_name = $1", [flagName]);
            
            // Invalidate Cache
            await redis.del(this._getRedisKey(flagName));

            // Log Audit Event
            await db.query(
                "INSERT INTO event_logs (event_type, metadata) VALUES ($1, $2)",
                ['feature_flag_disabled', JSON.stringify({ flagName, actorId, timestamp: new Date() })]
            );

            console.log('[FEATURE_FLAG] Disabled:', flagName);
        } catch (e) {
            console.error('[FEATURE_FLAG] Disable failed:', e.message);
        }
    }

    async setRollout(flagName, percentage, actorId = 'system') {
        try {
            await db.query(
                `INSERT INTO feature_flags (flag_name, enabled, rollout_percentage, updated_at) 
                 VALUES ($1, true, $2, NOW()) 
                 ON CONFLICT (flag_name) 
                 DO UPDATE SET rollout_percentage = $2, updated_at = NOW()`,
                [flagName, percentage]
            );
            await redis.del(this._getRedisKey(flagName));

            await db.query(
                "INSERT INTO event_logs (event_type, metadata) VALUES ($1, $2)",
                ['feature_flag_rollout_changed', JSON.stringify({ flagName, percentage, actorId, timestamp: new Date() })]
            );
        } catch (e) {
            console.error('[FEATURE_FLAG] Set rollout failed:', e.message);
        }
    }

    async setRules(flagName, rules, prerequisites = [], actorId = 'system') {
        try {
            await db.query(
                `INSERT INTO feature_flags (flag_name, rules, prerequisites, updated_at) 
                 VALUES ($1, $2, $3, NOW()) 
                 ON CONFLICT (flag_name) 
                 DO UPDATE SET rules = $2, prerequisites = $3, updated_at = NOW()`,
                [flagName, JSON.stringify(rules), prerequisites]
            );
            await redis.del(this._getRedisKey(flagName));
        } catch (e) {
            console.error('[FEATURE_FLAG] Set rules failed:', e.message);
        }
    }

    async getAll() {
        try {
            const res = await db.query("SELECT * FROM feature_flags ORDER BY flag_name");
            return res.rows;
        } catch (e) {
            console.error('[FEATURE_FLAG] List failed:', e.message);
            return [];
        }
    }

    async create(flagName, description, prerequisites = [], rules = {}) {
        try {
            await db.query(
                `INSERT INTO feature_flags (flag_name, description, prerequisites, rules) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (flag_name) DO NOTHING`,
                [flagName, description, prerequisites, JSON.stringify(rules)]
            );
        } catch (e) {
            console.error('[FEATURE_FLAG] Create failed:', e.message);
        }
    }

    _deterministicHash(identifier, salt) {
        const input = `${identifier}:${salt}`;
        const md5Hex = crypto.createHash('md5').update(input).digest('hex');
        const num = parseInt(md5Hex.substring(0, 8), 16);
        return num % 100;
    }
}

module.exports = new FeatureFlagService();
