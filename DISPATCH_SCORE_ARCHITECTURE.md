# Dispatch Score V2 Architecture

## Overview

Unified scoring engine for worker ranking, dispatch, recommendations, and all worker-facing surfaces.
Consolidates 7 weighted factors + 4 penalty systems into a single [0, 1] score.

## Formula

score = (reputation × 0.20) + (reliability × 0.20) + (skill_confidence × 0.20) + (acceptance_probability × 0.15) + (distance × 0.10) + (trust × 0.10) + (availability × 0.05)

## Penalties (subtracted after weighted sum)

| Penalty | Weight | Source |
|---------|--------|--------|
| Fatigue | × 0.15 | composite (24h×0.6 + 7d×0.3 + 30d×0.1) |
| Fraud Risk | × 0.10 | fraud_risk_score from worker_features |
| No-Show Risk | × 0.05 | 1 - completion_rate |
| Overload | capped 0.15 | active_jobs × 0.05 + fatigue × 0.05 |

## Multipliers

| Multiplier | Effect | Source |
|------------|--------|--------|
| Trust Decay | pow(0.97, days_inactive) | last_job_event_at |
| Affinity Bonus | +min(0.10, count × 0.03) | user_worker_affinity.hire_count |
| Shadow Ban | -0.90 (floor 0) | worker_features.is_shadow_banned |
| High Fraud | -0.80 (floor 0) | fraud_risk_score > 0.7 |

## Components

### 1. Reputation (20%)
- Field: completion_rate (normalized to [0,1])
- Source: worker_features.completion_rate
- Fallback: 1.0 (100%)

### 2. Reliability (20%)
- Field: reliability_score
- Source: worker_features.reliability_score
- Fallback: 1.0

### 3. Skill Confidence (20%)
- Field: confidence_score / 100 (per category)
- Source: skill_confidence.service.js → worker_skill_confidence table
- Cache: Redis TTL 3600s
- Fallback: heuristic (jobs × 2 + rating/5×30 + repeat×3 - disputes×5)
- ML: SkillConfidenceModel (LightGBM regression)

### 4. Acceptance Probability (15%)
- Field: p_accept from calculateAcceptanceProbability()
- Source: acceptance model (ML) + heuristic fallback
- Fallback: logistic regression with distance, fatigue, completion rate

### 5. Distance (10%)
- Field: 1 / (1 + distance_km)
- Source: earthdistance / PostGIS / Redis geo query

### 6. Trust (10%)
- Field: customer_trust_score / 100
- Source: user_trust.service.js → user_trust_scores table
- Levels: TRUSTED(90-100), NORMAL(70-89), WATCHLIST(50-69), RESTRICTED(30-49), HIGH_RISK(0-29)

### 7. Availability (5%)
- online: +0.5, available: +0.3, max(0, 0.2 - active_jobs×0.05)
- Source: workers.is_online, workers.is_available, worker_features.active_jobs_count

## Consumers

| Consumer | Method | When |
|----------|--------|------|
| getTopRatedWorkers | computeWorkerScore() | User searches for workers |
| getNearbyRankedWorkers | calculateDLRankingScore() | Job dispatch loop |
| backupWorkerService | handleFailure() | Primary worker fails |
| Worker cards | computeWorkerScore() | User app worker list |
| Premium badges | computeWorkerScore() badges | All worker surfaces |

## Prometheus Metrics

| Metric | Type | Labels |
|--------|------|--------|
| dispatch_score_v2 | Gauge | worker_id, category |
| dispatch_score_components | Gauge | worker_id, component |
| skill_confidence_score | Gauge | worker_id, category |
