const redis = require('./redis');

// =============================================================
// OTP SERVICE — Redis-backed, rate-limited, production-safe
// =============================================================

const OTP_TTL_SECONDS = 300;          // 5 minutes
const MAX_OTP_ATTEMPTS = 5;           // max verify attempts before lockout
const OTP_COOLDOWN_SECONDS = 60;      // minimum gap between OTP sends
const MAX_OTP_REQUESTS = 3;           // max OTP sends per phone per 10 minutes
const OTP_REQUEST_WINDOW = 600;       // 10 minute window for rate limiting
const LOCKOUT_DURATION_SECONDS = 900; // 15 minute lockout after too many failures

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Generate a cryptographically random 6-digit OTP.
 */
function generateOTP() {
    const crypto = require('crypto');
    const buffer = crypto.randomBytes(4);
    const num = buffer.readUInt32BE(0) % 900000 + 100000;
    return num.toString();
}

/**
 * Send OTP to a phone number with rate limiting.
 * Returns { success, demoOtp? (dev only), message, retryAfter? }
 */
async function sendOTP(phoneNumber, ip = 'unknown') {
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.length < 10) {
        return { success: false, error: 'INVALID_PHONE', message: 'Valid phone number required' };
    }

    // 1. Check lockout
    const lockoutKey = `otp:lockout:${phoneNumber}`;
    const isLockedOut = await redis.get(lockoutKey);
    if (isLockedOut) {
        return { 
            success: false, 
            error: 'OTP_LOCKED', 
            message: 'Too many failed attempts. Try again in 15 minutes.' 
        };
    }

    // 2. Rate limit: cooldown between sends
    const cooldownKey = `otp:cooldown:${phoneNumber}`;
    const isCooling = await redis.get(cooldownKey);
    if (isCooling) {
        return { 
            success: false, 
            error: 'OTP_COOLDOWN', 
            message: 'Please wait before requesting another OTP.',
            retryAfter: OTP_COOLDOWN_SECONDS
        };
    }

    // 3. Rate limit: max sends per window
    const countKey = `otp:count:${phoneNumber}`;
    const sendCount = parseInt(await redis.get(countKey) || '0');
    if (sendCount >= MAX_OTP_REQUESTS) {
        return { 
            success: false, 
            error: 'OTP_RATE_LIMITED', 
            message: `Maximum ${MAX_OTP_REQUESTS} OTP requests per 10 minutes exceeded.` 
        };
    }

    // 4. IP-based rate limiting
    const ipKey = `otp:ip:${ip}`;
    const ipCount = parseInt(await redis.get(ipKey) || '0');
    if (ipCount >= 10) {
        return {
            success: false,
            error: 'IP_RATE_LIMITED',
            message: 'Too many OTP requests from this IP address.'
        };
    }

    // 5. Generate and store OTP
    const otp = generateOTP();
    const otpKey = `otp:value:${phoneNumber}`;
    const attemptsKey = `otp:attempts:${phoneNumber}`;

    await redis.set(otpKey, otp, 'EX', OTP_TTL_SECONDS);
    await redis.set(attemptsKey, '0', 'EX', OTP_TTL_SECONDS);
    await redis.set(cooldownKey, '1', 'EX', OTP_COOLDOWN_SECONDS);

    // Increment send counters
    await redis.incr(countKey);
    await redis.expire(countKey, OTP_REQUEST_WINDOW);
    await redis.incr(ipKey);
    await redis.expire(ipKey, OTP_REQUEST_WINDOW);

    console.log(`🔑 [OTP] Generated for ${phoneNumber.slice(0, 4)}**** (IP: ${ip})`);

    // TODO: Integrate with SMS provider (Twilio/MSG91/Firebase)
    // await smsProvider.send(phoneNumber, `Your OTP is: ${otp}`);

    const result = { success: true, message: 'OTP sent successfully' };
    
    // Only return OTP in non-production for development testing
    if (!IS_PRODUCTION) {
        result.demoOtp = otp;
        result.deepLink = `gigs://otp?phone=${phoneNumber}&code=${otp}`;
        console.log(`🔑 [OTP-DEV] OTP value: ${otp}`);
        console.log(`📱 [SMS Simulation] Sent message: "Your Gigs verification code is ${otp}. Tap to auto-verify: ${result.deepLink}"`);
    }

    return result;
}

/**
 * Verify an OTP against the stored value.
 * Returns { success, error? }
 */
async function verifyOTP(phoneNumber, otp) {
    if (!phoneNumber || !otp) {
        return { success: false, error: 'MISSING_FIELDS', message: 'Phone number and OTP required' };
    }

    // 1. Check lockout
    const lockoutKey = `otp:lockout:${phoneNumber}`;
    const isLockedOut = await redis.get(lockoutKey);
    if (isLockedOut) {
        return { 
            success: false, 
            error: 'OTP_LOCKED', 
            message: 'Account temporarily locked due to too many failed attempts.' 
        };
    }

    // 2. Get stored OTP
    const otpKey = `otp:value:${phoneNumber}`;
    const storedOtp = await redis.get(otpKey);
    
    if (!storedOtp) {
        return { success: false, error: 'OTP_EXPIRED', message: 'OTP expired or not requested' };
    }

    // 3. Track verification attempts
    const attemptsKey = `otp:attempts:${phoneNumber}`;
    const attempts = parseInt(await redis.get(attemptsKey) || '0');

    if (attempts >= MAX_OTP_ATTEMPTS) {
        // Lock out the phone number
        await redis.set(lockoutKey, '1', 'EX', LOCKOUT_DURATION_SECONDS);
        await redis.del(otpKey);
        await redis.del(attemptsKey);
        
        console.warn(`🚨 [OTP-SECURITY] Phone ${phoneNumber.slice(0, 4)}**** locked out after ${MAX_OTP_ATTEMPTS} failed attempts`);
        return { 
            success: false, 
            error: 'OTP_LOCKED', 
            message: 'Too many failed attempts. Account locked for 15 minutes.' 
        };
    }

    // 4. Verify
    if (storedOtp !== otp) {
        await redis.incr(attemptsKey);
        const remaining = MAX_OTP_ATTEMPTS - attempts - 1;
        return { 
            success: false, 
            error: 'INVALID_OTP', 
            message: `Invalid OTP. ${remaining} attempts remaining.` 
        };
    }

    // 5. Success — cleanup
    await redis.del(otpKey);
    await redis.del(attemptsKey);
    await redis.del(`otp:cooldown:${phoneNumber}`);
    
    console.log(`✅ [OTP] Verified successfully for ${phoneNumber.slice(0, 4)}****`);
    return { success: true };
}

module.exports = { sendOTP, verifyOTP, generateOTP };
