import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import 'dart:convert';
import 'package:intl/intl.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/services/service_data.dart';
import 'package:nexo/screens/job_details_screen.dart';
import 'package:nexo/screens/rating_screen.dart';
import 'package:nexo/screens/chat_detail_screen.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:nexo/components/glass_components.dart';

class TabItem {
  final String label;
  final IconData icon;
  final List<Color> gradient;
  final Color glowColor;

  const TabItem({
    required this.label,
    required this.icon,
    required this.gradient,
    required this.glowColor,
  });
}

class MyJobsScreen extends StatefulWidget {
  final Function(int)? onTabChange;
  const MyJobsScreen({super.key, this.onTabChange});

  @override
  State<MyJobsScreen> createState() => _MyJobsScreenState();
}

class _MyJobsScreenState extends State<MyJobsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final Color primaryColor = const Color(0xFFFF6A00);
  String _sortBy = "Newest";
  List<dynamic> _jobs = [];
  bool _isLoading = true;
  String? _userPhoto;

  // Cached credentials â€” loaded once in initState to avoid repeated SharedPrefs disk reads
  String? _cachedUserId;
  String? _cachedToken;

  String _formatDateTime(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return "";
    try {
      final dt = DateTime.parse(dateStr).toLocal();
      return DateFormat('dd MMM, hh:mm a').format(dt);
    } catch (e) {
      return "";
    }
  }

  String _formatTimeOnly(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return "";
    try {
      final dt = DateTime.parse(dateStr).toLocal();
      return DateFormat('hh:mm a').format(dt);
    } catch (e) {
      return "";
    }
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(() {
      // Rebuild on tab index change (like swiping) to animate sliding pill
      if (!_tabController.indexIsChanging) {
        setState(() {});
      }
    });
    _initAll();
  }

  /// Load credentials once, then kick off all parallel async work
  Future<void> _initAll() async {
    _cachedUserId = await SharedPrefsHelper.getUserId();
    _cachedToken = await SharedPrefsHelper.getToken();
    // Run fetch + profile + socket in parallel now that credentials are cached
    await Future.wait([
      _fetchJobs(),
      _loadProfile(),
    ]);
    _initSocket();
  }

  void _initSocket() {
    final userId = _cachedUserId;
    if (userId != null) {
      final socketService = SocketService();
      socketService.connect(userId);
      
      final refreshCallback = (_) {
        if (mounted) {
          debugPrint("ðŸ”„ [MyJobsScreen] Real-time event received, refreshing jobs...");
          _fetchJobs();
        }
      };

      socketService.socket?.on('job_status_updated', refreshCallback);
      socketService.socket?.on('JOB_ACCEPTED', refreshCallback);
      socketService.socket?.on('job_accepted', refreshCallback);
      socketService.socket?.on('WORKER_CANCELLED_JOB', refreshCallback);
      socketService.socket?.on('job_cancelled_by_user', refreshCallback);
    }
  }

  Future<void> _loadProfile() async {
    final userId = _cachedUserId;
    if (userId == null) return;
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/user/profile/$userId'),
        headers: {
          if (_cachedToken != null) 'Authorization': 'Bearer $_cachedToken',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          setState(() {
            _userPhoto = data['user']['photoUrl'];
          });
        }
      }
    } catch (e) {
      debugPrint("Error loading profile: $e");
    }
  }

  Future<void> _fetchJobs() async {
    try {
      // Use cached credentials; fallback to SharedPrefs if cache is empty (e.g. first pull-to-refresh)
      final userId = _cachedUserId ?? await SharedPrefsHelper.getUserId();
      final token = _cachedToken ?? await SharedPrefsHelper.getToken();

      if (userId == null) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/history/$userId'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) {
          setState(() {
            _jobs = (data['jobs'] as List?)?.where((j) => j != null).toList() ?? [];
            _isLoading = false;
          });
        }
      } else {
        if (mounted) setState(() => _isLoading = false);
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String _getCategoryImage(String category, String description) {
    return ImageUtils.getCategoryAsset(category);
  }

  Future<void> _makeCall(String? phone) async {
    final phoneNumber = phone ?? '143143';
    final Uri launchUri = Uri(
      scheme: 'tel',
      path: phoneNumber,
    );
    await launchUrl(launchUri);
  }

  void _showJobDetails(Map<String, dynamic> job) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => JobDetailsScreen(
          jobId: (job['id'] ?? job['job_id'] ?? "").toString(), 
          initialJob: job
        )
      ),
    ).then((_) => _fetchJobs());
  }

  void _editJob(Map<String, dynamic> job) {
    final budgetController = TextEditingController(text: job['price']?.toString() ?? job['budget']?.toString() ?? '500');
    String selectedSchedule = job['scheduled_at'] ?? "Today";
    String selectedDuration = job['estimated_duration'] ?? "2-4 Hours";
    bool isUrgent = job['isUrgent'] == true;

    int selectedDayIndex = 0;
    String? tempTime;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) => Container(
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
          child: GlassContainer(
            borderRadius: 30,
            blur: 30,
            color: Colors.black.withOpacity(0.95),
            border: Border.all(color: Colors.white.withOpacity(0.15)),
            padding: const EdgeInsets.all(24),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2)))),
                  const SizedBox(height: 24),
                  Text(
                    "Edit Gig Request", 
                    style: GoogleFonts.outfit(
                      fontSize: 22, 
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    )
                  ),
                  const SizedBox(height: 24),
                  _buildEditField("Budget (â‚¹)", budgetController, Icons.currency_rupee_rounded, keyboardType: TextInputType.number),
                  const SizedBox(height: 24),
                  
                  // Day Selector
                  Text("Select Schedule Day", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white70)),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 50,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: 7,
                      itemBuilder: (context, index) {
                        final now = DateTime.now();
                        final date = now.add(Duration(days: index));
                        final dayName = index == 0 ? "Today" : index == 1 ? "Tomorrow" : "${date.day}/${date.month}";
                        bool isSelected = selectedDayIndex == index;
                        return GestureDetector(
                          onTap: () => setModalState(() => selectedDayIndex = index),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            width: 90,
                            margin: const EdgeInsets.only(right: 12),
                            decoration: BoxDecoration(
                              color: isSelected ? primaryColor : Colors.white.withOpacity(0.08),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: isSelected ? primaryColor : Colors.white12),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              dayName, 
                              style: GoogleFonts.inter(
                                color: Colors.white, 
                                fontWeight: FontWeight.bold, 
                                fontSize: 12
                              )
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 24),
                  
                  // Time Slot Selector
                  Text("Select Time Slot", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white70)),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 45,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: 20,
                      itemBuilder: (context, index) {
                        final now = DateTime.now();
                        final startHour = selectedDayIndex == 0 ? (now.hour + (now.minute >= 30 ? 1 : 0)) : 8;
                        final startMinute = selectedDayIndex == 0 ? (now.minute >= 30 ? 0 : 30) : 0;
                        final totalMinutes = (startHour * 60) + startMinute + (index * 30);
                        final h = (totalMinutes ~/ 60) % 24;
                        final m = totalMinutes % 60;
                        final period = h < 12 ? "AM" : "PM";
                        final displayH = h == 0 ? 12 : (h > 12 ? h - 12 : h);
                        final timeString = "$displayH:${m.toString().padLeft(2, '0')} $period";
                        bool isTimeSelected = tempTime == timeString;
 
                        return GestureDetector(
                          onTap: () => setModalState(() => tempTime = timeString),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            margin: const EdgeInsets.only(right: 10),
                            decoration: BoxDecoration(
                              color: isTimeSelected ? primaryColor : Colors.white.withOpacity(0.08),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: isTimeSelected ? primaryColor : Colors.white10),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              timeString, 
                              style: GoogleFonts.inter(
                                color: Colors.white, 
                                fontWeight: FontWeight.w600, 
                                fontSize: 12
                              )
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 24),
                  
                  // Duration Selector
                  Text("Estimated Duration", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white70)),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    children: ["< 1 Hour", "2-4 Hours", "Half Day", "Full Day", "1 Week"].map((d) {
                      final isSelected = selectedDuration == d;
                      return ChoiceChip(
                        label: Text(d),
                        selected: isSelected,
                        onSelected: (val) => setModalState(() => selectedDuration = d),
                        selectedColor: primaryColor,
                        backgroundColor: Colors.white.withOpacity(0.08),
                        labelStyle: GoogleFonts.inter(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),
 
                  SwitchListTile(
                    title: Text("Mark as Urgent", style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: Colors.white)),
                    subtitle: Text("Prioritize request for instant dispatch", style: GoogleFonts.inter(fontSize: 12, color: Colors.white54)),
                    value: isUrgent,
                    activeColor: primaryColor,
                    contentPadding: EdgeInsets.zero,
                    onChanged: (val) => setModalState(() => isUrgent = val),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton(
                      onPressed: () {
                        final date = DateTime.now().add(Duration(days: selectedDayIndex));
                        final dateStr = selectedDayIndex == 0 ? "Today" : selectedDayIndex == 1 ? "Tomorrow" : "${date.day}/${date.month}";
                        final finalSchedule = isUrgent ? "Today" : "$dateStr at ${tempTime ?? 'ASAP'}";
                        
                        Navigator.pop(context);
                        _updateJob(job['id'], {
                          'price': double.tryParse(budgetController.text) ?? 500.0,
                          'scheduled_at': finalSchedule,
                          'estimated_duration': selectedDuration,
                          'isUrgent': isUrgent,
                        });
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: primaryColor,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        elevation: 4,
                      ),
                      child: Text(
                        "SAVE CHANGES", 
                        style: GoogleFonts.inter(fontWeight: FontWeight.bold, letterSpacing: 0.5, color: Colors.white)
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _updateJob(String jobId, Map<String, dynamic> updates) async {
    setState(() => _isLoading = true);
    try {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();
      final response = await http.patch(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/$userId/$jobId'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode(updates),
      );
      if (response.statusCode == 200) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Request updated successfully!"), backgroundColor: Colors.green));
        }
        _fetchJobs();
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Failed to update request."), backgroundColor: Colors.redAccent));
        }
        setState(() => _isLoading = false);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Error updating request."), backgroundColor: Colors.redAccent));
      }
      setState(() => _isLoading = false);
    }
  }

  Future<void> _cancelJob(String jobId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text("Cancel Gig", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.redAccent)),
        content: Text("Are you sure you want to cancel this request?", style: GoogleFonts.inter(color: Colors.white70)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false), 
            child: Text("No", style: GoogleFonts.inter(color: Colors.white54))
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true), 
            child: Text("Yes, Cancel", style: GoogleFonts.inter(color: Colors.redAccent, fontWeight: FontWeight.bold))
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await _updateJob(jobId, {'status': 'CANCELLED'});
    }
  }

  Widget _buildEditField(String label, TextEditingController controller, IconData icon, {TextInputType? keyboardType, int maxLines = 1}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white70)),
        const SizedBox(height: 8),
        GlassContainer(
          borderRadius: 12,
          blur: 10,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          color: Colors.white.withOpacity(0.08),
          border: Border.all(color: Colors.white10),
          child: TextField(
            controller: controller,
            keyboardType: keyboardType,
            maxLines: maxLines,
            style: GoogleFonts.inter(color: Colors.white),
            decoration: InputDecoration(
              border: InputBorder.none, 
              icon: Icon(icon, size: 20, color: Colors.white54),
              hintStyle: GoogleFonts.inter(color: Colors.white30),
            ),
          ),
        ),
      ],
    );
  }

  void _showWorkerDetails(Map<String, dynamic> job) {
    final workerName = job['workerName'] ?? 'Expert Professional';
    final workerPhoto = job['workerPhoto'];
    final workerPhone = job['workerPhone'];
    final workerSkills = (job['workerSkills'] as List?)?.first ?? 'Technician';
    final isDark = Theme.of(context).brightness == Brightness.dark;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => GlassContainer(
        borderRadius: 30,
        blur: 35,
        color: Colors.black.withOpacity(0.95),
        border: Border.all(color: Colors.white.withOpacity(0.15)),
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 24),
            Row(
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundColor: primaryColor.withOpacity(0.1),
                  backgroundImage: workerPhoto != null && workerPhoto.toString().isNotEmpty
                      ? NetworkImage(workerPhoto.toString().startsWith('http')
                          ? workerPhoto
                          : '${NetworkHelper.baseUrl}$workerPhoto')
                      : null,
                  child: workerPhoto == null || workerPhoto.toString().isEmpty
                      ? const Icon(Icons.person, size: 32, color: Colors.orange)
                      : null,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        workerName, 
                        style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.verified_rounded, color: Colors.greenAccent, size: 16),
                          const SizedBox(width: 4),
                          Text(
                            workerSkills, 
                            style: GoogleFonts.inter(color: Colors.white70, fontSize: 13)
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Colors.greenAccent.withOpacity(0.12), shape: BoxShape.circle),
                  child: const Icon(Icons.verified, color: Colors.greenAccent, size: 20),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: _buildWideGradientButton(
                    text: "CALL NOW",
                    icon: Icons.phone_rounded,
                    onPressed: () => _makeCall(workerPhone),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildWideGlassButton(
                    text: "MESSAGE",
                    icon: Icons.chat_bubble_outline_rounded,
                    onPressed: () {
                      Navigator.pop(context);
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => ChatDetailScreen(
                            jobId: job['id']?.toString() ?? '',
                            name: workerName,
                            image: workerPhoto != null && workerPhoto.toString().isNotEmpty
                                ? (workerPhoto.toString().startsWith('http') ? workerPhoto : '${NetworkHelper.baseUrl}$workerPhoto')
                                : "assets/images/skilled/trades/ac technician.jpg",
                            service: workerSkills,
                          ),
                        ),
                      );
                    },
                    isDark: isDark,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Color getInterpolatedColor(double value, List<TabItem> tabs, bool isStart) {
    int index1 = value.floor().clamp(0, tabs.length - 1);
    int index2 = value.ceil().clamp(0, tabs.length - 1);
    double t = value - index1;
    Color c1 = isStart ? tabs[index1].gradient[0] : tabs[index1].gradient[1];
    Color c2 = isStart ? tabs[index2].gradient[0] : tabs[index2].gradient[1];
    return Color.lerp(c1, c2, t) ?? c1;
  }

  // A brand new formatted floating sliding pill selector for Gigs (Dynamic Island format)
  Widget _buildDynamicTabSelector() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final tabs = [
      TabItem(
        label: "New",
        icon: Icons.auto_awesome_rounded,
        gradient: [const Color(0xFF3B82F6), const Color(0xFF1D4ED8)],
        glowColor: const Color(0xFF3B82F6),
      ),
      TabItem(
        label: "Active",
        icon: Icons.bolt_rounded,
        gradient: [const Color(0xFFF59E0B), const Color(0xFFD97706)],
        glowColor: const Color(0xFFF59E0B),
      ),
      TabItem(
        label: "Done",
        icon: Icons.check_circle_rounded,
        gradient: [const Color(0xFF10B981), const Color(0xFF059669)],
        glowColor: const Color(0xFF10B981),
      ),
      TabItem(
        label: "Cancelled",
        icon: Icons.cancel_rounded,
        gradient: [const Color(0xFFEF4444), const Color(0xFFDC2626)],
        glowColor: const Color(0xFFEF4444),
      ),
    ];

    final animation = _tabController.animation;
    if (animation == null) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: GlassContainer(
        borderRadius: 24,
        blur: 18,
        height: 56,
        padding: const EdgeInsets.all(4),
        color: isDark ? Colors.white.withOpacity(0.06) : Colors.black.withOpacity(0.04),
        border: Border.all(color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.06)),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final totalWidth = constraints.maxWidth;
            final tabWidth = totalWidth / 4.0;
            
            return AnimatedBuilder(
              animation: animation,
              builder: (context, child) {
                final value = animation.value;
                final left = value * tabWidth;
                
                // Dynamically interpolate capsule gradient start/end colors!
                final colorStart = getInterpolatedColor(value, tabs, true);
                final colorEnd = getInterpolatedColor(value, tabs, false);
                final activeGlow = Color.lerp(
                  tabs[value.floor().clamp(0, 3)].glowColor,
                  tabs[value.ceil().clamp(0, 3)].glowColor,
                  value - value.floor(),
                ) ?? const Color(0xFFFF6A00);

                return Stack(
                  children: [
                    // Dynamic capsule with real-time sliding & morphing gradient!
                    Positioned(
                      left: left,
                      top: 0,
                      bottom: 0,
                      width: tabWidth,
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [colorStart, colorEnd],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: [
                            BoxShadow(
                              color: activeGlow.withOpacity(0.35),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                      ),
                    ),
                    
                    // Tab items row overlay
                    Row(
                      children: List.generate(tabs.length, (index) {
                        // Calculate weight of selection (1.0 = fully active, 0.0 = completely inactive)
                        final distance = (value - index).abs();
                        final selectWeight = (1.0 - distance).clamp(0.0, 1.0);
                        
                        final isSelected = distance < 0.5;
                        final tab = tabs[index];
                        
                        return Expanded(
                          child: GestureDetector(
                            onTap: () {
                              _tabController.animateTo(index);
                            },
                            behavior: HitTestBehavior.opaque,
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      tab.icon,
                                      size: 14,
                                      color: Color.lerp(
                                        isDark ? Colors.white60 : Colors.black54,
                                        Colors.white,
                                        selectWeight,
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      tab.label,
                                      style: GoogleFonts.outfit(
                                        fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                                        fontSize: 12,
                                        color: Color.lerp(
                                          isDark ? Colors.white60 : Colors.black54,
                                          Colors.white,
                                          selectWeight,
                                        ),
                                        letterSpacing: 0.1,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      }),
                    ),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? Colors.white : const Color(0xFF111111);

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.menu_rounded, color: textPrimary),
          onPressed: () {},
        ),
        title: Text(
          "My Gigs",
          style: GoogleFonts.outfit(
            color: textPrimary,
            fontWeight: FontWeight.w900,
            fontSize: 22,
          ),
        ),
        actions: [
          PopupMenuButton<String>(
            icon: Icon(Icons.filter_list_rounded, color: primaryColor),
            color: const Color(0xFF1E293B),
            onSelected: (val) => setState(() => _sortBy = val),
            itemBuilder: (context) => [
              PopupMenuItem(value: "Newest", child: Text("Newest first", style: GoogleFonts.inter(color: Colors.white))),
              PopupMenuItem(value: "Price", child: Text("Sort by Price", style: GoogleFonts.inter(color: Colors.white))),
              PopupMenuItem(value: "Status", child: Text("Sort by Status", style: GoogleFonts.inter(color: Colors.white))),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: GestureDetector(
              onTap: () => widget.onTabChange?.call(4), // navigate to profile
              child: ImageUtils.buildProfileImage(
                _userPhoto != null ? '${NetworkHelper.baseUrl}$_userPhoto' : null,
                radius: 16,
              ),
            ),
          ),
        ],
        // Replace old PreferredSize TabBar with our custom animated floating segmented island
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: _buildDynamicTabSelector(),
        ),
      ),
      body: PremiumBackground(
        child: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    RefreshIndicator(
                      onRefresh: _fetchJobs,
                      color: primaryColor,
                      child: _buildJobsList("New"),
                    ),
                    RefreshIndicator(
                      onRefresh: _fetchJobs,
                      color: primaryColor,
                      child: _buildJobsList("Active"),
                    ),
                    RefreshIndicator(
                      onRefresh: _fetchJobs,
                      color: primaryColor,
                      child: _buildJobsList("Completed"),
                    ),
                    RefreshIndicator(
                      onRefresh: _fetchJobs,
                      color: primaryColor,
                      child: _buildJobsList("Cancelled"),
                    ),
                  ],
                ),
              ),
              
              // Bottom Promotion/Alert Banner Card
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 80),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFBFDBFE)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.shield_rounded, color: Color(0xFF2563EB), size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          "Safety Guarantee: Always pay within Nexo to be covered under our â‚¹10k protection policy.",
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            color: const Color(0xFF1E3A8A),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildJobsList(String tab) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textSecondary = isDark ? Colors.white60 : Colors.black54;

    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)));
    }

    final filteredJobs = _jobs.where((job) {
      final status = job['status'] ?? "OPEN";
      if (tab == "New") return status == "OPEN" || status == "REQUESTED" || status == "REDISTRIBUTING" || status == "REASSIGNING";
      if (tab == "Active") return status != "COMPLETED" && status != "CANCELLED" && status != "OPEN" && status != "REQUESTED" && status != "REDISTRIBUTING" && status != "REASSIGNING";
      if (tab == "Completed") return status == "COMPLETED";
      if (tab == "Cancelled") return status == "CANCELLED";
      return false;
    }).toList();

    // Sort logic
    if (_sortBy == "Price") {
      filteredJobs.sort((a, b) => (double.tryParse(b['price']?.toString() ?? '0') ?? 0.0)
          .compareTo(double.tryParse(a['price']?.toString() ?? '0') ?? 0.0));
    } else if (_sortBy == "Status") {
      filteredJobs.sort((a, b) => (a['status'] ?? "").toString().compareTo((b['status'] ?? "").toString()));
    } else {
      // Default: Newest first
      filteredJobs.sort((a, b) => (b['created_at'] ?? "").toString().compareTo((a['created_at'] ?? "").toString()));
    }

    if (filteredJobs.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 120),
          Center(
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.06),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    tab == "Cancelled" 
                        ? Icons.cancel_outlined 
                        : tab == "Completed" 
                            ? Icons.assignment_turned_in_rounded 
                            : Icons.assignment_outlined, 
                    size: 64, 
                    color: primaryColor.withOpacity(0.6),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  "No ${tab == 'Completed' ? 'Completed' : tab} Gigs", 
                  style: GoogleFonts.outfit(fontSize: 18, color: Colors.white, fontWeight: FontWeight.bold)
                ),
                const SizedBox(height: 4),
                Text(
                  tab == "Active" 
                      ? "Create a gig and match with experts!" 
                      : "Your gigs will appear here.", 
                  style: GoogleFonts.inter(fontSize: 13, color: textSecondary)
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
      itemCount: filteredJobs.length,
      itemBuilder: (context, index) {
        final job = filteredJobs[index];
        final isNew = job['status'] == 'OPEN' || job['status'] == 'REQUESTED' || job['status'] == 'REDISTRIBUTING' || job['status'] == 'REASSIGNING';
        final isCancelled = job['status'] == 'CANCELLED';
        final isCompleted = job['status'] == 'COMPLETED';
        final categoryImage = _getCategoryImage(job['category'] ?? "", job['description'] ?? "");
        
        if (isNew || isCancelled) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _buildNewOrCancelledGigCard(job, categoryImage, isCancelled),
          );
        } else if (isCompleted) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _buildCompletedGigCard(job, categoryImage),
          );
        } else {
          return Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _buildActiveGigCard(job, categoryImage),
          );
        }
      },
    );
  }

  // Card for NEW/PENDING or CANCELLED gigs
  Widget _buildNewOrCancelledGigCard(Map<String, dynamic> job, String image, bool isCancelled) {
    final formattedId = "TASK-${(job['id'] ?? "000000").toString().substring(0, 6).toUpperCase()}";
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cardTextPrimary = isDark ? Colors.white : const Color(0xFF0F172A);
    final cardTextSecondary = isDark ? const Color(0xFF94A3B8) : const Color(0xFF475569);

    return GestureDetector(
      onTap: () => _showJobDetails(job),
      child: GlassContainer(
        blur: 20,
        padding: EdgeInsets.zero,
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 5),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: ImageUtils.buildServiceImage(
                            image,
                            taskName: job['category'],
                            width: 58,
                            height: 58,
                            fit: BoxFit.cover,
                            fallback: Container(width: 58, height: 58, color: Colors.white10, child: const Icon(Icons.construction, color: Colors.orange)),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    formattedId,
                                    style: GoogleFonts.inter(color: primaryColor, fontWeight: FontWeight.bold, fontSize: 10),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: isCancelled ? Colors.redAccent.withOpacity(0.12) : Colors.blueAccent.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(color: isCancelled ? Colors.redAccent.withOpacity(0.2) : Colors.blueAccent.withOpacity(0.2)),
                                    ),
                                    child: Text(
                                      isCancelled ? "CANCELLED" : "DISPATCHING",
                                      style: GoogleFonts.inter(
                                        color: isCancelled ? Colors.redAccent : Colors.blueAccent,
                                        fontWeight: FontWeight.w900,
                                        fontSize: 9,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 3),
                              Text(
                                job['category'] ?? "General Job",
                                style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 18, color: cardTextPrimary, letterSpacing: 0.1),
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 5),
                              Row(
                                children: [
                                  Text(
                                    job['price'] != null ? "â‚¹${job['price']}" : "TBD",
                                    style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 16, color: primaryColor),
                                  ),
                                  const SizedBox(width: 8),
                                  Container(width: 3, height: 3, decoration: BoxDecoration(color: cardTextSecondary.withOpacity(0.5), shape: BoxShape.circle)),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      isCancelled
                                          ? "Cancelled: ${_formatDateTime(job['cancelled_at'])}"
                                          : "Scheduled: ${job['scheduled_at'] ?? 'Today'} (Created: ${_formatDateTime(job['created_at'])})",
                                      style: GoogleFonts.inter(color: cardTextSecondary, fontSize: 11, fontWeight: FontWeight.w500),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (job['description'] != null && job['description'].toString().isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        job['description'].toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          color: cardTextSecondary,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          height: 1.3,
                        ),
                      ),
                    ],
                    if (!isCancelled) ...[
                      const SizedBox(height: 16),
                      const Divider(color: Colors.white12, height: 1),
                      const SizedBox(height: 14),
                      Column(
                        children: [
                          _buildWideGradientButton(
                            text: "EDIT GIG DETAILS",
                            icon: Icons.edit_rounded,
                            onPressed: () => _editJob(job),
                          ),
                          const SizedBox(height: 10),
                          _buildWideGlassButton(
                            text: "CANCEL REQUEST",
                            icon: Icons.cancel_outlined,
                            onPressed: () => _cancelJob(job['id']),
                            isDark: isDark,
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
            Positioned(
              top: 0,
              bottom: 0,
              left: 0,
              child: Container(
                width: 5,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: isCancelled
                        ? [const Color(0xFFEF4444), const Color(0xFFB91C1C)]
                        : [const Color(0xFF3B82F6), const Color(0xFF1D4ED8)],
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                  ),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(20),
                    bottomLeft: Radius.circular(20),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Card for ACTIVE gigs in progress
  Widget _buildActiveGigCard(Map<String, dynamic> job, String image) {
    final formattedId = "TASK-${(job['id'] ?? "000000").toString().substring(0, 6).toUpperCase()}";
    final status = job['status'] ?? "ACCEPTED";
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cardTextPrimary = isDark ? Colors.white : const Color(0xFF0F172A);
    final cardTextSecondary = isDark ? const Color(0xFF94A3B8) : const Color(0xFF475569);

    int currentStep = 0;
    Color statusColor = Colors.amber;
    if (status == 'ON_THE_WAY') {
      currentStep = 1;
      statusColor = Colors.blueAccent;
    } else if (status == 'ARRIVED' || status == 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
      currentStep = 2;
      statusColor = Colors.tealAccent;
    } else if (status == 'WORK_IN_PROGRESS' || status == 'WAITING_FOR_PAYMENT') {
      currentStep = 3;
      statusColor = Colors.greenAccent;
    }

    return GestureDetector(
      onTap: () => _showJobDetails(job),
      child: GlassContainer(
        blur: 20,
        padding: EdgeInsets.zero,
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 5),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: ImageUtils.buildServiceImage(
                            image,
                            taskName: job['category'],
                            width: 60,
                            height: 60,
                            fit: BoxFit.cover,
                            fallback: Container(width: 60, height: 60, color: Colors.white10),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    formattedId,
                                    style: GoogleFonts.inter(color: primaryColor, fontWeight: FontWeight.bold, fontSize: 10),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: statusColor.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(color: statusColor.withOpacity(0.2)),
                                    ),
                                    child: Text(
                                      status.replaceAll('_', ' '),
                                      style: GoogleFonts.inter(
                                        color: statusColor,
                                        fontWeight: FontWeight.w900,
                                        fontSize: 9,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 3),
                              Text(
                                job['category'] ?? "General Job",
                                style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 18, color: cardTextPrimary, letterSpacing: 0.1),
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 5),
                              Row(
                                children: [
                                  Text(
                                    "â‚¹${job['price'] ?? '500'}",
                                    style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 16, color: primaryColor),
                                  ),
                                  const SizedBox(width: 8),
                                  Container(width: 3, height: 3, decoration: BoxDecoration(color: cardTextSecondary.withOpacity(0.5), shape: BoxShape.circle)),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      job['workerName'] ?? "Expert Technician",
                                      style: GoogleFonts.inter(color: cardTextSecondary, fontSize: 12, fontWeight: FontWeight.bold),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (job['description'] != null && job['description'].toString().isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        job['description'].toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          color: cardTextSecondary,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          height: 1.3,
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        return Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _buildActiveStep("Accepted", currentStep >= 0, isDark, timestamp: _formatTimeOnly(job['accepted_at'])),
                            _buildActiveLine(currentStep >= 1, isDark),
                            _buildActiveStep("On Way", currentStep >= 1, isDark, timestamp: _formatTimeOnly(job['on_the_way_at'])),
                            _buildActiveLine(currentStep >= 2, isDark),
                            _buildActiveStep("Arrived", currentStep >= 2, isDark, timestamp: _formatTimeOnly(job['arrived_at'])),
                            _buildActiveLine(currentStep >= 3, isDark),
                            _buildActiveStep("Working", currentStep >= 3, isDark, timestamp: _formatTimeOnly(job['started_at'])),
                          ],
                        );
                      },
                    ),
                    const SizedBox(height: 18),
                    const Divider(color: Colors.white12, height: 1),
                    const SizedBox(height: 14),
                    Column(
                      children: [
                        _buildWideGradientButton(
                          text: "VIEW EXPERT PROFILE",
                          icon: Icons.badge_rounded,
                          onPressed: () => _showWorkerDetails(job),
                        ),
                        const SizedBox(height: 10),
                        _buildWideGlassButton(
                          text: "CHAT WITH EXPERT",
                          icon: Icons.chat_bubble_outline_rounded,
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) => ChatDetailScreen(
                                  jobId: job['id']?.toString() ?? '',
                                  name: job['workerName'] ?? 'Expert',
                                  image: job['workerPhoto'] != null && job['workerPhoto'].toString().isNotEmpty
                                      ? (job['workerPhoto'].toString().startsWith('http') ? job['workerPhoto'] : '${NetworkHelper.baseUrl}${job['workerPhoto']}')
                                      : "assets/images/skilled/trades/ac technician.jpg",
                                  service: (job['workerSkills'] as List?)?.first ?? 'Technician',
                                ),
                              ),
                            );
                          },
                          isDark: isDark,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            Positioned(
              top: 0,
              bottom: 0,
              left: 0,
              child: Container(
                width: 5,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFFF59E0B), Color(0xFFD97706)],
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                  ),
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(20),
                    bottomLeft: Radius.circular(20),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Card for COMPLETED gigs
  Widget _buildCompletedGigCard(Map<String, dynamic> job, String image) {
    final formattedId = "TASK-${(job['id'] ?? "000000").toString().substring(0, 6).toUpperCase()}";
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cardTextPrimary = isDark ? Colors.white : const Color(0xFF0F172A);
    final cardTextSecondary = isDark ? const Color(0xFF94A3B8) : const Color(0xFF475569);

    return GestureDetector(
      onTap: () => _showJobDetails(job),
      child: GlassContainer(
        blur: 20,
        padding: EdgeInsets.zero,
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 5),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: ImageUtils.buildServiceImage(
                            image,
                            taskName: job['category'],
                            width: 58,
                            height: 58,
                            fit: BoxFit.cover,
                            fallback: Container(width: 58, height: 58, color: Colors.white10),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    formattedId,
                                    style: GoogleFonts.inter(color: primaryColor, fontWeight: FontWeight.bold, fontSize: 10),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: Colors.greenAccent.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(color: Colors.greenAccent.withOpacity(0.2)),
                                    ),
                                    child: Text(
                                      "GIG SUCCESS",
                                      style: GoogleFonts.inter(
                                        color: Colors.greenAccent,
                                        fontWeight: FontWeight.w900,
                                        fontSize: 9,
                                        letterSpacing: 0.5,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 3),
                              Text(
                                job['category'] ?? "General Job",
                                style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 18, color: cardTextPrimary, letterSpacing: 0.1),
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 5),
                              Row(
                                children: [
                                  Text(
                                    "â‚¹${job['price'] ?? '500'}",
                                    style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 16, color: primaryColor),
                                  ),
                                  const SizedBox(width: 8),
                                  Container(width: 3, height: 3, decoration: BoxDecoration(color: cardTextSecondary.withOpacity(0.5), shape: BoxShape.circle)),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      "${job['workerName'] ?? 'Expert'} â€¢ Completed ${_formatDateTime(job['completed_at'] ?? job['complete_at'])}",
                                      style: GoogleFonts.inter(color: cardTextSecondary, fontSize: 11, fontWeight: FontWeight.w500),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (job['description'] != null && job['description'].toString().isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        job['description'].toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          color: cardTextSecondary,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          height: 1.3,
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    const Divider(color: Colors.white12, height: 1),
                    const SizedBox(height: 14),
                    Column(
                      children: [
                        _buildWideGradientButton(
                          text: "RATE EXPERT",
                          icon: Icons.star_rounded,
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) => RatingScreen(job: {
                                  ...job,
                                  'worker': {
                                    'id': job['worker_id'],
                                    'name': job['workerName'] ?? 'Expert',
                                    'photoUrl': job['workerPhoto'] ?? '',
                                    'category': job['category'] ?? 'Technician',
                                  }
                                }),
                              ),
                            ).then((_) => _fetchJobs());
                          },
                        ),
                        const SizedBox(height: 10),
                        _buildWideGlassButton(
                          text: "VIEW DETAILS",
                          onPressed: () => _showJobDetails(job),
                          isDark: isDark,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            Positioned(
              top: 0,
              bottom: 0,
              left: 0,
              child: Container(
                width: 5,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFF10B981), Color(0xFF059669)],
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                  ),
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(20),
                    bottomLeft: Radius.circular(20),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Robust, fully-expanded action buttons (Generous height of 48px to prevent shrinking)
  Widget _buildWideGradientButton({required String text, IconData? icon, required VoidCallback onPressed}) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        height: 46,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(
            colors: [Color(0xFFF97316), Color(0xFFFF8C00)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFFF6A00).withOpacity(0.25),
              blurRadius: 10,
              offset: const Offset(0, 4),
            )
          ]
        ),
        child: Center(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: Colors.white),
                const SizedBox(width: 8),
              ],
              Text(
                text,
                style: GoogleFonts.inter(
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                  color: Colors.white,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildWideGlassButton({required String text, IconData? icon, required VoidCallback onPressed, required bool isDark}) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        height: 46,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.05),
          border: Border.all(
            color: isDark ? Colors.white.withOpacity(0.12) : Colors.black.withOpacity(0.08),
            width: 1.2,
          ),
        ),
        child: Center(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: isDark ? Colors.white70 : Colors.black54),
                const SizedBox(width: 8),
              ],
              Text(
                text,
                style: GoogleFonts.inter(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: isDark ? Colors.white : const Color(0xFF1E293B),
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActiveStep(String label, bool isActive, bool isDark, {String? timestamp}) {
    return Column(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: isActive ? primaryColor : (isDark ? Colors.white24 : Colors.black12),
            shape: BoxShape.circle,
            boxShadow: [
              if (isActive)
                BoxShadow(
                  color: primaryColor.withOpacity(0.5),
                  blurRadius: 4,
                  spreadRadius: 1,
                )
            ],
          ),
        ),
        const SizedBox(height: 5),
        Text(
          label, 
          style: GoogleFonts.inter(
            fontSize: 8, 
            color: isActive ? (isDark ? Colors.white : const Color(0xFF1E293B)) : (isDark ? Colors.white38 : Colors.black26), 
            fontWeight: isActive ? FontWeight.bold : FontWeight.normal
          )
        ),
        if (timestamp != null && timestamp.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(
            timestamp,
            style: GoogleFonts.inter(
              fontSize: 7,
              color: isDark ? Colors.white30 : Colors.black38,
              fontWeight: FontWeight.normal
            )
          ),
        ],
      ],
    );
  }

  Widget _buildActiveLine(bool isActive, bool isDark) {
    return Expanded(
      child: Container(
        height: 1.5,
        margin: const EdgeInsets.only(bottom: 12),
        color: isActive ? primaryColor : (isDark ? Colors.white10 : Colors.black.withOpacity(0.08)),
      ),
    );
  }
}
