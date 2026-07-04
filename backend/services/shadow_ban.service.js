const db = require('../config/db');

const BAN_LEVELS = {
    0: { visibility: 1.00, dispatch: 1.00, label: 'NORMAL' },
    1: { visibility: 0.70, dispatch: 0.80, label: 'REDUCED_VISIBILITY' },
    2: { visibility: 0.40, dispatch: 0.50, label: 'RESTRICTED_DISPATCH' },
    3: { visibility: 0.15, dispatch: 0.20, label: 'LIMITED_ACCESS' },
    4: { visibility: 0.00, dispatch: 0.00, label: 'SUSPENDED' },
};

class ShadowBanService {
    async getStatus(workerId) {
        const res = await db.query(
            "SELECT * FROM shadow_ban_status WHERE worker_id = $1",
            [workerId]
        );
        if (res.rowCount === 0) {
            return { worker_id: workerId, ban_level: 0, active: false };
        }
        return res.rows[0];
    }

    async setBanLevel(workerId, level, reason = null) {
        const safeLevel = Math.max(0, Math.min(4, level));
        const config = BAN_LEVELS[safeLevel];
        const expiresAt = safeLevel >= 3
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            : safeLevel >= 1
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            : null;
        await db.query(`
            INSERT INTO shadow_ban_status (worker_id, ban_level, visibility_multiplier, dispatch_multiplier, reason, active, expires_at)
            VALUES ($1, $2, $3, $4, $5, TRUE, $6)
            ON CONFLICT (worker_id) DO UPDATE SET
                ban_level = EXCLUDED.ban_level,
                visibility_multiplier = EXCLUDED.visibility_multiplier,
                dispatch_multiplier = EXCLUDED.dispatch_multiplier,
                reason = COALESCE(EXCLUDED.reason, shadow_ban_status.reason),
                active = TRUE,
                expires_at = EXCLUDED.expires_at,
                escalated_at = CASE WHEN EXCLUDED.ban_level > shadow_ban_status.ban_level THEN NOW() ELSE shadow_ban_status.escalated_at END,
                updated_at = NOW()
        `, [workerId, safeLevel, config.visibility, config.dispatch, reason, expiresAt]);
        console.log(`[SHADOW-BAN] Worker ${workerId} → Level ${safeLevel} (${config.label}): ${reason || 'No reason'}`);
        try {
            const { invalidateAllHomeServicesCaches } = require('../routes/home.routes');
            await invalidateAllHomeServicesCaches().catch(() => {});
        } catch (e) {}
    }

    async escalate(workerId, reason = null) {
        const current = await this.getStatus(workerId);
        const newLevel = Math.min(4, (current.ban_level || 0) + 1);
        await this.setBanLevel(workerId, newLevel, reason);
    }

    async deescalate(workerId) {
        const current = await this.getStatus(workerId);
        const newLevel = Math.max(0, (current.ban_level || 0) - 1);
        if (newLevel === 0) {
            await db.query(
                "UPDATE shadow_ban_status SET active = FALSE, ban_level = 0, updated_at = NOW() WHERE worker_id = $1",
                [workerId]
            );
            try {
                const { invalidateAllHomeServicesCaches } = require('../routes/home.routes');
                await invalidateAllHomeServicesCaches().catch(() => {});
            } catch (e) {}
        } else {
            await this.setBanLevel(workerId, newLevel, 'Automatic de-escalation');
        }
    }

    getLevelConfig(level) {
        return BAN_LEVELS[Math.max(0, Math.min(4, level))] || BAN_LEVELS[0];
    }

    async applyBanPenalties(workerId, baseVisibility, baseDispatch) {
        const ban = await this.getStatus(workerId);
        if (!ban.active || ban.ban_level === 0) return { visibility: baseVisibility, dispatch: baseDispatch };
        if (ban.expires_at && new Date(ban.expires_at) < new Date()) {
            await this.deescalate(workerId);
            return { visibility: baseVisibility, dispatch: baseDispatch };
        }
        return {
            visibility: baseVisibility * parseFloat(ban.visibility_multiplier || 1),
            dispatch: baseDispatch * parseFloat(ban.dispatch_multiplier || 1),
        };
    }
}

module.exports = new ShadowBanService();
