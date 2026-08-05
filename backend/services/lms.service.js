/**
 * Learning Management System (LMS) Service
 * Manages training courses, video/PDF lessons, quizzes, progress tracking & certificates
 */

const db = require('../config/db');

class LmsService {
    async getCourses(targetAudience = 'WORKER') {
        const res = await db.query(
            "SELECT * FROM lms_courses WHERE is_published = true AND (target_audience = $1 OR target_audience = 'ALL') ORDER BY created_at DESC",
            [targetAudience]
        );
        return res.rows;
    }

    async getCourseDetails(courseId) {
        const courseRes = await db.query("SELECT * FROM lms_courses WHERE id = $1", [courseId]);
        if (courseRes.rowCount === 0) throw new Error("Course not found");

        const lessonsRes = await db.query(
            "SELECT * FROM lms_lessons WHERE course_id = $1 ORDER BY sort_order ASC",
            [courseId]
        );

        return {
            ...courseRes.rows[0],
            lessons: lessonsRes.rows
        };
    }

    async enrollUser(id, idType, courseId) {
        const col = idType === 'WORKER' ? 'worker_id' : 'user_id';
        const existing = await db.query(
            `SELECT * FROM lms_enrollments WHERE ${col} = $1 AND course_id = $2`,
            [id, courseId]
        );

        if (existing.rowCount > 0) {
            return existing.rows[0];
        }

        const res = await db.query(
            `INSERT INTO lms_enrollments (${col}, course_id) VALUES ($1, $2) RETURNING *`,
            [id, courseId]
        );
        return res.rows[0];
    }

    async updateProgress(enrollmentId, progressPct) {
        const completed = parseFloat(progressPct) >= 100.0;
        const res = await db.query(
            `UPDATE lms_enrollments 
             SET progress_pct = $1, completed = $2, completed_at = CASE WHEN $2 = true THEN NOW() ELSE completed_at END
             WHERE id = $3 RETURNING *`,
            [progressPct, completed, enrollmentId]
        );

        if (completed) {
            const certNo = `NEXO-CERT-${Date.now()}-${enrollmentId.slice(0, 4).toUpperCase()}`;
            await db.query(
                "INSERT INTO lms_certificates (enrollment_id, certificate_number) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                [enrollmentId, certNo]
            );
        }

        return res.rows[0];
    }
}

module.exports = new LmsService();
