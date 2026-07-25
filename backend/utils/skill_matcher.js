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

const stemMap = {
    // Electrical stems
    'electrician': 'electric',
    'electrical': 'electric',
    'electricians': 'electric',
    'wiring': 'electric',
    'switch repair': 'electric',
    'fan installation': 'electric',
    'light fitting': 'electric',
    'inverter setup': 'electric',
    'meter repair': 'electric',
    'switch board': 'electric',
    'switch board repair': 'electric',
    'ceiling fan repair': 'electric',
    'house wiring': 'electric',
    'mcb installation': 'electric',
    'industrial electrical': 'electric',

    // Plumbing stems
    'plumber': 'plumb',
    'plumbing': 'plumb',
    'plumbers': 'plumb',
    'pipe leakage': 'plumb',
    'tap repair': 'plumb',
    'tank cleaning': 'plumb',
    'bathroom fittings': 'plumb',

    // AC & Appliance stems
    'ac repair': 'ac',
    'ac technician': 'ac',
    'ac service': 'ac',
    'ac installation': 'ac',
    'refrigerator repair': 'appliance',
    'washing machine repair': 'appliance',
    'microwave repair': 'appliance',
    'tv repair': 'appliance',
    'appliance repair': 'appliance',
    'appliance technician': 'appliance',

    // Mechanic stems
    'mechanic': 'mechanic',
    'mechanical': 'mechanic',
    'motor repair': 'mechanic',
    'bike repair': 'mechanic',
    'car repair': 'mechanic',

    // Cleaning stems
    'cleaning': 'clean',
    'house cleaner': 'clean',
    'cleaner': 'clean',
    'full house cleaning': 'clean',
    'kitchen cleaning': 'clean',
    'bathroom cleaning': 'clean',
    'sofa cleaning': 'clean',
    'water tank cleaning': 'clean',

    // Carpentry stems
    'carpenter': 'carpenter',
    'carpentry': 'carpenter',

    // Agriculture stems
    'agriculture': 'agri',
    'agriculture work': 'agri',
    'field worker': 'agri',
    'tractor driver': 'agri',
    'tractor for ploughing': 'agri',
    'tractor for tilling': 'agri',
    'land preparation': 'agri',
    'crop cutting': 'agri',
    'sowing,planting': 'agri',
    'harvesting manual': 'agri',
    'weeding': 'agri',
    'pesticide spraying': 'agri',
    'solar installation': 'solar',
};

function getStem(phrase = '') {
    const p = phrase.toLowerCase().trim();
    if (stemMap[p]) return stemMap[p];

    if (p.includes('electric') || p.includes('wiring') || p.includes('switch') || p.includes('fan') || p.includes('light') || p.includes('meter')) {
        return 'electric';
    }
    if (p.includes('plumb') || p.includes('pipe') || p.includes('tap') || p.includes('leak') || p.includes('fittings')) {
        return 'plumb';
    }
    if (p.includes('ac') || p.includes('air condition') || p.includes('fridge') || p.includes('refrigerator') || p.includes('washing')) {
        return 'ac';
    }
    if (p.includes('mechanic') || p.includes('motor') || p.includes('vehicle') || p.includes('bike') || p.includes('car')) {
        return 'mechanic';
    }
    if (p.includes('cleaning') || p.includes('cleaner') || p.includes('wash') || p.includes('mop')) {
        return 'clean';
    }
    if (p.includes('carpenter') || p.includes('carpentry') || p.includes('wood')) {
        return 'carpenter';
    }
    if (p.includes('agri') || p.includes('farm') || p.includes('tractor') || p.includes('crop') || p.includes('harvest')) {
        return 'agri';
    }
    if (p.includes('pest')) return 'pest';
    if (p.includes('paint')) return 'paint';
    if (p.includes('salon')) return 'salon';

    return p;
}

function isSkillMatch(workerSkills = [], workerTasks = [], jobCategory = '') {
    if (!jobCategory) return true;

    const skillsArray = Array.isArray(workerSkills) ? workerSkills : [];
    const tasksArray = Array.isArray(workerTasks) ? workerTasks : [];

    const jobStem = getStem(jobCategory);

    for (const skill of skillsArray) {
        if (getStem(skill) === jobStem) return true;
    }
    for (const task of tasksArray) {
        if (getStem(task) === jobStem) return true;
    }

    return false;
}

module.exports = { isSkillMatch, categoryToSkillsMap };
