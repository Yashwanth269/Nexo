const db = require('../config/db');

const CATEGORY_DATA = [
  {
    name: 'Home Services',
    slug: 'home-services',
    icon: 'home_repair_service',
    description: 'Electrician, Plumbing, Carpentry, Painting, Cleaning, CCTV, Solar & Home Repair Services',
    sort_order: 1,
    subcategories: [
      { name: 'Electrician', slug: 'electrician', icon: 'electric_bolt', default_pricing_type: 'HOURLY', min_price: 199, max_price: 1499, keywords: ['wiring', 'switchboard', 'fan repair', 'fuse', 'light fitting'] },
      { name: 'Plumber', slug: 'plumber', icon: 'plumbing', default_pricing_type: 'HOURLY', min_price: 199, max_price: 1299, keywords: ['tap repair', 'leakage', 'pipe fitting', 'flush', 'water tank'] },
      { name: 'Carpenter', slug: 'carpenter', icon: 'handyman', default_pricing_type: 'HOURLY', min_price: 249, max_price: 1999, keywords: ['door repair', 'furniture', 'lock repair', 'cabinet', 'woodwork'] },
      { name: 'Painter', slug: 'painter', icon: 'format_paint', default_pricing_type: 'FIXED', min_price: 499, max_price: 9999, keywords: ['wall painting', 'whitewash', 'waterproofing', 'putty'] },
      { name: 'Mason', slug: 'mason', icon: 'foundation', default_pricing_type: 'FIXED', min_price: 599, max_price: 4999, keywords: ['brickwork', 'plaster', 'concrete', 'tile fixing'] },
      { name: 'Welder', slug: 'welder', icon: 'build', default_pricing_type: 'FIXED', min_price: 399, max_price: 2999, keywords: ['iron gate', 'grill repair', 'metal welding'] },
      { name: 'Tile Fitting', slug: 'tile-fitting', icon: 'grid_view', default_pricing_type: 'FIXED', min_price: 499, max_price: 5999, keywords: ['floor tile', 'bathroom tile', 'grouting'] },
      { name: 'POP & False Ceiling', slug: 'pop-false-ceiling', icon: 'roofing', default_pricing_type: 'FIXED', min_price: 999, max_price: 14999, keywords: ['pop design', 'gypsum board', 'false ceiling'] },
      { name: 'Interior Work', slug: 'interior-work', icon: 'deck', default_pricing_type: 'NEGOTIABLE', min_price: 1499, max_price: 49999, keywords: ['modular kitchen', 'wardrobe', 'decor'] },
      { name: 'Waterproofing', slug: 'waterproofing', icon: 'water_drop', default_pricing_type: 'FIXED', min_price: 799, max_price: 8999, keywords: ['roof waterproofing', 'dampness', 'seepage'] },
      { name: 'Pest Control', slug: 'pest-control', icon: 'bug_report', default_pricing_type: 'FIXED', min_price: 399, max_price: 2499, keywords: ['cockroach control', 'termite control', 'bedbug treatment'] },
      { name: 'Deep Cleaning', slug: 'deep-cleaning', icon: 'cleaning_services', default_pricing_type: 'FIXED', min_price: 799, max_price: 3999, keywords: ['full house cleaning', 'kitchen deep clean', 'bathroom deep clean'] },
      { name: 'Sofa Cleaning', slug: 'sofa-cleaning', icon: 'chair', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['sofa shampoo', 'couch cleaning'] },
      { name: 'Mattress Cleaning', slug: 'mattress-cleaning', icon: 'bed', default_pricing_type: 'FIXED', min_price: 299, max_price: 1199, keywords: ['mattress sanitization', 'bed cleaning'] },
      { name: 'Water Tank Cleaning', slug: 'water-tank-cleaning', icon: 'water_damage', default_pricing_type: 'FIXED', min_price: 499, max_price: 1999, keywords: ['overhead tank', 'sump cleaning'] },
      { name: 'Borewell Services', slug: 'borewell-services', icon: 'grass', default_pricing_type: 'FIXED', min_price: 999, max_price: 24999, keywords: ['borewell drilling', 'borewell flushing', 'submersible pump'] },
      { name: 'CCTV Installation', slug: 'cctv-installation', icon: 'videocam', default_pricing_type: 'FIXED', min_price: 499, max_price: 4999, keywords: ['security camera', 'dvr setup', 'ip camera'] },
      { name: 'RO Service', slug: 'ro-service', icon: 'water_ph', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['water purifier repair', 'filter change', 'ro installation'] },
      { name: 'Inverter Service', slug: 'inverter-service', icon: 'battery_charging_full', default_pricing_type: 'FIXED', min_price: 299, max_price: 1999, keywords: ['inverter battery', 'ups repair'] },
      { name: 'Solar Installation', slug: 'solar-installation', icon: 'solar_power', default_pricing_type: 'NEGOTIABLE', min_price: 1999, max_price: 99999, keywords: ['solar panel', 'rooftop solar', 'solar inverter'] }
    ]
  },
  {
    name: 'Appliance Repair',
    slug: 'appliance-repair',
    icon: 'devices_other',
    description: 'AC, Refrigerator, Washing Machine, TV, Laptop & Household Appliances',
    sort_order: 2,
    subcategories: [
      { name: 'AC Repair', slug: 'ac-repair', icon: 'ac_unit', default_pricing_type: 'HOURLY', min_price: 399, max_price: 2499, keywords: ['ac gas refill', 'ac service', 'split ac', 'window ac'] },
      { name: 'Refrigerator', slug: 'refrigerator-repair', icon: 'kitchen', default_pricing_type: 'FIXED', min_price: 299, max_price: 1999, keywords: ['fridge repair', 'single door', 'double door', 'compressor'] },
      { name: 'Washing Machine', slug: 'washing-machine-repair', icon: 'local_laundry_service', default_pricing_type: 'FIXED', min_price: 299, max_price: 1799, keywords: ['front load', 'top load', 'drum repair'] },
      { name: 'Television', slug: 'tv-repair', icon: 'tv', default_pricing_type: 'FIXED', min_price: 299, max_price: 2499, keywords: ['led tv', 'lcd tv', 'smart tv', 'screen repair'] },
      { name: 'Microwave', slug: 'microwave-repair', icon: 'microwave', default_pricing_type: 'FIXED', min_price: 249, max_price: 1299, keywords: ['oven repair', 'magnetron'] },
      { name: 'Geyser', slug: 'geyser-repair', icon: 'hot_tub', default_pricing_type: 'FIXED', min_price: 249, max_price: 1199, keywords: ['water heater', 'geyser element'] },
      { name: 'Chimney', slug: 'chimney-repair', icon: 'air', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['kitchen chimney', 'filter clean'] },
      { name: 'Dishwasher', slug: 'dishwasher-repair', icon: 'countertops', default_pricing_type: 'FIXED', min_price: 349, max_price: 1999, keywords: ['dishwasher service'] },
      { name: 'Mixer Grinder', slug: 'mixer-grinder-repair', icon: 'blender', default_pricing_type: 'FIXED', min_price: 149, max_price: 699, keywords: ['jar repair', 'motor repair'] },
      { name: 'Water Cooler', slug: 'water-cooler-repair', icon: 'mode_fan_off', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['air cooler', 'water dispenser'] },
      { name: 'Laptop Repair', slug: 'laptop-repair', icon: 'laptop', default_pricing_type: 'FIXED', min_price: 399, max_price: 3999, keywords: ['laptop screen', 'keyboard replace', 'os install'] },
      { name: 'Computer Repair', slug: 'computer-repair', icon: 'desktop_windows', default_pricing_type: 'FIXED', min_price: 349, max_price: 2999, keywords: ['pc repair', 'cpu fan', 'ram upgrade'] },
      { name: 'Printer Repair', slug: 'printer-repair', icon: 'print', default_pricing_type: 'FIXED', min_price: 299, max_price: 1799, keywords: ['cartridge refill', 'laser printer'] },
      { name: 'Mobile Repair', slug: 'mobile-repair', icon: 'smartphone', default_pricing_type: 'FIXED', min_price: 299, max_price: 4999, keywords: ['screen glass replacement', 'battery replace', 'charging port'] }
    ]
  },
  {
    name: 'Automobile',
    slug: 'automobile',
    icon: 'directions_car',
    description: 'Mechanic, Car/Bike Wash, Battery, Tyre, Towing & Fuel Delivery',
    sort_order: 3,
    subcategories: [
      { name: 'Car Mechanic', slug: 'car-mechanic', icon: 'car_repair', default_pricing_type: 'HOURLY', min_price: 399, max_price: 4999, keywords: ['car service', 'engine oil', 'brake repair'] },
      { name: 'Bike Mechanic', slug: 'bike-mechanic', icon: 'two_wheeler', default_pricing_type: 'HOURLY', min_price: 199, max_price: 1999, keywords: ['bike service', 'clutch wire', 'oil change'] },
      { name: 'Car Wash', slug: 'car-wash', icon: 'local_car_wash', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['foam wash', 'interior detailing'] },
      { name: 'Bike Wash', slug: 'bike-wash', icon: 'two_wheeler', default_pricing_type: 'FIXED', min_price: 99, max_price: 399, keywords: ['doorstep bike wash'] },
      { name: 'Doorstep Service', slug: 'doorstep-auto-service', icon: 'home_repair_service', default_pricing_type: 'FIXED', min_price: 299, max_price: 2499, keywords: ['mobile mechanic'] },
      { name: 'Battery Replacement', slug: 'battery-replacement', icon: 'battery_charging_full', default_pricing_type: 'FIXED', min_price: 199, max_price: 6999, keywords: ['car battery jumpstart', 'bike battery'] },
      { name: 'Tyre Replacement', slug: 'tyre-replacement', icon: 'tire_repair', default_pricing_type: 'FIXED', min_price: 149, max_price: 4999, keywords: ['wheel alignment', 'new tyre'] },
      { name: 'Puncture Repair', slug: 'puncture-repair', icon: 'tire_repair', default_pricing_type: 'FIXED', min_price: 99, max_price: 499, keywords: ['tubeless puncture', 'doorstep puncture'] },
      { name: 'Towing', slug: 'towing-service', icon: 'car_crash', default_pricing_type: 'FIXED', min_price: 599, max_price: 3999, keywords: ['flatbed towing', 'car breakdown'] },
      { name: 'Fuel Delivery', slug: 'fuel-delivery', icon: 'local_gas_station', default_pricing_type: 'FIXED', min_price: 199, max_price: 999, keywords: ['emergency petrol', 'diesel delivery'] },
      { name: 'Car Detailing', slug: 'car-detailing', icon: 'auto_awesome', default_pricing_type: 'FIXED', min_price: 999, max_price: 9999, keywords: ['ceramic coating', 'teflon coating'] },
      { name: 'Dent & Paint', slug: 'dent-paint', icon: 'format_paint', default_pricing_type: 'NEGOTIABLE', min_price: 799, max_price: 14999, keywords: ['bumper scratch', 'car repainting'] }
    ]
  },
  {
    name: 'Moving & Logistics',
    slug: 'moving-logistics',
    icon: 'local_shipping',
    description: 'House Shifting, Packers & Movers, Goods Transport & Mini Trucks',
    sort_order: 4,
    subcategories: [
      { name: 'House Shifting', slug: 'house-shifting', icon: 'house_siding', default_pricing_type: 'NEGOTIABLE', min_price: 1999, max_price: 24999, keywords: ['home relocation', 'packer mover'] },
      { name: 'Office Relocation', slug: 'office-relocation', icon: 'business', default_pricing_type: 'NEGOTIABLE', min_price: 2999, max_price: 49999, keywords: ['commercial shifting'] },
      { name: 'Packers', slug: 'packers', icon: 'inventory_2', default_pricing_type: 'HOURLY', min_price: 499, max_price: 3999, keywords: ['bubble wrap', 'box packing'] },
      { name: 'Movers', slug: 'movers', icon: 'diversity_3', default_pricing_type: 'HOURLY', min_price: 499, max_price: 3999, keywords: ['furniture lifting', 'heavy item loader'] },
      { name: 'Loading', slug: 'loading-labour', icon: 'upload', default_pricing_type: 'HOURLY', min_price: 299, max_price: 1999, keywords: ['luggage loading'] },
      { name: 'Unloading', slug: 'unloading-labour', icon: 'download', default_pricing_type: 'HOURLY', min_price: 299, max_price: 1999, keywords: ['truck unloading'] },
      { name: 'Goods Transport', slug: 'goods-transport', icon: 'local_shipping', default_pricing_type: 'FIXED', min_price: 499, max_price: 9999, keywords: ['cargo transport', 'logistics'] },
      { name: 'Mini Truck', slug: 'mini-truck', icon: 'fire_truck', default_pricing_type: 'FIXED', min_price: 399, max_price: 2499, keywords: ['tata ace', 'porter truck'] },
      { name: 'Pickup Van', slug: 'pickup-van', icon: 'airport_shuttle', default_pricing_type: 'FIXED', min_price: 349, max_price: 1999, keywords: ['bolero pickup', 'small van'] },
      { name: 'Courier', slug: 'courier-service', icon: 'markunread_mailbox', default_pricing_type: 'FIXED', min_price: 99, max_price: 899, keywords: ['express courier'] },
      { name: 'Parcel Delivery', slug: 'parcel-delivery', icon: 'local_post_office', default_pricing_type: 'FIXED', min_price: 79, max_price: 599, keywords: ['local delivery'] },
      { name: 'Furniture Moving', slug: 'furniture-moving', icon: 'chair', default_pricing_type: 'FIXED', min_price: 399, max_price: 2499, keywords: ['sofa shifting', 'bed transport'] }
    ]
  },
  {
    name: 'Cleaning',
    slug: 'cleaning',
    icon: 'cleaning_services',
    description: 'Home, Office, Kitchen, Bathroom, Carpet & Window Cleaning Services',
    sort_order: 5,
    subcategories: [
      { name: 'Home Cleaning', slug: 'home-cleaning', icon: 'clean_hands', default_pricing_type: 'FIXED', min_price: 699, max_price: 3999, keywords: ['apartment clean', 'villa clean'] },
      { name: 'Office Cleaning', slug: 'office-cleaning', icon: 'apartment', default_pricing_type: 'FIXED', min_price: 999, max_price: 9999, keywords: ['commercial cleaning'] },
      { name: 'Kitchen Cleaning', slug: 'kitchen-cleaning', icon: 'countertops', default_pricing_type: 'FIXED', min_price: 399, max_price: 1499, keywords: ['kitchen degreasing'] },
      { name: 'Bathroom Cleaning', slug: 'bathroom-cleaning', icon: 'bathtub', default_pricing_type: 'FIXED', min_price: 299, max_price: 999, keywords: ['washroom descaling'] },
      { name: 'Carpet Cleaning', slug: 'carpet-cleaning', icon: 'dry_cleaning', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['rug shampooing'] },
      { name: 'Window Cleaning', slug: 'window-cleaning', icon: 'window', default_pricing_type: 'FIXED', min_price: 199, max_price: 1199, keywords: ['glass cleaning'] }
    ]
  },
  {
    name: 'Outdoor Services',
    slug: 'outdoor-services',
    icon: 'deck',
    description: 'Gardening, Lawn Mowing, Tree Cutting & Pool Maintenance',
    sort_order: 6,
    subcategories: [
      { name: 'Gardening', slug: 'gardening', icon: 'yard', default_pricing_type: 'HOURLY', min_price: 249, max_price: 1499, keywords: ['gardener', 'plant care', 'potting'] },
      { name: 'Lawn Mowing', slug: 'lawn-mowing', icon: 'grass', default_pricing_type: 'FIXED', min_price: 299, max_price: 1999, keywords: ['grass cutting', 'lawn trim'] },
      { name: 'Tree Cutting', slug: 'tree-cutting', icon: 'content_cut', default_pricing_type: 'FIXED', min_price: 499, max_price: 4999, keywords: ['branch trimming', 'tree removal'] },
      { name: 'Plant Maintenance', slug: 'plant-maintenance', icon: 'eco', default_pricing_type: 'HOURLY', min_price: 199, max_price: 999, keywords: ['balcony garden', 'fertilizing'] },
      { name: 'Swimming Pool Cleaning', slug: 'pool-cleaning', icon: 'pool', default_pricing_type: 'FIXED', min_price: 799, max_price: 3999, keywords: ['pool chlorination', 'filter clean'] },
      { name: 'Septic Tank Cleaning', slug: 'septic-tank-cleaning', icon: 'plumbing', default_pricing_type: 'FIXED', min_price: 999, max_price: 4999, keywords: ['sewage suction', 'drainage clearance'] }
    ]
  },
  {
    name: 'Beauty & Wellness',
    slug: 'beauty-wellness',
    icon: 'spa',
    description: 'Barber, Salon at Home, Makeup, Mehendi, Massage, Spa & Personal Fitness',
    sort_order: 7,
    subcategories: [
      { name: 'Barber', slug: 'barber', icon: 'content_cut', default_pricing_type: 'FIXED', min_price: 149, max_price: 599, keywords: ['haircut at home', 'beard trim'] },
      { name: 'Salon at Home', slug: 'salon-at-home', icon: 'face', default_pricing_type: 'FIXED', min_price: 399, max_price: 2999, keywords: ['facial', 'waxing', 'pedicure', 'manicure'] },
      { name: 'Makeup Artist', slug: 'makeup-artist', icon: 'brush', default_pricing_type: 'FIXED', min_price: 999, max_price: 9999, keywords: ['bridal makeup', 'party makeup'] },
      { name: 'Mehendi Artist', slug: 'mehendi-artist', icon: 'draw', default_pricing_type: 'FIXED', min_price: 499, max_price: 4999, keywords: ['henna design', 'wedding mehendi'] },
      { name: 'Massage', slug: 'massage', icon: 'self_improvement', default_pricing_type: 'HOURLY', min_price: 699, max_price: 2499, keywords: ['body massage', 'head massage'] },
      { name: 'Spa', slug: 'spa', icon: 'hot_tub', default_pricing_type: 'HOURLY', min_price: 899, max_price: 3499, keywords: ['body scrub', 'aroma therapy'] },
      { name: 'Personal Trainer', slug: 'personal-trainer', icon: 'fitness_center', default_pricing_type: 'HOURLY', min_price: 499, max_price: 1999, keywords: ['gym coach', 'weight loss'] },
      { name: 'Yoga Trainer', slug: 'yoga-trainer', icon: 'self_improvement', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1499, keywords: ['yoga class', 'meditation'] },
      { name: 'Dance Trainer', slug: 'dance-trainer', icon: 'music_note', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1499, keywords: ['zumba', 'bollywood dance'] }
    ]
  },
  {
    name: 'Education',
    slug: 'education',
    icon: 'school',
    description: 'Home Tutor, Online Tutor, Coding, Spoken English & Music Classes',
    sort_order: 8,
    subcategories: [
      { name: 'Home Tutor', slug: 'home-tutor', icon: 'menu_book', default_pricing_type: 'HOURLY', min_price: 299, max_price: 999, keywords: ['maths tutor', 'science tutor', 'cbse teacher'] },
      { name: 'Online Tutor', slug: 'online-tutor', icon: 'laptop_chromebook', default_pricing_type: 'HOURLY', min_price: 199, max_price: 799, keywords: ['zoom class', 'vedic maths'] },
      { name: 'Coding Tutor', slug: 'coding-tutor', icon: 'code', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1499, keywords: ['python', 'java', 'web development class'] },
      { name: 'Spoken English', slug: 'spoken-english', icon: 'record_voice_over', default_pricing_type: 'HOURLY', min_price: 199, max_price: 699, keywords: ['fluency', 'english communication'] },
      { name: 'Tuition', slug: 'tuition', icon: 'local_library', default_pricing_type: 'HOURLY', min_price: 199, max_price: 699, keywords: ['primary tuition', 'high school tuition'] },
      { name: 'Language Classes', slug: 'language-classes', icon: 'translate', default_pricing_type: 'HOURLY', min_price: 299, max_price: 999, keywords: ['french', 'german', 'spanish'] },
      { name: 'Music Teacher', slug: 'music-teacher', icon: 'music_note', default_pricing_type: 'HOURLY', min_price: 299, max_price: 1199, keywords: ['guitar teacher', 'piano teacher', 'singing'] }
    ]
  },
  {
    name: 'Photography & Creative',
    slug: 'creative-services',
    icon: 'photo_camera',
    description: 'Photographer, Videographer, Drone Shoot, Graphic Design, Video Editing & UI/UX',
    sort_order: 9,
    subcategories: [
      { name: 'Photographer', slug: 'photographer', icon: 'camera_alt', default_pricing_type: 'HOURLY', min_price: 799, max_price: 4999, keywords: ['event photo', 'portrait', 'product photoshoot'] },
      { name: 'Videographer', slug: 'videographer', icon: 'videocam', default_pricing_type: 'HOURLY', min_price: 999, max_price: 6999, keywords: ['cinematography', 'reels video'] },
      { name: 'Drone Shoot', slug: 'drone-shoot', icon: 'flight_takeoff', default_pricing_type: 'HOURLY', min_price: 1499, max_price: 9999, keywords: ['aerial video', 'real estate drone'] },
      { name: 'Graphic Designer', slug: 'graphic-designer', icon: 'palette', default_pricing_type: 'FIXED', min_price: 299, max_price: 2999, keywords: ['banner design', 'poster', 'flyer'] },
      { name: 'Logo Designer', slug: 'logo-designer', icon: 'draw', default_pricing_type: 'FIXED', min_price: 499, max_price: 4999, keywords: ['branding logo', 'vector logo'] },
      { name: 'UI Designer', slug: 'ui-designer', icon: 'dashboard', default_pricing_type: 'HOURLY', min_price: 499, max_price: 2499, keywords: ['figma design', 'app interface'] },
      { name: 'Video Editor', slug: 'video-editor', icon: 'movie_edit', default_pricing_type: 'FIXED', min_price: 499, max_price: 4999, keywords: ['youtube edit', 'instagram reel'] },
      { name: 'Animator', slug: 'animator', icon: 'animation', default_pricing_type: 'FIXED', min_price: 799, max_price: 9999, keywords: ['2d animation', '3d animation'] },
      { name: 'Voice Artist', slug: 'voice-artist', icon: 'mic', default_pricing_type: 'FIXED', min_price: 399, max_price: 2999, keywords: ['voiceover', 'narration'] }
    ]
  },
  {
    name: 'IT & Digital',
    slug: 'it-digital',
    icon: 'computer',
    description: 'Web & App Developers, AI Engineers, Cloud, SEO & Digital Marketing',
    sort_order: 10,
    subcategories: [
      { name: 'Web Developer', slug: 'web-developer', icon: 'language', default_pricing_type: 'HOURLY', min_price: 499, max_price: 3499, keywords: ['website creation', 'wordpress', 'react'] },
      { name: 'Mobile Developer', slug: 'mobile-developer', icon: 'phone_android', default_pricing_type: 'HOURLY', min_price: 599, max_price: 3999, keywords: ['flutter app', 'android app', 'ios app'] },
      { name: 'Software Engineer', slug: 'software-engineer', icon: 'terminal', default_pricing_type: 'HOURLY', min_price: 699, max_price: 4999, keywords: ['backend api', 'node js', 'python'] },
      { name: 'AI Developer', slug: 'ai-developer', icon: 'smart_toy', default_pricing_type: 'HOURLY', min_price: 999, max_price: 6999, keywords: ['machine learning', 'chatbots', 'llm prompt'] },
      { name: 'Cloud Engineer', slug: 'cloud-engineer', icon: 'cloud', default_pricing_type: 'HOURLY', min_price: 799, max_price: 4999, keywords: ['aws deployment', 'docker', 'devops'] },
      { name: 'Cyber Security', slug: 'cyber-security', icon: 'security', default_pricing_type: 'HOURLY', min_price: 899, max_price: 5999, keywords: ['penetration test', 'security audit'] },
      { name: 'SEO Specialist', slug: 'seo-specialist', icon: 'travel_explore', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1999, keywords: ['google ranking', 'backlinks'] },
      { name: 'Digital Marketing', slug: 'digital-marketing', icon: 'campaign', default_pricing_type: 'HOURLY', min_price: 399, max_price: 2499, keywords: ['google ads', 'meta ads'] },
      { name: 'Content Writing', slug: 'content-writing', icon: 'article', default_pricing_type: 'FIXED', min_price: 199, max_price: 1499, keywords: ['blog writing', 'copywriting'] },
      { name: 'Social Media Manager', slug: 'social-media-manager', icon: 'share', default_pricing_type: 'HOURLY', min_price: 349, max_price: 1999, keywords: ['instagram growth', 'social post'] }
    ]
  },
  {
    name: 'Business & Legal',
    slug: 'business-legal',
    icon: 'business_center',
    description: 'CA, GST Filing, Advocates, Legal Advisors, Recruiters & Virtual Assistants',
    sort_order: 11,
    subcategories: [
      { name: 'Chartered Accountant', slug: 'chartered-accountant', icon: 'account_balance', default_pricing_type: 'FIXED', min_price: 499, max_price: 4999, keywords: ['income tax filing', 'itr', 'audit'] },
      { name: 'GST Filing', slug: 'gst-filing', icon: 'receipt_long', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['gst return', 'gst registration'] },
      { name: 'Company Registration', slug: 'company-registration', icon: 'domain', default_pricing_type: 'FIXED', min_price: 1499, max_price: 9999, keywords: ['pvt ltd', 'llp', 'proprietorship'] },
      { name: 'Legal Advisor', slug: 'legal-advisor', icon: 'gavel', default_pricing_type: 'HOURLY', min_price: 499, max_price: 2999, keywords: ['contract review', 'legal notice'] },
      { name: 'Advocate', slug: 'advocate', icon: 'balance', default_pricing_type: 'HOURLY', min_price: 799, max_price: 4999, keywords: ['court lawyer', 'property dispute'] },
      { name: 'Recruiter', slug: 'recruiter', icon: 'person_search', default_pricing_type: 'NEGOTIABLE', min_price: 999, max_price: 9999, keywords: ['hiring staff', 'talent search'] },
      { name: 'HR Consultant', slug: 'hr-consultant', icon: 'groups', default_pricing_type: 'HOURLY', min_price: 499, max_price: 2499, keywords: ['payroll setup', 'hr policy'] },
      { name: 'Virtual Assistant', slug: 'virtual-assistant', icon: 'support_agent', default_pricing_type: 'HOURLY', min_price: 199, max_price: 799, keywords: ['email management', 'scheduling'] },
      { name: 'Data Entry', slug: 'data-entry', icon: 'keyboard', default_pricing_type: 'HOURLY', min_price: 149, max_price: 499, keywords: ['excel typing', 'data typing'] }
    ]
  },
  {
    name: 'Healthcare',
    slug: 'healthcare',
    icon: 'medical_services',
    description: 'Doctor Home Visit, Nurse, Physiotherapist, Ambulance & Lab Sample Collection',
    sort_order: 12,
    subcategories: [
      { name: 'Doctor Home Visit', slug: 'doctor-home-visit', icon: 'stethoscope', default_pricing_type: 'FIXED', min_price: 499, max_price: 1999, keywords: ['general physician', 'doctor visit'] },
      { name: 'Nurse', slug: 'nurse-at-home', icon: 'health_and_safety', default_pricing_type: 'HOURLY', min_price: 299, max_price: 1499, keywords: ['dressing', 'injection', 'drip setup'] },
      { name: 'Physiotherapist', slug: 'physiotherapist', icon: 'accessibility_new', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1499, keywords: ['back pain therapy', 'stroke rehab'] },
      { name: 'Ambulance', slug: 'ambulance-service', icon: 'emergency', default_pricing_type: 'FIXED', min_price: 799, max_price: 4999, keywords: ['icu ambulance', 'patient transport'] },
      { name: 'Lab Collection', slug: 'lab-sample-collection', icon: 'science', default_pricing_type: 'FIXED', min_price: 99, max_price: 499, keywords: ['blood test', 'home sample'] },
      { name: 'Elder Care', slug: 'elder-care', icon: 'elderly', default_pricing_type: 'HOURLY', min_price: 249, max_price: 999, keywords: ['senior caretaker', 'elderly help'] },
      { name: 'Baby Care', slug: 'baby-care', icon: 'child_care', default_pricing_type: 'HOURLY', min_price: 199, max_price: 899, keywords: ['nanny', 'baby massage'] }
    ]
  },
  {
    name: 'Pet Services',
    slug: 'pet-services',
    icon: 'pets',
    description: 'Dog Walking, Pet Grooming, Boarding, Training & Vet Visits',
    sort_order: 13,
    subcategories: [
      { name: 'Dog Walking', slug: 'dog-walking', icon: 'directions_walk', default_pricing_type: 'HOURLY', min_price: 149, max_price: 499, keywords: ['pet walker', 'dog exercise'] },
      { name: 'Grooming', slug: 'pet-grooming', icon: 'content_cut', default_pricing_type: 'FIXED', min_price: 399, max_price: 1999, keywords: ['dog bath', 'nail clipping'] },
      { name: 'Boarding', slug: 'pet-boarding', icon: 'night_shelter', default_pricing_type: 'HOURLY', min_price: 299, max_price: 999, keywords: ['pet hostel', 'dog stay'] },
      { name: 'Pet Training', slug: 'pet-training', icon: 'pets', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1499, keywords: ['puppy training', 'dog behavior'] },
      { name: 'Veterinary', slug: 'veterinary-doctor', icon: 'medical_services', default_pricing_type: 'FIXED', min_price: 399, max_price: 1499, keywords: ['vet home visit', 'pet doctor'] },
      { name: 'Pet Taxi', slug: 'pet-taxi', icon: 'local_taxi', default_pricing_type: 'FIXED', min_price: 299, max_price: 1499, keywords: ['pet transport'] }
    ]
  },
  {
    name: 'Food & Catering',
    slug: 'food-catering',
    icon: 'restaurant',
    description: 'Home Cook, Party Catering, Tiffin Services, Bakers & Cloud Kitchens',
    sort_order: 14,
    subcategories: [
      { name: 'Home Cook', slug: 'home-cook', icon: 'soup_kitchen', default_pricing_type: 'HOURLY', min_price: 249, max_price: 999, keywords: ['daily cook', 'maid cook'] },
      { name: 'Catering', slug: 'catering-service', icon: 'dinner_dining', default_pricing_type: 'NEGOTIABLE', min_price: 1999, max_price: 49999, keywords: ['party food', 'buffet'] },
      { name: 'Tiffin', slug: 'tiffin-service', icon: 'lunch_dining', default_pricing_type: 'FIXED', min_price: 99, max_price: 299, keywords: ['daily thali', 'home meals'] },
      { name: 'Baker', slug: 'custom-baker', icon: 'cake', default_pricing_type: 'FIXED', min_price: 399, max_price: 2999, keywords: ['birthday cake', 'custom pastry'] },
      { name: 'Cloud Kitchen', slug: 'cloud-kitchen', icon: 'storefront', default_pricing_type: 'FIXED', min_price: 199, max_price: 999, keywords: ['bulk food order'] }
    ]
  },
  {
    name: 'Events',
    slug: 'events',
    icon: 'festival',
    description: 'DJ, Live Band, Event Planners, Wedding Decorators, Sound & Stage Setup',
    sort_order: 15,
    subcategories: [
      { name: 'DJ', slug: 'event-dj', icon: 'graphic_eq', default_pricing_type: 'HOURLY', min_price: 999, max_price: 9999, keywords: ['party dj', 'wedding dj'] },
      { name: 'Live Band', slug: 'live-band', icon: 'mic', default_pricing_type: 'HOURLY', min_price: 2999, max_price: 24999, keywords: ['orchestra', 'acoustic singer'] },
      { name: 'Event Planner', slug: 'event-planner', icon: 'event', default_pricing_type: 'NEGOTIABLE', min_price: 1999, max_price: 49999, keywords: ['corporate event', 'party manager'] },
      { name: 'Wedding Planner', slug: 'wedding-planner', icon: 'favorite', default_pricing_type: 'NEGOTIABLE', min_price: 4999, max_price: 99999, keywords: ['marriage planner', 'sangeet organizer'] },
      { name: 'Birthday Planner', slug: 'birthday-planner', icon: 'cake', default_pricing_type: 'FIXED', min_price: 999, max_price: 9999, keywords: ['kids party', 'balloon decoration'] },
      { name: 'Decoration', slug: 'event-decoration', icon: 'celebration', default_pricing_type: 'FIXED', min_price: 999, max_price: 14999, keywords: ['flower entrance', 'stage decoration'] },
      { name: 'Sound System', slug: 'sound-system-rental', icon: 'speaker', default_pricing_type: 'FIXED', min_price: 799, max_price: 4999, keywords: ['speakers rental', 'mic rental'] },
      { name: 'Lighting', slug: 'event-lighting', icon: 'light', default_pricing_type: 'FIXED', min_price: 799, max_price: 4999, keywords: ['disco light', 'stage light'] }
    ]
  },
  {
    name: 'Construction',
    slug: 'construction',
    icon: 'construction',
    description: 'Civil Contractors, Architects, Structural Engineers, JCB Rental & Building Materials',
    sort_order: 16,
    subcategories: [
      { name: 'Civil Contractor', slug: 'civil-contractor', icon: 'engineering', default_pricing_type: 'NEGOTIABLE', min_price: 4999, max_price: 99999, keywords: ['building contractor', 'renovation'] },
      { name: 'Architect', slug: 'architect', icon: 'architecture', default_pricing_type: 'NEGOTIABLE', min_price: 1999, max_price: 24999, keywords: ['house map', '3d elevation'] },
      { name: 'Interior Designer', slug: 'interior-designer-pro', icon: 'chair', default_pricing_type: 'NEGOTIABLE', min_price: 1999, max_price: 49999, keywords: ['home interior map'] },
      { name: 'Structural Engineer', slug: 'structural-engineer', icon: 'foundation', default_pricing_type: 'NEGOTIABLE', min_price: 1499, max_price: 19999, keywords: ['building stability test'] },
      { name: 'JCB Rental', slug: 'jcb-rental', icon: 'precision_manufacturing', default_pricing_type: 'HOURLY', min_price: 999, max_price: 4999, keywords: ['excavator', 'earth mover'] },
      { name: 'Building Materials', slug: 'building-materials', icon: 'inventory', default_pricing_type: 'FIXED', min_price: 499, max_price: 49999, keywords: ['cement', 'sand', 'tmt steel'] }
    ]
  },
  {
    name: 'Rentals',
    slug: 'rentals',
    icon: 'key',
    description: 'Car, Bike, Camera, Furniture, Tool & Office Space Rentals',
    sort_order: 17,
    subcategories: [
      { name: 'Car Rental', slug: 'car-rental', icon: 'time_to_leave', default_pricing_type: 'HOURLY', min_price: 799, max_price: 4999, keywords: ['self drive car', 'cab rental'] },
      { name: 'Bike Rental', slug: 'bike-rental', icon: 'two_wheeler', default_pricing_type: 'HOURLY', min_price: 199, max_price: 999, keywords: ['scooter rental', 'bullet rental'] },
      { name: 'Camera Rental', slug: 'camera-rental', icon: 'photo_camera', default_pricing_type: 'HOURLY', min_price: 399, max_price: 2499, keywords: ['dslr lens rental'] },
      { name: 'Furniture Rental', slug: 'furniture-rental', icon: 'bed', default_pricing_type: 'FIXED', min_price: 299, max_price: 1999, keywords: ['sofa rental', 'bed rental'] },
      { name: 'Tool Rental', slug: 'tool-rental', icon: 'handyman', default_pricing_type: 'FIXED', min_price: 149, max_price: 999, keywords: ['drilling machine rental', 'ladder'] },
      { name: 'Office Rental', slug: 'office-rental', icon: 'meeting_room', default_pricing_type: 'NEGOTIABLE', min_price: 1999, max_price: 49999, keywords: ['coworking desk', 'office space'] }
    ]
  },
  {
    name: 'Security',
    slug: 'security',
    icon: 'security',
    description: 'Security Guards, Bouncers, Locksmiths & Fire Safety Services',
    sort_order: 18,
    subcategories: [
      { name: 'Security Guard', slug: 'security-guard', icon: 'local_police', default_pricing_type: 'HOURLY', min_price: 299, max_price: 1499, keywords: ['apartment guard', 'event security'] },
      { name: 'Bouncer', slug: 'bouncer', icon: 'sports_mma', default_pricing_type: 'HOURLY', min_price: 499, max_price: 2499, keywords: ['vip security', 'event bouncer'] },
      { name: 'Locksmith', slug: 'locksmith', icon: 'lock', default_pricing_type: 'FIXED', min_price: 199, max_price: 999, keywords: ['door lock open', 'key duplicate'] },
      { name: 'Fire Safety', slug: 'fire-safety', icon: 'fire_extinguisher', default_pricing_type: 'FIXED', min_price: 399, max_price: 2999, keywords: ['fire extinguisher refill'] }
    ]
  },
  {
    name: 'Care Services',
    slug: 'care-services',
    icon: 'elderly',
    description: 'Babysitters, Maids, Cooks, Drivers & Patient Care Helpers',
    sort_order: 19,
    subcategories: [
      { name: 'Babysitter', slug: 'babysitter', icon: 'child_care', default_pricing_type: 'HOURLY', min_price: 199, max_price: 799, keywords: ['child caretaker', 'nanny'] },
      { name: 'Maid', slug: 'house-maid', icon: 'cleaning_services', default_pricing_type: 'HOURLY', min_price: 199, max_price: 699, keywords: ['sweeping mopping', 'utensil washing'] },
      { name: 'Cook', slug: 'daily-cook', icon: 'soup_kitchen', default_pricing_type: 'HOURLY', min_price: 249, max_price: 899, keywords: ['breakfast cook', 'dinner cook'] },
      { name: 'Driver', slug: 'acting-driver', icon: 'directions_car', default_pricing_type: 'HOURLY', min_price: 249, max_price: 999, keywords: ['personal driver', 'outstation driver'] },
      { name: 'Patient Care', slug: 'patient-care', icon: 'personal_injury', default_pricing_type: 'HOURLY', min_price: 299, max_price: 1199, keywords: ['hospital attendant', 'bedridden care'] },
      { name: 'Live-in Helper', slug: 'live-in-helper', icon: 'house', default_pricing_type: 'NEGOTIABLE', min_price: 4999, max_price: 19999, keywords: ['full time maid'] }
    ]
  },
  {
    name: 'Emergency',
    slug: 'emergency-services',
    icon: 'warning',
    description: '24/7 Emergency Electrician, Plumber, Locksmith, Ambulance & Towing',
    sort_order: 20,
    subcategories: [
      { name: 'Emergency Electrician', slug: 'emergency-electrician', icon: 'bolt', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1999, keywords: ['night electrician', 'power breakdown'] },
      { name: 'Emergency Plumber', slug: 'emergency-plumber', icon: 'plumbing', default_pricing_type: 'HOURLY', min_price: 399, max_price: 1999, keywords: ['burst pipe', 'overflow leak'] },
      { name: 'Ambulance', slug: 'emergency-ambulance', icon: 'emergency', default_pricing_type: 'FIXED', min_price: 799, max_price: 4999, keywords: ['24x7 ambulance', 'hospital transport'] },
      { name: 'Locksmith', slug: 'emergency-locksmith', icon: 'lock_open', default_pricing_type: 'FIXED', min_price: 299, max_price: 1299, keywords: ['locked out', 'car key lock'] },
      { name: 'Generator Repair', slug: 'generator-repair', icon: 'power', default_pricing_type: 'FIXED', min_price: 499, max_price: 2999, keywords: ['dg set repair', 'backup power'] },
      { name: 'Towing', slug: 'emergency-towing', icon: 'car_crash', default_pricing_type: 'FIXED', min_price: 599, max_price: 3999, keywords: ['accident towing', 'highway breakdown'] }
    ]
  },
  {
    name: 'Delivery & Errands',
    slug: 'delivery-errands',
    icon: 'local_mall',
    description: 'Grocery/Medicine Pickup, Document Delivery, Shopping Assistant & Queue Standing',
    sort_order: 21,
    subcategories: [
      { name: 'Grocery Pickup', slug: 'grocery-pickup', icon: 'shopping_cart', default_pricing_type: 'FIXED', min_price: 79, max_price: 399, keywords: ['vegetable pickup', 'store delivery'] },
      { name: 'Medicine Pickup', slug: 'medicine-pickup', icon: 'medication', default_pricing_type: 'FIXED', min_price: 79, max_price: 399, keywords: ['chemist delivery', 'pharma pickup'] },
      { name: 'Document Delivery', slug: 'document-delivery', icon: 'description', default_pricing_type: 'FIXED', min_price: 99, max_price: 499, keywords: ['stamp paper', 'file courier'] },
      { name: 'Shopping Assistant', slug: 'shopping-assistant', icon: 'shopping_bag', default_pricing_type: 'HOURLY', min_price: 149, max_price: 599, keywords: ['market purchase'] },
      { name: 'Queue Standing', slug: 'queue-standing', icon: 'people', default_pricing_type: 'HOURLY', min_price: 149, max_price: 499, keywords: ['line standing', 'token collector'] },
      { name: 'Personal Errands', slug: 'personal-errands', icon: 'task', default_pricing_type: 'HOURLY', min_price: 149, max_price: 599, keywords: ['bill payment', 'key pickup'] }
    ]
  },
  {
    name: 'Industrial Services',
    slug: 'industrial-services',
    icon: 'factory',
    description: 'Machine Repair, Generator Technicians, CNC Operators & Factory Maintenance',
    sort_order: 22,
    subcategories: [
      { name: 'Machine Repair', slug: 'industrial-machine-repair', icon: 'precision_manufacturing', default_pricing_type: 'HOURLY', min_price: 799, max_price: 4999, keywords: ['factory machine', 'hydraulic repair'] },
      { name: 'Generator Technician', slug: 'generator-technician', icon: 'power_input', default_pricing_type: 'HOURLY', min_price: 599, max_price: 3999, keywords: ['heavy generator', 'diesel motor'] },
      { name: 'Factory Technician', slug: 'factory-technician', icon: 'engineering', default_pricing_type: 'HOURLY', min_price: 499, max_price: 2999, keywords: ['plant mechanic', 'conveyor belt'] },
      { name: 'CNC Operator', slug: 'cnc-operator', icon: 'settings_suggest', default_pricing_type: 'HOURLY', min_price: 599, max_price: 3499, keywords: ['lathe machine', 'cnc programming'] },
      { name: 'Boiler Technician', slug: 'boiler-technician', icon: 'whatshot', default_pricing_type: 'HOURLY', min_price: 699, max_price: 4999, keywords: ['steam boiler', 'pressure vessel'] }
    ]
  }
];

