# Feature Flag System

## Overview

Gradual rollout system for new features. Supports percentage-based rollouts with user-sticky hashing.

## Database Schema

```sql
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT false,
    rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Implementation

### feature_flag.service.js

```javascript
class FeatureFlagService {
    async isEnabled(flagName, context)     // Check if feature is active
    async enable(flagName, percentage)      // Enable with rollout %
    async disable(flagName)                 // Disable immediately
    async setRollout(flagName, percentage)  // Adjust rollout %
    async getAll()                          // List all flags
    async create(flagName, description)     // Create new flag
}
```

## Rollout Strategies

| Strategy | Method | Use Case |
|----------|--------|----------|
| All off | enabled=false, rollout=0 | Development, testing |
| Internal only | enabled=true, rollout=5 | Dogfooding |
| Gradual rollout | enabled=true, rollout=25-50 | Staged release |
| Full release | enabled=true, rollout=100 | Production |
| Emergency off | disabled() | Instant rollback |

## User-Sticky Hashing

When `context.userId` is provided, `isEnabled()` deterministically assigns the user to a rollout bucket using a hash function:

```
bucket = abs(hash(userId + ":" + flagName)) % 100
enabled = bucket < rollout_percentage
```

This ensures the same user always gets the same experience for a given flag.

## Planned Flags

| Flag Name | Description | Target Rollout |
|-----------|-------------|----------------|
| dispatch_score_v2 | New unified dispatch scoring | 100% |
| new_ranking_algorithm | ML-based ranking v2 | 25% |
| premium_worker_badges | New badge system | 50% |
| offline_queue | Offline action support | 5% |
| session_recovery | Crash recovery engine | 25% |
| advanced_search | New search/filter UI | 10% |

## Prometheus Metrics

| Metric | Type | Labels |
|--------|------|--------|
| feature_flag_checks_total | Counter | flag_name, result |
| feature_flag_active | Gauge | flag_name |

## Admin API

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/admin/flags | GET | List all flags |
| /api/admin/flags/:name | GET | Get flag details |
| /api/admin/flags/:name/enable | POST | Enable with rollout % |
| /api/admin/flags/:name/disable | POST | Disable |
| /api/admin/flags/:name/rollout | PUT | Set rollout percentage |
| /api/admin/flags | POST | Create new flag |

## Safety

- Default: all flags disabled (fail closed)
- DB failure: returns false (feature unavailable)
- Invalid percentage: rejected by CHECK constraint
- Emergency disable: instant, no rollout cooldown
