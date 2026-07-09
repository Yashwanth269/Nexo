import 'dart:async';
import 'dart:convert';
import 'dart:math' show Random, min;
import 'package:http/http.dart' as http;
import 'package:flutter/material.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:nexo/services/location_service.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/auth_screen.dart';
import 'package:nexo/screens/worker_types_screen.dart';
import 'package:nexo/screens/categories_screen.dart';
import 'package:nexo/screens/post_job_screen.dart';
import 'package:nexo/screens/my_jobs_screen.dart';
import 'package:nexo/screens/messages_screen.dart';
import 'package:nexo/screens/job_details_screen.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/service_data.dart';
import 'package:nexo/services/home_services_service.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:nexo/screens/chat_detail_screen.dart';
import 'package:nexo/screens/profile_screen.dart';
import 'package:nexo/widgets/skeleton_loader.dart';
import 'package:nexo/services/permission_service.dart';
import 'package:nexo/screens/permission_request_screen.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:nexo/screens/notification_screen.dart';
import 'package:nexo/components/skeleton_components.dart';
import 'package:nexo/screens/searching_workers_screen.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:nexo/components/glass_components.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:nexo/screens/rating_screen.dart';
import 'package:nexo/services/trending_service.dart';
import 'package:nexo/services/feed_service.dart';
import 'package:nexo/screens/wallet_screen.dart';


class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver, TickerProviderStateMixin {
  bool _categoriesExpanded = false;
  int _popupColorIndex = 0;
  Timer? _popupColorTimer;

  // Gentle float animations
  AnimationController? _floatController;
  Animation<double>? _floatAnimation;

  static const List<List<Color>> shiftingGradients = [
    [Color(0xFFF0FDFA), Color(0xFFCCFBF1)], // Layered light mint teal
    [Color(0xFFFFF7ED), Color(0xFFFED7AA)], // Soft peach sunrise gradient
    [Color(0xFFEFF6FF), Color(0xFFDBEAFE)], // Delicate ice blue sky
    [Color(0xFFFAF5FF), Color(0xFFF3E8FF)], // Sophisticated soft lavender rose
    [Color(0xFFFDF2F8), Color(0xFFFCE7F3)], // Breathtaking light pastel blossom pink
  ];
  bool _isLoading = false;
  String _location = "Fetching location...";
  String _userName = "User";
  String? _photoUrl;
  int _selectedIndex = 0;
  int _myJobsKey = 0;
  List<dynamic> _topRatedWorkers = [];
  List<dynamic> _popularServices = [];
  List<String> _recommendations = [];
  Map<String, dynamic>? _ongoingJob; 
  List<dynamic> _activeJobs = [];
  late PageController _activeJobsController;
  Timer? _carouselTimer;
  int _currentCarouselPage = 0;

  // Active gig carousel minimize state
  bool _carouselMinimized = false;
  double _carouselBubbleX = 0;
  double _carouselBubbleY = 0;
  bool _carouselBubblePosSet = false;
  bool _carouselBubblePulse = false;
  Timer? _carouselMinimizeTimer;
  Timer? _carouselPulseTimer;
  int _animStyle = 0;          // 0=zoom, 1=elastic, 2=slide, 3=spin
  final _rng = Random();
  final String baseUrl = NetworkHelper.baseUrl;
  StreamSubscription? _locationSubscription;
  // Trending / Popular Near You
  bool _isLoadingPopular = true;
  StreamSubscription<List<Map<String, dynamic>>>? _trendingSubscription;
  final _trending = TrendingService.instance;
  double _lastLat = 0.0;
  double _lastLng = 0.0;
  bool _isLoadingRecs = false;
  bool _isLoadingWorkers = true;
  Timer? _autoRefreshTimer;
  double _walletBalance = 0.0;
  int _unreadCount = 0;
  int? _statsWorkersOnline;
  int? _statsJobsToday;
  int? _statsSuccessRate;
  String? _statsAvgResponse;

  int? _localWorkersOnline;
  int? _localJobsToday;
  int? _localSuccessRate;
  String? _localAvgResponse;
  Timer? _statsFluctuationTimer;
  List<Map<String, dynamic>> _homeServiceCategories = [];
  final _homeServices = HomeServicesService.instance;

  // Recently Completed Social Feed
  bool _isLoadingFeed = true;
  List<Map<String, dynamic>> _recentlyCompleted = [];
  StreamSubscription<List<Map<String, dynamic>>>? _feedSubscription;
  final _feedService = FeedService.instance;


  // Rating banner state fields
  bool _showRatingBanner = false;
  bool _bannerMinimized = false;   // true = floating bubble mode
  Map<String, dynamic>? _unratedJob;
  Timer? _bannerTimer;
  Timer? _minimizeTimer;

  // Draggable bubble position (bottom-right corner by default)
  double _bubbleX = 0;
  double _bubbleY = 0;
  bool _bubblePositionSet = false;

  // Pulse animation controller
  bool _bubblePulse = false;

  // Premium UI Theme colors
  static const Color primaryColor = Color(0xFFF97316); 

  Color _textPrimary(BuildContext context) => GlassTheme.textPrimary(context);
  Color _textSecondary(BuildContext context) => GlassTheme.textSecondary(context);
  Color _textMuted(BuildContext context) => GlassTheme.textMuted(context);

  @override
  void initState() {
    super.initState();
    _loadLocation();
    _startLocationUpdates();
    _loadUserName();
    _loadPhotoUrl();
    _fetchOngoingJob();
    _fetchWalletBalance();
    _fetchOverviewStats();
    _activeJobsController = PageController();
    _startCarouselTimer();
    WidgetsBinding.instance.addObserver(this);
    _initSocketListener();
    _checkAndShowRatingBanner();

    // Periodic Auto-Refresh every 15 seconds to sync data dynamically
    _autoRefreshTimer = Timer.periodic(const Duration(seconds: 15), (timer) {
      if (mounted && _selectedIndex == 0) {
        _refreshAllData();
      }
    });

    // Real-time dynamic stats fluctuation timer (every 4 seconds)
    _statsFluctuationTimer = Timer.periodic(const Duration(seconds: 4), (timer) {
      if (!mounted) return;
      setState(() {
        if (_statsWorkersOnline != null) {
          int current = _localWorkersOnline ?? _statsWorkersOnline!;
          int diff = current - _statsWorkersOnline!;
          // Random change between -2 and +2
          int shift = _rng.nextInt(5) - 2;
          // Keep local count bounded to ±15 of database/API value
          if (diff.abs() > 12) {
            shift = diff > 0 ? -2 : 2;
          }
          _localWorkersOnline = current + shift;
        }

        if (_statsJobsToday != null) {
          int current = _localJobsToday ?? _statsJobsToday!;
          int diff = current - _statsJobsToday!;
          // Random change between -1 and +1
          int shift = _rng.nextInt(3) - 1;
          // Keep bounded to ±10 of database/API value
          if (diff.abs() > 8) {
            shift = diff > 0 ? -1 : 1;
          }
          _localJobsToday = current + shift;
        }

        if (_statsSuccessRate != null) {
          int current = _localSuccessRate ?? _statsSuccessRate!;
          // Success rate oscillates slightly between 95 and 97
          int diff = current - 96;
          int shift = _rng.nextInt(3) - 1;
          if (diff.abs() > 1) {
            shift = diff > 0 ? -1 : 1;
          }
          _localSuccessRate = current + shift;
        }
      });
    });

    // Color shifting timer for ongoing card (every 2 minutes)
    _popupColorTimer = Timer.periodic(const Duration(minutes: 2), (timer) {
      if (mounted) {
        setState(() {
          _popupColorIndex = (_popupColorIndex + 1) % shiftingGradients.length;
        });
      }
    });

    // Slow drifting float animation controller
    _floatController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    )..repeat(reverse: true);

