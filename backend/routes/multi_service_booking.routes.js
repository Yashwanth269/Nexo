const express = require('express');
const router = express.Router();
const service = require('../services/multi_service_booking.service');
const db = require('../config/db');

// POST /api/multi-booking/create
router.post('/create', async (req, res) => {
    try {
        const { services, location, scheduledAt } = req.body;
        const userId = req.user.userId;

        if (!services || !Array.isArray(services) || services.length === 0) {
            return res.status(400).json({ error: 'Please specify at least one service category.' });
        }
        if (!location || !location.lat || !location.lng) {
            return res.status(400).json({ error: 'Please specify a valid booking location (latitude and longitude).' });
        }

        const result = await service.createBooking(userId, services, location, scheduledAt);
        res.status(201).json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/create:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

// POST /api/multi-booking/:id/accept-plan
router.post('/:id/accept-plan', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { planIndex } = req.body;
        const userId = req.user.userId;

        if (planIndex === undefined || planIndex === null) {
            return res.status(400).json({ error: 'Please specify a plan index to accept.' });
        }

        const result = await service.acceptPlan(bookingId, parseInt(planIndex), userId);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/:id/accept-plan:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

// POST /api/multi-booking/assignment/:id/accept
router.post('/assignment/:id/accept', async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const workerId = req.user.userId; // assuming worker token provides userId

        const result = await service.workerAcceptsAssignment(assignmentId, workerId);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/assignment/:id/accept:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

// POST /api/multi-booking/assignment/:id/decline
router.post('/assignment/:id/decline', async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const workerId = req.user.userId;

        const result = await service.workerDeclinesAssignment(assignmentId, workerId);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/assignment/:id/decline:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

// POST /api/multi-booking/:id/addon/suggest
router.post('/:id/addon/suggest', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { category, price, description } = req.body;
        const workerId = req.user.userId;

        if (!category || !price) {
            return res.status(400).json({ error: 'Please specify a category and a price for the suggested add-on.' });
        }

        const result = await service.suggestAddon(bookingId, workerId, category, price, description);
        res.status(201).json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/:id/addon/suggest:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

// POST /api/multi-booking/addon/:addonId/respond
router.post('/addon/:addonId/respond', async (req, res) => {
    try {
        const addonId = req.params.addonId;
        const { accepted } = req.body;
        const userId = req.user.userId;

        if (accepted === undefined || accepted === null) {
            return res.status(400).json({ error: 'Please specify whether you accept or decline (accepted: true/false).' });
        }

        const result = await service.respondToAddon(addonId, userId, accepted);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/addon/:addonId/respond:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

// GET /api/multi-booking/:id
router.get('/:id', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const userId = req.user.userId;

        const bookingRes = await db.query("SELECT * FROM multi_service_bookings WHERE id = $1 AND (user_id = $2 OR EXISTS(SELECT 1 FROM multi_service_assignments WHERE booking_id = $1 AND worker_id = $2))", [bookingId, userId]);
        if (bookingRes.rowCount === 0) {
            return res.status(404).json({ error: 'Booking not found or access denied.' });
        }

        const itemsRes = await db.query("SELECT * FROM multi_service_booking_items WHERE booking_id = $1", [bookingId]);
        const assignmentsRes = await db.query("SELECT * FROM multi_service_assignments WHERE booking_id = $1", [bookingId]);
        const addonsRes = await db.query("SELECT * FROM multi_service_addon_offers WHERE booking_id = $1", [bookingId]);

        res.json({
            booking: bookingRes.rows[0],
            items: itemsRes.rows,
            assignments: assignmentsRes.rows,
            addons: addonsRes.rows
        });
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/:id:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

// POST /api/multi-booking/natural-language-parse
router.post('/natural-language-parse', async (req, res) => {
    try {
        const { text, location } = req.body;
        const userId = req.user.userId;

        if (!text) {
            return res.status(400).json({ error: 'Please enter your request text.' });
        }
        if (!location || !location.lat || !location.lng) {
            return res.status(400).json({ error: 'Please specify a valid location.' });
        }

        const result = await service.naturalLanguageParseAndPlan(userId, text, location);
        res.json(result);
    } catch (e) {
        console.error('[ROUTE-ERROR] /multi-booking/natural-language-parse:', e.message);
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

module.exports = router;
