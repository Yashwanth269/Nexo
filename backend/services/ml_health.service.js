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
            timestamp: new Date().toISOString()
        };
    }

    async callML(modelName, endpoint, body, method = 'POST') {
        mlRequestsTotal.inc({ model_name: modelName, endpoint });
        const start = Date.now();

        if (this.status === 'OFFLINE') {
            mlFailuresTotal.inc({ model_name: modelName, endpoint, error_type: 'CIRCUIT_BREAKER' });
            await this.updateMonitoringStats(modelName, 0, 1, 0);
            throw new Error(`ML Service is offline (Circuit Breaker active)`);
        }

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
                res.on('end', async () => {
                    const latency = Date.now() - start;
                    mlLatency.observe({ model_name: modelName, endpoint }, latency);

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            this.setStatus('ONLINE');
                            await this.updateMonitoringStats(modelName, latency, 0, 1);
                            resolve(parsed);
                        } catch (e) {
                            mlFailuresTotal.inc({ model_name: modelName, endpoint, error_type: 'INVALID_JSON' });
                            await this.updateMonitoringStats(modelName, latency, 1, 1);
                            reject(new Error('Invalid JSON response'));
                        }
                    } else {
                        this.setStatus('DEGRADED');
                        mlFailuresTotal.inc({ model_name: modelName, endpoint, error_type: `STATUS_${res.statusCode}` });
                        await this.updateMonitoringStats(modelName, latency, 1, 1);
                        reject(new Error(`ML service returned status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', async (err) => {
                const latency = Date.now() - start;
                this.setStatus('OFFLINE');
                mlFailuresTotal.inc({ model_name: modelName, endpoint, error_type: 'CONNECTION_ERROR' });
                await this.updateMonitoringStats(modelName, latency, 1, 1);
                reject(err);
            });

            req.on('timeout', async () => {
                req.destroy();
                const latency = Date.now() - start;
                this.setStatus('DEGRADED');
                mlFailuresTotal.inc({ model_name: modelName, endpoint, error_type: 'TIMEOUT' });
                await this.updateMonitoringStats(modelName, latency, 1, 1);
                reject(new Error('ML service timeout'));
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
                this.status
            ]);
        } catch (e) {
            console.error('[ML-MONITOR] Failed to update stats:', e.message);
        }
    }
}

// Global register helper
const register = client.register;
if (register) {
    // Check if metric is already registered (in case of double-init or dev hot reload)
    try {
        register.registerMetric(mlRequestsTotal);
        register.registerMetric(mlFailuresTotal);
        register.registerMetric(mlLatency);
        register.registerMetric(mlHealthGauge);
    } catch (_) {}
}

module.exports = new MLHealthManager();
