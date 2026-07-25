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

class _ScheduledWorkerOffersScreenState extends State<ScheduledWorkerOffersScreen> {
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _job;
  List<dynamic> _offers = [];
  int _remainingSeconds = 0;
  Timer? _countdownTimer;
  bool _isSelecting = false;
  final String _baseUrl = NetworkHelper.baseUrl;

  @override
  void initState() {
    super.initState();
    _fetchOffers();
    _initSocketListeners();
  }

  @override
  void dispose() {
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
        debugPrint("🔔 [SOCKET] New Scheduled Offer received!");
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
      debugPrint("Fetch offers error: $e");
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

  String _formatCountdown(int seconds) {
    if (seconds <= 0) return "Selection Deadline Reached";
    final hours = seconds ~/ 3600;
    final mins = (seconds % 3600) ~/ 60;
    final secs = seconds % 60;
    if (hours > 0) {
      return "${hours}h ${mins}m remaining to choose";
    }
    return "${mins}m ${secs}s remaining to choose";
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
          "Confirm Reservation",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Are you sure you want to select $workerName for this scheduled job?",
              style: GoogleFonts.inter(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF1E293B),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text("Agreed Price:", style: GoogleFonts.inter(color: Colors.white60)),
                  Text("₹${price.toStringAsFixed(2)}",
                      style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF22C55E), fontSize: 16)),
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
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: Text("Confirm Reservation", style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
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
            content: Text("🎉 ${offer['worker_name']} has been successfully reserved!"),
            backgroundColor: const Color(0xFF22C55E),
          ),
        );

        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (context) => OngoingJobScreen(initialJob: {
              ...(_job ?? {}),
              'worker_id': offer['worker_id'],
              'status': 'ACCEPTED',
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
        title: Text(
          "Worker Offers & Comparison",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 18),
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
    return Column(
      children: [
        // Top Banner / Countdown Header
        Container(
          width: double.infinity,
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF1E293B), Color(0xFF0F172A)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFF334155)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFF6A00).withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.timer_outlined, color: Color(0xFFFF6A00), size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _formatCountdown(_remainingSeconds),
                          style: GoogleFonts.outfit(
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFFFF8533),
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          "Continuous dispatch is gathering interested professionals for your review.",
                          style: GoogleFonts.inter(color: Colors.white60, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        // Section Title
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 8.0),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Interested Professionals (${_offers.length})",
                style: GoogleFonts.outfit(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              Row(
                children: [
                  const Icon(Icons.live_tv_rounded, color: Color(0xFF22C55E), size: 14),
                  const SizedBox(width: 4),
                  Text(
                    "Live Updates",
                    style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF22C55E), fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ],
          ),
        ),

        // Offers List
        Expanded(
          child: _offers.isEmpty
              ? _buildEmptyOffersView()
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  itemCount: _offers.length,
                  itemBuilder: (context, index) {
                    final offer = _offers[index];
                    return _buildWorkerOfferCard(offer);
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildEmptyOffersView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(
                color: Color(0xFF1E293B),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.person_search_rounded, color: Color(0xFFFF6A00), size: 48),
            ),
            const SizedBox(height: 20),
            Text(
              "Searching for Nearby Professionals...",
              style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              "Dispatch is currently broadcasting your scheduled job. As soon as workers accept or submit counter-offers, they will appear here in real-time.",
              style: GoogleFonts.inter(fontSize: 13, color: Colors.white60, height: 1.4),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWorkerOfferCard(Map<String, dynamic> offer) {
    final isCounterOffer = offer['offer_status'] == 'COUNTER_OFFER' || offer['counter_offer_price'] != null;
    final isSelected = offer['offer_status'] == 'SELECTED';

    final price = offer['price'] ?? _job?['price'] ?? 0;
    final counterPrice = offer['counter_offer_price'];
    final languages = (offer['languages'] as List?)?.join(', ') ?? 'Kannada, English, Hindi';

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
          // Counter offer / Tag Badge
          if (isCounterOffer)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF3C7),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.local_offer_rounded, size: 12, color: Color(0xFFD97706)),
                  const SizedBox(width: 4),
                  Text(
                    "Submitted Counter Offer",
                    style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: const Color(0xFF92400E)),
                  ),
                ],
              ),
            ),

          // Main Header Row
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ImageUtils.buildProfileImage(
                offer['worker_photo'],
                radius: 30,
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

          // Details Grid (Distance, Experience, Performance Score, Languages)
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              _buildDetailChip(Icons.location_on_rounded, offer['distance'] ?? "Nearby"),
              _buildDetailChip(Icons.work_history_rounded, "${offer['experience']} exp"),
              _buildDetailChip(Icons.stars_rounded, "Score: ${offer['performance_score']}"),
              _buildDetailChip(Icons.translate_rounded, languages),
            ],
          ),

          // Notes / Alternative Time if present
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

          // Footer Row: Price & Action Button
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
                  isSelected ? "RESERVED" : "Select Worker",
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
