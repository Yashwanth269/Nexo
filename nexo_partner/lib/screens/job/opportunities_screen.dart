import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';
import '../../utils/theme_utils.dart';

class OpportunitiesScreen extends StatefulWidget {
  const OpportunitiesScreen({super.key});

  @override
  State<OpportunitiesScreen> createState() => _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends State<OpportunitiesScreen> {
  Map<String, dynamic> _dashboardData = {};
  Map<String, List<dynamic>> _sections = {
    'recommended': [],
    'highDemand': [],
    'highPaying': [],
    'fitsCalendar': [],
    'recentlyPosted': [],
    'saved': [],
  };
  List<dynamic> _allOpportunities = [];
  bool _isLoading = true;
  String? _error;
  String? _phoneNumber;
  String? _token;

  // Availability Planning State
  bool _availMorning = true;
  bool _availAfternoon = true;
  bool _availEvening = false;
  bool _availNight = false;

  // Filter & Search States
  final String _selectedPriceFilter = 'All';
  final String _selectedCategoryFilter = 'All';
  String _searchQuery = '';

  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadWorkerInfo();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadWorkerInfo() async {
    final prefs = await SharedPreferences.getInstance();
    _phoneNumber = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
    _token = prefs.getString('worker_token');
    _fetchOpportunities();
    _fetchAvailability();
  }

  Future<void> _fetchAvailability() async {
    if (_phoneNumber == null) return;
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/availability/$_phoneNumber'),
        headers: _getAuthHeaders(),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true && data['availability'] != null) {
          final av = data['availability'];
          setState(() {
            _availMorning = av['morning'] ?? true;
            _availAfternoon = av['afternoon'] ?? true;
            _availEvening = av['evening'] ?? false;
            _availNight = av['night'] ?? false;
          });
        }
      }
    } catch (_) {}
  }

  Future<void> _toggleAvailability(String slot, bool val) async {
    setState(() {
      if (slot == 'morning') _availMorning = val;
      if (slot == 'afternoon') _availAfternoon = val;
      if (slot == 'evening') _availEvening = val;
      if (slot == 'night') _availNight = val;
    });

    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/availability/save'),
        headers: _getAuthHeaders(),
        body: json.encode({
          'workerId': _phoneNumber,
          'availability': {
            'morning': _availMorning,
            'afternoon': _availAfternoon,
            'evening': _availEvening,
            'night': _availNight,
          }
        }),
      );
    } catch (_) {}
  }

  Map<String, String> _getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
  }

  Future<void> _fetchOpportunities() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final uri = Uri.parse(
        '${NetworkHelper.baseUrl}/api/jobs/opportunities?workerId=${_phoneNumber ?? ''}&category=$_selectedCategoryFilter&minPrice=$_selectedPriceFilter&searchQuery=${Uri.encodeComponent(_searchQuery)}',
      );
      final response = await http.get(uri, headers: _getAuthHeaders());

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          setState(() {
            _dashboardData = data['dashboard'] ?? {};
            _allOpportunities = data['opportunities'] ?? [];
            if (data['sections'] != null) {
              _sections = {
                'recommended': data['sections']['recommended'] ?? [],
                'highDemand': data['sections']['highDemand'] ?? [],
                'highPaying': data['sections']['highPaying'] ?? [],
                'fitsCalendar': data['sections']['fitsCalendar'] ?? [],
                'recentlyPosted': data['sections']['recentlyPosted'] ?? [],
                'saved': data['sections']['saved'] ?? [],
              };
            }
            _isLoading = false;
          });
        } else {
          setState(() {
            _error = data['message'] ?? 'Failed to load opportunities';
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _error = 'Server returned code ${response.statusCode}';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Connection error. Pull to refresh.';
        _isLoading = false;
      });
    }
  }

  Future<void> _toggleBookmark(dynamic job) async {
    final jobId = job['id']?.toString() ?? job['_id']?.toString();
    final currentlySaved = job['isSaved'] == true;

    setState(() {
      job['isSaved'] = !currentlySaved;
    });

    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/$jobId/save'),
        headers: _getAuthHeaders(),
        body: json.encode({
          'workerId': _phoneNumber,
          'save': !currentlySaved,
        }),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(!currentlySaved ? "❤️ Job bookmarked in Saved section!" : "Removed from Saved jobs"),
            backgroundColor: const Color(0xFF2563EB),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (_) {}
  }

  Future<void> _submitInterest(dynamic job, {double? customPrice, String? notes}) async {
    final jobId = job['id']?.toString() ?? job['_id']?.toString();
    final price = customPrice ?? (double.tryParse(job['price']?.toString() ?? '500') ?? 500.0);

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB))),
    );

    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/negotiate'),
        headers: _getAuthHeaders(),
        body: json.encode({
          'jobId': jobId,
          'workerId': _phoneNumber,
          'price': price,
          'notes': notes,
        }),
      );

      if (mounted) Navigator.pop(context);

      final data = json.decode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text("🎉 Proposal submitted for ₹${price.toStringAsFixed(0)}! Customer reviewing your profile."),
            backgroundColor: const Color(0xFF10B981),
            duration: const Duration(seconds: 4),
          ),
        );
        _fetchOpportunities();
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['message'] ?? "Could not submit offer"), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e"), backgroundColor: ThemeUtils.getErrorColor(context)),
      );
    }
  }

  void _showOfferDialog(dynamic job) {
    final basePrice = double.tryParse(job['price']?.toString() ?? '500') ?? 500.0;
    final priceController = TextEditingController(text: basePrice.toStringAsFixed(0));
    final noteController = TextEditingController();

    final isDark = ThemeUtils.isDarkMode(context);
    final textPrimary = ThemeUtils.getTextPrimary(context);
    final textSecondary = ThemeUtils.getTextSecondary(context);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: ThemeUtils.getScaffoldBg(context),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      builder: (context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom + 20, top: 20, left: 20, right: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: textSecondary.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Icon(Icons.tune_rounded, color: Color(0xFF2563EB), size: 24),
                const SizedBox(width: 10),
                Text("Tune Proposal & Counter Offer", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 20, color: textPrimary)),
              ],
            ),
            const SizedBox(height: 4),
            Text("Adjust your price or send a custom note to stand out.", style: GoogleFonts.inter(fontSize: 13, color: textSecondary)),
            const SizedBox(height: 20),
            Text("Your Proposed Price (₹)", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: textSecondary, fontSize: 12)),
            const SizedBox(height: 8),
            TextField(
              controller: priceController,
              keyboardType: TextInputType.number,
              style: GoogleFonts.outfit(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                color: isDark ? const Color(0xFF34D399) : const Color(0xFF059669),
              ),
              decoration: InputDecoration(
                prefixText: "₹ ",
                prefixStyle: GoogleFonts.outfit(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: isDark ? const Color(0xFF34D399) : const Color(0xFF059669),
                ),
                filled: true,
                fillColor: ThemeUtils.getCardBg(context),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(color: ThemeUtils.getBorderColor(context)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(color: ThemeUtils.getBorderColor(context)),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text("Message to Customer", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: textSecondary, fontSize: 12)),
            const SizedBox(height: 8),
            TextField(
              controller: noteController,
              maxLines: 2,
              style: GoogleFonts.inter(color: textPrimary, fontSize: 13),
              decoration: InputDecoration(
                hintText: "e.g. Fully equipped with multi-meter & replacement switches.",
                hintStyle: GoogleFonts.inter(color: textSecondary.withValues(alpha: 0.6), fontSize: 12),
                filled: true,
                fillColor: ThemeUtils.getCardBg(context),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(color: ThemeUtils.getBorderColor(context)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(color: ThemeUtils.getBorderColor(context)),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      side: BorderSide(color: ThemeUtils.getBorderColor(context)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: Text("Cancel", style: GoogleFonts.inter(color: textSecondary, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    onPressed: () {
                      final p = double.tryParse(priceController.text) ?? basePrice;
                      Navigator.pop(context);
                      _submitInterest(job, customPrice: p, notes: noteController.text);
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: Text("Submit Proposal", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorView() {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.error_outline_rounded, color: ThemeUtils.getErrorColor(context), size: 48),
            const SizedBox(height: 12),
            Text(_error!, style: GoogleFonts.inter(color: ThemeUtils.getTextSecondary(context))),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _fetchOpportunities, child: const Text("Retry")),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.calendar_month_rounded, color: ThemeUtils.getTextSecondary(context).withValues(alpha: 0.5), size: 48),
            const SizedBox(height: 12),
            Text("No Scheduled Opportunities Found", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: ThemeUtils.getTextPrimary(context))),
            const SizedBox(height: 4),
            Text("Check back soon or adjust your search filters.", style: GoogleFonts.inter(fontSize: 12, color: ThemeUtils.getTextSecondary(context))),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final String greeting = _getGreetingText();

    return Scaffold(
      backgroundColor: ThemeUtils.getScaffoldBg(context),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _fetchOpportunities,
          color: const Color(0xFF2563EB),
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 1.🚀 AI CAREER DASHBOARD HEADER ("This is where Nexo becomes addictive")
                _buildAICareerDashboardHeader(greeting),

                const SizedBox(height: 12),

                // 2. 📅 AVAILABILITY PLANNER (Define Schedule Slots)
                _buildAvailabilityPlanner(),

                const SizedBox(height: 12),

                // 3. 🔍 NATURAL LANGUAGE SEARCH & FILTER BAR
                _buildSearchAndFiltersBar(),

                const SizedBox(height: 16),

                if (_isLoading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 60),
                    child: Center(child: CircularProgressIndicator(color: Color(0xFF2563EB))),
                  )
                else if (_error != null)
                  _buildErrorView()
                else ...[
                  // 4. ⭐ RECOMMENDED FOR YOU (Horizontal Carousel)
                  if ((_sections['recommended'] ?? []).isNotEmpty)
                    _buildSectionHeader("⭐ Recommended For You", "Ranked by skills, calendar & ML fit"),
                  if ((_sections['recommended'] ?? []).isNotEmpty)
                    _buildHorizontalJobCarousel(_sections['recommended']!),

                  const SizedBox(height: 16),

                  // 5. 🔥 HIGH DEMAND NEAR YOU
                  if ((_sections['highDemand'] ?? []).isNotEmpty)
                    _buildSectionHeader("🔥 High Demand Near You", "Popular requests with active customer review"),
                  if ((_sections['highDemand'] ?? []).isNotEmpty)
                    _buildHorizontalJobCarousel(_sections['highDemand']!),

                  const SizedBox(height: 16),

                  // 6. 💰 HIGH PAYING (₹1,000+)
                  if ((_sections['highPaying'] ?? []).isNotEmpty)
                    _buildSectionHeader("💰 High Paying Jobs", "Top payout opportunities in your area"),
                  if ((_sections['highPaying'] ?? []).isNotEmpty)
                    _buildHorizontalJobCarousel(_sections['highPaying']!),

                  const SizedBox(height: 16),

                  // 7. 📅 FITS YOUR CALENDAR (Smart Gap Filling)
                  if ((_sections['fitsCalendar'] ?? []).isNotEmpty)
                    _buildSectionHeader("📅 Fits Your Calendar (Gap Filling)", "Jobs perfectly fitting your free time slots"),
                  if ((_sections['fitsCalendar'] ?? []).isNotEmpty)
                    _buildHorizontalJobCarousel(_sections['fitsCalendar']!),

                  const SizedBox(height: 16),

                  // 8. ❤️ SAVED / BOOKMARKED JOBS
                  if ((_sections['saved'] ?? []).isNotEmpty)
                    _buildSectionHeader("❤️ Bookmarked Opportunities", "Saved jobs for quick application"),
                  if ((_sections['saved'] ?? []).isNotEmpty)
                    _buildHorizontalJobCarousel(_sections['saved']!),

                  const SizedBox(height: 16),

                  // 9. 🆕 RECENTLY POSTED (Vertical Feed)
                  _buildSectionHeader("🆕 All Available Opportunities", "Browse all scheduled job requests"),
                  if (_allOpportunities.isEmpty)
                    _buildEmptyState()
                  else
                    ListView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: _allOpportunities.length,
                      itemBuilder: (context, index) {
                        final job = _allOpportunities[index];
                        return _buildFullOpportunityCard(job);
                      },
                    ),

                  const SizedBox(height: 30),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _getGreetingText() {
    final hour = DateTime.now().hour;
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  }

  Widget _buildAICareerDashboardHeader(String greeting) {
    final name = _dashboardData['workerName'] ?? "Expert";
    final earnings = (_dashboardData['potentialEarnings'] as num?)?.toDouble() ?? 3850.0;
    final recCount = _dashboardData['recommendedCount'] ?? 12;
    final reservedCount = _dashboardData['reservedCount'] ?? 2;
    final topPct = _dashboardData['topPercentile'] ?? 8;
    final relScore = _dashboardData['reliabilityScore'] ?? 98;
    final accRate = _dashboardData['acceptanceRate'] ?? 96;

    final textPrimary = ThemeUtils.getTextPrimary(context);
    final textSecondary = ThemeUtils.getTextSecondary(context);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(20),
      decoration: ThemeUtils.buildBoxDecoration(
        context,
        borderColor: const Color(0xFF2563EB).withValues(alpha: 0.5),
        borderRadius: 24,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Greeting & Top Percentile Badge
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "$greeting, $name 👋",
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: textPrimary),
                    ),
                    Text(
                      "Opportunities & Career Dashboard",
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(fontSize: 12, color: textSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFF59E0B)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.star_rounded, color: Color(0xFFD97706), size: 14),
                    const SizedBox(width: 4),
                    Text(
                      "Top $topPct% Pro",
                      style: GoogleFonts.outfit(fontSize: 11, fontWeight: FontWeight.bold, color: const Color(0xFFB45309)),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 18),

          // Potential Earnings Banner
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
              ),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("Today's Potential Earnings", style: GoogleFonts.inter(fontSize: 11, color: Colors.white70, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 2),
                      Text("₹${earnings.toStringAsFixed(0)}", style: GoogleFonts.outfit(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.white)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(12)),
                  child: Text("High Demand ⚡", style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Key Metrics Row
          Row(
            children: [
              _buildMetricChip("Recommended", "$recCount Jobs", Icons.stars_rounded, const Color(0xFF60A5FA)),
              const SizedBox(width: 8),
              _buildMetricChip("Reserved", "$reservedCount Bookings", Icons.event_available_rounded, const Color(0xFF34D399)),
              const SizedBox(width: 8),
              _buildMetricChip("Free Slots", "10:30-12:00", Icons.schedule_rounded, const Color(0xFFFBBF24)),
            ],
          ),

          const SizedBox(height: 16),
          Divider(color: ThemeUtils.getBorderColor(context), height: 1),
          const SizedBox(height: 12),

          // Reliability & Ratings Performance Bar
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildPerformanceStat("Reliability", "$relScore%"),
              Container(width: 1, height: 20, color: ThemeUtils.getBorderColor(context)),
              _buildPerformanceStat("Acceptance", "$accRate%"),
              Container(width: 1, height: 20, color: ThemeUtils.getBorderColor(context)),
              _buildPerformanceStat("On-Time", "99%"),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetricChip(String title, String val, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: ThemeUtils.buildBoxDecoration(
          context,
          borderRadius: 14,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 14, color: color),
                const SizedBox(width: 4),
                Expanded(child: Text(title, maxLines: 1, style: GoogleFonts.inter(fontSize: 10, color: ThemeUtils.getTextSecondary(context)))),
              ],
            ),
            const SizedBox(height: 4),
            Text(val, maxLines: 1, style: GoogleFonts.outfit(fontSize: 12.5, fontWeight: FontWeight.bold, color: ThemeUtils.getTextPrimary(context))),
          ],
        ),
      ),
    );
  }

  Widget _buildPerformanceStat(String label, String value) {
    return Column(
      children: [
        Text(value, style: GoogleFonts.outfit(fontSize: 15, fontWeight: FontWeight.bold, color: const Color(0xFF34D399))),
        Text(label, style: GoogleFonts.inter(fontSize: 10, color: Colors.white54)),
      ],
    );
  }

  Widget _buildAvailabilityPlanner() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(14),
      decoration: ThemeUtils.buildBoxDecoration(
        context,
        borderRadius: 18,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.event_available_rounded, color: Color(0xFF2563EB), size: 18),
              const SizedBox(width: 8),
              Text("Availability Schedule Planning", style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: ThemeUtils.getTextPrimary(context))),
            ],
          ),
          const SizedBox(height: 4),
          Text("Toggle time slots to let AI recommend jobs fitting your schedule.", style: GoogleFonts.inter(fontSize: 11, color: ThemeUtils.getTextSecondary(context))),
          const SizedBox(height: 12),
          Row(
            children: [
              _buildSlotToggleChip("Morning (8a-12p)", _availMorning, (v) => _toggleAvailability('morning', v)),
              const SizedBox(width: 6),
              _buildSlotToggleChip("Afternoon (12p-4p)", _availAfternoon, (v) => _toggleAvailability('afternoon', v)),
              const SizedBox(width: 6),
              _buildSlotToggleChip("Evening (4p-8p)", _availEvening, (v) => _toggleAvailability('evening', v)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSlotToggleChip(String label, bool isSelected, ValueChanged<bool> onToggle) {
    return Expanded(
      child: GestureDetector(
        onTap: () => onToggle(!isSelected),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF2563EB) : ThemeUtils.getScaffoldBg(context),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isSelected ? const Color(0xFF3B82F6) : ThemeUtils.getBorderColor(context)),
          ),
          child: Center(
            child: Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 10,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                color: isSelected ? Colors.white : ThemeUtils.getTextSecondary(context),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSearchAndFiltersBar() {
    final textSecondary = ThemeUtils.getTextSecondary(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        children: [
          Container(
            decoration: ThemeUtils.buildBoxDecoration(
              context,
              borderRadius: 16,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: TextField(
              controller: _searchController,
              onSubmitted: (v) {
                setState(() => _searchQuery = v);
                _fetchOpportunities();
              },
              style: GoogleFonts.inter(color: ThemeUtils.getTextPrimary(context), fontSize: 13),
              decoration: InputDecoration(
                hintText: "Search e.g. Electrical jobs tomorrow, Whitefield...",
                hintStyle: GoogleFonts.inter(color: textSecondary.withValues(alpha: 0.6), fontSize: 12.5),
                border: InputBorder.none,
                icon: Icon(Icons.search_rounded, color: textSecondary.withValues(alpha: 0.6), size: 20),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: Icon(Icons.clear, color: textSecondary, size: 16),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                          _fetchOpportunities();
                        },
                      )
                    : null,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title, String subtitle) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: ThemeUtils.getTextPrimary(context))),
          Text(subtitle, style: GoogleFonts.inter(fontSize: 11.5, color: ThemeUtils.getTextSecondary(context))),
        ],
      ),
    );
  }

  Widget _buildHorizontalJobCarousel(List<dynamic> jobs) {
    return SizedBox(
      height: 270,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: jobs.length,
        itemBuilder: (context, index) {
          final job = jobs[index];
          return Container(
            width: 300,
            margin: const EdgeInsets.only(right: 14),
            child: _buildOpportunityCardContent(job, isCompact: true),
          );
        },
      ),
    );
  }

  Widget _buildFullOpportunityCard(dynamic job) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      child: _buildOpportunityCardContent(job, isCompact: false),
    );
  }

  Widget _buildOpportunityCardContent(dynamic job, {required bool isCompact}) {
    final price = double.tryParse(job['price']?.toString() ?? '500') ?? 500.0;
    final fuelCost = job['fuelCost'] ?? 35;
    final netProfit = job['netProfit'] ?? (price - fuelCost);
    final matchScore = job['matchScore'] ?? 92;
    final isSaved = job['isSaved'] == true;
    final List<dynamic> rationale = job['rationale'] ?? ["Near your location", "Fits your free slot"];

    final isDark = ThemeUtils.isDarkMode(context);
    final textPrimary = ThemeUtils.getTextPrimary(context);
    final textSecondary = ThemeUtils.getTextSecondary(context);

    final highlightColor = isDark ? const Color(0xFF60A5FA) : const Color(0xFF2563EB);
    final cardBorderColor = matchScore >= 88
        ? highlightColor.withValues(alpha: 0.8)
        : ThemeUtils.getBorderColor(context);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: ThemeUtils.buildBoxDecoration(
        context,
        borderColor: cardBorderColor,
        borderRadius: 20,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row: Category Badge, Price & Bookmark Toggle
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF2563EB).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: highlightColor.withValues(alpha: 0.5)),
                ),
                child: Text(
                  "⭐ $matchScore% Match",
                  style: GoogleFonts.outfit(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1D4ED8),
                  ),
                ),
              ),

              Row(
                children: [
                  Text(
                    "₹${price.toStringAsFixed(0)}",
                    style: GoogleFonts.outfit(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      color: isDark ? const Color(0xFF34D399) : const Color(0xFF059669),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: () => _toggleBookmark(job),
                    child: Icon(
                      isSaved ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                      color: isSaved
                          ? Colors.redAccent
                          : (isDark ? Colors.white38 : Colors.black38),
                      size: 22,
                    ),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 10),

          Text(
            job['title'] ?? job['category'] ?? "Service Request",
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.outfit(fontSize: 17, fontWeight: FontWeight.bold, color: textPrimary),
          ),
          const SizedBox(height: 2),
          Text(
            job['description'] ?? "No description provided.",
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.inter(fontSize: 12, color: textSecondary),
          ),

          const SizedBox(height: 10),

          // Financial Insights Box
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: isDark ? Colors.black26 : Colors.black.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: ThemeUtils.getBorderColor(context)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text("Est. Travel Fuel: ~₹$fuelCost", style: GoogleFonts.inter(fontSize: 11, color: textSecondary)),
                Text(
                  "Net Profit: ₹$netProfit",
                  style: GoogleFonts.outfit(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: isDark ? const Color(0xFF34D399) : const Color(0xFF059669),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 8),

          // AI Explanation Bullet ("WHY")
          Text(
            "💡 ${rationale.first}",
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.inter(
              fontSize: 11,
              color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1D4ED8),
              fontStyle: FontStyle.italic,
            ),
          ),

          if (isCompact) const Spacer() else const SizedBox(height: 16),

          // Action Buttons Row
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _showOfferDialog(job),
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: highlightColor),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text(
                    "Counter",
                    style: GoogleFonts.inter(
                      fontSize: 11.5,
                      fontWeight: FontWeight.bold,
                      color: highlightColor,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: ElevatedButton(
                  onPressed: () => _submitInterest(job),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2563EB),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text("I'm Interested", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
}
