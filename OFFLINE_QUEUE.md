# Offline Action Queue

## Overview

Support for offline operations in Worker App. Actions are queued locally and synced when connectivity is restored. Includes retry queue with exponential backoff and conflict resolution.

## Queued Action Types

| Action | Priority | Conflict Strategy |
|--------|----------|-------------------|
| Image uploads (completion photos) | LOW | Last-write-wins |
| Completion confirmation | HIGH | State check before apply |
| Attendance (arrival, start) | HIGH | Idempotent |
| Location updates | LOW | Latest-only (drop intermediate) |
| Emergency reports | CRITICAL | Immediate retry |

## Local Queue Structure

```json
{
  "queue": [
    {
      "id": "uuid",
      "action": "COMPLETION_CONFIRM",
      "payload": { "jobId": "...", "photos": [...] },
      "timestamp": 1234567890,
      "retryCount": 0,
      "maxRetries": 5
    }
  ]
}
```

## Sync Flow

```
App regains connectivity
  -> Check offline queue
    -> For each queued action (sorted by priority):
      -> Send request to API
        -> Success: remove from queue
        -> Failure (conflict): apply conflict resolution
        -> Failure (network): keep in queue, retry later
    -> Notify user of sync results
```

## Retry Backoff

| Retry # | Delay |
|---------|-------|
| 1 | 30s |
| 2 | 60s |
| 3 | 2min |
| 4 | 5min |
| 5 | 15min |

## Conflict Resolution Strategies

| Scenario | Strategy |
|----------|----------|
| Job already completed by another worker | Discard action, notify user |
| Job status changed (cancelled/expired) | Discard action, notify user |
| Photo upload with same timestamp | Skip duplicate |
| Stale location update | Discard (more recent exists) |
| Duplicate attendance | Idempotent (safe to retry) |

## Backend API

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/offline/sync | POST | Sync queued actions |
| /api/offline/status | GET | Check sync status |

## Local Storage (Flutter)

- Use sqflite for persistent queue storage
- Encrypt sensitive data before storage
- Max queue size: 1000 entries
- Auto-clean entries older than 7 days
