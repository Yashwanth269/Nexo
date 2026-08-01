import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/material.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

class ServiceData {
  // S3 base URL for job images
  static const String s3Base = 'https://nexoassets.s3.ap-south-1.amazonaws.com/images';
  static String s3Url(String name, String ratio) =>
      '$s3Base/$ratio/${Uri.encodeComponent(name)}2.jpeg';

  static final List<Map<String, dynamic>> categories = [
    {
      "name": "Home Care",
      "icon": FontAwesomeIcons.house,
      "image": s3Url("House Cleaning", "16:9"),
      "color": const Color(0xFF3B82F6),
      "emoji": "🏡",
      "slug": "home-care",
      "workers": ["Home Care"],
      "subcategories": [
        {
          "name": "Home Care",
          "image": s3Url("House Cleaning", "1:1"),
          "tasks": [
            {"name": "House Cleaning", "image": s3Url("House Cleaning", "1:1"), "image16x9": s3Url("House Cleaning", "16:9"), "isTeamJob": false},
            {"name": "Deep Cleaning", "image": s3Url("Deep Cleaning", "1:1"), "image16x9": s3Url("Deep Cleaning", "16:9"), "isTeamJob": false},
            {"name": "Home Cook", "image": s3Url("Home Cook", "1:1"), "image16x9": s3Url("Home Cook", "16:9"), "isTeamJob": false},
            {"name": "Babysitter", "image": s3Url("Babysitter", "1:1"), "image16x9": s3Url("Babysitter", "16:9"), "isTeamJob": false},
            {"name": "Elder Care", "image": s3Url("Elder Care", "1:1"), "image16x9": s3Url("Elder Care", "16:9"), "isTeamJob": false},
            {"name": "Home Nurse", "image": s3Url("Home Nurse", "1:1"), "image16x9": s3Url("Home Nurse", "16:9"), "isTeamJob": false},
            {"name": "Laundry", "image": s3Url("Laundry", "1:1"), "image16x9": s3Url("Laundry", "16:9"), "isTeamJob": false},
            {"name": "Ironing", "image": s3Url("Ironing", "1:1"), "image16x9": s3Url("Ironing", "16:9"), "isTeamJob": false},
            {"name": "Housekeeping", "image": s3Url("Housekeeping", "1:1"), "image16x9": s3Url("Housekeeping", "16:9"), "isTeamJob": false},
            {"name": "Maid (Full Time)", "image": s3Url("Maid (Full Time)", "1:1"), "image16x9": s3Url("Maid (Full Time)", "16:9"), "isTeamJob": false},
            {"name": "Maid (Part Time)", "image": s3Url("Maid (Part Time)", "1:1"), "image16x9": s3Url("Maid (Part Time)", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Home Repair",
      "icon": FontAwesomeIcons.hammer,
      "image": s3Url("Electrician", "16:9"),
      "color": const Color(0xFFF97316),
      "emoji": "🔨",
      "slug": "home-repair",
      "workers": ["Electrical", "Plumbing", "Carpentry", "Masonry", "Others"],
      "subcategories": [
        {
          "name": "Electrical",
          "image": s3Url("Electrician", "1:1"),
          "tasks": [
            {"name": "Electrician", "image": s3Url("Electrician", "1:1"), "image16x9": s3Url("Electrician", "16:9"), "isTeamJob": false},
            {"name": "Switch Repair", "image": s3Url("Switch Repair", "1:1"), "image16x9": s3Url("Switch Repair", "16:9"), "isTeamJob": false},
            {"name": "Wiring Repair", "image": s3Url("Wiring Repair", "1:1"), "image16x9": s3Url("Wiring Repair", "16:9"), "isTeamJob": false},
            {"name": "MCB Repair", "image": s3Url("MCB Repair", "1:1"), "image16x9": s3Url("MCB Repair", "16:9"), "isTeamJob": false},
            {"name": "Inverter Repair", "image": s3Url("Inverter Repair", "1:1"), "image16x9": s3Url("Inverter Repair", "16:9"), "isTeamJob": false},
          ]
        },
        {
          "name": "Plumbing",
          "image": s3Url("Plumber", "1:1"),
          "tasks": [
            {"name": "Plumber", "image": s3Url("Plumber", "1:1"), "image16x9": s3Url("Plumber", "16:9"), "isTeamJob": false},
            {"name": "Tap Repair", "image": s3Url("Tap Repair", "1:1"), "image16x9": s3Url("Tap Repair", "16:9"), "isTeamJob": false},
            {"name": "Pipe Leakage", "image": s3Url("Pipe Leakage", "1:1"), "image16x9": s3Url("Pipe Leakage", "16:9"), "isTeamJob": false},
            {"name": "Drain Blockage", "image": s3Url("Drain Blockage", "1:1"), "image16x9": s3Url("Drain Blockage", "16:9"), "isTeamJob": false},
            {"name": "Toilet Repair", "image": s3Url("Toilet Repair", "1:1"), "image16x9": s3Url("Toilet Repair", "16:9"), "isTeamJob": false},
          ]
        },
        {
          "name": "Carpentry",
          "image": s3Url("Carpenter", "1:1"),
          "tasks": [
            {"name": "Carpenter", "image": s3Url("Carpenter", "1:1"), "image16x9": s3Url("Carpenter", "16:9"), "isTeamJob": false},
            {"name": "Furniture Repair", "image": s3Url("Furniture Repair", "1:1"), "image16x9": s3Url("Furniture Repair", "16:9"), "isTeamJob": false},
            {"name": "Door Repair", "image": s3Url("Door Repair", "1:1"), "image16x9": s3Url("Door Repair", "16:9"), "isTeamJob": false},
            {"name": "Window Repair", "image": s3Url("Window Repair", "1:1"), "image16x9": s3Url("Window Repair", "16:9"), "isTeamJob": false},
            {"name": "Lock Repair", "image": s3Url("Lock Repair", "1:1"), "image16x9": s3Url("Lock Repair", "16:9"), "isTeamJob": false},
          ]
        },
        {
          "name": "Masonry",
          "image": s3Url("Mason", "1:1"),
          "tasks": [
            {"name": "Mason", "image": s3Url("Mason", "1:1"), "image16x9": s3Url("Mason", "16:9"), "isTeamJob": false},
            {"name": "Tile Repair", "image": s3Url("Tile Repair", "1:1"), "image16x9": s3Url("Tile Repair", "16:9"), "isTeamJob": false},
            {"name": "Marble Repair", "image": s3Url("Marble Repair", "1:1"), "image16x9": s3Url("Marble Repair", "16:9"), "isTeamJob": false},
            {"name": "Granite Repair", "image": s3Url("Granite Repair", "1:1"), "image16x9": s3Url("Granite Repair", "16:9"), "isTeamJob": false},
            {"name": "POP Repair", "image": s3Url("POP Repair", "1:1"), "image16x9": s3Url("POP Repair", "16:9"), "isTeamJob": false},
            {"name": "Roof Repair", "image": s3Url("Roof Repair", "1:1"), "image16x9": s3Url("Roof Repair", "16:9"), "isTeamJob": false},
            {"name": "Waterproofing", "image": s3Url("Waterproofing", "1:1"), "image16x9": s3Url("Waterproofing", "16:9"), "isTeamJob": false},
          ]
        },
        {
          "name": "Others",
          "image": s3Url("Welder", "1:1"),
          "tasks": [
            {"name": "Welder", "image": s3Url("Welder", "1:1"), "image16x9": s3Url("Welder", "16:9"), "isTeamJob": false},
            {"name": "Glass Repair", "image": s3Url("Glass Repair", "1:1"), "image16x9": s3Url("Glass Repair", "16:9"), "isTeamJob": false},
            {"name": "Pest Control", "image": s3Url("Pest Control", "1:1"), "image16x9": s3Url("Pest Control", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Installation Services",
      "icon": FontAwesomeIcons.screwdriverWrench,
      "image": s3Url("AC Installation", "16:9"),
      "color": const Color(0xFF06B6D4),
      "emoji": "🛠️",
      "slug": "installation-services",
      "workers": ["Installation"],
      "subcategories": [
        {
          "name": "Installation",
          "image": s3Url("AC Installation", "1:1"),
          "tasks": [
            {"name": "AC Installation", "image": s3Url("AC Installation", "1:1"), "image16x9": s3Url("AC Installation", "16:9"), "isTeamJob": false},
            {"name": "TV Installation", "image": s3Url("TV Installation", "1:1"), "image16x9": s3Url("TV Installation", "16:9"), "isTeamJob": false},
            {"name": "Geyser Installation", "image": s3Url("Geyser Installation", "1:1"), "image16x9": s3Url("Geyser Installation", "16:9"), "isTeamJob": false},
            {"name": "RO Installation", "image": s3Url("RO Installation", "1:1"), "image16x9": s3Url("RO Installation", "16:9"), "isTeamJob": false},
            {"name": "Fan Installation", "image": s3Url("Fan Installation", "1:1"), "image16x9": s3Url("Fan Installation", "16:9"), "isTeamJob": false},
            {"name": "Chimney Installation", "image": s3Url("Chimney Installation", "1:1"), "image16x9": s3Url("Chimney Installation", "16:9"), "isTeamJob": false},
            {"name": "Washing Machine Installation", "image": s3Url("Washing Machine Installation", "1:1"), "image16x9": s3Url("Washing Machine Installation", "16:9"), "isTeamJob": false},
            {"name": "CCTV Installation", "image": s3Url("CCTV Installation", "1:1"), "image16x9": s3Url("CCTV Installation", "16:9"), "isTeamJob": false},
            {"name": "Intercom Installation", "image": s3Url("Intercom Installation", "1:1"), "image16x9": s3Url("Intercom Installation", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Appliance Repair",
      "icon": FontAwesomeIcons.wrench,
      "image": s3Url("AC Repair", "16:9"),
      "color": const Color(0xFFEF4444),
      "emoji": "🔧",
      "slug": "appliance-repair",
      "workers": ["Appliance Repair"],
      "subcategories": [
        {
          "name": "Appliance Repair",
          "image": s3Url("AC Repair", "1:1"),
          "tasks": [
            {"name": "AC Repair", "image": s3Url("AC Repair", "1:1"), "image16x9": s3Url("AC Repair", "16:9"), "isTeamJob": false},
            {"name": "AC Technician", "image": s3Url("AC Technician", "1:1"), "image16x9": s3Url("AC Technician", "16:9"), "isTeamJob": false},
            {"name": "Refrigerator Repair", "image": s3Url("Refrigerator Repair", "1:1"), "image16x9": s3Url("Refrigerator Repair", "16:9"), "isTeamJob": false},
            {"name": "Washing Machine Repair", "image": s3Url("Washing Machine Repair", "1:1"), "image16x9": s3Url("Washing Machine Repair", "16:9"), "isTeamJob": false},
            {"name": "TV Repair", "image": s3Url("TV Repair", "1:1"), "image16x9": s3Url("TV Repair", "16:9"), "isTeamJob": false},
            {"name": "Microwave Repair", "image": s3Url("Microwave Repair", "1:1"), "image16x9": s3Url("Microwave Repair", "16:9"), "isTeamJob": false},
            {"name": "Geyser Repair", "image": s3Url("Geyser Repair", "1:1"), "image16x9": s3Url("Geyser Repair", "16:9"), "isTeamJob": false},
            {"name": "RO Repair", "image": s3Url("RO Repair", "1:1"), "image16x9": s3Url("RO Repair", "16:9"), "isTeamJob": false},
            {"name": "Chimney Repair", "image": s3Url("Chimney Repair", "1:1"), "image16x9": s3Url("Chimney Repair", "16:9"), "isTeamJob": false},
            {"name": "Mixer Grinder Repair", "image": s3Url("Mixer Grinder Repair", "1:1"), "image16x9": s3Url("Mixer Grinder Repair", "16:9"), "isTeamJob": false},
            {"name": "Laptop Repair", "image": s3Url("Laptop Repair", "1:1"), "image16x9": s3Url("Laptop Repair", "16:9"), "isTeamJob": false},
            {"name": "Mobile Repair", "image": s3Url("Mobile Repair", "1:1"), "image16x9": s3Url("Mobile Repair", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Automotive Services",
      "icon": FontAwesomeIcons.car,
      "image": s3Url("Car Mechanic", "16:9"),
      "color": const Color(0xFF8B5CF6),
      "emoji": "🚗",
      "slug": "automotive-services",
      "workers": ["Two Wheeler", "Four Wheeler", "Others"],
      "subcategories": [
        {
          "name": "Two Wheeler",
          "image": s3Url("Bike Mechanic", "1:1"),
          "tasks": [
            {"name": "Bike Mechanic", "image": s3Url("Bike Mechanic", "1:1"), "image16x9": s3Url("Bike Mechanic", "16:9"), "isTeamJob": false},
            {"name": "Bike Puncture", "image": s3Url("Bike Puncture", "1:1"), "image16x9": s3Url("Bike Puncture", "16:9"), "isTeamJob": false},
            {"name": "Bike Wash", "image": s3Url("Bike Wash", "1:1"), "image16x9": s3Url("Bike Wash", "16:9"), "isTeamJob": false},
            {"name": "Bike Battery", "image": s3Url("Bike Battery", "1:1"), "image16x9": s3Url("Bike Battery", "16:9"), "isTeamJob": false},
          ]
        },
        {
          "name": "Four Wheeler",
          "image": s3Url("Car Mechanic", "1:1"),
          "tasks": [
            {"name": "Car Mechanic", "image": s3Url("Car Mechanic", "1:1"), "image16x9": s3Url("Car Mechanic", "16:9"), "isTeamJob": false},
            {"name": "Car Wash", "image": s3Url("Car Wash", "1:1"), "image16x9": s3Url("Car Wash", "16:9"), "isTeamJob": false},
            {"name": "Car Detailing", "image": s3Url("Car Detailing", "1:1"), "image16x9": s3Url("Car Detailing", "16:9"), "isTeamJob": false},
            {"name": "Car Battery", "image": s3Url("Car Battery", "1:1"), "image16x9": s3Url("Car Battery", "16:9"), "isTeamJob": false},
            {"name": "Car Tyre", "image": s3Url("Car Tyre", "1:1"), "image16x9": s3Url("Car Tyre", "16:9"), "isTeamJob": false},
            {"name": "Dent & Paint", "image": s3Url("Dent & Paint", "1:1"), "image16x9": s3Url("Dent & Paint", "16:9"), "isTeamJob": false},
          ]
        },
        {
          "name": "Others",
          "image": s3Url("Towing", "1:1"),
          "tasks": [
            {"name": "Towing", "image": s3Url("Towing", "1:1"), "image16x9": s3Url("Towing", "16:9"), "isTeamJob": false},
            {"name": "Auto Mechanic", "image": s3Url("Auto Mechanic", "1:1"), "image16x9": s3Url("Auto Mechanic", "16:9"), "isTeamJob": false},
            {"name": "Fuel Delivery", "image": s3Url("Fuel Delivery", "1:1"), "image16x9": s3Url("Fuel Delivery", "16:9"), "isTeamJob": false},
            {"name": "Tractor Mechanic", "image": s3Url("Tractor Mechanic", "1:1"), "image16x9": s3Url("Tractor Mechanic", "16:9"), "isTeamJob": false},
            {"name": "Roadside Assistance", "image": s3Url("Roadside Assistance", "1:1"), "image16x9": s3Url("Roadside Assistance", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Construction & Labour",
      "icon": FontAwesomeIcons.helmetSafety,
      "image": s3Url("House Painting", "16:9"),
      "color": const Color(0xFFD97706),
      "emoji": "🏗️",
      "slug": "construction-labour",
      "workers": ["Construction & Labour"],
      "subcategories": [
        {
          "name": "Construction & Labour",
          "image": s3Url("House Painting", "1:1"),
          "tasks": [
            {"name": "House Painting", "image": s3Url("House Painting", "1:1"), "image16x9": s3Url("House Painting", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Construction Labour", "image": s3Url("Construction Labour", "1:1"), "image16x9": s3Url("Construction Labour", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Centering Work", "image": s3Url("Centering Work", "1:1"), "image16x9": s3Url("Centering Work", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Steel Binding", "image": s3Url("Steel Binding", "1:1"), "image16x9": s3Url("Steel Binding", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Slab Work", "image": s3Url("Slab Work", "1:1"), "image16x9": s3Url("Slab Work", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Civil Contractor", "image": s3Url("Civil Contractor", "1:1"), "image16x9": s3Url("Civil Contractor", "16:9"), "isTeamJob": false},
            {"name": "Architect", "image": s3Url("Architect", "1:1"), "image16x9": s3Url("Architect", "16:9"), "isTeamJob": false},
            {"name": "Interior Designer", "image": s3Url("Interior Designer", "1:1"), "image16x9": s3Url("Interior Designer", "16:9"), "isTeamJob": false},
            {"name": "Scaffolding", "image": s3Url("Scaffolding", "1:1"), "image16x9": s3Url("Scaffolding", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "JCB Rental", "image": s3Url("JCB Rental", "1:1"), "image16x9": s3Url("JCB Rental", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Agriculture",
      "icon": FontAwesomeIcons.tractor,
      "image": s3Url("Tractor Work", "16:9"),
      "color": const Color(0xFF10B981),
      "emoji": "🌾",
      "slug": "agriculture",
      "workers": ["Agriculture"],
      "subcategories": [
        {
          "name": "Agriculture",
          "image": s3Url("Tractor Work", "1:1"),
          "tasks": [
            {"name": "Farm Labour", "image": s3Url("Farm Labour", "1:1"), "image16x9": s3Url("Farm Labour", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Tractor Work", "image": s3Url("Tractor Work", "1:1"), "image16x9": s3Url("Tractor Work", "16:9"), "isTeamJob": false},
            {"name": "Harvesting", "image": s3Url("Harvesting", "1:1"), "image16x9": s3Url("Harvesting", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Sowing", "image": s3Url("Sowing", "1:1"), "image16x9": s3Url("Sowing", "16:9"), "isTeamJob": false},
            {"name": "Irrigation Work", "image": s3Url("Irrigation Work", "1:1"), "image16x9": s3Url("Irrigation Work", "16:9"), "isTeamJob": false},
            {"name": "Pesticide Spraying", "image": s3Url("Pesticide Spraying", "1:1"), "image16x9": s3Url("Pesticide Spraying", "16:9"), "isTeamJob": false},
            {"name": "Animal Care", "image": s3Url("Animal Care", "1:1"), "image16x9": s3Url("Animal Care", "16:9"), "isTeamJob": false},
            {"name": "Equipment Rental", "image": s3Url("Equipment Rental", "1:1"), "image16x9": s3Url("Equipment Rental", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Beauty & Wellness",
      "icon": FontAwesomeIcons.spa,
      "image": s3Url("Salon at Home", "16:9"),
      "color": const Color(0xFFEC4899),
      "emoji": "💇",
      "slug": "beauty-wellness",
      "workers": ["Beauty & Wellness"],
      "subcategories": [
        {
          "name": "Beauty & Wellness",
          "image": s3Url("Salon at Home", "1:1"),
          "tasks": [
            {"name": "Barber", "image": s3Url("Barber", "1:1"), "image16x9": s3Url("Barber", "16:9"), "isTeamJob": false},
            {"name": "Salon at Home", "image": s3Url("Salon at Home", "1:1"), "image16x9": s3Url("Salon at Home", "16:9"), "isTeamJob": false},
            {"name": "Makeup Artist", "image": s3Url("Makeup Artist", "1:1"), "image16x9": s3Url("Makeup Artist", "16:9"), "isTeamJob": false},
            {"name": "Mehendi Artist", "image": s3Url("Mehendi Artist", "1:1"), "image16x9": s3Url("Mehendi Artist", "16:9"), "isTeamJob": false},
            {"name": "Massage", "image": s3Url("Massage", "1:1"), "image16x9": s3Url("Massage", "16:9"), "isTeamJob": false},
            {"name": "Spa", "image": s3Url("Spa", "1:1"), "image16x9": s3Url("Spa", "16:9"), "isTeamJob": false},
            {"name": "Personal Trainer", "image": s3Url("Personal Trainer", "1:1"), "image16x9": s3Url("Personal Trainer", "16:9"), "isTeamJob": false},
            {"name": "Yoga Trainer", "image": s3Url("Yoga Trainer", "1:1"), "image16x9": s3Url("Yoga Trainer", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Event Services",
      "icon": FontAwesomeIcons.champagneGlasses,
      "image": s3Url("Event Helpers", "16:9"),
      "color": const Color(0xFFEAB308),
      "emoji": "🎉",
      "slug": "event-services",
      "workers": ["Event Services"],
      "subcategories": [
        {
          "name": "Event Services",
          "image": s3Url("Event Helpers", "1:1"),
          "tasks": [
            {"name": "Event Helpers", "image": s3Url("Event Helpers", "1:1"), "image16x9": s3Url("Event Helpers", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Catering Staff", "image": s3Url("Catering Staff", "1:1"), "image16x9": s3Url("Catering Staff", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Decoration Setup", "image": s3Url("Decoration Setup", "1:1"), "image16x9": s3Url("Decoration Setup", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Sound/Light Setup", "image": s3Url("Sound/Light Setup", "1:1"), "image16x9": s3Url("Sound/Light Setup", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Photographer", "image": s3Url("Photographer", "1:1"), "image16x9": s3Url("Photographer", "16:9"), "isTeamJob": false},
            {"name": "Videographer", "image": s3Url("Videographer", "1:1"), "image16x9": s3Url("Videographer", "16:9"), "isTeamJob": false},
            {"name": "Wedding Planner", "image": s3Url("Wedding Planner", "1:1"), "image16x9": s3Url("Wedding Planner", "16:9"), "isTeamJob": false},
            {"name": "Birthday Planner", "image": s3Url("Birthday Planner", "1:1"), "image16x9": s3Url("Birthday Planner", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Education",
      "icon": FontAwesomeIcons.graduationCap,
      "image": s3Url("Home Tutor", "16:9"),
      "color": const Color(0xFF6366F1),
      "emoji": "📚",
      "slug": "education",
      "workers": ["Education"],
      "subcategories": [
        {
          "name": "Education",
          "image": s3Url("Home Tutor", "1:1"),
          "tasks": [
            {"name": "Home Tutor", "image": s3Url("Home Tutor", "1:1"), "image16x9": s3Url("Home Tutor", "16:9"), "isTeamJob": false},
            {"name": "Music Teacher", "image": s3Url("Music Teacher", "1:1"), "image16x9": s3Url("Music Teacher", "16:9"), "isTeamJob": false},
            {"name": "Language Classes", "image": s3Url("Language Classes", "1:1"), "image16x9": s3Url("Language Classes", "16:9"), "isTeamJob": false},
            {"name": "Coding Tutor", "image": s3Url("Coding Tutor", "1:1"), "image16x9": s3Url("Coding Tutor", "16:9"), "isTeamJob": false},
            {"name": "Spoken English", "image": s3Url("Spoken English", "1:1"), "image16x9": s3Url("Spoken English", "16:9"), "isTeamJob": false},
            {"name": "Dance Trainer", "image": s3Url("Dance Trainer", "1:1"), "image16x9": s3Url("Dance Trainer", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Pet Care",
      "icon": FontAwesomeIcons.paw,
      "image": s3Url("Dog Walking", "16:9"),
      "color": const Color(0xFF14B8A6),
      "emoji": "🐾",
      "slug": "pet-care",
      "workers": ["Pet Care"],
      "subcategories": [
        {
          "name": "Pet Care",
          "image": s3Url("Dog Walking", "1:1"),
          "tasks": [
            {"name": "Dog Walking", "image": s3Url("Dog Walking", "1:1"), "image16x9": s3Url("Dog Walking", "16:9"), "isTeamJob": false},
            {"name": "Pet Grooming", "image": s3Url("Pet Grooming", "1:1"), "image16x9": s3Url("Pet Grooming", "16:9"), "isTeamJob": false},
            {"name": "Vet Visit", "image": s3Url("Vet Visit", "1:1"), "image16x9": s3Url("Vet Visit", "16:9"), "isTeamJob": false},
            {"name": "Pet Boarding", "image": s3Url("Pet Boarding", "1:1"), "image16x9": s3Url("Pet Boarding", "16:9"), "isTeamJob": false},
            {"name": "Pet Training", "image": s3Url("Pet Training", "1:1"), "image16x9": s3Url("Pet Training", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Creative Services",
      "icon": FontAwesomeIcons.paintbrush,
      "image": s3Url("Graphic Designer", "16:9"),
      "color": const Color(0xFFF43F5E),
      "emoji": "🎨",
      "slug": "creative-services",
      "workers": ["Creative Services"],
      "subcategories": [
        {
          "name": "Creative Services",
          "image": s3Url("Graphic Designer", "1:1"),
          "tasks": [
            {"name": "Graphic Designer", "image": s3Url("Graphic Designer", "1:1"), "image16x9": s3Url("Graphic Designer", "16:9"), "isTeamJob": false},
            {"name": "Logo Designer", "image": s3Url("Logo Designer", "1:1"), "image16x9": s3Url("Logo Designer", "16:9"), "isTeamJob": false},
            {"name": "Video Editor", "image": s3Url("Video Editor", "1:1"), "image16x9": s3Url("Video Editor", "16:9"), "isTeamJob": false},
            {"name": "Content Writer", "image": s3Url("Content Writer", "1:1"), "image16x9": s3Url("Content Writer", "16:9"), "isTeamJob": false},
            {"name": "Social Media Manager", "image": s3Url("Social Media Manager", "1:1"), "image16x9": s3Url("Social Media Manager", "16:9"), "isTeamJob": false},
            {"name": "Voice Artist", "image": s3Url("Voice Artist", "1:1"), "image16x9": s3Url("Voice Artist", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
    {
      "name": "Logistics & Transport",
      "icon": FontAwesomeIcons.truckMoving,
      "image": s3Url("Packers & Movers", "16:9"),
      "color": const Color(0xFF7C3AED),
      "emoji": "🚚",
      "slug": "logistics-transport",
      "workers": ["Logistics & Transport"],
      "subcategories": [
        {
          "name": "Logistics & Transport",
          "image": s3Url("Packers & Movers", "1:1"),
          "tasks": [
            {"name": "Packers & Movers", "image": s3Url("Packers & Movers", "1:1"), "image16x9": s3Url("Packers & Movers", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Loading", "image": s3Url("Loading", "1:1"), "image16x9": s3Url("Loading", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Unloading", "image": s3Url("Unloading", "1:1"), "image16x9": s3Url("Unloading", "16:9"), "isTeamJob": true, "minWorkers": 2, "maxWorkers": 20},
            {"name": "Mini Truck", "image": s3Url("Mini Truck", "1:1"), "image16x9": s3Url("Mini Truck", "16:9"), "isTeamJob": false},
            {"name": "Personal Driver", "image": s3Url("Personal Driver", "1:1"), "image16x9": s3Url("Personal Driver", "16:9"), "isTeamJob": false},
            {"name": "Courier Service", "image": s3Url("Courier Service", "1:1"), "image16x9": s3Url("Courier Service", "16:9"), "isTeamJob": false},
            {"name": "Parcel Delivery", "image": s3Url("Parcel Delivery", "1:1"), "image16x9": s3Url("Parcel Delivery", "16:9"), "isTeamJob": false},
            {"name": "Furniture Moving", "image": s3Url("Furniture Moving", "1:1"), "image16x9": s3Url("Furniture Moving", "16:9"), "isTeamJob": false},
          ]
        }
      ]
    },
  ];

  /// Helper: find a task by name across all categories
  static Map<String, dynamic>? findTaskByName(String name) {
    for (var cat in categories) {
      for (var sub in (cat['subcategories'] as List)) {
        for (var task in (sub['tasks'] as List)) {
          if (task['name'].toString().toLowerCase() == name.toLowerCase()) {
            return {
              ...task,
              'categoryName': cat['name'],
              'categoryColor': cat['color'],
              'categoryIcon': cat['icon'],
              'subcategoryName': sub['name'],
            };
          }
        }
      }
    }
    return null;
  }

  /// Helper: get all tasks as a flat list
  static List<Map<String, dynamic>> getAllTasks() {
    final List<Map<String, dynamic>> tasks = [];
    for (var cat in categories) {
      for (var sub in (cat['subcategories'] as List)) {
        for (var task in (sub['tasks'] as List)) {
          tasks.add({
            ...Map<String, dynamic>.from(task),
            'categoryName': cat['name'],
            'categoryColor': cat['color'],
            'categoryIcon': cat['icon'],
            'subcategoryName': sub['name'],
          });
        }
      }
    }
    return tasks;
  }

  /// Fetch categories from backend API (with fallback to static data)
  static Future<List<Map<String, dynamic>>> fetchCategoriesFromApi(String baseUrl) async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/api/marketplace/categories'));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true && data['categories'] != null) {
          final List<dynamic> apiCats = data['categories'];
          return apiCats.map((c) => <String, dynamic>{
            "name": c['name'],
            "icon": FontAwesomeIcons.layerGroup,
            "image": c['subcategories'] is List && (c['subcategories'] as List).isNotEmpty
                ? (c['subcategories'][0]['image_16x9'] ?? '')
                : '',
            "color": _parseColor(c['color']),
            "emoji": c['emoji'] ?? '',
            "slug": c['slug'] ?? '',
            "workers": (c['subcategories'] as List? ?? []).map((s) => s['name'].toString()).toList(),
            "subcategories": (c['subcategories'] as List? ?? []).map((s) => <String, dynamic>{
              "id": s['id'],
              "name": s['name'],
              "image": s['image_1x1'] ?? '',
              "tasks": (s['jobs'] as List? ?? []).map((j) => <String, dynamic>{
                "id": j['id'],
                "name": j['name'],
                "image": j['image_1x1'] ?? '',
                "image16x9": j['image_16x9'] ?? '',
                "isTeamJob": j['is_team_job'] ?? false,
                "minWorkers": j['min_workers'] ?? 1,
                "maxWorkers": j['max_workers'] ?? 1,
              }).toList()
            }).toList()
          }).toList();
        }
      }
    } catch (_) {}
    return categories;
  }

  static Color _parseColor(String? hex) {
    if (hex == null || hex.isEmpty) return const Color(0xFF6366F1);
    try {
      return Color(int.parse(hex.replaceFirst('#', '0xFF')));
    } catch (_) {
      return const Color(0xFF6366F1);
    }
  }
}
