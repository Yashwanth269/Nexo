const rateLimit = require('express-rate-limit');

const otpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { success: false, error: "Too many OTP requests. Try again in 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, error: "Too many login attempts. Try again in 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

const jobCreateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 1000 : 5,
    message: { success: false, error: "Too many job creation requests. Try again in 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, error: "Too many chat messages. Try again in 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

const walletLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, error: "Too many wallet operations. Try again in 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

const payoutLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { success: false, error: "Too many payout requests. Try again in 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    otpLimiter,
    loginLimiter,
    jobCreateLimiter,
    chatLimiter,
    walletLimiter,
    payoutLimiter,
};
