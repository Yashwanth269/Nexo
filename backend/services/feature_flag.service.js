const db = require('../config/db');

class FeatureFlagService {
    async isEnabled(flagName, context) {
        context = context || {};
        try {
            const res = await db.query("SELECT enabled, rollout_percentage FROM feature_flags WHERE flag_name = $1", [flagName]);
            if (res.rowCount === 0) return false;
            const { enabled, rollout_percentage } = res.rows[0];
            if (!enabled) return false;
            if (rollout_percentage >= 100) return true;
            if (context.userId) {
                const hash = this._hashUserId(context.userId, flagName);
                return hash < rollout_percentage;
            }
            return Math.random() * 100 < rollout_percentage;
        } catch (e) {
            console.error('[FEATURE_FLAG] Check failed:', flagName, e.message);
            return false;
        }
    }

    async enable(flagName, rolloutPercentage) {
        rolloutPercentage = rolloutPercentage || 100;
        try {
            await db.query("INSERT INTO feature_flags (flag_name, enabled, rollout_percentage) VALUES ($1, true, $2) ON CONFLICT (flag_name) DO UPDATE SET enabled = true, rollout_percentage = $2, updated_at = NOW()", [flagName, rolloutPercentage]);
            console.log('[FEATURE_FLAG] Enabled:', flagName, 'at', rolloutPercentage + '%');
        } catch (e) {
            console.error('[FEATURE_FLAG] Enable failed:', e.message);
        }
    }

    async disable(flagName) {
        try {
            await db.query("UPDATE feature_flags SET enabled = false, updated_at = NOW() WHERE flag_name = $1", [flagName]);
            console.log('[FEATURE_FLAG] Disabled:', flagName);
        } catch (e) {
            console.error('[FEATURE_FLAG] Disable failed:', e.message);
        }
    }

    async setRollout(flagName, percentage) {
        try {
            await db.query("INSERT INTO feature_flags (flag_name, enabled, rollout_percentage) VALUES ($1, true, $2) ON CONFLICT (flag_name) DO UPDATE SET rollout_percentage = $2, updated_at = NOW()", [flagName, percentage]);
        } catch (e) {
            console.error('[FEATURE_FLAG] Set rollout failed:', e.message);
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

    async create(flagName, description) {
        try {
            await db.query("INSERT INTO feature_flags (flag_name, description) VALUES ($1, $2) ON CONFLICT (flag_name) DO NOTHING", [flagName, description]);
        } catch (e) {
            console.error('[FEATURE_FLAG] Create failed:', e.message);
        }
    }

    _hashUserId(userId, salt) {
        let hash = 0;
        const str = String(userId) + ':' + salt;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return Math.abs(hash) % 100;
    }
}

module.exports = new FeatureFlagService();
