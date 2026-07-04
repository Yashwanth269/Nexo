const express = require('express');
const router = express.Router();
const { z } = require('zod');
const feedbackService = require('../services/feedback.service');
const { authenticateToken, optionalAuth } = require('../utils/auth.middleware');

const feedbackSchema = z.object({
    userId: z.string().uuid(),
    workerId: z.string().uuid(),
    jobId: z.string().uuid(),
    actionType: z.enum(['click', 'view', 'accept', 'complete', 'rate', 'reject', 'timeout', 'cancel']),
    value: z.number().optional(),
    sessionId: z.string().optional(),
});

router.post('/event', authenticateToken, async (req, res) => {
    try {
        const validated = feedbackSchema.parse(req.body);
        await feedbackService.recordEvent(
            validated.userId,
            validated.workerId,
            validated.jobId,
            validated.actionType,
            { value: validated.value, sessionId: validated.sessionId }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/worker/:workerId/summary', authenticateToken, async (req, res) => {
    try {
        const summary = await feedbackService.getWorkerFeedbackSummary(req.params.workerId);
        res.json({ success: true, summary });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
