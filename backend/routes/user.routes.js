const express = require('express');
const router = express.Router();
const db = require('../config/db');

/**
 * Helper to get user by ID or Phone
 */
async function getUser(identifier) {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    let query = isUUID ? "SELECT * FROM users WHERE id = $1::uuid" : "SELECT * FROM users WHERE phone_number = $1";
    const result = await db.query(query, [identifier]);
    return result.rowCount > 0 ? result.rows[0] : null;
}

/**
 * @route GET /api/user/profile/:identifier
 * @desc Fetch user profile using either UUID or phone number
 */
router.get('/profile/:identifier', async (req, res) => {
    try {
        const user = await getUser(req.params.identifier);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        
        // Map DB columns to expected frontend structure
        const mappedUser = {
            id: user.id,
            name: user.full_name,
            phone: user.phone_number,
            photoUrl: user.avatar_url,
            location: user.location,
            skills: user.skills || [],
            locations: user.locations || []
        };
        
        res.json({ success: true, user: mappedUser });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Support query param as fallback
router.get('/profile', async (req, res) => {
    try {
        const identifier = req.query.phoneNumber || req.query.userId;
        if (!identifier) return res.status(400).json({ success: false, error: 'Identifier required' });
        
        const user = await getUser(identifier);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        
        const mappedUser = {
            id: user.id,
            name: user.full_name,
            phone: user.phone_number,
            photoUrl: user.avatar_url,
            location: user.location,
            skills: user.skills || [],
            locations: user.locations || []
        };
        
        res.json({ success: true, user: mappedUser });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/user/sync/:identifier
 */
router.get('/sync/:identifier', async (req, res) => {
    try {
        const user = await getUser(req.params.identifier);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        
        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.full_name,
                phone: user.phone_number,
                photoUrl: user.avatar_url,
                locations: user.locations || []
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/user/save-profile
 */
router.post('/save-profile', async (req, res) => {
    try {
        const { userId, phoneNumber, name, location, skills, photoUrl } = req.body;
        const identifier = userId || phoneNumber;
        
        if (!identifier) return res.status(400).json({ success: false, error: 'User ID or Phone required' });
        
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
        const whereClause = isUUID ? "id = $1::uuid" : "phone_number = $1";
        
        const updateQuery = `
            UPDATE users 
            SET full_name = COALESCE($2, full_name), 
                location = COALESCE($3, location), 
                skills = COALESCE($4::jsonb, skills), 
                avatar_url = COALESCE($5, avatar_url)
            WHERE ${whereClause}
            RETURNING *;
        `;
        
        const result = await db.query(updateQuery, [
            identifier, 
            name, 
            location, 
            skills ? JSON.stringify(skills) : null, 
            photoUrl
        ]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const updatedUser = result.rows[0];
        res.json({ 
            success: true, 
            userId: updatedUser.id,
            user: {
                id: updatedUser.id,
                name: updatedUser.full_name,
                phone: updatedUser.phone_number,
                photoUrl: updatedUser.avatar_url,
                location: updatedUser.location,
                skills: updatedUser.skills || []
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/user/locations
 * @desc Add a saved location
 */
router.post('/locations', async (req, res) => {
    try {
        const { userId, phone, name, lat, lng, address, isDefault } = req.body;
        const identifier = userId || phone;
        
        if (!identifier) return res.status(400).json({ success: false, error: 'User ID or Phone required' });
        
        const user = await getUser(identifier);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        let currentLocations = user.locations || [];
        
        const newLoc = {
            id: Date.now().toString(),
            name,
            lat,
            lng,
            address,
            isDefault: isDefault || currentLocations.length === 0
        };

        if (newLoc.isDefault) {
            currentLocations = currentLocations.map(l => ({...l, isDefault: false}));
        }

        currentLocations.push(newLoc);

        await db.query(
            "UPDATE users SET locations = $1::jsonb WHERE id = $2::uuid",
            [JSON.stringify(currentLocations), user.id]
        );

        res.json({ success: true, location: newLoc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/user/locations/:identifier
 */
router.get('/locations/:identifier', async (req, res) => {
    try {
        const user = await getUser(req.params.identifier);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user.locations || []);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/user/recommendations
 */
router.get('/recommendations', async (req, res) => {
    try {
        const db = require('../config/db');
        const userId = req.user.userId;

        const result = await db.query(
            `SELECT DISTINCT category, COUNT(*) as job_count
             FROM jobs
             WHERE user_id = $1 AND status = 'COMPLETED'
             GROUP BY category
             ORDER BY job_count DESC
             LIMIT 10`,
            [userId]
        );

        const recommendations = result.rows.map(r => r.category);

        if (recommendations.length === 0) {
            const fallback = await db.query(
                `SELECT category, COUNT(*) as cnt FROM jobs WHERE status = 'COMPLETED' GROUP BY category ORDER BY cnt DESC LIMIT 5`
            );
            recommendations.push(...fallback.rows.map(r => r.category));
        }

        res.json({ success: true, recommendations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
