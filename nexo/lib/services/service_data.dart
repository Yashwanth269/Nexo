import 'package:flutter/material.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

class ServiceData {
  static final List<Map<String, dynamic>> categories = [
    {
      "name": "Agriculture",
      "icon": FontAwesomeIcons.tractor,
      "image": "assets/images/Agriculture/Equipment Rental/tractor ploughing.jpg",
      "color": Color(0xFF10B981),
      "workers": [
        "Equipment & Machine Rental",
        "Field Work & Labour",
        "Irrigation & Water",
        "Animal & Farm Support",
      ],
      "subcategories": [
        {
          "name": "Equipment & Machine Rental",
          "image": "assets/images/Agriculture/Equipment Rental/tractor tilling.jpg",
          "tasks": [
            {"id": "AGR_EQ_001", "name": "Tractor for ploughing", "image": "assets/images/Agriculture/Equipment Rental/tractor ploughing.jpg"},
            {"id": "AGR_EQ_002", "name": "Tractor for tilling", "image": "assets/images/Agriculture/Equipment Rental/tractor tilling.jpg"},
            {"id": "AGR_EQ_003", "name": "Tractor for harrowing", "image": "assets/images/Agriculture/Equipment Rental/tractor harrowing.png"},
            {"id": "AGR_EQ_004", "name": "Rotavator work", "image": "assets/images/Agriculture/Equipment Rental/rotavator.jpg"},
            {"id": "AGR_EQ_005", "name": "Cultivator work", "image": "assets/images/Agriculture/Equipment Rental/cultivator.webp"},
            {"id": "AGR_EQ_006", "name": "Seed drill / sowing machine", "image": "assets/images/Agriculture/Equipment Rental/Seed-Drill.webp"},
            {"id": "AGR_EQ_007", "name": "Sprayer machine (pesticide/fertilizer)", "image": "assets/images/Agriculture/Equipment Rental/sprayer  machine.avif"},
            {"id": "AGR_EQ_008", "name": "Combine harvester", "image": "assets/images/Agriculture/Equipment Rental/combine harvester.webp"},
            {"id": "AGR_EQ_009", "name": "Thresher", "image": "assets/images/Agriculture/Equipment Rental/thresher.jpeg"},
            {"id": "AGR_EQ_010", "name": "Power weeder", "image": "assets/images/Agriculture/Equipment Rental/power weeder.jpg"},
          ]
        },
        {
          "name": "Field Work & Labour",
          "image": "assets/images/Agriculture/Field Work and Labour/land preparation.webp",
          "tasks": [
            {"id": "AGR_LB_001", "name": "Land preparation", "image": "assets/images/Agriculture/Field Work and Labour/land preparation.webp"},
            {"id": "AGR_LB_002", "name": "Sowing / planting", "image": "assets/images/Agriculture/Field Work and Labour/sowing,planting.jpg"},
            {"id": "AGR_LB_003", "name": "Transplanting (paddy)", "image": "assets/images/Agriculture/Field Work and Labour/transplanting paddy.jpg"},
            {"id": "AGR_LB_004", "name": "Weeding", "image": "assets/images/Agriculture/Field Work and Labour/weeding.jpg"},
            {"id": "AGR_LB_005", "name": "Fertilizer application", "image": "assets/images/Agriculture/Field Work and Labour/fertilizer application.jpg"},
            {"id": "AGR_LB_006", "name": "Pesticide spraying", "image": "assets/images/Agriculture/Field Work and Labour/pesticide spraying.jpg"},
            {"id": "AGR_LB_007", "name": "Harvesting (manual)", "image": "assets/images/Agriculture/Field Work and Labour/harvesting manual"},
            {"id": "AGR_LB_008", "name": "Crop cutting", "image": "assets/images/Agriculture/Field Work and Labour/crop cutting.jpg"},
            {"id": "AGR_LB_009", "name": "Loading crops", "image": "assets/images/Agriculture/Field Work and Labour/landing crops.avif"},
          ]
        },
        {
          "name": "Irrigation & Water",
          "image": "assets/images/Agriculture/Irrigation and water/pump installation.webp",
          "tasks": [
            {"id": "AGR_IR_001", "name": "Borewell drilling", "image": "assets/images/Agriculture/Irrigation and water/borewell drilling.jpg"},
            {"id": "AGR_IR_002", "name": "Pump installation", "image": "assets/images/Agriculture/Irrigation and water/pump installation.webp"},
            {"id": "AGR_IR_003", "name": "Pipe fitting", "image": "assets/images/Agriculture/Irrigation and water/pipe fitting.webp"},
            {"id": "AGR_IR_004", "name": "Drip irrigation setup", "image": "assets/images/Agriculture/Irrigation and water/drip irrigation setup.jpg"},
            {"id": "AGR_IR_005", "name": "Sprinkler setup", "image": "assets/images/Agriculture/Irrigation and water/sprinkler setup.jpg"},
            {"id": "AGR_IR_006", "name": "Motor repair", "image": "assets/images/Agriculture/Irrigation and water/motor repair.webp"},
          ]
        },
        {
          "name": "Animal & Farm Support",
          "image": "assets/images/Agriculture/Animal and farm support/dairy farm helper.jpg",
          "tasks": [
            {"id": "AGR_AS_001", "name": "Dairy farm helper", "image": "assets/images/Agriculture/Animal and farm support/dairy farm helper.jpg"},
            {"id": "AGR_AS_002", "name": "Cow/buffalo caretaker", "image": "assets/images/Agriculture/Animal and farm support/cow buffalo caretaker.webp"},
            {"id": "AGR_AS_003", "name": "Poultry farm worker", "image": "assets/images/Agriculture/Animal and farm support/poultry farm worker.webp"},
            {"id": "AGR_AS_004", "name": "Goat/sheep caretaker", "image": "assets/images/Agriculture/Animal and farm support/goat sheep caretaker.jpg"},
          ]
        },
      ]
    },
    {
      "name": "Construction",
      "icon": FontAwesomeIcons.helmetSafety,
      "image": "assets/images/construction/core work/mason brick work.webp",
      "color": Color(0xFFF97316),
      "workers": [
        "Core Work",
        "Helpers",
        "Finishing Work",
        "Specialised",
      ],
      "subcategories": [
        {
          "name": "Core Work",
          "image": "assets/images/construction/core work/concrete work.jpg",
          "tasks": [
            {"id": "CON_CR_001", "name": "Mason (brick work)", "image": "assets/images/construction/core work/mason brick work.webp"},
            {"id": "CON_CR_002", "name": "Concrete work", "image": "assets/images/construction/core work/concrete work.jpg"},
            {"id": "CON_CR_003", "name": "Foundation work", "image": "assets/images/construction/core work/foundation work.png"},
            {"id": "CON_CR_004", "name": "Slab work", "image": "assets/images/construction/core work/slab work.jpg"},
          ]
        },
        {
          "name": "Helpers",
          "image": "assets/images/construction/helper/general labour.jpg",
          "tasks": [
            {"id": "CON_HL_001", "name": "General labor", "image": "assets/images/construction/helper/general labour.jpg"},
            {"id": "CON_HL_002", "name": "Sand/brick loading", "image": "assets/images/construction/helper/sand or brick loading.webp"},
            {"id": "CON_HL_003", "name": "Cement mixing", "image": "assets/images/construction/helper/cement mixing.webp"},
            {"id": "CON_HL_004", "name": "Site cleaning", "image": "assets/images/construction/helper/site cleaning.jpg"},
          ]
        },
        {
          "name": "Finishing Work",
          "image": "assets/images/construction/finishing work/painter.jpg",
          "tasks": [
            {"id": "CON_FN_001", "name": "Painter", "image": "assets/images/construction/finishing work/painter.jpg"},
            {"id": "CON_FN_002", "name": "Putty work", "image": "assets/images/construction/finishing work/putty work.jpg"},
            {"id": "CON_FN_003", "name": "Tiles laying", "image": "assets/images/construction/finishing work/tiles laying.webp"},
            {"id": "CON_FN_004", "name": "Granite work", "image": "assets/images/construction/finishing work/granite work.jpg"},
            {"id": "CON_FN_005", "name": "POP / false ceiling", "image": "assets/images/construction/finishing work/pop or false ceiling.webp"},
          ]
        },
        {
          "name": "Specialised",
          "image": "assets/images/construction/specialised/scaffolding.jpg",
          "tasks": [
            {"id": "CON_SP_001", "name": "Steel binding", "image": "assets/images/construction/specialised/steel binding.webp"},
            {"id": "CON_SP_002", "name": "Centering/shuttering", "image": "assets/images/construction/specialised/centering or shuttering.jpg"},
            {"id": "CON_SP_003", "name": "Scaffolding", "image": "assets/images/construction/specialised/scaffolding.jpg"},
          ]
        },
      ]
    },
    {
      "name": "Home Services",
      "icon": FontAwesomeIcons.houseUser,
      "image": "assets/images/home services/cleaning/full house cleaner.jpeg",
      "color": Color(0xFF3B82F6),
      "workers": ["Electrical", "Plumbing", "Appliance Repair", "Cleaning"],
      "subcategories": [
        {
          "name": "Electrical",
          "image": "assets/images/home services/electrical/wiring.webp",
          "tasks": [
            {"id": "HOM_EL_001", "name": "Switch repair", "image": "assets/images/home services/electrical/switch repair.webp"},
            {"id": "HOM_EL_002", "name": "Fan installation", "image": "assets/images/home services/electrical/fan installation.webp"},
            {"id": "HOM_EL_003", "name": "Light fitting", "image": "assets/images/home services/electrical/light fitting.jpg"},
            {"id": "HOM_EL_004", "name": "Wiring", "image": "assets/images/home services/electrical/wiring.webp"},
            {"id": "HOM_EL_005", "name": "Inverter setup", "image": "assets/images/home services/electrical/inverter setup.jpg"},
            {"id": "HOM_EL_006", "name": "Meter repair", "image": "assets/images/home services/electrical/meter repair.avif"}
          ]
        },
        {
          "name": "Plumbing",
          "image": "assets/images/home services/plumbing/tap repair.jpg",
          "tasks": [
            {"id": "HOM_PL_001", "name": "Pipe leakage", "image": "assets/images/home services/plumbing/pipe leakage.webp"},
            {"id": "HOM_PL_002", "name": "Tap repair", "image": "assets/images/home services/plumbing/tap repair.jpg"},
            {"id": "HOM_PL_003", "name": "Tank cleaning", "image": "assets/images/home services/plumbing/tank cleaning.webp"},
            {"id": "HOM_PL_004", "name": "Motor repair", "image": "assets/images/home services/plumbing/motor repair.jpg"},
            {"id": "HOM_PL_005", "name": "Bathroom fittings", "image": "assets/images/home services/plumbing/bathroom fitting.jpg"}
          ]
        },
        {
          "name": "Appliance Repair",
          "image": "assets/images/home services/appliance repair/ac repair.jpg",
          "tasks": [
            {"id": "HOM_AR_001", "name": "Refrigerator repair", "image": "assets/images/home services/appliance repair/refrigerator repair.webp"},
            {"id": "HOM_AR_002", "name": "Washing machine repair", "image": "assets/images/home services/appliance repair/washing machine repair.jpg"},
            {"id": "HOM_AR_003", "name": "AC repair", "image": "assets/images/home services/appliance repair/ac repair.jpg"},
            {"id": "HOM_AR_004", "name": "Microwave repair", "image": "assets/images/home services/appliance repair/microwave repair.webp"},
            {"id": "HOM_AR_005", "name": "TV repair", "image": "assets/images/home services/appliance repair/tv repair.jpg"}
          ]
        },
        {
          "name": "Cleaning",
          "image": "assets/images/home services/cleaning/full house cleaner.jpeg",
          "tasks": [
            {"id": "HOM_CL_001", "name": "Full house cleaning", "image": "assets/images/home services/cleaning/full house cleaner.jpeg"},
            {"id": "HOM_CL_002", "name": "Kitchen cleaning", "image": "assets/images/home services/cleaning/kitchen cleaner.avif"},
            {"id": "HOM_CL_003", "name": "Bathroom cleaning", "image": "assets/images/home services/cleaning/bathroom cleaner.avif"},
            {"id": "HOM_CL_004", "name": "Sofa cleaning", "image": "assets/images/home services/cleaning/sofa cleaner.webp"},
            {"id": "HOM_CL_005", "name": "Water tank cleaning", "image": "assets/images/home services/cleaning/water tank cleaning.jpg"}
          ]
        }
      ]
    },
    {
      "name": "Transport",
      "icon": FontAwesomeIcons.truckMoving,
      "image": "assets/images/transport/vehicles/pickup vehicle.webp",
      "color": Color(0xFF8B5CF6),
      "workers": ["Vehicles", "Moving", "Support", "Drivers"],
      "subcategories": [
        {
          "name": "Vehicles",
          "image": "assets/images/transport/vehicles/mini truck.avif",
          "tasks": [
            {"id": "TRA_VH_001", "name": "Mini truck rental", "image": "assets/images/transport/vehicles/mini truck.avif"},
            {"id": "TRA_VH_002", "name": "Pickup vehicle", "image": "assets/images/transport/vehicles/pickup vehicle.webp"},
            {"id": "TRA_VH_003", "name": "Tractor transport", "image": "assets/images/transport/vehicles/tractor transport.png"}
          ]
        },
        {
          "name": "Moving",
          "image": "assets/images/transport/moving/house shifting.webp",
          "tasks": [
            {"id": "TRA_MV_001", "name": "House shifting", "image": "assets/images/transport/moving/house shifting.webp"},
            {"id": "TRA_MV_002", "name": "Office shifting", "image": "assets/images/transport/moving/office shifting.png"},
            {"id": "TRA_MV_003", "name": "Furniture moving", "image": "assets/images/transport/moving/furniture moving.jpg"}
          ]
        },
        {
          "name": "Support",
          "image": "assets/images/transport/support/loading labour.jpeg",
          "tasks": [
            {"id": "TRA_SP_001", "name": "Loading labor", "image": "assets/images/transport/support/loading labour.jpeg"},
            {"id": "TRA_SP_002", "name": "Unloading labor", "image": "assets/images/transport/support/unloading labour.avif"},
            {"id": "TRA_SP_003", "name": "Packing help", "image": "assets/images/transport/support/packing helper.jpg"}
          ]
        },
        {
          "name": "Drivers",
          "image": "assets/images/transport/drivers/personal driver.webp",
          "tasks": [
            {"id": "TRA_DR_001", "name": "Personal driver", "image": "assets/images/transport/drivers/personal driver.webp"},
            {"id": "TRA_DR_002", "name": "Commercial driver", "image": "assets/images/transport/drivers/commercial driver.avif"},
            {"id": "TRA_DR_003", "name": "Tractor driver", "image": "assets/images/transport/drivers/tractor driver.avif"}
          ]
        }
      ]
    },
    {
      "name": "Mechanic",
      "icon": FontAwesomeIcons.wrench,
      "image": "assets/images/mechanic/vehicle repair/bike repair.webp",
      "color": Color(0xFFEF4444),
      "workers": ["Vehicle Repair", "General Repair"],
      "subcategories": [
        {
          "name": "Vehicle Repair",
          "image": "assets/images/mechanic/vehicle repair/car repair.webp",
          "tasks": [
            {"id": "MEC_VR_001", "name": "Bike repair", "image": "assets/images/mechanic/vehicle repair/bike repair.webp"},
            {"id": "MEC_VR_002", "name": "Car repair", "image": "assets/images/mechanic/vehicle repair/car repair.webp"},
            {"id": "MEC_VR_003", "name": "Tractor repair", "image": "assets/images/mechanic/vehicle repair/tractor repair.webp"}
          ]
        },
        {
          "name": "General Repair",
          "image": "assets/images/mechanic/general repair/engine repair.jpg",
          "tasks": [
            {"id": "MEC_GR_001", "name": "Engine repair", "image": "assets/images/mechanic/general repair/engine repair.jpg"},
            {"id": "MEC_GR_002", "name": "Brake repair", "image": "assets/images/mechanic/general repair/brake repair.jpg"},
            {"id": "MEC_GR_003", "name": "Electrical repair", "image": "assets/images/mechanic/general repair/electrical repair.jpg"},
            {"id": "MEC_GR_004", "name": "Tyre puncture", "image": "assets/images/mechanic/general repair/tyre puncture.jpg"}
          ]
        }
      ]
    },
    {
      "name": "Household",
      "icon": FontAwesomeIcons.handsHoldingChild,
      "image": "assets/images/household/care and help/maid.jpg",
      "color": Color(0xFFEC4899),
      "workers": ["Care & Help"],
      "subcategories": [
        {
          "name": "Care & Help",
          "image": "assets/images/household/care and help/cook.jpg",
          "tasks": [
            {"id": "HOU_CH_001", "name": "Maid", "image": "assets/images/household/care and help/maid.jpg"},
            {"id": "HOU_CH_002", "name": "Cook", "image": "assets/images/household/care and help/cook.jpg"},
            {"id": "HOU_CH_003", "name": "Babysitter", "image": "assets/images/household/care and help/babysitter.png"},
            {"id": "HOU_CH_004", "name": "Elder care", "image": "assets/images/household/care and help/elder care.webp"},
            {"id": "HOU_CH_005", "name": "Laundry", "image": "assets/images/household/care and help/laundry.webp"}
          ]
        }
      ]
    },
    {
      "name": "Shops",
      "icon": FontAwesomeIcons.store,
      "image": "assets/images/shops/business help/sales assistant.jpg",
      "color": Color(0xFF14B8A6),
      "workers": ["Business Help"],
      "subcategories": [
        {
          "name": "Business Help",
          "image": "assets/images/shops/business help/store keeper.jpg",
          "tasks": [
            {"id": "SHO_BH_001", "name": "Shop helper", "image": "assets/images/shops/business help/shop helper.avif"},
            {"id": "SHO_BH_002", "name": "Sales assistant", "image": "assets/images/shops/business help/sales assistant.jpg"},
            {"id": "SHO_BH_003", "name": "Billing operator", "image": "assets/images/shops/business help/billing operator.webp"},
            {"id": "SHO_BH_004", "name": "Store keeper", "image": "assets/images/shops/business help/store keeper.jpg"}
          ]
        }
      ]
    },
    {
      "name": "Delivery",
      "icon": FontAwesomeIcons.boxOpen,
      "image": "assets/images/delivery/errands/parcel delivery.jpg",
      "color": Color(0xFF6366F1),
      "workers": ["Errands"],
      "subcategories": [
        {
          "name": "Errands",
          "image": "assets/images/delivery/errands/parcel delivery.jpg",
          "tasks": [
            {"id": "DEL_ER_001", "name": "Parcel delivery", "image": "assets/images/delivery/errands/parcel delivery.jpg"},
            {"id": "DEL_ER_002", "name": "Grocery pickup", "image": "assets/images/delivery/errands/grocery pickup.webp"},
            {"id": "DEL_ER_003", "name": "Medicine pickup", "image": "assets/images/delivery/errands/medicine pickup.jpg"},
            {"id": "DEL_ER_004", "name": "Document delivery", "image": "assets/images/delivery/errands/document delivery.jpg"}
          ]
        }
      ]
    },
    {
      "name": "Events",
      "icon": FontAwesomeIcons.cakeCandles,
      "image": "assets/images/events/event staff/sound or light setup.jpg",
      "color": Color(0xFFEAB308),
      "workers": ["Event Staff"],
      "subcategories": [
        {
          "name": "Event Staff",
          "image": "assets/images/events/event staff/catering staff.webp",
          "tasks": [
            {"id": "EVE_ES_001", "name": "Event helpers", "image": "assets/images/events/event staff/event helpers.avif"},
            {"id": "EVE_ES_002", "name": "Catering staff", "image": "assets/images/events/event staff/catering staff.webp"},
            {"id": "EVE_ES_003", "name": "Decoration setup", "image": "assets/images/events/event staff/decoration setup.avif"},
            {"id": "EVE_ES_004", "name": "Sound/light setup", "image": "assets/images/events/event staff/sound or light setup.jpg"}
          ]
        }
      ]
    },
    {
      "name": "Skilled",
      "icon": FontAwesomeIcons.screwdriverWrench,
      "image": "assets/images/skilled/trades/ac technician.jpg",
      "color": Color(0xFF78716C),
      "workers": ["Trades"],
      "subcategories": [
        {
          "name": "Trades",
          "image": "assets/images/skilled/trades/carpenter.webp",
          "tasks": [
            {"id": "SKI_TR_001", "name": "Carpenter", "image": "assets/images/skilled/trades/carpenter.webp"},
            {"id": "SKI_TR_002", "name": "Welder", "image": "assets/images/skilled/trades/welder.png"},
            {"id": "SKI_TR_003", "name": "Electric motor technician", "image": "assets/images/skilled/trades/electric motor technician.jpg"},
            {"id": "SKI_TR_004", "name": "AC technician", "image": "assets/images/skilled/trades/ac technician.jpg"}
          ]
        }
      ]
    },
    {
      "name": "Smart Tech",
      "icon": FontAwesomeIcons.solarPanel,
      "image": "assets/images/smart tech/installation/solar panel installation.jpg",
      "color": Color(0xFF22C55E),
      "workers": ["Installation"],
      "subcategories": [
        {
          "name": "Installation",
          "image": "assets/images/smart tech/installation/cctv installation.png",
          "tasks": [
            {"id": "SMA_IN_001", "name": "Solar panel installation", "image": "assets/images/smart tech/installation/solar panel installation.jpg"},
            {"id": "SMA_IN_002", "name": "CCTV installation", "image": "assets/images/smart tech/installation/cctv installation.png"},
            {"id": "SMA_IN_003", "name": "Internet setup", "image": "assets/images/smart tech/installation/internet setup.jpg"}
          ]
        }
      ]
    },
  ];
}
