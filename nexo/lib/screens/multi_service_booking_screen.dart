import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/services/service_data.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:nexo/services/location_service.dart';

class MultiServiceBookingScreen extends StatefulWidget {
  const MultiServiceBookingScreen({super.key});

  @override
  State<MultiServiceBookingScreen> createState() => _MultiServiceBookingScreenState();
}

class _MultiServiceBookingScreenState extends State<MultiServiceBookingScreen> {
  static const Color primaryOrange = Color(0xFFFF6A00);
  static const Color primaryBlue = Color(0xFF5D78FF);
  static const Color textPrimary = Color(0xFF0F172A);
  static const Color textSecondary = Color(0xFF64748B);
  static const Color successGreen = Color(0xFF22C55E);

  // Wizard steps: 0 = Selection & Input, 1 = AI Planning, 2 = Comparison & Results, 3 = Tracking Summary
  int _wizardStep = 0;

  // Manual list of services
  final List<Map<String, dynamic>> _selectedServices = [];

  // Natural language query
  final TextEditingController _naturalLanguageController = TextEditingController();
  bool _isUsingNaturalLanguage = false;

  // Frequently added together recommendations
  final List<Map<String, dynamic>> _recommendations = [
    {
      "category": "Deep Cleaning",
      "price": 800,
      "savings": 120,
      "description": "Keep your home pristine",
      "checked": false
    },
    {
      "category": "AC Gas Refill",
      "price": 600,
      "savings": 80,
      "description": "Ensure optimal cooling",
      "checked": false
    },
    {
      "category": "Electrical Inspection",
      "price": 400,
      "savings": 60,
      "description": "Check for safety hazards",
      "checked": false
    }
  ];

  // AI Planner Checklist sequential statuses
  final List<bool> _planningChecks = [false, false, false, false, false];
  final List<String> _planningLabels = [
    "Searching multi-skilled professionals",
    "Optimizing travel time",
    "Calculating best price",
    "Looking for combo savings",
    "Structuring smart combos"
  ];
  int _planningIndex = 0;
  Timer? _planningTimer;

  // Geo parameters
  double _lat = 12.9716;
  double _lng = 77.6244;
  String _address = "Koramangala, Bangalore";

  // API Data outcomes
  String? _bookingId;
  List<dynamic> _plans = [];
  Map<String, dynamic>? _aiUpsell;
  int _selectedPlanIndex = 0;

  // Tracking Timeline state
  bool _isConfirmed = false;
  int _timelineStage = 0; // 0: AI Planning, 1: Workers Assigned, 2: Professionals En Route, 3: In Progress, 4: Completed
  Timer? _timelineTimer;

  @override
  void initState() {
    super.initState();
    _loadLocation();
  }

  @override
  void dispose() {
    _planningTimer?.cancel();
    _timelineTimer?.cancel();
    _naturalLanguageController.dispose();
    super.dispose();
  }

  Future<void> _loadLocation() async {
    try {
      final loc = await LocationService.getCurrentLocation();
      if (mounted) {
        setState(() {
          _lat = loc['lat'] ?? 12.9716;
          _lng = loc['lng'] ?? 77.6244;
          _address = loc['address'] ?? "Koramangala, Bangalore";
        });
      }
    } catch (_) {}
  }

  // --- Dynamic Live Savings Counter Matrix (Requirement 5) ---
  int get _liveSavingsAmount {
    final count = _selectedServices.length;
    if (count <= 1) return 0;
    if (count == 2) return 80;
    if (count == 3) return 180;
    return 310;
  }

  // --- AI Planning checklist ticker trigger ---
  void _triggerPlanningChecklist(bool isNL) {
    setState(() {
      _wizardStep = 1;
      _planningIndex = 0;
      _isUsingNaturalLanguage = isNL;
      _planningChecks.fillRange(0, _planningChecks.length, false);
    });

    _planningTimer = Timer.periodic(const Duration(milliseconds: 900), (t) {
      if (!mounted) return;
      if (_planningIndex < _planningChecks.length) {
        setState(() {
          _planningChecks[_planningIndex] = true;
          _planningIndex++;
        });
      } else {
        t.cancel();
        if (_isUsingNaturalLanguage) {
          _submitNaturalLanguageQuery();
        } else {
          _submitManualBookingRequest();
        }
      }
    });
  }

