# Admin Action Center

## Overview

Single admin dashboard for managing disputes, fraud cases, emergencies, payouts, support tickets, worker reviews, user reviews, shadow bans, and feature flags.

## Dashboard Sections

### 1. Disputes Queue

| Column | Description |
|--------|-------------|
| Open disputes count | Active disputes requiring attention |
| SLA breaches | Disputes exceeding 48h resolution window |
| Auto-escalated | Disputes automatically escalated |
| Resolution rate | % of disputes resolved within SLA |

**Actions:** View details, resolve in favor of worker, resolve in favor of user, escalate, add notes

### 2. Fraud Cases

| Column | Description |
|--------|-------------|
| High-risk flags | Users/workers with fraud_risk_score > 0.7 |
| GPS spoofing alerts | Location anomalies detected |
| Payment abuse | Repeated payment failures/chargebacks |
| Shadow ban candidates | Workers flagged for reduced visibility |

**Actions:** Review evidence, apply shadow ban, trigger investigation, dismiss flag

### 3. Emergency Incidents

| Column | Description |
|--------|-------------|
| Active emergencies | Ongoing safety incidents |
| Resolution time | Time since incident opened |
| Location clustering | Hotspots of emergency reports |

**Actions:** Mark as resolved, add notes, notify support

### 4. Payout Management

| Column | Description |
|--------|-------------|
| Pending payouts | Worker payout requests |
| Failed payouts | Razorpay payout failures |
| Large payouts | Amounts above threshold |
| Manual review | Flagged for manual approval |

**Actions:** Approve payout, reject with reason, retry failed, refund to wallet

### 5. Support Tickets

| Column | Description |
|--------|-------------|
| Open tickets | Unresolved user/worker issues |
| Priority breakdown | High/medium/low distribution |
| Average response time | Time to first admin response |

**Actions:** Assign ticket, reply, change priority, close ticket

### 6. Worker Reviews

| Column | Description |
|--------|-------------|
| Pending reviews | Jobs awaiting user review |
| Low-rated workers | Average rating < 3.0 |
| Disputed reviews | Reviews attached to disputed jobs |

**Actions:** Flag review, remove review, contact worker

### 7. User Reviews

| Column | Description |
|--------|-------------|
| Submitted reviews | Reviews given by users |
| Flagged reviews | Reviews with suspicious content |
| Review patterns | Mass low-rating detection |

**Actions:** Review content, remove if abusive, contact user

### 8. Shadow Bans

| Column | Description |
|--------|-------------|
| Active shadow bans | Workers with reduced visibility |
| Ban candidates | Workers meeting shadow ban criteria |
| Ban history | Past bans and lifts |

**Actions:** Apply shadow ban, lift ban, adjust visibility multiplier

### 9. Feature Flags

| Column | Description |
|--------|-------------|
| Active flags | Currently enabled features |
| Rollout progress | Percentage rolled out per flag |
| Emergency off | Instant feature disable |

**Actions:** Enable/disable flags, set rollout percentage, view flag details

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/admin/dashboard | GET | Dashboard summary stats |
| /api/admin/disputes | GET | Disputes list + actions |
| /api/admin/disputes/:id/resolve | POST | Resolve dispute |
| /api/admin/fraud | GET | Fraud cases list |
| /api/admin/fraud/:id/shadow-ban | POST | Apply shadow ban |
| /api/admin/emergencies | GET | Emergency incidents |
| /api/admin/emergencies/:id/resolve | POST | Resolve emergency |
| /api/admin/payouts | GET | Payout queue |
| /api/admin/payouts/:id/approve | POST | Approve payout |
| /api/admin/payouts/:id/reject | POST | Reject payout |
| /api/admin/tickets | GET | Support tickets |
| /api/admin/tickets/:id/reply | POST | Reply to ticket |
| /api/admin/flags | GET | Feature flags |
| /api/admin/flags/:name/enable | POST | Enable flag |
| /api/admin/flags/:name/disable | POST | Disable flag |

## Permissions

| Role | Access |
|------|--------|
| SUPER_ADMIN | Full access to all sections |
| ADMIN | All except system config |
| MODERATOR | Disputes, tickets, reviews only |
| SUPPORT | Tickets and reviews only |

## Audit Trail

All admin actions logged via audit.service.js:
- Who performed the action
- What action was taken
- Before/after state
- Timestamp

## Prometheus Metrics

| Metric | Type | Labels |
|--------|------|--------|
| admin_actions_total | Counter | action, admin_id |
| dispute_resolution_time | Histogram | resolution_type |
| pending_reviews_gauge | Gauge | review_type |
