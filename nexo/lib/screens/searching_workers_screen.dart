import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/ongoing_job_screen.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/screens/chat_detail_screen.dart';
import 'package:nexo/screens/job_details_screen.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:nexo/utils/image_utils.dart';

class SearchingWorkersScreen extends StatefulWidget {
  final Map<String, dynamic> job;
  const SearchingWorkersScreen({super.key, required this.job});

  @override
  State<SearchingWorkersScreen> createState() => _SearchingWorkersScreenState();
}

class _SearchingWorkersScreenState extends State<SearchingWorkersScreen>
    with WidgetsBindingObserver {
  Timer? _timer;
  int _searchRadius = 5;
  int _searchState = 1; // 1 = near, 2 = expanding, 3 = wide
  bool _isAccepted = false;
  bool _isCancelled = false;
  final String baseUrl = NetworkHelper.baseUrl;

  // ─── Computed from searchState ───────────────────────────────────────────
  int get _searchPercent => _searchState == 1 ? 30 : _searchState == 2 ? 65 : 90;
  int get _activeSegments => _searchState == 1 ? 2 : _searchState == 2 ? 4 : 5;
  String get _message => _searchState == 1
      ? "Finding partners near you..."
      : _searchState == 2
          ? "Looking in nearby areas..."
          : "Expanding search further...";

  @override
  void initState() {
    super.initState();
    _initSocket();
    _startPolling();
    WidgetsBinding.instance.addObserver(this);
  }

  void _initSocket() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId != null) {
      final socketService = SocketService();
      socketService.connect(userId);
      socketService.onJobAccepted = (data) {
        if (_isCancelled || !mounted) return;
        debugPrint("🚀 [JOB_ACCEPTED] Socket event received!");
        if (mounted && !_isAccepted) {
          setState(() => _isAccepted = true);
          _timer?.cancel();
          _showWorkerFoundPopup(data);
        }
      };
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_isCancelled) {
      debugPrint("🔄 [SEARCH] App Resumed. Refreshing search status...");
      _checkStatus();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _isCancelled = true;
    final socketService = SocketService();
    socketService.onJobAccepted = null;
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _startPolling() {
    _timer = Timer.periodic(const Duration(seconds: 3), (t) => _checkStatus());
  }

  Future<void> _checkStatus() async {
    if (_isAccepted) return;
    final userId = await SharedPrefsHelper.getUserId();
    if (userId == null) return;

    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('$baseUrl/api/jobs/$userId/ongoing'),
        headers: {if (token != null) 'Authorization': 'Bearer $token'},
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
          if (mounted && data['success']) {
            final job = data['job'];
            setState(() {
              _searchRadius = job['searchRadius'] ?? 5;
              _searchState = job['searchState'] ?? 1;
            });
            if (['ACCEPTED', 'ON_THE_WAY', 'ARRIVING', 'WORK_STARTED']
                .contains(job['status'])) {
              if (!_isAccepted) {
                setState(() => _isAccepted = true);
                _timer?.cancel();
                _showWorkerFoundPopup(job);
              }
            }
          }
          // No job in ongoing — keep polling, we are still searching
        }
    } catch (e) {
      debugPrint("Polling error: $e");
    }
  }


  void _showWorkerFoundPopup(Map<String, dynamic> data) {
    final worker = data['worker'] ?? data;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(32)),
        child: Container(
          padding: const EdgeInsets.all(24),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Align(
                  alignment: Alignment.topRight,
                  child: IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close, color: Colors.grey),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                      color: Colors.green.shade50, shape: BoxShape.circle),
                  child: const Icon(Icons.check_circle,
                      color: Color(0xFF22C55E), size: 48),
                ),
                const SizedBox(height: 16),
                Text("Partner Found!",
                    style: GoogleFonts.outfit(
                        fontSize: 22, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text("Your job request has been accepted successfully.",
                    style: GoogleFonts.inter(color: Colors.black54, fontSize: 14),
                    textAlign: TextAlign.center),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFFF3F4F6)),
                    boxShadow: [
                      BoxShadow(
                          color: Colors.black.withValues(alpha: 0.02),
                          blurRadius: 10,
                          offset: const Offset(0, 4)),
                    ],
                  ),
                  child: Row(
                    children: [
                      ImageUtils.buildProfileImage(
                        worker['worker_profile_image'] ?? worker['photo'],
                        radius: 35,
                        name: worker['worker_name'] ?? worker['name'],
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    worker['worker_name'] ??
                                        worker['name'] ??
                                        "Partner",
                                    style: GoogleFonts.outfit(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold),
                                    overflow: TextOverflow.ellipsis,
                                    maxLines: 1,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                      color: const Color(0xFFFEF3C7),
                                      borderRadius: BorderRadius.circular(12)),
                                  child: Row(
                                    children: [
                                      const Icon(Icons.star,
                                          color: Color(0xFFD97706), size: 14),
                                      Text(
                                          " ${worker['worker_rating'] ?? worker['rating'] ?? '4.8'}",
                                          style: GoogleFonts.inter(
                                              fontSize: 12,
                                              fontWeight: FontWeight.bold,
                                              color: const Color(0xFF92400E))),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            Text(
                                worker['specialization'] ??
                                    worker['category'] ??
                                    "Technician",
                                style: GoogleFonts.inter(
                                    color: const Color(0xFFD97706),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600)),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                const Icon(Icons.verified_outlined,
                                    size: 14, color: Colors.black45),
                                const SizedBox(width: 4),
                                Text(
                                    "${worker['worker_completed_jobs'] ?? worker['completed_jobs'] ?? '120+'} Jobs Completed",
                                    style: GoogleFonts.inter(
                                        color: Colors.black45, fontSize: 12)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                      color: const Color(0xFFF0FDF4),
                      borderRadius: BorderRadius.circular(16)),
                  child: Row(
                    children: [
                      const Icon(Icons.circle,
                          color: Color(0xFF22C55E), size: 10),
                      const SizedBox(width: 12),
                      Expanded(
                        child: RichText(
                          text: TextSpan(
                            children: [
                              TextSpan(
                                  text: "Accepted ",
                                  style: GoogleFonts.inter(
                                      color: const Color(0xFF166534),
                                      fontWeight: FontWeight.bold)),
                              TextSpan(
                                  text:
                                      "The partner will contact you shortly.",
                                  style: GoogleFonts.inter(
                                      color: const Color(0xFF166534))),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    const Icon(Icons.access_time, color: Colors.black54, size: 20),
                    const SizedBox(width: 12),
                    Text("Estimated arrival: ",
                        style: GoogleFonts.inter(color: Colors.black54)),
                    Text(worker['eta'] ?? "Approx. 20 mins",
                        style: GoogleFonts.inter(
                            fontWeight: FontWeight.bold, color: Colors.black87)),
                  ],
                ),
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(context);
                      Navigator.pushReplacement(
                        context,
                        MaterialPageRoute(
                            builder: (context) =>
                                OngoingJobScreen(initialJob: data)),
                      );
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFFF6A00),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 18),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16)),
                    ),
                    child: Text("Track Partner",
                        style: GoogleFonts.inter(
                            fontWeight: FontWeight.bold, fontSize: 16)),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.pop(context);
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => ChatDetailScreen(
                            jobId: widget.job['id']?.toString() ?? '',
                            name: worker['worker_name'] ??
                                worker['name'] ??
                                "Partner",
                            image: worker['worker_profile_image'] ??
                                worker['photo'] ??
                                "",
                            service: worker['specialization'] ??
                                worker['category'] ??
                                "Technician",
                          ),
                        ),
                      );
                    },
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 18),
                      side: const BorderSide(color: Color(0xFFD1D5DB)),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16)),
                    ),
                    child: Text("Chat Now",
                        style: GoogleFonts.inter(
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF1F2937))),
                  ),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => JobDetailsScreen(
                          jobId: (data['job_id'] ?? data['id']).toString(),
                          initialJob: data,
                        ),
                      ),
                    );
                  },
                  child: Text("View Job Details",
                      style: GoogleFonts.inter(
                          color: Colors.black54, fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _cancelRequest() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId == null) return;
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.patch(
        Uri.parse('$baseUrl/api/jobs/$userId/${widget.job['id']}'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({'status': 'CANCELLED'}),
      );
      final responseData = json.decode(response.body);

      if (response.statusCode == 200) {
        _isCancelled = true;
        _timer?.cancel();
        if (mounted) Navigator.pop(context, true);
      } else if (response.statusCode == 400 &&
          responseData['error'] == 'CANCEL_REJECTED') {
        debugPrint(
            "🚫 [CANCEL_REJECTED] Customer tried to cancel, but worker is already assigned.");
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                  "Partner already assigned. Please contact support or request cancellation inside the job tracking screen.",
                  style: GoogleFonts.inter()),
              backgroundColor: Colors.redAccent,
            ),
          );
          _checkStatus();
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
                content:
                    Text(responseData['message'] ?? "Failed to cancel request.")),
          );
        }
      }
    } catch (e) {
      debugPrint("Cancel error: $e");
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.black),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Row(
              children: [
                Text(
                  "Minimize",
                  style: GoogleFonts.inter(
                    color: const Color(0xFFFF6A00),
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(width: 4),
                const Icon(Icons.open_in_full_rounded,
                    color: Color(0xFFFF6A00), size: 14),
              ],
            ),
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
          child: Column(
            children: [
              const Spacer(),
              const Center(child: RadarWidget()),
              const Spacer(),

              // Title
              RichText(
                textAlign: TextAlign.center,
                text: TextSpan(
                  style: GoogleFonts.outfit(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF0F172A),
                  ),
                  children: const [
                    TextSpan(text: "Finding "),
                    TextSpan(
                        text: "partners ",
                        style: TextStyle(color: Color(0xFFFF6A00))),
                    TextSpan(text: "near you..."),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Text(
                "Radius: $_searchRadius km",
                style: GoogleFonts.inter(
                  fontSize: 13.5,
                  color: const Color(0xFF64748B),
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 24),

              // Verified banner
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFF1F5F9)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: const BoxDecoration(
                          color: Color(0xFFDCFCE7), shape: BoxShape.circle),
                      child: const Icon(Icons.shield_rounded,
                          color: Color(0xFF16A34A), size: 18),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        "We're matching you with verified and trusted professionals",
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          color: const Color(0xFF334155),
                          fontWeight: FontWeight.w500,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // 3-col info row
              Row(
                children: [
                  Expanded(
                    child: _buildInfoItem(
                      icon: Icons.location_on_rounded,
                      iconColor: const Color(0xFF10B981),
                      label: "Searching in your area",
                    ),
                  ),
                  Container(
                      width: 1, height: 40, color: const Color(0xFFE2E8F0)),
                  Expanded(
                    child: _buildInfoItem(
                      icon: Icons.verified_user_rounded,
                      iconColor: const Color(0xFF3B82F6),
                      label: "Verified professionals",
                    ),
                  ),
                  Container(
                      width: 1, height: 40, color: const Color(0xFFE2E8F0)),
                  Expanded(
                    child: _buildInfoItem(
                      icon: Icons.flash_on_rounded,
                      iconColor: const Color(0xFF8B5CF6),
                      label: "Quick response",
                    ),
                  ),
                ],
              ),
              const Spacer(),

              // Dynamic segmented progress
              _buildSegmentedProgress(),
              const SizedBox(height: 24),

              // Keep searching button
              SizedBox(
                width: double.infinity,
                height: 52,
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(26),
                    gradient: const LinearGradient(
                        colors: [Color(0xFFFF6A00), Color(0xFFFF8533)]),
                  ),
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      shadowColor: Colors.transparent,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(26)),
                    ),
                    child: Text(
                      "Keep searching in background",
                      style: GoogleFonts.inter(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                          color: Colors.white),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton(
                  onPressed: () => _cancelRequest(),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFE2E8F0), width: 1.5),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(26)),
                  ),
                  child: Text(
                    "Cancel request",
                    style: GoogleFonts.inter(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: const Color(0xFF475569)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInfoItem({
    required IconData icon,
    required Color iconColor,
    required String label,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: iconColor, size: 22),
        const SizedBox(height: 8),
        Text(
          label,
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(
            fontSize: 11,
            color: const Color(0xFF475569),
            fontWeight: FontWeight.w500,
            height: 1.3,
          ),
        ),
      ],
    );
  }

  Widget _buildSegmentedProgress() {
    return Row(
      children: [
        Expanded(
          child: Row(
            children: List.generate(5, (index) {
              final active = index < _activeSegments;
              return Expanded(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeInOut,
                  height: 6,
                  margin: EdgeInsets.only(right: index == 4 ? 0 : 6),
                  decoration: BoxDecoration(
                    color: active
                        ? const Color(0xFFFF6A00)
                        : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              );
            }),
          ),
        ),
        const SizedBox(width: 14),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 400),
          child: Text(
            "$_searchPercent%",
            key: ValueKey(_searchPercent),
            style: GoogleFonts.outfit(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: const Color(0xFFFF6A00),
            ),
          ),
        ),
      ],
    );
  }
}