  // --- API Methods ---
  Future<void> _submitManualBookingRequest() async {
    try {
      final userId = await SharedPrefsHelper.getUserId() ?? "guest";
      final token = await SharedPrefsHelper.getToken();
      final body = {
        "services": _selectedServices.map((s) => {
          "category": s['name'],
          "price": s['price'] ?? 250.00
        }).toList(),
        "location": {
          "lat": _lat,
          "lng": _lng,
          "address": _address
        }
      };

      final response = await http.post(
        Uri.parse("${NetworkHelper.baseUrl}/api/multi-booking/create"),
        headers: {
          "Content-Type": "application/json",
          if (token != null) "Authorization": "Bearer $token"
        },
        body: json.encode(body)
      );

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        if (mounted) {
          setState(() {
            _bookingId = data['bookingId'];
            _plans = data['plans'] ?? [];
            _aiUpsell = data['aiUpsell'];
            _wizardStep = 2; // comparison screen
          });
        }
      } else {
        _handleApiFailure();
      }
    } catch (e) {
      _handleApiError(e);
    }
  }

  Future<void> _submitNaturalLanguageQuery() async {
    try {
      final userId = await SharedPrefsHelper.getUserId() ?? "guest";
      final token = await SharedPrefsHelper.getToken();
      final body = {
        "text": _naturalLanguageController.text,
        "location": {
          "lat": _lat,
          "lng": _lng,
          "address": _address
        }
      };

      final response = await http.post(
        Uri.parse("${NetworkHelper.baseUrl}/api/multi-booking/natural-language-parse"),
        headers: {
          "Content-Type": "application/json",
          if (token != null) "Authorization": "Bearer $token"
        },
        body: json.encode(body)
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) {
          setState(() {
            _bookingId = data['bookingId'];
            _plans = data['plans'] ?? [];
            _aiUpsell = data['aiUpsell'];
            
            // Populate selection list with parsed output categories
            _selectedServices.clear();
            final List<dynamic> parsedCats = data['extractedCategories'] ?? [];
            for (var cat in parsedCats) {
              _selectedServices.add({
                "name": cat.toString(),
                "price": cat.toString() == "AC REPAIR" ? 300 : 250
              });
            }
            
            _wizardStep = 2; // Jump to results Comparison screen
          });
        }
      } else {
        _handleApiFailure();
      }
    } catch (e) {
      _handleApiError(e);
    }
  }

  Future<void> _confirmSelectedPlan(int planIdx) async {
    if (_bookingId == null) return;
    setState(() => _selectedPlanIndex = planIdx);

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: primaryOrange)),
    );

    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.post(
        Uri.parse("${NetworkHelper.baseUrl}/api/multi-booking/$_bookingId/accept-plan"),
        headers: {
          "Content-Type": "application/json",
          if (token != null) "Authorization": "Bearer $token"
        },
        body: json.encode({"planIndex": planIdx})
      );

      Navigator.pop(context); // close loader dialog

      if (response.statusCode == 200) {
        setState(() {
          _wizardStep = 3;
          _isConfirmed = true;
          _timelineStage = 0;
        });
        _triggerSuccessAnimationPopup();
        _startTimelineSimulation();
      } else {
        _showErrorSnackBar("Failed to accept selected plan.");
      }
    } catch (e) {
      Navigator.pop(context);
      _showErrorSnackBar("Network error: $e");
    }
  }

  Future<void> _addUpsellAddon(Map<String, dynamic> upsell) async {
    if (_bookingId == null) return;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: primaryOrange)),
    );

    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.post(
        Uri.parse("${NetworkHelper.baseUrl}/api/multi-booking/$_bookingId/addon/suggest"),
        headers: {
          "Content-Type": "application/json",
          if (token != null) "Authorization": "Bearer $token"
        },
        body: json.encode({
          "category": upsell['category'],
          "price": upsell['price'],
          "description": upsell['description']
        })
      );

      if (response.statusCode == 201) {
        final addonData = json.decode(response.body);
        // Automatically respond to accept the addon (simulate instant client confirmation)
        await http.post(
          Uri.parse("${NetworkHelper.baseUrl}/api/multi-booking/addon/${addonData['id']}/respond"),
          headers: {
            "Content-Type": "application/json",
            if (token != null) "Authorization": "Bearer $token"
          },
          body: json.encode({"accepted": true})
        );

        // Fetch refreshed booking
        final refreshedRes = await http.get(
          Uri.parse("${NetworkHelper.baseUrl}/api/multi-booking/$_bookingId"),
          headers: {
            if (token != null) "Authorization": "Bearer $token"
          }
        );

        Navigator.pop(context); // Close loading

        if (refreshedRes.statusCode == 200) {
          final data = json.decode(refreshedRes.body);
          setState(() {
            _plans[_selectedPlanIndex]['totalPrice'] = data['booking']['total_price'];
            _aiUpsell = null;
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("🎉 AI Opportunity applied! Combined combo price updated."), backgroundColor: successGreen)
          );
        }
      } else {
        Navigator.pop(context);
        _showErrorSnackBar("Failed to apply upsell.");
      }
    } catch (e) {
      Navigator.pop(context);
      _showErrorSnackBar("Upsell failed: $e");
    }
  }

  void _startTimelineSimulation() {
    _timelineTimer?.cancel();
    _timelineTimer = Timer.periodic(const Duration(seconds: 4), (t) {
      if (!mounted) return;
      if (_timelineStage < 4) {
        setState(() {
          _timelineStage++;
        });
      } else {
        t.cancel();
      }
    });
  }

  // --- Delighting Success Alert (Requirement 11) ---
  void _triggerSuccessAnimationPopup() {
    final finalSavings = _plans[_selectedPlanIndex]['comboSavings'] ?? 280;
    showDialog(
      context: context,
      builder: (context) {
        return Dialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          child: Container(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: successGreen.withOpacity(0.12), shape: BoxShape.circle),
                  child: const Icon(Icons.celebration, color: successGreen, size: 40),
                ),
                const SizedBox(height: 18),
                Text(
                  "Great Choice!",
                  style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: textPrimary),
                ),
                const SizedBox(height: 8),
                Text(
                  "You saved ₹$finalSavings by booking together.",
                  style: GoogleFonts.inter(fontSize: 14, color: textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: primaryOrange,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      elevation: 0,
                    ),
                    onPressed: () => Navigator.pop(context),
                    child: Text("Awesome", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _handleApiFailure() {
    _showErrorSnackBar("AI optimization request rejected. Adjust parameters.");
    setState(() => _wizardStep = 0);
  }

  void _handleApiError(Object e) {
    _showErrorSnackBar("Connection error: $e");
    setState(() => _wizardStep = 0);
  }

  // --- Step Rendering routers ---
  Widget _buildStepView() {
    switch (_wizardStep) {
      case 0:
        return _buildSelectionView();
      case 1:
        return _buildPlanningView();
      case 2:
        return _buildResultsView();
      case 3:
        return _buildTimelineView();
      default:
        return _buildSelectionView();
    }
  }

  // --- 1. SELECTION SCREEN VIEW ---
  Widget _buildSelectionView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSaveMoreBanner(),
          const SizedBox(height: 20),
          _buildNaturalLanguageCard(),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Or Select Services",
                style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: textPrimary),
              ),
              if (_selectedServices.length >= 2)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: primaryOrange.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                  child: Text(
                    "🔥 Popular Combo: 38k+ Booked",
                    style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: primaryOrange),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          _buildSelectedServicesList(),
          const SizedBox(height: 12),
          _buildAddServiceButton(),
          const SizedBox(height: 24),
          _buildRecommendationsSection(),
          const SizedBox(height: 36),
          _buildSelectionCTA(),
        ],
      ),
    );
  }

  Widget _buildSaveMoreBanner() {
    final count = _selectedServices.length;
    final isSaving = count >= 2;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isSaving
              ? [const Color(0xFFDCFCE7), const Color(0xFFF0FDF4)]
              : [const Color(0xFFFFF7ED), const Color(0xFFFFE5D9)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isSaving ? const Color(0xFFBBF7D0) : const Color(0xFFFFD8C2),
          width: 1.5,
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: Icon(
              isSaving ? Icons.check_circle : Icons.stars_rounded,
              color: isSaving ? successGreen : primaryOrange,
              size: 24,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isSaving ? "Great Choice!" : "💰 Save More!",
                  style: GoogleFonts.outfit(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    color: isSaving ? const Color(0xFF166534) : const Color(0xFFC2410C),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  isSaving
                      ? "You're now saving ₹$_liveSavingsAmount by combining services."
                      : "Add another service and reduce your overall visit charges.",
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: isSaving ? const Color(0xFF14532D) : const Color(0xFF7C2D12),
                    height: 1.3,
                  ),
                ),
                if (isSaving) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      _buildSavingsPill("Current Savings: ₹$_liveSavingsAmount", const Color(0xFF15803D)),
                      const SizedBox(width: 8),
                      _buildSavingsPill("+ Add One More Service", const Color(0xFF6B7280)),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // --- "Let AI Plan My Home" natural language search panel (Requirement 13) ---
  Widget _buildNaturalLanguageCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.01), blurRadius: 10, offset: const Offset(0, 4))
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.psychology_rounded, color: primaryBlue, size: 22),
              const SizedBox(width: 8),
              Text(
                "🤖 Let AI Plan My Home",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: textPrimary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            "Speak or type what you need naturally:",
            style: GoogleFonts.inter(fontSize: 12, color: textSecondary),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: TextField(
              controller: _naturalLanguageController,
              maxLines: 3,
              style: GoogleFonts.inter(fontSize: 13, color: textPrimary),
              decoration: InputDecoration(
                hintText: 'e.g. \"I need AC serviced, fan installed, and bathroom tap fixed...\"',
                hintStyle: GoogleFonts.inter(color: Colors.grey[400], fontSize: 12),
                border: InputBorder.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: ElevatedButton(
              onPressed: () {
                if (_naturalLanguageController.text.trim().isNotEmpty) {
                  _triggerPlanningChecklist(true);
                } else {
                  _showErrorSnackBar("Please enter your requirements first.");
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: primaryBlue,
                elevation: 0,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: Text(
                "Ask AI to Plan",
                style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSelectedServicesList() {
    if (_selectedServices.isEmpty) return const SizedBox.shrink();
    return Column(
      children: _selectedServices.map((service) {
        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Row(
            children: [
              const Icon(Icons.check_circle_rounded, color: successGreen, size: 18),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  service['name'],
                  style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: textPrimary),
                ),
              ),
              Text(
                "₹${service['price']}",
                style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: primaryOrange),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, color: Colors.redAccent, size: 18),
                onPressed: () {
                  setState(() {
                    _selectedServices.remove(service);
                  });
                },
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildAddServiceButton() {
    return SizedBox(
      width: double.infinity,
      height: 44,
      child: OutlinedButton.icon(
        onPressed: _showTaskSelectionModal,
        icon: const Icon(Icons.add_circle_outline_rounded, color: primaryOrange, size: 16),
        label: Text("Add Manual Service", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: primaryOrange, fontSize: 12)),
        style: OutlinedButton.styleFrom(
          side: const BorderSide(color: Color(0xFFFFD8C2)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
    );
  }

  Widget _buildRecommendationsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          "💡 Frequently Added Together",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: textPrimary),
        ),
        const SizedBox(height: 12),
        Column(
          children: _recommendations.map((rec) {
            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: rec['checked'] ? primaryOrange : const Color(0xFFE2E8F0), width: rec['checked'] ? 2 : 1),
              ),
              child: CheckboxListTile(
                activeColor: primaryOrange,
                value: rec['checked'],
                title: Row(
                  children: [
                    Text(rec['category'], style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 14, color: textPrimary)),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(color: successGreen.withOpacity(0.12), borderRadius: BorderRadius.circular(8)),
                      child: Text("Save ₹${rec['savings']}", style: GoogleFonts.inter(color: successGreen, fontWeight: FontWeight.bold, fontSize: 10)),
                    ),
                  ],
                ),
                subtitle: Text(rec['description'], style: GoogleFonts.inter(fontSize: 11, color: textSecondary)),
                onChanged: (val) {
                  setState(() {
                    rec['checked'] = val;
                    if (val == true) {
                      _selectedServices.add({
                        "name": rec['category'],
                        "price": rec['price']
                      });
                    } else {
                      _selectedServices.removeWhere((s) => s['name'] == rec['category']);
                    }
                  });
                },
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildSelectionCTA() {
    final bool hasServices = _selectedServices.isNotEmpty;
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        onPressed: hasServices ? () => _triggerPlanningChecklist(false) : null,
        style: ElevatedButton.styleFrom(
          backgroundColor: hasServices ? primaryOrange : Colors.grey[300],
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
          elevation: 0,
        ),
        child: Text(
          hasServices ? "Continue (${_selectedServices.length} Services)" : "Select Services",
          style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 15, color: hasServices ? Colors.white : Colors.grey[600]),
        ),
      ),
    );
  }

  // --- 2. AI PLANNING & TIMELINE ANIMATION (Requirement 9) ---
  Widget _buildPlanningView() {
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(
            width: 70,
            height: 70,
            child: CircularProgressIndicator(color: primaryOrange, strokeWidth: 3),
          ),
          const SizedBox(height: 36),
          Text(
            "🤖 Creating the best service plan...",
            style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 20, color: textPrimary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          Column(
            children: List.generate(_planningChecks.length, (idx) {
              final isTicked = _planningChecks[idx];
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Icon(
                      isTicked ? Icons.check_circle : Icons.circle_outlined,
                      color: isTicked ? successGreen : Colors.grey[300],
                      size: 20,
                    ),
                    const SizedBox(width: 14),
                    Text(
                      _planningLabels[idx],
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: isTicked ? FontWeight.bold : FontWeight.w500,
                        color: isTicked ? textPrimary : textSecondary,
                      ),
                    ),
                  ],
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  // --- 3. COMPARISON & OPTIONS CARD VIEW (Requirement 3 & 6) ---
  Widget _buildResultsView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "✨ Smart Plan Created",
            style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 20, color: textPrimary),
          ),
          const SizedBox(height: 12),
          _buildComparisonCards(),
          const SizedBox(height: 24),
          _buildUpsellOpportunity(),
        ],
      ),
    );
  }

  Widget _buildComparisonCards() {
    return Column(
      children: List.generate(_plans.length, (idx) {
        final plan = _plans[idx];
        final String reason = plan['recommendationReason'] ?? "✓ Balanced Choice";
        final List<dynamic> assigns = plan['assignments'] ?? [];
        final totalSavings = plan['comboSavings'] ?? 240;
        final totalPrice = plan['totalPrice'];
        final duration = plan['estimatedDurationMinutes'];

        return Container(
          margin: const EdgeInsets.only(bottom: 16),
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: idx == 0 ? primaryOrange : const Color(0xFFE2E8F0), width: idx == 0 ? 2 : 1),
            boxShadow: [
              BoxShadow(color: Colors.black.withOpacity(0.01), blurRadius: 10, offset: const Offset(0, 4))
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Badge header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: idx == 0 ? primaryOrange.withOpacity(0.12) : const Color(0xFFEFF6FF),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      idx == 0 ? "🤖 AI Recommended" : "Option ${idx + 1}",
                      style: GoogleFonts.inter(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: idx == 0 ? primaryOrange : const Color(0xFF2563EB),
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: successGreen.withOpacity(0.12), borderRadius: BorderRadius.circular(6)),
                    child: Text(
                      "SAVE ₹$totalSavings",
                      style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: successGreen),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              // Reason line (Requirement 2)
              Text(
                reason,
                style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600, color: textSecondary),
              ),
              const Divider(height: 20),
              // Details
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("Team Details", style: GoogleFonts.inter(fontSize: 11, color: textSecondary)),
                      const SizedBox(height: 2),
                      Text(
                        assigns.length == 1 ? "Single Worker" : "${assigns.length} Professionals",
                        style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: textPrimary),
                      ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("ETA Duration", style: GoogleFonts.inter(fontSize: 11, color: textSecondary)),
                      const SizedBox(height: 2),
                      Text(
                        "${(duration / 60).floor()}h ${duration % 60}m",
                        style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: textPrimary),
                      ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("Price", style: GoogleFonts.inter(fontSize: 11, color: textSecondary)),
                      const SizedBox(height: 2),
                      Text(
                        "₹$totalPrice",
                        style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: primaryOrange),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 14),
              // Assignments list
              Column(
                children: assigns.map((a) {
                  return Container(
                    margin: const EdgeInsets.only(vertical: 4),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      children: [
                        ImageUtils.buildProfileImage(a['photoUrl'], radius: 18, name: a['fullName']),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(a['fullName'], style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 12, color: textPrimary)),
                              Text((a['assignedCategories'] as List).join(', '), style: GoogleFonts.inter(fontSize: 9, color: textSecondary)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 12),
              // Button CTA
              SizedBox(
                width: double.infinity,
                height: 44,
                child: ElevatedButton(
                  onPressed: () => _confirmSelectedPlan(idx),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: idx == 0 ? primaryOrange : const Color(0xFF0F172A),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 0,
                  ),
                  child: Text("Continue with this plan", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white)),
                ),
              ),
            ],
          ),
        );
      }),
    );
  }

  Widget _buildUpsellOpportunity() {
    if (_aiUpsell == null) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFBFDBFE), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.flash_on_rounded, color: Color(0xFF2563EB), size: 20),
              const SizedBox(width: 8),
              Text(
                "🤖 AI Upsell Opportunity",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: const Color(0xFF1E40AF)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            "Since an expert is already visiting, add ${_aiUpsell!['category']} to your booking for only ₹${_aiUpsell!['price']}!",
            style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF1E3A8A), height: 1.35),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "🚗 Shared Visit: No extra visit charge",
                style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF2563EB), fontWeight: FontWeight.bold),
              ),
              ElevatedButton(
                onPressed: () => _addUpsellAddon(_aiUpsell!),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  foregroundColor: Colors.white,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: Text("Add", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 11)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // --- 4. ACCEPTED TIMELINE TRACKER (Requirement 8 & 10) ---
  Widget _buildTimelineView() {
    final plan = _plans[_selectedPlanIndex];
    final serviceCharge = plan['serviceCharge'] ?? plan['totalPrice'];
    final platformFee = plan['platformFee'] ?? 40;
    final travelFee = plan['travelFee'] ?? 50;
    final discount = plan['comboDiscount'] ?? 0;
    final finalPrice = plan['totalPrice'];
    final totalSavings = plan['comboSavings'] ?? 280;

    // Separate booking estimated cost (Requirement 1)
    final separateBookingCost = serviceCharge + (_selectedServices.length * 50);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // AI Planned Premium Badge card (Requirement 10)
          Container(
            padding: const EdgeInsets.all(16),
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                const Icon(Icons.auto_awesome, color: Colors.amberAccent, size: 24),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "🤖 AI Planned",
                        style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        "Optimized for: ✓ Savings, ✓ Travel, ✓ Time, ✓ Quality",
                        style: GoogleFonts.inter(color: Colors.white60, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Booking Summary Invoice Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text("Separate Booking Cost", style: GoogleFonts.inter(color: textSecondary, fontSize: 13)),
                    Text("₹$separateBookingCost", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: textSecondary, fontSize: 13, decoration: TextDecoration.lineThrough)),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text("Service Charges", style: GoogleFonts.inter(color: textSecondary, fontSize: 13)),
                    Text("₹$serviceCharge", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: textPrimary, fontSize: 13)),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text("Platform Fee", style: GoogleFonts.inter(color: textSecondary, fontSize: 13)),
                    Text("₹$platformFee", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: textPrimary, fontSize: 13)),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text("Travel Visit Charges", style: GoogleFonts.inter(color: textSecondary, fontSize: 13)),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text("₹$travelFee", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: textPrimary, fontSize: 13)),
                        Text("🚗 Shared Visit", style: GoogleFonts.inter(fontSize: 9, color: successGreen, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ],
                ),
                if (discount > 0) ...[
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text("Combo Discount", style: GoogleFonts.inter(color: successGreen, fontSize: 13, fontWeight: FontWeight.bold)),
                      Text("-₹$discount", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: successGreen, fontSize: 13)),
                    ],
                  ),
                ],
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text("You Pay", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: textPrimary)),
                    Text("₹$finalPrice", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: primaryOrange)),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: successGreen.withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
                  child: Center(
                    child: Text(
                      "🎉 AI Smart Combo Saved ₹$totalSavings",
                      style: GoogleFonts.inter(color: successGreen, fontWeight: FontWeight.bold, fontSize: 12),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Booking timeline (Requirement 9)
          Text(
            "Booking Timeline",
            style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: textPrimary),
          ),
          const SizedBox(height: 16),
          _buildTimelineItem("AI Planning", "Checking optimal service bundles", _timelineStage >= 0, _timelineStage == 0),
          _buildTimelineItem("Searching Professionals", "Evaluating available worker pools", _timelineStage >= 1, _timelineStage == 1),
          _buildTimelineItem("Best Plan Ready", "Smart plan constructed and locked", _timelineStage >= 2, _timelineStage == 2),
          _buildTimelineItem("Worker Accepted", "Partner accepted the work block", _timelineStage >= 3, _timelineStage == 3),
          _buildTimelineItem("On the Way", "Technician en route to your place", _timelineStage >= 4, _timelineStage == 4),
          const SizedBox(height: 36),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: () => Navigator.pop(context),
              style: ElevatedButton.styleFrom(backgroundColor: primaryOrange, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26))),
              child: Text("Track in Dashboard", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTimelineItem(String title, String subtitle, bool isCompleted, bool isActive) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                color: isCompleted ? successGreen : Colors.grey[200],
                shape: BoxShape.circle,
                border: isActive ? Border.all(color: primaryOrange, width: 4) : null,
              ),
              child: isCompleted
                  ? const Icon(Icons.check, size: 10, color: Colors.white)
                  : null,
            ),
            Container(
              width: 2,
              height: 38,
              color: isCompleted ? successGreen : Colors.grey[200],
            ),
          ],
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.inter(
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                  color: isCompleted ? textPrimary : textSecondary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: GoogleFonts.inter(
                  fontSize: 11,
                  color: isCompleted ? textSecondary : Colors.grey[400],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSavingsPill(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(8)),
      child: Text(
        label,
        style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: color),
      ),
    );
  }

  void _showTaskSelectionModal() {
    int pickerStep = 0; // 0 = Category, 1 = Tasks
    Map<String, dynamic>? selectedCategory;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            String modalTitle = pickerStep == 0 ? "Select Service Category" : selectedCategory!['name'];
            List items = pickerStep == 0 ? ServiceData.categories : (selectedCategory!['subcategories'] as List).expand((sub) => sub['tasks'] as List).toList();

            return Container(
              height: MediaQuery.of(context).size.height * 0.75,
              padding: const EdgeInsets.only(top: 14),
              child: Column(
                children: [
                  Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2))),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        if (pickerStep > 0)
                          IconButton(
                            icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
                            onPressed: () => setModalState(() => pickerStep = 0),
                          ),
                        Expanded(
                          child: Text(modalTitle, style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: textPrimary)),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: ListView.separated(
                      itemCount: items.length,
                      separatorBuilder: (context, index) => const Divider(height: 1, indent: 20),
                      itemBuilder: (context, index) {
                        final item = items[index];
                        if (pickerStep == 0) {
                          return ListTile(
                            title: Text(item['name'], style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: textPrimary)),
                            trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Colors.grey),
                            onTap: () {
                              setModalState(() {
                                selectedCategory = item;
                                pickerStep = 1;
                              });
                            },
                          );
                        } else {
                          final taskName = item['name'] as String;
                          return ListTile(
                            title: Text(taskName, style: GoogleFonts.inter(color: textPrimary, fontWeight: FontWeight.w500)),
                            trailing: const Icon(Icons.add_rounded, color: primaryOrange),
                            onTap: () {
                              setState(() {
                                if (!_selectedServices.any((s) => s['name'] == taskName)) {
                                  _selectedServices.add({
                                    "name": taskName,
                                    "price": 300 // default mock task price
                                  });
                                }
                              });
                              Navigator.pop(context);
                            },
                          );
                        }
                      },
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Text(
          "Multi-Service Booking",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: textPrimary),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: textPrimary, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: _buildStepView(),
    );
  }
}
