import 'dart:async';
import 'package:flutter/material.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../services/socket_service.dart';

class IncomingJobScreen extends StatefulWidget {
  final Map<dynamic, dynamic> jobData;

  const IncomingJobScreen({Key? key, required this.jobData}) : super(key: key);

  @override
  State<IncomingJobScreen> createState() => _IncomingJobScreenState();
}

class _IncomingJobScreenState extends State<IncomingJobScreen> with TickerProviderStateMixin {
  late AudioPlayer _audioPlayer;
  late AnimationController _timerController;
  int _secondsLeft = 30;
  Timer? _countdownTimer;

  // Map settings
  GoogleMapController? _mapController;
  LatLng? _jobLocation;

  @override
  void initState() {
    super.initState();
    _initAudio();
    _initTimer();
    _initLocation();
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
    await _audioPlayer.setReleaseMode(ReleaseMode.loop);
    await _audioPlayer.play(AssetSource('sounds/new_gigs/zomato_sms.mp3'));
  }

  void _initTimer() {
    _timerController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 30),
    );
    
    _timerController.reverse(from: 1.0);

    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() {
        if (_secondsLeft > 0) {
          _secondsLeft--;
        } else {
          _countdownTimer?.cancel();
          _declineGig(); // Auto decline when timer runs out
        }
      });
    });
  }

  @override
  void dispose() {
    _audioPlayer.dispose();
    _timerController.dispose();
    _countdownTimer?.cancel();
    super.dispose();
  }

  void _acceptGig() {
    _audioPlayer.stop();
    _countdownTimer?.cancel();
    
    final String offerId = widget.jobData['offerId']?.toString() ?? 
                           widget.jobData['id']?.toString() ?? 
                           widget.jobData['_id']?.toString() ?? "";
                           
    SocketService().socket?.emit('accept_job', {'offerId': offerId});
    Navigator.of(context).pop({'accepted': true});
  }

  void _declineGig() {
    _audioPlayer.stop();
    _countdownTimer?.cancel();
    
    final String offerId = widget.jobData['offerId']?.toString() ?? 
                           widget.jobData['id']?.toString() ?? 
                           widget.jobData['_id']?.toString() ?? "";
                           
    SocketService().socket?.emit('decline_job', {'offerId': offerId});
    Navigator.of(context).pop({'accepted': false});
  }

  @override
  Widget build(BuildContext context) {
    final category = widget.jobData['category'] ?? "New Gig Request";
    final earnings = widget.jobData['price'] ?? widget.jobData['earnings'] ?? "0";
    final distance = widget.jobData['distance'] ?? "Nearby";
    final address = widget.jobData['address'] ?? "Customer Location";

    // Split category into readable titles
    final pickupName = widget.jobData['customerName'] ?? widget.jobData['userName'] ?? category;

    return Scaffold(
      backgroundColor: const Color(0xFF151515),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 20),
              
              // 1. Circular Map with countdown border
              Center(
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // Outer Blue Progress Border (Timer)
                    SizedBox(
                      width: 170,
                      height: 170,
                      child: AnimatedBuilder(
                        animation: _timerController,
                        builder: (context, child) {
                          return CircularProgressIndicator(
                            value: _timerController.value,
                            strokeWidth: 6.0,
                            backgroundColor: Colors.white24,
                            valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF3B82F6)),
                          );
                        },
                      ),
                    ),
                    // Circular Map View
                    Container(
                      width: 154,
                      height: 154,
                      decoration: BoxDecoration(
                        color: const Color(0xFF252525),
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFF151515), width: 4),
                      ),
                      child: ClipOval(
                        child: _jobLocation != null
                            ? IgnorePointer(
                                child: GoogleMap(
                                  initialCameraPosition: CameraPosition(
                                    target: _jobLocation!,
                                    zoom: 15.0,
                                  ),
                                  myLocationButtonEnabled: false,
                                  zoomControlsEnabled: false,
                                  compassEnabled: false,
                                  mapToolbarEnabled: false,
                                  circles: {
                                    Circle(
                                      circleId: const CircleId("job_location"),
                                      center: _jobLocation!,
                                      radius: 100,
                                      fillColor: const Color(0xFF3B82F6).withOpacity(0.3),
                                      strokeColor: const Color(0xFF3B82F6),
                                      strokeWidth: 2,
                                    ),
                                  },
                                  onMapCreated: (controller) => _mapController = controller,
                                ),
                              )
                            : const Center(
                                child: Icon(
                                  Icons.location_on,
                                  color: Color(0xFF3B82F6),
                                  size: 48,
                                ),
                              ),
                      ),
                    ),
                    // Seconds badge
                    Positioned(
                      bottom: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF3B82F6),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          "${_secondsLeft}s",
                          style: GoogleFonts.outfit(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              
              const SizedBox(height: 32),
              
              // 2. "New order!" Title
              Text(
                "New order!",
                textAlign: TextAlign.center,
                style: GoogleFonts.outfit(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              
              const SizedBox(height: 24),
              
              // 3. Expected Earnings Card
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF222222),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white10),
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
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
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
                                    "Customer Location",
                                    style: GoogleFonts.outfit(
                                      color: Colors.white,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 15,
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
              
              const SizedBox(height: 20),
              
              // 5. Pickup From / Details Box
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: const Color(0xFF222222),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white10),
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
              
              const Spacer(),
              
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
