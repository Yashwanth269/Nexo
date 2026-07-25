const db = require('../config/db');
const rankingService = require('./ranking.service');
const searchRadiusService = require('./search_radius.service');
const skillConfidenceService = require('./skill_confidence.service');

class MultiServiceOptimizerService {
    /**
     * Finds the optimal execution plans (combinations of workers) to fulfill a list of services.
     * @param {Array<string>} requestedCategories - List of service categories requested
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {string} [userId] - Optional Customer UUID
     * @param {number} [radiusKm] - Search radius limit
     */
    async findOptimalPlans(requestedCategories, lat, lng, userId = null, radiusKm = 15) {
        if (!requestedCategories || requestedCategories.length === 0) {
            return [];
        }

        // Clean categories to uppercase
        const categories = requestedCategories.map(c => c.trim().toUpperCase());

        // 1. Fetch geo-candidate workers within radius
        const candidates = await rankingService.fetchGeoCandidates(lat, lng, radiusKm, null, userId);
        if (candidates.length === 0) {
            return [];
        }

        // 2. Fetch skill and confidence details for candidates
        const workers = [];
        for (const worker of candidates) {
            const skills = (worker.skills || []).map(s => s.trim().toUpperCase());
            const tasks = (worker.tasks || []).map(t => t.trim().toUpperCase());
            const allWorkerSkills = new Set([...skills, ...tasks]);

            // Filter down to only categories this worker can cover from requested list
            const coveredCategories = categories.filter(cat => {
                // simple substring/equality check
                return allWorkerSkills.has(cat) || 
                       [...allWorkerSkills].some(s => s.includes(cat) || cat.includes(s));
            });

            if (coveredCategories.length > 0) {
                // Retrieve skill confidence scores
                const confidenceScores = {};
                for (const cat of coveredCategories) {
                    try {
                        const sc = await skillConfidenceService.getCategoryConfidence(worker.id, cat);
                        confidenceScores[cat] = sc.confidence_score || 50;
                    } catch (e) {
                        confidenceScores[cat] = 50;
                    }
                }

                workers.push({
                    id: worker.id,
                    fullName: worker.full_name,
                    phoneNumber: worker.phone_number,
                    photoUrl: worker.photo_url,
                    rating: parseFloat(worker.raw_rating || 4.0),
                    jobsCompleted: parseInt(worker.jobs_completed || 0),
                    distance: parseFloat(worker.distance || 5.0),
                    repScore: parseFloat(worker.rep_overall_score || 50),
                    repReliability: parseFloat(worker.rep_reliability_score || 50),
                    activeJobs: parseInt(worker.active_jobs_count || 0),
                    expectedPrice: parseFloat(worker.expected_price || 250),
                    affinityCount: parseInt(worker.affinity_count || 0),
                    coveredCategories,
                    confidenceScores
                });
            }
        }

        if (workers.length === 0) {
            return [];
        }

        const plans = [];

        // --- STEP 2: Search for Complete Match (Single Worker covering 100%) ---
        const singleWorkerMatches = workers.filter(w => 
            categories.every(cat => w.coveredCategories.includes(cat))
        );

        if (singleWorkerMatches.length > 0) {
            // Build single-worker plans
            for (const worker of singleWorkerMatches) {
                const plan = this._buildPlan([worker], categories, 'SINGLE_WORKER');
                plans.push(plan);
            }
        }

        // --- STEP 3: Multi-worker Coverage Search (Set Cover Optimizer) ---
        // Even if we have single-worker matches, we search for multi-worker plans as backups or options
        const multiWorkerPlans = this._solveSetCover(workers, categories);
        plans.push(...multiWorkerPlans);

        // --- STEP 4: Score all plans using the 10-factor formula ---
        const scoredPlans = await Promise.all(plans.map(async (plan) => {
            const score = await this._scorePlan(plan, categories);
            return {
                ...plan,
                score
            };
        }));

        // Sort plans descending by score
        scoredPlans.sort((a, b) => b.score - a.score);

        // De-duplicate plans containing the exact same worker sets
        const uniquePlans = [];
        const seenKeys = new Set();
        for (const p of scoredPlans) {
            const key = p.assignments.map(a => a.workerId).sort().join(',');
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniquePlans.push(p);
            }
        }

