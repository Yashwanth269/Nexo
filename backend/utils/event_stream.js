const redis = require('../config/redis');

class EventStream {
    constructor() {
        this.streamName = 'marketplace_stream';
        this.groupName = 'marketplace_group';
        this.consumerName = 'consumer_1';
    }

    async publish(eventType, payload) {
        try {
            if (redis.isMock) {
                // Direct async dispatch in mock mode
                setImmediate(() => this.consumeEvent(eventType, payload));
                return;
            }
            // Stream fields list: eventType, payload (JSON)
            await redis.xadd(this.streamName, '*', 'eventType', eventType, 'payload', JSON.stringify(payload));
            console.log(`[EVENT_STREAM] Published '${eventType}' event to Redis Stream.`);
        } catch (err) {
            console.error('[EVENT_STREAM] Publish failed:', err.message);
            // Fail-safe direct dispatch if Redis stream fails
            setImmediate(() => this.consumeEvent(eventType, payload));
        }
    }

    async init(io) {
        this.io = io;
        if (redis.isMock) {
            console.log('[EVENT_STREAM] Running in Mock Redis mode. Stream listeners decoupled via setImmediate.');
            return;
        }

        // Create Consumer Group
        try {
            await redis.xgroup('CREATE', this.streamName, this.groupName, '$', 'MKSTREAM');
        } catch (err) {
            if (!err.message.includes('BUSYGROUP')) {
                console.warn('[EVENT_STREAM] Consumer group creation warning:', err.message);
            }
        }

        // Start consumer loop
        this.startConsumerLoop();
    }

    async startConsumerLoop() {
        console.log('[EVENT_STREAM] Starting Redis Stream Consumer Loop...');
        while (true) {
            if (redis.isMock) {
                console.log('[EVENT_STREAM] Mock Redis mode detected. Exiting consumer loop.');
                break;
            }
            try {
                const results = await redis.xreadgroup(
                    'GROUP', this.groupName, this.consumerName,
                    'COUNT', '5', 'BLOCK', '2000',
                    'STREAMS', this.streamName, '>'
                );
                if (results && results.length > 0) {
                    for (const streamInfo of results) {
                        const messages = streamInfo[1];
                        for (const msg of messages) {
                            const msgId = msg[0];
                            const fields = msg[1];
                            
                            let eventType = '';
                            let payloadStr = '{}';
                            for (let i = 0; i < fields.length; i += 2) {
                                if (fields[i] === 'eventType') eventType = fields[i+1];
                                if (fields[i] === 'payload') payloadStr = fields[i+1];
                              }

                            const payload = JSON.parse(payloadStr);
                            await this.consumeEvent(eventType, payload);
                            await redis.xack(this.streamName, this.groupName, msgId);
                        }
                    }
                }
            } catch (err) {
                console.error('[EVENT_STREAM] Consumer error:', err.message);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Cool off
            }
        }
    }

    async consumeEvent(eventType, payload) {
        console.log(`[EVENT_STREAM_CONSUMER] Received event: ${eventType}`);
        try {
            const marketService = require('../services/market.service');
            const workerService = require('../services/worker.service');

            // 1. Update Market Intelligence Trend Cache
            if (payload.lat && payload.lng) {
                await marketService.ingestEvent({
                    type: eventType,
                    category: payload.category,
                    lat: payload.lat,
                    lng: payload.lng,
                    userId: payload.userId,
                    ip: payload.ip,
                    fingerprint: payload.fingerprint
                }, this.io);

                // 1b. Invalidate home services cache on worker state changes
                if (['worker_online', 'worker_offline', 'job_accepted', 'job_completed', 'job_cancelled'].includes(eventType)) {
                    try {
                        const { invalidateServiceCache } = require('../routes/home.routes');
                        await invalidateServiceCache(payload.lat, payload.lng);
                    } catch (_) {}
                }
            }

            // 2. Precompute worker performance ML features on completed/cancelled jobs
            if (payload.workerId) {
                if (eventType === 'job_completed') {
                    await workerService.updateFatigueScore(payload.workerId, 'JOB_COMPLETED');
                    await workerService.updateLastJobEventAt(payload.workerId);
                } else if (eventType === 'job_cancelled') {
                    await workerService.updateFatigueScore(payload.workerId, 'JOB_CANCELLED');
                    await workerService.updateLastJobEventAt(payload.workerId);
                } else if (eventType === 'job_accepted') {
                    await workerService.updateLastJobEventAt(payload.workerId);
                } else if (eventType === 'worker_online') {
                    await workerService.recomputeAndStoreFeatures(payload.workerId);
                }
            }
        } catch (err) {
            console.error('[EVENT_STREAM_CONSUMER] Processing failed:', err.message);
        }
    }
}

module.exports = new EventStream();
