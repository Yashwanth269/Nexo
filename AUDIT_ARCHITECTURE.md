# Audit Log Architecture

## Overview

Immutable, append-only audit trail recording all critical actions. Who did what, when, and what changed.

## Data Model

Each audit log entry captures:

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| actor_id | UUID | Who performed the action |
| actor_type | VARCHAR(20) | USER, WORKER, ADMIN, SYSTEM |
| action | VARCHAR(100) | Action identifier |
| entity_type | VARCHAR(50) | Type of affected entity |
| entity_id | UUID | Affected entity ID |
| before_data | JSONB | State before the action |
| after_data | JSONB | State after the action |
| ip_address | INET | Request origin IP |
| user_agent | TEXT | Client user agent |
| metadata | JSONB | Additional context |
| created_at | TIMESTAMP | When the action occurred |

## Audited Actions

| Category | Actions |
|----------|---------|
| Admin | ADMIN_LOGIN, ADMIN_ACTION, ADMIN_ROLE_CHANGE |
| Payout | PAYOUT_COMPLETED, PAYOUT_FAILED, PAYOUT_REFUNDED |
| Dispute | DISPUTE_OPENED, DISPUTE_RESOLVED, DISPUTE_ESCALATED |
| Trust | TRUST_SCORE_CHANGE, TRUST_LEVEL_CHANGE |
| Ban | BAN_ISSUED, BAN_LIFTED, SHADOW_BAN_ACTIVATED |
| Payment | PAYMENT_REFUNDED, PAYMENT_REVERSED |
| Emergency | EMERGENCY_STOPPED, EMERGENCY_RESOLVED |

## Implementation

### audit.service.js

```javascript
class AuditService {
    async log(action, options)              // Core: log any action
    async getByEntity(type, id, limit)       // Query by affected entity
    async getByActor(id, type, limit)        // Query by actor
    async getByAction(action, limit)         // Query by action type
    async getRecent(hours, limit)            // Recent activity
    async cleanup(maxAgeDays)                // Archive old logs
    async logAdminAction(id, action, ...)    // Admin-specific
    async logPayout(adminId, payoutId, ...)  // Payout-specific
    async logDisputeAction(adminId, ...)     // Dispute-specific
    async logTrustChange(id, type, ...)      // Trust score changes
    async logBan(id, type, action, reason)   // Ban actions
}
```

## Database

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    actor_type VARCHAR(20),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    before_data JSONB,
    after_data JSONB,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
```

## Retention Policy

- Active logs: 90 days in primary table
- Archive: compressed export to cold storage
- Cleanup cron: daily `DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days'`

## Prometheus Metrics

| Metric | Type | Labels |
|--------|------|--------|
| audit_logs_total | Counter | action, actor_type |
| audit_logs_duration_ms | Histogram | action |

## Integration Points

| Service | Actions Logged |
|---------|---------------|
| admin routes | admin actions, role changes, bans |
| payout service | payout attempts, completions, failures |
| dispute service | dispute lifecycle events |
| user_trust service | trust score changes |
| auth service | login events, permission changes |
| emergency routes | emergency lifecycle events |
