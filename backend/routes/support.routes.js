const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Create Support Ticket
router.post('/tickets', async (req, res) => {
    try {
        const { category, subject, description } = req.body;
        const userId = req.user.userId;
        const workerId = req.user.workerId;
        const role = req.user.role || 'USER';

        if (!category || !subject || !description) {
            return res.status(400).json({ success: false, message: "category, subject, and description are required" });
        }

        const ticketNumber = `SR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        const resInsert = await db.query(
            `INSERT INTO support_tickets (ticket_number, user_id, worker_id, category, subject, description, status, priority)
             VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', 'NORMAL')
             RETURNING *`,
            [ticketNumber, role === 'USER' ? userId : null, role === 'WORKER' ? workerId : null, category, subject, description]
        );

        res.json({
            success: true,
            message: "Ticket raised successfully",
            ticket: resInsert.rows[0]
        });
    } catch (error) {
        console.error('[SUPPORT] Error creating ticket:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Support Tickets for current user/worker
router.get('/tickets', async (req, res) => {
    try {
        const userId = req.user.userId;
        const workerId = req.user.workerId;
        const role = req.user.role || 'USER';

        let query, params;
        if (role === 'WORKER') {
            query = `SELECT * FROM support_tickets WHERE worker_id = $1 ORDER BY created_at DESC`;
            params = [workerId];
        } else {
            query = `SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC`;
            params = [userId];
        }

        const result = await db.query(query, params);

        res.json({
            success: true,
            tickets: result.rows
        });
    } catch (error) {
        console.error('[SUPPORT] Error fetching tickets:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Single Ticket by ID
router.get('/tickets/:ticketId', async (req, res) => {
    try {
        const { ticketId } = req.params;
        const userId = req.user.userId;
        const workerId = req.user.workerId;
        const role = req.user.role || 'USER';

        let query = `SELECT * FROM support_tickets WHERE id = $1`;
        let params = [ticketId];

        if (role === 'WORKER') {
            query += ` AND worker_id = $2`;
            params.push(workerId);
        } else {
            query += ` AND user_id = $2`;
            params.push(userId);
        }

        const result = await db.query(query, params);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Ticket not found" });
        }

        res.json({
            success: true,
            ticket: result.rows[0]
        });
    } catch (error) {
        console.error('[SUPPORT] Error fetching ticket:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;