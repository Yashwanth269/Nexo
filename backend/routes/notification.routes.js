const express = require('express');
const router = express.Router();
const redis = require('../config/redis');

// Get user notifications (Redis-backed)
router.get('/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const rawNotifs = await redis.lrange(`notifications:${phone}`, 0, 49); // get last 50
        const notifications = rawNotifs.map(n => JSON.parse(n));
        res.json({ success: true, notifications });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Mark notification as read
router.post('/read', async (req, res) => {
    try {
        const { phone, notificationId } = req.body;
        const key = `notifications:${phone}`;
        const rawNotifs = await redis.lrange(key, 0, -1);
        
        let found = false;
        const updated = rawNotifs.map(n => {
            const notif = JSON.parse(n);
            if (notif.id === notificationId) {
                notif.isRead = true;
                found = true;
            }
            return JSON.stringify(notif);
        });

        if (found) {
            // Rewrite the list atomically
            const pipeline = redis.pipeline();
            pipeline.del(key);
            if (updated.length > 0) {
                pipeline.rpush(key, ...updated);
            }
            await pipeline.exec();
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: "Notification not found" });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper function to add notification (internal)
const addNotification = async (phone, data) => {
    try {
        const newNotif = {
            id: Date.now().toString(),
            type: data.type || 'INFO',
            title: data.title,
            message: data.message,
            metadata: data.metadata || {},
            isRead: false,
            createdAt: new Date().toISOString()
        };
        
        const key = `notifications:${phone}`;
        await redis.lpush(key, JSON.stringify(newNotif));
        await redis.ltrim(key, 0, 99); // Keep only last 100
    } catch (err) {
        console.error("⚠️ [NOTIFICATIONS] Failed to add notification:", err.message);
    }
};

module.exports = { router, addNotification };
