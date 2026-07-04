const categoryToSkillsMap = {
    // Electrical tasks
    'switch repair': ['electrician', 'electrical', 'wiring'],
    'fan installation': ['electrician', 'electrical'],
    'light fitting': ['electrician', 'electrical'],
    'wiring': ['electrician', 'electrical', 'wiring'],
    'inverter setup': ['electrician', 'electrical'],
    'meter repair': ['electrician', 'electrical'],

    // Plumbing tasks
    'pipe leakage': ['plumber', 'plumbing'],
    'tap repair': ['plumber', 'plumbing'],
    'tank cleaning': ['plumber', 'plumbing', 'cleaning'],
    'motor repair': ['plumber', 'plumbing', 'electrician'],
    'bathroom fittings': ['plumber', 'plumbing'],

    // Appliance Repair tasks
    'refrigerator repair': ['appliance repair', 'ac technician'],
    'washing machine repair': ['appliance repair'],
    'ac repair': ['appliance repair', 'ac technician'],
    'microwave repair': ['appliance repair'],
    'tv repair': ['appliance repair'],

    // Cleaning tasks
    'full house cleaning': ['cleaning', 'house cleaner'],
    'kitchen cleaning': ['cleaning', 'house cleaner'],
    'bathroom cleaning': ['cleaning', 'house cleaner'],
    'sofa cleaning': ['cleaning', 'house cleaner'],
    'water tank cleaning': ['cleaning', 'house cleaner'],

    // Agriculture tasks
    'tractor for ploughing': ['agriculture work', 'tractor driver'],
    'tractor for tilling': ['agriculture work', 'tractor driver'],
    'land preparation': ['agriculture work', 'field worker'],
    'crop cutting': ['agriculture work', 'field worker'],
    'sowing,planting': ['agriculture work', 'field worker'],
    'harvesting manual': ['agriculture work', 'field worker'],
    'weeding': ['agriculture work', 'field worker'],
    'pesticide spraying': ['agriculture work', 'field worker']
};

function isSkillMatch(workerSkills = [], workerTasks = [], jobCategory = '') {
    if (!jobCategory) return true;
    
    const categoryLower = jobCategory.toLowerCase().trim();
    
    const skillsArray = Array.isArray(workerSkills) ? workerSkills : [];
    const tasksArray = Array.isArray(workerTasks) ? workerTasks : [];

    // Direct matches (case insensitive)
    const skillsLower = skillsArray.map(s => s.toLowerCase().trim());
    const tasksLower = tasksArray.map(t => t.toLowerCase().trim());
    
    if (skillsLower.includes(categoryLower) || tasksLower.includes(categoryLower)) {
        return true;
    }
    
    // Fuzzy matching for tasks e.g. "Switchboard Repair" matches "Switch repair"
    for (const task of tasksLower) {
        if (task.includes(categoryLower) || categoryLower.includes(task)) {
            return true;
        }
        // Sub-string/partial match of words
        const taskWords = task.split(/\s+/);
        const catWords = categoryLower.split(/\s+/);
        if (taskWords.some(tw => tw.length > 3 && catWords.includes(tw)) ||
            catWords.some(cw => cw.length > 3 && taskWords.includes(cw))) {
            return true;
        }
    }
    
    // Map of categories to skills
    const mappedSkills = categoryToSkillsMap[categoryLower] || [];
    for (const mapped of mappedSkills) {
        if (skillsLower.includes(mapped)) {
            return true;
        }
    }
    
    // Fallback: check if jobCategory contains any skill word or vice versa
    for (const skill of skillsLower) {
        if (categoryLower.includes(skill) || skill.includes(categoryLower)) {
            return true;
        }
        
        // E.g. "Electrician" matches electrical tasks
        if (skill === 'electrician' || skill === 'electrical') {
            if (categoryLower.includes('switch') || 
                categoryLower.includes('fan') || 
                categoryLower.includes('light') || 
                categoryLower.includes('wire') || 
                categoryLower.includes('meter')) {
                return true;
            }
        }
        
        if (skill === 'plumber' || skill === 'plumbing') {
            if (categoryLower.includes('pipe') || 
                categoryLower.includes('tap') || 
                categoryLower.includes('leak') || 
                categoryLower.includes('motor') || 
                categoryLower.includes('tank') ||
                categoryLower.includes('fittings')) {
                return true;
            }
        }
        
        if (skill === 'agriculture work' || skill === 'tractor driver') {
            if (categoryLower.includes('tractor') || 
                categoryLower.includes('plough') || 
                categoryLower.includes('till') || 
                categoryLower.includes('land') || 
                categoryLower.includes('crop') ||
                categoryLower.includes('sow') ||
                categoryLower.includes('plant') ||
                categoryLower.includes('harvest') ||
                categoryLower.includes('weed') ||
                categoryLower.includes('spray')) {
                return true;
            }
        }
    }
    
    return false;
}

module.exports = { isSkillMatch, categoryToSkillsMap };
