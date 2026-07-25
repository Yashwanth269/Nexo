const db = require('../config/db');
const auditConfig = require('../config/audit.config');

class AuditService {
    /**
     * Primary audit log entry creator
     */
    async log(action, options) {
        const { actorId, actorType, entityType, entityId, beforeData, afterData, ipAddress, userAgent, metadata } = options || {};
        try {
            await db.query(
                `INSERT INTO audit_logs (
                    actor_id, actor_type, action, entity_type, entity_id, 
                    before_data, after_data, ip_address, user_agent, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    actorId, 
                    actorType, 
                    action, 
                    entityType, 
                    entityId, 
                    beforeData ? JSON.stringify(beforeData) : null, 
                    afterData ? JSON.stringify(afterData) : null, 
                    ipAddress, 
                    userAgent, 
                    metadata ? JSON.stringify(metadata) : null
                ]
            );
        } catch (e) {
            console.error('[AUDIT] Failed to log:', action, e.message);
        }
    }

    /**
     * Queries audit logs by specific entity type and entity ID
     */
    async getByEntity(entityType, entityId, limit) {
        let finalLimit = limit || auditConfig.defaults.queryLimit;
        if (finalLimit > auditConfig.defaults.maxQueryLimit) {
            finalLimit = auditConfig.defaults.maxQueryLimit;
        }

        try {
            const res = await db.query(
                'SELECT * FROM audit_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT $3',
                [entityType, entityId, finalLimit]
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    /**
     * Queries audit logs by actor ID and actor Type
     */
    async getByActor(actorId, actorType, limit) {
        let finalLimit = limit || auditConfig.defaults.queryLimit;
        if (finalLimit > auditConfig.defaults.maxQueryLimit) {
            finalLimit = auditConfig.defaults.maxQueryLimit;
        }

        try {
            const res = await db.query(
                'SELECT * FROM audit_logs WHERE actor_id = $1 AND ($2::VARCHAR IS NULL OR actor_type = $2) ORDER BY created_at DESC LIMIT $3',
                [actorId, actorType, finalLimit]
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    /**
     * Queries audit logs for a specific action
     */
    async getByAction(action, limit) {
        let finalLimit = limit || auditConfig.defaults.queryLimit;
        if (finalLimit > auditConfig.defaults.maxQueryLimit) {
            finalLimit = auditConfig.defaults.maxQueryLimit;
        }

        try {
            const res = await db.query(
                'SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at DESC LIMIT $2',
                [action, finalLimit]
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    /**
     * Queries recent audit logs using dynamic interval parametrization
     */
    async getRecent(hours, limit) {
        const finalHours = hours || auditConfig.defaults.recentActivityHours;
        let finalLimit = limit || auditConfig.defaults.queryLimit;
        if (finalLimit > auditConfig.defaults.maxQueryLimit) {
            finalLimit = auditConfig.defaults.maxQueryLimit;
        }

        try {
            const res = await db.query(
                `SELECT * FROM audit_logs 
                 WHERE created_at > NOW() - ($1 || ' hours')::INTERVAL 
                 ORDER BY created_at DESC 
                 LIMIT $2`,
                [finalHours, finalLimit]
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    /**
     * Cleans up logs older than retention period using dynamic interval parametrization
     */
    async cleanup(maxAgeDays) {
        const finalMaxAgeDays = maxAgeDays || auditConfig.defaults.retentionDays;
        try {
            const res = await db.query(
                `DELETE FROM audit_logs 
                 WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
                [finalMaxAgeDays]
            );
            console.log('[AUDIT] Cleaned up ' + (res.rowCount || 0) + ' old logs');
        } catch (e) {
            console.error('[AUDIT] Cleanup failed:', e.message);
        }
    }

    /**
     * Helper to log administrative actions
     */
    async logAdminAction(adminId, action, entityType, entityId, beforeData, afterData) {
        await this.log(action, {
            actorId: adminId,
            actorType: auditConfig.actorTypes.ADMIN,
            entityType,
            entityId,
            beforeData,
            afterData,
        });
    }

    /**
     * Helper to log worker payout attempts/completions
     */
    async logPayout(adminId, payoutId, workerId, amount, beforeData, afterData) {
        const action = afterData ? auditConfig.actions.PAYOUT_COMPLETED : auditConfig.actions.PAYOUT_FAILED;
        await this.log(action, {
            actorId: adminId,
            actorType: auditConfig.actorTypes.ADMIN,
            entityType: auditConfig.entityTypes.PAYOUT,
            entityId: payoutId,
            beforeData,
            afterData,
            metadata: { workerId, amount }
        });
    }

    /**
     * Helper to log dispute escalations
     */
    async logDisputeAction(adminId, disputeId, action, beforeData, afterData) {
        await this.log(`${auditConfig.actions.DISPUTE_PREFIX}${action}`, {
            actorId: adminId,
            actorType: auditConfig.actorTypes.ADMIN,
            entityType: auditConfig.entityTypes.DISPUTE,
            entityId: disputeId,
            beforeData,
            afterData,
        });
    }

    /**
     * Helper to log trust score adjustments
     */
    async logTrustChange(targetId, targetType, beforeScore, afterScore, reason) {
        await this.log(auditConfig.actions.TRUST_SCORE_CHANGE, {
            actorId: targetId,
            actorType: targetType,
            entityType: auditConfig.entityTypes.TRUST_SCORE,
            entityId: targetId,
            beforeData: { trustScore: beforeScore },
            afterData: { trustScore: afterScore },
            metadata: { reason }
        });
    }

    /**
     * Helper to log user bans
     */
    async logBan(targetId, targetType, action, reason) {
        await this.log(`${auditConfig.actions.BAN_PREFIX}${action}`, {
            actorId: targetId,
            actorType: targetType,
            entityType: auditConfig.entityTypes.USER,
            entityId: targetId,
            metadata: { reason }
        });
    }
}

module.exports = new AuditService();
