const Redis = require('ioredis');
require('dotenv').config();

// =============================================================
// IN-MEMORY MOCK REDIS CLIENT (Fallback for Local Testing)
// =============================================================
class InMemoryRedis {
    constructor() {
        this.store = new Map();
        this.geoStore = new Map(); // key -> Map(member -> {lat, lng})
        this.isMock = true;
    }

    async set(key, value, ...args) {
        let nx = false;
        let ex = null;
        for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === 'string') {
                if (args[i].toUpperCase() === 'NX') nx = true;
                if (args[i].toUpperCase() === 'EX') {
                    ex = parseInt(args[i+1]);
                }
            }
        }

        const now = Date.now();
        if (nx && this.store.has(key)) {
            const entry = this.store.get(key);
            if (!entry.expiresAt || entry.expiresAt > now) {
                return null; 
            }
        }

        const expiresAt = ex ? now + ex * 1000 : null;
        this.store.set(key, { value: String(value), expiresAt });
        return 'OK';
    }

    async get(key) {
        const now = Date.now();
        if (!this.store.has(key)) return null;
        const entry = this.store.get(key);
        if (entry.expiresAt && entry.expiresAt <= now) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }



    get isOpen() {
        return true;
    }

    async setex(key, seconds, value) {
        return this.set(key, value, 'EX', seconds);
    }

    async incr(key) {
        const val = await this.get(key);
        const nextVal = (parseInt(val) || 0) + 1;
        await this.set(key, nextVal);
        return nextVal;
    }

    async expire(key, seconds) {
        if (this.store.has(key)) {
            const entry = this.store.get(key);
            entry.expiresAt = Date.now() + seconds * 1000;
            return 1;
        }
        return 0;
    }

    async geoadd(key, lng, lat, member) {
        if (!this.geoStore.has(key)) {
            this.geoStore.set(key, new Map());
        }
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        this.geoStore.get(key).set(String(member), { lat: latNum, lng: lngNum });
        return 1;
    }

    async geosearch(key, ...args) {
        if (!this.geoStore.has(key)) return [];
        const membersMap = this.geoStore.get(key);

        let fromLng = 0, fromLat = 0, radius = 10, withDist = false;
        for (let i = 0; i < args.length; i++) {
            if (args[i] === 'FROMLONLAT') {
                fromLng = parseFloat(args[i+1]);
                fromLat = parseFloat(args[i+2]);
            }
            if (args[i] === 'BYRADIUS') {
                radius = parseFloat(args[i+1]); 
            }
            if (args[i] === 'WITHDIST') {
                withDist = true;
            }
        }

        const results = [];
        const calculateDistance = (lat1, lon1, lat2, lon2) => {
            const R = 6371; 
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        for (const [member, coords] of membersMap.entries()) {
            const dist = calculateDistance(fromLat, fromLng, coords.lat, coords.lng);
            if (dist <= radius) {
                results.push({ member, dist });
            }
        }

        results.sort((a, b) => a.dist - b.dist);

        if (withDist) {
            return results.map(r => [r.member, String(r.dist)]);
        } else {
            return results.map(r => r.member);
        }
    }

    async zrange(key, start, end) {
        if (this.geoStore.has(key)) {
            return Array.from(this.geoStore.get(key).keys());
        }
        return [];
    }

    async del(...keys) {
        let deleted = 0;
        const keysList = Array.isArray(keys[0]) ? keys[0] : keys;
        for (const k of keysList) {
            if (this.store.has(k)) {
                this.store.delete(k);
                deleted++;
            }
            if (this.geoStore.has(k)) {
                this.geoStore.delete(k);
                deleted++;
            }
        }
        return deleted;
    }

    async sadd(key, member) {
        if (!this.store.has(key)) {
            this.store.set(key, { value: new Set() });
        }
        const set = this.store.get(key).value;
        if (set instanceof Set) {
            set.add(String(member));
            return 1;
        }
        return 0;
    }

    async srem(key, member) {
        if (this.store.has(key)) {
            const set = this.store.get(key).value;
            if (set instanceof Set) {
                const deleted = set.delete(String(member)) ? 1 : 0;
                return deleted;
            }
        }
        return 0;
    }

    async smembers(key) {
        if (this.store.has(key)) {
            const set = this.store.get(key).value;
            if (set instanceof Set) {
                return Array.from(set);
            }
        }
        return [];
    }

    async sismember(key, member) {
        if (this.store.has(key)) {
            const set = this.store.get(key).value;
            if (set instanceof Set) {
                return set.has(String(member)) ? 1 : 0;
            }
        }
        return 0;
    }

    async hincrby(key, field, increment) {
        if (!this.store.has(key)) {
            this.store.set(key, { value: new Map() });
        }
        const map = this.store.get(key).value;
        if (map instanceof Map) {
            const current = parseInt(map.get(String(field)) || 0);
            const next = current + parseInt(increment);
            map.set(String(field), String(next));
            return next;
        }
        return 0;
    }

    async hget(key, field) {
        if (this.store.has(key)) {
            const map = this.store.get(key).value;
            if (map instanceof Map) {
                return map.get(String(field)) || null;
            }
        }
        return null;
    }

    async hgetall(key) {
        if (this.store.has(key)) {
            const map = this.store.get(key).value;
            if (map instanceof Map) {
                const obj = {};
                for (const [k, v] of map.entries()) {
                    obj[k] = v;
                }
                return obj;
            }
        }
        return {};
    }

    async zrem(key, member) {
        let removed = 0;
        if (this.geoStore.has(key)) {
            const map = this.geoStore.get(key);
            if (map.has(String(member))) {
                map.delete(String(member));
                removed = 1;
            }
        }
        if (this.store.has(key)) {
            const val = this.store.get(key).value;
            if (val instanceof Set) {
                if (val.delete(String(member))) {
                    removed = 1;
                }
            }
        }
        return removed;
    }

    async lpush(key, ...elements) {
        if (!this.store.has(key)) {
            this.store.set(key, { value: [] });
        }
        const list = this.store.get(key).value;
        if (Array.isArray(list)) {
            list.unshift(...elements.reverse());
            return list.length;
        }
        return 0;
    }

    async rpush(key, ...elements) {
        if (!this.store.has(key)) {
            this.store.set(key, { value: [] });
        }
        const list = this.store.get(key).value;
        if (Array.isArray(list)) {
            list.push(...elements);
            return list.length;
        }
        return 0;
    }

    async lrange(key, start, stop) {
        if (this.store.has(key)) {
            const list = this.store.get(key).value;
            if (Array.isArray(list)) {
                let s = start < 0 ? list.length + start : start;
                let e = stop < 0 ? list.length + stop : stop;
                return list.slice(s, e + 1).map(String);
            }
        }
        return [];
    }

    async ltrim(key, start, stop) {
        if (this.store.has(key)) {
            const list = this.store.get(key).value;
            if (Array.isArray(list)) {
                let s = start < 0 ? list.length + start : start;
                let e = stop < 0 ? list.length + stop : stop;
                this.store.get(key).value = list.slice(s, e + 1);
                return 'OK';
            }
        }
        return 'OK';
    }

    async xadd(key, id, ...args) {
        return `${Date.now()}-0`;
    }

    async xgroup(...args) {
        return 'OK';
    }

    async xreadgroup(...args) {
        // Return null or empty array to simulate no stream messages instead of crashing
        return null;
    }

    async xack(...args) {
        return 1;
    }

    pipeline() {
        const commands = [];
        const exec = async () => {
            const results = [];
            for (const cmd of commands) {
                const result = await this[cmd.name](...cmd.args);
                results.push([null, result]);
            }
            return results;
        };
        const chain = { exec };
        ['del', 'rpush', 'lpush', 'ltrim', 'incr', 'set', 'expire'].forEach(method => {
            chain[method] = (...args) => {
                commands.push({ name: method, args });
                return chain;
            };
        });
        return chain;
    }
}

