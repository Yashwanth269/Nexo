const express = require('express');
const router = express.Router();

// Dev-only test routes - blocked in production
if (process.env.NODE_ENV === 'production') {
    router.all('*', (req, res) => res.status(404).json({ success: false, message: 'Not Found' }));
    module.exports = router;
}

const matchingEngine = require('../services/matching.service');

// Simulate a Job Post from a User (Dev only)
router.post('/simulate-job', async (req, res) => {
    const { type, price, lat, lng } = req.body;
    
    const mockJob = {
        id: "JOB_" + Date.now(),
        type: type || "Electrician",
        price: price || "₹400",
        location: { lat: lat || 12.9716, lng: lng || 77.5946 }, // Default Bangalore
        status: "OPEN"
    };

    await matchingEngine.broadcastJob(mockJob);
    
    res.json({ success: true, message: "Job Broadcast Triggered", job: mockJob });
});

module.exports = router;
