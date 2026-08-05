/**
 * WebRTC Audio Signaling Service for In-App Masked Audio Calls
 * Handles Socket.IO PeerConnection negotiation between Customer & Assigned Worker
 */

const db = require('../config/db');

class WebRtcSignalingService {
    init(io) {
        this.io = io;
        console.log("📞 [WEBRTC-SIGNALING] WebRTC Audio Call signaling engine initialized.");

        io.on('connection', (socket) => {
            // Initiate WebRTC Call
            socket.on('call:initiate', async (data) => {
                const { jobId, recipientId, offer } = data;
                const callerId = socket.userId || socket.workerId;
                const callId = `CALL_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                console.log(`📞 [WEBRTC-CALL-INIT] From ${callerId} to ${recipientId} for Job ${jobId}`);

                // Audit call in database
                try {
                    await db.query(`
                        CREATE TABLE IF NOT EXISTS call_logs (
                            id VARCHAR(64) PRIMARY KEY,
                            job_id UUID,
                            caller_id UUID,
                            recipient_id UUID,
                            status VARCHAR(20) DEFAULT 'RINGING',
                            duration_seconds INT DEFAULT 0,
                            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                        );
                    `);

                    await db.query(`
                        INSERT INTO call_logs (id, job_id, caller_id, recipient_id, status)
                        VALUES ($1, $2, $3, $4, 'RINGING')
                    `, [callId, jobId, callerId, recipientId]);
                } catch (e) {
                    console.warn('[CALL-LOG-WARN]', e.message);
                }

                // Relay call offer to target socket room
                io.to(`user:${recipientId}`).to(`worker:${recipientId}`).emit('call:incoming', {
                    callId,
                    callerId,
                    jobId,
                    offer,
                    maskedPhone: '+91 80XXXX9812'
                });
            });

            // Answer WebRTC Call
            socket.on('call:answer', async (data) => {
                const { callId, recipientId, answer } = data;
                console.log(`📞 [WEBRTC-CALL-ANSWER] Call ${callId} answered.`);

                try {
                    await db.query("UPDATE call_logs SET status = 'CONNECTED' WHERE id = $1", [callId]);
                } catch (e) {}

                io.to(`user:${recipientId}`).to(`worker:${recipientId}`).emit('call:answered', { callId, answer });
            });

            // Exchange ICE Candidates
            socket.on('call:ice_candidate', (data) => {
                const { recipientId, candidate } = data;
                io.to(`user:${recipientId}`).to(`worker:${recipientId}`).emit('call:ice_candidate', { candidate });
            });

            // End / Reject WebRTC Call
            socket.on('call:end', async (data) => {
                const { callId, recipientId, durationSeconds, reason } = data;
                console.log(`📞 [WEBRTC-CALL-END] Call ${callId} ended. Duration: ${durationSeconds || 0}s`);

                try {
                    await db.query(
                        "UPDATE call_logs SET status = 'ENDED', duration_seconds = $2 WHERE id = $1",
                        [callId, durationSeconds || 0]
                    );
                } catch (e) {}

                io.to(`user:${recipientId}`).to(`worker:${recipientId}`).emit('call:ended', { callId, reason: reason || 'HANGUP' });
            });
        });
    }
}

module.exports = new WebRtcSignalingService();
