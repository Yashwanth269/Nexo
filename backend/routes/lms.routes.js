const express = require('express');
const router = express.Router();
const lmsService = require('../services/lms.service');
const { authenticateToken } = require('../utils/auth.middleware');

router.get('/courses', async (req, res) => {
    try {
        const { audience } = req.query;
        const courses = await lmsService.getCourses(audience || 'WORKER');
        res.json({ success: true, courses });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/courses/:id', async (req, res) => {
    try {
        const course = await lmsService.getCourseDetails(req.params.id);
        res.json({ success: true, course });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/enroll', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.body;
        const id = req.user.workerId || req.user.userId;
        const type = req.user.workerId ? 'WORKER' : 'USER';
        const enrollment = await lmsService.enrollUser(id, type, courseId);
        res.json({ success: true, enrollment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/progress', authenticateToken, async (req, res) => {
    try {
        const { enrollmentId, progressPct } = req.body;
        const enrollment = await lmsService.updateProgress(enrollmentId, progressPct);
        res.json({ success: true, enrollment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
