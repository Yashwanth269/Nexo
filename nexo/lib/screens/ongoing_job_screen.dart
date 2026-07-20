import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:nexo/screens/reassigning_worker_screen.dart';
import 'package:nexo/screens/rating_screen.dart';
import 'package:nexo/screens/checkout_screen.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:nexo/screens/searching_workers_screen.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:nexo/components/glass_components.dart';

class OngoingJobScreen extends StatefulWidget {
  final Map<String, dynamic>? initialJob;
  const OngoingJobScreen({super.key, this.initialJob});

  @override
  State<OngoingJobScreen> createState() => _OngoingJobScreenState();
}

class _OngoingJobScreenState extends State<OngoingJobScreen> {
  Map<String, dynamic>? _job;
  bool _isLoading = true;
  Timer? _timer;
  GoogleMapController? _mapController;

  // Premium glass colors
  static const Color primaryColor = Color(0xFFF97316);
  static const Color successColor = Color(0xFF22C55E);

  Color get _textPrimary => GlassTheme.textPrimary(context);
  Color get _textSecondary => GlassTheme.textSecondary(context);
  bool get _isDark => Theme.of(context).brightness == Brightness.dark;

  @override
  void initState() {
    super.initState();
    if (widget.initialJob != null) {
      _job = widget.initialJob;
      _isLoading = false;
    }
    _fetchOngoingJob();
    _initSocket();
    _timer = Timer.periodic(const Duration(seconds: 10), (t) => _fetchOngoingJob());
  }

