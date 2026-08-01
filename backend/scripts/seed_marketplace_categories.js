const db = require('../config/db');

const S3_BASE = 'https://nexoassets.s3.ap-south-2.amazonaws.com/images';
const s3Url = (name, ratio) => `${S3_BASE}/${ratio}/${encodeURIComponent(name)}2.jpeg`;

const CATEGORY_DATA = [
  {
    name: 'Home Care',
    slug: 'home-care',
    icon: 'home',
    emoji: '🏡',
    description: 'House Cleaning, Deep Cleaning, Cook, Babysitter, Elder Care, Nursing, Laundry & Housekeeping',
    color: '#3B82F6',
    sort_order: 1,
    subcategories: [
      {
        name: 'Home Care',
        slug: 'home-care-general',
        icon: 'cleaning_services',
        jobs: [
          { name: 'House Cleaning', keywords: ['home cleaning', 'sweeping', 'mopping', 'dusting'] },
          { name: 'Deep Cleaning', keywords: ['thorough clean', 'spring cleaning', 'intensive clean'] },
          { name: 'Home Cook', keywords: ['daily cook', 'maid cook', 'chef', 'meal preparation'] },
          { name: 'Babysitter', keywords: ['child care', 'nanny', 'baby care', 'infant care'] },
          { name: 'Elder Care', keywords: ['senior care', 'old age care', 'elderly help', 'caretaker'] },
          { name: 'Home Nurse', keywords: ['nursing', 'patient care', 'medical attendant', 'injection'] },
          { name: 'Laundry', keywords: ['clothes wash', 'washing', 'dhobi'] },
          { name: 'Ironing', keywords: ['clothes press', 'iron press', 'pressing'] },
          { name: 'Housekeeping', keywords: ['house maintenance', 'domestic help'] },
          { name: 'Maid (Full Time)', keywords: ['full time maid', 'live-in maid', 'domestic worker'] },
          { name: 'Maid (Part Time)', keywords: ['part time maid', 'hourly maid', 'morning maid'] },
        ]
      }
    ]
  },
  {
    name: 'Home Repair',
    slug: 'home-repair',
    icon: 'build',
    emoji: '🔨',
    description: 'Electrical, Plumbing, Carpentry, Masonry, Welding, Glass, Pest Control & More',
    color: '#F97316',
    sort_order: 2,
    subcategories: [
      {
        name: 'Electrical',
        slug: 'home-repair-electrical',
        icon: 'electric_bolt',
        jobs: [
          { name: 'Electrician', keywords: ['electric work', 'wiring', 'power'] },
          { name: 'Switch Repair', keywords: ['switchboard', 'plug point', 'socket repair'] },
          { name: 'Wiring Repair', keywords: ['house wiring', 'rewiring', 'cable'] },
          { name: 'MCB Repair', keywords: ['circuit breaker', 'trip switch', 'fuse box'] },
          { name: 'Inverter Repair', keywords: ['ups repair', 'inverter battery', 'backup power'] },
        ]
      },
      {
        name: 'Plumbing',
        slug: 'home-repair-plumbing',
        icon: 'plumbing',
        jobs: [
          { name: 'Plumber', keywords: ['pipe work', 'water supply', 'plumbing work'] },
          { name: 'Tap Repair', keywords: ['faucet repair', 'tap leak', 'mixer tap'] },
          { name: 'Pipe Leakage', keywords: ['pipe burst', 'water leak', 'seepage'] },
          { name: 'Drain Blockage', keywords: ['drain clog', 'sewer block', 'drainage'] },
          { name: 'Toilet Repair', keywords: ['flush repair', 'commode repair', 'bathroom fix'] },
        ]
      },
      {
        name: 'Carpentry',
        slug: 'home-repair-carpentry',
        icon: 'handyman',
        jobs: [
          { name: 'Carpenter', keywords: ['wood work', 'furniture maker', 'joinery'] },
          { name: 'Furniture Repair', keywords: ['chair repair', 'table fix', 'wood polish'] },
          { name: 'Door Repair', keywords: ['door hinge', 'door fitting', 'door alignment'] },
          { name: 'Window Repair', keywords: ['window frame', 'glass pane', 'window lock'] },
          { name: 'Lock Repair', keywords: ['door lock', 'padlock', 'key duplicate', 'locksmith'] },
        ]
      },
      {
        name: 'Masonry',
        slug: 'home-repair-masonry',
        icon: 'foundation',
        jobs: [
          { name: 'Mason', keywords: ['brick work', 'cement work', 'construction'] },
          { name: 'Tile Repair', keywords: ['tile fixing', 'broken tile', 'floor tile'] },
          { name: 'Marble Repair', keywords: ['marble polish', 'marble crack', 'stone work'] },
          { name: 'Granite Repair', keywords: ['granite polish', 'granite crack'] },
          { name: 'POP Repair', keywords: ['plaster of paris', 'ceiling repair', 'pop design'] },
          { name: 'Roof Repair', keywords: ['roof leak', 'terrace repair', 'ceiling leak'] },
          { name: 'Waterproofing', keywords: ['roof waterproof', 'dampness', 'seepage fix'] },
        ]
      },
      {
        name: 'Others',
        slug: 'home-repair-others',
        icon: 'more_horiz',
        jobs: [
          { name: 'Welder', keywords: ['iron gate', 'grill repair', 'metal welding'] },
          { name: 'Glass Repair', keywords: ['window glass', 'mirror repair', 'glass fitting'] },
          { name: 'Pest Control', keywords: ['cockroach', 'termite', 'bedbug', 'rat control'] },
        ]
      }
    ]
  },
  {
    name: 'Installation Services',
    slug: 'installation-services',
    icon: 'settings',
    emoji: '🛠️',
    description: 'AC, TV, Geyser, RO, Fan, Chimney, Washing Machine, CCTV & Intercom Installation',
    color: '#06B6D4',
    sort_order: 3,
    subcategories: [
      {
        name: 'Installation',
        slug: 'installation-general',
        icon: 'build_circle',
        jobs: [
          { name: 'AC Installation', keywords: ['split ac', 'window ac', 'ac fitting'] },
          { name: 'TV Installation', keywords: ['tv mounting', 'wall mount', 'led tv setup'] },
          { name: 'Geyser Installation', keywords: ['water heater', 'geyser fitting'] },
          { name: 'RO Installation', keywords: ['water purifier', 'ro fitting', 'filter setup'] },
          { name: 'Fan Installation', keywords: ['ceiling fan', 'exhaust fan', 'fan fitting'] },
          { name: 'Chimney Installation', keywords: ['kitchen chimney', 'hood fitting'] },
          { name: 'Washing Machine Installation', keywords: ['washer setup', 'laundry machine'] },
          { name: 'CCTV Installation', keywords: ['security camera', 'dvr setup', 'ip camera'] },
          { name: 'Intercom Installation', keywords: ['door phone', 'video intercom'] },
        ]
      }
    ]
  },
  {
    name: 'Appliance Repair',
    slug: 'appliance-repair',
    icon: 'devices_other',
    emoji: '🔧',
    description: 'AC, Refrigerator, Washing Machine, TV, Microwave, Geyser, RO, Chimney & More Repairs',
    color: '#EF4444',
    sort_order: 4,
    subcategories: [
      {
        name: 'Appliance Repair',
        slug: 'appliance-repair-general',
        icon: 'build',
        jobs: [
          { name: 'AC Repair', keywords: ['ac gas refill', 'ac service', 'split ac repair'] },
          { name: 'AC Technician', keywords: ['ac maintenance', 'ac compressor', 'ac clean'] },
          { name: 'Refrigerator Repair', keywords: ['fridge repair', 'compressor', 'cooling issue'] },
          { name: 'Washing Machine Repair', keywords: ['washer repair', 'drum repair', 'front load'] },
          { name: 'TV Repair', keywords: ['led tv', 'lcd tv', 'smart tv repair', 'screen repair'] },
          { name: 'Microwave Repair', keywords: ['oven repair', 'magnetron', 'microwave fix'] },
          { name: 'Geyser Repair', keywords: ['water heater repair', 'geyser element'] },
          { name: 'RO Repair', keywords: ['water purifier repair', 'filter change', 'ro service'] },
          { name: 'Chimney Repair', keywords: ['kitchen chimney service', 'filter clean'] },
          { name: 'Mixer Grinder Repair', keywords: ['jar repair', 'motor repair', 'grinder fix'] },
          { name: 'Laptop Repair', keywords: ['laptop screen', 'keyboard replace', 'os install'] },
          { name: 'Mobile Repair', keywords: ['screen replacement', 'battery replace', 'charging port'] },
        ]
      }
    ]
  },
  {
    name: 'Automotive Services',
    slug: 'automotive-services',
    icon: 'directions_car',
    emoji: '🚗',
    description: 'Bike, Car, Auto Mechanic, Tyre Puncture, Battery, Towing, Car Wash & Detailing',
    color: '#8B5CF6',
    sort_order: 5,
    subcategories: [
      {
        name: 'Two Wheeler',
        slug: 'automotive-two-wheeler',
        icon: 'two_wheeler',
        jobs: [
          { name: 'Bike Mechanic', keywords: ['bike service', 'clutch wire', 'oil change'] },
          { name: 'Bike Puncture', keywords: ['tubeless puncture', 'tyre repair'] },
          { name: 'Bike Wash', keywords: ['doorstep bike wash', 'bike clean'] },
          { name: 'Bike Battery', keywords: ['bike battery replace', 'battery dead'] },
        ]
      },
      {
        name: 'Four Wheeler',
        slug: 'automotive-four-wheeler',
        icon: 'directions_car',
        jobs: [
          { name: 'Car Mechanic', keywords: ['car service', 'engine oil', 'brake repair'] },
          { name: 'Car Wash', keywords: ['foam wash', 'interior detailing', 'exterior wash'] },
          { name: 'Car Detailing', keywords: ['ceramic coating', 'teflon coating', 'paint protection'] },
          { name: 'Car Battery', keywords: ['car battery jumpstart', 'battery replacement'] },
          { name: 'Car Tyre', keywords: ['tyre replacement', 'wheel alignment', 'balancing'] },
          { name: 'Dent & Paint', keywords: ['bumper scratch', 'car repainting', 'body work'] },
        ]
      },
      {
        name: 'Others',
        slug: 'automotive-others',
        icon: 'car_repair',
        jobs: [
          { name: 'Towing', keywords: ['flatbed towing', 'car breakdown', 'accident towing'] },
          { name: 'Auto Mechanic', keywords: ['auto rickshaw', 'three wheeler repair'] },
          { name: 'Fuel Delivery', keywords: ['emergency petrol', 'diesel delivery'] },
          { name: 'Tractor Mechanic', keywords: ['tractor repair', 'tractor service'] },
          { name: 'Roadside Assistance', keywords: ['highway breakdown', 'emergency help'] },
        ]
      }
    ]
  },
  {
    name: 'Construction & Labour',
    slug: 'construction-labour',
    icon: 'construction',
    emoji: '🏗️',
    description: 'House Painting, Civil Work, Centering, Steel Binding, Construction Labour & Contractors',
    color: '#D97706',
    sort_order: 6,
    subcategories: [
      {
        name: 'Construction & Labour',
        slug: 'construction-labour-general',
        icon: 'engineering',
        jobs: [
          { name: 'House Painting', isTeamJob: true, keywords: ['wall painting', 'whitewash', 'exterior paint'] },
          { name: 'Construction Labour', isTeamJob: true, keywords: ['daily labour', 'site worker', 'helper'] },
          { name: 'Centering Work', isTeamJob: true, keywords: ['shuttering', 'formwork', 'slab centering'] },
          { name: 'Steel Binding', isTeamJob: true, keywords: ['rebar tying', 'iron binding', 'reinforcement'] },
          { name: 'Slab Work', isTeamJob: true, keywords: ['concrete slab', 'roof casting'] },
          { name: 'Civil Contractor', keywords: ['building contractor', 'renovation', 'house construction'] },
          { name: 'Architect', keywords: ['house map', '3d elevation', 'building plan'] },
          { name: 'Interior Designer', keywords: ['home interior', 'modular kitchen', 'wardrobe'] },
          { name: 'Scaffolding', isTeamJob: true, keywords: ['scaffold setup', 'height work', 'platform'] },
          { name: 'JCB Rental', keywords: ['excavator', 'earth mover', 'digging machine'] },
        ]
      }
    ]
  },
  {
    name: 'Agriculture',
    slug: 'agriculture',
    icon: 'agriculture',
    emoji: '🌾',
    description: 'Farm Labour, Tractor Work, Harvesting, Sowing, Irrigation, Animal Care & Equipment Rental',
    color: '#10B981',
    sort_order: 7,
    subcategories: [
      {
        name: 'Agriculture',
        slug: 'agriculture-general',
        icon: 'eco',
        jobs: [
          { name: 'Farm Labour', isTeamJob: true, keywords: ['field work', 'agricultural labour', 'crop work'] },
          { name: 'Tractor Work', keywords: ['ploughing', 'tilling', 'harrowing'] },
          { name: 'Harvesting', isTeamJob: true, keywords: ['crop cutting', 'manual harvesting', 'combine'] },
          { name: 'Sowing', keywords: ['planting', 'seed drill', 'transplanting'] },
          { name: 'Irrigation Work', keywords: ['drip irrigation', 'sprinkler', 'pipe fitting'] },
          { name: 'Pesticide Spraying', keywords: ['crop spraying', 'fertilizer', 'pest control'] },
          { name: 'Animal Care', keywords: ['cow caretaker', 'dairy farm', 'poultry'] },
          { name: 'Equipment Rental', keywords: ['rotavator', 'cultivator', 'thresher', 'power weeder'] },
        ]
      }
    ]
  },
  {
    name: 'Beauty & Wellness',
    slug: 'beauty-wellness',
    icon: 'spa',
    emoji: '💇',
    description: 'Barber, Salon at Home, Makeup Artist, Mehendi, Massage, Personal Trainer & Yoga',
    color: '#EC4899',
    sort_order: 8,
    subcategories: [
      {
        name: 'Beauty & Wellness',
        slug: 'beauty-wellness-general',
        icon: 'face',
        jobs: [
          { name: 'Barber', keywords: ['haircut at home', 'beard trim', 'grooming'] },
          { name: 'Salon at Home', keywords: ['facial', 'waxing', 'pedicure', 'manicure'] },
          { name: 'Makeup Artist', keywords: ['bridal makeup', 'party makeup', 'beauty'] },
          { name: 'Mehendi Artist', keywords: ['henna design', 'wedding mehendi', 'mehndi'] },
          { name: 'Massage', keywords: ['body massage', 'head massage', 'oil massage'] },
          { name: 'Spa', keywords: ['body scrub', 'aroma therapy', 'steam bath'] },
          { name: 'Personal Trainer', keywords: ['gym coach', 'fitness', 'weight loss'] },
          { name: 'Yoga Trainer', keywords: ['yoga class', 'meditation', 'pranayama'] },
        ]
      }
    ]
  },
  {
    name: 'Event Services',
    slug: 'event-services',
    icon: 'celebration',
    emoji: '🎉',
    description: 'DJ, Sound System, Decoration, Catering Staff, Photography, Videography & Event Planning',
    color: '#EAB308',
    sort_order: 9,
    subcategories: [
      {
        name: 'Event Services',
        slug: 'event-services-general',
        icon: 'festival',
        jobs: [
          { name: 'Event Helpers', isTeamJob: true, keywords: ['event staff', 'party helpers', 'function help'] },
          { name: 'Catering Staff', isTeamJob: true, keywords: ['party food', 'buffet', 'cooking staff'] },
          { name: 'Decoration Setup', isTeamJob: true, keywords: ['flower decoration', 'stage decoration', 'balloon'] },
          { name: 'Sound/Light Setup', isTeamJob: true, keywords: ['speakers', 'dj setup', 'disco light', 'mic rental'] },
          { name: 'Photographer', keywords: ['event photo', 'portrait', 'product photoshoot'] },
          { name: 'Videographer', keywords: ['cinematography', 'reels video', 'wedding video'] },
          { name: 'Wedding Planner', keywords: ['marriage planner', 'sangeet organizer'] },
          { name: 'Birthday Planner', keywords: ['kids party', 'birthday decoration'] },
        ]
      }
    ]
  },
  {
    name: 'Education',
    slug: 'education',
    icon: 'school',
    emoji: '📚',
    description: 'Home Tutor, Music Teacher, Language Classes, Coding Tutor & Spoken English',
    color: '#6366F1',
    sort_order: 10,
    subcategories: [
      {
        name: 'Education',
        slug: 'education-general',
        icon: 'menu_book',
        jobs: [
          { name: 'Home Tutor', keywords: ['maths tutor', 'science tutor', 'cbse teacher'] },
          { name: 'Music Teacher', keywords: ['guitar teacher', 'piano teacher', 'singing'] },
          { name: 'Language Classes', keywords: ['french', 'german', 'spanish', 'hindi'] },
          { name: 'Coding Tutor', keywords: ['python', 'java', 'web development'] },
          { name: 'Spoken English', keywords: ['fluency', 'english communication', 'ielts'] },
          { name: 'Dance Trainer', keywords: ['zumba', 'bollywood dance', 'classical dance'] },
        ]
      }
    ]
  },
  {
    name: 'Pet Care',
    slug: 'pet-care',
    icon: 'pets',
    emoji: '🐾',
    description: 'Dog Walking, Pet Grooming, Vet Visit, Pet Boarding & Pet Training',
    color: '#14B8A6',
    sort_order: 11,
    subcategories: [
      {
        name: 'Pet Care',
        slug: 'pet-care-general',
        icon: 'pets',
        jobs: [
          { name: 'Dog Walking', keywords: ['pet walker', 'dog exercise', 'pet walking'] },
          { name: 'Pet Grooming', keywords: ['dog bath', 'nail clipping', 'pet salon'] },
          { name: 'Vet Visit', keywords: ['vet home visit', 'pet doctor', 'animal doctor'] },
          { name: 'Pet Boarding', keywords: ['pet hostel', 'dog stay', 'cat boarding'] },
          { name: 'Pet Training', keywords: ['puppy training', 'dog behavior', 'obedience'] },
        ]
      }
    ]
  },
  {
    name: 'Creative Services',
    slug: 'creative-services',
    icon: 'palette',
    emoji: '🎨',
    description: 'Graphic Designer, Logo Designer, Video Editor, Content Writer, Social Media & Voice Artist',
    color: '#F43F5E',
    sort_order: 12,
    subcategories: [
      {
        name: 'Creative Services',
        slug: 'creative-services-general',
        icon: 'brush',
        jobs: [
          { name: 'Graphic Designer', keywords: ['banner design', 'poster', 'flyer', 'brochure'] },
          { name: 'Logo Designer', keywords: ['branding logo', 'vector logo', 'brand identity'] },
          { name: 'Video Editor', keywords: ['youtube edit', 'instagram reel', 'post production'] },
          { name: 'Content Writer', keywords: ['blog writing', 'copywriting', 'article'] },
          { name: 'Social Media Manager', keywords: ['instagram growth', 'social post', 'marketing'] },
          { name: 'Voice Artist', keywords: ['voiceover', 'narration', 'dubbing'] },
        ]
      }
    ]
  },
  {
    name: 'Logistics & Transport',
    slug: 'logistics-transport',
    icon: 'local_shipping',
    emoji: '🚚',
    description: 'Packers & Movers, Loading, Unloading, Mini Truck, Personal Driver & Delivery',
    color: '#7C3AED',
    sort_order: 13,
    subcategories: [
      {
        name: 'Logistics & Transport',
        slug: 'logistics-transport-general',
        icon: 'fire_truck',
        jobs: [
          { name: 'Packers & Movers', isTeamJob: true, keywords: ['house shifting', 'office relocation', 'packing'] },
          { name: 'Loading', isTeamJob: true, keywords: ['luggage loading', 'goods loading', 'truck loading'] },
          { name: 'Unloading', isTeamJob: true, keywords: ['truck unloading', 'furniture unloading'] },
          { name: 'Mini Truck', keywords: ['tata ace', 'porter truck', 'goods transport'] },
          { name: 'Personal Driver', keywords: ['car driver', 'outstation driver', 'chauffeur'] },
          { name: 'Courier Service', keywords: ['express courier', 'local delivery'] },
          { name: 'Parcel Delivery', keywords: ['parcel pickup', 'package delivery'] },
          { name: 'Furniture Moving', keywords: ['sofa shifting', 'bed transport', 'appliance moving'] },
        ]
      }
    ]
  }
];

