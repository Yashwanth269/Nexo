'use strict';

class PromptGeneratorService {
    static STANDARD_NEGATIVE_PROMPT = `No illustration, no 2D art, no vector graphics, no CGI, no cartoon, no anime, no clipart, no stock-photo watermark, no text, no logo, no extra people, no clutter, no blurry subject, no distorted hands, no unrealistic lighting, no dirty environment`;

    /**
     * Formats category names into natural human profession titles
     */
    static formatProfessionName(jobTitle) {
        const title = jobTitle.trim();
        const lower = title.toLowerCase();

        if (lower.endsWith('er') || lower.endsWith('or') || lower.endsWith('ian') || lower.endsWith('man') || lower.endsWith('specialist') || lower.endsWith('technician') || lower.endsWith('worker') || lower.endsWith('cleaner') || lower.endsWith('painter') || lower.endsWith('driver') || lower.endsWith('welder')) {
            return title;
        }

        if (lower.endsWith('repair') || lower.endsWith('service') || lower.endsWith('maintenance') || lower.endsWith('installation') || lower.endsWith('fitting') || lower.endsWith('work') || lower.endsWith('relocation') || lower.endsWith('shifting')) {
            return `${title} Technician`;
        }

        return `${title} Specialist`;
    }

    /**
     * Customizes outfit based on profession vertical
     */
    static getOutfitForCategory(jobTitle, categoryName = '') {
        const text = `${jobTitle} ${categoryName}`.toLowerCase();

        if (text.includes('beauty') || text.includes('barber') || text.includes('salon') || text.includes('spa') || text.includes('makeup')) {
            return `Elegant beige and warm neutral salon uniform with subtle orange accents, clean apron, professional hairstyle, and natural grooming.`;
        }

        if (text.includes('clean') || text.includes('sofa') || text.includes('mattress') || text.includes('pest')) {
            return `Modern housekeeping uniform in orange and white with protective gloves, clean apron, and comfortable professional work shoes.`;
        }

        if (text.includes('car') || text.includes('bike') || text.includes('auto') || text.includes('mechanic') || text.includes('tyre') || text.includes('puncture')) {
            return `Professional mechanic service outfit in dark grey with orange and white Nexo branding accents, protective work gloves, utility belt, and safety boots.`;
        }

        if (text.includes('app') || text.includes('laptop') || text.includes('computer') || text.includes('developer') || text.includes('mobile repair') || text.includes('cctv')) {
            return `Modern smart-casual tech outfit with an orange hoodie or polo shirt over a clean white t-shirt, dark trousers, and smartwatch.`;
        }

        if (text.includes('garden') || text.includes('lawn') || text.includes('tree') || text.includes('plant') || text.includes('outdoor')) {
            return `Durable outdoor landscaping work uniform with orange accents, sun hat, protective gloves, and sturdy work boots.`;
        }

        if (text.includes('shift') || text.includes('mover') || text.includes('packer') || text.includes('courier') || text.includes('logistics') || text.includes('transport')) {
            return `Heavy-duty logistics work polo in orange and white, cargo trousers, protective gloves, and durable work boots.`;
        }

        // Default Home Services / Appliance / Trade Uniform
        return `Modern orange and white safety work uniform with subtle reflective strips, protective work gloves, utility belt, and dark work trousers.`;
    }

