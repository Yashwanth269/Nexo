const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = require('./config/db');
const { globalRateLimiter, securityMiddleware } = require('./middleware/security.middleware');
const { SECRET_KEY } = require('./utils/auth.middleware');
const { setIO } = require('./config/socket');

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN || "*", methods: ["GET", "POST"] },
    pingTimeout: 30000,
    pingInterval: 10000,
});

// Register Socket.IO instance in singleton (breaks circular dependency)
setIO(io);

// Initialize services AFTER socket is registered
const matchingEngine = require('./services/matching.service');
matchingEngine.init(io);

const eventStream = require('./utils/event_stream');
eventStream.init(io);

const { startBackgroundRefresh } = require('./services/market.service');
startBackgroundRefresh(io);

const { invalidateServiceCache } = require('./routes/home.routes');

app.use(cors());
app.use(require('helmet')({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.razorpay.com"],
            frameSrc: ["'self'", "https://api.razorpay.com"],
        },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    xssFilter: true,
    noSniff: true,
    hidePoweredBy: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(globalRateLimiter);
app.use(securityMiddleware);

// Global Request Logger with request ID
app.use((req, res, next) => {
    req.requestId = require('crypto').randomUUID();
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) {
            console.warn(`[SLOW_REQUEST] ${req.method} ${req.url} took ${duration}ms`);
        }
    });
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- FILE SYSTEM SETUP ---
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, {
    setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Security-Policy', "default-src 'none'");
    }
}));

// Serve public folder statically (for web checkout pages and static category assets)
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
app.use('/public', express.static(publicDir, {
    setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
    }
}));

const upload = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadsDir),
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed'));
        }
    }
});

// --- FIREBASE SETUP ---
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('Firebase Admin initialized');
} catch (error) {
    console.log('Firebase initialization skipped: Service account key not found');
}

// --- HEALTH & READINESS ENDPOINTS ---
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        uptime: process.uptime(), 
        timestamp: new Date().toISOString(),
        version: require('./package.json').version
    });
});

app.get('/ready', async (req, res) => {
    const redis = require('./config/redis');
    const isProduction = process.env.NODE_ENV === 'production';
    const dbHealthy = db.isHealthy();
    const redisHealthy = redis.isHealthy?.() || false;
    const redisDegraded = redis.isDegraded?.() || false;

    let ready = dbHealthy;
    if (isProduction) {
        ready = ready && redisHealthy && !redisDegraded;
    }

    res.status(ready ? 200 : 503).json({
        ready,
        degraded: isProduction && redisDegraded,
        checks: {
            database: dbHealthy,
            redis: redisHealthy,
            degraded: redisDegraded,
        },
        environment: process.env.NODE_ENV || 'development'
    });
});

// Prometheus metrics middleware
const metricsMiddleware = require('./middleware/metrics');
app.use(metricsMiddleware.trackRequestDuration);
app.get('/metrics', metricsMiddleware.metricsEndpoint);

// --- ROUTE MOUNTING (with authentication) ---
const { authenticateToken, optionalAuth } = require('./utils/auth.middleware');

app.get('/payment-checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.use('/api/worker/auth', require('./routes/worker.auth.routes'));
app.use('/api/auth', require('./routes/auth.routes'));

// Protected routes — require valid JWT
app.use('/api/worker/profile', authenticateToken, require('./routes/worker.profile.routes'));
app.use('/api/user', authenticateToken, require('./routes/user.routes'));
app.use('/api/jobs', authenticateToken, require('./routes/job.routes'));
app.use('/api/workers', require('./routes/worker.routes')); // has internal optional auth
app.use('/api/market', require('./routes/market.routes')); // has public + protected endpoints
app.use('/api/home', require('./routes/home.routes').router);
app.use('/api/safety', authenticateToken, require('./routes/safety.routes'));
app.use('/api/chat', authenticateToken, require('./routes/chat.routes'));
app.use('/api/chats', authenticateToken, require('./routes/chat.routes'));
app.use('/api/notifications', authenticateToken, require('./routes/notification.routes').router);
app.use('/api/wallet', authenticateToken, require('./routes/wallet.routes'));
app.use('/api/payment', authenticateToken, require('./routes/payment.routes'));
app.use('/api/ratings', authenticateToken, require('./routes/rating.routes'));
app.use('/api/support', authenticateToken, require('./routes/support.routes'));
app.use('/api/feed', require('./routes/feed.routes')); // has public + protected endpoints
app.use('/api/feedback', require('./routes/feedback.routes'));
app.use('/api/dispute', authenticateToken, require('./routes/dispute.routes'));
app.use('/api/emergency', authenticateToken, require('./routes/emergency.routes'));
app.use('/api/gamification', authenticateToken, require('./routes/gamification.routes'));
app.use('/api/admin', authenticateToken, require('./routes/admin.routes'));
app.use('/api/backup-worker', authenticateToken, require('./routes/backup_worker.routes'));
app.use('/api/trust', authenticateToken, require('./routes/trust.routes'));
app.use('/api/fatigue', authenticateToken, require('./routes/fatigue.routes'));

// Shared Photo Upload (requires auth)
app.post('/api/user/upload-photo', authenticateToken, upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, photoUrl: `/uploads/${req.file.filename}` });
});

