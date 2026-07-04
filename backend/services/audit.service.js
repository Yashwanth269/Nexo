const db = require('../config/db');

class AuditService {
    async log(action, options) {
        const { actorId, actorType, entityType, entityId, beforeData, afterData, ipAddress, userAgent, metadata } = options || {};
        try {
            await db.query(
                'INSERT INTO audit_logs (actor_id, actor_type, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [actorId, actorType, action, entityType, entityId, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null, ipAddress, userAgent, metadata ? JSON.stringify(metadata) : null]
            );
        } catch (e) {
            console.error('[AUDIT] Failed to log:', action, e.message);
        }
    }

    async getByEntity(entityType, entityId, limit) {
        limit = limit || 50;
        try {
            const res = await db.query(
                'SELECT * FROM audit_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT $3',
                [entityType, entityId, limit]
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    async getByActor(actorId, actorType, limit) {
        limit = limit || 50;
        try {
            const res = await db.query(
                'SELECT * FROM audit_logs WHERE actor_id = $1 AND ($2::VARCHAR IS NULL OR actor_type = $2) ORDER BY created_at DESC LIMIT $3',
                [actorId, actorType, limit]
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    async getByAction(action, limit) {
        limit = limit || 50;
        try {
            const res = await db.query(
                'SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at DESC LIMIT $2',
                [action, limit]
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    async getRecent(hours, limit) {
        hours = hours || 24;
        limit = limit || 100;
        try {
            const res = await db.query(
                'SELECT * FROM audit_logs WHERE created_at > NOW() - INTERVAL \'' + hours + ' hours\' ORDER BY created_at DESC LIMIT ' + limit
            );
            return res.rows;
        } catch (e) {
            console.error('[AUDIT] Query failed:', e.message);
            return [];
        }
    }

    async cleanup(maxAgeDays) {
        maxAgeDays = maxAgeDays || 90;
        try {
            const res = await db.query('DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL \'' + maxAgeDays + ' days\'');
            console.log('[AUDIT] Cleaned up ' + (res.rowCount || 0) + ' old logs');
        } catch (e) {
            console.error('[AUDIT] Cleanup failed:', e.message);
        }
    }

    async logAdminAction(adminId, action, entityType, entityId, beforeData, afterData) {
        await this.log(action, {
            actorId: adminId,
            actorType: 'ADMIN',
            entityType,
            entityId,
            beforeData,
            afterData,
        });
    }

    async logPayout(adminId, payoutId, workerId, amount, beforeData, afterData) {
        await this.log('PAYOUT_' + (afterData ? 'COMPLETED' : 'FAILED'), {
            actorId: adminId,
            actorType: 'ADMIN',
            entityType: 'PAYOUT',
            entityId: payoutId,
            beforeData,
            afterData,
            metadata: { workerId, amount }
        });
    }

    async logDisputeAction(adminId, disputeId, action, beforeData, afterData) {
        await this.log('DISPUTE_' + action, {
            actorId: adminId,
            actorType: 'ADMIN',
            entityType: 'DISPUTE',
            entityId: disputeId,
            beforeData,
            afterData,
        });
    }

    async logTrustChange(targetId, targetType, beforeScore, afterScore, reason) {
        await this.log('TRUST_SCORE_CHANGE', {
            actorId: targetId,
            actorType: targetType,
            entityType: 'TRUST_SCORE',
            entityId: targetId,
            beforeData: { trustScore: beforeScore },
            afterData: { trustScore: afterScore },
            metadata: { reason }
        });
    }

    async logBan(targetId, targetType, action, reason) {
        await this.log('BAN_' + action, {
            actorId: targetId,
            actorType: targetType,
            entityType: 'USER',
            entityId: targetId,
            metadata: { reason }
        });
    }
}

module.exports = new AuditService();
