'use strict';

class PromptGeneratorService {
    static STANDARD_NEGATIVE_PROMPT = `No text, No logo, No watermark, No background scene, No room, No building, No landscape, No extra people, No duplicate tools, No cropped body, No blur, No low quality, No dark lighting, No photo, No 3D render, No anime, No cartoon, No sketch, No oil painting, No clipart, No exaggerated proportions, No deformed hands, No floating objects, No unrealistic colors`;

    /**
     * Constructs standardized 15-point Master Prompt for any marketplace category asset
     */
    static generateMasterPrompt(jobTitle, jobTool) {
        if (!jobTitle || !jobTool) {
            throw new Error('JOB_TITLE and JOB_TOOL are required to generate master prompt.');
        }

        const title = jobTitle.trim();
        const tool = jobTool.trim();

        return `Create a premium marketplace category illustration of a professional ${title}.

The illustration must follow exactly the same visual language as every other Nexo category image.

Subject:
One professional Indian ${title}.

Appearance:
Friendly, trustworthy, smiling, clean grooming, modern appearance.

Outfit:
Premium orange and white work uniform matching Nexo branding.
Professional safety equipment where applicable.

Accessories:
Holding ${tool}.

Pose:
Standing confidently.
Relaxed posture.
Front 3/4 camera angle.

Composition:
Centered.
Square composition.
Large breathing space.
Single subject only.

Background:
Pure white or transparent.
No environment.
No scenery.
No buildings.
No room interiors.

Lighting:
Soft studio lighting.
Subtle ambient shadows.
Premium commercial lighting.

Rendering Style:
Modern premium flat 2D illustration.
Semi-vector.
Smooth gradients.
Rounded edges.
Minimal but realistic.
Highly polished.
Clean outlines.
Premium mobile marketplace artwork.

Color Palette:
Orange
White
Light Gray
Warm Neutral
Soft Blue accents only when required.

Quality:
Extremely clean.
High detail.
Crisp edges.
No artifacts.
No noise.

Consistency:
Maintain identical proportions,
identical illustration technique,
identical lighting,
identical perspective,
identical color palette,
identical facial style,
identical rendering quality,
identical design language,
matching every other generated Nexo service illustration.

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
        if (!masterPrompt || masterPrompt.length < 400) {
            errors.push('Master prompt must exceed 400 characters for visual style lock.');
        }

        const requiredSections = ['Subject', 'Outfit', 'Accessories', 'Rendering Style', 'Consistency', 'Output'];
        for (const section of requiredSections) {
            if (!masterPrompt || !masterPrompt.includes(`${section}:`)) {
                errors.push(`Master prompt missing required section: ${section}`);
            }
        }

        if (!negativePrompt || !negativePrompt.includes('No text')) {
            errors.push('Negative prompt missing standard quality constraints.');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = PromptGeneratorService;
