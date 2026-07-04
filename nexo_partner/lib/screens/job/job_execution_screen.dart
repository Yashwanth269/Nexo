import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:url_launcher/url_launcher.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';
import '../../utils/image_utils.dart';
import '../chat/chat_detail_screen.dart';
import 'dart:async';
import 'job_completion_screen.dart';
import 'dart:io';
import '../../services/socket_service.dart';
import '../../services/cache_service.dart';
import '../../services/background_service.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:nexo_partner/components/glass_components.dart';
import '../../services/maps_service.dart';

class JobExecutionScreen extends StatefulWidget {
  final String jobId;
  final dynamic initialJob;
  const JobExecutionScreen({super.key, required this.jobId, this.initialJob});

  // Track the currently executing job ID to prevent duplicate user-cancelled popups on HomeScreen
  static String? activeJobId;

  @override
  State<JobExecutionScreen> createState() => _JobExecutionScreenState();
}

class _JobExecutionScreenState extends State<JobExecutionScreen> {
  final Completer<GoogleMapController> _mapController = Completer<GoogleMapController>();
  dynamic _job;
  bool _isLoading = true;
  String _currentStatus = 'ACCEPTED';
  String? _token;

  Future<Map<String, String>> _getAuthHeaders() async {
    if (_token == null) {
      final prefs = await SharedPreferences.getInstance();
      _token = prefs.getString('worker_token');
    }
    return {
      'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
  }
  DateTime? _workStartTime;
  Position? _currentPosition;
  StreamSubscription<Position>? _positionStream;
  DateTime? _lastRouteFetchTime;
  
  String _distance = "-- km";
  String _eta = "-- mins";
  
  final Set<Marker> _markers = {};
  Set<Polyline> _polylines = {};
  bool _isTransitioning = false;

  // Colors
  static const Color primaryColor = Color(0xFFF97316);
  static const Color textPrimary = Colors.white;
  static const Color textSecondary = Colors.white70;

  @override
  void initState() {
    super.initState();
    JobExecutionScreen.activeJobId = widget.jobId.toString();
    _job = widget.initialJob ?? {};
    _currentStatus = _job['status'] ?? 'ACCEPTED';
    _loadSavedWorkStartTime();
    _fetchJobDetails();
    _listenForCancellations();
    _listenForArrivalEvents();
    _getInitialLocation();
  }

  Future<void> _loadSavedWorkStartTime() async {
    final prefs = await SharedPreferences.getInstance();
    final savedStart = prefs.getString('work_start_time_${widget.jobId}');
    if (mounted) {
      setState(() {
        if (savedStart != null) {
          _workStartTime = DateTime.tryParse(savedStart);
        } else if (_currentStatus == 'WORK_IN_PROGRESS') {
          _workStartTime = DateTime.tryParse(_job['updated_at']?.toString() ?? '') ?? DateTime.now();
        }
      });
    }
  }

  Future<void> _getInitialLocation() async {
    try {
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null && mounted) {
        setState(() {
          _currentPosition = lastKnown;
        });
        _updateMarkers();
      }
      
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 5),
      );
      if (mounted) {
        setState(() {
          _currentPosition = position;
        });
        _updateMarkers();
      }
    } catch (e) {
      debugPrint("❌ [INITIAL_LOCATION] Error: $e");
    }
  }

  void _listenForCancellations() {
    final socketService = SocketService();
    final handleCancel = (data) {
      if (!mounted) return;
      final String? cancelledJobId = data != null ? (data['jobId'] ?? data['job_id'])?.toString() : null;
      if (cancelledJobId == widget.jobId.toString()) {
        debugPrint("🚫 [USER_CANCELLED_JOB] Customer cancelled the job request.");
        
        CacheService.setJsonList('active_gigs', []);
        
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (context) => AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: Text("Customer Cancelled", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.redAccent)),
            content: Text(
              data != null && data['message'] != null ? data['message'] : "Customer cancelled the job before journey started.",
              style: GoogleFonts.inter(color: Colors.white70),
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.pop(context);
                  Navigator.of(context).popUntil((route) => route.isFirst);
                },
                child: Text("OK", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: primaryColor)),
              ),
            ],
          ),
        );
      }
    };

    socketService.socket?.on('job_cancelled_by_user', handleCancel);
    socketService.socket?.on('USER_CANCELLED_JOB', handleCancel);
    socketService.socket?.on('USER_LATE_CANCELLED_JOB', handleCancel);
  }

  Future<void> _fetchJobDetails() async {
    try {
      debugPrint("📡 [FETCH_JOB_DETAILS] ID: ${widget.jobId}");
      final headers = await _getAuthHeaders();
      final response = await http.get(Uri.parse('${NetworkHelper.baseUrl}/api/jobs/${widget.jobId}'), headers: headers);
      
      debugPrint("📡 [FETCH_JOB_DETAILS] Response Code: ${response.statusCode}");
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['job'] != null) {
          setState(() {
            _job = data['job'];
            _currentStatus = _job['status'] ?? 'ACCEPTED';
            if (_currentStatus == 'WORK_IN_PROGRESS' && _workStartTime == null) {
              SharedPreferences.getInstance().then((prefs) {
                final savedStart = prefs.getString('work_start_time_${widget.jobId}');
                if (mounted) {
                  setState(() {
                    if (savedStart != null) {
                      _workStartTime = DateTime.tryParse(savedStart);
                    } else {
                      _workStartTime = DateTime.tryParse(_job['updated_at']?.toString() ?? '') ?? DateTime.now();
                    }
                  });
                }
              });
            }
          });
          
          _updateMarkers();
          _updateRouteDetailsFromJob();
          if (_currentStatus == 'ON_THE_WAY') {
            _startLiveTracking();
          }
        }
      } else {
        debugPrint("❌ [FETCH_JOB_DETAILS] Error: ${response.body}");
        _showError("Failed to load job details (${response.statusCode})");
      }
    } catch (e) {
      debugPrint("❌ [FETCH_JOB_DETAILS] Exception: $e");
      _showError("Connection error: $e");
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _updateRouteDetailsFromJob() {
    if (_job == null || !mounted) return;
    
    final distanceMeters = _job['route_distance'] ?? _job['distance_meters'] ?? _job['distanceMeters'];
    if (distanceMeters != null) {
      final double meters = (distanceMeters as num).toDouble();
      final double km = meters / 1000;
      _distance = km < 1 ? "${meters.round()} m" : "${km.toStringAsFixed(1)} km";
    } else if (_job['distance'] != null) {
      _distance = _job['distance'].toString();
    }
    
    final durationSeconds = _job['route_duration'] ?? _job['duration_seconds'] ?? _job['duration'];
    if (durationSeconds != null) {
      final int mins = (durationSeconds as num).round() ~/ 60;
      _eta = "$mins mins";
    } else if (_job['eta'] != null) {
      _eta = _job['eta'].toString();
    }
    
    final polylineStr = _job['route_polyline'] ?? _job['polyline'];
    if (polylineStr != null && polylineStr.toString().isNotEmpty) {
      final points = MapsService.decodePolyline(polylineStr.toString());
      setState(() {
        _polylines = {
          Polyline(
            polylineId: const PolylineId('route'),
            points: points,
            color: primaryColor,
            width: 5,
          ),
        };
      });
    } else {
      setState(() {
        _polylines = {};
      });
    }
  }

  Future<void> _updateDistanceAndEta(double destLat, double destLng) async {
    _updateRouteDetailsFromJob();
  }

  void _updateMarkers() {
    if (_job == null) return;
    
    final latVal = _job['location_lat'] ?? _job['locationLat'] ?? _job['lat'];
    final lngVal = _job['location_lng'] ?? _job['locationLng'] ?? _job['lng'];
    final latStr = latVal?.toString() ?? "0";
    final lngStr = lngVal?.toString() ?? "0";
    final destLat = double.tryParse(latStr) ?? 0;
    final destLng = double.tryParse(lngStr) ?? 0;

    if (_currentPosition != null && destLat != 0) {
      _updateDistanceAndEta(destLat, destLng);
    }

    setState(() {
      _markers.clear();
      
      if (destLat != 0 && destLng != 0) {
        _markers.add(
          Marker(
            markerId: const MarkerId('destination'),
            position: LatLng(destLat, destLng),
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
            infoWindow: const InfoWindow(title: "Service Location"),
          ),
        );
      }
      
      if (_currentPosition != null) {
        _markers.add(
          Marker(
            markerId: const MarkerId('worker'),
            position: LatLng(_currentPosition!.latitude, _currentPosition!.longitude),
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
            infoWindow: const InfoWindow(title: "Your Location"),
          ),
        );
      }
    });
    
    if (_markers.isNotEmpty) {
      _fitBounds();
    }
  }

  Future<void> _fitBounds() async {
    if (_markers.isEmpty) return;
    try {
      final controller = await _mapController.future;
      await Future.delayed(const Duration(milliseconds: 300));
      
      if (_markers.length == 1) {
        controller.animateCamera(CameraUpdate.newLatLngZoom(_markers.first.position, 15));
      } else {
        final positions = _markers.map((m) => m.position).toList();
        double minLat = positions.map((p) => p.latitude).reduce((a, b) => a < b ? a : b);
        double maxLat = positions.map((p) => p.latitude).reduce((a, b) => a > b ? a : b);
        double minLng = positions.map((p) => p.longitude).reduce((a, b) => a < b ? a : b);
        double maxLng = positions.map((p) => p.longitude).reduce((a, b) => a > b ? a : b);

        LatLngBounds bounds = LatLngBounds(
          southwest: LatLng(minLat - 0.005, minLng - 0.005),
          northeast: LatLng(maxLat + 0.005, maxLng + 0.005),
        );
        controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 80));
      }
    } catch (e) {
      debugPrint("FitBounds error: $e");
      // Retry once after 1 second if layout size was zero
      await Future.delayed(const Duration(seconds: 1));
      try {
        final controller = await _mapController.future;
        if (_markers.length == 1) {
          controller.animateCamera(CameraUpdate.newLatLngZoom(_markers.first.position, 15));
        } else {
          final positions = _markers.map((m) => m.position).toList();
          double minLat = positions.map((p) => p.latitude).reduce((a, b) => a < b ? a : b);
          double maxLat = positions.map((p) => p.latitude).reduce((a, b) => a > b ? a : b);
          double minLng = positions.map((p) => p.longitude).reduce((a, b) => a < b ? a : b);
          double maxLng = positions.map((p) => p.longitude).reduce((a, b) => a > b ? a : b);
          LatLngBounds bounds = LatLngBounds(
            southwest: LatLng(minLat - 0.002, minLng - 0.002),
            northeast: LatLng(maxLat + 0.002, maxLng + 0.002),
          );
          controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 80));
        }
      } catch (_) {}
    }
  }

  Future<void> _startLiveTracking() async {
    try {
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null) {
        _currentPosition = lastKnown;
        _updateMarkers();
      }
    } catch (_) {}

    _positionStream = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10)
    ).listen((Position position) {
      if (!mounted) return;
      setState(() {
        _currentPosition = position;
        _updateMarkers();
      });
      _syncLocation(position);
    });
  }

  Future<void> _syncLocation(Position pos) async {
    try {
      final socketService = SocketService();
      socketService.updateLocation(pos.latitude, pos.longitude);
      final headers = await _getAuthHeaders();
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/location/sync'),
        headers: headers,
        body: jsonEncode({'jobId': widget.jobId, 'lat': pos.latitude, 'lng': pos.longitude}),
      );
    } catch (e) {}
  }

  void _listenForArrivalEvents() {
    final socketService = SocketService();
    
    socketService.socket?.on('active_job_updated', (data) {
      if (!mounted || data == null) return;
      final String? updatedJobId = (data['jobId'] ?? data['job_id'])?.toString();
      if (updatedJobId == widget.jobId.toString()) {
        final String newStatus = data['status'];
        debugPrint("🔔 [SOCKET] Job status updated: $newStatus");
        
        if (newStatus == 'COMPLETED') {
          _handleJobCompletedNavigation();
        } else {
          setState(() {
            _currentStatus = newStatus;
          });
        }
      }
    });

    socketService.socket?.on('CUSTOMER_CONFIRMED_ARRIVAL', (data) {
      if (!mounted) return;
      debugPrint("🔔 [SOCKET] Customer Confirmed Arrival: $data");
      setState(() {
        _currentStatus = 'ARRIVED';
      });
      _positionStream?.cancel();
      BackgroundTracker.stopTracking();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Customer confirmed your arrival!"), backgroundColor: Colors.green),
      );
    });

    socketService.socket?.on('DESTINATION_UPDATED', (data) {
      if (!mounted || data == null) return;
      final String? jobId = data['jobId']?.toString();
      if (jobId == widget.jobId.toString()) {
        debugPrint("🔔 [SOCKET] Destination Updated: $data");
        setState(() {
          _job['location_lat'] = data['destination_lat'];
          _job['location_lng'] = data['destination_lng'];
          _job['address'] = data['address'];
          _job['route_polyline'] = null; // Clear old route so it gets recalculated
          _job['route_distance'] = null;
          _job['route_duration'] = null;
          _currentStatus = 'ON_THE_WAY'; // Reset to ON_THE_WAY
        });
        
        _updateMarkers();
        _updateRouteDetailsFromJob();
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Customer updated the destination! Rerouting..."), backgroundColor: Colors.blueAccent),
        );
      }
    });

    socketService.socket?.on('worker_location_update', (data) {
      if (!mounted || data == null) return;
      final String? updatedJobId = (data['jobId'] ?? data['job_id'])?.toString();
      if (updatedJobId == widget.jobId.toString()) {
        debugPrint("🔔 [SOCKET] Worker Location Update: $data");
        setState(() {
          if (data['polyline'] != null) {
            _job['route_polyline'] = data['polyline'];
          }
          if (data['distanceMeters'] != null) {
            _job['route_distance'] = data['distanceMeters'];
          }
          if (data['duration'] != null) {
            _job['route_duration'] = data['duration'];
          }
          if (data['distance'] != null) {
            _distance = data['distance'];
          }
          if (data['eta'] != null) {
            _eta = data['eta'];
          }
          _updateRouteDetailsFromJob();
        });
      }
    });
  }

  @override
  void dispose() {
    if (JobExecutionScreen.activeJobId == widget.jobId.toString()) {
      JobExecutionScreen.activeJobId = null;
    }
    _positionStream?.cancel();
    final socketService = SocketService();
    socketService.socket?.off('job_cancelled_by_user');
    socketService.socket?.off('USER_CANCELLED_JOB');
    socketService.socket?.off('USER_LATE_CANCELLED_JOB');
    socketService.socket?.off('active_job_updated');
    socketService.socket?.off('CUSTOMER_CONFIRMED_ARRIVAL');
    socketService.socket?.off('DESTINATION_UPDATED');
    socketService.socket?.off('worker_location_update');
    super.dispose();
  }

  void _showFarWarningDialog(int distance) {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (context) {
        final jobLat = double.tryParse((_job['location_lat'] ?? _job['locationLat'] ?? _job['lat'] ?? "0").toString()) ?? 0;
        final jobLng = double.tryParse((_job['location_lng'] ?? _job['locationLng'] ?? _job['lng'] ?? "0").toString()) ?? 0;
        final workerLat = _currentPosition?.latitude ?? 0;
        final workerLng = _currentPosition?.longitude ?? 0;

        return AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          title: Row(
            children: [
              const Icon(Icons.warning_amber_rounded, color: Colors.amberAccent, size: 28),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  "You seem far from the destination",
                  style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white),
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "You are currently not near the customer location. Please verify before marking arrival.",
                style: GoogleFonts.inter(color: Colors.white70, fontSize: 14),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.redAccent.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.redAccent.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.directions_run, color: Colors.redAccent, size: 18),
                    const SizedBox(width: 8),
                    Text(
                      "Distance: $distance meters away",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.redAccent, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: SizedBox(
                  height: 180,
                  width: double.infinity,
                  child: GoogleMap(
                    initialCameraPosition: CameraPosition(
                      target: LatLng(jobLat, jobLng),
                      zoom: 13,
                    ),
                    markers: {
                      Marker(
                        markerId: const MarkerId('destination'),
                        position: LatLng(jobLat, jobLng),
                        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
                      ),
                      if (workerLat != 0)
                        Marker(
                          markerId: const MarkerId('worker'),
                          position: LatLng(workerLat, workerLng),
                          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
                        ),
                    },
                    zoomControlsEnabled: false,
                    myLocationButtonEnabled: false,
                  ),
                ),
              ),
            ],
          ),
          actionsAlignment: MainAxisAlignment.spaceBetween,
          actionsPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(
                "Continue Navigation",
                style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white54),
              ),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                _transitionStatus('ARRIVED', force: true);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: primaryColor,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(
                "Force Mark Arrival",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        );
      },
    );
  }

  void _showPaymentSelectionSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isDismissible: true,
      builder: (context) {
        return GlassContainer(
          borderRadius: 30,
          blur: 25,
          padding: const EdgeInsets.all(24),
          margin: const EdgeInsets.all(16),
          color: const Color(0xFF011410).withOpacity(0.95),
          border: Border.all(color: const Color(0xFF10B981).withOpacity(0.2), width: 1.5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                "Select Payment Received",
                style: GoogleFonts.outfit(
                  fontSize: 20, 
                  fontWeight: FontWeight.bold, 
                  color: Colors.white,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                "How did the customer pay you for this job?",
                style: GoogleFonts.inter(fontSize: 12, color: Colors.white60),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              _buildPaymentOptionTile(
                icon: Icons.payments_outlined,
                title: "Cash Payment",
                description: "Customer paid directly in physical cash",
                color: const Color(0xFF10B981),
                onTap: () {
                  Navigator.pop(context);
                  _transitionStatus('COMPLETED', paymentMethod: 'CASH');
                },
              ),
              const SizedBox(height: 12),
              _buildPaymentOptionTile(
                icon: Icons.qr_code_scanner_rounded,
                title: "UPI / Scanner Payment",
                description: "Customer scanned your UPI QR code",
                color: const Color(0xFFF97316),
                onTap: () {
                  Navigator.pop(context);
                  _transitionStatus('COMPLETED', paymentMethod: 'UPI');
                },
              ),
              const SizedBox(height: 12),
              _buildPaymentOptionTile(
                icon: Icons.credit_card_rounded,
                title: "Online Gateway / UPI QR",
                description: "Request payment via online QR / wallet",
                color: const Color(0xFF3B82F6),
                onTap: () {
                  Navigator.pop(context);
                  _transitionStatus('WAITING_FOR_PAYMENT', paymentMethod: 'ONLINE');
                },
              ),
              const SizedBox(height: 10),
            ],
          ),
        );
      },
    );
  }

  Widget _buildPaymentOptionTile({
    required IconData icon,
    required String title,
    required String description,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withOpacity(0.2), width: 1.2),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: color.withOpacity(0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 24),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.outfit(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      color: Colors.white60,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white30, size: 14),
          ],
        ),
      ),
    );
  }

  Future<void> _transitionStatus(String newStatus, {bool force = false, String? paymentMethod}) async {
    setState(() => _isTransitioning = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final phone = prefs.getString('workerPhone') ?? "1";
      
      Position? pos;
      try {
        if (newStatus == 'ARRIVED' || newStatus == 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
          pos = await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.high,
            timeLimit: const Duration(seconds: 4),
          );
        } else {
          pos = await Geolocator.getLastKnownPosition();
          pos ??= await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.low,
            timeLimit: const Duration(seconds: 1),
          );
        }
      } catch (e) {
        debugPrint("⚠️ [GPS] Failed to retrieve current GPS for status $newStatus: $e");
        if (newStatus == 'ARRIVED' || newStatus == 'FORCE_ARRIVAL_PENDING_CONFIRMATION') {
          try {
            pos = await Geolocator.getLastKnownPosition();
          } catch (_) {}
          if (pos == null) rethrow;
        } else {
          try {
            pos ??= await Geolocator.getLastKnownPosition();
          } catch (_) {}
        }
      }

      final headers = await _getAuthHeaders();
      final response = await http.patch(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/${widget.jobId}/status'),
        headers: headers,
        body: json.encode({
          'workerId': phone,
          'newStatus': newStatus,
          'lat': pos?.latitude ?? 0.0,
          'lng': pos?.longitude ?? 0.0,
          'isMocked': pos?.isMocked ?? false,
          'force': force,
          if (paymentMethod != null) 'paymentMethod': paymentMethod,
        }),
      );

      final data = json.decode(response.body);
      
      if (!data['success'] && data['error'] == 'TOO_FAR') {
        setState(() => _isTransitioning = false);
        _showFarWarningDialog(data['distance'] ?? 0);
        return;
      }

      if (data['success']) {
        final transitionedStatus = data['status'] ?? newStatus;
        if (transitionedStatus == 'WORK_IN_PROGRESS') {
          _workStartTime = DateTime.now();
          SharedPreferences.getInstance().then((prefs) {
            prefs.setString('work_start_time_${widget.jobId}', _workStartTime!.toIso8601String());
          });
        }
        if (transitionedStatus == 'COMPLETED') {
          _handleJobCompletedNavigation();
        } else {
          setState(() {
            _currentStatus = transitionedStatus;
            _isTransitioning = false;
          });
          if (transitionedStatus == 'ON_THE_WAY') {
            _startLiveTracking();
            BackgroundTracker.startTracking(widget.jobId.toString());
          }
          if (transitionedStatus == 'ARRIVED') {
            _positionStream?.cancel();
            BackgroundTracker.stopTracking();
          }
        }
      } else {
        setState(() => _isTransitioning = false);
        _showError(data['error'] ?? "Transition failed");
      }
    } catch (e) {
      setState(() => _isTransitioning = false);
      _showError("Error: $e");
    }
  }

  void _handleJobCompletedNavigation() {
    BackgroundTracker.stopTracking();
    
    SharedPreferences.getInstance().then((prefs) {
      prefs.remove('work_start_time_${widget.jobId}');
    });
    
    String timeElapsed = "5 mins";
    final start = _workStartTime ?? DateTime.tryParse(_job['updated_at']?.toString() ?? '');
    if (start != null) {
      final diff = DateTime.now().difference(start);
      int minutes = diff.inMinutes;
      if (minutes <= 0) {
        int seconds = diff.inSeconds;
        if (seconds <= 0) seconds = 5; // default minimum
        timeElapsed = "$seconds secs";
      } else {
        timeElapsed = "$minutes mins";
      }
    }
    
    Navigator.pushReplacement(
      context, 
      MaterialPageRoute(
        builder: (context) => JobCompletionScreen(job: _job, timeElapsed: timeElapsed)
      )
    );
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: Colors.redAccent));
  }

  void _showCancelJobModal() {
    String? selectedReason;
    List<String> cancelReasons = [];
    if (_currentStatus == 'ACCEPTED') {
      cancelReasons = [
        "Customer location is too far",
        "Schedule conflict / another booking",
        "Accident / Injury",
        "Vehicle breakdown / repair needed",
        "Payment terms or pricing issue",
        "Other"
      ];
    } else if (_currentStatus == 'ON_THE_WAY') {
      cancelReasons = [
        "Personal/Medical emergency",
        "Accident / Injury",
        "Vehicle breakdown / repair needed",
        "Health issues / feeling unwell",
        "Unsafe customer behavior / harassment",
        "Other"
      ];
    } else {
      cancelReasons = [
        "Customer is unreachable / not picking up calls",
        "Accident / Injury",
        "Vehicle breakdown / repair needed",
        "Incorrect or incomplete address",
        "Unsafe environment / unsafe to perform task",
        "Other"
      ];
    }
    final noteController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return GlassContainer(
              borderRadius: 30,
              blur: 30,
              padding: EdgeInsets.only(
                left: 24,
                right: 24,
                top: 24,
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              margin: const EdgeInsets.all(16),
              color: Colors.black.withOpacity(0.9),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 48,
                      height: 5,
                      decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      const Icon(Icons.cancel_outlined, color: Colors.redAccent, size: 28),
                      const SizedBox(width: 8),
                      Text(
                        "Cancel Gig",
                        style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.redAccent),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Please provide a reason for cancelling. Frequent cancellations impact your reliability score and matching priority.",
                    style: GoogleFonts.inter(color: textSecondary, fontSize: 13),
                  ),
                  const SizedBox(height: 16),
                  Text("SELECT CANCELLATION REASON", style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white54)),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 180,
                    child: ListView(
                      children: cancelReasons.map((r) => Theme(
                        data: Theme.of(context).copyWith(unselectedWidgetColor: Colors.white38),
                        child: RadioListTile<String>(
                          title: Text(r, style: GoogleFonts.inter(fontSize: 14, color: Colors.white70)),
                          value: r,
                          groupValue: selectedReason,
                          activeColor: Colors.redAccent,
                          onChanged: (val) {
                            setModalState(() {
                              selectedReason = val;
                            });
                          },
                          contentPadding: EdgeInsets.zero,
                        ),
                      )).toList(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  GlassContainer(
                    borderRadius: 12,
                    blur: 10,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    child: TextField(
                      controller: noteController,
                      style: GoogleFonts.inter(color: Colors.white),
                      decoration: InputDecoration(
                        border: InputBorder.none,
                        hintText: "Describe the situation...",
                        hintStyle: GoogleFonts.inter(color: Colors.white38, fontSize: 13),
                      ),
                      maxLines: 2,
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: GlassButton(
                      onPressed: selectedReason == null ? null : () async {
                        Navigator.pop(context); 
                        await _executeCancellation(selectedReason!, noteController.text);
                      },
                      text: "CANCEL GIG IMMEDIATELY",
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

  Future<void> _executeCancellation(String reason, String note) async {
    setState(() => _isTransitioning = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final phone = prefs.getString('workerPhone') ?? "1";

      final headers = await _getAuthHeaders();
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/${widget.jobId}/cancel-by-worker'),
        headers: headers,
        body: json.encode({
          'workerId': phone,
          'reason': reason,
          'note': note
        }),
      );

      final data = json.decode(response.body);
      if (data['success']) {
        if (mounted) {
          BackgroundTracker.stopTracking();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Gig cancelled successfully."), backgroundColor: Colors.orange),
          );
          Navigator.of(context).popUntil((route) => route.isFirst);
        }
      } else {
        setState(() => _isTransitioning = false);
        _showError(data['message'] ?? "Cancellation failed");
      }
    } catch (e) {
      setState(() => _isTransitioning = false);
      _showError("Error: $e");
    }
  }

  void _showEmergencyReassignModal() {
    String? selectedReason;
    final reasons = [
      "Accident / Injury",
      "Vehicle breakdown / repair needed",
      "Medical emergency",
      "Severe weather / blocked route",
      "Family emergency",
      "Unsafe environment / customer behavior",
      "Device / network issues"
    ];
    final noteController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return GlassContainer(
              borderRadius: 30,
              blur: 30,
              padding: EdgeInsets.only(
                left: 24,
                right: 24,
                top: 24,
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              margin: const EdgeInsets.all(16),
              color: Colors.black.withOpacity(0.9),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 48,
                      height: 5,
                      decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      const Icon(Icons.warning_amber_rounded, color: Colors.amberAccent, size: 28),
                      const SizedBox(width: 8),
                      Text(
                        "Emergency Reassign",
                        style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.amberAccent),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "This job will be immediately reassigned to another nearby worker. Selecting emergency reassignment will impact your reliability score.",
                    style: GoogleFonts.inter(color: textSecondary, fontSize: 13),
                  ),
                  const SizedBox(height: 16),
                  Text("SELECT EMERGENCY REASON", style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white54)),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 180,
                    child: ListView(
                      children: reasons.map((r) => Theme(
                        data: Theme.of(context).copyWith(unselectedWidgetColor: Colors.white38),
                        child: RadioListTile<String>(
                          title: Text(r, style: GoogleFonts.inter(fontSize: 14, color: Colors.white70)),
                          value: r,
                          groupValue: selectedReason,
                          activeColor: Colors.amberAccent,
                          onChanged: (val) {
                            setModalState(() {
                              selectedReason = val;
                            });
                          },
                          contentPadding: EdgeInsets.zero,
                        ),
                      )).toList(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  GlassContainer(
                    borderRadius: 12,
                    blur: 10,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    child: TextField(
                      controller: noteController,
                      style: GoogleFonts.inter(color: Colors.white),
                      decoration: InputDecoration(
                        border: InputBorder.none,
                        hintText: "Optional details...",
                        hintStyle: GoogleFonts.inter(color: Colors.white38, fontSize: 13),
                      ),
                      maxLines: 2,
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: GlassButton(
                      onPressed: selectedReason == null ? null : () async {
                        Navigator.pop(context); 
                        await _submitEmergencyReassignment(selectedReason!, noteController.text);
                      },
                      text: "REASSIGN JOB IMMEDIATELY",
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

  Future<void> _submitEmergencyReassignment(String reason, String note) async {
    setState(() => _isTransitioning = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final phone = prefs.getString('workerPhone') ?? "1";
      
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/${widget.jobId}/worker-reassign'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'workerId': phone,
          'reason': reason,
          'note': note,
        }),
      );

      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        CacheService.setJsonList('active_gigs', []);
        
        if (mounted) {
          showDialog(
            context: context,
            barrierDismissible: false,
            builder: (context) => AlertDialog(
              backgroundColor: const Color(0xFF1E293B),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              title: Text("Job Reassigned", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.greenAccent)),
              content: Text(
                "Emergency reassignment has been processed successfully. You are now free to take other jobs.",
                style: GoogleFonts.inter(color: Colors.white70),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(context); 
                    Navigator.of(context).popUntil((route) => route.isFirst); 
                  },
                  child: Text("OK", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.greenAccent)),
                ),
              ],
            ),
          );
        }
      } else {
        _showError(data['message'] ?? "Failed to reassign job.");
      }
    } catch (e) {
      _showError("Error: $e");
    } finally {
      if (mounted) {
        setState(() => _isTransitioning = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Scaffold(body: Center(child: CircularProgressIndicator(color: primaryColor)));

    if (_job == null || (_job is Map && _job.isEmpty)) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 64, color: Colors.redAccent),
              const SizedBox(height: 16),
              Text("Could not load job details.", style: GoogleFonts.inter(fontSize: 16)),
              TextButton(onPressed: _fetchJobDetails, child: const Text("Retry")),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      extendBodyBehindAppBar: true,
      body: Stack(
        children: [
          // FULL BACKGROUND MAP
          Positioned.fill(
            child: GoogleMap(
              onMapCreated: (controller) => _mapController.complete(controller),
              initialCameraPosition: CameraPosition(
                target: LatLng(
                  double.tryParse((_job['location_lat'] ?? _job['locationLat'] ?? _job['lat'] ?? "0").toString()) ?? 0,
                  double.tryParse((_job['location_lng'] ?? _job['locationLng'] ?? _job['lng'] ?? "0").toString()) ?? 0,
                ),
                zoom: 15,
              ),
              markers: _markers,
              polylines: _polylines,
              myLocationEnabled: true,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              onTap: (_) => _openMaps(), 
            ),
          ),

          // FLOATING APP BAR
          Positioned(
            top: 40,
            left: 20,
            right: 20,
            child: SafeArea(
              child: GlassContainer(
                borderRadius: 20,
                blur: 25,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                color: Colors.black.withOpacity(0.65),
                border: Border.all(color: Colors.white.withOpacity(0.12)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white, size: 18),
                      onPressed: () => Navigator.pop(context),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        DynamicIslandPulse(
                          text: _currentStatus == 'ACCEPTED'
                              ? 'Accepted'
                              : _currentStatus == 'ON_THE_WAY'
                                  ? 'En Route'
                                  : _currentStatus == 'ARRIVED'
                                      ? 'Arrived'
                                      : _currentStatus == 'WORK_IN_PROGRESS'
                                          ? 'Working'
                                          : _currentStatus == 'WAITING_FOR_PAYMENT'
                                              ? 'Awaiting Payment'
                                              : _currentStatus,
                          icon: _currentStatus == 'ACCEPTED'
                              ? Icons.check_circle
                              : _currentStatus == 'ON_THE_WAY'
                                  ? Icons.directions_walk
                                  : _currentStatus == 'ARRIVED'
                                      ? Icons.location_on
                                      : _currentStatus == 'WAITING_FOR_PAYMENT'
                                          ? Icons.hourglass_empty_rounded
                                          : Icons.build_circle,
                          pulseColor: _currentStatus == 'ACCEPTED'
                              ? Colors.lightBlueAccent
                              : _currentStatus == 'ON_THE_WAY' || _currentStatus == 'WAITING_FOR_PAYMENT'
                                  ? Colors.amberAccent
                                  : _currentStatus == 'ARRIVED' ||
                                          _currentStatus == 'WORK_IN_PROGRESS'
                                      ? Colors.greenAccent
                                      : Colors.greenAccent,
                        ),
                      ],
                    ),
                    ImageUtils.buildProfileImage(_job['userPhoto'] != null ? '${NetworkHelper.baseUrl}${_job['userPhoto']}' : null, radius: 14, name: _job['userName']),
                  ],
                ),
              ),
            ),
          ),

          // FLOATING ETA CARD
          if (_currentPosition != null && _currentStatus == 'ON_THE_WAY')
            Positioned(
              top: 130,
              left: 20,
              right: 20,
              child: GlassContainer(
                borderRadius: 20,
                blur: 25,
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                color: Colors.black.withOpacity(0.7),
                border: Border.all(color: Colors.white.withOpacity(0.15)),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(color: primaryColor.withOpacity(0.2), shape: BoxShape.circle),
                      child: const Icon(Icons.timer_outlined, color: primaryColor, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text("ESTIMATED ARRIVAL", style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white54)),
                          Text("$_eta away ($_distance)", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary)),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right, color: Colors.white30),
                  ],
                ),
              ),
            ),

          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Details Card
                GlassContainer(
                  customBorderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                  blur: 35,
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 12),
                  color: Colors.black.withOpacity(0.75),
                  border: Border(
                    top: BorderSide(color: Colors.white.withOpacity(0.15), width: 1.5),
                    left: BorderSide(color: Colors.white.withOpacity(0.15), width: 1.5),
                    right: BorderSide(color: Colors.white.withOpacity(0.15), width: 1.5),
                  ),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: MediaQuery.of(context).size.height * 0.4,
                    ),
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white30, borderRadius: BorderRadius.circular(2)))),
                          const SizedBox(height: 12),
                          _buildCustomerRow(),
                          const SizedBox(height: 14),
                          // Service + Payout as compact inline row
                          Row(
                            children: [
                              const Icon(Icons.bolt, color: primaryColor, size: 15),
                              const SizedBox(width: 5),
                              Text(
                                _job['category'] ?? 'Service',
                                style: GoogleFonts.inter(fontSize: 13, color: textSecondary),
                              ),
                              const SizedBox(width: 16),
                              const Icon(Icons.payments_outlined, color: primaryColor, size: 15),
                              const SizedBox(width: 5),
                              Text(
                                '₹${_job['price']}',
                                style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.bold, color: textPrimary),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Text('Job Details', style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary)),
                          const SizedBox(height: 6),
                          Text(_job['description'] ?? 'No description provided.', style: GoogleFonts.inter(color: textSecondary, fontSize: 13, height: 1.5)),
                          const SizedBox(height: 12),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.location_on, color: primaryColor, size: 16),
                              const SizedBox(width: 6),
                              Expanded(child: Text(_job['address'] ?? _job['location_name'] ?? 'Address on map', style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.bold, color: textPrimary))),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                // STICKY BOTTOM ACTIONS
                GlassContainer(
                  borderRadius: 0,
                  blur: 30,
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
                  color: Colors.black.withOpacity(0.8),
                  border: Border(top: BorderSide(color: Colors.white.withOpacity(0.12))),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_currentStatus == 'ON_THE_WAY')
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: GlassButton(
                            icon: Icons.directions,
                            text: "NAVIGATE TO LOCATION",
                            onPressed: _openMaps,
                          ),
                        ),
                      _buildSwipeActionByStatus(),
                      if (_currentStatus == 'ACCEPTED' || _currentStatus == 'ON_THE_WAY' || _currentStatus == 'FORCE_ARRIVAL_PENDING_CONFIRMATION' || _currentStatus == 'ARRIVED' || _currentStatus == 'WORK_IN_PROGRESS') ...[
                        const SizedBox(height: 12),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            TextButton.icon(
                              onPressed: _isTransitioning ? null : _showCancelJobModal,
                              icon: const Icon(Icons.cancel_outlined, color: Colors.redAccent, size: 16),
                              label: Text("CANCEL GIG", style: GoogleFonts.outfit(color: Colors.redAccent, fontWeight: FontWeight.bold, fontSize: 12)),
                            ),
                            TextButton.icon(
                              onPressed: _isTransitioning ? null : _showEmergencyReassignModal,
                              icon: const Icon(Icons.swap_horiz, color: Colors.amberAccent, size: 16),
                              label: Text("EMERGENCY REASSIGN", style: GoogleFonts.outfit(color: Colors.amberAccent, fontWeight: FontWeight.bold, fontSize: 12)),
                            ),
                          ],
                        ),
                      ]
                    ],
                  ),
                ),
              ],
            ),
          ),

          if (_isTransitioning)
            Container(color: Colors.black38, child: const Center(child: CircularProgressIndicator(color: primaryColor))),
        ],
      ),
    );
  }

  Widget _buildCustomerRow() {
    return Row(
      children: [
        ImageUtils.buildProfileImage(_job['userPhoto'] != null ? '${NetworkHelper.baseUrl}${_job['userPhoto']}' : null, radius: 30, name: _job['userName']),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_job['userName'] ?? "Client", style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: textPrimary)),
              Text("Verified Customer", style: GoogleFonts.inter(color: Colors.greenAccent, fontSize: 12, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        _buildCircleButton(Icons.phone, () => launchUrl(Uri.parse("tel:+919731016442"))),
        const SizedBox(width: 12),
        _buildCircleButton(Icons.chat_bubble_outline, () {
          Navigator.push(context, MaterialPageRoute(builder: (context) => ChatScreen(jobId: widget.jobId, userName: _job['userName'] ?? "Client", initialPrice: _job['price']?.toString() ?? "0")));
        }),
      ],
    );
  }


  Widget _buildCircleButton(IconData icon, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: GlassContainer(
        borderRadius: 50,
        blur: 10,
        padding: const EdgeInsets.all(12),
        color: Colors.white.withOpacity(0.08),
        border: Border.all(color: Colors.white.withOpacity(0.15)),
        child: Icon(icon, color: primaryColor, size: 20),
      ),
    );
  }

  Widget _buildSwipeActionByStatus() {
    String text = "";
    Color color = primaryColor;
    VoidCallback? onSwipe;

    switch (_currentStatus) {
      case 'ACCEPTED':
        text = "👉 SWIPE TO START JOURNEY";
        color = const Color(0xFF3B82F6);
        onSwipe = () => _transitionStatus('ON_THE_WAY');
        break;
      case 'ON_THE_WAY':
        text = "👉 SWIPE TO MARK ARRIVAL";
        color = const Color(0xFF10B981);
        onSwipe = () => _transitionStatus('ARRIVED');
        break;
      case 'FORCE_ARRIVAL_PENDING_CONFIRMATION':
        return Container(
          width: double.infinity,
          height: 64,
          decoration: BoxDecoration(
            color: Colors.amberAccent.withOpacity(0.1),
            borderRadius: BorderRadius.circular(32),
            border: Border.all(color: Colors.amberAccent.withOpacity(0.3)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(color: Colors.amberAccent, strokeWidth: 2),
              ),
              const SizedBox(width: 12),
              Text(
                "WAITING FOR CUSTOMER CONFIRMATION",
                style: GoogleFonts.outfit(
                  fontWeight: FontWeight.bold,
                  color: Colors.amberAccent,
                  fontSize: 12,
                  letterSpacing: 0.5
                ),
              ),
            ],
          ),
        );
      case 'ARRIVED':
        text = "👉 SWIPE TO START WORK";
        color = primaryColor;
        onSwipe = () => _transitionStatus('WORK_IN_PROGRESS');
        break;
      case 'WORK_IN_PROGRESS':
        text = "👉 SWIPE TO COMPLETE JOB";
        color = const Color(0xFF10B981);
        onSwipe = () => _showPaymentSelectionSheet();
        break;
      case 'WAITING_FOR_PAYMENT':
        return Container(
          width: double.infinity,
          height: 64,
          decoration: BoxDecoration(
            color: Colors.amberAccent.withOpacity(0.1),
            borderRadius: BorderRadius.circular(32),
            border: Border.all(color: Colors.amberAccent.withOpacity(0.3)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(color: Colors.amberAccent, strokeWidth: 2),
              ),
              const SizedBox(width: 12),
              Text(
                "WAITING FOR CUSTOMER PAYMENT",
                style: GoogleFonts.outfit(
                  fontWeight: FontWeight.bold,
                  color: Colors.amberAccent,
                  fontSize: 12,
                  letterSpacing: 0.5
                ),
              ),
            ],
          ),
        );
      default: return const SizedBox.shrink();
    }

    return SwipeToPerformAction(text: text, color: color, onSwipe: onSwipe);
  }

  void _openMaps() async {
    final lat = _job['location_lat'] ?? _job['locationLat'] ?? _job['lat'];
    final lng = _job['location_lng'] ?? _job['locationLng'] ?? _job['lng'];
    final url = "google.navigation:q=$lat,$lng&mode=d";
    debugPrint("📡 [NAVIGATION] Opening: $url");
    if (await canLaunchUrl(Uri.parse(url))) {
      await launchUrl(Uri.parse(url));
    } else {
      launchUrl(Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$lat,$lng"));
    }
  }
}

