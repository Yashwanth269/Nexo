'use strict';

const db = require('../config/db');

class TeamRecommendationService {
    /**
     * Scores and ranks team proposals for a given team job.
     */
    async rankProposals(teamJobId, proposals) {
        if (!proposals || proposals.length === 0) return [];

        const jobRes = await db.query(
            "SELECT overall_budget, duration_days, location_lat, location_lng FROM team_jobs WHERE id = $1",
            [teamJobId]
        );
        if (jobRes.rowCount === 0) return proposals;
        const job = jobRes.rows[0];

        const jobBudget = parseFloat(job.overall_budget || 0);

        // Fetch detailed profiles of the team/leader for each proposal
        const scoredProposals = [];
        
        for (const prop of proposals) {
            const leaderId = prop.leader_id;

            // Fetch verified team stats or fallback to worker features
            const teamRes = await db.query(
                "SELECT * FROM verified_teams WHERE leader_id = $1",
                [leaderId]
            );
            const team = teamRes.rows[0] || {};

            const rating = parseFloat(team.rating || prop.leader_rating || 4.5);
            const completionRate = parseFloat(team.completion_rate || 100);
            const attendanceRate = parseFloat(team.attendance_rate || 100);
            const verifiedMembers = parseInt(team.members_count || 1);
            const projectsCompleted = parseInt(team.projects_completed || 0);

            // Cost Competitiveness: closer to or slightly below budget is optimal, but prevent 0 division
            const proposalBudget = parseFloat(prop.budget);
            let costScore = 1.0;
            if (jobBudget > 0) {
                // If proposal budget is lower than requested budget, score is higher.
                costScore = jobBudget / proposalBudget;
            }

            // Speed score: lower duration is better
            const proposalDuration = parseInt(prop.duration_days);
            const speedScore = proposalDuration > 0 ? (job.duration_days / proposalDuration) : 1.0;

            // Composite score calculation
            const score = (
                ((rating / 5) * 0.25) +
                ((completionRate / 100) * 0.20) +
                ((attendanceRate / 100) * 0.15) +
                (Math.min(1.5, costScore) * 0.20) +
                (Math.min(1.5, speedScore) * 0.20)
            );

            scoredProposals.push({
                ...prop,
                teamName: team.team_name || `${prop.leader_name || 'Leader'}'s Team`,
                rating,
                completionRate,
                attendanceRate,
                projectsCompleted,
                verifiedMembers,
                aiScore: parseFloat(score.toFixed(4)),
                badges: []
            });
        }

        // Sort by aiScore descending
        scoredProposals.sort((a, b) => b.aiScore - a.aiScore);

        // Assign recommendation badges dynamically
        if (scoredProposals.length > 0) {
            // 1. Lowest Cost
            const lowestCost = [...scoredProposals].sort((a, b) => parseFloat(a.budget) - parseFloat(b.budget))[0];
            
            // 2. Fastest Completion
            const fastest = [...scoredProposals].sort((a, b) => a.duration_days - b.duration_days)[0];

            // 3. Top Rated
            const topRated = [...scoredProposals].sort((a, b) => b.rating - a.rating)[0];

            // 4. Most Reliable (Highest Completion Rate)
            const mostReliable = [...scoredProposals].sort((a, b) => b.completionRate - a.completionRate)[0];

            // Primary Recommendation (Highest composite AI score)
            const bestValue = scoredProposals[0];

            for (const p of scoredProposals) {
                if (p.id === bestValue.id) {
                    p.badges.push("⭐ Best Value");
                } else if (p.id === lowestCost.id) {
                    p.badges.push("💰 Lowest Cost");
                } else if (p.id === fastest.id) {
                    p.badges.push("⚡ Fastest Completion");
                } else if (p.id === topRated.id) {
                    p.badges.push("👑 Top Rated Team");
                } else if (p.id === mostReliable.id) {
                    p.badges.push("🛡️ Most Reliable");
                }
                
                // Fallback badge if empty
                if (p.badges.length === 0) {
                    p.badges.push("Verified Team");
                }
            }
        }

        return scoredProposals;
    }
}

module.exports = new TeamRecommendationService();
