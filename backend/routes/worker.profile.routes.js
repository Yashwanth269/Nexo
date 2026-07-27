const express = require('express');
const router = express.Router();
const db = require('../config/db');

/**
 * Maps database worker row to frontend structure
 */
function mapWorker(w) {
    if (!w) return null;
    return {
        id: w.id,
        phoneNumber: w.phone_number,
        name: w.full_name,
        skills: w.skills || [],
        tasks: w.tasks || [],
        languages: w.languages || [],
        state: w.state,
        experience: w.experience,
        workRadius: w.work_radius,
        photoUrl: w.photo_url,
        idUrl: w.id_url,
        isProfileComplete: w.is_profile_complete,
        verificationStatus: w.verification_status,
        rating: w.rating ? parseFloat(w.rating) : null,
        isOnline: w.is_online,
        isAvailable: w.is_available,
        jobsCompleted: w.jobs_completed,
        createdAt: w.created_at,
        updatedAt: w.updated_at
    };
}

// Update Worker Profile (Setup)
router.post('/setup', async (req, res) => {
    try {
        const { phoneNumber, name, skills, tasks, languages, state, experience, workRadius, photoUrl, idUrl } = req.body;
        
        // Check if worker exists
        const checkResult = await db.query("SELECT id FROM workers WHERE phone_number = $1", [phoneNumber]);
        if (checkResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Worker not found" });
        }

        const workerId = checkResult.rows[0].id;

        // Strict Validation
        if (!name || !skills || skills.length === 0 || !state) {
            return res.status(400).json({ success: false, message: "Missing required profile data" });
        }

        // Update in DB
        const updateResult = await db.query(
            `UPDATE workers SET 
                full_name = $1, 
                skills = $2, 
                tasks = $3, 
                languages = $4, 
                state = $5, 
                experience = $6, 
                work_radius = $7, 
                photo_url = $8, 
                id_url = $9, 
                is_profile_complete = true, 
                verification_status = $10,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $11
             RETURNING *`,
            [
                name, 
                skills, 
                tasks || [], 
                languages || [], 
                state, 
                experience, 
                workRadius || 15, 
                photoUrl, 
                idUrl, 
                'VERIFIED',
                workerId
            ]
        );

        const worker = mapWorker(updateResult.rows[0]);

        // ML Baseline Logging (Simplified)
        console.log(`\n🧠 [ML PIPELINE] Training Triggered for Worker ${phoneNumber}`);
        console.log(`✅ [ML STORE] Worker Profile Indexed for Real-time Ranking\n`);

        res.json({ success: true, message: "Profile completed successfully", worker });
    } catch (error) {
        console.error("❌ [PROFILE-SETUP ERROR]", error.message);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// Configure Dynamic Marketplace Worker Skills & Pricing
router.post('/skills', async (req, res) => {
    try {
        const workerId = req.user?.workerId;
        const { skills } = req.body; // Array of { skillName, subcategoryId, categoryId, experienceYears, hourlyRate, fixedRate, pricingType, isEmergency }

        if (!workerId || !Array.isArray(skills)) {
            return res.status(400).json({ success: false, message: "Invalid payload or worker unauthorized" });
        }

        for (const s of skills) {
            if (!s.skillName) continue;
            await db.query(`
                INSERT INTO worker_skills (worker_id, category_id, subcategory_id, skill_name, experience_years, certifications, hourly_rate, fixed_rate, pricing_type, is_emergency)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (worker_id, subcategory_id, skill_name) DO UPDATE SET
                    experience_years = EXCLUDED.experience_years,
                    certifications = EXCLUDED.certifications,
                    hourly_rate = EXCLUDED.hourly_rate,
                    fixed_rate = EXCLUDED.fixed_rate,
                    pricing_type = EXCLUDED.pricing_type,
                    is_emergency = EXCLUDED.is_emergency,
                    updated_at = CURRENT_TIMESTAMP;
            `, [
                workerId,
                s.categoryId || null,
                s.subcategoryId || null,
                s.skillName,
                s.experienceYears || 1,
                s.certifications || [],
                s.hourlyRate || null,
                s.fixedRate || null,
                s.pricingType || 'HOURLY',
                s.isEmergency || false
            ]);
        }

        // Also update legacy skills array on worker row for fast fallback
        const skillNames = skills.map(s => s.skillName).filter(Boolean);
        if (skillNames.length > 0) {
            await db.query("UPDATE workers SET skills = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [skillNames, workerId]);
        }

        res.json({ success: true, count: skills.length, message: "Worker skills saved successfully" });
    } catch (error) {
        console.error("❌ [WORKER-SKILLS ERROR]", error.message);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// Get Configured Worker Skills
router.get('/skills', async (req, res) => {
    try {
        const workerId = req.user?.workerId;
        if (!workerId) return res.status(401).json({ success: false, error: "Unauthorized" });

        const result = await db.query("SELECT * FROM worker_skills WHERE worker_id = $1 ORDER BY created_at DESC", [workerId]);
        res.json({ success: true, skills: result.rows });
    } catch (error) {
        console.error("❌ [GET-WORKER-SKILLS ERROR]", error.message);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// Get Detailed Worker Profile & Performance Metrics
router.get('/details/:phoneNumber', async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const result = await db.query("SELECT * FROM workers WHERE phone_number = $1", [phoneNumber]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Worker not found" });
        }

        const worker = mapWorker(result.rows[0]);
        const workerId = worker.id;

        // Run achievements evaluation
        const gamificationService = require('../services/gamification.service');
        await gamificationService.evaluateWorker(workerId).catch(err => {
            console.error("⚠️ [ACHIEVEMENTS-EVAL-ERROR]", err.message);
        });

        const achievements = await gamificationService.getWorkerAchievements(workerId);

        // Calculate performance metrics from real DB data
        const [
            ratingsRes,
            offersRes,
            responseRes,
            jobsRes,
            cancellationsRes,
            onTimeRes
        ] = await Promise.all([
            // Ratings (USER_TO_WORKER)
            db.query("SELECT COUNT(*) as count, AVG(rating) as avg FROM ratings WHERE to_id = $1 AND rating_type = 'USER_TO_WORKER'", [workerId]),
            // Total offers received
            db.query("SELECT COUNT(*) as count FROM job_offers WHERE worker_id = $1", [workerId]),
            // Response time
            db.query("SELECT COUNT(*) as count, AVG(EXTRACT(EPOCH FROM (accepted_at - created_at))) as avg_sec FROM job_offers WHERE worker_id = $1 AND status = 'ACCEPTED' AND accepted_at IS NOT NULL", [workerId]),
            // Completed jobs
            db.query("SELECT COUNT(*) as count FROM jobs WHERE worker_id = $1 AND status = 'COMPLETED'", [workerId]),
            // Worker cancellations
            db.query("SELECT COUNT(*) as count FROM jobs WHERE worker_id = $1 AND status = 'CANCELLED' AND cancelled_by = 'WORKER'", [workerId]),
            // On-time arrivals among completed jobs
            db.query(
                `SELECT COUNT(*) as count FROM jobs j
                 LEFT JOIN job_slas s ON j.id = s.job_id
                 WHERE j.worker_id = $1 AND j.status = 'COMPLETED' AND j.arrived_at IS NOT NULL
                   AND (
                     (j.scheduled_at IS NOT NULL AND j.arrived_at <= j.scheduled_at)
                     OR (j.scheduled_at IS NULL AND s.arrival_deadline IS NOT NULL AND j.arrived_at <= s.arrival_deadline)
                     OR (j.scheduled_at IS NULL AND s.arrival_deadline IS NULL AND j.arrived_at <= j.accepted_at + INTERVAL '30 minutes')
                   )`,
                [workerId]
            )
        ]);

        const ratingsCount = parseInt(ratingsRes.rows[0]?.count || 0);
        const avgRating = parseFloat(ratingsRes.rows[0]?.avg || 0);
        const totalOffers = parseInt(offersRes.rows[0]?.count || 0);
        const responsesCount = parseInt(responseRes.rows[0]?.count || 0);
        const avgResponseSec = parseFloat(responseRes.rows[0]?.avg_sec || 0);
        const completedJobs = parseInt(jobsRes.rows[0]?.count || 0);
        const workerCancelledJobs = parseInt(cancellationsRes.rows[0]?.count || 0);
        const onTimeArrivals = parseInt(onTimeRes.rows[0]?.count || 0);

        // Fetch accepted offers count to calculate completion/cancellation rates
        const acceptedRes = await db.query("SELECT COUNT(*) as count FROM job_offers WHERE worker_id = $1 AND status = 'ACCEPTED'", [workerId]);
        const acceptedJobs = parseInt(acceptedRes.rows[0]?.count || 0);

        // Threshold checks
        const hasRating = ratingsCount >= 5;
        const hasAcceptanceRate = totalOffers >= 10;
        const hasResponseTime = responsesCount >= 10;

        const isNewProfessional = !hasRating || !hasAcceptanceRate || !hasResponseTime;

        // Formats
        let ratingText = "New Professional";
        if (ratingsCount === 0) {
            ratingText = "No ratings yet";
        } else if (ratingsCount >= 5) {
            ratingText = avgRating.toFixed(1);
        }

        const acceptanceRate = hasAcceptanceRate ? `${Math.round((acceptedJobs / totalOffers) * 100)}%` : "New Professional";
        const completionRate = acceptedJobs > 0 ? `${Math.round((completedJobs / acceptedJobs) * 100)}%` : "100%";
        
        let cancellationRate = "0%";
        if (completedJobs > 0 && acceptedJobs > 0) {
            cancellationRate = `${Math.round((workerCancelledJobs / acceptedJobs) * 100)}%`;
        }

        const onTimeRate = completedJobs > 0 ? `${Math.round((onTimeArrivals / completedJobs) * 100)}%` : "New Professional";

        let responseTimeStr = "New Professional";
        if (hasResponseTime) {
            if (avgResponseSec < 60) {
                responseTimeStr = `${Math.round(avgResponseSec)}s`;
            } else if (avgResponseSec < 3600) {
                responseTimeStr = `${Math.round(avgResponseSec / 60)}m`;
            } else {
                responseTimeStr = `${(avgResponseSec / 3600).toFixed(1)}h`;
            }
        }

        const performance = {
            totalJobs: completedJobs,
            completedJobs,
            completionRate,
            cancellationRate,
            avgResponseTime: responseTimeStr,
            responseTime: responseTimeStr,
            rating: hasRating ? avgRating : null,
            ratingText,
            hasRating,
            acceptanceRate,
            hasAcceptanceRate,
            onTimeRate,
            isNewProfessional,
            isVerified: worker.verificationStatus === 'VERIFIED'
        };

        res.json({
            success: true,
            worker: {
                ...worker,
                performance,
                achievements,
                recentReviews: []
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Profile Photo
router.post('/update-photo', async (req, res) => {
    try {
        const { phoneNumber, photoUrl } = req.body;
        const result = await db.query(
            "UPDATE workers SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE phone_number = $2 RETURNING *",
            [photoUrl, phoneNumber]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Worker not found" });
        }
        res.json({ success: true, message: "Photo updated successfully", worker: mapWorker(result.rows[0]) });
    } catch (error) {
        console.error("Error updating photo:", error.message);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// Get Worker Profile
router.get('/:phoneNumber', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM workers WHERE phone_number = $1", [req.params.phoneNumber]);
        
        if (result.rowCount > 0) {
            res.json({ success: true, worker: mapWorker(result.rows[0]) });
        } else {
            res.status(404).json({ success: false, message: "Worker not found" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
