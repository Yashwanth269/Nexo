'use strict';

const db = require('../config/db');
const PromptGeneratorService = require('../services/prompt_generator.service');

// Tool mapping dictionary for professions
const SUB_TOOLS = {
    'Electrician': 'Digital multimeter & insulated wire strippers',
    'Plumber': 'Heavy pipe wrench & copper tube cutter',
    'Home Cleaning': 'Modern pressure washer & micro-fiber mop',
    'Home Deep Cleaning': 'High-pressure steam cleaner & scrub brush',
    'Sofa Cleaning': 'Upholstery extraction machine & spot cleaner',
    'Mattress Cleaning': 'UV-C anti-allergen vacuum & sanitizer',
    'AC Repair': 'Refrigerant manifold gauge set',
    'Refrigerator': 'HVAC leak detector & compressor vacuum pump',
    'Washing Machine': 'Digital clamp meter & drum alignment wrench',
    'TV Repair': 'Precision soldering station & digital oscilloscope',
    'Microwave': 'Microwave leakage detector & high-voltage meter',
    'Geyser': 'Water heater element spanner & pressure relief valve tester',
    'Chimney': 'Duct cleaning brush & grease degreaser kit',
    'Dishwasher': 'Water inlet valve tester & drain pump wrench',
    'Mixer Grinder': 'Motor armature tester & coupler key',
    'Water Cooler': 'Refrigerant gas charging kit & condenser brush',
    'Laptop Repair': 'Anti-static precision screwdriver set & IC heat gun',
    'Computer Repair': 'Diagnostic POST card & thermal paste applicator',
    'Printer Repair': 'Toner cartridge refilling tool & pickup roller cleaner',
    'Mobile Repair': 'Microscope station & ESD precision tweezers',
    'Car Wash': 'High-pressure foam spray gun',
    'Car Mechanic': 'OBD-II diagnostic scanner & hydraulic jack',
    'Bike Mechanic': 'Precision torque wrench & chain breaker tool',
    'Painter': 'Professional paint roller & tray',
    'Carpenter': 'Cordless circular saw & wood chisel',
    'Mason': 'Steel trowel & spirit level',
    'Welder': 'MIG welding torch & protective visor',
    'CCTV Installation': 'HD Security dome camera & power drill',
    'Pest Control': 'Thermal fogging sprayer',
    'RO & Water Purifier': 'Water filter cartridge & TDS testing meter',
    'Inverter Services': 'Battery hydrometer & heavy-duty jumper clamp',
    'Solar Panel Installation': 'Solar irradiance meter & mounting bracket wrench',
    'Barber': 'Professional hair clipper & styling comb'
};

async function seedCategoryPrompts() {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Create tables if not exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS category_prompts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                category_id UUID REFERENCES marketplace_categories(id) ON DELETE CASCADE,
                subcategory_id UUID REFERENCES marketplace_subcategories(id) ON DELETE CASCADE,
                job_title VARCHAR(150) NOT NULL,
                job_tool VARCHAR(150) NOT NULL,
                master_prompt TEXT NOT NULL,
                negative_prompt TEXT NOT NULL,
                style_version INT DEFAULT 1,
                provider VARCHAR(50) DEFAULT 'GEMINI',
                is_approved BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_subcat_prompt UNIQUE (subcategory_id)
            );

            CREATE TABLE IF NOT EXISTS category_images (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                category_id UUID REFERENCES marketplace_categories(id) ON DELETE CASCADE,
                subcategory_id UUID REFERENCES marketplace_subcategories(id) ON DELETE CASCADE,
                version INT DEFAULT 1,
                provider VARCHAR(50) DEFAULT 'GEMINI',
                prompt_id UUID REFERENCES category_prompts(id) ON DELETE SET NULL,
                prompt_used TEXT,
                image_url TEXT NOT NULL,
                thumbnail_url TEXT,
                status VARCHAR(30) DEFAULT 'GENERATING',
                approved BOOLEAN DEFAULT false,
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Fetch all active subcategories with their parent category
        const subcatRes = await client.query(`
            SELECT s.id as subcat_id, s.name as subcat_name, s.slug as subcat_slug, c.id as cat_id, c.name as cat_name
            FROM marketplace_subcategories s
            JOIN marketplace_categories c ON s.category_id = c.id
            WHERE s.is_active = true;
        `);

        const subcategories = subcatRes.rows;
        console.log(`🌱 [SEED_PROMPTS] Pre-generating master prompts for ${subcategories.length} subcategories...`);

        let count = 0;
        for (const sub of subcategories) {
            const jobTitle = sub.subcat_name;
            const jobTool = SUB_TOOLS[jobTitle] || `${jobTitle} professional equipment & toolkit`;

            const masterPrompt = PromptGeneratorService.generateMasterPrompt(jobTitle, jobTool);
            const negativePrompt = PromptGeneratorService.STANDARD_NEGATIVE_PROMPT;

            // Validate prompt before saving
            const validation = PromptGeneratorService.validatePrompt({
                jobTitle,
                jobTool,
                masterPrompt,
                negativePrompt
            });

            if (!validation.isValid) {
                console.warn(`⚠️ Prompt validation failed for ${jobTitle}:`, validation.errors);
                continue;
            }

            await client.query(`
                INSERT INTO category_prompts 
                    (category_id, subcategory_id, job_title, job_tool, master_prompt, negative_prompt, style_version, provider, is_approved)
                VALUES 
                    ($1, $2, $3, $4, $5, $6, 1, 'GEMINI', true)
                ON CONFLICT (subcategory_id) DO UPDATE SET
                    job_title = EXCLUDED.job_title,
                    job_tool = EXCLUDED.job_tool,
                    master_prompt = EXCLUDED.master_prompt,
                    negative_prompt = EXCLUDED.negative_prompt,
                    updated_at = CURRENT_TIMESTAMP;
            `, [sub.cat_id, sub.subcat_id, jobTitle, jobTool, masterPrompt, negativePrompt]);

            count++;
        }

        await client.query('COMMIT');
        console.log(`✅ [SEED_PROMPTS] Successfully seeded ${count} master prompts in category_prompts table.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ [SEED_PROMPTS_ERROR]', err);
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    seedCategoryPrompts().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { seedCategoryPrompts };
