import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/screens/ongoing_job_screen.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:nexo/utils/network_helper.dart';

class ScheduledWorkerOffersScreen extends StatefulWidget {
  final String jobId;
  final Map<String, dynamic>? initialJobData;

  const ScheduledWorkerOffersScreen({
    super.key,
    required this.jobId,
    this.initialJobData,
  });

  @override
  State<ScheduledWorkerOffersScreen> createState() => _ScheduledWorkerOffersScreenState();
}

class _ScheduledWorkerOffersScreenState extends State<ScheduledWorkerOffersScreen> with SingleTickerProviderStateMixin {
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _job;
  List<dynamic> _offers = [];
  int _remainingSeconds = 0;
  Timer? _countdownTimer;
  bool _isSelecting = false;
  String _selectedSortFilter = 'RECOMMENDED';
  final String _baseUrl = NetworkHelper.baseUrl;

  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.9, end: 1.15).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _fetchOffers();
    _initSocketListeners();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _countdownTimer?.cancel();
    super.dispose();
  }

  void _initSocketListeners() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId != null) {
      final socketService = SocketService();
      socketService.connect(userId);
      socketService.socket?.on('SCHEDULED_OFFER_RECEIVED', (data) {
        if (!mounted) return;
        _fetchOffers(silent: true);
      });
      socketService.socket?.on('SCHEDULED_OFFER_WITHDRAWN', (data) {
        if (!mounted) return;
        _fetchOffers(silent: true);
      });
      socketService.socket?.on('scheduled_offers_updated', (data) {
        if (!mounted) return;
        _fetchOffers(silent: true);
      });
    }
  }

  Future<void> _fetchOffers({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);
    try {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();

      final response = await http.get(
        Uri.parse('$_baseUrl/api/jobs/${widget.jobId}/offers?userId=$userId'),
        headers: {if (token != null) 'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          setState(() {
            _job = data['job'];
            _offers = data['offers'] ?? [];
            _remainingSeconds = data['remaining_seconds'] ?? 0;
            _isLoading = false;
            _error = null;
          });
          _startCountdownTimer();
        } else {
          setState(() {
            _error = data['message'] ?? "Failed to load offers";
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _error = "Server returned status ${response.statusCode}";
          _isLoading = false;
        });
      }
    } catch (e) {
      if (!silent) {
        setState(() {
          _error = "Network error. Please try again.";
          _isLoading = false;
        });
      }
    }
  }

  void _startCountdownTimer() {
    _countdownTimer?.cancel();
    if (_remainingSeconds <= 0) return;

    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      if (_remainingSeconds > 0) {
        setState(() => _remainingSeconds--);
      } else {
        _countdownTimer?.cancel();
      }
    });
  }

  List<dynamic> get _sortedOffers {
    final list = List<dynamic>.from(_offers);
    if (_selectedSortFilter == 'RECOMMENDED') {
      list.sort((a, b) => (b['is_recommended'] == true ? 1 : 0).compareTo(a['is_recommended'] == true ? 1 : 0));
    } else if (_selectedSortFilter == 'RATING') {
      list.sort((a, b) => (b['rating'] ?? 0).compareTo(a['rating'] ?? 0));
    } else if (_selectedSortFilter == 'PRICE') {
      list.sort((a, b) => (a['price'] ?? 0).compareTo(b['price'] ?? 0));
    } else if (_selectedSortFilter == 'ETA') {
      list.sort((a, b) => (a['eta_minutes'] ?? 99).compareTo(b['eta_minutes'] ?? 99));
    } else if (_selectedSortFilter == 'EXPERIENCE') {
      list.sort((a, b) => (b['completed_jobs'] ?? 0).compareTo(a['completed_jobs'] ?? 0));
    } else if (_selectedSortFilter == 'DISTANCE') {
      list.sort((a, b) => (a['distance_km'] ?? 99).compareTo(b['distance_km'] ?? 99));
    }
    return list;
  }

  String _formatCountdown(int seconds) {
    if (seconds <= 0) return "Selection Time Expired";
    final hours = seconds ~/ 3600;
    final mins = (seconds % 3600) ~/ 60;
    final secs = seconds % 60;
    if (hours > 0) {
      return "${hours}h ${mins}m left to select";
    }
    return "${mins}m ${secs}s left to select";
  }

  Future<void> _selectWorker(Map<String, dynamic> offer) async {
    final workerName = offer['worker_name'] ?? 'Professional';
    final price = offer['price'] ?? _job?['price'] ?? 0;

    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Text(
          "Confirm Booking",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Select $workerName for this service?",
              style: GoogleFonts.inter(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF1E293B),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text("Total Price:", style: GoogleFonts.inter(color: Colors.white60, fontSize: 13)),
                      Text("₹${price.toStringAsFixed(2)}",
                          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF22C55E), fontSize: 18)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text("Booking Guarantee:", style: GoogleFonts.inter(color: Colors.white60, fontSize: 12)),
                      Text("Instant Confirmation", style: GoogleFonts.inter(color: Colors.amberAccent, fontSize: 12, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text("Cancel", style: GoogleFonts.inter(color: Colors.white54)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6A00),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            ),
            child: Text("Confirm & Book", style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isSelecting = true);

    try {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();

      final response = await http.post(
        Uri.parse('$_baseUrl/api/jobs/${widget.jobId}/select-worker'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'userId': userId,
          'workerId': offer['worker_id'],
          'offerId': offer['offer_id'],
        }),
      );

      final data = json.decode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text("🎉 ${offer['worker_name']} selected! Waiting for pro's final confirmation."),
            backgroundColor: const Color(0xFF22C55E),
          ),
        );

        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (context) => OngoingJobScreen(initialJob: {
              ...(_job ?? {}),
              'worker_id': offer['worker_id'],
              'status': 'SELECTION_PENDING_CONFIRMATION',
              'worker': {
                'id': offer['worker_id'],
                'name': offer['worker_name'],
                'photo': offer['worker_photo'],
                'phone': offer['worker_phone'],
                'rating': offer['rating'],
              }
            }),
          ),
        );
      } else {
        if (!mounted) return;
        setState(() => _isSelecting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(data['message'] ?? "Failed to select worker."),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSelecting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e"), backgroundColor: Colors.redAccent),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B132B),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0B132B),
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Choose Your Professional",
              style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 18),
            ),
            Text(
              "Scheduled Job Marketplace",
              style: GoogleFonts.inter(color: Colors.white54, fontSize: 11),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
            onPressed: () => _fetchOffers(),
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
            : _error != null
                ? _buildErrorView()
                : _buildBody(),
      ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            Text(
              _error!,
              style: GoogleFonts.inter(color: Colors.white70, fontSize: 15),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => _fetchOffers(),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF6A00),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text("Try Again", style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    final sortedList = _sortedOffers;
    final recommendedOffer = _offers.firstWhere((o) => o['is_recommended'] == true, orElse: () => null);

    return Column(
      children: [
        // Clean Status Banner Card
        _buildHeaderStatusCard(),

        // Sorting Filter Chips Bar
        if (_offers.isNotEmpty)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: [
                _buildFilterChip("⭐ Recommended", 'RECOMMENDED'),
                _buildFilterChip("🏆 Highest Rating", 'RATING'),
                _buildFilterChip("💰 Lowest Price", 'PRICE'),
                _buildFilterChip("⚡ Fastest ETA", 'ETA'),
                _buildFilterChip("🎓 Experience", 'EXPERIENCE'),
                _buildFilterChip("📍 Nearest", 'DISTANCE'),
              ],
            ),
          ),

        // Offers List or Empty Radar View
        Expanded(
          child: sortedList.isEmpty
              ? _buildEmptyOffersView()
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  itemCount: sortedList.length + (recommendedOffer != null && _selectedSortFilter == 'RECOMMENDED' ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (recommendedOffer != null && _selectedSortFilter == 'RECOMMENDED') {
                      if (index == 0) {
                        return _buildRecommendedHeroCard(recommendedOffer);
                      }
                      final offer = sortedList[index - 1];
                      return _buildWorkerOfferCard(offer);
                    }
                    final offer = sortedList[index];
                    return _buildWorkerOfferCard(offer);
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildHeaderStatusCard() {
    final offerCount = _offers.length;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1E293B), Color(0xFF0F172A)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF334155)),
        boxShadow: const [
          BoxShadow(color: Colors.black26, blurRadius: 10, offset: Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFF6A00).withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.timer_outlined, color: Color(0xFFFF6A00), size: 16),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _formatCountdown(_remainingSeconds),
                    style: GoogleFonts.outfit(
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFFFF8533),
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: offerCount > 0 ? const Color(0xFF10B981).withValues(alpha: 0.2) : Colors.amber.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: offerCount > 0 ? const Color(0xFF10B981) : Colors.amber.withValues(alpha: 0.5),
                  ),
                ),
                child: Text(
                  offerCount > 0 ? "⚡ $offerCount Pros Responded" : "📡 Broadcasting Live",
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: offerCount > 0 ? const Color(0xFF34D399) : Colors.amber,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 10),
          const Divider(color: Colors.white12, height: 1),
          const SizedBox(height: 10),

          Row(
            children: [
              const Icon(Icons.info_outline_rounded, color: Colors.white54, size: 14),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  offerCount > 0
                      ? "Compare ratings & prices below. You can select your pro anytime."
                      : "Pros in your area are reviewing your job. Offers will appear here live.",
                  style: GoogleFonts.inter(color: Colors.white70, fontSize: 12),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String filterKey) {
    final isSelected = _selectedSortFilter == filterKey;
    return GestureDetector(
      onTap: () => setState(() => _selectedSortFilter = filterKey),
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? const Color(0xFFFF8533) : const Color(0xFF334155),
          ),
        ),
        child: Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
            color: isSelected ? Colors.white : Colors.white70,
          ),
        ),
      ),
    );
  }

  Widget _buildRecommendedHeroCard(Map<String, dynamic> offer) {
    final rationale = (offer['rationale_bullets'] as List?) ?? [];
    final price = offer['price'] ?? _job?['price'] ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF064E3B), Color(0xFF022C22)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFF10B981), width: 1.8),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF10B981).withValues(alpha: 0.2),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.star_rounded, color: Colors.white, size: 14),
                    const SizedBox(width: 4),
                    Text(
                      "⭐ Recommended for You",
                      style: GoogleFonts.outfit(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                  ],
                ),
              ),
              Text(
                "Match Score: 98%",
                style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF34D399), fontWeight: FontWeight.bold),
              ),
            ],
          ),

          const SizedBox(height: 14),

          Row(
            children: [
              ImageUtils.buildProfileImage(
                offer['worker_photo'],
                radius: 32,
                name: offer['worker_name'],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      offer['worker_name'] ?? 'Professional',
                      style: GoogleFonts.outfit(fontSize: 19, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 16),
                        Text(
                          " ${offer['rating']}★ ",
                          style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13),
                        ),
                        Text(
                          "(${offer['completed_jobs']} jobs completed)",
                          style: GoogleFonts.inter(color: Colors.white60, fontSize: 12),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          "₹${price.toStringAsFixed(0)}",
                          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF34D399), fontSize: 16),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),
          const Divider(color: Colors.white12, height: 1),
          const SizedBox(height: 12),

          Text(
            "Why we recommend them:",
            style: GoogleFonts.outfit(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.white70),
          ),
          const SizedBox(height: 6),
          ...rationale.map((r) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  r.toString(),
                  style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFFA7F3D0), fontWeight: FontWeight.w500),
                ),
              )),

          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: _isSelecting ? null : () => _selectWorker(offer),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF6A00),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: Text(
                "Select Recommended Professional",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyOffersView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        children: [
          const SizedBox(height: 20),

          // Animated Radar Pulse
          ScaleTransition(
            scale: _pulseAnimation,
            child: Container(
              padding: const EdgeInsets.all(26),
              decoration: BoxDecoration(
                color: const Color(0xFFFF6A00).withValues(alpha: 0.12),
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFFF6A00).withValues(alpha: 0.3), width: 2),
              ),
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: const BoxDecoration(
                  color: Color(0xFF1E293B),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.radar_rounded, color: Color(0xFFFF6A00), size: 48),
              ),
            ),
          ),

          const SizedBox(height: 24),
          Text(
            "Searching for Nearby Professionals...",
            style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            "Your scheduled booking is actively being broadcasted to top-rated, verified experts nearby.",
            style: GoogleFonts.inter(fontSize: 13, color: Colors.white60, height: 1.4),
            textAlign: TextAlign.center,
          ),

          const SizedBox(height: 32),

          // How Scheduled Booking Works (3 Step Cards)
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: const Color(0xFF334155)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.help_outline_rounded, color: Color(0xFFFF6A00), size: 18),
                    const SizedBox(width: 8),
                    Text(
                      "How Scheduled Booking Works",
                      style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _buildStepItem(
                  step: "1",
                  title: "Pros Review Your Request",
                  description: "Nearby professionals receive your job timing & location.",
                ),
                const SizedBox(height: 14),
                _buildStepItem(
                  step: "2",
                  title: "Offers & Counter-Bids Arrive",
                  description: "Interested workers submit their profiles & prices here live.",
                ),
                const SizedBox(height: 14),
                _buildStepItem(
                  step: "3",
                  title: "You Choose or Auto-Confirm",
                  description: "Select your pro anytime, or auto-assign picks the top pro 1h before start.",
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white10),
            ),
            child: Row(
              children: [
                const Icon(Icons.notifications_active_outlined, color: Colors.amberAccent, size: 18),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    "You will receive a notification as soon as the first offer arrives!",
                    style: GoogleFonts.inter(color: Colors.amberAccent, fontSize: 12, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  Widget _buildStepItem({required String step, required String title, required String description}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: const BoxDecoration(
            color: Color(0xFFFF6A00),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              step,
              style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 12),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 14),
              ),
              const SizedBox(height: 2),
              Text(
                description,
                style: GoogleFonts.inter(color: Colors.white60, fontSize: 12, height: 1.3),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildWorkerOfferCard(Map<String, dynamic> offer) {
    final isCounterOffer = offer['offer_status'] == 'COUNTER_OFFER' || offer['counter_offer_price'] != null;
    final isSelected = offer['offer_status'] == 'SELECTED' || offer['offer_status'] == 'CONFIRMED';
    final price = offer['price'] ?? _job?['price'] ?? 0;
    final counterPrice = offer['counter_offer_price'];
    final languages = (offer['languages'] as List?)?.join(', ') ?? 'Kannada, English, Hindi';
    final badges = (offer['badges'] as List?)?.cast<String>() ?? [];

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isSelected ? const Color(0xFF064E3B) : const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isSelected
              ? const Color(0xFF10B981)
              : isCounterOffer
                  ? const Color(0xFFF59E0B).withValues(alpha: 0.5)
                  : const Color(0xFF334155),
          width: isSelected || isCounterOffer ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (badges.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Wrap(
                spacing: 6,
                runSpacing: 4,
                children: badges.map((b) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: b.contains("Recommended")
                            ? const Color(0xFF10B981).withValues(alpha: 0.2)
                            : b.contains("Fast")
                                ? const Color(0xFF3B82F6).withValues(alpha: 0.2)
                                : b.contains("Value")
                                    ? const Color(0xFFF59E0B).withValues(alpha: 0.2)
                                    : Colors.white10,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        b,
                        style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                    )).toList(),
              ),
            ),

          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ImageUtils.buildProfileImage(
                offer['worker_photo'],
                radius: 28,
                name: offer['worker_name'],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            offer['worker_name'] ?? 'Professional',
                            style: GoogleFonts.outfit(
                              fontSize: 17,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (offer['verification_badge'] == true) ...[
                          const SizedBox(width: 4),
                          const Icon(Icons.verified_rounded, color: Color(0xFF3B82F6), size: 16),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 16),
                        Text(
                          " ${offer['rating']} ",
                          style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13),
                        ),
                        Text(
                          "(${offer['completed_jobs']} jobs completed)",
                          style: GoogleFonts.inter(color: Colors.white54, fontSize: 12),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),
          const Divider(color: Color(0xFF334155), height: 1),
          const SizedBox(height: 12),

          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              _buildDetailChip(Icons.location_on_rounded, offer['distance'] ?? "Nearby"),
              _buildDetailChip(Icons.work_history_rounded, "${offer['experience']} exp"),
              _buildDetailChip(Icons.stars_rounded, "Score: ${offer['performance_score']}"),
              _buildDetailChip(Icons.translate_rounded, languages),
            ],
          ),

          if (offer['counter_notes'] != null && offer['counter_notes'].toString().isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.black26,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  const Icon(Icons.notes_rounded, color: Colors.amberAccent, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      "Worker note: \"${offer['counter_notes']}\"",
                      style: GoogleFonts.inter(color: Colors.amberAccent, fontSize: 12, fontStyle: FontStyle.italic),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 16),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Offered Price", style: GoogleFonts.inter(fontSize: 11, color: Colors.white54)),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        "₹${price.toStringAsFixed(2)}",
                        style: GoogleFonts.outfit(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: isCounterOffer ? const Color(0xFFF59E0B) : const Color(0xFF22C55E),
                        ),
                      ),
                      if (counterPrice != null) ...[
                        const SizedBox(width: 6),
                        Text(
                          "₹${(offer['base_price'] ?? 0).toStringAsFixed(0)}",
                          style: GoogleFonts.outfit(
                            fontSize: 14,
                            color: Colors.white38,
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),

              ElevatedButton(
                onPressed: _isSelecting || isSelected ? null : () => _selectWorker(offer),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isSelected ? const Color(0xFF10B981) : const Color(0xFFFF6A00),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: Text(
                  isSelected ? "SELECTED" : "Select Worker",
                  style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDetailChip(IconData icon, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: Colors.white70),
          const SizedBox(width: 4),
          Text(
            text,
            style: GoogleFonts.inter(fontSize: 11, color: Colors.white70),
          ),
        ],
      ),
    );
  }
}