// ─── Team job configuration ───
const TEAM_JOB_DEFAULTS = {
  min_workers: 2,
  max_workers: 20,
};

async function seedMarketplace() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    let totalJobs = 0;
    let teamJobCount = 0;

    for (const cat of CATEGORY_DATA) {
      // Insert category
      const catRes = await client.query(`
        INSERT INTO marketplace_categories (name, slug, icon, emoji, description, color, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          icon = EXCLUDED.icon,
          emoji = EXCLUDED.emoji,
          description = EXCLUDED.description,
          color = EXCLUDED.color,
          sort_order = EXCLUDED.sort_order,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id;
      `, [cat.name, cat.slug, cat.icon, cat.emoji, cat.description, cat.color, cat.sort_order]);

      const catId = catRes.rows[0].id;

      for (let si = 0; si < cat.subcategories.length; si++) {
        const sub = cat.subcategories[si];

        // Use first job name for subcategory image fallback
        const subImageName = sub.jobs.length > 0 ? sub.jobs[0].name : sub.name;

        const subRes = await client.query(`
          INSERT INTO marketplace_subcategories (category_id, name, slug, icon, image_1x1, image_16x9, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (slug) DO UPDATE SET
            category_id = EXCLUDED.category_id,
            name = EXCLUDED.name,
            icon = EXCLUDED.icon,
            image_1x1 = EXCLUDED.image_1x1,
            image_16x9 = EXCLUDED.image_16x9,
            sort_order = EXCLUDED.sort_order,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id;
        `, [catId, sub.name, sub.slug, sub.icon, s3Url(subImageName, '1:1'), s3Url(subImageName, '16:9'), si + 1]);

        const subId = subRes.rows[0].id;

        // Insert jobs
        for (let ji = 0; ji < sub.jobs.length; ji++) {
          const job = sub.jobs[ji];
          const jobSlug = `${cat.slug}-${job.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;
          const isTeam = job.isTeamJob === true;

          await client.query(`
            INSERT INTO marketplace_jobs (
              category_id, subcategory_id, name, slug, image_1x1, image_16x9,
              is_team_job, min_workers, max_workers, keywords, sort_order
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (slug) DO UPDATE SET
              category_id = EXCLUDED.category_id,
              subcategory_id = EXCLUDED.subcategory_id,
              name = EXCLUDED.name,
              image_1x1 = EXCLUDED.image_1x1,
              image_16x9 = EXCLUDED.image_16x9,
              is_team_job = EXCLUDED.is_team_job,
              min_workers = EXCLUDED.min_workers,
              max_workers = EXCLUDED.max_workers,
              keywords = EXCLUDED.keywords,
              sort_order = EXCLUDED.sort_order,
              updated_at = CURRENT_TIMESTAMP;
          `, [
            catId, subId, job.name, jobSlug,
            s3Url(job.name, '1:1'), s3Url(job.name, '16:9'),
            isTeam,
            isTeam ? TEAM_JOB_DEFAULTS.min_workers : 1,
            isTeam ? TEAM_JOB_DEFAULTS.max_workers : 1,
            job.keywords || [],
            ji + 1
          ]);

          totalJobs++;
          if (isTeam) teamJobCount++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`✅ [SEED_MARKETPLACE] Seeded ${CATEGORY_DATA.length} categories, ${totalJobs} jobs (${teamJobCount} team jobs).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [SEED_MARKETPLACE_ERROR]', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedMarketplace().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { seedMarketplace, CATEGORY_DATA };
