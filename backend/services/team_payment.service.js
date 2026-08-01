'use strict';

const db = require('../config/db');
const walletService = require('./wallet.service');

class TeamPaymentService {
    /**
     * Release escrow payment and distribute to leader and team members.
     */
    async distributePayment(teamJobId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const jobRes = await client.query(
                "SELECT * FROM team_jobs WHERE id = $1 FOR UPDATE",
                [teamJobId]
            );
            if (jobRes.rowCount === 0) throw new Error('TEAM_JOB_NOT_FOUND');
            const job = jobRes.rows[0];

            if (job.status === 'COMPLETED') throw new Error('PAYMENT_ALREADY_DISTRIBUTED');

            // 1. Fetch all team members
            const membersRes = await client.query(
                "SELECT worker_id, role FROM team_members WHERE team_job_id = $1",
                [teamJobId]
            );
            if (membersRes.rowCount === 0) throw new Error('NO_TEAM_MEMBERS_FOUND');
            const members = membersRes.rows;

            // 2. Fetch distinct checked-in workers
            const attendanceRes = await client.query(
                `SELECT DISTINCT worker_id 
                 FROM team_attendance 
                 WHERE team_job_id = $1 AND status IN ('PRESENT', 'LATE', 'HALF_DAY')`,
                [teamJobId]
            );
            const checkedInWorkerIds = attendanceRes.rows.map(r => r.worker_id);

            const distributions = [];

            if (job.pricing_type === 'OVERALL_BUDGET') {
                const totalBudget = parseFloat(job.calculated_total || 0);

                // Leader flat 20%
                const leaderId = job.leader_id;
                if (!leaderId) throw new Error('LEADER_NOT_ASSIGNED');

                const leaderShare = totalBudget * 0.20;
                const crewShare = totalBudget * 0.80;

                distributions.push({
                    workerId: leaderId,
                    amount: leaderShare,
                    role: 'LEADER'
                });

                // Get other crew members who checked in. Fallback to all members if none checked in.
                let crewWorkers = checkedInWorkerIds.filter(id => id !== leaderId);
                if (crewWorkers.length === 0) {
                    crewWorkers = members.filter(m => m.role !== 'LEADER').map(m => m.worker_id);
                }

                if (crewWorkers.length > 0) {
                    const sharePerCrew = crewShare / crewWorkers.length;
                    for (const workerId of crewWorkers) {
                        distributions.push({
                            workerId,
                            amount: sharePerCrew,
                            role: 'MEMBER'
                        });
                    }
                } else {
                    // No other crew members, leader takes all
                    distributions[0].amount = totalBudget;
                }

            } else if (job.pricing_type === 'DAILY_WAGE') {
                const dailyWage = parseFloat(job.daily_wage_per_worker || 0);

                // Fetch detailed attendance
                const attendances = await client.query(
                    "SELECT worker_id, status FROM team_attendance WHERE team_job_id = $1",
                    [teamJobId]
                );

                // Map workers to total calculated wage
                const workerWages = {};
                for (const member of members) {
                    workerWages[member.worker_id] = 0;
                }

                for (const att of attendances.rows) {
                    const workerId = att.worker_id;
                    let wage = 0;
                    if (att.status === 'PRESENT') {
                        wage = dailyWage;
                    } else if (att.status === 'LATE') {
                        wage = dailyWage * 0.90; // 10% late deduction
                    } else if (att.status === 'HALF_DAY') {
                        wage = dailyWage * 0.50; // Half pay
                    }

                    // Apply leader 20% bonus
                    const isLeader = members.find(m => m.worker_id === workerId && m.role === 'LEADER');
                    if (isLeader) {
                        wage = wage * 1.20; // 20% higher earnings
                    }

                    if (workerWages[workerId] !== undefined) {
                        workerWages[workerId] += wage;
                    } else {
                        workerWages[workerId] = wage;
                    }
                }

                for (const [workerId, amount] of Object.entries(workerWages)) {
                    if (amount > 0) {
                        const member = members.find(m => m.worker_id === workerId);
                        distributions.push({
                            workerId,
                            amount,
                            role: member ? member.role : 'MEMBER'
                        });
                    }
                }
            }

            // 3. Apply distributions & credit wallets
            for (const dist of distributions) {
                // Insert ledger record
                await client.query(
                    `INSERT INTO team_wallet_distribution (team_job_id, worker_id, amount, role_at_time, status, payout_date)
                     VALUES ($1, $2, $3, $4, 'RELEASED', CURRENT_TIMESTAMP)`,
                    [teamJobId, dist.workerId, dist.amount, dist.role]
                );

                // Credit Wallet
                await walletService.addFunds(
                    dist.workerId,
                    'WORKER',
                    dist.amount,
                    'TEAM_JOB_PAYOUT',
                    teamJobId,
                    `Payout for Team Job contract ${teamJobId} as ${dist.role}`,
                    client
                );
            }

            // 4. Update team job status to COMPLETED
            await client.query(
                "UPDATE team_jobs SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                [teamJobId]
            );

            await client.query('COMMIT');

            // Notify everyone
            try {
                const { getIO } = require('../config/socket');
                const io = getIO();
                if (io) {
                    io.to(`job:${teamJobId}`).emit('team_payment_released', {
                        teamJobId,
                        distributions
                    });
                }
            } catch (e) {
                console.warn('[TEAM_PAYMENT] Socket notification failed:', e.message);
            }

            return { success: true, distributions };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get distribution log for a job.
     */
    async getWalletDistribution(teamJobId) {
        const res = await db.query(
            "SELECT * FROM team_wallet_distribution WHERE team_job_id = $1",
            [teamJobId]
        );
        return res.rows;
    }
}

module.exports = new TeamPaymentService();
