# Session Recovery Engine

## Overview

Crash recovery system for Worker App and User App. On app restart, restores the user's active session state including active jobs, navigation state, ETA, chat, and payment flow.

## Worker App Recovery

On app crash/restart, restore:

| State | Source | Restoration |
|-------|--------|-------------|
| Active job | jobs table WHERE worker_id = ? AND status IN ('ACCEPTED','ON_THE_WAY','ARRIVED','WORK_STARTED') | Navigate to active gig screen |
| Job location | jobs.location_lat, jobs.location_lng | Restore navigation ETA |
| Chat state | messages table WHERE job_id = ? | Restore chat history |
| Current ETA | Redis worker:last_location | Recalculate ETA |
| Payment flow | jobs.status = 'WORK_COMPLETED' or 'PAYMENT_PENDING' | Restore payment screen |
| Offer state | job_offers WHERE worker_id = ? AND status = 'PENDING' | Re-render offer card |
| Attendance | jobs.arrived_at, jobs.started_at | Restore attendance buttons |

## User App Recovery

On app crash/restart, restore:

| State | Source | Restoration |
|-------|--------|-------------|
| Active booking | jobs table WHERE user_id = ? AND status NOT IN ('SETTLED','CANCELLED','EXPIRED') | Navigate to active booking |
| Worker tracking | jobs.worker_id | Show worker on map |
| Payment flow | jobs.status = 'PAYMENT_PENDING' | Resume payment |
| Chat | messages table WHERE job_id = ? | Restore chat |

## Recovery Flow

```
App Start
  -> Check for active session (auth token)
    -> If authenticated:
      -> Call GET /api/session/recover
        -> Backend queries active jobs/offers for user/worker
        -> Returns current state + navigation target
      -> Client navigates to appropriate screen
    -> If not authenticated:
      -> Show login/onboarding
```

## API Endpoint

### GET /api/session/recover

Returns:
```json
{
  "hasActiveSession": true,
  "role": "WORKER",
  "activeJob": { ... },
  "activeOffer": { ... },
  "navigationTarget": "active_gig_screen",
  "etaState": { ... },
  "chatState": { ... },
  "paymentState": { ... }
}
```

## Redis Session Cache

```javascript
// On each state transition:
redis.set(`session:${userId}`, JSON.stringify({
  role: 'WORKER',
  activeJobId: jobId,
  lastScreen: 'active_gig_screen',
  timestamp: Date.now()
}), 'EX', 86400); // 24h TTL
```

## Error Handling

- No active session: return `{ hasActiveSession: false }`
- DB failure: return cached Redis session data
- Corrupt state: force logout, show login screen
- Expired token: redirect to re-authentication
