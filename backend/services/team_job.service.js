'use strict';

const db = require('../config/db');
const redis = require('../config/redis');

class TeamJobService {
    /**
     * Creates a new Team Job request.
     */
    async createTeamJob(data) {
        const {
            userId, category, subcategoryId, description, workersRequired,
            durationDays, startTime, endTime, pricingType, overallBudget,
            dailyWagePerWorker, locationLat, locationLng, address, preferredStartDate,
            photos = [], videoUrl = null
        } = data;

        // Validation
        if (!userId || !category || !subcategoryId || !workersRequired || !durationDays || !startTime || !endTime || !pricingType || !preferredStartDate) {
            throw new Error('MISSING_REQUIRED_FIELDS');
        }

        let resolvedSubcatId = subcategoryId;
        let resolvedJobId = null;
        let resolvedCategory = category;

        const isUUID = (id) => id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        
        if (isUUID(subcategoryId)) {
            // Check if subcategoryId actually refers to a job in marketplace_jobs
            const jobCheck = await db.query(
                `SELECT j.id as job_id, j.subcategory_id, c.name as category_name 
                 FROM marketplace_jobs j 
                 JOIN marketplace_categories c ON j.category_id = c.id 
                 WHERE j.id = $1 LIMIT 1`,
                [subcategoryId]
            );
            
            if (jobCheck.rowCount > 0) {
                resolvedJobId = jobCheck.rows[0].job_id;
                resolvedSubcatId = jobCheck.rows[0].subcategory_id;
                resolvedCategory = jobCheck.rows[0].category_name;
            }
        } else {
            // Find by name/slug in marketplace_subcategories
            const subRes = await db.query(
                "SELECT id FROM marketplace_subcategories WHERE slug = $1 OR name ILIKE $2 LIMIT 1",
                [category.toLowerCase().replace(/ /g, '-'), `%${category}%`]
            );
            if (subRes.rowCount > 0) {
                resolvedSubcatId = subRes.rows[0].id;
            } else {
                // Fallback to first subcategory in database
                const fallbackRes = await db.query("SELECT id FROM marketplace_subcategories LIMIT 1");
                resolvedSubcatId = fallbackRes.rows[0].id;
            }
        }

        // Calculate total
        let calculatedTotal = 0;
        if (pricingType === 'OVERALL_BUDGET') {
            calculatedTotal = parseFloat(overallBudget || 0);
        } else if (pricingType === 'DAILY_WAGE') {
            calculatedTotal = parseInt(workersRequired) * parseInt(durationDays) * parseFloat(dailyWagePerWorker || 0);
        } else {
            throw new Error('INVALID_PRICING_TYPE');
        }

        const query = `
            INSERT INTO team_jobs (
                user_id, category, subcategory_id, job_id, description, workers_required,
                duration_days, start_time, end_time, pricing_type, overall_budget,
                daily_wage_per_worker, calculated_total, photos, video_url,
                location_lat, location_lng, address, preferred_start_date, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'BROADCASTING')
            RETURNING *;
        `;

        const values = [
            userId, resolvedCategory, resolvedSubcatId, resolvedJobId, description, workersRequired,
            durationDays, startTime, endTime, pricingType, overallBudget,
            dailyWagePerWorker, calculatedTotal, photos, videoUrl,
            locationLat, locationLng, address, preferredStartDate
        ];

        const res = await db.query(query, values);
        const teamJob = res.rows[0];

        // Trigger Socket broadcast to team leaders
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.emit('new_team_job_broadcast', {
                    teamJobId: teamJob.id,
                    category: teamJob.category,
                    workersRequired: teamJob.workers_required,
                    durationDays: teamJob.duration_days,
                    budget: teamJob.calculated_total
                });
            }
        } catch (socketErr) {
            console.warn('[TEAM_JOB_SERVICE] Socket broadcast failed:', socketErr.message);
        }

        return teamJob;
    }

    /**
     * Submit a proposal/bid (or counter-offer) by a Team Leader.
     */
    async submitProposal(data) {
        const { teamJobId, leaderId, budget, workersCount, durationDays, estimatedCompletionDate, message } = data;

        const jobRes = await db.query("SELECT status FROM team_jobs WHERE id = $1", [teamJobId]);
        if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
        if (jobRes.rows[0].status !== 'BROADCASTING') throw new Error('JOB_NO_LONGER_OPEN_FOR_BIDS');

        const query = `
            INSERT INTO team_proposals (
                team_job_id, leader_id, budget, workers_count, duration_days, estimated_completion_date, message, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
            RETURNING *;
        `;

        const res = await db.query(query, [teamJobId, leaderId, budget, workersCount, durationDays, estimatedCompletionDate, message]);
        const proposal = res.rows[0];

        // Notify Customer
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            const jobDetails = await db.query("SELECT user_id FROM team_jobs WHERE id = $1", [teamJobId]);
            if (io && jobDetails.rowCount > 0) {
                const userId = jobDetails.rows[0].user_id;
                io.to(`user:${userId}`).emit('new_team_proposal', {
                    teamJobId,
                    proposalId: proposal.id,
                    leaderId,
                    budget
                });
            }
        } catch (e) {
            console.warn('[TEAM_JOB_SERVICE] Socket notification to user failed:', e.message);
        }

        return proposal;
    }

    /**
     * Accept a Team Leader's proposal.
     */
    async acceptProposal(proposalId, userId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const propRes = await client.query(
                "SELECT * FROM team_proposals WHERE id = $1 AND status = 'PENDING' FOR UPDATE",
                [proposalId]
            );
            if (propRes.rowCount === 0) throw new Error('PROPOSAL_NOT_FOUND_OR_PROCESSED');
            const proposal = propRes.rows[0];

            const jobRes = await client.query(
                "SELECT * FROM team_jobs WHERE id = $1 AND user_id = $2 FOR UPDATE",
                [proposal.team_job_id, userId]
            );
            if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND_OR_ACCESS_DENIED');
            const job = jobRes.rows[0];

            if (job.status !== 'BROADCASTING') throw new Error('JOB_ALREADY_ASSIGNED_OR_CLOSED');

            // Update accepted proposal
            await client.query("UPDATE team_proposals SET status = 'ACCEPTED' WHERE id = $1", [proposalId]);

            // Reject all other proposals for this job
            await client.query(
                "UPDATE team_proposals SET status = 'REJECTED' WHERE team_job_id = $1 AND id != $2",
                [job.id, proposalId]
            );

            // Update Job status and assign leader
            await client.query(
                `UPDATE team_jobs 
                 SET status = 'PROPOSAL_ACCEPTED', leader_id = $1, overall_budget = $2, workers_required = $3, duration_days = $4, calculated_total = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $5`,
                [proposal.leader_id, proposal.budget, proposal.workers_count, proposal.duration_days, job.id]
            );

            // Automatically add Leader as a member in team_members
            await client.query(
                `INSERT INTO team_members (team_job_id, worker_id, role) 
                 VALUES ($1, $2, 'LEADER')
                 ON CONFLICT (team_job_id, worker_id) DO UPDATE SET role = 'LEADER'`,
                [job.id, proposal.leader_id]
            );

            await client.query('COMMIT');

            // Notify Leader
            try {
                const { getIO } = require('../config/socket');
                const io = getIO();
                if (io) {
                    io.to(`worker:${proposal.leader_id}`).emit('team_proposal_accepted', {
                        teamJobId: job.id,
                        proposalId
                    });
                }
            } catch (e) {
                console.warn('[TEAM_JOB_SERVICE] Socket notification to leader failed:', e.message);
            }

            return { success: true, message: "PROPOSAL_ACCEPTED" };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Leader invites a worker to join the crew.
     */
    async inviteWorker(teamJobId, leaderId, workerId, expectedEarnings) {
        const jobRes = await db.query(
            "SELECT leader_id, status FROM team_jobs WHERE id = $1",
            [teamJobId]
        );
        if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
        const job = jobRes.rows[0];

        if (job.leader_id !== leaderId) throw new Error('NOT_AUTHORIZED_LEADER');
        if (job.status !== 'PROPOSAL_ACCEPTED') throw new Error('JOB_NOT_IN_RECRUITMENT_PHASE');

        const query = `
            INSERT INTO team_invitations (team_job_id, leader_id, worker_id, expected_earnings, status)
            VALUES ($1, $2, $3, $4, 'PENDING')
            RETURNING *;
        `;

        const res = await db.query(query, [teamJobId, leaderId, workerId, expectedEarnings]);
        const invitation = res.rows[0];

        // Notify worker
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`worker:${workerId}`).emit('new_team_invitation', {
                    invitationId: invitation.id,
                    teamJobId,
                    leaderId,
                    expectedEarnings
                });
            }
        } catch (e) {
            console.warn('[TEAM_JOB_SERVICE] Socket notification to worker failed:', e.message);
        }

        return invitation;
    }

    /**
     * Worker accepts or declines a team invitation.
     */
    async respondToInvitation(invitationId, workerId, accept) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const inviteRes = await client.query(
                "SELECT * FROM team_invitations WHERE id = $1 AND worker_id = $2 AND status = 'PENDING' FOR UPDATE",
                [invitationId, workerId]
            );
            if (inviteRes.rowCount === 0) throw new Error('INVITATION_NOT_FOUND_OR_PROCESSED');
            const invitation = inviteRes.rows[0];

            const status = accept ? 'ACCEPTED' : 'DECLINED';
            await client.query(
                "UPDATE team_invitations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [status, invitationId]
            );

            if (accept) {
                // Insert into team members
                await client.query(
                    `INSERT INTO team_members (team_job_id, worker_id, role) 
                     VALUES ($1, $2, 'MEMBER')
                     ON CONFLICT (team_job_id, worker_id) DO NOTHING`,
                    [invitation.team_job_id, workerId]
                );
            }

            await client.query('COMMIT');

            // Notify leader
            try {
                const { getIO } = require('../config/socket');
                const io = getIO();
                if (io) {
                    io.to(`worker:${invitation.leader_id}`).emit('team_invitation_response', {
                        invitationId,
                        workerId,
                        status
                    });
                }
            } catch (e) {
                console.warn('[TEAM_JOB_SERVICE] Socket notification to leader failed:', e.message);
            }

            return { success: true, status };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Replace an absent/leaving worker with a new worker.
     */
    async replaceWorker(teamJobId, leaderId, oldWorkerId, newWorkerId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const jobRes = await client.query("SELECT leader_id FROM team_jobs WHERE id = $1 FOR UPDATE", [teamJobId]);
            if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
            if (jobRes.rows[0].leader_id !== leaderId) throw new Error('NOT_AUTHORIZED');

            // Remove old worker
            await client.query(
                "DELETE FROM team_members WHERE team_job_id = $1 AND worker_id = $2",
                [teamJobId, oldWorkerId]
            );

            // Add new worker directly
            await client.query(
                `INSERT INTO team_members (team_job_id, worker_id, role) 
                 VALUES ($1, $2, 'MEMBER')
                 ON CONFLICT (team_job_id, worker_id) DO NOTHING`,
                [teamJobId, newWorkerId]
            );

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Raise an additional work request (Extra materials, budget, time).
     */
    async raiseAdditionalWorkRequest(data) {
        const { teamJobId, leaderId, extraBudget, extraTimeDays, extraMaterials, reason } = data;

        const jobRes = await db.query("SELECT leader_id FROM team_jobs WHERE id = $1", [teamJobId]);
        if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
        if (jobRes.rows[0].leader_id !== leaderId) throw new Error('NOT_AUTHORIZED');

        const query = `
            INSERT INTO additional_work_requests (
                team_job_id, requested_by, extra_budget, extra_time_days, extra_materials, reason, status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
            RETURNING *;
        `;

        const res = await db.query(query, [teamJobId, leaderId, extraBudget || 0, extraTimeDays || 0, extraMaterials || '', reason]);
        const request = res.rows[0];

        // Notify user
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            const job = await db.query("SELECT user_id FROM team_jobs WHERE id = $1", [teamJobId]);
            if (io && job.rowCount > 0) {
                io.to(`user:${job.rows[0].user_id}`).emit('new_additional_work_request', {
                    teamJobId,
                    requestId: request.id,
                    extraBudget
                });
            }
        } catch (e) {
            console.warn('[TEAM_JOB_SERVICE] Socket notification to user failed:', e.message);
        }

        return request;
    }

    /**
     * Respond to additional work request.
     */
    async respondToAdditionalWork(requestId, userId, accept) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const reqRes = await client.query(
                "SELECT * FROM additional_work_requests WHERE id = $1 AND status = 'PENDING' FOR UPDATE",
                [requestId]
            );
            if (reqRes.rowCount === 0) throw new Error('REQUEST_NOT_FOUND_OR_PROCESSED');
            const request = reqRes.rows[0];

            const jobRes = await client.query(
                "SELECT * FROM team_jobs WHERE id = $1 AND user_id = $2 FOR UPDATE",
                [request.team_job_id, userId]
            );
            if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND_OR_ACCESS_DENIED');
            const job = jobRes.rows[0];

            const status = accept ? 'APPROVED' : 'REJECTED';
            await client.query(
                "UPDATE additional_work_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [status, requestId]
            );

            if (accept) {
                const newBudget = parseFloat(job.overall_budget || 0) + parseFloat(request.extra_budget);
                const newDuration = parseInt(job.duration_days) + parseInt(request.extra_time_days);

                await client.query(
                    `UPDATE team_jobs 
                     SET overall_budget = $1, duration_days = $2, calculated_total = $1, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = $3`,
                    [newBudget, newDuration, job.id]
                );
            }

            await client.query('COMMIT');

            // Notify leader
            try {
                const { getIO } = require('../config/socket');
                const io = getIO();
                if (io) {
                    io.to(`worker:${job.leader_id}`).emit('additional_work_response', {
                        requestId,
                        status
                    });
                }
            } catch (e) {
                console.warn('[TEAM_JOB_SERVICE] Socket notification to leader failed:', e.message);
            }

            return { success: true, status };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Emergency handling: promote highest rated member to leader.
     */
    async emergencyPromoteMember(teamJobId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const jobRes = await client.query("SELECT leader_id FROM team_jobs WHERE id = $1 FOR UPDATE", [teamJobId]);
            if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
            const currentLeaderId = jobRes.rows[0].leader_id;

            // Find highest rated member excluding current leader
            const membersRes = await client.query(
                `SELECT tm.worker_id, w.rating 
                 FROM team_members tm
                 JOIN workers w ON tm.worker_id = w.id
                 WHERE tm.team_job_id = $1 AND tm.worker_id != $2
                 ORDER BY w.rating DESC, tm.joined_at ASC 
                 LIMIT 1`,
                [teamJobId, currentLeaderId]
            );

            if (membersRes.rowCount === 0) {
                throw new Error('NO_ELIGIBLE_MEMBERS_FOR_PROMOTION');
            }

            const newLeaderId = membersRes.rows[0].worker_id;

            // Update roles
            await client.query(
                "UPDATE team_members SET role = 'MEMBER' WHERE team_job_id = $1 AND worker_id = $2",
                [teamJobId, currentLeaderId]
            );
            await client.query(
                "UPDATE team_members SET role = 'LEADER' WHERE team_job_id = $1 AND worker_id = $2",
                [teamJobId, newLeaderId]
            );
            await client.query(
                "UPDATE team_jobs SET leader_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [newLeaderId, teamJobId]
            );

            await client.query('COMMIT');

            // Notify everyone
            try {
                const { getIO } = require('../config/socket');
                const io = getIO();
                if (io) {
                    io.to(`job:${teamJobId}`).emit('team_leader_promoted', {
                        teamJobId,
                        newLeaderId
                    });
                }
            } catch (e) {
                console.warn('[TEAM_JOB_SERVICE] Socket notification failed:', e.message);
            }

            return { success: true, newLeaderId };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Create verified team.
     */
    async createVerifiedTeam(leaderId, teamName) {
        const query = `
            INSERT INTO verified_teams (leader_id, team_name, is_verified)
            VALUES ($1, $2, true)
            RETURNING *;
        `;
        const res = await db.query(query, [leaderId, teamName]);
        return res.rows[0];
    }
}

module.exports = new TeamJobService();
