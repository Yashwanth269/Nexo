/**
 * Dynamic Skill Matcher for Nexo All-in-One Marketplace
 * Supports 22+ verticals and hundreds of subcategories dynamically without hardcoded enum lists.
 */

function tokenize(text = '') {
    if (!text || typeof text !== 'string') return new Set();
    return new Set(
        text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 2 && !['and', 'for', 'the', 'with', 'service', 'services', 'repair', 'work'].includes(t))
    );
}

function isSkillMatch(workerSkills = [], workerTasks = [], jobCategory = '') {
    if (!jobCategory || typeof jobCategory !== 'string' || !jobCategory.trim()) {
        return true;
    }

    const skillsArray = Array.isArray(workerSkills) ? workerSkills : [];
    const tasksArray = Array.isArray(workerTasks) ? workerTasks : [];

    const jobCategoryLower = jobCategory.toLowerCase().trim();
    const jobTokens = tokenize(jobCategory);

    // 1. Direct or Substring match
    for (const skill of skillsArray) {
        if (!skill || typeof skill !== 'string') continue;
        const sLower = skill.toLowerCase().trim();
        if (sLower === jobCategoryLower || sLower.includes(jobCategoryLower) || jobCategoryLower.includes(sLower)) {
            return true;
        }
    }

    for (const task of tasksArray) {
        if (!task || typeof task !== 'string') continue;
        const tLower = task.toLowerCase().trim();
        if (tLower === jobCategoryLower || tLower.includes(jobCategoryLower) || jobCategoryLower.includes(tLower)) {
            return true;
        }
    }

    // 2. Token overlap matching
    const workerAllStrings = [...skillsArray, ...tasksArray].join(' ');
    const workerTokens = tokenize(workerAllStrings);

    for (const token of jobTokens) {
        if (workerTokens.has(token)) {
            return true;
        }
    }

    return false;
}

module.exports = { isSkillMatch, tokenize };