// =============================================================
// PRODUCTION REDIS CLIENT (With Automatic Fallback for dev)
// =============================================================
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let startupFailed = false;     // true if production startup fails — fatal
let wasEverReady = false;      // true if Redis connected at least once
let isReady = false;           // true if Redis is accepting commands
let degradedMode = false;      // true if Redis was ready but lost at runtime
let useMockFallback = false;   // dev-only: switch to InMemoryRedis
let recoveryTimer = null;      // auto-reconnect interval handle

const mockRedis = new InMemoryRedis();

function createRedisClient() {
    let allRetriesExhausted = false;

    const client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        retryStrategy(times) {
            if (times > 3) {
                allRetriesExhausted = true;
                handleConnectionFailure();
                return null;
            }
            const delay = Math.min(times * 200, 1000);
            console.warn(`⚠️ [REDIS] Reconnecting in ${delay}ms (attempt ${times})...`);
            return delay;
        },
        lazyConnect: false,
    });

    function handleConnectionFailure() {
        if (allRetriesExhausted && !wasEverReady) {
            if (NODE_ENV === 'production') {
                startupFailed = true;
                console.error('🚨 [REDIS] Production startup FAILED. Redis is REQUIRED in production mode.');
                console.error('🚨 [REDIS] The server will exit immediately. Start Redis and restart.');
                setImmediate(() => process.exit(1));
            } else {
                useMockFallback = true;
                console.warn('ℹ️ [REDIS] Redis unavailable in development. Using InMemoryMock fallback.');
            }
        }
    }

    client.on('connect', () => {
        console.log('🔴 [REDIS] Connected to Redis');
    });

    client.on('ready', () => {
        isReady = true;
        startupFailed = false;
        wasEverReady = true;
        useMockFallback = false;

        if (degradedMode) {
            degradedMode = false;
            console.log('🟢 [REDIS] RECOVERED from degraded mode. Full functionality restored.');
            if (recoveryTimer) {
                clearInterval(recoveryTimer);
                recoveryTimer = null;
            }
        }

        console.log('✅ [REDIS] Ready for commands');
    });

    client.on('error', (err) => {
        if (isReady || wasEverReady) {
            console.error('❌ [REDIS] Connection error:', err.message);
        }
        isReady = false;

        if (wasEverReady && !degradedMode && (client.status === 'end' || client.status === 'close' || allRetriesExhausted)) {
            enterDegradedMode();
            return;
        }

        if (allRetriesExhausted && !wasEverReady) {
            handleConnectionFailure();
        }
    });

    client.on('end', () => {
        isReady = false;
        if (wasEverReady && !degradedMode) {
            enterDegradedMode();
        }
        if (!wasEverReady) {
            handleConnectionFailure();
        }
    });

    client.on('close', () => {
        isReady = false;
    });

    return client;
}