    /**
     * Customizes background based on profession vertical
     */
    static getBackgroundForCategory(jobTitle, categoryName = '') {
        const text = `${jobTitle} ${categoryName}`.toLowerCase();

        if (text.includes('beauty') || text.includes('barber') || text.includes('salon') || text.includes('spa')) {
            return `Minimal luxury beauty salon or wellness space with softly blurred vanity mirror, indoor plants, elegant lighting, and stylish workstation`;
        }

        if (text.includes('clean') || text.includes('sofa') || text.includes('pest') || text.includes('deep cleaning')) {
            return `Bright modern living room with sparkling clean wooden flooring, contemporary furniture, indoor plants, and natural morning sunlight through large windows`;
        }

        if (text.includes('car') || text.includes('bike') || text.includes('mechanic') || text.includes('wash')) {
            return `Clean modern automotive service bay or garage with organized professional tool chest, diagnostic equipment, and ambient studio lighting`;
        }

        if (text.includes('laptop') || text.includes('computer') || text.includes('developer') || text.includes('mobile repair') || text.includes('cctv')) {
            return `Modern technology workspace or repair station with minimalist desk, diagnostic instruments, laptop, and ambient soft lighting`;
        }

        if (text.includes('garden') || text.includes('outdoor') || text.includes('lawn')) {
            return `Lush green modern residential garden with neatly trimmed lawn, vibrant plants, and soft natural outdoor daylight`;
        }

        if (text.includes('shift') || text.includes('mover') || text.includes('logistics')) {
            return `Contemporary home entrance with neatly organized moving boxes and modern architecture softly blurred in the background`;
        }

        // Default Modern Home Interior / Service Space
        return `Clean contemporary Indian home interior with a neatly organized service environment, subtle warm lighting, and modern decor`;
    }

    /**
     * Constructs standardized Ultra-Realistic Commercial Photography Master Prompt
     */
    static generateMasterPrompt(jobTitle, jobTool, categoryName = '') {
        if (!jobTitle || !jobTool) {
            throw new Error('JOB_TITLE and JOB_TOOL are required to generate master prompt.');
        }

        const rawTitle = jobTitle.trim();
        const profession = this.formatProfessionName(rawTitle);
        const tool = jobTool.trim();
        const outfitDetails = this.getOutfitForCategory(rawTitle, categoryName);
        const backgroundDetails = this.getBackgroundForCategory(rawTitle, categoryName);

        return `Create an ultra-realistic premium commercial photograph of a professional Indian ${profession}.

A confident, friendly, and approachable professional Indian ${profession} with a genuine natural smile and clean grooming.

Outfit:
${outfitDetails}

Action & Accessories:
Standing confidently while holding ${tool} in a natural, authentic work pose.

Background & Environment:
${backgroundDetails}. The environment should be realistic, clean, and modern, but softly blurred with a shallow depth of field so the professional remains the clear focal point.

Camera & Framing:
Professional DSLR photography, 50mm portrait lens, eye-level angle, sharp focus on subject, shallow depth of field, generous breathing space, 1024x1024 square composition.

Lighting:
Soft natural daylight combined with warm indoor ambient lighting. High dynamic range, natural skin tones, authentic textures, and subtle highlights.

Style & Direction:
Luxury commercial advertising photography. Ultra-realistic, high-end lifestyle quality. Authentic expressions, premium marketplace brand campaign artwork.

Output:
1024x1024 square.`;
    }

    /**
     * Validates prompt completeness before saving
     */
    static validatePrompt({ jobTitle, jobTool, masterPrompt, negativePrompt }) {
        const errors = [];

        if (!jobTitle || !jobTitle.trim()) errors.push('Job title is required.');
        if (!jobTool || !jobTool.trim()) errors.push('Job tool is required.');
        if (!masterPrompt || masterPrompt.length < 350) {
            errors.push('Master prompt must exceed 350 characters for visual style lock.');
        }

        const requiredSections = ['Outfit', 'Action & Accessories', 'Background & Environment', 'Camera & Framing', 'Lighting', 'Style & Direction', 'Output'];
        for (const section of requiredSections) {
            if (!masterPrompt || !masterPrompt.includes(`${section}:`)) {
                errors.push(`Master prompt missing required section: ${section}`);
            }
        }

        if (!negativePrompt || !negativePrompt.includes('No illustration')) {
            errors.push('Negative prompt missing photo-realistic quality constraints.');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = PromptGeneratorService;

