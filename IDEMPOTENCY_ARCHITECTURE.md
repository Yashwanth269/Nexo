# Idempotency Layer Architecture

## Overview

Idempotency-Key header support on all critical endpoints to prevent duplicate processing of webhooks, payments, payouts, escrow releases, refunds, and dispute settlements.

## How It Works

1. Client generates a unique idempotency key (UUID or SHA-256 hash of operation parts)
2. Client sends `Idempotency-Key: <key>` header with the request
3. Server checks `idempotency_keys` table for existing key
4. If found: return cached response (prevents duplicate processing)
5. If not found: execute handler, store result with key

## Protected Endpoints

| Endpoint | Key Source | Idempotency Window |
|----------|-----------|-------------------|
| POST /api/payments/webhook/razorpay | razorpay_event_id | 48h |
| POST /api/payments/payout | SHA256(amount + worker_id + date) | 48h |
| POST /api/escrow/release | job_id + release_attempt | 48h |
| POST /api/dispute/resolve | dispute_id + resolution | 48h |
| POST /api/wallet/credit | transaction_id | 48h |
| POST /api/wallet/debit | transaction_id | 48h |
| POST /api/payments/refund | payment_id + refund_attempt | 48h |

## Implementation

### idempotency.service.js

```javascript
class IdempotencyService {
    async processRequest(key, handler)   // Check + execute + record
    async lookup(key)                     // Query DB for existing result
    async record(key, response, status)  // Store result in DB
    generateKey(parts)                    // SHA-256 hash of parts
    cleanup(maxAgeHours)                  // Remove expired keys
}
```

## Database Schema

```sql
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Key Generation Convention

```
SHA-256(operation_type + ":" + primary_id + ":" + timestamp_or_nonce)
```

Examples:
- Webhook: `SHA-256("razorpay_webhook" + ":" + event_id)`
- Payout: `SHA-256("payout" + ":" + worker_id + ":" + amount + ":" + date)`
- Escrow: `SHA-256("escrow_release" + ":" + job_id + ":" + attempt)`

## Cleanup Policy

- Keys auto-deleted after 48 hours via cron
- Cron runs every 6 hours: `DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '48 hours'`

## Race Condition Prevention

- UNIQUE constraint on `idempotency_key`
- `ON CONFLICT DO NOTHING` for concurrent inserts
- First writer wins; second writer gets cached result

## Error Handling

- DB failure: handler still executes (no idempotency guarantee)
- Missing key header: handler executes normally (no dedup)
- Expired key: treated as new request
