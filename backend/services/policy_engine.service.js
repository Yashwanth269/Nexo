const eventBus = require('./event_bus.service');
const db = require('../config/db');
const { getIO } = require('../config/socket');

class PolicyEngineService {
    constructor() {
        this.policies = [
            {
                name: "Critical Safety Suspension Policy",
                event: "SAFETY_INCIDENT",
                condition: (payload) => {
                    const criticalReasons = ['Harassment', 'Physical Threat', 'SOS_EMERGENCY', 'Accident'];
                    return criticalReasons.includes(payload.reason) || payload.status === 'CRITICAL';
                },
                action: async (payload) => {
                    if (!payload.workerId) return;
                    console.log(`🛡️ [POLICY-ENGINE] CRITICAL SAFETY SUSPENSION: Worker ${payload.workerId} account suspended due to safety incident: "${payload.reason}".`);
                    
                    // Suspend worker verification status
                    await db.query(
                        "UPDATE workers SET verification_status = 'SUSPENDED', is_available = FALSE WHERE id = $1",
                        [payload.workerId]
                    );

                    // Notify Support Dashboard
                    const io = getIO();
                    if (io) {
                        io.to('support_room').emit('worker_suspended', {
                            workerId: payload.workerId,
                            reason: payload.reason,
                            incidentId: payload.incidentId,
                            message: `Worker account suspended automatically due to incident: ${payload.reason}`
                        });
                    }
                }
            },
            {
                name: "Route Deviation Reputation Penalty Policy",
                event: "ROUTE_DEVIATION",
                condition: (payload) => payload.deviationScore > 0.4,
                action: async (payload) => {
                    if (!payload.workerId) return;
                    console.log(`🛡️ [POLICY-ENGINE] ROUTE DEVIATION PENALTY: Decreasing reputation of worker ${payload.workerId} due to deviation.`);
                    
                    // Deduct trust and reliability scores
                    await db.query(`
                        UPDATE worker_reputation_scores
                        SET reliability_score = GREATEST(0.0, reliability_score - 0.05),
                            trust_score = GREATEST(0.0, trust_score - 0.05)
                        WHERE worker_id = $1
                    `, [payload.workerId]);

                    // Deduct worker skills confidence score
                    await db.query(`
                        UPDATE worker_skill_confidence
                        SET confidence_score = GREATEST(0.0, confidence_score - 5.0)
                        WHERE worker_id = $1
                    `, [payload.workerId]);
                }
            }
        ];
    }

    /**
     * Initializes all policy subscriptions to event bus.
     */
    init() {
        console.log("⚙️ [POLICY-ENGINE] Initializing platform policy engine rules...");
        for (const policy of this.policies) {
            eventBus.subscribe(policy.event, async (payload) => {
                try {
                    if (policy.condition(payload)) {
                        console.log(`⚙️ [POLICY-ENGINE] Rule matched: "${policy.name}"`);
                        await policy.action(payload);
                    }
                } catch (err) {
                    console.error(`❌ [POLICY-ENGINE-RULE-ERROR] Failed to execute "${policy.name}":`, err.message);
                }
            });
        }
    }
}

module.exports = new PolicyEngineService();
