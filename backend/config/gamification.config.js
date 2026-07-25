/**
 * Nexo Gamification Service Configuration
 */

module.exports = {
    // Configurable achievement policies
    achievements: {
        FAST_RESPONDER: {
            title: 'Fast Responder',
            desc: '100+ offers received with average response under 15 seconds',
            icon: 'lightning',
            rules: { minOffers: 100, maxResponseSec: 15 }
        },
        TOP_RATED: {
            title: 'Top Rated',
            desc: '100+ ratings with a 4.8+ average rating',
            icon: 'star',
            rules: { minRatings: 100, minRating: 4.8 }
        },
        RELIABLE_PROFESSIONAL: {
            title: 'Reliable Professional',
            desc: '100+ completed jobs with cancellation under 2%',
            icon: 'shield',
            rules: { minJobs: 100, maxCancellationRate: 2.0 }
        },
        WEEKEND_HERO: {
            title: 'Weekend Hero',
            desc: 'Completed 50+ weekend jobs (100+ total completed jobs)',
            icon: 'crown',
            rules: { minJobs: 100, minWeekendJobs: 50 }
        },
        RISING_STAR: {
            title: 'Rising Star',
            desc: '25+ completed jobs with a 4.7+ average and 95%+ completion rate',
            icon: 'trophy',
            rules: { minJobs: 25, minRating: 4.7, minCompletionRate: 95.0 }
        }
    },

    // Cache TTL for Leaderboard
    leaderboardCacheTtl: parseInt(process.env.LEADERBOARD_CACHE_TTL || "300", 10) // 5 minutes
};
