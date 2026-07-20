import 'dart:async';
import 'package:flutter/material.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../services/socket_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class IncomingJobScreen extends StatefulWidget {
  final Map<dynamic, dynamic> jobData;
  final bool playSound;

  const IncomingJobScreen({Key? key, required this.jobData, this.playSound = true}) : super(key: key);

  @override
  State<IncomingJobScreen> createState() => _IncomingJobScreenState();
}

class _IncomingJobScreenState extends State<IncomingJobScreen> with TickerProviderStateMixin {
  late AudioPlayer _audioPlayer;
  late AnimationController _pulseController;

  // Map settings
  GoogleMapController? _mapController;
  LatLng? _jobLocation;

  Function(dynamic)? _cancelListener;
  Function(dynamic)? _jobTakenListener;

  @override
  void initState() {
    super.initState();
    _initAudio();
    _initPulse();
    _initLocation();

    _cancelListener = (data) {
      if (data != null) {
        final String? cancelledJobId = (data['jobId'] ?? data['job_id'])?.toString();
        final String currentJobId = (widget.jobData['id'] ?? widget.jobData['_id'] ?? widget.jobData['jobId'] ?? widget.jobData['job_id'])?.toString() ?? "";
        if (cancelledJobId == currentJobId) {
          debugPrint("🚫 [SOCKET] Current incoming job offer was cancelled by user.");
          _audioPlayer.stop();
          if (mounted) {
            Navigator.of(context).pop({'accepted': false});
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text("The customer has cancelled this job request."),
                backgroundColor: Colors.redAccent,
              ),
            );
          }
        }
      }
    };
    SocketService().socket?.on('job_cancelled_by_user', _cancelListener!);
    SocketService().socket?.on('USER_CANCELLED_JOB', _cancelListener!);

    _jobTakenListener = (data) async {
      if (data != null) {
        final String? takenJobId = (data['jobId'] ?? data['job_id'])?.toString();
        final String? takenWorkerId = (data['workerId'] ?? data['worker_id'])?.toString();
        final String? takenWorkerPhone = (data['workerPhone'] ?? data['worker_phone'])?.toString();
        final String currentJobId = (widget.jobData['id'] ?? widget.jobData['_id'] ?? widget.jobData['jobId'] ?? widget.jobData['job_id'])?.toString() ?? "";

        final prefs = await SharedPreferences.getInstance();
        final currentPhone = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
        final currentWorkerId = prefs.getString('workerId');

        // Ignore if this event was triggered by THIS worker accepting the job
        if (takenWorkerId != null && currentWorkerId != null && takenWorkerId == currentWorkerId) return;
        if (takenWorkerPhone != null && currentPhone != null && takenWorkerPhone == currentPhone) return;

        if (takenJobId == currentJobId) {
          debugPrint("🚫 [SOCKET] Current incoming job was accepted by another worker.");
          _audioPlayer.stop();
          if (mounted) {
            Navigator.of(context).pop({'accepted': false});
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text("This gig was accepted by another worker."),
                backgroundColor: Colors.orangeAccent,
              ),
            );
          }
        }
      }
    };
    SocketService().socket?.on('job_taken', _jobTakenListener!);
  }

  void _initLocation() {
    final latVal = widget.jobData['location_lat'] ?? widget.jobData['lat'];
    final lngVal = widget.jobData['location_lng'] ?? widget.jobData['lng'];
    
    if (latVal != null && lngVal != null) {
      final double? lat = double.tryParse(latVal.toString());
      final double? lng = double.tryParse(lngVal.toString());
      if (lat != null && lng != null) {
        _jobLocation = LatLng(lat, lng);
      }
    }
  }

  Future<void> _initAudio() async {
    _audioPlayer = AudioPlayer();
    if (widget.playSound) {
      await _audioPlayer.setReleaseMode(ReleaseMode.loop);
      await _audioPlayer.play(AssetSource('sounds/new_gigs/zomato_sms.mp3'));
    }
  }

  void _initPulse() {
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _pulseController.repeat(reverse: true);
  }

  @override
  void dispose() {
    _audioPlayer.dispose();
    _pulseController.dispose();
    if (_cancelListener != null) {
      SocketService().socket?.off('job_cancelled_by_user', _cancelListener);
      SocketService().socket?.off('USER_CANCELLED_JOB', _cancelListener);
    }
    if (_jobTakenListener != null) {
      SocketService().socket?.off('job_taken', _jobTakenListener);
    }
    super.dispose();
  }

  void _acceptGig() {
    _audioPlayer.stop();
    Navigator.of(context).pop({'accepted': true});
  }

  void _declineGig() {
    _audioPlayer.stop();
    Navigator.of(context).pop({'accepted': false});
  }

  @override
  Widget build(BuildContext context) {
    final category = widget.jobData['category'] ?? "New Gig Request";
    final earnings = widget.jobData['price'] ?? widget.jobData['earnings'] ?? "0";
    final distance = widget.jobData['distance'] ?? "Nearby";
    final address = widget.jobData['address'] ?? "Customer Location";
    final pickupName = widget.jobData['customerName'] ?? widget.jobData['userName'] ?? category;

    // Use current location (worker) if available. If not, default to job location with slight offset
    LatLng workerLocation = _jobLocation ?? const LatLng(0, 0);
    // In a real app we'd have the worker's exact location. We'll use a mocked offset for demo if worker loc is missing
    if (_jobLocation != null) {
      workerLocation = LatLng(_jobLocation!.latitude - 0.005, _jobLocation!.longitude - 0.005);
    }

    return Scaffold(
      backgroundColor: const Color(0xFF151515),
      body: Stack(
        children: [
          // 1. Full Screen Google Map Background
          if (_jobLocation != null)
            Positioned.fill(
              child: GoogleMap(
                initialCameraPosition: CameraPosition(
                  target: _jobLocation!,
                  zoom: 13.5,
                ),
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                compassEnabled: false,
                mapToolbarEnabled: false,
                markers: {
                  Marker(
                    markerId: const MarkerId("job_location"),
                    position: _jobLocation!,
                    icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
                  ),
                  Marker(
                    markerId: const MarkerId("worker_location"),
                    position: workerLocation,
                    icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
                  ),
                },
                onMapCreated: (controller) => _mapController = controller,
              ),
            )
          else
            const Positioned.fill(
              child: ColoredBox(color: Color(0xFF252525)),
            ),

          // Gradient Overlay to ensure text readability
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withOpacity(0.6),
                    Colors.transparent,
                    Colors.black.withOpacity(0.7),
                    Colors.black.withOpacity(0.95),
                  ],
                  stops: const [0.0, 0.3, 0.6, 1.0],
                ),
              ),
            ),
          ),

          // 2. Top Logo & Header
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // App Logo
                  Center(
                    child: Image.asset(
                      'assets/images/logo/Nexo_partner_logo.png',
                      height: 48,
                      errorBuilder: (context, error, stackTrace) => Text(
                        "NEXO",
                        style: GoogleFonts.outfit(
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          color: Colors.white,
                          letterSpacing: 2.0,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  
                  // "New order!" Title
                  ScaleTransition(
                    scale: Tween<double>(begin: 0.95, end: 1.05).animate(
                      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
                    ),
                    child: Text(
                      "New Incoming Gig!",
                      textAlign: TextAlign.center,
                      style: GoogleFonts.outfit(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                        shadows: [
                          const Shadow(color: Colors.black54, blurRadius: 10, offset: Offset(0, 2))
                        ],
                      ),
                    ),
                  ),

                  const Spacer(),
                  
                  // 3. Expected Earnings Card
                  Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E1E1E).withOpacity(0.85),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.white24),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withOpacity(0.5), blurRadius: 10, offset: const Offset(0, 4))
                      ],
                    ),
                    child: Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16.0),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                "Expected earning: ",
                                style: GoogleFonts.outfit(
                                  fontSize: 18,
                                  color: Colors.white70,
                                ),
                              ),
                              Text(
                                "₹$earnings",
                                style: GoogleFonts.outfit(
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.greenAccent,
                                ),
                              ),
                            ],
                          ),
                        ),
                        
                        const Divider(color: Colors.white10, height: 1),
                        
                        // 4. Pickup and Drop Info
                        IntrinsicHeight(
                          child: Row(
                            children: [
                              Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 12.0),
                                  child: Column(
                                    children: [
                                      Text(
                                        "Pickup",
                                        style: GoogleFonts.outfit(color: Colors.white54, fontSize: 13),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        distance,
                                        style: GoogleFonts.outfit(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 16,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const VerticalDivider(color: Colors.white10, width: 1),
                              Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 12.0),
                                  child: Column(
                                    children: [
                                      Text(
                                        "Drop",
                                        style: GoogleFonts.outfit(color: Colors.white54, fontSize: 13),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        address.length > 22 ? "${address.substring(0, 20)}..." : address,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: GoogleFonts.outfit(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  
                  const SizedBox(height: 16),
                  
                  // 5. Pickup From / Details Box
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E1E1E).withOpacity(0.85),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.white24),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withOpacity(0.5), blurRadius: 10, offset: const Offset(0, 4))
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "JOB DETAILS",
                          style: GoogleFonts.outfit(
                            color: Colors.white54,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1.0,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          pickupName,
                          style: GoogleFonts.outfit(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          address,
                          style: GoogleFonts.outfit(
                            color: Colors.white70,
                            fontSize: 14,
                            height: 1.3,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            const Icon(Icons.access_time_filled, color: Colors.amber, size: 18),
                            const SizedBox(width: 6),
                            Text(
                              "Immediate Service Requested",
                              style: GoogleFonts.outfit(
                                color: Colors.amber,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  
                  const SizedBox(height: 24),
                  
                  // 6. Slide to Accept Button
                  SlideActionBtn(
                    onSlideSuccess: _acceptGig,
                    text: "Accept order",
                  ),
                  
                  const SizedBox(height: 12),
                  
                  // 7. Decline Button
                  TextButton(
                    onPressed: _declineGig,
                    child: Text(
                      "DECLINE",
                      style: GoogleFonts.outfit(
                        color: Colors.redAccent,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
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
  }
}

// Swipe to Accept Button Widget
class SlideActionBtn extends StatefulWidget {
  final VoidCallback onSlideSuccess;
  final String text;
  
  const SlideActionBtn({
    Key? key,
    required this.onSlideSuccess,
    required this.text,
  }) : super(key: key);

  @override
  State<SlideActionBtn> createState() => _SlideActionBtnState();
}

class _SlideActionBtnState extends State<SlideActionBtn> {
  double _dragPosition = 0.0;
  bool _isFinished = false;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final double width = constraints.maxWidth;
        final double buttonSize = 56.0;
        final double maxDrag = width - buttonSize - 8.0; // Padding included

        return Container(
          height: buttonSize + 8.0,
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: const Color(0xFF1EAF59), // Zomato green
            borderRadius: BorderRadius.circular(30),
          ),
          child: Stack(
            children: [
              // Sliding text instruction
              Center(
                child: Opacity(
                  opacity: (1.0 - (_dragPosition / maxDrag)).clamp(0.2, 1.0),
                  child: Text(
                    widget.text,
                    style: GoogleFonts.outfit(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              
              // Slider White Circle Button
              Positioned(
                left: _dragPosition,
                child: GestureDetector(
                  onHorizontalDragUpdate: (details) {
                    if (_isFinished) return;
                    setState(() {
                      _dragPosition += details.delta.dx;
                      if (_dragPosition < 0) _dragPosition = 0;
                      if (_dragPosition > maxDrag) _dragPosition = maxDrag;
                    });
                  },
                  onHorizontalDragEnd: (details) {
                    if (_isFinished) return;
                    if (_dragPosition >= maxDrag * 0.75) {
                      // Trigger callback
                      setState(() {
                        _dragPosition = maxDrag;
                        _isFinished = true;
                      });
                      widget.onSlideSuccess();
                    } else {
                      // Reset to start
                      setState(() {
                        _dragPosition = 0.0;
                      });
                    }
                  },
                  child: Container(
                    width: buttonSize,
                    height: buttonSize,
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black26,
                          blurRadius: 4,
                          offset: Offset(0, 2),
                        )
                      ],
                    ),
                    child: const Center(
                      child: Icon(
                        Icons.double_arrow,
                        color: Color(0xFF1EAF59),
                        size: 24,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