class SwipeToPerformAction extends StatefulWidget {
  final String text;
  final Color color;
  final VoidCallback onSwipe;
  const SwipeToPerformAction({super.key, required this.text, required this.color, required this.onSwipe});
  @override
  State<SwipeToPerformAction> createState() => _SwipeToPerformActionState();
}

class _SwipeToPerformActionState extends State<SwipeToPerformAction> {
  double _position = 0.0;
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, constraints) {
      final double trackWidth = constraints.maxWidth;
      final double maxSlide = trackWidth - 64;
      return GlassContainer(
        borderRadius: 32,
        blur: 15,
        width: double.infinity,
        height: 64,
        padding: EdgeInsets.zero,
        color: widget.color.withOpacity(0.12),
        border: Border.all(color: widget.color.withOpacity(0.2)),
        child: Stack(
          children: [
            Center(child: Text(widget.text, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13))),
            Positioned(
              left: _position,
              child: GestureDetector(
                onHorizontalDragUpdate: (details) {
                  setState(() {
                    _position += details.delta.dx;
                    if (_position < 0) _position = 0;
                    if (_position > maxSlide) _position = maxSlide;
                  });
                },
                onHorizontalDragEnd: (details) {
                  if (_position > maxSlide * 0.8) widget.onSwipe();
                  setState(() => _position = 0);
                },
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: widget.color, 
                    shape: BoxShape.circle, 
                    boxShadow: [
                      BoxShadow(color: widget.color.withOpacity(0.4), blurRadius: 12)
                    ],
                  ), 
                  child: const Icon(Icons.arrow_forward_ios, color: Colors.white, size: 24)
                ),
              ),
            ),
          ],
        ),
      );
    });
  }
}