        const topPlans = uniquePlans.slice(0, 5); // Return top 5 plans

        // dynamic badge logic and reasons
        for (let idx = 0; idx < topPlans.length; idx++) {
            const plan = topPlans[idx];
            plan.badges = [];
            plan.recommendationReason = "✓ Balanced Optimizer Match";

            if (idx === 0) {
                plan.badges.push("🤖 AI Recommended");
                plan.recommendationReason = "✓ AI Best Match";
            }
            if (plan.planType === 'SINGLE_WORKER') {
                plan.badges.push("🏆 Multi-Skilled Expert");
                plan.recommendationReason = "✓ One Professional";
            }
            if (plan.travelSavings > 0) {
                plan.badges.push("🚗 Shared Visit Savings");
            }
        }

        // Tag Fastest Completion and Best Value
        if (topPlans.length > 0) {
            let fastestPlan = topPlans[0];
            let bestValuePlan = topPlans[0];

            for (const p of topPlans) {
                if (p.estimatedDurationMinutes < fastestPlan.estimatedDurationMinutes) {
                    fastestPlan = p;
                }
                if (p.totalPrice < bestValuePlan.totalPrice) {
                    bestValuePlan = p;
                }
            }

            fastestPlan.badges.push("⚡ Fastest Completion");
            fastestPlan.badges = [...new Set(fastestPlan.badges)];
            fastestPlan.recommendationReason = "✓ Fastest Completion";

            bestValuePlan.badges.push("💰 Best Value");
            bestValuePlan.badges = [...new Set(bestValuePlan.badges)];
            bestValuePlan.recommendationReason = "✓ Lowest Cost";

            // Tag preferred worker if they have affinityCount
            for (const p of topPlans) {
                if (p.assignments.some(a => a.affinityCount > 0)) {
                    p.badges.push("⭐ Customer Favorite");
                    p.badges = [...new Set(p.badges)];
                    p.recommendationReason = "✓ Preferred Worker";
                }
            }
        }

        // Find dynamic upsell opportunity from real candidate worker skills
        let aiUpsell = null;
        if (topPlans.length > 0) {
            const topPlan = topPlans[0];
            for (const assign of topPlan.assignments) {
                const cand = candidates.find(c => c.id === assign.workerId);
                if (cand) {
                    const skills = (cand.skills || []).map(s => s.trim().toUpperCase());
                    const tasks = (cand.tasks || []).map(t => t.trim().toUpperCase());
                    const allWorkerSkills = [...new Set([...skills, ...tasks])];

                    // Find any skill not requested
                    const extraSkill = allWorkerSkills.find(s => !categories.includes(s));
                    if (extraSkill) {
                        aiUpsell = {
                            category: extraSkill.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                            price: 150,
                            originalPrice: 300,
                            description: `No additional visit charge (with ${assign.fullName})`,
                            workerId: assign.workerId
                        };
                        break;
                    }
                }
            }
        }

        // Frequently Added Together recommendations
        const frequentlyAddedTogether = [
            { category: "Deep Cleaning", price: 800, savings: 120, description: "Keep your home pristine" },
            { category: "AC Gas Refill", price: 600, savings: 80, description: "Ensure optimal cooling" },
            { category: "Electrical Inspection", price: 400, savings: 60, description: "Check for safety hazards" }
        ].filter(rec => !categories.includes(rec.category.toUpperCase()));