  void _initSocket() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId != null) {
      final socketService = SocketService();
      socketService.connect(userId);
      
      socketService.socket?.on('job_status_updated', (data) {
        if (mounted && data != null) {
          debugPrint("🚀 [ONGOING_JOB] Status updated via socket: ${data['status']}");
          _fetchOngoingJob();
        }
      });

      socketService.socket?.on('worker_location_update', (data) {
        if (mounted && data != null && _job != null) {
          final lat = double.tryParse(data['lat']?.toString() ?? '');
          final lng = double.tryParse(data['lng']?.toString() ?? '');
          if (lat != null && lng != null) {
            setState(() {
              _job!['worker'] = {
                ...(_job!['worker'] ?? {}),
                'lat': lat,
                'lng': lng,
                if (data['eta'] != null) 'eta': data['eta'],
                if (data['distance'] != null) 'distance': data['distance'],
              };
            });
            _updateCamera();
          }
        }
      });

      socketService.socket?.on('WORKER_FORCE_MARKED_ARRIVAL', (data) {
        if (mounted && data != null) {
          debugPrint("🚀 [ONGOING_JOB] Worker force marked arrival via socket!");
          _fetchOngoingJob();
        }
      });
      
      socketService.socket?.on('WORKER_CANCELLED_JOB', (data) {
        if (mounted) {
          debugPrint("🚀 [ONGOING_JOB] Worker cancelled via socket!");
          _fetchOngoingJob();
        }
      });

      socketService.socket?.on('WORKER_CANCELLED_GIG', (data) {
        if (mounted) {
          debugPrint("🚀 [ONGOING_JOB] Worker cancelled gig via socket!");
          _fetchOngoingJob();
        }
      });
      
      socketService.socket?.on('WORKER_EMERGENCY_REASSIGN', (data) {
        if (mounted) {
          debugPrint("🚀 [ONGOING_JOB] Worker requested emergency reassignment!");
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: GlassContainer(
                borderRadius: 16,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                color: Colors.amber.withOpacity(0.9),
                child: Text(
                  "Partner had an emergency. Finding another partner...",
                  style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.bold),
                ),
              ),
              backgroundColor: Colors.transparent,
              elevation: 0,
            ),
          );
          _fetchOngoingJob();
        }
      });

      socketService.socket?.on('WORKER_REASSIGNED_GIG', (data) {
        if (mounted) {
          debugPrint("🚀 [ONGOING_JOB] Worker emergency reassigned gig via socket!");
          _fetchOngoingJob();
        }
      });
    }
  }

  Future<void> _confirmWorkerArrival() async {
    setState(() => _isLoading = true);
    try {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/${_job!['id']}/customer-confirm-arrival'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({'userId': userId}),
      );
      final data = json.decode(response.body);
      if (data['success']) {
        _fetchOngoingJob();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['error'] ?? "Failed to confirm arrival"), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e"), backgroundColor: Colors.redAccent),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _showUpdateAddressModal() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        LatLng selectedLatLng = LatLng(
          double.parse((_job!['location_lat'] ?? 12.9716).toString()),
          double.parse((_job!['location_lng'] ?? 77.5946).toString()),
        );
        final addressController = TextEditingController(text: _job!['address'] ?? "");
        
        return StatefulBuilder(
          builder: (context, setModalState) {
            return GlassContainer(
              borderRadius: 30,
              blur: 18,
              padding: EdgeInsets.only(
                top: 24,
                left: 24,
                right: 24,
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              margin: const EdgeInsets.all(16),
              color: Colors.black.withOpacity(0.88),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2)))),
                  const SizedBox(height: 24),
                  Text("Update Service Address", style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold,                      color: _textPrimary)),
                  const SizedBox(height: 8),
                  Text("Verify or drag the pin to update where you want the partner to arrive.", style: GoogleFonts.inter(                    color: _textSecondary, fontSize: 13)),
                  const SizedBox(height: 16),
                  GlassContainer(
                    borderRadius: 16,
                    blur: 15,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: TextField(
                      controller: addressController,
                      style: GoogleFonts.inter(color: Colors.white),
                      decoration: InputDecoration(
                        border: InputBorder.none,
                        labelText: "Address Description",
                        labelStyle: GoogleFonts.inter(color: Colors.white54),
                        prefixIcon: const Icon(Icons.my_location, color: primaryColor),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: SizedBox(
                      height: 200,
                      child: GoogleMap(
                        initialCameraPosition: CameraPosition(
                          target: selectedLatLng,
                          zoom: 14,
                        ),
                        markers: {
                          Marker(
                            markerId: const MarkerId("selected"),
                            position: selectedLatLng,
                            draggable: true,
                            onDragEnd: (newPosition) {
                              setModalState(() {
                                    selectedLatLng = newPosition;
                              });
                            },
                          ),
                        },
                        onTap: (newPosition) {
                          setModalState(() {
                            selectedLatLng = newPosition;
                          });
                        },
                        zoomControlsEnabled: false,
                        myLocationButtonEnabled: false,
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: GlassButton(
                      onPressed: () async {
                        Navigator.pop(context);
                        await _updateJobAddress(selectedLatLng.latitude, selectedLatLng.longitude, addressController.text);
                      },
                      text: "Update Address & Re-route",
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

  Future<void> _updateJobAddress(double lat, double lng, String address) async {
    setState(() => _isLoading = true);
    try {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/${_job!['id']}/update-address'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'userId': userId,
          'lat': lat,
          'lng': lng,
          'address': address,
        }),
      );
      final data = json.decode(response.body);
      if (data['success']) {
        _fetchOngoingJob();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Address updated successfully! Partner has been notified."), backgroundColor: Colors.green),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['error'] ?? "Failed to update address"), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e"), backgroundColor: Colors.redAccent),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _mapController?.dispose();
    final socketService = SocketService();
    socketService.socket?.off('job_status_updated');
    socketService.socket?.off('WORKER_FORCE_MARKED_ARRIVAL');
    socketService.socket?.off('WORKER_CANCELLED_JOB');
    socketService.socket?.off('WORKER_CANCELLED_GIG');
    socketService.socket?.off('WORKER_EMERGENCY_REASSIGN');
    socketService.socket?.off('WORKER_REASSIGNED_GIG');
    super.dispose();
  }

  Future<void> _fetchOngoingJob() async {
    final phone = await SharedPrefsHelper.getPhone();
    if (phone == null) return;

    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/$phone/ongoing'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          final job = data['job'];
          if (job['status'] == 'REASSIGNING') {
            _timer?.cancel();
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(builder: (context) => ReassigningWorkerScreen(job: job)),
            );
            return;
          }
          if (job['status'] == 'WAITING_FOR_PAYMENT') {
            _timer?.cancel();
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(builder: (context) => CheckoutScreen(job: job)),
            );
            return;
          }
          if (job['status'] == 'COMPLETED') {
            _timer?.cancel();
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(builder: (context) => RatingScreen(job: job)),
            );
            return;
          }
          if (job['status'] == 'OPEN' || job['status'] == 'REDISTRIBUTING') {
            _timer?.cancel();
            _showWorkerCancelledModal(job);
            return;
          }
          setState(() {
            _job = job;
            _isLoading = false;
          });
          _updateCamera();
        } else if (mounted && !data['success'] && _job != null) {
          Navigator.pop(context);
        }
      }
    } catch (e) {
      debugPrint("Error fetching ongoing job: $e");
    } finally {
      if (mounted && _job == null) setState(() => _isLoading = false);
    }
  }

  void _showWorkerCancelledModal(Map<String, dynamic> job) {
    showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      builder: (context) => GlassContainer(
        borderRadius: 30,
        blur: 18,
        padding: const EdgeInsets.all(32),
        margin: const EdgeInsets.all(16),
        color: Colors.black.withOpacity(0.88),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: Colors.redAccent.withOpacity(0.15), shape: BoxShape.circle),
              child: const Icon(Icons.person_search_outlined, color: Colors.redAccent, size: 40),
            ),
            const SizedBox(height: 24),
            Text("Partner Cancelled the Job", style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold,                      color: _textPrimary)),
            const SizedBox(height: 8),
            Text("The assigned partner cancelled this job.", style: GoogleFonts.inter(                color: _textSecondary)),
            const SizedBox(height: 24),
            GlassContainer(
              borderRadius: 16,
              blur: 15,
              padding: const EdgeInsets.all(16),
              color: Colors.white.withOpacity(0.18),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, color: Colors.amberAccent),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("REASON FOR CANCELLATION", style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white54)),
                        Text(job['cancellation_reason'] ?? "Emergency / personal issue", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold,                      color: _textPrimary)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                const Icon(Icons.radar, color: primaryColor, size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("We're searching for another partner nearby.", style: GoogleFonts.inter(fontWeight: FontWeight.bold,                  color: _textPrimary, fontSize: 13)),
                      Text("Your request is still active.", style: GoogleFonts.inter(fontSize: 11,                 color: _textSecondary, fontStyle: FontStyle.italic)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: GlassButton(
                onPressed: () {
                  Navigator.pushReplacement(
                    context,
                    MaterialPageRoute(builder: (context) => SearchingWorkersScreen(job: job)),
                  );
                },
                text: "Continue Searching",
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _updateCamera() {
    if (_mapController == null || _job == null) return;
    final worker = _job!['worker'];
    final userLat = double.parse((_job!['location_lat'] ?? 12.9716).toString());
    final userLng = double.parse((_job!['location_lng'] ?? 77.5946).toString());
    
    if (worker != null && worker['lat'] != null && worker['lng'] != null) {
      final workerLat = (worker['lat'] is num) ? worker['lat'].toDouble() : double.parse(worker['lat'].toString());
      final workerLng = (worker['lng'] is num) ? worker['lng'].toDouble() : double.parse(worker['lng'].toString());
      
      // Fit both
      final bounds = LatLngBounds(
        southwest: LatLng(
          userLat < workerLat ? userLat : workerLat,
          userLng < workerLng ? userLng : workerLng,
        ),
        northeast: LatLng(
          userLat > workerLat ? userLat : workerLat,
          userLng > workerLng ? userLng : workerLng,
        ),
      );
      _mapController!.animateCamera(CameraUpdate.newLatLngBounds(bounds, 80));
    } else {
      _mapController!.animateCamera(CameraUpdate.newLatLng(LatLng(userLat, userLng)));
    }
  }

  String _getStatusMessage() {
    if (_job == null) return "Loading...";
    final status = _job!['status'];
    switch (status) {
      case 'ACCEPTED':
        return "Partner Accepted Gig";
      case 'ON_THE_WAY':
        return "Partner is en route";
      case 'ARRIVED':
        return "Partner has Arrived!";
      case 'WORK_STARTED':
        return "Work in Progress";
      case 'COMPLETED':
        return "Work Completed";
      case 'FORCE_ARRIVAL_PENDING_CONFIRMATION':
        return "Confirm Partner Arrival";
      default:
        return "Tracking Request";
    }
  }

  int _getStatusStep() {
    if (_job == null) return 0;
    final status = _job!['status'];
    switch (status) {
      case 'ACCEPTED':
        return 0;
      case 'ON_THE_WAY':
      case 'FORCE_ARRIVAL_PENDING_CONFIRMATION':
        return 1;
      case 'ARRIVED':
      case 'WORK_STARTED':
        return 2;
      case 'COMPLETED':
        return 3;
      default:
        return 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading || _job == null) {
      return Scaffold(
        body: PremiumBackground(
          child: const Center(child: CircularProgressIndicator(color: primaryColor)),
        ),
      );
    }

    final worker = _job!['worker'];
    final userLat = double.parse((_job!['location_lat'] ?? 12.9716).toString());
    final userLng = double.parse((_job!['location_lng'] ?? 77.5946).toString());

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          "Live Tracking",
          style: GoogleFonts.outfit(fontWeight: FontWeight.w800, color: Colors.white, fontSize: 20),
        ),
        centerTitle: true,
      ),
      body: PremiumBackground(
        child: SafeArea(
          child: Column(
            children: [
              // Worker Info Card
              if (worker != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  child: GlassContainer(
                    borderRadius: 24,
                    blur: 15,
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        ImageUtils.buildProfileImage(
                          worker['photoUrl'] ?? worker['photo'], 
                          radius: 30, 
                          name: worker['name'] ?? "Partner"
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(worker['name'] ?? "Partner", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold,                      color: _textPrimary)),
                              Text(worker['category'] ?? worker['specialization'] ?? "Technician", style: GoogleFonts.inter(                    color: _textSecondary, fontSize: 13)),
                              Row(
                                children: [
                                  const Icon(Icons.star, color: Colors.amberAccent, size: 16),
                                  Text(" ${worker['rating'] ?? '4.8'}", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13,                      color: _textPrimary)),
                                  const SizedBox(width: 8),
                                  Text("(${worker['jobs_completed'] ?? worker['completed_jobs'] ?? '120+'} Jobs)", style: GoogleFonts.inter(                color: _textSecondary, fontSize: 11)),
                                ],
                              ),
                            ],
                          ),
                        ),
                        GlassIconButton(
                          icon: Icons.phone,
                          size: 20,
                          onPressed: () async {
                            final phone = worker['phone'] ?? worker['phone_number'];
                            if (phone != null) {
                              final Uri launchUri = Uri(scheme: 'tel', path: phone);
                              await launchUrl(launchUri);
                            }
                          },
                        ),
                      ],
                    ),
                  ),
                ),

              if (_job?['status'] == 'FORCE_ARRIVAL_PENDING_CONFIRMATION')
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  child: GlassContainer(
                    borderRadius: 24,
                    blur: 15,
                    color: Colors.amberAccent.withOpacity(0.18),
                    border: Border.all(color: Colors.amberAccent.withOpacity(0.3)),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.warning_amber_rounded, color: Colors.amberAccent, size: 24),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                "Partner marked arrival but seems far",
                                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.amberAccent),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          "The partner indicates they have arrived, but their current GPS coordinates are away from your destination. Please confirm if they have arrived or update your address.",
                          style: GoogleFonts.inter(                    color: _textSecondary, fontSize: 13, height: 1.4),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: GlassButton(
                                onPressed: _confirmWorkerArrival,
                                text: "Yes, Arrived",
                                isPrimary: true,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: GlassButton(
                                onPressed: _showUpdateAddressModal,
                                text: "Update Address",
                                isPrimary: false,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),

              // Map Section
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: GlassContainer(
                    borderRadius: 24,
                    blur: 12,
                    padding: EdgeInsets.zero,
                    border: Border.all(color: Colors.white.withOpacity(0.15)),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(24),
                      child: GoogleMap(
                        onMapCreated: (controller) => _mapController = controller,
                        initialCameraPosition: CameraPosition(
                          target: LatLng(userLat, userLng),
                          zoom: 14,
                        ),
                        markers: {
                          Marker(
                            markerId: const MarkerId("user"),
                            position: LatLng(userLat, userLng),
                            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
                          ),
                          if (worker != null && worker['lat'] != null && worker['lng'] != null)
                            Marker(
                              markerId: const MarkerId("worker"),
                              position: LatLng(
                                (worker['lat'] is num) ? worker['lat'].toDouble() : double.parse(worker['lat'].toString()),
                                (worker['lng'] is num) ? worker['lng'].toDouble() : double.parse(worker['lng'].toString()),
                              ),
                              icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
                            ),
                        },
                        zoomControlsEnabled: false,
                        myLocationButtonEnabled: false,
                      ),
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 20),

              // Status & Progress Section
              GlassContainer(
                borderRadius: 30,
                blur: 18,
                padding: const EdgeInsets.all(24),
                color: Colors.black.withOpacity(0.80),
                border: Border.all(color: Colors.white.withOpacity(0.15), width: 1.5),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Live status indicator
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: DynamicIslandPulse(
                        text: _getStatusMessage(),
                        icon: _getStatusStep() >= 2
                            ? Icons.check_circle
                            : _getStatusStep() >= 1
                                ? Icons.directions_walk
                                : Icons.hourglass_empty,
                        pulseColor: _getStatusStep() >= 3
                            ? Colors.greenAccent
                            : _getStatusStep() >= 1
                                ? Colors.lightBlueAccent
                                : Colors.amberAccent,
                      ),
                    ),
                    Text(
                      _getStatusMessage(),
                      style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    
                    // Progress Indicator
                    Row(
                      children: List.generate(4, (index) {
                        bool isActive = _getStatusStep() >= index;
                        return Expanded(
                          child: Row(
                            children: [
                              Container(
                                width: 24,
                                height: 24,
                                decoration: BoxDecoration(
                                  color: isActive ? successColor : Colors.white10,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: isActive ? Colors.transparent : Colors.white24,
                                  ),
                                ),
                                child: isActive 
                                    ? const Icon(Icons.check, size: 14, color: Colors.white)
                                    : Center(child: Text("${index + 1}", style: const TextStyle(fontSize: 10, color: Colors.white54))),
                              ),
                              if (index < 3)
                                Expanded(
                                  child: Container(
                                    height: 3,
                                    color: _getStatusStep() > index ? successColor : Colors.white10,
                                  ),
                                ),
                            ],
                          ),
                        );
                      }),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text("Accepted", style: GoogleFonts.inter(fontSize: 10,                 color: _textSecondary)),
                        Text("On way", style: GoogleFonts.inter(fontSize: 10,                 color: _textSecondary)),
                        Text("Working", style: GoogleFonts.inter(fontSize: 10,                 color: _textSecondary)),
                        Text("Done", style: GoogleFonts.inter(fontSize: 10,                 color: _textSecondary)),
                      ],
                    ),
                    
                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text("TOTAL PRICE", style: GoogleFonts.inter(fontSize: 11,                 color: _textSecondary, fontWeight: FontWeight.bold)),
                            Text("₹${_job!['price'] ?? "0"}", style: GoogleFonts.outfit(fontSize: 26, fontWeight: FontWeight.w900,                      color: _textPrimary)),
                          ],
                        ),
                        if (_getStatusStep() < 3)
                          TextButton(
                            onPressed: _cancelJob,
                            child: Text("Cancel Job", style: GoogleFonts.inter(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }

  void _showLateCancellationModal() {
    String? selectedReason;
    final reasons = [
      "Wrong address selected",
      "Posted by mistake",
      "Emergency situation",
      "Worker asked to cancel",
      "Duplicate booking",
      "No longer needed",
      "Found another worker",
      "Other"
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
              blur: 18,
              padding: EdgeInsets.only(
                left: 24,
                right: 24,
                top: 24,
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              margin: const EdgeInsets.all(16),
              color: Colors.black.withOpacity(0.90),
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
                      const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 28),
                      const SizedBox(width: 8),
                      Text(
                        "Worker is already on the way",
                        style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.redAccent),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  GlassContainer(
                    borderRadius: 16,
                    blur: 15,
                    padding: const EdgeInsets.all(12),
                    color: Colors.redAccent.withOpacity(0.20),
                    border: Border.all(color: Colors.redAccent.withOpacity(0.3)),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.error_outline, color: Colors.redAccent, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "Reliability Impact: -5 Points",
                                style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.redAccent, fontSize: 13),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                "Cancelling now may affect your reliability score and restrict future bookings. Banned if done thrice in a month.",
                                style: GoogleFonts.inter(color: Colors.white70, fontSize: 11, height: 1.4),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text("SELECT CANCELLATION REASON", style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white54)),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 220,
                    child: ListView(
                      children: reasons.map((r) => Theme(
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
                        await _executeLateCancellation(selectedReason!, noteController.text);
                      },
                      text: "CANCEL BOOKING (-5 PTS)",
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

  Future<void> _executeLateCancellation(String reason, String note) async {
    setState(() => _isLoading = true);
    final userId = await SharedPrefsHelper.getUserId();
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.patch(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/$userId/${_job!['id']}'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'status': 'CANCELLED',
          'reason': reason,
          'notes': note
        }),
      );
      final responseData = json.decode(response.body);
      if (response.statusCode == 200) {
        Navigator.pop(context);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(responseData['message'] ?? "Failed to cancel job.")),
        );
      }
    } catch (e) {
      debugPrint("Error cancelling job: $e");
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _cancelJob() async {
    final status = _job?['status'] ?? 'OPEN';
    final allowedStatuses = ['OPEN', 'REQUESTED', 'ACCEPTED', 'READY_TO_START', 'REDISTRIBUTING', 'REASSIGNING'];
    if (!allowedStatuses.contains(status)) {
      _showLateCancellationModal();
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: Text("Cancel Job", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white)),
        content: Text("Are you sure you want to cancel this job?", style: GoogleFonts.inter(color: Colors.white70)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text("No", style: GoogleFonts.inter(color: Colors.white54))),
          TextButton(onPressed: () => Navigator.pop(context, true), child: Text("Yes, Cancel", style: GoogleFonts.inter(color: Colors.redAccent))),
        ],
      ),
    );

    if (confirmed == true) {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();
      try {
        final response = await http.patch(
          Uri.parse('${NetworkHelper.baseUrl}/api/jobs/$userId/${_job!['id']}'),
          headers: {
            'Content-Type': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
          body: json.encode({'status': 'CANCELLED'}),
        );
        final responseData = json.decode(response.body);
        if (response.statusCode == 200) {
          Navigator.pop(context);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(responseData['message'] ?? "Failed to cancel job.")),
          );
        }
      } catch (e) {
        debugPrint("Error cancelling job: $e");
      }
    }
  }
}
