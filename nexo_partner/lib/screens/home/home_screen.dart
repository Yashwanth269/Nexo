import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:geocoding/geocoding.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

import '../../services/socket_service.dart';
import '../../services/cache_service.dart';
import '../../services/background_service.dart';
import '../../services/worker_eligibility_manager.dart';
import '../../widgets/job_request_modal.dart';
import '../../widgets/skeleton_loader.dart';
import '../../utils/network_helper.dart';
import '../../utils/image_utils.dart';
import '../../components/glass_components.dart';
import 'incoming_job_screen.dart';
import 'package:flutter_background_service/flutter_background_service.dart';

import '../auth/login_screen.dart';
import '../settings/settings_screen.dart';
import '../job/active_jobs_screen.dart';
import '../earnings/earnings_history_screen.dart';
import '../profile/worker_profile_screen.dart';
import '../chat/chat_list_screen.dart';
import '../notifications/notifications_screen.dart';
import '../support/support_screen.dart';
import '../job/new_job_offer_screen.dart';
import '../job/job_execution_screen.dart';
import '../security/selfie_verification_screen.dart';
import 'dart:ui' as ui;

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  static int? pendingTabIndex;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  int _selectedIndex = 0;
  final List<dynamic> _jobRequests = [];
  final Set<String> _rejectedJobIds = {};
  final Set<String> _shownJobIds = {}; // Prevent showing same job banner twice
  bool _isShowingIncomingJob = false; // Guard: only one banner at a time
  final List<dynamic> _activeGigs = [];
  final SocketService _socketService = SocketService();
  StreamSubscription<Position>? _positionStream;
  String _phoneNumber = "Worker";
  String? _token;

  Map<String, String> _getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
  }
  String _workerName = "Expert";
  String? _profilePhoto;
  String _locationStatus = "Activating location...";
  bool _isOnline = false;
  bool _isSearching = false;
  bool _isOffline = false;
  bool _hideEarnings = false;
  List<String> _mySkills = [];
  String _currentArea = "Detecting location...";
  StreamSubscription<ConnectivityResult>? _connectivitySubscription;
  DateTime? _lastGeocodeTime;
  Timer? _refreshTimer;
  
  Map<String, dynamic>? _earningsSummary;
  String _selectedTimeframe = 'today'; // 'today', 'week', 'month', 'year', 'random'
  String? _selectedCustomDateStr;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadUserData();
    _loadRejectedJobIds(); // Restore persisted rejected IDs
    _requestPermissions();
    _fetchInitialData();
    
    // Listen for background service socket events
    FlutterBackgroundService().on('incoming_job').listen((event) {
      if (event != null && event['job'] != null) {
        _onNewJobSocket(event['job']);
      }
    });
  }

  Future<void> _loadRejectedJobIds() async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> saved = prefs.getStringList('rejected_job_ids') ?? [];
    _rejectedJobIds.addAll(saved);
  }

  Future<void> _persistRejectedJobIds() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList('rejected_job_ids', _rejectedJobIds.toList());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      debugPrint("🚀 [APP_RESUMED] Re-synchronizing state...");
      _socketService.connect((job) => _onNewJobSocket(job)); // Ensure socket resync
      if (_isOnline) {
        _startRefreshTimer();
      }
      _handleAppResume();
    }
  }

  Future<void> _handleAppResume() async {
    debugPrint("📡 [FETCH_ACTIVE_JOBS] Recovering execution state...");
    await _checkPendingIncomingJob();
    await _fetchActiveGigs();
    
    // Only fetch available if not currently busy (optional business rule)
    debugPrint("📡 [FETCH_AVAILABLE_JOBS] Updating available feed...");
    await _fetchPendingOffers();
    await _fetchNearbyJobs();
  }


  String _getInitials() {
    return _phoneNumber.isNotEmpty ? _phoneNumber[0].toUpperCase() : "W";
  }

  Future<void> _fetchInitialData() async {
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen((ConnectivityResult result) {
      setState(() => _isOffline = result == ConnectivityResult.none);
      if (_isOffline) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("You are currently offline. Checking connection..."), backgroundColor: Color(0xFFEF4444)),
        );
      }
    });
  }

  @override
  void dispose() {
    _connectivitySubscription?.cancel();
    _positionStream?.cancel();
    _socketService.disconnect();
    _stopRefreshTimer();
    super.dispose();
  }

  void _startRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(const Duration(seconds: 10), (timer) {
      if (!_isOnline || !mounted) {
        timer.cancel();
        return;
      }
      _fetchJobsAndOffers();
      _fetchNearbyJobs();
    });
  }

  void _stopRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }

  Future<void> _checkPendingIncomingJob() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final pendingStr = prefs.getString('pending_incoming_job');
      if (pendingStr != null && pendingStr.isNotEmpty) {
        await prefs.remove('pending_incoming_job');
        final jobMap = jsonDecode(pendingStr);
        if (mounted) {
          _onNewJobSocket(jobMap);
        }
      }
    } catch (e) {
      debugPrint("Error checking pending incoming job: $e");
    }
  }

  Future<void> _loadUserData() async {
    final prefs = await SharedPreferences.getInstance();
    final savedOnline = prefs.getBool('isOnline') ?? false;
    setState(() {
      _workerName = prefs.getString('workerName') ?? "Expert";
      _phoneNumber = prefs.getString('workerPhone') ?? prefs.getString('worker_phone') ?? "Worker";
      _profilePhoto = prefs.getString('workerPhoto');
      _token = prefs.getString('worker_token');
      _isOnline = savedOnline;
    });

    // Migration: If we found legacy key but not new key, save it
    if (_phoneNumber != "Worker" && prefs.getString('workerPhone') == null) {
      await prefs.setString('workerPhone', _phoneNumber);
      debugPrint("🔄 [MIGRATION] Migrated legacy worker_phone to workerPhone");
    }
    
    // Ensure data is loaded before fetching
    if (_phoneNumber != "Worker") {
      debugPrint("📦 [LOAD_USER_DATA] Identity confirmed: $_phoneNumber");
      _loadCachedActiveGigs();
      _fetchActiveGigs();
      _fetchPendingOffers();
      _fetchNearbyJobs();
      _fetchEarningsSummary();
      _preloadData();
      _checkPendingIncomingJob();

      if (savedOnline) {
        _toggleOnline(true);
      }
    }
  }

  Future<void> _requestPermissions() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      setState(() => _currentArea = "GPS Disabled");
      return;
    }

    // Request notification permission for Android 13+
    if (await Permission.notification.isDenied) {
      await Permission.notification.request();
    }

    // Request other critical permissions to align with Zomato delivery requirements
    if (await Permission.activityRecognition.isDenied) {
      await Permission.activityRecognition.request();
    }
    if (await Permission.camera.isDenied) {
      await Permission.camera.request();
    }
    if (await Permission.microphone.isDenied) {
      await Permission.microphone.request();
    }
    if (await Permission.phone.isDenied) {
      await Permission.phone.request();
    }
    if (await Permission.systemAlertWindow.isDenied) {
      await Permission.systemAlertWindow.request();
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        setState(() => _currentArea = "Permission Denied");
        return;
      }
    }
    
    if (permission == LocationPermission.deniedForever) {
      setState(() => _currentArea = "Location Blocked");
      return;
    }

    // Prompt user to enable "Allow all the time" for continuous background updates
    if (permission == LocationPermission.always || permission == LocationPermission.whileInUse) {
      final bgStatus = await Permission.locationAlways.status;
      if (bgStatus.isDenied) {
        await Permission.locationAlways.request();
      }
    }

    // Start continuous updates immediately
    _startLocationUpdates();
  }

  Future<void> _refreshLocation() async {
    setState(() => _currentArea = "Detecting area...");
    try {
      Position? position = await Geolocator.getLastKnownPosition();
      position ??= await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 5),
      );
      if (position != null) {
        _updateLocationUI(position);
        if (_isOnline) {
          _socketService.updateLocation(position.latitude, position.longitude);
        }
      } else {
        setState(() => _currentArea = "Location Unavailable");
      }
    } catch (e) {
      setState(() => _currentArea = "Detection Timeout");
    }
  }

  void _updateLocationUI(Position position) async {
    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(position.latitude, position.longitude);
      if (placemarks.isNotEmpty) {
        Placemark place = placemarks[0];
        setState(() {
          _currentArea = "${place.subLocality ?? place.locality}, ${place.administrativeArea}";
        });
      }
    } catch (e) {
      setState(() => _currentArea = "Nearby Area");
    }
  }

  Future<void> _fetchJobsAndOffers() async {
    if (_phoneNumber == "Worker") return;
    await _fetchActiveGigs();
    await _fetchPendingOffers();
  }

  Future<void> _loadCachedActiveGigs() async {
    final cached = await CacheService.getJsonList('active_gigs');
    if (cached != null && mounted) {
      setState(() {
        _activeGigs.clear();
        _activeGigs.addAll(cached);
      });
      debugPrint("⚡ [CACHE_HIT] Active Gigs loaded from local cache: ${cached.length} items.");
    }
    final cachedSummary = await CacheService.getJsonMap('earnings_summary');
    if (cachedSummary != null && mounted) {
      setState(() {
        _earningsSummary = cachedSummary;
      });
      debugPrint("⚡ [CACHE_HIT] Earnings summary loaded from local cache.");
    }
  }

  Future<void> _fetchEarningsSummary({String? date}) async {
    if (_phoneNumber == "Worker") return;
    try {
      String url = '${NetworkHelper.baseUrl}/api/jobs/worker/earnings/summary/$_phoneNumber';
      if (date != null) {
        url += '?date=$date';
      }
      final response = await http.get(Uri.parse(url), headers: _getAuthHeaders());
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final summary = data['summary'];
        if (summary != null) {
          if (date == null) {
            await CacheService.setJsonMap('earnings_summary', summary);
          }
          if (mounted) {
            setState(() {
              _earningsSummary = summary;
            });
          }
        }
      }
    } catch (e) {
      debugPrint("❌ [EARNINGS_SUMMARY_FETCH_ERROR] $e");
    }
  }

  Future<void> _preloadData() async {
    if (_phoneNumber == "Worker") return;
    final startTime = DateTime.now();
    try {
      await Future.wait([
        _fetchActiveGigsSilent(),
        _preloadEarningsSummarySilent(),
      ]);
      final duration = DateTime.now().difference(startTime).inMilliseconds;
      debugPrint("⚡ [BACKGROUND_PRELOAD] Completed in ${duration}ms");
    } catch (e) {
      debugPrint("❌ [BACKGROUND_PRELOAD_ERROR] $e");
    }
  }

  Future<void> _fetchActiveGigsSilent() async {
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/worker/active-jobs-light/$_phoneNumber'),
        headers: _getAuthHeaders(),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List<dynamic> active = data['jobs'] ?? [];
        await CacheService.setJsonList('active_gigs', active);
        if (mounted) {
          setState(() {
            _activeGigs.clear();
            _activeGigs.addAll(active);
          });
        }
      }
    } catch (e) {
      debugPrint("❌ [ACTIVE_GIGS_PRELOAD_ERROR] $e");
    }
  }

  Future<void> _preloadEarningsSummarySilent() async {
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/worker/earnings/summary/$_phoneNumber'),
        headers: _getAuthHeaders(),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final summary = data['summary'];
        if (summary != null) {
          await CacheService.setJsonMap('earnings_summary', summary);
          if (mounted) {
            setState(() {
              _earningsSummary = summary;
            });
          }
        }
      }
    } catch (e) {
      debugPrint("❌ [EARNINGS_SUMMARY_PRELOAD_ERROR] $e");
    }
  }

  Future<void> _fetchActiveGigs() async {
    final cached = await CacheService.getJsonList('active_gigs');
    if (cached != null && mounted) {
      setState(() {
        _activeGigs.clear();
        _activeGigs.addAll(cached);
      });
    }

    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/worker/active-jobs-light/$_phoneNumber'),
        headers: _getAuthHeaders(),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List<dynamic> active = data['jobs'] ?? [];
        await CacheService.setJsonList('active_gigs', active);
        if (mounted) {
          setState(() {
            _activeGigs.clear();
            _activeGigs.addAll(active);
          });
          if (active.isNotEmpty) {
            debugPrint("✅ [ACTIVE_JOB_RESTORED] Found ${active.length} jobs");
          }
        }
      }
    } catch (e) {
      debugPrint("❌ [FETCH-ACTIVE-ERROR] $e");
    }
  }

  Future<void> _fetchPendingOffers() async {
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/offers/pending/$_phoneNumber'),
        headers: _getAuthHeaders(),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List<dynamic> pending = data['jobs'] ?? [];
        final Set<String> validPendingIds = pending
            .map((j) => (j['id']?.toString() ?? j['_id']?.toString()) ?? "")
            .where((id) => id.isNotEmpty)
            .toSet();

        setState(() {
          // Only remove stale PENDING OFFERS (never wipe nearby discovery jobs)
          _jobRequests.removeWhere((j) {
            String id = j['id']?.toString() ?? j['_id']?.toString() ?? "";
            return j['isPendingOffer'] == true && !validPendingIds.contains(id);
          });
          
          for (var job in pending) {
            String currentJobId = job['id']?.toString() ?? job['_id']?.toString() ?? "";
            bool isAlreadyActive = _activeGigs.any((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
            bool isDuplicate = _jobRequests.any((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
            bool isRejected = _rejectedJobIds.contains(currentJobId);
            
            if (!isAlreadyActive && !isRejected) {
              if (!isDuplicate) {
                final newJob = {
                  ...job,
                  'isPendingOffer': true,
                };
                _jobRequests.add(newJob);
              }
            }
          }
          debugPrint("✅ [PENDING_OFFERS_UPDATED] Feed synced smoothly.");
        });
      }
    } catch (e) {
      debugPrint("❌ [FETCH-PENDING-ERROR] $e");
    }
  }

  Future<void> _fetchNearbyJobs({Position? position}) async {
    if (!_isOnline) return;
    
    try {
      Position? pos = position;
      if (pos == null) {
        try {
          pos = await Geolocator.getLastKnownPosition();
          pos ??= await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.low,
            timeLimit: const Duration(seconds: 2),
          );
        } catch (e) {
          debugPrint("⚠️ [GPS] Failed to retrieve current GPS for nearby jobs: $e");
        }
      }
      
      final lat = pos?.latitude ?? 12.9716;
      final lng = pos?.longitude ?? 77.5946;

      // Pass workerId to filter out rejected jobs
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/nearby?lat=$lat&lng=$lng&radius=$_searchRadius&workerId=$_phoneNumber'),
        headers: _getAuthHeaders(),
      );
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List<dynamic> nearby = data['jobs'] ?? [];
        final Set<String> validNearbyIds = nearby
            .map((j) => (j['id']?.toString() ?? j['_id']?.toString()) ?? "")
            .where((id) => id.isNotEmpty)
            .toSet();

        setState(() {
          // Remove nearby jobs that are no longer nearby / valid
          _jobRequests.removeWhere((j) {
            String id = j['id']?.toString() ?? j['_id']?.toString() ?? "";
            return j['isNearbyJob'] == true && !validNearbyIds.contains(id);
          });

          for (var job in nearby) {
            String currentJobId = job['id']?.toString() ?? job['_id']?.toString() ?? "";
            bool isAlreadyActive = _activeGigs.any((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
            bool isDuplicate = _jobRequests.any((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
            bool isRejected = _rejectedJobIds.contains(currentJobId);
            
            if (!isAlreadyActive && !isDuplicate && !isRejected) {
              final newJob = {
                ...job,
                'isNearbyJob': true,
              };
              _jobRequests.add(newJob);
            }
          }
        });
      }
    } catch (e) {
      debugPrint("Nearby fetch error: $e");
    }
  }

  double _searchRadius = 10.0;
  bool _isPaused = false;

  void _showOfflineConfirmation() {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF151515), // Matches the premium dark bottom sheet background
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: Colors.white.withOpacity(0.08)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.4),
                blurRadius: 24,
                offset: const Offset(0, 8),
              )
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF2563EB).withOpacity(0.12),
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFF2563EB).withOpacity(0.3), width: 1.5),
                ),
                child: const Icon(
                  Icons.power_settings_new_rounded,
                  color: Color(0xFF2563EB),
                  size: 36,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                "Go Offline?",
                style: GoogleFonts.outfit(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                "You will stop receiving new gig requests. Are you sure you want to go offline?",
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 14,
                  color: Colors.white60,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(color: Colors.white.withOpacity(0.12)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: Text(
                        "Stay Online",
                        style: GoogleFonts.outfit(
                          color: Colors.white70,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF2563EB).withOpacity(0.24),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          )
                        ],
                      ),
                      child: ElevatedButton(
                        onPressed: () {
                          Navigator.pop(context);
                          _toggleOnline(false);
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF2563EB),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                          elevation: 0,
                        ),
                        child: Text(
                          "Go Offline",
                          style: GoogleFonts.outfit(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _toggleOnline(bool value) async {
    if (value) {
      final isEligible = await WorkerEligibilityManager.showEligibilitySheet(context);
      if (!isEligible) {
        if (mounted) setState(() => _isOnline = false);
        return;
      }
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('isOnline', value);

    if (!mounted) return;
    setState(() {
      _isOnline = value;
      _isSearching = value;
    });
    
    if (_isOnline) {
      _fetchJobsAndOffers();
      _fetchNearbyJobs();
      _startRefreshTimer();
      
      _socketService.connect((job) => _onNewJobSocket(job));
      BackgroundTracker.startOnlineService();
      
      // LISTEN: Realtime Job Taken (by another worker)
      _socketService.socket?.on('job_taken', (data) {
        if (data != null && mounted) {
          final String? takenJobId = (data['jobId'] ?? data['job_id'])?.toString();
          final String? takenWorkerId = (data['workerId'] ?? data['worker_id'])?.toString();
          final String? takenWorkerPhone = (data['workerPhone'] ?? data['worker_phone'])?.toString();
          
          // Ignore if current worker is the one who accepted
          if (takenWorkerId == _phoneNumber || takenWorkerPhone == _phoneNumber) return;

          if (takenJobId != null && takenJobId.isNotEmpty) {
            debugPrint("🚫 [SOCKET] Job $takenJobId taken by another worker ($takenWorkerId). Removing from feed.");
            setState(() {
              _jobRequests.removeWhere((j) {
                final id = (j['id'] ?? j['_id'] ?? j['jobId'] ?? j['job_id'])?.toString();
                return id == takenJobId;
              });
            });
          }
        }
      });

      _socketService.socket?.on('job_cancelled_by_worker', (data) {
        if (data != null) {
          debugPrint("🔔 [SOCKET] Job cancelled by worker: ${data['jobId']}");
          _fetchActiveGigs();
        }
      });

      final handleUserCancel = (data) {
        if (data != null) {
          final String? cancelledJobId = (data['jobId'] ?? data['job_id'])?.toString();
          debugPrint("🔔 [SOCKET] Job cancelled by user: $cancelledJobId");
          
          // Check if this was an active gig for this worker before we clear it
          final isOurActiveGig = _activeGigs.any((j) => j['id']?.toString() == cancelledJobId);
          
          _fetchActiveGigs();
          _fetchJobsAndOffers(); // Also clear from the feed
          
          // Show popup alert if:
          // 1. We are mounted
          // 2. This was indeed our active gig (not just a random offer feed item)
          // 3. We are NOT currently in the JobExecutionScreen for this job (since that screen shows its own popup dialog)
          if (mounted && isOurActiveGig && JobExecutionScreen.activeJobId != cancelledJobId) {
            showDialog(
              context: context,
              barrierDismissible: false,
              builder: (context) => AlertDialog(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                title: Text("Gig Cancelled by Customer", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.red)),
                content: Text(
                  data['message'] ?? "The customer has cancelled the job before journey started.", 
                  style: GoogleFonts.inter()
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: Text("OK", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00))),
                  ),
                ],
              ),
            );
          }
        }
      };
      _socketService.socket?.on('job_cancelled_by_user', handleUserCancel);
      _socketService.socket?.on('USER_CANCELLED_JOB', handleUserCancel);

      _socketService.socket?.on('SELFIE_VERIFICATION_REQUIRED', (data) async {
        if (mounted && data != null) {
          final verificationId = data['verificationId']?.toString() ?? '1';
          final reason = data['reason']?.toString() ?? 'SECURITY_CHECK';
          
          final verified = await Navigator.push<bool>(
            context,
            MaterialPageRoute(
              builder: (context) => SelfieVerificationScreen(
                verificationId: verificationId,
                reason: reason,
              ),
              fullscreenDialog: true,
            ),
          );

          if (verified == true) {
            _fetchActiveGigs();
            _fetchPendingOffers();
          }
        }
      });
      
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) setState(() => _isSearching = false);
      });
    } else {
      _socketService.disconnect();
      BackgroundTracker.stopTracking();
      _stopRefreshTimer();
      setState(() => _jobRequests.clear());
    }
  }

  void _onNewJobSocket(dynamic job) {
    if (!mounted) return;
    
    dynamic jobMap;
    if (job is List) {
      if (job.isEmpty) return;
      jobMap = job.first;
    } else {
      jobMap = job;
    }
    
    if (jobMap == null) return;
    String currentJobId = jobMap['id']?.toString() ?? jobMap['_id']?.toString() ?? "";
    
    // Skip if already rejected or already active
    if (_rejectedJobIds.contains(currentJobId)) return;
    
    bool isAlreadyActive = _activeGigs.any((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
    bool isDuplicate = _jobRequests.any((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
    
    if (!isAlreadyActive) {
      if (!isDuplicate) {
        final taggedJob = {
          if (jobMap is Map) ...jobMap,
          'isNearbyJob': true,
        };
        setState(() {
          _jobRequests.insert(0, taggedJob);
        });
      }
      _showJobNotification(jobMap);
    }
  }

  void _showJobNotification(dynamic job) async {
    String currentJobId = job['id']?.toString() ?? job['_id']?.toString() ?? "";
    
    // GUARD 1: Don't show if already showing an incoming job banner
    if (_isShowingIncomingJob) return;
    // GUARD 2: Don't show if this job was rejected
    if (_rejectedJobIds.contains(currentJobId)) return;
    
    _isShowingIncomingJob = true;

    // Bring app to foreground using MethodChannel
    const platform = MethodChannel('com.nexo.partner/foreground');
    try {
      await platform.invokeMethod('bringToForeground');
    } catch (e) {
      debugPrint("Could not bring app to foreground: $e");
    }

    if (!mounted) {
      _isShowingIncomingJob = false;
      return;
    }
    
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => IncomingJobScreen(jobData: job),
        fullscreenDialog: true,
      ),
    );

    _isShowingIncomingJob = false;

    if (result != null && result['accepted'] == true) {
      _acceptJob(job);
    } else if (result != null && result['accepted'] == false) {
      if (currentJobId.isNotEmpty) {
        setState(() {
          _rejectedJobIds.add(currentJobId);
          _jobRequests.removeWhere((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
        });
        _persistRejectedJobIds();
        _rejectJob(currentJobId);
      }
    }
  }

  Widget _buildModernJobDialog(dynamic job) {
    int timeLeft = 30;
    Timer? timer;

    return StatefulBuilder(
      builder: (context, setDialogState) {
        timer ??= Timer.periodic(const Duration(seconds: 1), (t) {
          if (timeLeft > 0) {
            setDialogState(() => timeLeft--);
          } else {
            t.cancel();
            Navigator.pop(context);
          }
        });

        return WillPopScope(
          onWillPop: () async => false,
          child: Scaffold(
            backgroundColor: Colors.black.withOpacity(0.85),
            body: Center(
              child: Container(
                margin: const EdgeInsets.all(32),
                padding: const EdgeInsets.all(32),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(32),
                  boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.3), blurRadius: 40)],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Stack(
                      alignment: Alignment.center,
                      children: [
                        SizedBox(
                          width: 80,
                          height: 80,
                          child: CircularProgressIndicator(
                            value: timeLeft / 30,
                            strokeWidth: 6,
                            color: const Color(0xFFFF6A00),
                            backgroundColor: Colors.black12,
                          ),
                        ),
                        Text("$timeLeft", style: GoogleFonts.outfit(fontSize: 28, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00))),
                      ],
                    ),
                    const SizedBox(height: 24),
                    Text("New Opportunity!", style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Text(job['title'] ?? job['category'] ?? "Quick Task", style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.w600, color: Colors.black87)),
                    const SizedBox(height: 16),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: Colors.grey.shade200),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.info_outline, size: 16, color: Colors.black54),
                              const SizedBox(width: 8),
                              Text("Description", style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.black54)),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(job['description'] ?? "No additional details provided.", style: GoogleFonts.inter(fontSize: 14, color: Colors.black87, height: 1.4)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text("Estimated Earnings", style: GoogleFonts.inter(fontSize: 12, color: Colors.black54)),
                            Row(
                              children: [
                                Text("₹", style: GoogleFonts.outfit(fontSize: 24, color: Colors.green, fontWeight: FontWeight.bold)),
                                Text("${job['earnings'] ?? job['price'] ?? '0'}", style: GoogleFonts.outfit(fontSize: 40, fontWeight: FontWeight.bold, color: Colors.black87)),
                              ],
                            ),
                          ],
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF7ED),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.location_on, color: Color(0xFFFF6A00), size: 16),
                              const SizedBox(width: 4),
                              Text(job['distance']?.toString() ?? "Nearby", style: GoogleFonts.inter(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 32),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () async {
                              timer?.cancel();
                              Navigator.pop(context);
                              await _rejectJob(job['id']);
                            },
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              side: const BorderSide(color: Colors.red),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            ),
                            child: const Text("DECLINE", style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: () {
                              timer?.cancel();
                              Navigator.pop(context);
                              _acceptJob(job);
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.green,
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            ),
                            child: const Text("ACCEPT", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _rejectJob(String jobId) async {
    if (_phoneNumber == "Worker") {
      await _loadUserData(); // Try last minute re-fetch
      if (_phoneNumber == "Worker") {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Error: Identity not resolved. Please restart app.")));
        return;
      }
    }
    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/reject'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'jobId': jobId,
          'workerId': _phoneNumber,
        }),
      );
      setState(() {
        _jobRequests.removeWhere((j) => (j['id']?.toString() ?? j['_id']?.toString()) == jobId.toString());
      });
    } catch (e) {
      debugPrint("Reject error: $e");
    }
  }

  void _acceptJob(dynamic job) async {
    if (_phoneNumber == "Worker") {
      await _loadUserData(); // Try last minute re-fetch
      if (_phoneNumber == "Worker") {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Error: Identity not resolved. Please restart app.")));
        return;
      }
    }
    
    // Show blocking loader
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00))),
    );

    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/accept'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'jobId': job['id'],
          'workerId': _phoneNumber,
        }),
      );
      
      // Close loader
      if (mounted) Navigator.pop(context);

      final data = json.decode(response.body);

      if (response.statusCode == 200 && data['success']) {
        setState(() {
          _jobRequests.removeWhere((j) => (j['id']?.toString() ?? j['_id']?.toString()) == (job['id']?.toString() ?? job['_id']?.toString()));
          _activeGigs.add(data['job'] ?? job);
        });
        Navigator.push(context, MaterialPageRoute(builder: (context) => JobExecutionScreen(jobId: job['id'], initialJob: data['job'] ?? job)));
      } else {
        // Handle specific error reasons
        String errorMsg = data['message'] ?? "Could not accept job";
        if (errorMsg == "WORKER_ALREADY_BUSY") errorMsg = "You already have an active job!";
        if (errorMsg == "JOB_ALREADY_TAKEN") {
          errorMsg = "Sorry, this job was just taken by another worker.";
          final targetId = (job['id'] ?? job['_id'])?.toString();
          if (targetId != null) {
            setState(() {
              _jobRequests.removeWhere((j) => (j['id']?.toString() ?? j['_id']?.toString()) == targetId);
            });
          }
        }
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(errorMsg), backgroundColor: Colors.redAccent),
        );
        
        // Refresh to get latest state
        _fetchJobsAndOffers();
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      debugPrint("Accept error: $e");
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Connection error. Please try again."), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _submitCounterOffer(String jobId, double price) async {
    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/negotiate'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'jobId': jobId,
          'workerId': _phoneNumber,
          'price': price,
        }),
      );
      
      if (response.statusCode == 200) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Counter offer sent successfully!")),
          );
          setState(() {
            _jobRequests.removeWhere((j) => j['id'] == jobId);
          });
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Failed to send counter offer.")),
          );
        }
      }
    } catch (e) {
      debugPrint("Negotiate error: $e");
    }
  }

  void _startLocationUpdates() {
    _positionStream = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(distanceFilter: 10, accuracy: LocationAccuracy.high)
    ).listen((Position position) async {
      if (_isOnline) {
        // 1. Real-time Socket Sync (Primary)
        _socketService.updateLocation(position.latitude, position.longitude);

        // 2. Refresh Nearby Feed (Immediate Discovery)
        _fetchNearbyJobs(position: position);

        // 3. Production HTTP Sync (Redundant)
        try {
          await http.post(
            Uri.parse('${NetworkHelper.baseUrl}/api/workers/location'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'workerId': _phoneNumber,
              'lat': position.latitude,
              'lng': position.longitude,
            }),
          );
        } catch (e) {
          debugPrint("📍 [LOCATION ERROR] HTTP Sync failed: $e");
        }
      }
      
      // 2. Update the UI location tagger (Always, even if offline)
      // Throttled reverse-geocoding to avoid blocking/throttling limits
      final now = DateTime.now();
      if (_lastGeocodeTime == null || now.difference(_lastGeocodeTime!).inMinutes >= 1) {
        _lastGeocodeTime = now;
        try {
          List<Placemark> placemarks = await placemarkFromCoordinates(position.latitude, position.longitude);
          if (placemarks.isNotEmpty && mounted) {
            Placemark place = placemarks[0];
            setState(() {
              _currentArea = "${place.subLocality ?? place.locality}, ${place.administrativeArea}";
            });
          }
        } catch (e) {
          debugPrint("Geocoding error: $e");
        }
      }
    });
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    if (mounted) {
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (context) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (HomeScreen.pendingTabIndex != null) {
      _selectedIndex = HomeScreen.pendingTabIndex!;
      HomeScreen.pendingTabIndex = null;
    }
    final List<Widget> screens = [
      _buildDashboard(),
      const ActiveJobsScreen(),
      EarningsHistoryScreen(),
      const SupportScreen(),
      const WorkerProfileScreen(isTab: true),
    ];

    return WillPopScope(
      onWillPop: () async {
        if (_selectedIndex != 0) {
          setState(() {
            _selectedIndex = 0;
          });
          return false;
        }
        return true;
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        body: IndexedStack(
          index: _selectedIndex,
          children: screens,
        ),
        bottomNavigationBar: _buildBottomNav(),
      ),
    );
  }

  Widget _buildBottomNav() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Container(
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF0F172A) : Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 20,
            offset: const Offset(0, -4),
          )
        ],
      ),
      padding: const EdgeInsets.only(bottom: 12, top: 8),
      child: SafeArea(
        top: false,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _buildNewNavItem(0, Icons.home_rounded, "Home"),
            _buildNewNavItem(1, Icons.work_rounded, "My Gigs"),
            // Center circular button
            GestureDetector(
              onTap: () {
                if (_isOnline) {
                  _showOfflineConfirmation();
                } else {
                  _toggleOnline(true);
                }
              },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: _isOnline ? Colors.redAccent : const Color(0xFF2563EB),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: (_isOnline ? Colors.redAccent : const Color(0xFF2563EB)).withOpacity(0.3),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        )
                      ],
                    ),
                    child: Icon(
                      _isOnline ? Icons.power_settings_new_rounded : Icons.flash_on_rounded,
                      color: Colors.white,
                      size: 26,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _isOnline ? "Go Offline" : "Go Online",
                    style: GoogleFonts.inter(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                ],
              ),
            ),
            _buildNewNavItem(2, Icons.wallet_rounded, "Earnings"),
            _buildNewNavItem(4, Icons.person_rounded, "Profile"),
          ],
        ),
      ),
    );
  }

  Widget _buildNewNavItem(int index, IconData icon, String label) {
    bool isSelected = _selectedIndex == index;
    final activeColor = const Color(0xFF2563EB);
    final inactiveColor = const Color(0xFF94A3B8);
    
    return GestureDetector(
      onTap: () => setState(() => _selectedIndex = index),
      child: Container(
        color: Colors.transparent,
        width: 65,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              color: isSelected ? activeColor : inactiveColor,
              size: 24,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 10,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                color: isSelected ? activeColor : inactiveColor,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDashboard() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryColor = const Color(0xFF2563EB);

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leadingWidth: 54,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16.0, top: 8.0, bottom: 8.0),
          child: GestureDetector(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (context) => const WorkerProfileScreen())),
            child: Stack(
              children: [
                Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.black12, width: 1.5),
                  ),
                  child: ClipOval(
                    child: ImageUtils.buildProfileImage(
                      _profilePhoto != null ? '${NetworkHelper.baseUrl}$_profilePhoto' : null,
                      radius: 18,
                    ),
                  ),
                ),
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: _isOnline ? const Color(0xFF10B981) : const Color(0xFF94A3B8),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              "Worker Portal",
              style: GoogleFonts.outfit(
                fontWeight: FontWeight.w900, 
                color: isDark ? Colors.white : const Color(0xFF0F172A),
                fontSize: 20,
              ),
            ),
            Text(
              _isOnline ? "You're online and available" : "You're offline",
              style: GoogleFonts.inter(
                fontSize: 12,
                color: isDark ? Colors.white60 : const Color(0xFF64748B),
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: Stack(
              children: [
                Icon(Icons.notifications_outlined, color: isDark ? Colors.white : const Color(0xFF0F172A)),
                Positioned(
                  right: 2,
                  top: 2,
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: Colors.redAccent,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ],
            ),
            onPressed: () {
              Navigator.push(context, MaterialPageRoute(builder: (context) => const NotificationsScreen()));
            },
          ),
          IconButton(
            icon: Icon(Icons.headset_mic_outlined, color: isDark ? Colors.white : const Color(0xFF0F172A)),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (context) => const SupportScreen())),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. Online / Offline Card
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 16,
                      offset: const Offset(0, 4),
                    )
                  ],
                  border: Border.all(
                    color: const Color(0xFFF1F5F9),
                    width: 1,
                  ),
                ),
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: _isOnline ? const Color(0xFF10B981) : const Color(0xFF94A3B8),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _isOnline ? "You are Online" : "You are Offline",
                                style: GoogleFonts.outfit(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 16,
                                  color: const Color(0xFF0F172A),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _isOnline 
                                    ? "Awaiting matches and client dispatch..." 
                                    : "Go online to start receiving nearby jobs",
                                style: GoogleFonts.inter(
                                  color: const Color(0xFF64748B),
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Switch(
                          value: _isOnline,
                          activeColor: const Color(0xFF2563EB),
                          activeTrackColor: const Color(0xFFDBEAFE),
                          inactiveThumbColor: const Color(0xFF64748B),
                          inactiveTrackColor: const Color(0xFFE2E8F0),
                          onChanged: _toggleOnline,
                        ),
                      ],
                    ),
                    if (_isOnline) ...[
                      const SizedBox(height: 16),
                      Container(
                        height: 1,
                        color: const Color(0xFFF1F5F9),
                      ),
                      const SizedBox(height: 16),
                      GestureDetector(
                        onTap: () {
                          setState(() => _isPaused = !_isPaused);
                        },
                        child: Row(
                          children: [
                            Icon(
                              _isPaused ? Icons.play_circle_filled_rounded : Icons.pause_circle_filled_rounded,
                              color: const Color(0xFF2563EB),
                              size: 24,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                _isPaused ? "Resume Requests Dispatch" : "Temporarily Pause Requests",
                                style: GoogleFonts.inter(
                                  color: const Color(0xFF2563EB),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                            ),
                            const Icon(
                              Icons.chevron_right_rounded,
                              color: Color(0xFF64748B),
                              size: 20,
                            ),
                          ],
                        ),
                      ),
                    ]
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // 2. Active Zone Card
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.02),
                      blurRadius: 12,
                      offset: const Offset(0, 2),
                    )
                  ],
                  border: Border.all(
                    color: const Color(0xFFF1F5F9),
                    width: 1,
                  ),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: const BoxDecoration(
                        color: Color(0xFFEFF6FF),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.location_on,
                        color: Color(0xFF2563EB),
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            "CURRENT ACTIVE ZONE",
                            style: GoogleFonts.inter(
                              fontSize: 10,
                              color: const Color(0xFF94A3B8),
                              fontWeight: FontWeight.bold,
                              letterSpacing: 0.5,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  _currentArea,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: GoogleFonts.outfit(
                                    fontSize: 15,
                                    fontWeight: FontWeight.bold,
                                    color: const Color(0xFF0F172A),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              GestureDetector(
                                onTap: _refreshLocation,
                                child: const Icon(
                                  Icons.refresh_rounded,
                                  size: 18,
                                  color: Color(0xFF2563EB),
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
              const SizedBox(height: 16),

              // 3. Earnings Card
              Builder(
                builder: (context) {
                  double earnings = 0.0;
                  int gigs = 0;
                  String timeframeLabel = "Today's";

                  if (_earningsSummary != null) {
                    final timeframeData = _earningsSummary![_selectedTimeframe];
                    if (timeframeData != null) {
                      earnings = (timeframeData['earnings'] as num).toDouble();
                      gigs = (timeframeData['gigs'] as num).toInt();
                    }
                  }

                  if (_selectedTimeframe == 'today') timeframeLabel = "Today's";
                  else if (_selectedTimeframe == 'week') timeframeLabel = "This Week's";
                  else if (_selectedTimeframe == 'month') timeframeLabel = "This Month's";
                  else if (_selectedTimeframe == 'year') timeframeLabel = "This Year's";
                  else if (_selectedTimeframe == 'random') {
                    timeframeLabel = _selectedCustomDateStr != null ? "$_selectedCustomDateStr" : "Custom Day's";
                  }

                  final timeframes = [
                    {'key': 'today', 'label': 'Today'},
                    {'key': 'week', 'label': 'Week'},
                    {'key': 'month', 'label': 'Month'},
                    {'key': 'year', 'label': 'Year'},
                    {'key': 'random', 'label': 'Custom'},
                  ];

                  return Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF2563EB),
                          Color(0xFF1D4ED8),
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(28),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF2563EB).withOpacity(0.2),
                          blurRadius: 16,
                          offset: const Offset(0, 8),
                        ),
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
                                Text(
                                  "$timeframeLabel Earnings", 
                                  style: GoogleFonts.inter(
                                    color: Colors.white70,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                GestureDetector(
                                  onTap: () => setState(() => _hideEarnings = !_hideEarnings),
                                  child: Icon(
                                    _hideEarnings ? Icons.visibility_off : Icons.visibility,
                                    color: Colors.white70,
                                    size: 16,
                                  ),
                                ),
                              ],
                            ),
                            GestureDetector(
                              onTap: () => setState(() => _selectedIndex = 2),
                              child: Container(
                                padding: const EdgeInsets.all(6),
                                decoration: BoxDecoration(
                                  color: Colors.white.withOpacity(0.2),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.arrow_forward, color: Colors.white, size: 14),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _hideEarnings ? "₹ ••••" : "₹${earnings.toStringAsFixed(2)}", 
                          style: GoogleFonts.outfit(
                            fontSize: 36, 
                            fontWeight: FontWeight.w900, 
                            color: Colors.white,
                            letterSpacing: -0.5,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.check_circle, color: Color(0xFF4ADE80), size: 14),
                              const SizedBox(width: 6),
                              Text(
                                "$gigs Gigs Completed",
                                style: GoogleFonts.inter(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 20),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: timeframes.map((tf) {
                              final isSelected = _selectedTimeframe == tf['key'];
                              return GestureDetector(
                                onTap: () async {
                                  if (tf['key'] == 'random') {
                                    final selectedDate = await showDatePicker(
                                      context: context,
                                      initialDate: DateTime.now(),
                                      firstDate: DateTime(2020),
                                      lastDate: DateTime.now(),
                                    );
                                    if (selectedDate != null) {
                                      final formattedDate = "${selectedDate.year}-${selectedDate.month.toString().padLeft(2, '0')}-${selectedDate.day.toString().padLeft(2, '0')}";
                                      setState(() {
                                        _selectedTimeframe = 'random';
                                        _selectedCustomDateStr = formattedDate;
                                      });
                                      _fetchEarningsSummary(date: formattedDate);
                                    }
                                  } else {
                                    setState(() {
                                      _selectedTimeframe = tf['key']!;
                                    });
                                  }
                                },
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 200),
                                  margin: const EdgeInsets.only(right: 8),
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: isSelected ? Colors.white : Colors.white.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    tf['label']!,
                                    style: GoogleFonts.inter(
                                      color: isSelected ? const Color(0xFF2563EB) : Colors.white,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                      ],
                    ),
                  );
                }
              ),
              const SizedBox(height: 24),

              // 4. Quick Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "Quick Actions",
                    style: GoogleFonts.outfit(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => setState(() => _selectedIndex = 4),
                    child: Text(
                      "View All",
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF2563EB),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      _buildQuickActionItem(Icons.work_rounded, const Color(0xFF10B981), "My Gigs", () {
                        setState(() => _selectedIndex = 1);
                      }),
                      _buildQuickActionItem(Icons.access_time_filled_rounded, const Color(0xFFF97316), "Schedule", () {
                        _showScheduleDialog();
                      }),
                      _buildQuickActionItem(Icons.account_balance_wallet_rounded, const Color(0xFF8B5CF6), "Earnings", () {
                        setState(() => _selectedIndex = 2);
                      }),
                      _buildQuickActionItem(Icons.trending_up_rounded, const Color(0xFF2563EB), "Performance", () {
                        _showPerformanceDialog();
                      }),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      _buildQuickActionItem(Icons.description_rounded, const Color(0xFFEF4444), "Documents", () {
                        _showDocumentsDialog();
                      }),
                      _buildQuickActionItem(Icons.verified_user_rounded, const Color(0xFF0D9488), "Verifications", () {
                        _showVerificationsDialog();
                      }),
                      _buildQuickActionItem(Icons.star_rounded, const Color(0xFFF59E0B), "Reviews", () {
                        _showReviewsDialog();
                      }),
                      _buildQuickActionItem(Icons.card_giftcard_rounded, const Color(0xFF3B82F6), "Refer & Earn", () {
                        _showReferralDialog();
                      }),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 28),

              // 5. New Job Opportunities
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "New Job Opportunities",
                    style: GoogleFonts.outfit(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  GestureDetector(
                    onTap: _fetchPendingOffers,
                    child: Text(
                      "View All",
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF2563EB),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (_isOffline)
                _buildOfflineBanner()
              else if (_isSearching)
                ...List.generate(2, (_) => SkeletonLoader.card())
              else if (_jobRequests.isEmpty)
                _buildEmptyJobs()
              else
                Column(
                  children: _jobRequests.map((job) => _buildJobCard(job)).toList(),
                ),
              const SizedBox(height: 24),

              // 6. Upcoming Schedule
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "Upcoming Schedule",
                    style: GoogleFonts.outfit(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => setState(() => _selectedIndex = 1),
                    child: Text(
                      "View All",
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF2563EB),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _buildUpcomingSchedule(),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQuickActionItem(IconData icon, Color color, String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: 75,
        child: Column(
          children: [
            Container(
              width: 50,
              height: 50,
              decoration: BoxDecoration(
                color: color.withOpacity(0.08),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(icon, color: color, size: 24),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF334155),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildJobCard(dynamic job) {
    if (job == null) return const SizedBox.shrink();
    final status = job['status'] ?? 'OPEN';
    final bool canAccept = status == 'OPEN' || status == 'REDISTRIBUTING' || status == 'REASSIGNING';
    final String category = job['category'] ?? 'Task';
    
    return GestureDetector(
      onTap: canAccept ? () async {
        final currentJobId = job['id']?.toString() ?? job['_id']?.toString() ?? '';
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => NewJobOfferScreen(
              job: job,
              onAccept: () => _acceptJob(job),
              onDecline: () {
                if (currentJobId.isNotEmpty) {
                  setState(() {
                    _rejectedJobIds.add(currentJobId);
                    _jobRequests.removeWhere((j) => (j['id']?.toString() ?? j['_id']?.toString()) == currentJobId);
                  });
                  _persistRejectedJobIds();
                  _rejectJob(currentJobId);
                }
              },
              onCounterOffer: (price) {
                // Implement counter offer logic if needed
              },
            ),
            fullscreenDialog: true,
          ),
        );
      } : null,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.02),
              blurRadius: 10,
              offset: const Offset(0, 2),
            )
          ],
          border: Border.all(
            color: const Color(0xFFF1F5F9),
            width: 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(16),
              ),
              child: ImageUtils.buildServiceImage(
                null,
                taskName: job['category'],
                width: 28,
                height: 28,
                fit: BoxFit.cover,
                fallback: const Icon(Icons.handyman, color: Color(0xFF2563EB), size: 24),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    job['title'] ?? category,
                    style: GoogleFonts.outfit(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    job['description'] ?? "Residential Service",
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.inter(
                      color: const Color(0xFF64748B),
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          job['distance']?.toString() ?? "Nearby",
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          job['duration']?.toString() ?? "ASAP",
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  "₹${job['earnings'] ?? job['price'] ?? '0'}",
                  style: GoogleFonts.outfit(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    color: const Color(0xFF0F172A),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  "Per Gig",
                  style: GoogleFonts.inter(
                    color: const Color(0xFF94A3B8),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_right_rounded,
              color: Color(0xFF94A3B8),
              size: 20,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveJobCard(dynamic job) {
    if (job == null) return const SizedBox.shrink();
    return GestureDetector(
      onTap: () => Navigator.push(
        context, 
        MaterialPageRoute(builder: (context) => JobExecutionScreen(jobId: job['id'], initialJob: job))
      ).then((_) => _fetchActiveGigs()),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [Color(0xFF10B981), Color(0xFF059669)]),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [BoxShadow(color: Colors.green.withOpacity(0.15), blurRadius: 12, offset: const Offset(0, 4))],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), shape: BoxShape.circle),
              child: const Icon(Icons.work_history, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(job['title'] ?? job['category'] ?? "Ongoing Gig", style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                  Text("Tap to resume work", style: GoogleFonts.inter(color: Colors.white70, fontSize: 11)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Colors.white70),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyJobs() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: const BoxDecoration(
              color: Color(0xFFEFF6FF),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.search, color: Color(0xFF2563EB), size: 24),
          ),
          const SizedBox(height: 16),
          Text(
            "No new opportunities right now",
            style: GoogleFonts.outfit(
              fontWeight: FontWeight.bold,
              fontSize: 15,
              color: const Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            "We'll notify you when new gigs are available.",
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(
              color: const Color(0xFF94A3B8),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOfflineBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFFEE2E2)),
      ),
      child: Column(
        children: [
          const Icon(Icons.wifi_off_rounded, color: Color(0xFFEF4444), size: 28),
          const SizedBox(height: 12),
          Text(
            "You are currently offline",
            style: GoogleFonts.outfit(
              fontWeight: FontWeight.bold,
              fontSize: 15,
              color: const Color(0xFF991B1B),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            "Go online to start receiving new job opportunities.",
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(
              color: const Color(0xFFEF4444),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUpcomingSchedule() {
    if (_activeGigs.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: const Color(0xFFF1F5F9), width: 1),
        ),
        child: Column(
          children: [
            const Icon(Icons.calendar_today_rounded, color: Color(0xFF94A3B8), size: 28),
            const SizedBox(height: 12),
            Text(
              "No upcoming gigs scheduled",
              style: GoogleFonts.outfit(
                fontWeight: FontWeight.bold,
                fontSize: 15,
                color: const Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              "Any accepted gigs will show up here.",
              style: GoogleFonts.inter(
                fontSize: 12,
                color: const Color(0xFF94A3B8),
              ),
            ),
          ],
        ),
      );
    }
    
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.calendar_today_rounded, color: Color(0xFF2563EB), size: 18),
              const SizedBox(width: 8),
              Text(
                "Today's Schedule",
                style: GoogleFonts.outfit(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: const Color(0xFF0F172A),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Column(
            children: _activeGigs.map((job) {
              final status = job['status'] ?? 'ACCEPTED';
              final isConfirmed = status == 'ACCEPTED' || status == 'ARRIVED' || status == 'IN_PROGRESS';
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 12.0),
                      child: Text(
                        "ASAP",
                        style: GoogleFonts.outfit(
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                          color: const Color(0xFF64748B),
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    job['title'] ?? job['category'] ?? "Gig Repair",
                                    style: GoogleFonts.outfit(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14,
                                      color: const Color(0xFF0F172A),
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    job['userAddress'] ?? "Client Location",
                                    style: GoogleFonts.inter(
                                      fontSize: 11,
                                      color: const Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: isConfirmed ? const Color(0xFFDCFCE7) : const Color(0xFFDBEAFE),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                isConfirmed ? "Confirmed" : "Upcoming",
                                style: GoogleFonts.inter(
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                  color: isConfirmed ? const Color(0xFF16A34A) : const Color(0xFF2563EB),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  void _showPerformanceDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.trending_up_rounded, color: Color(0xFF2563EB)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                "Performance Overview",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildPerformanceRow("Completion Rate", "100%", Colors.green),
            const Divider(height: 20),
            _buildPerformanceRow("Average Rating", "4.8 ★", Colors.orange),
            const Divider(height: 20),
            _buildPerformanceRow("Total Completed", "${_earningsSummary?['today']?['gigs'] ?? 0} Gigs", const Color(0xFF2563EB)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("Close", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF2563EB))),
          )
        ],
      ),
    );
  }

  Widget _buildPerformanceRow(String title, String value, Color color) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: const Color(0xFF64748B))),
        Text(value, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: color, fontSize: 16)),
      ],
    );
  }

  void _showDocumentsDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.description_rounded, color: Color(0xFFEF4444)),
            const SizedBox(width: 10),
            Expanded(
              child: Text("My Documents", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildDocStatusRow("Aadhaar Card", "Verified", Colors.green),
            const Divider(height: 16),
            _buildDocStatusRow("Driving License", "Verified", Colors.green),
            const Divider(height: 16),
            _buildDocStatusRow("PAN Card", "Verified", Colors.green),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("Close", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF2563EB))),
          )
        ],
      ),
    );
  }

  Widget _buildDocStatusRow(String name, String status, Color color) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(name, style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: const Color(0xFF64748B))),
        Text(status, style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: color)),
      ],
    );
  }

  void _showVerificationsDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.verified_user_rounded, color: Color(0xFF0D9488)),
            const SizedBox(width: 10),
            Expanded(
              child: Text("Verification Status", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildVerificationCheckRow("Identity Vetting", "Cleared", Colors.green),
            const Divider(height: 12),
            _buildVerificationCheckRow("Background Check", "Cleared", Colors.green),
            const Divider(height: 12),
            _buildVerificationCheckRow("Police Clearance Check", "Cleared", Colors.green),
            const Divider(height: 12),
            _buildVerificationCheckRow("Skills Assessment", "Verified", Colors.green),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("OK", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF2563EB))),
          )
        ],
      ),
    );
  }

  Widget _buildVerificationCheckRow(String checkName, String status, Color color) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(checkName, style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: const Color(0xFF64748B))),
        Row(
          children: [
            Icon(Icons.check_circle_rounded, size: 14, color: color),
            const SizedBox(width: 4),
            Text(status, style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: color, fontSize: 13)),
          ],
        ),
      ],
    );
  }

  void _showReferralDialog() {
    final String referralCode = "NEXOPARTNER${_phoneNumber.substring(Math.max(0, _phoneNumber.length - 4))}";
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.card_giftcard_rounded, color: Color(0xFF3B82F6)),
            const SizedBox(width: 10),
            Expanded(
              child: Text("Refer & Earn", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              "Share your referral code and earn ₹200 on every partner onboarding!",
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: const Color(0xFF64748B), height: 1.4),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                referralCode,
                style: GoogleFonts.outfit(
                  fontWeight: FontWeight.w900,
                  fontSize: 16,
                  color: const Color(0xFF2563EB),
                  letterSpacing: 1.0,
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: referralCode));
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text("Referral code copied to clipboard!"),
                  backgroundColor: Color(0xFF2563EB),
                ),
              );
            },
            child: Text("Copy Code", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF2563EB))),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("Close", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF64748B))),
          )
        ],
      ),
    );
  }

  void _showScheduleDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.calendar_today_rounded, color: Color(0xFFF97316)),
            const SizedBox(width: 10),
            Expanded(
              child: Text("My Schedule", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        content: SizedBox(
          width: double.maxFinite,
          child: _activeGigs.isEmpty
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.event_busy_rounded, size: 48, color: Colors.grey),
                    const SizedBox(height: 12),
                    Text(
                      "No gigs scheduled for today",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF475569)),
                    ),
                  ],
                )
              : ListView.builder(
                  shrinkWrap: true,
                  itemCount: _activeGigs.length,
                  itemBuilder: (context, index) {
                    final gig = _activeGigs[index];
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  gig['title'] ?? gig['category'] ?? "Handyman Job",
                                  style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF0F172A)),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  gig['userName'] ?? "Client",
                                  style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF64748B)),
                                ),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFFDCFCE7),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              "ASAP",
                              style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: const Color(0xFF16A34A)),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("OK", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF2563EB))),
          )
        ],
      ),
    );
  }

  void _showReviewsDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.star_rounded, color: Color(0xFFF59E0B)),
            const SizedBox(width: 10),
            Expanded(
              child: Text("Customer Reviews", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.star_rounded, size: 28, color: Color(0xFFF59E0B)),
                  const SizedBox(width: 6),
                  Text(
                    "4.8",
                    style: GoogleFonts.outfit(fontSize: 28, fontWeight: FontWeight.w900, color: const Color(0xFF0F172A)),
                  ),
                  Text(
                    " / 5.0",
                    style: GoogleFonts.inter(fontSize: 14, color: const Color(0xFF64748B)),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    _buildReviewItem("John Doe", "Excellent service, very professional! Highly recommended.", 5),
                    _buildReviewItem("Sarah Smith", "Arrived on time and resolved the plumbing leak quickly.", 5),
                    _buildReviewItem("Amit Kumar", "Polite and did a fantastic job.", 4),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("Close", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF2563EB))),
          )
        ],
      ),
    );
  }

  Widget _buildReviewItem(String name, String comment, int stars) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(name, style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF0F172A))),
              Row(
                children: List.generate(
                  5,
                  (index) => Icon(
                    Icons.star_rounded,
                    size: 14,
                    color: index < stars ? const Color(0xFFF59E0B) : const Color(0xFFCBD5E1),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(comment, style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF475569), height: 1.3)),
        ],
      ),
    );
  }
}

class Math {
  static int max(int a, int b) => a > b ? a : b;
}