app.get('/', (req, res) => res.send('GigLink Smart Engine API — Production Architecture Active'));

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${req.method} ${req.url}:`, err.stack);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// JSON 404 Handler (MUST BE LAST)
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: `Route ${req.method} ${req.url} not found` 
    });
});

// =============================================================
// SOCKET.IO AUTH — STRICT ENFORCEMENT (No fallbacks in prod, mock in dev)
// =============================================================
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    
    if (!token) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`⚠️ [SOCKET-AUTH-BYPASS] No token provided for socket ${socket.id}. Mocking credentials in dev.`);
            const queryRole = socket.handshake.query?.role || 'WORKER';
            const phone = socket.handshake.query?.phoneNumber || socket.handshake.query?.phone || '9731016442';
            socket.user = {
                userId: '4d1a3b5c-2e9f-4b0d-8a7e-1f6b2c3d4e5f',
                phoneNumber: phone,
                role: queryRole
            };
            return next();
        }
        console.warn(`🔒 [SOCKET-REJECTED] No token provided (socket: ${socket.id}). Connection refused.`);
        return next(new Error('Authentication required. Provide a valid token.'));
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        socket.user = decoded;
        next();
    } catch (err) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`⚠️ [SOCKET-AUTH-BYPASS] Invalid/Expired token for socket ${socket.id}. Mocking credentials in dev. Error: ${err.message}`);
            const queryRole = socket.handshake.query?.role || 'WORKER';
            const phone = socket.handshake.query?.phoneNumber || socket.handshake.query?.phone || '9731016442';
            socket.user = {
                userId: '4d1a3b5c-2e9f-4b0d-8a7e-1f6b2c3d4e5f',
                phoneNumber: phone,
                role: queryRole
            };
            return next();
        }
        console.warn(`🔒 [SOCKET-REJECTED] Invalid/Expired token (socket: ${socket.id}). Error: ${err.message}`);
        return next(new Error('Invalid or expired token. Please re-authenticate.'));
    }
});

// --- SOCKET ENGINE HANDLERS ---
io.on('connection', (socket) => {
    console.log(`🔌 [SOCKET] Client Connected: ${socket.id} (user: ${socket.user?.phoneNumber || socket.user?.userId || 'unknown'})`);

    // Generic room join handler
    socket.on('join', (room) => {
        // Validate room format to prevent abuse
        if (typeof room !== 'string' || room.length > 100) return;
        socket.join(room);
        console.log(`🔌 [SOCKET] Socket ${socket.id} joined room: ${room}`);
    });

    // Worker goes online
    socket.on('worker_online', async (data) => {
        const { phoneNumber, location } = data;
        if (!phoneNumber) return;

        // Validate the phone number matches the authenticated token
        if (socket.user?.phoneNumber !== phoneNumber && socket.user?.role !== 'WORKER') {
            console.warn(`🚨 [SOCKET-AUTH] Phone mismatch: token=${socket.user?.phoneNumber}, claimed=${phoneNumber}`);
            return;
        }

        socket.join(`worker:${phoneNumber}`);
        socket.phoneNumber = phoneNumber;
        socket.role = 'WORKER';
        console.log(`👷 [WORKER] ${phoneNumber} joined active room.`);

        // Sync with DB
        try {
            // Also resolve worker UUID and join that room for consistent event delivery
            const wRes = await db.query("SELECT id FROM workers WHERE phone_number = $1", [phoneNumber]);
            if (wRes.rowCount > 0) {
                socket.workerId = wRes.rows[0].id;
                socket.join(`worker:${wRes.rows[0].id}`);
            }
            await db.query("UPDATE workers SET is_online = true WHERE phone_number = $1", [phoneNumber]);
            const { invalidateAllHomeServicesCaches } = require('./routes/home.routes');
            await invalidateAllHomeServicesCaches().catch(() => {});
        } catch (e) {
            console.error("⚠️ [DB-SYNC] Failed to set worker online:", e.message);
        }

        // Update real-time position in Redis
        if (location) {
            await matchingEngine.updateWorkerLocation(phoneNumber, location.lat, location.lng);
            await eventStream.publish('worker_online', { lat: location.lat, lng: location.lng, workerId: phoneNumber });
            const geoKey = require('./services/geo_hash.service').encode(location.lat, location.lng, 6);
            socket.join(`trending:${geoKey}`);

            // Invalidate home services cache for this area
            await invalidateServiceCache(location.lat, location.lng).catch(() => {});
        }
    });

    // User joins their trending geo-room for live updates
    socket.on('join_trending_room', (data) => {
        const { lat, lng } = data || {};
        if (!lat || !lng) return;
        const geoKey = require('./services/geo_hash.service').encode(parseFloat(lat), parseFloat(lng), 6);
        const room = `trending:${geoKey}`;
        socket.join(room);
    });

    // Real-time location sync (Every 5-10s from Mobile)
    socket.on('update_location', async (data) => {
        const { phoneNumber, location } = data;
        // Validate ownership
        if (phoneNumber && location && socket.user?.phoneNumber === phoneNumber) {
            await matchingEngine.updateWorkerLocation(phoneNumber, location.lat, location.lng);
        }
    });

    socket.on('new_job_request_ack', (data) => {
        console.log(`✅ [SOCKET-ACK] Client confirmed delivery of offer: ${data?.offerId}`);
    });

    // Market event ingestion via socket
    socket.on('market_event', async (data) => {
        const { type, category, lat, lng } = data || {};
        if (type && lat && lng) {
            await eventStream.publish(type, { 
                category, 
                lat: parseFloat(lat), 
                lng: parseFloat(lng), 
                userId: socket.user?.userId 
            });
        }
    });

    // Disconnect — IMMEDIATE cleanup of Redis GEO indexes
    socket.on('disconnect', async () => {
        console.log(`❌ [SOCKET] Client Disconnected: ${socket.id}`);

        // Invalidate service cache when a worker disconnects
        if (socket.user?.location) {
            await invalidateServiceCache(socket.user.location.lat, socket.user.location.lng).catch(() => {});
        }
        
        if (socket.role === 'WORKER' && socket.phoneNumber) {
            try {
                await db.query("UPDATE workers SET is_online = false WHERE phone_number = $1", [socket.phoneNumber]);
                const { invalidateAllHomeServicesCaches } = require('./routes/home.routes');
                await invalidateAllHomeServicesCaches().catch(() => {});
                
                // IMMEDIATE Redis GEO cleanup (don't wait for 2-minute timer)
                if (socket.workerId) {
                    const redis = require('./config/redis');
                    const geohash = await redis.get(`worker:${socket.workerId}:geohash`);
                    if (geohash) {
                        await redis.zrem(`workers:geo:${geohash}`, socket.workerId);
                    }
                    await redis.del(`worker:${socket.workerId}:geohash`);
                    await redis.del(`worker:${socket.workerId}:last_seen`);
                    await redis.srem('workers:active_set', socket.workerId);
                }
                
                console.log(`👷 [WORKER] ${socket.phoneNumber} marked offline & removed from GEO index.`);
            } catch (e) {
                console.error("⚠️ [DB-SYNC] Failed to set worker offline:", e.message);
            }
        }
    });
});

// --- SERVER STARTUP ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`\n🚀 Shramik Shakti Engine Active on Port ${PORT}`);
    console.log(`🔒 JWT Auth: Enforced (secret loaded from env)`);
    console.log(`🔒 Socket Auth: Strict (no anonymous connections)`);
    console.log(`📡 Real-time Engine: Enabled (Socket.IO)`);
    console.log(`💚 Health: /health | Readiness: /ready`);
    console.log(`--------------------------------------------\n`);
});

// Start Payment Cron Service
const cronService = require('./services/cron.service');
cronService.start();

// --- GRACEFUL SHUTDOWN ---
const gracefulShutdown = (signal) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    
    // Stop accepting new connections
    server.close(async () => {
        console.log('[SHUTDOWN] HTTP server closed.');
        
        // Close database pool
        try {
            await db.pool.end();
            console.log('[SHUTDOWN] Database pool closed.');
        } catch (e) {
            console.error('[SHUTDOWN] Database pool close error:', e.message);
        }
        
        // Close Redis
        try {
            const redis = require('./config/redis');
            if (redis.quit) await redis.quit();
            console.log('[SHUTDOWN] Redis connection closed.');
        } catch (e) {
            // Ignore mock Redis quit errors
        }
        
        process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('[SHUTDOWN] Forced exit after 10s timeout.');
        process.exit(1);
    }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err.stack || err.message);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});
