const client = require('prom-client');
const db = require('../config/db');
const redis = require('../config/redis');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [register],
});

const dbQueryDuration = new client.Histogram({
    name: 'db_query_duration_ms',
    help: 'Database query duration in milliseconds',
    buckets: [1, 5, 10, 25, 50, 100, 250, 500],
    registers: [register],
});

const redisOperationDuration = new client.Histogram({
    name: 'redis_operation_duration_ms',
    help: 'Redis operation duration in milliseconds',
    buckets: [1, 2, 5, 10, 25, 50, 100],
    registers: [register],
});

const activeSocketConnections = new client.Gauge({
    name: 'active_socket_connections',
    help: 'Number of active socket.io connections',
    registers: [register],
});

const dispatchSuccessTotal = new client.Counter({
    name: 'dispatch_success_total',
    help: 'Total successful dispatches',
    labelNames: ['category'],
    registers: [register],
});

const dispatchFailedTotal = new client.Counter({
    name: 'dispatch_failed_total',
    help: 'Total failed dispatches',
    labelNames: ['reason'],
    registers: [register],
});

const paymentSuccessTotal = new client.Counter({
    name: 'payment_success_total',
    help: 'Total successful payments',
    labelNames: ['payment_mode'],
    registers: [register],
});

const paymentFailedTotal = new client.Counter({
    name: 'payment_failed_total',
    help: 'Total failed payments',
    labelNames: ['payment_mode'],
    registers: [register],
});

const paymentDisputedTotal = new client.Counter({
    name: 'payment_disputed_total',
    help: 'Total disputed payments',
    labelNames: ['payment_mode'],
    registers: [register],
});

const payoutSuccessTotal = new client.Counter({
    name: 'payout_success_total',
    help: 'Total successful payouts',
    registers: [register],
});

const payoutFailedTotal = new client.Counter({
    name: 'payout_failed_total',
    help: 'Total failed payouts',
    registers: [register],
});

const payoutLatencySeconds = new client.Histogram({
    name: 'payout_latency_seconds',
    help: 'Payout processing latency in seconds',
    buckets: [60, 300, 600, 1800, 3600, 86400],
    registers: [register],
});

const mlPredictionDuration = new client.Histogram({
    name: 'ml_prediction_duration_ms',
    help: 'ML prediction duration in milliseconds',
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
    registers: [register],
});

const cashConfirmationPending = new client.Gauge({
    name: 'cash_confirmation_pending_count',
    help: 'Number of cash payments awaiting user confirmation',
    registers: [register],
});

const disputeOpenCount = new client.Gauge({
    name: 'dispute_open_count',
    help: 'Number of open disputes',
    registers: [register],
});

const disputeSlaBreachedTotal = new client.Counter({
    name: 'dispute_sla_breached_total',
    help: 'Total disputes that breached SLA deadlines',
    registers: [register],
});

const paymentTrustScoreAvg = new client.Gauge({
    name: 'payment_trust_score_avg',
    help: 'Average payment trust score',
    labelNames: ['role'],
    registers: [register],
});

const backupWorkersReserved = new client.Counter({
    name: 'backup_workers_reserved_total',
    help: 'Total backup workers reserved',
    labelNames: ['job_id'],
    registers: [register],
});

const backupActivationSuccess = new client.Counter({
    name: 'backup_activation_success_total',
    help: 'Total successful backup activations',
    labelNames: ['scenario'],
    registers: [register],
});

const backupActivationFailed = new client.Counter({
    name: 'backup_activation_failed_total',
    help: 'Total failed backup activations',
    labelNames: ['scenario'],
    registers: [register],
});

const backupRecoveryTimeMs = new client.Histogram({
    name: 'backup_recovery_time_ms',
    help: 'Backup activation recovery time in milliseconds',
    buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
    registers: [register],
});

const backupPoolActive = new client.Gauge({
    name: 'backup_pool_active_count',
    help: 'Number of active backup worker pools',
    registers: [register],
});

const userTrustEventsTotal = new client.Counter({
    name: 'user_trust_events_total',
    help: 'Total user trust events recorded',
    labelNames: ['event_type'],
    registers: [register],
});

const userTrustScore = new client.Gauge({
    name: 'user_trust_score',
    help: 'User trust score',
    labelNames: ['user_id'],
    registers: [register],
});

const dispatchScoreV2 = new client.Gauge({
    name: 'dispatch_score_v2',
    help: 'Unified Dispatch Score V2 per worker',
    labelNames: ['worker_id', 'category'],
    registers: [register],
});

const dispatchScoreComponents = new client.Gauge({
    name: 'dispatch_score_components',
    help: 'Unified Dispatch Score V2 component values',
    labelNames: ['worker_id', 'component'],
    registers: [register],
});

const skillConfidenceGauge = new client.Gauge({
    name: 'skill_confidence_score',
    help: 'Skill confidence score per worker per category',
    labelNames: ['worker_id', 'category'],
    registers: [register],
});

function trackRequestDuration(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
        const route = req.route ? req.route.path : req.url;
        httpRequestDuration.observe({ method: req.method, route, status_code: res.statusCode }, Date.now() - start);
    });
    next();
}

async function trackPaymentSuccess(mode) {
    paymentSuccessTotal.inc({ payment_mode: mode });
}

async function trackPaymentFailed(mode) {
    paymentFailedTotal.inc({ payment_mode: mode });
}

async function trackPaymentDisputed(mode) {
    paymentDisputedTotal.inc({ payment_mode: mode });
}

async function trackPayoutSuccess() {
    payoutSuccessTotal.inc();
}

async function trackPayoutFailed() {
    payoutFailedTotal.inc();
}

async function trackDispatched(category) {
    dispatchSuccessTotal.inc({ category });
}

async function trackDispatchFailed(reason) {
    dispatchFailedTotal.inc({ reason });
}

async function setSocketCount(count) {
    activeSocketConnections.set(count);
}

async function setCashConfirmationsPending(count) {
    cashConfirmationPending.set(count);
}

async function setDisputeOpenCount(count) {
    disputeOpenCount.set(count);
}

async function setTrustScoreAvg(role, avg) {
    paymentTrustScoreAvg.set({ role }, avg);
}

async function metricsEndpoint(req, res) {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
}

module.exports = {
    trackRequestDuration,
    trackPaymentSuccess,
    trackPaymentFailed,
    trackPaymentDisputed,
    trackPayoutSuccess,
    trackPayoutFailed,
    trackDispatched,
    trackDispatchFailed,
    setSocketCount,
    setCashConfirmationsPending,
    setDisputeOpenCount,
    setTrustScoreAvg,
    metricsEndpoint,
    mlPredictionDuration,
    dbQueryDuration,
    redisOperationDuration,
    payoutLatencySeconds,
    backupWorkersReserved,
    backupActivationSuccess,
    backupActivationFailed,
    backupRecoveryTimeMs,
    backupPoolActive,
    userTrustEventsTotal,
    userTrustScore,
    dispatchScoreV2,
    dispatchScoreComponents,
    skillConfidenceGauge,
};
