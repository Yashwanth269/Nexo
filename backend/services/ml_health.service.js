const http = require('http');
const { URL } = require('url');
const client = require('prom-client');
const redis = require('../config/redis');
const db = require('../config/db');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Register Prometheus Metrics
const mlRequestsTotal = new client.Counter({
    name: 'ml_requests_total',
    help: 'Total number of requests sent to the ML service',
    labelNames: ['model_name', 'endpoint']
});

const mlFailuresTotal = new client.Counter({
    name: 'ml_failures_total',
    help: 'Total number of failed requests to the ML service',
    labelNames: ['model_name', 'endpoint', 'error_type']
});

const mlLatency = new client.Histogram({
    name: 'ml_latency',
    help: 'ML service request latency in milliseconds',
    labelNames: ['model_name', 'endpoint'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
});

const mlHealthGauge = new client.Gauge({
    name: 'ml_health',
    help: 'Health state of the ML service (1 = ONLINE, 0.5 = DEGRADED, 0 = OFFLINE, 0.25 = STARTING)'
});

class MLHealthManager {
    constructor() {
        this.status = 'STARTING';
        this.lastHealthyState = null;
        this.checkInterval = 10000; // 10 seconds
        
        // Model-Level Health States (Point 3)
        this.modelStates = {
            eta: { status: 'ONLINE', consecutiveFailures: 0 },
            pricing: { status: 'ONLINE', consecutiveFailures: 0 },
            acceptance: { status: 'ONLINE', consecutiveFailures: 0 }
        };

        // Canary status for Half-Open state (Point 2)
        this.lastOfflineTime = null;
        this.cooldownWindowMs = 15000; // 15 seconds before trying canary
        this.canaryInProgress = false;

        this.startHealthChecks();
        this.updateHealthMetric();
    }

    startHealthChecks() {
        this.checkHealth();
        this.timer = setInterval(() => this.checkHealth(), this.checkInterval);
    }

    async checkHealth() {
        try {
            const urlObj = new URL(ML_SERVICE_URL);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: '/health',
                method: 'GET',
                timeout: 2000
            };

            const req = http.request(options, (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    this.setStatus('ONLINE');
                } else {
                    this.setStatus('DEGRADED');
                }
            });

            req.on('error', () => {
                this.setStatus('OFFLINE');
            });

            req.on('timeout', () => {
                req.destroy();
                this.setStatus('DEGRADED');
            });

            req.end();
        } catch (e) {
            this.setStatus('OFFLINE');
        }
    }

    setStatus(newStatus) {
        if (this.status !== newStatus) {
            console.log(`📡 [ML-HEALTH] ML Service status transitioned from ${this.status} to ${newStatus}`);
            this.status = newStatus;
            this.updateHealthMetric();
        }
        if (newStatus === 'ONLINE') {
            this.lastHealthyState = Date.now();
        }
        if (newStatus === 'OFFLINE') {
            this.lastOfflineTime = Date.now();
        }
    }

    updateHealthMetric() {
        const val = {
            ONLINE: 1.0,
            DEGRADED: 0.5,
            OFFLINE: 0.0,
            STARTING: 0.25
        }[this.status] || 0.0;
        mlHealthGauge.set(val);
    }

    getStatus() {
        return {
            status: this.status,
            lastHealthyTime: this.lastHealthyState ? new Date(this.lastHealthyState).toISOString() : null,
            modelStates: this.modelStates,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Executes ML request with exponential retry policies, model-level health fallback, and circuit breaker.
     */
    async callML(modelName, endpoint, body, method = 'POST') {
        const normalizedModel = modelName.toLowerCase();
        const modelState = this.modelStates[normalizedModel] || { status: 'ONLINE', consecutiveFailures: 0 };

        // 1. Circuit Breaker Checks & Half-Open state (Point 2)
        if (this.status === 'OFFLINE' || modelState.status === 'OFFLINE') {
            const isCooldownOver = this.lastOfflineTime && (Date.now() - this.lastOfflineTime > this.cooldownWindowMs);
            
            if (isCooldownOver && !this.canaryInProgress) {
                // Transition to HALF-OPEN: Allow exactly one request to pass through as a canary trial
                console.log(`📡 [ML-HALF-OPEN] Circuit is HALF-OPEN. Attempting canary check for model ${modelName}...`);
                this.canaryInProgress = true;
            } else {
                mlFailuresTotal.inc({ model_name: modelName, endpoint, error_type: 'CIRCUIT_BREAKER' });
                await this.updateMonitoringStats(modelName, 0, 1, 0);
                throw new Error(`ML Model ${modelName} is offline (Circuit Breaker active)`);
            }
        }

        mlRequestsTotal.inc({ model_name: modelName, endpoint });
        const start = Date.now();

        // 2. Exponential Backoff Retry wrapper (Point 1)
        let attempts = 0;
        const maxAttempts = 3;
        let lastError = null;

        while (attempts < maxAttempts) {
            try {
                const response = await this.executeHttpRequest(endpoint, body, method);
                
                // Successful inference response path
                const latency = Date.now() - start;
                mlLatency.observe({ model_name: modelName, endpoint }, latency);

                // Reset statuses to ONLINE upon successful canary or normal transaction
                this.setStatus('ONLINE');
                modelState.status = 'ONLINE';
                modelState.consecutiveFailures = 0;
                this.canaryInProgress = false;

                await this.updateMonitoringStats(modelName, latency, 0, 1);
                return response;
            } catch (err) {
                attempts++;
                lastError = err;
                if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED') || err.message.includes('connect ECONNREFUSED')) {
                    break; // Fail fast for complete service outages
                }
                const backoffMs = Math.pow(2, attempts) * 100;
                console.warn(`[ML-RETRY] Attempt ${attempts}/${maxAttempts} failed for model ${modelName}: ${err.message}. Retrying in ${backoffMs}ms...`);
                await new Promise(r => setTimeout(r, backoffMs));
            }
        }

        // Exhausted all retries - mark model and service offline/degraded
        const latency = Date.now() - start;
        modelState.consecutiveFailures++;
        if (modelState.consecutiveFailures >= 3) {
            modelState.status = 'OFFLINE';
            this.setStatus('OFFLINE');
        } else {
            modelState.status = 'DEGRADED';
            this.setStatus('DEGRADED');
        }
        this.canaryInProgress = false;

        mlFailuresTotal.inc({ model_name: modelName, endpoint, error_type: 'EXHAUSTED_RETRIES' });
        await this.updateMonitoringStats(modelName, latency, 1, 1);
        throw new Error(`ML Service execution failed after ${maxAttempts} attempts. Last error: ${lastError.message}`);
    }

    executeHttpRequest(endpoint, body, method) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(ML_SERVICE_URL + endpoint);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname,
                method: method,
                headers: { 'Content-Type': 'application/json' },
                timeout: 1000 // strict 1-second timeout
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch {
                            reject(new Error('Invalid JSON response'));
                        }
                    } else {
                        reject(new Error(`Server returned status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('ML connection timeout'));
            });

            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async updateMonitoringStats(modelName, latencyMs, isFailure, isPrediction) {
        try {
            await db.query(`
                INSERT INTO ml_model_monitoring (model_name, avg_latency_ms, prediction_count, failure_count, status, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (model_name) DO UPDATE SET
                    avg_latency_ms = (ml_model_monitoring.avg_latency_ms * 0.9) + ($2 * 0.1),
                    prediction_count = ml_model_monitoring.prediction_count + $3,
                    failure_count = ml_model_monitoring.failure_count + $4,
                    status = $5,
                    updated_at = NOW()
            `, [
                modelName,
                latencyMs,
                isPrediction ? 1 : 0,
                isFailure ? 1 : 0,
                this.modelStates[modelName.toLowerCase()]?.status || this.status
            ]);
        } catch (e) {
            console.error('[ML-MONITOR] Failed to update stats:', e.message);
        }
    }
}

// Global register helper
const register = client.register;
if (register) {
    try {
        register.registerMetric(mlRequestsTotal);
        register.registerMetric(mlFailuresTotal);
        register.registerMetric(mlLatency);
        register.registerMetric(mlHealthGauge);
    } catch (_) {}
}

module.exports = new MLHealthManager();