async function seedMarketplace() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create normalized tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL UNIQUE,
        slug VARCHAR(100) NOT NULL UNIQUE,
        icon VARCHAR(100),
        description TEXT,
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS marketplace_subcategories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id UUID NOT NULL REFERENCES marketplace_categories(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        icon VARCHAR(100),
        image TEXT,
        description TEXT,
        default_pricing_type VARCHAR(20) DEFAULT 'FIXED',
        min_price NUMERIC(10,2) DEFAULT 0.00,
        max_price NUMERIC(10,2) DEFAULT 0.00,
        keywords TEXT[],
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS worker_skills (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        category_id UUID REFERENCES marketplace_categories(id) ON DELETE CASCADE,
        subcategory_id UUID REFERENCES marketplace_subcategories(id) ON DELETE CASCADE,
        skill_name VARCHAR(100) NOT NULL,
        experience_years INT DEFAULT 1,
        certifications TEXT[],
        hourly_rate NUMERIC(10,2),
        fixed_rate NUMERIC(10,2),
        pricing_type VARCHAR(20) DEFAULT 'HOURLY',
        is_emergency BOOLEAN DEFAULT false,
        experience_level VARCHAR(20) DEFAULT 'INTERMEDIATE',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_worker_subcategory UNIQUE (worker_id, subcategory_id, skill_name)
      );

      CREATE TABLE IF NOT EXISTS service_pricing (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subcategory_id UUID NOT NULL REFERENCES marketplace_subcategories(id) ON DELETE CASCADE UNIQUE,
        pricing_type VARCHAR(20) DEFAULT 'FIXED',
        base_price NUMERIC(10,2) DEFAULT 0.00,
        hourly_rate NUMERIC(10,2) DEFAULT 0.00,
        min_visit_charge NUMERIC(10,2) DEFAULT 149.00,
        emergency_surcharge NUMERIC(10,2) DEFAULT 199.00,
        peak_hour_multiplier NUMERIC(3,2) DEFAULT 1.25,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS category_metadata (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subcategory_id UUID NOT NULL REFERENCES marketplace_subcategories(id) ON DELETE CASCADE UNIQUE,
        ai_keywords TEXT[],
        synonyms TEXT[],
        ranking_weight NUMERIC(3,2) DEFAULT 1.00,
        demand_tier VARCHAR(20) DEFAULT 'NORMAL',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Insert Category Verticals and Subcategories
    for (const cat of CATEGORY_DATA) {
      const catRes = await client.query(`
        INSERT INTO marketplace_categories (name, slug, icon, description, sort_order)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          icon = EXCLUDED.icon,
          description = EXCLUDED.description,
          sort_order = EXCLUDED.sort_order,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id;
      `, [cat.name, cat.slug, cat.icon, cat.description, cat.sort_order]);

      const catId = catRes.rows[0].id;

      for (const sub of cat.subcategories) {
        const subRes = await client.query(`
          INSERT INTO marketplace_subcategories (category_id, name, slug, icon, default_pricing_type, min_price, max_price, keywords)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (slug) DO UPDATE SET
            category_id = EXCLUDED.category_id,
            name = EXCLUDED.name,
            icon = EXCLUDED.icon,
            default_pricing_type = EXCLUDED.default_pricing_type,
            min_price = EXCLUDED.min_price,
            max_price = EXCLUDED.max_price,
            keywords = EXCLUDED.keywords,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id;
        `, [catId, sub.name, sub.slug, sub.icon, sub.default_pricing_type, sub.min_price, sub.max_price, sub.keywords]);

        const subId = subRes.rows[0].id;

        // Pricing default
        await client.query(`
          INSERT INTO service_pricing (subcategory_id, pricing_type, base_price, hourly_rate, min_visit_charge)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (subcategory_id) DO NOTHING;
        `, [subId, sub.default_pricing_type, sub.min_price, sub.min_price, 149.00]);

        // Metadata default for AI search & matching
        await client.query(`
          INSERT INTO category_metadata (subcategory_id, ai_keywords, synonyms)
          VALUES ($1, $2, $3)
          ON CONFLICT (subcategory_id) DO NOTHING;
        `, [subId, sub.keywords, [sub.name.toLowerCase(), cat.name.toLowerCase()]]);
      }
    }

    await client.query('COMMIT');
    console.log(`✅ [SEED_MARKETPLACE] Successfully seeded ${CATEGORY_DATA.length} verticals with all subcategories.`);
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
