const express = require('express');
const router = express.Router();
const chatService = require('../services/chat.service');
const { chatLimiter } = require('../middleware/rate-limits');

// Get Chat History
router.get('/history/:jobId', async (req, res) => {
    try {
        const readerType = req.user.role === 'WORKER' ? 'WORKER' : 'USER';
        const history = await chatService.getChatHistory(req.params.jobId, readerType);
        res.json({ success: true, history });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send Message
router.post('/send', chatLimiter, async (req, res) => {
    try {
        const { jobId, message, type, metadata } = req.body;
        
        // Resolve sender from authenticated token
        const senderId = req.user.role === 'WORKER' ? req.user.workerId : req.user.userId;
        const senderType = req.user.role || 'USER';

        if (!senderId) {
            return res.status(400).json({ success: false, message: "Authentication required to send messages" });
        }

        const msg = await chatService.saveMessage(jobId, senderId, message, type || 'text', metadata || {}, senderType);
        
        // Emit via Socket
        const { getIO } = require('../config/socket');
        const io = getIO();
        io.to(`job:${jobId}`).emit('new_message', msg);
        
        res.json({ success: true, message: msg });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send Price Offer (Worker Action)
router.post('/offer/send', async (req, res) => {
    try {
        const { jobId, amount } = req.body;
        const workerId = req.user.workerId;
        
        if (!workerId) {
            return res.status(400).json({ success: false, message: "Worker authentication required to send offers" });
        }

        const msg = await chatService.sendOffer(jobId, workerId, amount);
        
        const { getIO } = require('../config/socket');
        const io = getIO();
        io.to(`job:${jobId}`).emit('new_price_offer', msg);
        
        res.json({ success: true, offer: msg });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Accept Price Offer (User Action)
router.post('/offer/accept', async (req, res) => {
    try {
        const { jobId, amount } = req.body;
        const userId = req.user.userId;

        if (!userId) {
            return res.status(400).json({ success: false, message: "User authentication required to accept offers" });
        }

        const result = await chatService.acceptOffer(jobId, userId, amount);
        
        if (result.success) {
            const { getIO } = require('../config/socket');
            const io = getIO();
            io.to(`job:${jobId}`).emit('offer_accepted', { jobId, amount });
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Contextual Quick Replies
router.get('/replies/:jobId', async (req, res) => {
    try {
        const replies = await chatService.getQuickReplies(req.params.jobId);
        res.json({ success: true, replies });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Initialize or Get Direct Chat Job (User Action)
router.post('/init', async (req, res) => {
    try {
        const { workerId } = req.body;
        const userId = req.user.userId;

        if (!userId) {
            return res.status(400).json({ success: false, message: "User authentication required to initiate chat" });
        }
        if (!workerId) {
            return res.status(400).json({ success: false, message: "Worker ID required" });
        }

        const jobId = await chatService.getOrCreateDirectChatJob(userId, workerId);
        res.json({ success: true, jobId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Chats List for Worker: GET /api/chat/chats/:phone
router.get('/chats/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const role = req.user.role;
        const userId = req.user.userId;
        const workerId = req.user.workerId;
        
        let chats = [];
        if (role === 'WORKER') {
            chats = await chatService.getWorkerChats(workerId || phone, req);
        } else {
            chats = await chatService.getUserChats(userId || phone, req);
        }
        res.json({ success: true, chats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Chats List for Customer: GET /api/chats/:phone (mounted at /api/chats)
router.get('/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const role = req.user.role;
        const userId = req.user.userId;
        const workerId = req.user.workerId;
        
        let chats = [];
        if (role === 'WORKER') {
            chats = await chatService.getWorkerChats(workerId || phone, req);
        } else {
            chats = await chatService.getUserChats(userId || phone, req);
        }
        res.json({ success: true, chats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
