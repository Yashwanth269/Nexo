/**
 * Production SMS Provider Service — Supports MSG91 & Twilio with Dev Console Fallback
 */

const https = require('https');
const http = require('http');

class SmsProviderService {
    constructor() {
        this.provider = (process.env.SMS_PROVIDER || 'console').toLowerCase();
        this.msg91AuthKey = process.env.MSG91_AUTH_KEY;
        this.msg91TemplateId = process.env.MSG91_TEMPLATE_ID;
        this.twilioSid = process.env.TWILIO_ACCOUNT_SID;
        this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
        this.twilioFromNumber = process.env.TWILIO_FROM_NUMBER;
    }

    /**
     * Send SMS OTP with retries and failover.
     */
    async sendOTP(phoneNumber, otp) {
        const isProduction = process.env.NODE_ENV === 'production';
        const message = `Your Nexo verification code is ${otp}. Valid for 5 minutes. Do not share with anyone.`;

        if (!isProduction || this.provider === 'console') {
            console.log(`📱 [SMS-DEV-CONSOLE] To: ${phoneNumber} | Content: "${message}"`);
            return { success: true, provider: 'console', delivered: true };
        }

        let attempts = 0;
        let lastError = null;

        while (attempts < 3) {
            attempts++;
            try {
                if (this.provider === 'msg91' && this.msg91AuthKey) {
                    await this._sendMSG91(phoneNumber, otp);
                    console.log(`✅ [SMS-MSG91-SUCCESS] Sent OTP to ${phoneNumber.slice(0, 4)}****`);
                    return { success: true, provider: 'msg91' };
                } else if (this.provider === 'twilio' && this.twilioSid) {
                    await this._sendTwilio(phoneNumber, message);
                    console.log(`✅ [SMS-TWILIO-SUCCESS] Sent OTP to ${phoneNumber.slice(0, 4)}****`);
                    return { success: true, provider: 'twilio' };
                } else {
                    console.warn(`⚠️ [SMS-FALLBACK] Provider "${this.provider}" credentials missing. Defaulting to console log.`);
                    console.log(`📱 [SMS-CONSOLE] To: ${phoneNumber} | Content: "${message}"`);
                    return { success: true, provider: 'console' };
                }
            } catch (err) {
                lastError = err;
                console.error(`❌ [SMS-RETRY-${attempts}] Failed to send SMS via ${this.provider}:`, err.message);
                await new Promise(r => setTimeout(r, attempts * 500)); // Exponential backoff
            }
        }

        console.error(`🚨 [SMS-FAILURE] All 3 send attempts failed for ${phoneNumber}:`, lastError?.message);
        return { success: false, error: 'SMS_DELIVERY_FAILED', message: lastError?.message };
    }

    _sendMSG91(phoneNumber, otp) {
        return new Promise((resolve, reject) => {
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const postData = JSON.stringify({
                template_id: this.msg91TemplateId,
                mobile: cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone,
                otp: otp
            });

            const req = https.request({
                hostname: 'control.msg91.com',
                path: '/api/v5/otp',
                method: 'POST',
                headers: {
                    'authkey': this.msg91AuthKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) resolve(JSON.parse(data || '{}'));
                    else reject(new Error(`MSG91 Error Status ${res.statusCode}: ${data}`));
                });
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('MSG91 request timeout')); });
            req.write(postData);
            req.end();
        });
    }

    _sendTwilio(phoneNumber, message) {
        return new Promise((resolve, reject) => {
            const auth = Buffer.from(`${this.twilioSid}:${this.twilioAuthToken}`).toString('base64');
            const postData = new URLSearchParams({
                To: phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`,
                From: this.twilioFromNumber,
                Body: message
            }).toString();

            const req = https.request({
                hostname: 'api.twilio.com',
                path: `/2010-04-01/Accounts/${this.twilioSid}/Messages.json`,
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data || '{}'));
                    else reject(new Error(`Twilio Error Status ${res.statusCode}: ${data}`));
                });
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Twilio request timeout')); });
            req.write(postData);
            req.end();
        });
    }
}

module.exports = new SmsProviderService();