function enterDegradedMode() {
    if (degradedMode) return;
    degradedMode = true;
    console.warn('⚠️ [REDIS] Entering DEGRADED MODE. Redis lost at runtime.');
    console.warn('⚠️ [REDIS] Health checks will report degraded. Active sessions preserved.');
    console.warn('⚠️ [REDIS] Auto-recovery enabled — checking every 5 seconds.');

    if (!recoveryTimer) {
        recoveryTimer = setInterval(() => {
            const probe = new Redis(REDIS_URL, {
                maxRetriesPerRequest: 1,
                connectTimeout: 3000,
                retryStrategy: () => null,
            });
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                try { probe.disconnect(); } catch (_) {}
            };
            probe.on('ready', () => {
                done();
                // Redis is back — swap to a new permanent client
                const old = clientHolder.current;
                clientHolder.current = createRedisClient();
                try { old.disconnect(); } catch (_) {}
                if (recoveryTimer) {
                    clearInterval(recoveryTimer);
                    recoveryTimer = null;
                }
            });
            probe.on('error', done);
            setTimeout(done, 4000);
        }, 5000);
    }
}

// Wrapper holds the current Redis client reference (mutable, proxy-safe)
const clientHolder = { current: createRedisClient() };

// Proxy client wrapper — always delegates through clientHolder.current
const proxyClient = new Proxy(clientHolder, {
    get(holder, prop, receiver) {
        if (prop === 'isOpen') return isReady || useMockFallback || degradedMode;
        if (prop === 'isMock') return useMockFallback;
        if (prop === 'isDegraded') return () => degradedMode;
        if (prop === 'startupFailed') return () => startupFailed;
        if (prop === 'forceReconnect') {
            return () => {
                const old = holder.current;
                holder.current = createRedisClient();
                try { old.disconnect(); } catch (_) {}
                console.log('🔄 [REDIS] Manual reconnect triggered.');
            };
        }
        if (prop === 'isHealthy') {
            return () => {
                if (NODE_ENV === 'production') {
                    return isReady && !degradedMode;
                }
                return isReady || (useMockFallback && !startupFailed);
            };
        }

        if (useMockFallback) {
            if (typeof mockRedis[prop] === 'function') {
                return mockRedis[prop].bind(mockRedis);
            }
            return mockRedis[prop];
        }

        const target = holder.current;
        const val = target[prop];
        if (typeof val === 'function') {
            return val.bind(target);
        }
        return val;
    }
});

module.exports = proxyClient;
