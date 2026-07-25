import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';

class WorkerPreferencesScreen extends StatefulWidget {
  const WorkerPreferencesScreen({super.key});

  @override
  State<WorkerPreferencesScreen> createState() => _WorkerPreferencesScreenState();
}

class _WorkerPreferencesScreenState extends State<WorkerPreferencesScreen> {
  Map<String, int> _areaRatings = {
    'Koramangala': 5,
    'HSR Layout': 5,
    'BTM Layout': 4,
    'Whitefield': 4,
    'Indiranagar': 5,
    'Yelahanka': 2,
    'Airport': 0, // Avoided
  };

  Map<String, int> _skillRatings = {
    'Ceiling Fan Repair': 5,
    'Switch Board Repair': 5,
    'House Wiring': 4,
    'MCB Installation': 4,
    'Solar Installation': 1,
    'Industrial Electrical': 1,
  };

  bool _isLoading = true;
  String? _phoneNumber;
  String? _token;

  @override
  void initState() {
    super.initState();
    _loadPreferences();
  }

  Future<void> _loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    _phoneNumber = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
    _token = prefs.getString('worker_token');

    if (_phoneNumber != null) {
      try {
        final response = await http.get(
          Uri.parse('${NetworkHelper.baseUrl}/api/jobs/preferences/$_phoneNumber'),
          headers: {
            'Content-Type': 'application/json',
            if (_token != null) 'Authorization': 'Bearer $_token',
          },
        );

        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['success'] == true && data['preferences'] != null) {
            setState(() {
              if (data['preferences']['areaRatings'] != null) {
                _areaRatings = Map<String, int>.from(data['preferences']['areaRatings']);
              }
              if (data['preferences']['skillRatings'] != null) {
                _skillRatings = Map<String, int>.from(data['preferences']['skillRatings']);
              }
            });
          }
        }
      } catch (_) {}
    }

    setState(() => _isLoading = false);
  }

  Future<void> _saveAreaRating(String area, int rating) async {
    setState(() => _areaRatings[area] = rating);

    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/preferences/areas'),
        headers: {
          'Content-Type': 'application/json',
          if (_token != null) 'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'workerId': _phoneNumber,
          'areaRatings': {area: rating},
        }),
      );
    } catch (_) {}
  }

  Future<void> _saveSkillRating(String skill, int rating) async {
    setState(() => _skillRatings[skill] = rating);

    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/preferences/skills'),
        headers: {
          'Content-Type': 'application/json',
          if (_token != null) 'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'workerId': _phoneNumber,
          'skillRatings': {skill: rating},
        }),
      );
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F172A),
        elevation: 0,
        title: Text(
          "Worker Intelligence Core Preferences",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header Banner
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: const Color(0xFF334155)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.psychology_rounded, color: Color(0xFF3B82F6), size: 32),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  "Personalized Matching Engine",
                                  style: GoogleFonts.outfit(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white),
                                ),
                                Text(
                                  "Rate areas and sub-skills to boost dispatch ranking for your favorite work.",
                                  style: GoogleFonts.inter(fontSize: 11.5, color: Colors.white60),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 20),

                    // PAE: Preferred Areas Engine
                    Row(
                      children: [
                        const Icon(Icons.map_rounded, color: Color(0xFF60A5FA), size: 20),
                        const SizedBox(width: 8),
                        Text("Chapter 2 — Preferred Areas (PAE)", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text("Jobs in 5-star areas are boosted. Rate 0 stars to avoid trips.", style: GoogleFonts.inter(fontSize: 11.5, color: Colors.white54)),
                    const SizedBox(height: 10),

                    ..._areaRatings.entries.map((e) => _buildRatingTile(
                          title: e.key,
                          currentRating: e.value,
                          onRatingChanged: (r) => _saveAreaRating(e.key, r),
                          isArea: true,
                        )),

                    const SizedBox(height: 24),

                    // PSE: Preferred Services Engine
                    Row(
                      children: [
                        const Icon(Icons.build_circle_rounded, color: Color(0xFF34D399), size: 20),
                        const SizedBox(width: 8),
                        Text("Chapter 3 — Preferred Services (PSE)", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text("Rate your sub-skill confidence to receive higher matching job offers.", style: GoogleFonts.inter(fontSize: 11.5, color: Colors.white54)),
                    const SizedBox(height: 10),

                    ..._skillRatings.entries.map((e) => _buildRatingTile(
                          title: e.key,
                          currentRating: e.value,
                          onRatingChanged: (r) => _saveSkillRating(e.key, r),
                          isArea: false,
                        )),

                    const SizedBox(height: 30),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildRatingTile({required String title, required int currentRating, required ValueChanged<int> onRatingChanged, required bool isArea}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: currentRating == 0 ? Colors.redAccent.withValues(alpha: 0.5) : const Color(0xFF334155)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Row(
              children: [
                Text(title, style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white)),
                if (currentRating == 0) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: Colors.redAccent.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(8)),
                    child: Text("❌ Avoid", style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.redAccent)),
                  ),
                ],
              ],
            ),
          ),
          Row(
            children: List.generate(5, (index) {
              final starVal = index + 1;
              final isFilled = starVal <= currentRating;
              return GestureDetector(
                onTap: () {
                  if (currentRating == starVal) {
                    onRatingChanged(0); // Toggle off to avoid area
                  } else {
                    onRatingChanged(starVal);
                  }
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: Icon(
                    isFilled ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: isFilled ? const Color(0xFFF59E0B) : Colors.white24,
                    size: 20,
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}
