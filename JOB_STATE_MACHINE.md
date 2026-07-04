# Job State Machine Architecture

## Overview

Strict, deterministic lifecycle state machine for all marketplace jobs. Illegal transitions are impossible by design.

## States

| State | Description | Terminal |
|-------|-------------|----------|
| CREATED | Job created by user, not yet dispatched | No |
| SEARCHING | System is searching for matching workers | No |
| OFFER_SENT | Offer sent to worker, awaiting response | No |
| ACCEPTED | Worker accepted the offer | No |
| ON_THE_WAY | Worker is traveling to job location | No |
| ARRIVED | Worker arrived at job location | No |
| WORK_STARTED | Worker has started the job | No |
| WORK_COMPLETED | Worker marked job as complete | No |
| PAYMENT_PENDING | Payment processing in progress | No |
| SETTLED | Payment completed, job fully resolved | Yes |
| CANCELLED | Job cancelled by user/system/worker | Yes |
| EXPIRED | No worker accepted within TTL | Yes |
| DISPUTED | Dispute raised, payment on hold | No |

## Allowed Transitions

```
CREATED --> SEARCHING, CANCELLED, EXPIRED
SEARCHING --> OFFER_SENT, CANCELLED, EXPIRED
OFFER_SENT --> ACCEPTED, CANCELLED, EXPIRED
ACCEPTED --> ON_THE_WAY, CANCELLED
ON_THE_WAY --> ARRIVED, CANCELLED
ARRIVED --> WORK_STARTED, CANCELLED
WORK_STARTED --> WORK_COMPLETED, CANCELLED
WORK_COMPLETED --> PAYMENT_PENDING, DISPUTED
PAYMENT_PENDING --> SETTLED, DISPUTED
SETTLED --> (none)
CANCELLED --> (none)
EXPIRED --> (none)
DISPUTED --> PAYMENT_PENDING, SETTLED
```

## Visual Diagram

```
                   +---> CANCELLED
                   |
CREATED --> SEARCHING --> OFFER_SENT --> ACCEPTED --> ON_THE_WAY --> ARRIVED --> WORK_STARTED --> WORK_COMPLETED --> PAYMENT_PENDING --> SETTLED
              |              |              |             |             |               |                 |                    |
              +--> EXPIRED   +--> EXPIRED   +--> CANCELLED +--> CANCELLED +--> CANCELLED  +--> CANCELLED       +--> DISPUTED ----->+
                                                                                                                |                  |
                                                                                                                +--> SETTLED -------+
```

## Key Design Rules

1. **No skipping states** - Each transition must go to the immediate next state in the lifecycle
2. **No backward transitions** - Once a job reaches a state, it can never go back to a previous state
3. **Cancellation available** - From every non-terminal active state, cancellation is possible
4. **Dispute is a holding state** - Disputed jobs can only go to PAYMENT_PENDING or SETTLED
5. **Terminal states are final** - SETTLED, CANCELLED, EXPIRED are absorbing states

## Timestamp Tracking

Each state transition records a timestamp in the jobs table:

| State | Column |
|-------|--------|
| ACCEPTED | accepted_at |
| ON_THE_WAY | on_the_way_at |
| ARRIVED | arrived_at |
| WORK_STARTED | started_at |
| WORK_COMPLETED | completed_at |
| PAYMENT_PENDING | payment_pending_at |
| SETTLED | settled_at |
| CANCELLED | cancelled_at |

## Database Migration

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_pending_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE job_history ADD COLUMN IF NOT EXISTS from_state VARCHAR(50);
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS to_state VARCHAR(50);
```

## Integration Points

| Service | Usage |
|---------|-------|
| matching.service.js | Uses canBeDispatched() to determine if job can enter dispatch |
| execution.service.js | Calls transition() for worker arrival, start, completion |
| payment.service.js | Calls transition() for payment pending and settled |
| dispute.service.js | Calls transition() for disputed state |
| job.service.js | Initial transition CREATED -> SEARCHING |

## Error Handling

- IllegalTransitionError: thrown when invalid transition attempted
- Transition logging: all transitions logged to job_history table
- Redis cleanup: terminal states trigger Redis cache cleanup