// ── Radar Widget ─────────────────────────────────────────────────────────────

class RadarWidget extends StatefulWidget {
  const RadarWidget({super.key});

  @override
  State<RadarWidget> createState() => _RadarWidgetState();
}

class _RadarWidgetState extends State<RadarWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const double size = 260.0;
    const double center = size / 2;

    // DiceBear pixel-art avatar stickers — no auth, free
    final profiles = [
      {"r": 1.0,  "deg": 35.0,  "seed": "worker_raj"},
      {"r": 0.75, "deg": 140.0, "seed": "worker_ali"},
      {"r": 0.8,  "deg": 260.0, "seed": "worker_sam"},
      {"r": 1.0,  "deg": 195.0, "seed": "worker_dev"},
      {"r": 0.7,  "deg": 315.0, "seed": "worker_tom"},
    ];

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Animated radar sweep
          AnimatedBuilder(
            animation: _controller,
            builder: (context, child) {
              return CustomPaint(
                size: const Size(size - 40, size - 40),
                painter: RadarPainter(_controller.value * 2 * pi),
              );
            },
          ),

          // Avatar stickers on the rings
          ...profiles.map((p) {
            final double r = (size - 40) / 2 * (p["r"] as double);
            final double rad = (p["deg"] as double) * pi / 180;
            final double dx = center + r * cos(rad) - 19;
            final double dy = center + r * sin(rad) - 19;
            final String avatarUrl =
                "https://api.dicebear.com/7.x/pixel-art/png?seed=${p["seed"]}&size=64";

            return Positioned(
              left: dx,
              top: dy,
              child: Container(
                padding: const EdgeInsets.all(2),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                        color: Colors.black12,
                        blurRadius: 6,
                        offset: Offset(0, 2)),
                  ],
                ),
                child: ClipOval(
                  child: Image.network(
                    avatarUrl,
                    width: 34,
                    height: 34,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      width: 34,
                      height: 34,
                      color: const Color(0xFFFFF7ED),
                      child: const Icon(Icons.person,
                          size: 18, color: Color(0xFFFF6A00)),
                    ),
                  ),
                ),
              ),
            );
          }),

          // Centre icon
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFFF6A00).withValues(alpha: 0.15),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
              border: Border.all(
                  color: const Color(0xFFFF6A00).withValues(alpha: 0.2),
                  width: 1.5),
            ),
            child: const Center(
              child: Icon(Icons.person_search_rounded,
                  color: Color(0xFFFF6A00), size: 26),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Radar Painter ─────────────────────────────────────────────────────────────

class RadarPainter extends CustomPainter {
  final double angle;
  RadarPainter(this.angle);

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final maxRadius = size.width / 2;

    final ringPaint = Paint()
      ..color = const Color(0xFFFF6A00).withValues(alpha: 0.08)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    canvas.drawCircle(center, maxRadius, ringPaint);
    canvas.drawCircle(center, maxRadius * 0.7, ringPaint);
    canvas.drawCircle(center, maxRadius * 0.4, ringPaint);

    final sectorPaint = Paint()
      ..shader = SweepGradient(
        center: Alignment.center,
        startAngle: 0.0,
        endAngle: 2 * pi,
        colors: [
          const Color(0xFFFF6A00).withValues(alpha: 0.35),
          const Color(0xFFFF6A00).withValues(alpha: 0.0),
        ],
        stops: const [0.0, 0.25],
        transform: GradientRotation(angle - 0.25 * 2 * pi),
      ).createShader(Rect.fromCircle(center: center, radius: maxRadius))
      ..style = PaintingStyle.fill;

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: maxRadius),
      angle,
      1.5,
      true,
      sectorPaint,
    );
  }

  @override
  bool shouldRepaint(covariant RadarPainter oldDelegate) =>
      oldDelegate.angle != angle;
}