        // Return wrapped response object
        return {
            plans: topPlans,
            frequentlyAddedTogether,
            aiUpsell
        };
    }

    /**
     * Finds combination of workers that covers all requested categories
     */
    _solveSetCover(workers, categories) {
        const plans = [];
        // Limit exhaustive search to top 8 most promising workers to prevent complexity blowup
        const sortedWorkers = [...workers].sort((a, b) => b.coveredCategories.length - a.coveredCategories.length);
        const candidatePool = sortedWorkers.slice(0, 8);
        const N = candidatePool.length;

        // Exhaustive power set enumeration
        for (let mask = 1; mask < (1 << N); mask++) {
            const team = [];
            const covered = new Set();

            for (let i = 0; i < N; i++) {
                if (mask & (1 << i)) {
                    team.push(candidatePool[i]);
                    candidatePool[i].coveredCategories.forEach(c => covered.add(c));
                }
            }

            // Verify if all requested categories are covered by this team
            if (categories.every(cat => covered.has(cat))) {
                // If team size > 1, add to multi-worker plans
                if (team.length > 1) {
                    plans.push(this._buildPlan(team, categories, 'MULTI_WORKER'));
                }
            }
        }

        // If exhaustive search yielded nothing (e.g. pool is too small or disjoint), run greedy set cover
        if (plans.length === 0) {
            const team = [];
            const covered = new Set();
            const remaining = new Set(categories);

            while (remaining.size > 0) {
                let bestWorker = null;
                let bestNewCoverCount = 0;

                for (const w of workers) {
                    if (team.some(member => member.id === w.id)) continue;
                    const newCover = w.coveredCategories.filter(c => remaining.has(c)).length;
                    if (newCover > bestNewCoverCount) {
                        bestNewCoverCount = newCover;
                        bestWorker = w;
                    }
                }

                if (!bestWorker) break; // Cannot cover remaining

                team.push(bestWorker);
                bestWorker.coveredCategories.forEach(c => {
                    covered.add(c);
                    remaining.delete(c);
                });
            }

            if (categories.every(cat => covered.has(cat)) && team.length > 1) {
                plans.push(this._buildPlan(team, categories, 'MULTI_WORKER'));
            }
        }

        return plans;
    }

    /**
     * Builds structured plan payload mapping services to worker assignments
     */
    _buildPlan(workers, categories, planType) {
        const assignments = [];
        const covered = new Set();

        // Assign each category to the best worker in the team covering it (highest confidence score)
        for (const cat of categories) {
            let assignedWorker = null;
            let highestConfidence = -1;

            for (const w of workers) {
                if (w.coveredCategories.includes(cat)) {
                    const conf = w.confidenceScores[cat] || 0;
                    if (conf > highestConfidence) {
                        highestConfidence = conf;
                        assignedWorker = w;
                    }
                }
            }

            if (assignedWorker) {
                let existing = assignments.find(a => a.workerId === assignedWorker.id);
                if (!existing) {
                    existing = {
                        workerId: assignedWorker.id,
                        fullName: assignedWorker.fullName,
                        phoneNumber: assignedWorker.phoneNumber,
                        photoUrl: assignedWorker.photoUrl,
                        distance: assignedWorker.distance,
                        rating: assignedWorker.rating,
                        repScore: assignedWorker.repScore,
                        repReliability: assignedWorker.repReliability,
                        activeJobs: assignedWorker.activeJobs,
                        affinityCount: assignedWorker.affinityCount,
                        assignedCategories: [],
                        payout: 0.00
                    };
                    assignments.push(existing);
                }
                existing.assignedCategories.push(cat);
                // Assume base price of 300 per service for calculation if not specified
                existing.payout += (assignedWorker.expectedPrice || 250);
            }
        }

        const totalCost = assignments.reduce((sum, a) => sum + a.payout, 0);
        // Estimate 45 mins per category + travel time
        const estimatedDuration = Math.max(...assignments.map(a => a.assignedCategories.length * 45 + Math.round(a.distance * 5)));

        const N = categories.length;
        const M = assignments.length;
        const separateTravelCost = N * 50;
        const bundleTravelCost = M * 50;
        const travelSavings = separateTravelCost - bundleTravelCost;
        const comboDiscount = Math.round(totalCost * 0.1); // 10% discount on base service fees
        const platformFee = 40;
        const finalPrice = totalCost + bundleTravelCost + platformFee - comboDiscount;

        return {
            planType,
            assignments,
            totalPrice: finalPrice,
            serviceCharge: totalCost,
            platformFee,
            travelFee: bundleTravelCost,
            comboDiscount,
            comboSavings: travelSavings + comboDiscount,
            travelSavings,
            estimatedDurationMinutes: estimatedDuration
        };
    }

    /**
     * Computes the 10-factor optimization score for a candidate plan
     */
    async _scorePlan(plan, categories) {
        const workerCount = plan.assignments.length;
        const totalCost = plan.totalPrice;
        const duration = plan.estimatedDurationMinutes;

        // Factor 1: Single Worker Coverage (Bonus for single worker)
        const singleWorkerBonus = plan.planType === 'SINGLE_WORKER' ? 1.0 : 0.0;

        // Factor 2: Minimum Number of Workers (Inverse normalized)
        const workerCountScore = Math.max(0, 1.0 - (workerCount / (categories.length + 1)));

        // Factor 3 & 8: Skill Match & Skill Confidence
        let totalConfidence = 0;
        let categoriesChecked = 0;
        plan.assignments.forEach(a => {
            a.assignedCategories.forEach(cat => {
                // Find worker confidence score
                const worker = plan.assignments.find(w => w.workerId === a.workerId);
                totalConfidence += (worker ? (worker.repScore || 50) : 50);
                categoriesChecked++;
            });
        });
        const skillConfidence = categoriesChecked > 0 ? (totalConfidence / categoriesChecked) / 100.0 : 0.5;

        // Factor 4: Worker Reputation (Average repScore)
        const avgReputation = plan.assignments.reduce((sum, a) => sum + a.repScore, 0) / workerCount / 100.0;

        // Factor 5: Shortest Travel Distance (Average distance)
        const avgDistance = plan.assignments.reduce((sum, a) => sum + a.distance, 0) / workerCount;
        const distanceScore = 1.0 / (1.0 + avgDistance);

        // Factor 6: Fastest Completion Time
        const durationScore = Math.max(0, 1.0 - (duration / 480.0)); // Normalized over 8 hours max

        // Factor 7: Lowest Total Cost
        const costScore = 1.0 / (1.0 + (totalCost / 1000.0));

        // Factor 8: Customer Preferences (Affinity)
        const totalAffinity = plan.assignments.reduce((sum, a) => sum + a.affinityCount, 0);
        const affinityScore = Math.min(1.0, totalAffinity * 0.25);

        // Factor 9: Worker Workload (Balance)
        const avgActiveJobs = plan.assignments.reduce((sum, a) => sum + a.activeJobs, 0) / workerCount;
        const workloadScore = Math.max(0, 1.0 - (avgActiveJobs * 0.3));

        // Factor 10: Dispatch Score (Average reliability)
        const avgReliability = plan.assignments.reduce((sum, a) => sum + a.repReliability, 0) / workerCount / 100.0;

        // Weights summing to 1.0
        const weights = {
            singleWorker: 0.25,
            workerCount: 0.15,
            skillConfidence: 0.15,
            reputation: 0.15,
            distance: 0.10,
            duration: 0.08,
            cost: 0.05,
            affinity: 0.04,
            workload: 0.02,
            reliability: 0.02
        };

        const score = 
            (singleWorkerBonus * weights.singleWorker) +
            (workerCountScore * weights.workerCount) +
            (skillConfidence * weights.skillConfidence) +
            (avgReputation * weights.reputation) +
            (distanceScore * weights.distance) +
            (durationScore * weights.duration) +
            (costScore * weights.cost) +
            (affinityScore * weights.affinity) +
            (workloadScore * weights.workload) +
            (avgReliability * weights.reliability);

        return Math.max(0, Math.min(1.0, score));
    }
}

module.exports = new MultiServiceOptimizerService();