    _floatAnimation = Tween<double>(begin: -4.0, end: 4.0).animate(
      CurvedAnimation(parent: _floatController!, curve: Curves.easeInOut),
    );
  }

  void _startCarouselTimer() {
    _carouselTimer?.cancel();
    _carouselTimer = Timer.periodic(const Duration(seconds: 5), (timer) {
      if (_activeJobs.length > 1) {
        _currentCarouselPage++;
        if (_currentCarouselPage >= _activeJobs.length) {
          _currentCarouselPage = 0;
        }
        if (_activeJobsController.hasClients) {
          _activeJobsController.animateToPage(
            _currentCarouselPage,
            duration: const Duration(milliseconds: 800),
            curve: Curves.easeInOutCubic,
          );
        }
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      debugPrint("🔄 [HOME] App Resumed. Refreshing data...");
      _fetchOngoingJob();
      _loadLocation();
      _checkAndShowRatingBanner();
    }
  }

  void _startLocationUpdates() {
    _locationSubscription = LocationService.getLocationStream().listen((res) {
      if (mounted) {
        final lat = (res['lat'] as num).toDouble();
        final lng = (res['lng'] as num).toDouble();
        
        // Prevent redundant parallel fetch requests when location is extremely close to last fetched location
        final isInit = _lastLat == 0.0 && _lastLng == 0.0;
        final distanceMoved = (lat - _lastLat).abs() + (lng - _lastLng).abs();
        
        setState(() {
          _location = res['address'];
          _lastLat = lat;
          _lastLng = lng;
        });

        if (!isInit && distanceMoved < 0.00015) {
          // Coordinates haven't shifted significantly enough to re-fetch catalogs
          return;
        }

        _fetchTopRatedWorkers(lat, lng);
        _trending.updateLocation(lat, lng);
        _fetchRecentlyCompleted(lat, lng);
        _fetchRecommendations();
        _fetchOngoingJob();
      }
    });
  }


  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    _statsFluctuationTimer?.cancel();
    _locationSubscription?.cancel();
    _trendingSubscription?.cancel();
    _homeServicesSubscription?.cancel();
    _feedSubscription?.cancel();
    _carouselTimer?.cancel();
    _carouselMinimizeTimer?.cancel();
    _carouselPulseTimer?.cancel();
    _bannerTimer?.cancel();
    _minimizeTimer?.cancel();
    _popupColorTimer?.cancel();
    _floatController?.dispose();
    _activeJobsController.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }


  void _initSocketListener() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId != null) {
      final socketService = SocketService();
      socketService.connect(userId);

      // Lightweight callback: only refresh the ongoing-job card (fast, no GPS wait)
      final jobCardCallback = (data) {
        if (mounted) {
          debugPrint("⚡ [SOCKET] Job event received! Refreshing active job card...");
          _fetchOngoingJob();
        }
      };

      // Full refresh callback for status-critical events
      final refreshCallback = (data) {
        if (mounted) {
          debugPrint("⚡ [SOCKET] Live Event received! Auto-refreshing all home screen lists...");
          _refreshAllData();
        }
      };

      socketService.socket?.on('job_status_updated', (data) {
        if (mounted) {
          final status = data['status'] ?? '';
          if (status == 'COMPLETED') {
            debugPrint("🎉 [HOME] Real-time job completion received! Checking rating banner...");
            _checkAndShowRatingBanner();
          }
          _refreshAllData();
        }
      });
      // New job posted — show active card immediately without GPS round-trip
      socketService.socket?.on('job_posted', jobCardCallback);
      socketService.socket?.on('JOB_ACCEPTED', jobCardCallback);
      socketService.socket?.on('job_accepted', jobCardCallback);
      socketService.socket?.on('job_cancelled_by_user', refreshCallback);
      socketService.socket?.on('WORKER_CANCELLED_JOB', refreshCallback);
    }
  }

  Future<void> _refreshAllData() async {
    try {
      final res = await LocationService.getCurrentLocation();
      final lat = res['lat'] as double;
      final lng = res['lng'] as double;

      await Future.wait([
        _fetchWalletBalance(),
        _fetchOngoingJob(),
        _fetchOverviewStats(),
        _fetchTopRatedWorkers(lat, lng),
        _trending.fetch(lat, lng, bypassCache: true),   // bypass cache on manual refresh
        _feedService.fetch(lat, lng, bypassCache: true),
        _fetchRecommendations(),
        _checkAndShowRatingBanner(),
      ]);
    } catch (e) {
      debugPrint("❌ Error during global data auto-refresh: $e");
    }
  }


  Future<void> _checkAndShowRatingBanner() async {
    try {
      final userId = await SharedPrefsHelper.getUserId();
      if (userId == null) return;

      final token = await SharedPrefsHelper.getToken();
      final url = Uri.parse('$baseUrl/api/jobs/history/$userId');
      final response = await http.get(
        url,
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true && data['jobs'] != null) {
          final jobs = data['jobs'] as List;
          // Find the most recent completed job that has NOT been rated yet!
          final unratedCompleted = jobs.firstWhere(
            (j) => j != null && j['status'] == 'COMPLETED' && j['isRated'] == false,
            orElse: () => null,
          );

          if (unratedCompleted != null && mounted) {
            final jobId = unratedCompleted['id'];
            // Check SharedPreferences seen filter
            final isShown = await SharedPrefsHelper.getBool('rating_shown_$jobId') ?? false;
            
            if (!isShown) {
              // Set the seen filter in SharedPreferences immediately to guarantee ONLY ONCE!
              await SharedPrefsHelper.setBool('rating_shown_$jobId', true);

              setState(() {
                _unratedJob = unratedCompleted;
                _showRatingBanner = true;
              });

              // Auto-minimize to floating bubble after 10 seconds
              _bannerTimer?.cancel();
              _minimizeTimer?.cancel();
              _bannerTimer = Timer(const Duration(seconds: 10), () {
                if (mounted) {
                  setState(() {
                    _showRatingBanner = true;
                    _bannerMinimized = true; // collapse to floating bubble
                    _bubblePulse = true;
                  });
                  // Pulse animation toggle
                  Timer.periodic(const Duration(milliseconds: 900), (t) {
                    if (!mounted || !_bannerMinimized) { t.cancel(); return; }
                    setState(() => _bubblePulse = !_bubblePulse);
                  });
                }
              });
            }
          }
        }
      }
    } catch (e) {
      debugPrint("❌ Exception in _checkAndShowRatingBanner: $e");
    }
  }

  void _minimizeBanner() {
    _bannerTimer?.cancel();
    setState(() {
      _bannerMinimized = true;
      _bubblePulse = true;
    });
    // Start pulse toggle
    Future.delayed(const Duration(milliseconds: 50), () {
      Timer.periodic(const Duration(milliseconds: 900), (t) {
        if (!mounted || !_bannerMinimized) { t.cancel(); return; }
        if (mounted) setState(() => _bubblePulse = !_bubblePulse);
      });
    });
  }

  void _expandBanner() {
    setState(() {
      _bannerMinimized = false;
      _bubblePulse = false;
    });
    // Auto-minimize again after 10s if user doesn't interact
    _bannerTimer?.cancel();
    _bannerTimer = Timer(const Duration(seconds: 10), () {
      if (mounted && _showRatingBanner && !_bannerMinimized) {
        _minimizeBanner();
      }
    });
  }

  Widget _buildRatingBannerNotification() {
    if (_unratedJob == null || !_showRatingBanner) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final workerName = _unratedJob!['workerName'] ?? 'Expert Professional';
    final workerPhoto = _unratedJob!['workerPhoto'];
    final category = _unratedJob!['category'] ?? 'Technician';
    final screenSize = MediaQuery.of(context).size;

    // Set default bubble position (bottom-right) on first render
    if (!_bubblePositionSet) {
      _bubbleX = screenSize.width - 80;
      _bubbleY = screenSize.height - 220;
      _bubblePositionSet = true;
    }

    return Stack(
      children: [
        // ── FULL EXPANDED BANNER ───────────────────────────────────────────
        if (!_bannerMinimized)
          AnimatedPositioned(
            duration: const Duration(milliseconds: 500),
            curve: Curves.easeOutBack,
            top: 50,
            left: 16,
            right: 16,
            child: GestureDetector(
              onPanUpdate: (details) {
                // Swipe up → minimize to bubble
                if (details.delta.dy < -6) {
                  _minimizeBanner();
                }
              },
              child: GlassContainer(
                borderRadius: 24,
                blur: 25,
                color: isDark ? Colors.black.withOpacity(0.92) : Colors.white.withOpacity(0.95),
                border: Border.all(
                  color: const Color(0xFFF97316).withOpacity(0.40),
                  width: 1.5,
                ),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Row(
                  children: [
                    // Worker avatar with verified badge
                    Stack(
                      alignment: Alignment.bottomRight,
                      children: [
                        CircleAvatar(
                          radius: 24,
                          backgroundColor: const Color(0xFFF97316).withOpacity(0.1),
                          backgroundImage: workerPhoto != null && workerPhoto.toString().isNotEmpty
                              ? NetworkImage(workerPhoto.toString().startsWith('http')
                                  ? workerPhoto
                                  : '${NetworkHelper.baseUrl}$workerPhoto')
                              : null,
                          child: workerPhoto == null || workerPhoto.toString().isEmpty
                              ? const Icon(Icons.person, size: 24, color: Colors.orange)
                              : null,
                        ),
                        Container(
                          padding: const EdgeInsets.all(2),
                          decoration: const BoxDecoration(color: Colors.greenAccent, shape: BoxShape.circle),
                          child: const Icon(Icons.verified, color: Colors.white, size: 10),
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            "Gig Completed! 🎉",
                            style: GoogleFonts.outfit(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                              color: const Color(0xFFF97316),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            "Rate your expert, $workerName?",
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.inter(
                              fontWeight: FontWeight.w600,
                              fontSize: 12,
                              color: isDark ? Colors.white70 : Colors.black87,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // RATE button
                    GestureDetector(
                      onTap: () {
                        setState(() { _showRatingBanner = false; _bannerMinimized = false; });
                        _bannerTimer?.cancel();
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => RatingScreen(job: {
                              ..._unratedJob!,
                              'worker': {
                                'id': _unratedJob!['worker_id'],
                                'name': workerName,
                                'photoUrl': workerPhoto ?? '',
                                'category': category,
                              }
                            }),
                          ),
                        );
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          gradient: const LinearGradient(
                            colors: [Color(0xFFF97316), Color(0xFFFF8C00)],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFFFF6A00).withOpacity(0.35),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: Text(
                          "RATE",
                          style: GoogleFonts.inter(
                            fontWeight: FontWeight.w800,
                            fontSize: 11,
                            color: Colors.white,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    // Minimize button
                    GestureDetector(
                      onTap: _minimizeBanner,
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.06),
                        ),
                        child: Icon(
                          Icons.remove_rounded,
                          size: 16,
                          color: isDark ? Colors.white54 : Colors.black45,
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    // Close button
                    GestureDetector(
                      onTap: () {
                        setState(() { _showRatingBanner = false; _bannerMinimized = false; });
                        _bannerTimer?.cancel();
                      },
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.06),
                        ),
                        child: Icon(
                          Icons.close_rounded,
                          size: 16,
                          color: isDark ? Colors.white54 : Colors.black45,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

        // ── MINIMIZED FLOATING BUBBLE ──────────────────────────────────────
        if (_bannerMinimized)
          Positioned(
            left: _bubbleX.clamp(0, screenSize.width - 64),
            top: _bubbleY.clamp(0, screenSize.height - 140),
            child: GestureDetector(
              onPanUpdate: (details) {
                setState(() {
                  _bubbleX += details.delta.dx;
                  _bubbleY += details.delta.dy;
                });
              },
              onTap: _expandBanner,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 400),
                curve: Curves.easeInOut,
                width: _bubblePulse ? 60 : 56,
                height: _bubblePulse ? 60 : 56,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFF97316), Color(0xFFFF5E00)],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFF97316).withOpacity(_bubblePulse ? 0.65 : 0.35),
                      blurRadius: _bubblePulse ? 20 : 10,
                      spreadRadius: _bubblePulse ? 4 : 1,
                    ),
                  ],
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Icon(
                      Icons.work_rounded,
                      color: Colors.white,
                      size: 26,
                    ),
                    // Notification dot
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        width: 11,
                        height: 11,
                        decoration: BoxDecoration(
                          color: Colors.greenAccent.shade400,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.5),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _loadPhotoUrl() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId == null) return;
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('$baseUrl/api/user/profile/$userId'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success'] && data['user']['photoUrl'] != null) {
          setState(() {
            _photoUrl = data['user']['photoUrl'];
          });
          await SharedPrefsHelper.setPhotoUrl(data['user']['photoUrl']);
        }
      }
    } catch (e) {
      final photoUrl = await SharedPrefsHelper.getPhotoUrl();
      if (mounted && photoUrl != null) {
        setState(() {
          _photoUrl = photoUrl;
        });
      }
    }
  }

  Future<void> _loadUserName() async {
    final userName = await SharedPrefsHelper.getUserName();
    if (mounted && userName != null) {
      setState(() {
        _userName = userName;
      });
    }
  }

  Future<void> _logout() async {
    await SharedPrefsHelper.clearUserData();
    if (mounted) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (context) => const AuthScreen()),
      );
    }
  }

  Future<void> _loadLocation() async {
    final hasPermission = await PermissionService.hasLocationPermission();
    if (!hasPermission) {
      if (mounted) {
        final result = await PermissionRequestScreen.show(
          context: context,
          permission: Permission.location,
          title: "Allow Location Access",
          description: "We use your location to find nearby workers and show accurate services.",
          iconUrl: "https://cdn-icons-png.flaticon.com/512/854/854878.png",
          features: [
            {'icon': Icons.near_me_outlined, 'title': 'Find Help', 'description': 'Connect with local verified experts.'},
            {'icon': Icons.speed_outlined, 'title': 'Fast Arrival', 'description': 'Accurate ETAs for your services.'},
          ],
        );
        if (!result) {
          setState(() => _location = "Allow location for services");
          return;
        }
      }
    }

    setState(() => _location = "Fetching location...");
    final res = await LocationService.getCurrentLocation();
    if (mounted) {
      setState(() {
        _location = res['address'];
      });
      final lat = (res['lat'] as num).toDouble();
      final lng = (res['lng'] as num).toDouble();
      _lastLat = lat;
      _lastLng = lng;
      _fetchTopRatedWorkers(lat, lng);
      // Init TrendingService: joins geo-room + subscribes to socket + fetches live data
      _trending.init(lat, lng).then((_) {
        // Subscribe to stream after init so first result populates UI
        _fetchPopularServices(lat, lng);
      });
      _homeServices.init(lat, lng).then((_) {
        setState(() {
          _homeServiceCategories = _homeServices.lastResult;
        });
      });
      _feedService.init(lat, lng).then((_) {
        _fetchRecentlyCompleted(lat, lng);
      });
      _fetchOngoingJob();
      setState(() => _isLoading = false);
    }
  }

  Future<void> _fetchWalletBalance() async {
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('$baseUrl/api/wallet/balance'),
        headers: {if (token != null) 'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 6));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) {
          setState(() {
            _walletBalance = double.tryParse(data['balance']?.toString() ?? '0') ?? 0;
          });
        }
      }
    } catch (e) {
      debugPrint('[HOME] Wallet balance fetch error: $e');
    }
  }

  Future<void> _fetchOverviewStats() async {
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('$baseUrl/api/market/overview-stats'),
        headers: {if (token != null) 'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 4));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          if (mounted) {
            setState(() {
              _statsWorkersOnline = data['workersOnline'];
              _statsJobsToday = data['jobsToday'];
              _statsSuccessRate = data['successRate'];
              _statsAvgResponse = data['avgResponse'];

              _localWorkersOnline = _statsWorkersOnline;
              _localJobsToday = _statsJobsToday;
              _localSuccessRate = _statsSuccessRate;
              _localAvgResponse = _statsAvgResponse;
            });
          }
        }
      }
    } catch (e) {
      debugPrint('[HOME] Error fetching overview stats: $e');
    }
  }

  Future<void> _fetchOngoingJob() async {
    try {
      final userId = await SharedPrefsHelper.getUserId();
      if (userId == null) return;

      final token = await SharedPrefsHelper.getToken();
      final url = Uri.parse('$baseUrl/api/jobs/$userId/ongoing');
      final response = await http.get(
        url,
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success'] == true) {
          setState(() {
            _activeJobs = data['jobs'] ?? [];
            _ongoingJob = data['job'];
            if (_currentCarouselPage >= _activeJobs.length) {
              _currentCarouselPage = 0;
            }
          });
          if (_activeJobs.isNotEmpty && _activeJobsController.hasClients) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (_activeJobsController.hasClients) {
                _activeJobsController.jumpToPage(_currentCarouselPage);
              }
            });
          }
          _startCarouselTimer(); 
        } else {
          setState(() {
            _activeJobs = [];
            _ongoingJob = null;
            _currentCarouselPage = 0;
          });
        }
      }
    } catch (e) {
      debugPrint("❌ Exception during fetchOngoingJob: $e");
    }
  }

  String _getGreeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return "Good Morning ☀️";
    if (hour < 17) return "Good Afternoon 🌤️";
    return "Good Evening 🌙";
  }

  Future<void> _fetchTopRatedWorkers(double lat, double lng) async {
    if (mounted) {
      setState(() => _isLoadingWorkers = true);
    }
    try {
      final url = Uri.parse('$baseUrl/api/workers/top-rated?lat=$lat&lng=$lng');
      final response = await http.get(url);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success'] == true) {
          setState(() {
            _topRatedWorkers = data['workers'] ?? [];
            _isLoadingWorkers = false;
          });
        }
      } else {
        if (mounted) setState(() => _isLoadingWorkers = false);
      }
    } catch (e) {
      debugPrint("❌ Error fetching top-rated workers: $e");
      if (mounted) setState(() => _isLoadingWorkers = false);
    }
  }

  StreamSubscription<List<Map<String, dynamic>>>? _homeServicesSubscription;

  // ──────────────────────────────────────────────────────────────
  //  POPULAR SERVICES — delegates to TrendingService
  //  The stream subscription keeps _popularServices in sync.
  // ──────────────────────────────────────────────────────────────
  Future<void> _fetchPopularServices(double lat, double lng) async {
    if (_homeServicesSubscription == null) {
      _homeServicesSubscription = _homeServices.servicesStream.listen((results) {
        if (mounted) {
          setState(() {
            _homeServiceCategories = results;
          });
        }
      });
    }

    if (_trendingSubscription == null) {
      // First call: subscribe to the stream so live pushes update UI
      _trendingSubscription = _trending.trendingStream.listen((results) {
        if (mounted) {
          setState(() {
            _popularServices = results;
            _isLoadingPopular = false;
          });
          debugPrint('[HOME] Trending stream update: ${results.length} cards');
        }
      });
    }

    if (!mounted) return;
    setState(() => _isLoadingPopular = true);

    // Show cached result immediately while fetch is in-flight
    final cached = _trending.lastResult;
    if (cached.isNotEmpty && mounted) {
      setState(() {
        _popularServices = cached;
        _isLoadingPopular = false;
      });
    }

    await _trending.fetch(lat, lng);
  }

  /// Returns empty list so the UI falls through to skeleton/empty-state.
  /// No server-side fallback — real data only.
  List<Map<String, dynamic>> _buildPopularFallbackData() => [];


  Future<void> _fetchRecommendations() async {
    try {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();
      final url = Uri.parse('$baseUrl/api/user/recommendations?userId=$userId');
      final response = await http.get(
        url,
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success'] == true) {
          setState(() {
            _recommendations = List<String>.from(data['recommendations'] ?? []);
          });
        }
      }
    } catch (e) {
      debugPrint("❌ Error fetching recommendations: $e");
    }
  }

  String _getJobImage(String category, String description) {
    final desc = description.toLowerCase();
    if (desc.contains('ac') || desc.contains('air condition')) return 'assets/images/home services/appliance repair/ac repair.jpg';
    if (desc.contains('plumb') || desc.contains('leak') || desc.contains('pipe')) return 'assets/images/home services/plumbing/tap repair.jpg';
    if (desc.contains('electrician') || desc.contains('wire') || desc.contains('switch')) return 'assets/images/home services/electrical/wiring.webp';
    return ImageUtils.getCategoryAsset(category);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: PremiumBackground(
        child: Stack(
          children: [
            IndexedStack(
              index: _selectedIndex,
              children: [
                _buildHomeContent(),
                const CategoriesScreen(),
                MyJobsScreen(
                  key: ValueKey(_myJobsKey),
                  onTabChange: (idx) => setState(() => _selectedIndex = idx),
                ),
                const MessagesScreen(),
              ],
            ),
            if (_activeJobs.isNotEmpty)
              _buildActiveGigWidget(),
            if (_showRatingBanner && _unratedJob != null)
              Positioned.fill(
                child: _buildRatingBannerNotification(),
              ),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  Widget _buildHomeContent() {
    if (_isLoading) return SkeletonComponents.buildHomeSkeleton();
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _refreshAllData,
        color: const Color(0xFF2563EB),
        backgroundColor: Colors.white,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 120),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildHeader(),
                    const SizedBox(height: 20),
                    _buildSearchBar(),
                    const SizedBox(height: 24),
                    
                    // "Need help today?" horizontal quick categories
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          "Need help today?",
                          style: GoogleFonts.outfit(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF0F172A),
                          ),
                        ),
                        TextButton(
                          onPressed: () => setState(() => _selectedIndex = 1),
                          child: Text(
                            "View all",
                            style: GoogleFonts.inter(
                              color: const Color(0xFFFF6A00),
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    _buildQuickCategoriesRow(),
                    const SizedBox(height: 24),
                    
                    _buildRewardsBanner(), // Need a worker today? Blue Banner
                    const SizedBox(height: 32),

                    if (_recommendations.isNotEmpty) ...[
                      _buildSectionHeader("Recommended For You", onSeeAll: () {}),
                      const SizedBox(height: 12),
                      _buildRecommendationsList(),
                      const SizedBox(height: 32),
                    ],

                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              "All Services",
                              style: GoogleFonts.outfit(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              "Find trusted workers nearby",
                              style: GoogleFonts.inter(
                                fontSize: 11,
                                color: const Color(0xFF64748B),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                        TextButton(
                          onPressed: () {
                            setState(() {
                              _categoriesExpanded = !_categoriesExpanded;
                            });
                          },
                          child: Text(
                            _categoriesExpanded ? "Show Less" : "See All",
                            style: GoogleFonts.inter(
                              color: const Color(0xFFFF6A00),
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _buildCategoriesGrid(),
                    const SizedBox(height: 32),
                    
                    _buildSectionHeader("Trending Near You", onSeeAll: () => setState(() => _selectedIndex = 1)),
                    const SizedBox(height: 16),
                    _buildPopularServicesList(),
                    const SizedBox(height: 32),

                    _buildSectionHeader("Top Rated Workers", onSeeAll: _showAllTopRatedWorkersSheet),
                    const SizedBox(height: 16),
                    _buildNearbyWorkersList(),
                    const SizedBox(height: 32),
                    
                    _buildRecentlyCompletedSection(),
                    const SizedBox(height: 32),

                    // Bottom Statistics Panel
                    _buildBottomStatsPanel(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  "Good Morning",
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    color: const Color(0xFFFF6A00),
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(width: 4),
                const Text("☀️", style: TextStyle(fontSize: 13)),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              _userName,
              style: GoogleFonts.outfit(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                color: const Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 4),
            GestureDetector(
              onTap: _loadLocation,
              child: Row(
                children: [
                  const Icon(Icons.location_on_rounded, size: 14, color: Color(0xFFFF6A00)),
                  const SizedBox(width: 4),
                  SizedBox(
                    width: 110,
                    child: Text(
                      _location,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: const Color(0xFF0F172A),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: Color(0xFF64748B)),
                ],
              ),
            ),
          ],
        ),
        Row(
          children: [
            // Notifications with count
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  height: 40,
                  width: 40,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
                  ),
                  child: const Center(
                    child: Icon(Icons.notifications_none_rounded, color: Color(0xFF0F172A), size: 20),
                  ),
                ),
                Positioned(
                  top: -2,
                  right: -2,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: Colors.redAccent,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      "$_unreadCount",
                      style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 10),

            // ── Wallet chip (real balance, tappable) ──────────────
            GestureDetector(
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const WalletScreen()),
                ).then((_) => _fetchWalletBalance());
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.account_balance_wallet_rounded, color: Color(0xFF2563EB), size: 14),
                    const SizedBox(width: 4),
                    Text(
                      '₹${_walletBalance.toStringAsFixed(0)}',
                      style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 12, color: const Color(0xFF0F172A)),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 10),

            // Profile picture with green status dot
            GestureDetector(
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (context) => const ProfileScreen()),
                ).then((_) {
                  _loadPhotoUrl();
                  _fetchWalletBalance();
                });
              },
              child: Stack(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
                    ),
                    child: ClipOval(
                      child: _photoUrl != null && _photoUrl!.isNotEmpty
                          ? Image.network(
                              _photoUrl!.startsWith('http') ? _photoUrl! : '$baseUrl$_photoUrl',
                              fit: BoxFit.cover,
                              errorBuilder: (c, e, s) => Image.network("https://api.dicebear.com/7.x/adventurer/png?seed=$_userName"),
                            )
                          : Image.network("https://api.dicebear.com/7.x/adventurer/png?seed=$_userName"),
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 1.5),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildSearchBar() {
    return Row(
      children: [
        Expanded(
          child: Container(
            height: 48,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Row(
              children: [
                const Icon(Icons.search_rounded, color: Color(0xFF94A3B8), size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    decoration: InputDecoration(
                      hintText: "Search services, workers...",
                      hintStyle: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 13),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                ),
                Container(
                  height: 32,
                  width: 32,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF6A00),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Center(
                    child: Icon(Icons.tune_rounded, color: Colors.white, size: 16),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 10),
        Container(
          height: 48,
          width: 48,
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            shape: BoxShape.circle,
            border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
          ),
          child: const Center(
            child: Icon(Icons.mic_none_rounded, color: Color(0xFF0F172A), size: 20),
          ),
        ),
      ],
    );
  }

  Widget _buildQuickCategoriesRow() {
    final list = [
      {'name': 'Electrician', 'icon': Icons.bolt_rounded, 'color': const Color(0xFF2563EB), 'bg': const Color(0xFFEFF6FF)},
      {'name': 'Mechanic', 'icon': Icons.build_rounded, 'color': const Color(0xFF10B981), 'bg': const Color(0xFFECFDF5)},
      {'name': 'Agriculture', 'icon': Icons.agriculture_rounded, 'color': const Color(0xFF059669), 'bg': const Color(0xFFF0FDF4)},
      {'name': 'Home Services', 'icon': Icons.home_rounded, 'color': const Color(0xFF7C3AED), 'bg': const Color(0xFFF5F3FF)},
      {'name': 'Transport', 'icon': Icons.local_shipping_rounded, 'color': const Color(0xFFEA580C), 'bg': const Color(0xFFFFF7ED)},
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: list.map((item) => GestureDetector(
          onTap: () {
            Navigator.push(context, MaterialPageRoute(
              builder: (context) => PostJobScreen(initialTask: item['name'] as String),
            ));
          },
          child: Container(
            margin: const EdgeInsets.only(right: 10),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: item['bg'] as Color,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: (item['color'] as Color).withOpacity(0.15)),
            ),
            child: Row(
              children: [
                Icon(item['icon'] as IconData, color: item['color'] as Color, size: 16),
                const SizedBox(width: 6),
                Text(
                  item['name'] as String,
                  style: GoogleFonts.inter(
                    color: item['color'] as Color,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        )).toList(),
      ),
    );
  }

  Widget _buildRewardsBanner() {
    // ── Colors matching the reference image exactly ────────────────
    const Color bgStart       = Color(0xFFE8F1FF); // light blue gradient start
    const Color bgEnd         = Color(0xFFF7FAFF); // light blue gradient end
    const Color borderCol     = Color(0xFFCBE0FF); // soft blue border
    const Color textPrimary   = Color(0xFF09101D); // bold dark header text
    const Color textAccent    = Color(0xFF1B6DF9); // bright royal blue "today?"
    const Color textSecondary = Color(0xFF475569); // slate subtitle text
    const Color buttonBg      = Color(0xFF1B6DF9); // royal blue "Book Now" button

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [bgStart, bgEnd],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: borderCol, width: 1.2),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF1B6DF9).withOpacity(0.04),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // ── LEFT COLUMN (Expanded to prevent badge wrapping) ─────
            Expanded(
              flex: 62,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Heading
                  RichText(
                    text: TextSpan(
                      children: [
                        TextSpan(
                          text: "Need a worker\n",
                          style: GoogleFonts.outfit(
                            color: textPrimary,
                            fontWeight: FontWeight.w900,
                            fontSize: 20,
                            height: 1.1,
                          ),
                        ),
                        TextSpan(
                          text: "today?",
                          style: GoogleFonts.outfit(
                            color: textAccent,
                            fontWeight: FontWeight.w900,
                            fontSize: 20,
                            height: 1.1,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    "Verified professionals near you,\nready to get the job done.",
                    style: GoogleFonts.inter(
                      color: textSecondary,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w500,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 10),
                  // ── Trust badges ──────────────────────────────
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      _workerBadgeChip(Icons.verified_user_rounded, "Verified", "Professionals", textAccent, textPrimary, textSecondary),
                      _workerBadgeChip(Icons.location_on_rounded, "Near You", "Fast Response", textAccent, textPrimary, textSecondary),
                      _workerBadgeChip(Icons.thumb_up_rounded, "Trusted by", "Thousands", textAccent, textPrimary, textSecondary),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // ── Book Now button (Solid Blue) ──────────────
                  GestureDetector(
                    onTap: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const PostJobScreen()));
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                      decoration: BoxDecoration(
                        color: buttonBg,
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: [
                          BoxShadow(color: buttonBg.withOpacity(0.3), blurRadius: 10, offset: const Offset(0, 4)),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            "Book Now",
                            style: GoogleFonts.outfit(
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(width: 6),
                          const Icon(Icons.arrow_forward_rounded, size: 14, color: Colors.white),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(width: 8),

            // ── RIGHT COLUMN ──────────────────────────────────────
            Expanded(
              flex: 38,
              child: SizedBox(
                height: 130,
                child: Stack(
                  clipBehavior: Clip.none,
                  alignment: Alignment.center,
                  children: [
                    // Concentric rings
                    Container(
                      width: 105,
                      height: 105,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: textAccent.withOpacity(0.1),
                          width: 1.2,
                        ),
                      ),
                    ),
                    Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: textAccent.withOpacity(0.04),
                        border: Border.all(color: textAccent.withOpacity(0.06), width: 1.0),
                      ),
                    ),
                    // Inner white circle with blue worker icon
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white,
                        boxShadow: [
                          BoxShadow(color: textAccent.withOpacity(0.12), blurRadius: 12, spreadRadius: 1),
                        ],
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.engineering_rounded,
                          size: 30,
                          color: textAccent,
                        ),
                      ),
                    ),

                    // ── Floating "10 mins" card ─────────────────
                    Positioned(
                      top: 0,
                      right: -6,
                      child: Container(
                        width: 52,
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 8, offset: const Offset(0, 3)),
                          ],
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.timer_rounded, color: textAccent, size: 15),
                            const SizedBox(height: 2),
                            Text(
                              "10",
                              style: GoogleFonts.outfit(
                                fontWeight: FontWeight.w900,
                                fontSize: 13,
                                color: textAccent,
                                height: 0.95,
                              ),
                            ),
                            Text(
                              "mins",
                              style: GoogleFonts.inter(
                                fontWeight: FontWeight.bold,
                                fontSize: 8,
                                color: textAccent,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              decoration: BoxDecoration(
                                color: textAccent,
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                "Avg. Arrival",
                                textAlign: TextAlign.center,
                                style: GoogleFonts.inter(
                                  fontSize: 6.5,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    // ── Floating "Trusted • Safe • Reliable" card ──
                    Positioned(
                      bottom: -2,
                      left: -12,
                      right: -12,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 8, offset: const Offset(0, 3)),
                          ],
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 15,
                              height: 15,
                              decoration: const BoxDecoration(
                                color: Color(0xFF10B981),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.check_rounded, color: Colors.white, size: 9),
                            ),
                            const SizedBox(width: 5),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    "Trusted • Safe • Reliable",
                                    style: GoogleFonts.outfit(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 8.5,
                                      color: textPrimary,
                                    ),
                                  ),
                                  Text(
                                    "We ensure quality & safety",
                                    style: GoogleFonts.inter(
                                      fontSize: 7.5,
                                      color: textSecondary,
                                      fontWeight: FontWeight.w400,
                                    ),
                                  ),
                                ],
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
          ],
        ),
      ),
    );
  }

  /// Small icon+label chip used inside the worker banner trust row
  Widget _workerBadgeChip(IconData icon, String line1, String line2, Color iconCol, Color titleCol, Color subtitleCol) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: iconCol),
        const SizedBox(height: 2),
        Text(line1, style: GoogleFonts.outfit(color: titleCol, fontWeight: FontWeight.bold, fontSize: 8.5)),
        Text(line2, style: GoogleFonts.inter(color: subtitleCol, fontSize: 7.5, fontWeight: FontWeight.w400)),
      ],
    );
  }



  Widget _buildBottomStatsPanel() {
    final stats = [
      {
        'val': _localWorkersOnline != null
            ? _localWorkersOnline.toString().replaceAllMapped(
                RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
                (Match m) => "${m[1]},",
              )
            : '—',
        'lbl': 'Workers Online',
        'icon': Icons.people_rounded,
        'color': const Color(0xFF2563EB)
      },
      {
        'val': _localJobsToday != null ? _localJobsToday.toString() : '—',
        'lbl': 'Jobs Today',
        'icon': Icons.check_circle_outline_rounded,
        'color': const Color(0xFF10B981)
      },
      {
        'val': _localSuccessRate != null ? '$_localSuccessRate%' : '—',
        'lbl': 'Success Rate',
        'icon': Icons.star_rounded,
        'color': const Color(0xFFF59E0B)
      },
      {
        'val': _localAvgResponse ?? '—',
        'lbl': 'Avg. Response',
        'icon': Icons.timer_rounded,
        'color': const Color(0xFFEF4444)
      },
    ];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1.2),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: stats.map((st) => Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(st['icon'] as IconData, color: st['color'] as Color, size: 22),
              const SizedBox(height: 6),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 350),
                transitionBuilder: (Widget child, Animation<double> animation) {
                  return ScaleTransition(scale: animation, child: child);
                },
                child: Text(
                  st['val'] as String,
                  key: ValueKey(st['val']),
                  style: GoogleFonts.outfit(
                    fontWeight: FontWeight.w900,
                    fontSize: 17,
                    color: const Color(0xFF0F172A),
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                st['lbl'] as String,
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 10,
                  color: const Color(0xFF64748B),
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        )).toList(),
      ),
    );
  }

  Widget _buildSectionHeader(String title, {required VoidCallback onSeeAll}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: GoogleFonts.outfit(
            fontSize: 18,
            fontWeight: FontWeight.w700,              color: _textPrimary(context),
          ),
        ),
        TextButton(
          onPressed: onSeeAll,
          child: Text(
            "See All",
            style: GoogleFonts.inter(
              color: primaryColor,
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
        ),
      ],
    );
  }

  // ── Active Gig Carousel Minimize / Expand ─────────────────────────────────

  void _minimizeCarousel() {
    _carouselMinimizeTimer?.cancel();
    _carouselPulseTimer?.cancel();
    setState(() {
      _animStyle = _rng.nextInt(4); // pick random anim for next expand
      _carouselMinimized = true;
      _carouselBubblePulse = true;
    });
    _carouselPulseTimer = Timer.periodic(const Duration(milliseconds: 950), (t) {
      if (!mounted || !_carouselMinimized) { t.cancel(); return; }
      setState(() => _carouselBubblePulse = !_carouselBubblePulse);
    });
  }

  void _expandCarousel() {
    _carouselPulseTimer?.cancel();
    _carouselMinimizeTimer?.cancel();
    setState(() {
      _animStyle = _rng.nextInt(4); // pick random anim for this expand
      _carouselMinimized = false;
      _carouselBubblePulse = false;
    });
    _carouselMinimizeTimer = Timer(const Duration(seconds: 10), () {
      if (mounted && _activeJobs.isNotEmpty && !_carouselMinimized) {
        _minimizeCarousel();
      }
    });
  }

  /// Wraps carousel in either full-view or floating bubble, with randomised animations
  Widget _buildActiveGigWidget() {
    final screenSize = MediaQuery.of(context).size;
    const cardHeight = 190.0;      // adjusted to prevent vertical overflow
    const cardHMargin = 16.0;
    const bubbleSize = 52.0;

    if (!_carouselBubblePosSet) {
      _carouselBubbleX = 16;
      _carouselBubbleY = screenSize.height - 220;
      _carouselBubblePosSet = true;
    }

    final bx = _carouselBubbleX.clamp(0.0, screenSize.width - bubbleSize);
    final by = _carouselBubbleY.clamp(0.0, screenSize.height - 140.0);
    final isTop = by < screenSize.height / 2;

    // Card top: relative to bubble
    final cardTop = isTop
        ? (by + bubbleSize + 10).clamp(0.0, screenSize.height - cardHeight - 80)
        : (by - cardHeight - 10).clamp(80.0, screenSize.height - cardHeight);

    // ── Animation params per style ────────────────────────────────────────
    // 0: zoom burst  |  1: elastic pop  |  2: slide reveal  |  3: spin-fade
    final animDurations = const [
      Duration(milliseconds: 420),  // 0 zoom
      Duration(milliseconds: 680),  // 1 elastic
      Duration(milliseconds: 480),  // 2 slide
      Duration(milliseconds: 460),  // 3 spin-fade
    ];
    final animCurves = [
      Curves.easeOutBack,
      Curves.elasticOut,
      Curves.easeOutQuart,
      Curves.easeOutCubic,
    ];
    final scaleAlignments = [
      Alignment.center,
      isTop ? Alignment.topCenter : Alignment.bottomCenter,
      isTop ? Alignment.topLeft : Alignment.bottomLeft,
      Alignment.center,
    ];
    // collapsed scales
    final collapsedScales = [0.3, 0.1, 0.6, 0.5];
    // for style 3: rotation
    final rotationCollapsed = [0.0, 0.0, 0.0, 0.08];

    final dur = animDurations[_animStyle];
    final curve = animCurves[_animStyle];
    final scaleAlign = scaleAlignments[_animStyle];
    final collapsedScale = collapsedScales[_animStyle];
    final rotAmt = rotationCollapsed[_animStyle];

    // For style 2 (slide): card starts from off-screen direction
    final slideOffset = _carouselMinimized
        ? (isTop ? const Offset(0, -0.4) : const Offset(0, 0.4))
        : Offset.zero;

    return Stack(
      children: [
        // ── EXPANDED CARD ─────────────────────────────────────────────────
        AnimatedPositioned(
          duration: dur,
          curve: curve,
          top: _carouselMinimized ? by : cardTop,
          left: cardHMargin,
          right: cardHMargin,
          child: AnimatedOpacity(
            duration: Duration(milliseconds: (dur.inMilliseconds * 0.75).round()),
            curve: Curves.easeOut,
            opacity: _carouselMinimized ? 0.0 : 1.0,
            child: AnimatedSlide(
              duration: _animStyle == 2 ? dur : Duration.zero,
              curve: curve,
              offset: _animStyle == 2 ? slideOffset : Offset.zero,
              child: AnimatedRotation(
                duration: _animStyle == 3 ? dur : Duration.zero,
                curve: curve,
                turns: _carouselMinimized ? rotAmt : 0.0,
                child: AnimatedScale(
                  duration: dur,
                  curve: curve,
                  scale: _carouselMinimized ? collapsedScale : 1.0,
                  alignment: scaleAlign,
                  child: AnimatedBuilder(
                    animation: _floatAnimation!,
                    builder: (context, child) {
                      return Transform.translate(
                        offset: Offset(0, _carouselMinimized ? 0 : _floatAnimation!.value),
                        child: child,
                      );
                    },
                    child: IgnorePointer(
                      ignoring: _carouselMinimized,
                      child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // drag-handle pill
                        GestureDetector(
                          onPanUpdate: (d) {
                            final toMin = isTop ? d.delta.dy < -6 : d.delta.dy > 6;
                            if (toMin) _minimizeCarousel();
                          },
                          child: Container(
                            margin: EdgeInsets.only(
                              bottom: isTop ? 6 : 0,
                              top: isTop ? 0 : 6,
                            ),
                            width: 36,
                            height: 4,
                            decoration: BoxDecoration(
                              color: Colors.white54,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ),
                        // Card
                        SizedBox(
                          height: cardHeight,
                          child: PageView.builder(
                            controller: _activeJobsController,
                            itemCount: _activeJobs.length,
                            onPageChanged: (i) => setState(() => _currentCarouselPage = i),
                            itemBuilder: (ctx, i) {
                              if (i >= _activeJobs.length) return const SizedBox();
                              return Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 4),
                                child: _buildActiveJobCard(_activeJobs[i]),
                              );
                            },
                          ),
                        ),
                        // Dots
                        if (_activeJobs.length > 1) ...[
                          const SizedBox(height: 6),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: List.generate(
                              _activeJobs.length,
                              (i) => AnimatedContainer(
                                duration: const Duration(milliseconds: 300),
                                margin: const EdgeInsets.symmetric(horizontal: 3),
                                height: 5,
                                width: _currentCarouselPage == i ? 20 : 5,
                                decoration: BoxDecoration(
                                  color: _currentCarouselPage == i
                                      ? Colors.white
                                      : Colors.white30,
                                  borderRadius: BorderRadius.circular(3),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                ),
              ),
            ),
          ),
        ),

        // ── SIMPLE BUBBLE ─────────────────────────────────────────────────
        Positioned(
          left: bx,
          top: by,
          child: GestureDetector(
            onPanUpdate: (d) => setState(() {
              _carouselBubbleX += d.delta.dx;
              _carouselBubbleY += d.delta.dy;
            }),
            onTap: _carouselMinimized ? _expandCarousel : _minimizeCarousel,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeOut,
              width: _carouselMinimized
                  ? (_carouselBubblePulse ? 54 : 48)
                  : 44,
              height: _carouselMinimized
                  ? (_carouselBubblePulse ? 54 : 48)
                  : 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFF1C1C2E),   // deep dark, no gradient
                border: Border.all(
                  color: _carouselMinimized
                      ? Colors.white.withOpacity(0.18)
                      : Colors.white.withOpacity(0.08),
                  width: 1.5,
                ),
                boxShadow: _carouselMinimized
                    ? [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.45),
                          blurRadius: _carouselBubblePulse ? 18 : 10,
                          spreadRadius: _carouselBubblePulse ? 3 : 1,
                        ),
                      ]
                    : [
                        const BoxShadow(
                          color: Color(0x33000000),
                          blurRadius: 6,
                        ),
                      ],
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Icon(
                    Icons.work_outline_rounded,
                    color: Colors.white.withOpacity(_carouselMinimized ? 0.9 : 0.55),
                    size: 20,
                  ),
                  // live dot badge
                  if (_carouselMinimized)
                    Positioned(
                      top: 4,
                      right: 4,
                      child: Container(
                        width: _activeJobs.length > 1 ? 16 : 10,
                        height: _activeJobs.length > 1 ? 16 : 10,
                        decoration: BoxDecoration(
                          color: const Color(0xFF4ADE80),
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFF1C1C2E), width: 1.5),
                        ),
                        child: _activeJobs.length > 1
                            ? Center(
                                child: Text(
                                  '${_activeJobs.length}',
                                  style: const TextStyle(
                                    fontSize: 8,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
                                  ),
                                ),
                              )
                            : null,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildActiveJobCard(Map<String, dynamic> job) {
    final status = job['status'] ?? 'OPEN';
    final category = job['category'] ?? 'Job';
    final description = job['description'] ?? '';
    final jobId = job['id']?.toString() ?? '0000';
    final imagePath = _getJobImage(category, description);
    final reqCode = "REQ-${jobId.substring(0, min(4, jobId.length)).toUpperCase()}";

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.07),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // ── Top section ──────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Thumbnail
                  ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: ImageUtils.buildServiceImage(
                      imagePath,
                      taskName: category,
                      width: 72,
                      height: 72,
                      fit: BoxFit.cover,
                      fallback: Container(
                        width: 72,
                        height: 72,
                        color: const Color(0xFFF8FAFC),
                        child: const Icon(Icons.construction,
                            color: Color(0xFFCBD5E1), size: 32),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // REQ badge + status badge row
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 9, vertical: 4),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF8FAFC),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                    color: const Color(0xFFE2E8F0), width: 1),
                              ),
                              child: Text(
                                reqCode,
                                style: GoogleFonts.inter(
                                  color: const Color(0xFF475569),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 10,
                                  letterSpacing: 0.4,
                                ),
                              ),
                            ),
                            const Spacer(),
                            _buildStatusBadge(status),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          category,
                          style: GoogleFonts.outfit(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF0F172A),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          description,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            color: const Color(0xFF64748B),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // ── Divider ───────────────────────────────────────────────────
            const Divider(height: 1, thickness: 1, color: Color(0xFFF1F5F9)),

            // ── Bottom action bar ─────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
              child: Row(
                children: [
                  // Spinner icon
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF7ED),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Center(
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Color(0xFFFF6A00),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Status text
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _getStatusSummary(status),
                          style: GoogleFonts.inter(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF0F172A),
                          ),
                        ),
                        Text(
                          _getStatusSubtitle(status),
                          style: GoogleFonts.inter(
                            fontSize: 11,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Minimize button
                  GestureDetector(
                    onTap: _minimizeCarousel,
                    child: Container(
                      width: 38,
                      height: 38,
                      margin: const EdgeInsets.only(right: 8),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(11),
                        border:
                            Border.all(color: const Color(0xFFE2E8F0), width: 1.2),
                      ),
                      child: const Icon(Icons.remove_rounded,
                          color: Color(0xFF475569), size: 18),
                    ),
                  ),
                  // Manage button
                  GestureDetector(
                    onTap: () {
                      if (['OPEN', 'REQUESTED', 'REDISTRIBUTING', 'REASSIGNING']
                          .contains(status)) {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) =>
                                SearchingWorkersScreen(job: job),
                          ),
                        ).then((_) => _fetchOngoingJob());
                      } else {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => JobDetailsScreen(
                                jobId: jobId, initialJob: job),
                          ),
                        ).then((_) => _fetchOngoingJob());
                      }
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFF6A00),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Text(
                        "Manage",
                        style: GoogleFonts.inter(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }


  /// Returns a gradient pair for the card background based on job status
  List<Color> _statusGradient(String status) {
    switch (status) {
      case 'OPEN':
      case 'REQUESTED':
        return [const Color(0xFF7C3AED), const Color(0xFF4F46E5)]; // violet → indigo
      case 'REDISTRIBUTING':
      case 'REASSIGNING':
        return [const Color(0xFFDC2626), const Color(0xFF7F1D1D)]; // Urgent redistribution: dark red → crimson
      case 'ACCEPTED':
        return [const Color(0xFF0EA5E9), const Color(0xFF0284C7)]; // sky blue
      case 'ON_THE_WAY':
        return [const Color(0xFF06B6D4), const Color(0xFF0891B2)]; // cyan
      case 'ARRIVED':
      case 'FORCE_ARRIVAL_PENDING_CONFIRMATION':
        return [const Color(0xFF10B981), const Color(0xFF059669)]; // emerald
      case 'WORK_STARTED':
      case 'WORK_IN_PROGRESS':
      case 'WAITING_FOR_PAYMENT':
        return [const Color(0xFFF97316), const Color(0xFFEA580C)]; // orange
      case 'COMPLETED':
        return [const Color(0xFF22C55E), const Color(0xFF16A34A)]; // green
      case 'CANCELLED':
        return [const Color(0xFFEF4444), const Color(0xFFDC2626)]; // red
      default:
        return [const Color(0xFFF97316), const Color(0xFFEC4899)]; // orange → pink
    }
  }

  Widget _buildStatusBadge(String status) {
    Color dotColor;
    Color bgColor;
    Color textColor;
    String displayText;

    switch (status) {
      case 'OPEN':
      case 'REQUESTED':
        dotColor = const Color(0xFF22C55E);
        bgColor = const Color(0xFFDCFCE7);
        textColor = const Color(0xFF16A34A);
        displayText = 'OPEN';
        break;
      case 'REDISTRIBUTING':
      case 'REASSIGNING':
        dotColor = const Color(0xFFF97316);
        bgColor = const Color(0xFFFFF7ED);
        textColor = const Color(0xFFEA580C);
        displayText = 'SEARCHING';
        break;
      case 'ACCEPTED':
        dotColor = const Color(0xFF3B82F6);
        bgColor = const Color(0xFFEFF6FF);
        textColor = const Color(0xFF2563EB);
        displayText = 'ASSIGNED';
        break;
      case 'ON_THE_WAY':
        dotColor = const Color(0xFF06B6D4);
        bgColor = const Color(0xFFECFEFF);
        textColor = const Color(0xFF0891B2);
        displayText = 'ON WAY';
        break;
      case 'WORK_STARTED':
      case 'WORK_IN_PROGRESS':
        dotColor = const Color(0xFF10B981);
        bgColor = const Color(0xFFF0FDF4);
        textColor = const Color(0xFF059669);
        displayText = 'WORKING';
        break;
      case 'WAITING_FOR_PAYMENT':
        dotColor = const Color(0xFFF59E0B);
        bgColor = const Color(0xFFFFFBEB);
        textColor = const Color(0xFFD97706);
        displayText = 'PAYMENT';
        break;
      case 'CANCELLED':
        dotColor = const Color(0xFFEF4444);
        bgColor = const Color(0xFFFEF2F2);
        textColor = const Color(0xFFDC2626);
        displayText = 'CANCELLED';
        break;
      default:
        dotColor = const Color(0xFF22C55E);
        bgColor = const Color(0xFFDCFCE7);
        textColor = const Color(0xFF16A34A);
        displayText = status.replaceAll('_', ' ');
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            displayText,
            style: GoogleFonts.inter(
              color: textColor,
              fontWeight: FontWeight.bold,
              fontSize: 10,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }

  String _getStatusSummary(String status) {
    switch (status) {
      case 'OPEN':
      case 'REQUESTED':
        return "Finding workers...";
      case 'REDISTRIBUTING':
      case 'REASSIGNING':
        return "Re-routing to nearby workers...";
      case 'ACCEPTED':
        return "Worker assigned";
      case 'ON_THE_WAY':
        return "Worker in transit";
      case 'WORK_STARTED':
      case 'WORK_IN_PROGRESS':
        return "In progress";
      case 'WAITING_FOR_PAYMENT':
        return "Waiting for payment...";
      default:
        return "Active Request";
    }
  }

  String _getStatusSubtitle(String status) {
    switch (status) {
      case 'OPEN':
      case 'REQUESTED':
        return "We'll notify you when someone accepts.";
      case 'REDISTRIBUTING':
      case 'REASSIGNING':
        return "Searching for the next available worker.";
      case 'ACCEPTED':
        return "Your partner is getting ready.";
      case 'ON_THE_WAY':
        return "Your partner is on the way to you.";
      case 'WORK_STARTED':
      case 'WORK_IN_PROGRESS':
        return "Your partner is working on the job.";
      case 'WAITING_FOR_PAYMENT':
        return "Please complete the payment.";
      default:
        return "Tap Manage for more details.";
    }
  }

  Map<String, dynamic> _getCategoryMetadata(String catName) {
    final serviceCat = _homeServices.getCategory(catName);
    if (serviceCat != null) {
      final statusLabel = serviceCat['statusLabel'] ?? '';
      final onlineWorkers = serviceCat['onlineWorkers'] ?? 0;
      final demand = serviceCat['demand'] ?? 'NORMAL';
      final isHighDemand = demand == 'HIGH' || demand == 'VERY_HIGH';

      String subtitle;
      if (onlineWorkers > 0) {
        subtitle = '$onlineWorkers available';
      } else if (statusLabel.isNotEmpty) {
        subtitle = statusLabel;
      } else {
        subtitle = 'Checking availability...';
      }

      return {
        "subtitle": subtitle,
        "isAlert": isHighDemand,
        "alertColor": isHighDemand
            ? const Color(0xFFEF4444)
            : onlineWorkers > 0
                ? const Color(0xFF10B981)
                : const Color(0xFF94A3B8),
      };
    }
    return {"subtitle": "Checking availability...", "isAlert": false};
  }

  Decoration _getCategoryCardDecoration(Color catColor, BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseBg = isDark ? const Color(0xFF1E1E2E) : Colors.white;
    
    final Color startColor = Color.lerp(catColor, baseBg, isDark ? 0.88 : 0.90)!;
    final Color endColor = Color.lerp(catColor, baseBg, isDark ? 0.96 : 0.97)!;
    
    return BoxDecoration(
      borderRadius: BorderRadius.circular(24),
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [startColor, endColor],
      ),
      border: Border.all(
        color: isDark
            ? catColor.withOpacity(0.18)
            : catColor.withOpacity(0.20),
        width: 1.2,
      ),
      boxShadow: [
        BoxShadow(
          color: isDark ? Colors.black.withOpacity(0.12) : catColor.withOpacity(0.04),
          blurRadius: 12,
          offset: const Offset(0, 4),
        ),
      ],
    );
  }

  Widget _buildGlowingIcon(dynamic iconData, Color catColor, BuildContext context, {double size = 48, bool isFontAwesome = true}) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: catColor.withOpacity(0.38),
            blurRadius: 12,
            spreadRadius: 1,
            offset: const Offset(0, 3),
          ),
          BoxShadow(
            color: catColor.withOpacity(0.18),
            blurRadius: 24,
            spreadRadius: 2,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Center(
        child: isFontAwesome
            ? FaIcon(
                iconData,
                color: catColor,
                size: size * 0.42,
              )
            : Icon(
                iconData,
                color: catColor,
                size: size * 0.5,
              ),
      ),
    );
  }

  Widget _buildCategoriesGrid() {
    final categories = _popularServices.isNotEmpty ? _popularServices : ServiceData.categories;
    final displayCount = _categoriesExpanded ? categories.length : min(5, categories.length);
    final totalItemCount = _categoriesExpanded ? categories.length : (categories.length > 5 ? 6 : categories.length);

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 1.55,
      ),
      itemCount: totalItemCount,
      itemBuilder: (context, index) {
        if (!_categoriesExpanded && categories.length > 5 && index == 5) {
          return InkWell(
            onTap: () {
              setState(() {
                _selectedIndex = 1;
              });
            },
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
              ),
              child: Row(
                children: [
                  Container(
                    height: 38,
                    width: 38,
                    decoration: const BoxDecoration(
                      color: Color(0xFFFFF7ED),
                      shape: BoxShape.circle,
                    ),
                    child: const Center(
                      child: Icon(Icons.add_circle_outline_rounded, color: Color(0xFFFF6A00), size: 18),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "View All",
                          style: GoogleFonts.outfit(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF0F172A),
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          "Explore more",
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            color: const Color(0xFF94A3B8),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        }

        final serviceCat = categories[index];
        final String name = serviceCat["name"] as String? ?? 'Service';
        
        final catMeta = ServiceData.categories.firstWhere(
          (c) => c["name"] == name || (c["workers"] as List).contains(name),
          orElse: () => ServiceData.categories[0],
        );
        final Color catColor = catMeta["color"] as Color;

        // Fallbacks if backend hasn't loaded yet
        final int onlineWorkers = serviceCat['onlineWorkers'] ?? 0;
        final String statusLabel = serviceCat['statusLabel'] ?? serviceCat['status'] ?? (onlineWorkers > 0 ? 'Available Now' : 'Available');
        final double avgRep = double.tryParse(serviceCat['avgReputation']?.toString() ?? '4.8') ?? 4.8;
        final int avgEta = serviceCat['avgETA'] ?? 5;
        final String badgeText = serviceCat['skillBadge'] ?? serviceCat['acceptanceBadge'] ?? 'Verified Experts';
        
        Color statusColor = const Color(0xFF10B981); // green
        if (statusLabel == 'Busy' || statusLabel == 'BUSY') {
          statusColor = const Color(0xFFF97316); // orange
        } else if (statusLabel == 'Limited' || statusLabel == 'LIMITED' || statusLabel == 'Unavailable') {
          statusColor = const Color(0xFFEF4444); // red
        }

        return InkWell(
          onTap: () {
            final workersList = catMeta["workers"] as List<dynamic>?;
            final List<String> listStr = workersList?.map((e) => e.toString()).toList() ?? [];
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (context) => WorkerTypesScreen(
                  categoryName: name,
                  workerTypes: listStr,
                  color: catColor,
                ),
              ),
            ).then((_) => _refreshAllData());
          },
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.015),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Top Row: Icon and Name
                Row(
                  children: [
                    Container(
                      height: 32,
                      width: 32,
                      decoration: BoxDecoration(
                        color: catColor.withOpacity(0.1),
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: (catMeta["icon"] is IconData && catMeta["icon"] is! FaIconData)
                            ? Icon(catMeta["icon"], color: catColor, size: 14)
                            : FaIcon(catMeta["icon"], color: catColor, size: 14),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        name,
                        style: GoogleFonts.outfit(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0F172A),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                
                // Middle Row: Status Dot and Stars
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: statusColor,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          statusLabel,
                          style: GoogleFonts.inter(
                            fontSize: 9,
                            color: statusColor,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    if (avgRep > 0)
                      Row(
                        children: [
                          const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 12),
                          const SizedBox(width: 2),
                          Text(
                            avgRep.toStringAsFixed(1),
                            style: GoogleFonts.inter(
                              fontSize: 9.5,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF475569),
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
                
                // Bottom Row: ETA and Badge
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.access_time_rounded, size: 10, color: Color(0xFF94A3B8)),
                        const SizedBox(width: 3),
                        Text(
                          "$avgEta min",
                          style: GoogleFonts.inter(
                            fontSize: 9,
                            color: const Color(0xFF64748B),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    if (badgeText.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFECE0),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          badgeText,
                          style: GoogleFonts.inter(
                            color: const Color(0xFFFF6A00),
                            fontSize: 8,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Decoration _getPremiumPopularCardDecoration(Color catColor) {
    final startColor = Color.lerp(catColor, Colors.white, 0.90)!;
    final endColor = Color.lerp(catColor, Colors.white, 0.97)!;
    
    return BoxDecoration(
      borderRadius: BorderRadius.circular(28),
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [startColor, endColor],
      ),
      border: Border.all(
        color: Colors.white,
        width: 1.5,
      ),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withOpacity(0.04),
          blurRadius: 16,
          offset: const Offset(0, 8),
        ),
      ],
    );
  }

  Widget _buildPopularGlowingIcon(dynamic iconData, Color catColor) {
    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Center(
        child: FaIcon(
          iconData,
          color: catColor,
          size: 18,
        ),
      ),
    );
  }

  Widget _buildPopularServicesList() {
    if (_isLoadingPopular) {
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: List.generate(3, (index) => const Padding(
            padding: const EdgeInsets.only(right: 16),
            child: SkeletonLoader(width: 160, height: 180, borderRadius: 20),
          )),
        ),
      );
    }
    if (_popularServices.isEmpty) {
      return _buildEmptyState("No popular services in this area yet");
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _popularServices.asMap().entries.map((entry) {
          final int index = entry.key;
          final Map<String, dynamic> service = Map<String, dynamic>.from(entry.value);
          final catName = service['name'] as String? ?? 'Service';

          // Use image already resolved by TrendingService (correct per-category)
          final String? serviceImage = service['image'] as String?;

          // Fallback color from ServiceData
          final catData = ServiceData.categories.firstWhere(
            (c) => c['name'] == catName || (c['workers'] as List).contains(catName),
            orElse: () => ServiceData.categories[0],
          );
          final Color catColor = catData['color'] as Color;

          // Real API metrics
          final int onlineWorkers = service['onlineWorkers'] ?? 0;
          final String statusLabel = service['statusLabel'] ?? service['status'] ?? (onlineWorkers > 0 ? 'Available Now' : 'Available');
          final double avgRep = double.tryParse(service['avgReputation']?.toString() ?? '4.8') ?? 4.8;
          final int avgEta = service['avgETA'] ?? 5;
          final String badge = service['skillBadge'] ?? service['demandBadge'] ?? 'Verified Experts';
          
          Color statusColor = const Color(0xFF10B981); // green
          if (statusLabel == 'Busy' || statusLabel == 'BUSY') {
            statusColor = const Color(0xFFF97316); // orange
          } else if (statusLabel == 'Limited' || statusLabel == 'LIMITED' || statusLabel == 'Unavailable') {
            statusColor = const Color(0xFFEF4444); // red
          }

          // Badge visual based on real type or default orange
          final Color badgeBg = const Color(0xFFFFECE0);
          final Color badgeFg = const Color(0xFFFF6A00);

          return GestureDetector(
            onTap: () {
              Navigator.push(context, MaterialPageRoute(
                builder: (context) => PostJobScreen(
                  initialTask: catName,
                  initialImage: catData['image'] as String?,
                  initialIcon: catData['icon'],
                ),
              )).then((_) => _refreshAllData());
            },
            child: Container(
              width: 170,
              margin: const EdgeInsets.only(right: 14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.02),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Image with LIVE badge
                  Stack(
                    children: [
                      ClipRRect(
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
                        child: ImageUtils.buildServiceImage(
                          serviceImage,
                          taskName: catName,
                          height: 100,
                          width: 170,
                          fit: BoxFit.cover,
                          fallback: Container(color: catColor.withOpacity(0.2), height: 100),
                        ),
                      ),
                      Positioned(
                        top: 8,
                        left: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF10B981),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 4, height: 4,
                                decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                              ),
                              const SizedBox(width: 4),
                              Text("LIVE",
                                style: GoogleFonts.inter(color: Colors.white, fontSize: 8, fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.all(10.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                catName,
                                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF0F172A)),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (avgRep > 0)
                              Row(
                                children: [
                                  const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 12),
                                  const SizedBox(width: 2),
                                  Text(
                                    avgRep.toStringAsFixed(1),
                                    style: GoogleFonts.inter(
                                      fontSize: 9.5,
                                      fontWeight: FontWeight.bold,
                                      color: const Color(0xFF475569),
                                    ),
                                  ),
                                ],
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        // Real status from API
                        Row(
                          children: [
                            Container(
                              width: 5,
                              height: 5,
                              decoration: BoxDecoration(
                                color: statusColor,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              statusLabel,
                              style: GoogleFonts.inter(fontSize: 10, color: statusColor, fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.access_time_rounded, size: 10, color: Color(0xFF94A3B8)),
                                const SizedBox(width: 3),
                                Text(
                                  "$avgEta min",
                                  style: GoogleFonts.inter(fontSize: 9, color: const Color(0xFF64748B), fontWeight: FontWeight.bold),
                                ),
                              ],
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
                                decoration: BoxDecoration(color: badgeBg, borderRadius: BorderRadius.circular(6)),
                                child: Text(
                                  badge,
                                  style: GoogleFonts.inter(color: badgeFg, fontSize: 8, fontWeight: FontWeight.bold),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildEmptyState(String message) {
    return GlassContainer(
      width: double.infinity,
      borderRadius: 20,
      blur: 15,
      padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 20),
      child: Column(
        children: [
          Icon(Icons.info_outline, color: GlassTheme.iconColor(context).withOpacity(0.30), size: 36),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(                  color: _textSecondary(context),
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNearbyWorkersList() {
    if (_isLoadingWorkers) {
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: List.generate(3, (index) => const Padding(
            padding: const EdgeInsets.only(right: 16),
            child: SkeletonLoader(width: 220, height: 230, borderRadius: 24),
          )),
        ),
      );
    }

    if (_topRatedWorkers.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
        ),
        child: Row(
          children: [
            const Icon(Icons.people_outline_rounded, size: 28, color: Color(0xFF94A3B8)),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                "No top rated workers near your location yet",
                style: GoogleFonts.inter(color: const Color(0xFF64748B), fontSize: 13, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _topRatedWorkers.map((worker) => _buildWorkerCard(Map<String, dynamic>.from(worker))).toList(),
      ),
    );
  }

  Widget _buildWorkerCard(Map<String, dynamic> worker) {
    final String name = worker['name'] ?? "Unknown";
    final String role = (worker['skills'] as List?)?.first ?? "General Helper";
    final double rating = (worker['rating'] ?? 4.8).toDouble();
    final double expectedPrice = (worker['expectedPrice'] ?? worker['expected_price'] ?? 250).toDouble();
    final String price = "₹${expectedPrice.toStringAsFixed(0)}/hr";
    final String dist = "${worker['distance'] ?? "2.1"} km away";
    final String? photoUrl = worker['photoUrl'];

    final workerExp = worker['experience'] ?? worker['skills']?.join(', ') ?? 'Available';
    final workerCompletion = worker['completionRate'] ?? worker['completion_rate'];
    final workerResponse = worker['responseSpeed'] ?? worker['response_speed'];
    final exp = workerExp is String ? workerExp : 'Available';
    final compRate = workerCompletion != null ? '${workerCompletion}%' : null;
    final respTime = workerResponse != null ? '${workerResponse} min' : null;

    return Container(
      width: 230,
      margin: const EdgeInsets.only(right: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.01),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Profile + Name info
          Row(
            children: [
              Stack(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
                    ),
                    child: ClipOval(
                      child: photoUrl != null && photoUrl.isNotEmpty
                          ? Image.network(
                              photoUrl.startsWith('http') ? photoUrl : '$baseUrl$photoUrl',
                              fit: BoxFit.cover,
                              errorBuilder: (c, e, s) => Image.network("https://api.dicebear.com/7.x/adventurer/png?seed=$name"),
                            )
                          : Image.network("https://api.dicebear.com/7.x/adventurer/png?seed=$name"),
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        color: Color(0xFF10B981),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check, color: Colors.white, size: 8),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: const Color(0xFF0F172A)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      exp,
                      style: GoogleFonts.inter(fontSize: 10, color: const Color(0xFF64748B), fontWeight: FontWeight.w500),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Distance and Rating row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.location_on_rounded, size: 12, color: Color(0xFF94A3B8)),
                  const SizedBox(width: 4),
                  Text(
                    dist,
                    style: GoogleFonts.inter(fontSize: 10, color: const Color(0xFF64748B), fontWeight: FontWeight.w500),
                  ),
                ],
              ),
              Row(
                children: [
                  const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 14),
                  const SizedBox(width: 2),
                  Text(
                    "$rating${worker['totalRatings'] != null ? " (${worker['totalRatings']})" : ""}",
                    style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 10, color: const Color(0xFF0F172A)),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Completion and Response Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    compRate ?? '—',
                    style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 12, color: const Color(0xFF0F172A)),
                  ),
                  Text(
                    "Completion",
                    style: GoogleFonts.inter(fontSize: 8, color: const Color(0xFF94A3B8), fontWeight: FontWeight.w500),
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    respTime ?? '—',
                    style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 12, color: const Color(0xFF0F172A)),
                  ),
                  Text(
                    "Response",
                    style: GoogleFonts.inter(fontSize: 8, color: const Color(0xFF94A3B8), fontWeight: FontWeight.w500),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Action Buttons
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _showWorkerDetails(worker),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    side: const BorderSide(color: Color(0xFFE2E8F0)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text(
                    "View",
                    style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: const Color(0xFF64748B)),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.push(context, MaterialPageRoute(
                      builder: (context) => PostJobScreen(initialTask: role),
                    ));
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2563EB),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 0,
                  ),
                  child: Text(
                    "Book",
                    style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRecommendationsList() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _recommendations.map((cat) {
          final catData = ServiceData.categories.firstWhere(
            (c) => c['name'] == cat,
            orElse: () => ServiceData.categories[0],
          );
          return GestureDetector(
            onTap: () {
              Navigator.push(context, MaterialPageRoute(builder: (context) => PostJobScreen(
                initialTask: cat,
                initialImage: catData['image'] as String?,
                initialIcon: catData['icon'],
              ))).then((_) => _refreshAllData());
            },
            child: GlassContainer(
              borderRadius: 16,
              blur: 12,
              margin: const EdgeInsets.only(right: 12),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              border: Border.all(color: (catData['color'] as Color).withOpacity(0.4)),
              child: Row(
                children: [
                  FaIcon(catData['icon'], color: catData['color'] as Color, size: 18),
                  const SizedBox(width: 8),
                  Text(cat, style: GoogleFonts.inter(fontWeight: FontWeight.bold,                    color: _textPrimary(context), fontSize: 13)),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  void _showAllTopRatedWorkersSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        return DraggableScrollableSheet(
          initialChildSize: 0.75,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          builder: (context, scrollController) => GlassContainer(
            borderRadius: 30,
            blur: 24,
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            color: isDark ? Colors.black.withOpacity(0.92) : Colors.white.withOpacity(0.96),
            border: Border.all(
              color: isDark ? Colors.white.withOpacity(0.15) : Colors.black.withOpacity(0.08),
              width: 1.5,
            ),
            child: Column(
              children: [
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white30 : Colors.black26,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      "Top Rated Experts",
                      style: GoogleFonts.outfit(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: _textPrimary(context),
                      ),
                    ),
                    GestureDetector(
                      onTap: () => Navigator.pop(context),
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isDark ? Colors.white10 : Colors.black12,
                        ),
                        child: Icon(Icons.close, size: 18, color: _textPrimary(context)),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: ListView.builder(
                    controller: scrollController,
                    itemCount: _topRatedWorkers.length,
                    itemBuilder: (context, index) {
                      final worker = _topRatedWorkers[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _buildWorkerCard(worker),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showWorkerDetails(Map<String, dynamic> worker) {
    final String name = worker['name'] ?? "Unknown";
    final String role = (worker['skills'] as List?)?.first ?? "General Helper";
    final double rating = (worker['rating'] ?? 0.0).toDouble();
    final int jobs = worker['jobs_completed'] ?? worker['jobsCompleted'] ?? 0;
    final String? photoUrl = worker['photoUrl'];
    final String phone = worker['phoneNumber'] ?? worker['phone_number'] ?? '9999999999';

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        return GlassContainer(
          borderRadius: 30,
          blur: 18,
          padding: const EdgeInsets.all(24),
          margin: const EdgeInsets.all(16),
          color: isDark ? Colors.black.withOpacity(0.92) : Colors.white.withOpacity(0.96),
          border: Border.all(
            color: isDark ? Colors.white.withOpacity(0.15) : Colors.black.withOpacity(0.08),
            width: 1.5,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: isDark ? Colors.white24 : Colors.black26,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  CircleAvatar(
                    radius: 30,
                    backgroundColor: isDark ? Colors.white10 : Colors.black.withOpacity(0.05),
                    backgroundImage: photoUrl != null 
                      ? NetworkImage(photoUrl.startsWith('http') ? photoUrl : '$baseUrl$photoUrl') 
                      : null,
                    child: photoUrl == null 
                      ? Icon(Icons.person, size: 30, color: isDark ? Colors.white70 : Colors.black54) 
                      : null,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: GoogleFonts.outfit(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: _textPrimary(context),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(Icons.star, color: Colors.amberAccent, size: 16),
                            const SizedBox(width: 4),
                            Text(
                              "$rating ($jobs completed jobs)",
                              style: GoogleFonts.inter(
                                color: _textSecondary(context),
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFF10B981).withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.verified, color: Color(0xFF10B981), size: 20),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: GlassButton(
                      text: "Call Now",
                      icon: Icons.phone,
                      onPressed: () async {
                        final Uri launchUri = Uri(scheme: 'tel', path: phone);
                        await launchUrl(launchUri);
                      },
                      isPrimary: true,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: GlassButton(
                      text: "Message",
                      icon: Icons.chat_bubble_outline,
                      onPressed: () async {
                        Navigator.pop(context); // Close details modal
                        
                        // Show loading indicator
                        showDialog(
                          context: context,
                          barrierDismissible: false,
                          builder: (context) => const Center(
                            child: CircularProgressIndicator(color: Color(0xFFFF6A00)),
                          ),
                        );

                        try {
                          final token = await SharedPrefsHelper.getToken();
                          final response = await http.post(
                            Uri.parse('${NetworkHelper.baseUrl}/api/chat/init'),
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': 'Bearer $token',
                            },
                            body: json.encode({
                              'workerId': worker['id'] ?? worker['workerId'] ?? '',
                            }),
                          );

                          // Dismiss loading indicator
                          if (context.mounted) Navigator.pop(context);

                          if (response.statusCode == 200) {
                            final data = json.decode(response.body);
                            if (data['success'] == true && context.mounted) {
                              final String jobId = data['jobId'];
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (context) => ChatDetailScreen(
                                    jobId: jobId,
                                    name: name,
                                    image: photoUrl ?? "assets/images/skilled/trades/ac technician.jpg",
                                    service: role,
                                  ),
                                ),
                              );
                            }
                          }
                        } catch (e) {
                          // Dismiss loading indicator
                          if (context.mounted) Navigator.pop(context);
                          debugPrint("Error initiating chat: $e");
                        }
                      },
                      isPrimary: false,
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildBottomNav() {
    const activeBlue = Color(0xFF1B6DF9);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 20), // padded float margin
      child: Container(
        height: 72,
        decoration: BoxDecoration(
          color: activeBlue,
          borderRadius: BorderRadius.circular(36),
          boxShadow: [
            BoxShadow(
              color: activeBlue.withOpacity(0.3),
              blurRadius: 16,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _buildNavItem(0, Icons.home_outlined, Icons.home_rounded, "Home"),
            _buildNavItem(1, Icons.grid_view_rounded, Icons.grid_view_rounded, "Explore"),
            _buildCenterAction(),
            _buildNavItem(2, Icons.work_outline_rounded, Icons.work_rounded, "Gigs"),
            _buildNavItem(3, Icons.chat_bubble_outline_rounded, Icons.chat_bubble_rounded, "Inbox"),
          ],
        ),
      ),
    );
  }

  Widget _buildNavItem(int index, IconData outlineIcon, IconData solidIcon, String label) {
    bool isSelected = _selectedIndex == index;
    const activeBlue = Color(0xFF1B6DF9);

    return AnimatedSize(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeInOut,
      child: GestureDetector(
        onTap: () {
          setState(() {
            _selectedIndex = index;
            if (index == 0) {
              _refreshAllData();
            } else if (index == 2) {
              _myJobsKey++;
            }
          });
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(24),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Icon(
                    isSelected ? solidIcon : outlineIcon,
                    color: isSelected ? activeBlue : Colors.white.withOpacity(0.75),
                    size: 20,
                  ),
                  if (index == 3) // Inbox Notification Badge
                    Positioned(
                      top: -6,
                      right: -6,
                      child: Container(
                        padding: const EdgeInsets.all(3),
                        decoration: BoxDecoration(
                          color: isSelected ? activeBlue : Colors.white,
                          shape: BoxShape.circle,
                        ),
                        constraints: const BoxConstraints(minWidth: 14, minHeight: 14),
                        child: Center(
                          child: Text(
                            "$_unreadCount",
                            style: GoogleFonts.inter(
                              color: isSelected ? Colors.white : activeBlue,
                              fontSize: 7.5,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              if (isSelected) ...[
                const SizedBox(width: 8),
                Text(
                  label,
                  style: GoogleFonts.inter(
                    color: activeBlue,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCenterAction() {
    return GestureDetector(
      onTap: () async {
        final result = await Navigator.push(
          context,
          MaterialPageRoute(builder: (context) => const PostJobScreen()),
        );
        _refreshAllData();
        if (result != null && result is int) {
          setState(() {
            _selectedIndex = result;
            if (result == 2) {
              _myJobsKey++;
            }
          });
        }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        color: Colors.transparent,
        child: Icon(
          Icons.add_circle_outline_rounded,
          color: Colors.white.withOpacity(0.75),
          size: 24,
        ),
      ),
    );
  }

  Future<void> _fetchRecentlyCompleted(double lat, double lng) async {
    if (_feedSubscription == null) {
      _feedSubscription = _feedService.feedStream.listen((results) {
        if (mounted) {
          setState(() {
            _recentlyCompleted = results;
            _isLoadingFeed = false;
          });
          debugPrint('[HOME] 🔴 Feed stream update: ${results.length} posts');
        }
      });
    }

    if (!mounted) return;
    setState(() => _isLoadingFeed = true);

    // Show cached result synchronously if any
    final cached = _feedService.lastResult;
    if (cached.isNotEmpty && mounted) {
      setState(() {
        _recentlyCompleted = cached;
        _isLoadingFeed = false;
      });
    }

    await _feedService.fetch(lat, lng);
  }

  Widget _buildRecentlyCompletedSection() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    // Facepile workers
    final activeWorkers = _feedService.activeWorkers;
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Section Header Row
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      "Recently Completed",
                      style: GoogleFonts.outfit(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: _textPrimary(context),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Live Indicator Pill
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFDCFCE7),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF86EFAC), width: 1),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // Pulse dot
                          Container(
                            width: 6,
                            height: 6,
                            decoration: const BoxDecoration(
                              color: Color(0xFF16A34A),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            "LIVE",
                            style: GoogleFonts.inter(
                              color: const Color(0xFF15803D),
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  "Real-time job verification in your neighborhood",
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: _textSecondary(context).withOpacity(0.85),
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 16),
        
        // Feed Cards Scroll
        if (_isLoadingFeed && _recentlyCompleted.isEmpty)
          Column(
            children: List.generate(2, (index) => Padding(
              padding: const EdgeInsets.only(bottom: 24),
              child: SkeletonLoader(width: double.infinity, height: 380, borderRadius: 28),
            )),
          )
        else if (_recentlyCompleted.isEmpty)
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 40),
              child: Text(
                "No completed jobs verified nearby yet.",
                style: GoogleFonts.inter(
                  color: _textSecondary(context),
                  fontSize: 14,
                ),
              ),
            ),
          )
        else
          Column(
            children: _recentlyCompleted.map((post) {
              final String postId = post['id'] ?? '';
              final String title = post['title'] ?? 'Verified Clean Work';
              final String category = post['category'] ?? 'General';
              final String address = post['address'] ?? 'Nearby';
              final String caption = post['caption'] ?? '';
              final String completedAtStr = post['completedAt'] ?? '';
              final List<dynamic> images = post['imageUrls'] ?? [];
              
              final int likesCount = post['likesCount'] ?? 0;
              final int commentsCount = post['commentsCount'] ?? 0;
              final int viewsCount = post['viewsCount'] ?? 0;
              final bool isLiked = post['isLiked'] ?? false;
              final bool isSaved = post['isSaved'] ?? false;
              
              // Icon mapping
              IconData catIcon = Icons.check_circle_outline_rounded;
              Color catColor = const Color(0xFF8B5CF6);
              if (category == 'Electrical') {
                catIcon = Icons.bolt;
                catColor = const Color(0xFFF59E0B);
              } else if (category == 'Sanitization') {
                catIcon = Icons.clean_hands_rounded;
                catColor = const Color(0xFF10B981);
              } else if (category == 'Appliance Repair') {
                catIcon = Icons.build_rounded;
                catColor = const Color(0xFF3B82F6);
              }
              
              return Container(
                margin: const EdgeInsets.only(bottom: 32),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(28),
                  color: isDark ? const Color(0xFF1E1E2E) : Colors.white,
                  border: Border.all(
                    color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.05),
                    width: 1,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 24,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Image and visual banner area
                    if (images.isNotEmpty)
                      Stack(
                        children: [
                          ClipRRect(
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
                            child: SizedBox(
                              height: 380,
                              width: double.infinity,
                              child: Image.network(
                                images[0] as String,
                                fit: BoxFit.cover,
                                errorBuilder: (c, e, s) => Container(
                                  color: Colors.grey.shade200,
                                  child: Icon(Icons.broken_image_rounded, size: 48, color: Colors.grey.shade400),
                                ),
                              ),
                            ),
                          ),
                          
                          // Linear bottom overlay gradient
                          Positioned.fill(
                            child: Container(
                              decoration: BoxDecoration(
                                borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    Colors.black.withOpacity(0.2),
                                    Colors.transparent,
                                    Colors.black.withOpacity(0.75),
                                  ],
                                  stops: const [0.0, 0.5, 1.0],
                                ),
                              ),
                            ),
                          ),
                          
                          // Top-Left Category Pill Tag
                          Positioned(
                            top: 16,
                            left: 16,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(16),
                                boxShadow: [
                                  BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 8),
                                ],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(catIcon, color: catColor, size: 14),
                                  const SizedBox(width: 4),
                                  Text(
                                    category.toUpperCase(),
                                    style: GoogleFonts.inter(
                                      color: const Color(0xFF1E1B4B),
                                      fontSize: 10,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: 0.5,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          
                          // Top-Right Trending Pill Tag
                          Positioned(
                            top: 16,
                            right: 16,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFF9800).withOpacity(0.85),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: Colors.white24, width: 1),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.bolt_outlined, color: Colors.white, size: 12),
                                  const SizedBox(width: 4),
                                  Text(
                                    "Trending",
                                    style: GoogleFonts.inter(
                                      color: Colors.white,
                                      fontSize: 10,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          
                          // Core Titles inside card bottom
                          Positioned(
                            bottom: 20,
                            left: 20,
                            right: 20,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  title,
                                  style: GoogleFonts.outfit(
                                    fontSize: 24,
                                    fontWeight: FontWeight.w800,
                                    color: Colors.white,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    const Icon(Icons.location_on, color: Colors.white70, size: 12),
                                    const SizedBox(width: 4),
                                    Text(
                                      address,
                                      style: GoogleFonts.inter(
                                        color: Colors.white.withOpacity(0.85),
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    
                    // Card body & comments block
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Interactive Action Bar Row
                          Row(
                            children: [
                              // Like button
                              GestureDetector(
                                onTap: () => _feedService.likePost(postId),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: isLiked 
                                        ? const Color(0xFFFEE2E2) 
                                        : Colors.black.withOpacity(0.03),
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        isLiked ? Icons.favorite : Icons.favorite_border,
                                        color: isLiked ? const Color(0xFFEF4444) : _textSecondary(context),
                                        size: 18,
                                      ),
                                      const SizedBox(width: 6),
                                      Text(
                                        likesCount.toString(),
                                        style: GoogleFonts.inter(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                          color: isLiked ? const Color(0xFFB91C1C) : _textPrimary(context),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              
                              // Divider
                              Text(
                                "|",
                                style: TextStyle(color: Colors.black.withOpacity(0.1), fontSize: 16),
                              ),
                              const SizedBox(width: 8),
                              
                              // Comments button
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                decoration: BoxDecoration(
                                  color: Colors.black.withOpacity(0.03),
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                child: Row(
                                  children: [
                                    Icon(Icons.chat_bubble_outline_rounded, color: _textSecondary(context), size: 18),
                                    const SizedBox(width: 6),
                                    Text(
                                      commentsCount.toString(),
                                      style: GoogleFonts.inter(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 13,
                                        color: _textPrimary(context),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Spacer(),
                              
                              // Views Counter text
                              Text(
                                "$viewsCount VIEWS",
                                style: GoogleFonts.inter(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                  color: _textSecondary(context).withOpacity(0.65),
                                  letterSpacing: 0.5,
                                ),
                              ),
                              const SizedBox(width: 12),
                              
                              // Save Bookmark Button
                              GestureDetector(
                                onTap: () => _feedService.savePost(postId),
                                child: Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: isSaved 
                                        ? const Color(0xFFFEF3C7) 
                                        : Colors.black.withOpacity(0.03),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    isSaved ? Icons.bookmark_rounded : Icons.bookmark_outline_rounded,
                                    color: isSaved ? const Color(0xFFD97706) : _textSecondary(context),
                                    size: 18,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              
                              // Share button
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.black.withOpacity(0.03),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(Icons.share_outlined, color: _textSecondary(context), size: 18),
                              ),
                            ],
                          ),
                          const SizedBox(height: 20),
                          
                          // Elegant review feedback container
                          if (caption.isNotEmpty)
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: isDark ? Colors.white.withOpacity(0.02) : const Color(0xFFF9FAFB),
                                borderRadius: BorderRadius.circular(20),
                                border: Border(
                                  left: BorderSide(color: catColor, width: 4),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Row(
                                        children: [
                                          Text(
                                            "Client Verified",
                                            style: GoogleFonts.outfit(
                                              fontWeight: FontWeight.bold,
                                              fontSize: 14,
                                              color: const Color(0xFFF97316),
                                            ),
                                          ),
                                          const SizedBox(width: 4),
                                          const Icon(Icons.star_rounded, color: Colors.orange, size: 14),
                                        ],
                                      ),
                                      if (completedAtStr.isNotEmpty)
                                        Text(
                                          _formatTimeAgo(completedAtStr).toUpperCase(),
                                          style: GoogleFonts.inter(
                                            fontSize: 10,
                                            fontWeight: FontWeight.w800,
                                            color: _textSecondary(context).withOpacity(0.55),
                                          ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    "\"$caption\"",
                                    style: GoogleFonts.inter(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w500,
                                      color: _textPrimary(context),
                                      fontStyle: FontStyle.italic,
                                      height: 1.45,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            }).toList(),
          ),
      ],
    );
  }

  String _formatTimeAgo(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      final diff = DateTime.now().difference(dt);
      if (diff.inMinutes < 60) return "${diff.inMinutes}m ago";
      if (diff.inHours < 24) return "${diff.inHours}h ago";
      return "${diff.inDays}d ago";
    } catch (e) {
      return "Recently";
    }
  }
}

/// Custom clipper to draw a vertical hexagon with rounded corners
class RoundedHexagonClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final path = Path();
    final double w = size.width;
    final double h = size.height;
    final double r = 8.0; // corner radius adjustment

    // Vertical Hexagon points:
    // P1: (w/2, 0) - top center
    // P2: (w, h*0.25) - top right
    // P3: (w, h*0.75) - bottom right
    // P4: (w/2, h) - bottom center
    // P5: (0, h*0.75) - bottom left
    // P6: (0, h*0.25) - top left

    path.moveTo(w * 0.5, r);
    path.quadraticBezierTo(w * 0.5, 0, w * 0.5 + r * 0.86, r * 0.5);

    path.lineTo(w - r * 0.86, h * 0.25 - r * 0.5);
    path.quadraticBezierTo(w, h * 0.25, w, h * 0.25 + r);

    path.lineTo(w, h * 0.75 - r);
    path.quadraticBezierTo(w, h * 0.75, w - r * 0.86, h * 0.75 + r * 0.5);

    path.lineTo(w * 0.5 + r * 0.86, h - r * 0.5);
    path.quadraticBezierTo(w * 0.5, h, w * 0.5 - r * 0.86, h - r * 0.5);

    path.lineTo(r * 0.86, h * 0.75 + r * 0.5);
    path.quadraticBezierTo(0, h * 0.75, 0, h * 0.75 - r);

    path.lineTo(0, h * 0.25 + r);
    path.quadraticBezierTo(0, h * 0.25, r * 0.86, h * 0.25 - r * 0.5);

    path.lineTo(w * 0.5 - r * 0.86, r * 0.5);
    path.close();

    return path;
  }

  @override
  bool shouldReclip(CustomClipper<Path> oldClipper) => false;
}

