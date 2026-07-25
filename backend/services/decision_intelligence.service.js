const db = require('../config/db');
const shadowBanService = require('./shadow_ban.service');
const fatigueService = require('./fatigue.service');
const workerPreferenceService = require('./worker_preference.service');

class DecisionIntelligenceService {
    /**
     * Aggregates all scoring components into a single ranked dispatch score (0.00 to 100.00).
     * @param {string} workerId 
     * @param {string} jobId 
     * @param {number} distanceKm 
     */
    async getDispatchRankScore(workerId, jobId, distanceKm) {
        try {
            // 1. Worker Preference Score
            let preferenceScore = 50.0;
            try {
                // Fetch preference rating
                const pref = await workerPreferenceService.getCompositeScore(workerId, jobId);
                preferenceScore = parseFloat(pref.score || 50.0);
            } catch (_) {
                // fallback if not found
            }

            // 2. Reputation & Trust
            let reputationScore = 70.0;
            const reputationRes = await db.query(
                "SELECT reliability_score, trust_score, overall_score FROM worker_reputation_scores WHERE worker_id = $1",
                [workerId]
            );
            if (reputationRes.rowCount > 0) {
                const rep = reputationRes.rows[0];
                reputationScore = (parseFloat(rep.reliability_score || 50) + parseFloat(rep.trust_score || 50)) / 2.0;
            }

            // 3. Skill Confidence
            let skillConfidenceScore = 70.0;
            const jobRes = await db.query("SELECT category FROM jobs WHERE id = $1", [jobId]);
            if (jobRes.rowCount > 0) {
                const category = jobRes.rows[0].category;
                const confRes = await db.query(
                    "SELECT confidence_score FROM worker_skill_confidence WHERE worker_id = $1 AND category = $2",
                    [workerId, category]
                );
                if (confRes.rowCount > 0) {
                    skillConfidenceScore = parseFloat(confRes.rows[0].confidence_score);
                }
            }

            // 4. Fatigue Score
            let fatigueScore = 0.0;
            try {
                const fatigue = await fatigueService.getFatigueScore(workerId);
                fatigueScore = parseFloat(fatigue.score || 0.0) * 100.0; // scale to 100
            } catch (_) {}

            // 5. Distance Score (decaying as distance expands)
            const distanceScore = Math.max(0.0, 100.0 - (distanceKm * 5.0));

            // 6. Shadow Ban Multiplier
            let shadowBanMultiplier = 1.0;
            try {
                const banPenalty = await shadowBanService.applyBanPenalties(workerId, 1.0, 1.0);
                shadowBanMultiplier = parseFloat(banPenalty.dispatch || 1.0);
            } catch (_) {}

            // Unified composite score calculation (Requirement: Decision Intelligence Layer)
            const weightedScore = 
                (preferenceScore * 0.15) + 
                (reputationScore * 0.25) + 
                (skillConfidenceScore * 0.20) - 
                (fatigueScore * 0.15) + 
                (distanceScore * 0.25);

            const finalScore = Math.max(0.0, Math.min(100.0, weightedScore)) * shadowBanMultiplier;

            console.log(`🧠 [DECISION-INTELLIGENCE] Worker ${workerId} Composite Dispatch Score: ${finalScore.toFixed(2)} (Pref: ${preferenceScore.toFixed(1)}, Rep: ${reputationScore.toFixed(1)}, Conf: ${skillConfidenceScore.toFixed(1)}, Fatigue: ${fatigueScore.toFixed(1)}, Dist: ${distanceScore.toFixed(1)}, Ban: ${shadowBanMultiplier})`);

            return {
                finalScore: parseFloat(finalScore.toFixed(2)),
                preferenceScore,
                reputationScore,
                skillConfidenceScore,
                fatigueScore,
                distanceScore,
                shadowBanMultiplier
            };
        } catch (e) {
            console.error("🧠 [DECISION-INTELLIGENCE-ERROR] Failed to compile dispatch score:", e.message);
            // Default safe fallback score
            return { finalScore: 50.0 };
        }
    }
}

module.exports = new DecisionIntelligenceService();
