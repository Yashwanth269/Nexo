import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:nexo/screens/report_worker_screen.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class JobDetailsScreen extends StatefulWidget {
  final String jobId;
  // Support both passing ID or full Job object for fast initial load
  final Map<String, dynamic>? initialJob;

  const JobDetailsScreen({super.key, required this.jobId, this.initialJob});

  @override
  State<JobDetailsScreen> createState() => _JobDetailsScreenState();
}

class _JobDetailsScreenState extends State<JobDetailsScreen> {
  Map<String, dynamic>? _job;
  bool _isLoading = true;
  Timer? _refreshTimer;
  GoogleMapController? _mapController;
  LatLng? _workerLocation;
  Set<Marker> _markers = {};
  Set<Polyline> _polylines = {};

  @override
  void initState() {
    super.initState();
    _job = widget.initialJob;
    if (_job != null) {
      _isLoading = false;
      if (_job!['worker_lat'] != null || _job!['location_lat_worker'] != null) {
        _workerLocation = LatLng(
          double.parse((_job!['worker_lat'] ?? _job!['location_lat_worker']).toString()),
          double.parse((_job!['worker_lng'] ?? _job!['location_lng_worker']).toString())
        );
      }
      _updateMarkers();
    }
    _fetchDetails();
    _initSocket();
    _refreshTimer = Timer.periodic(const Duration(seconds: 10), (_) => _fetchDetails());
  }

  void _initSocket() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId == null) return;
    
    final socketService = SocketService();
    socketService.connect(userId);
    
    socketService.socket?.on('job_status_updated', (data) {
      if (data['jobId'].toString() == widget.jobId && mounted) {
        debugPrint("🚀 [DETAILS] Status updated via socket: ${data['status']}");
        _fetchDetails();
      }
    });

    socketService.socket?.on('JOB_ACCEPTED', (data) {
      if ((data['jobId']?.toString() == widget.jobId || data['job_id']?.toString() == widget.jobId) && mounted) {
        debugPrint("🚀 [DETAILS] Status updated via socket: JOB_ACCEPTED");
        _fetchDetails();
      }
    });

    socketService.socket?.on('job_cancelled_by_user', (data) {
      if (data['jobId']?.toString() == widget.jobId && mounted) {
        debugPrint("🚀 [DETAILS] Status updated via socket: CANCELLED BY USER");
        _fetchDetails();
      }
    });

    socketService.socket?.on('WORKER_CANCELLED_JOB', (data) {
      if (data['jobId']?.toString() == widget.jobId && mounted) {
        debugPrint("🚀 [DETAILS] Status updated via socket: CANCELLED BY WORKER");
        _fetchDetails();
      }
    });

    socketService.socket?.on('WORKER_DECLINED_JOB', (data) {
      if (mounted) {
        debugPrint("🚀 [DETAILS] Status updated via socket: WORKER DECLINED JOB");
        _fetchDetails();
      }
    });

    socketService.socket?.on('JOB_REDISTRIBUTED', (data) {
      if (mounted) {
        debugPrint("🚀 [DETAILS] Status updated via socket: JOB REDISTRIBUTED");
        _fetchDetails();
      }
    });

    socketService.socket?.on('worker_location_update', (data) {
      if (data['jobId']?.toString() == widget.jobId && mounted) {
        setState(() {
          _workerLocation = LatLng(
            double.parse(data['lat'].toString()), 
            double.parse(data['lng'].toString())
          );
          if (_job != null) {
            _job!['route_polyline'] = data['polyline'];
            _job!['route_distance'] = data['distanceMeters'];
            _job!['route_duration'] = data['duration'];
            _job!['distance'] = data['distance'];
            _job!['eta'] = data['eta'];
          }
          _updateMarkers();
        });
        if (_mapController != null) {
          _mapController!.animateCamera(CameraUpdate.newLatLng(_workerLocation!));
        }
      }
    });
  }

  List<LatLng> _decodePolyline(String encoded) {
    List<LatLng> points = [];
    int index = 0, len = encoded.length;
    int lat = 0, lng = 0;
    while (index < len) {
      int b, shift = 0, result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      int dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      int dlng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
      lng += dlng;
      points.add(LatLng(lat / 1E5, lng / 1E5));
    }
    return points;
  }

  Future<void> _fitBounds() async {
    if (_markers.isEmpty || _mapController == null) return;
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      if (_markers.length == 1) {
        _mapController!.animateCamera(CameraUpdate.newLatLngZoom(_markers.first.position, 14));
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
        _mapController!.animateCamera(CameraUpdate.newLatLngBounds(bounds, 50));
      }
    } catch (e) {
      debugPrint("FitBounds error: $e");
    }
  }

  void _updateMarkers() {
    if (_job == null) return;
    
    final destLat = double.parse((_job!['location_lat'] ?? _job!['location']?['lat'] ?? 0).toString());
    final destLng = double.parse((_job!['location_lng'] ?? _job!['location']?['lng'] ?? 0).toString());
    
    Set<Marker> newMarkers = {
      Marker(
        markerId: const MarkerId('destination'),
        position: LatLng(destLat, destLng),
        infoWindow: const InfoWindow(title: 'Service Location'),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
      ),
    };

    if (_workerLocation != null || (['ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS'].contains(_job!['status']) && (_job!['worker_lat'] != null || _job!['location_lat_worker'] != null))) {
      final wLat = _workerLocation?.latitude ?? double.parse((_job!['worker_lat'] ?? _job!['location_lat_worker'] ?? 0).toString());
      final wLng = _workerLocation?.longitude ?? double.parse((_job!['worker_lng'] ?? _job!['location_lng_worker'] ?? 0).toString());
      
      if (wLat != 0 && wLng != 0) {
        newMarkers.add(
          Marker(
            markerId: const MarkerId('worker'),
            position: LatLng(wLat, wLng),
            infoWindow: const InfoWindow(title: 'Worker Location'),
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
          ),
        );
      }
    }

    final polylineStr = _job!['route_polyline'] ?? _job!['polyline'];
    if (polylineStr != null && polylineStr.toString().isNotEmpty) {
      final points = _decodePolyline(polylineStr.toString());
      setState(() {
        _polylines = {
          Polyline(
            polylineId: const PolylineId('route'),
            points: points,
            color: const Color(0xFFFF6A00),
            width: 5,
          ),
        };
      });
    } else {
      setState(() {
        _polylines = {};
      });
    }

    setState(() {
      _markers = newMarkers;
    });
    
    _fitBounds();
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _mapController?.dispose();
    final socketService = SocketService();
    socketService.socket?.off('job_status_updated');
    socketService.socket?.off('worker_location_update');
    super.dispose();
  }

  Future<void> _fetchDetails() async {
    final userId = await SharedPrefsHelper.getUserId();
    if (userId == null) return;
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/$userId/${widget.jobId}'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          setState(() {
            _job = data['job'];
            _isLoading = false;
            if (_job != null && (_job!['worker_lat'] != null || _job!['location_lat_worker'] != null)) {
              _workerLocation = LatLng(
                double.parse((_job!['worker_lat'] ?? _job!['location_lat_worker']).toString()),
                double.parse((_job!['worker_lng'] ?? _job!['location_lng_worker']).toString())
              );
            }
            _updateMarkers();
          });
        }
      }
    } catch (e) {
      debugPrint("Error fetching job details: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading && _job == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_job == null) {
      return const Scaffold(body: Center(child: Text("Job not found")));
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.black87),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text("Job Details", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.black87)),
        actions: [
          if (_job!['worker'] != null)
            IconButton(
              icon: const Icon(Icons.report_problem_outlined, color: Color(0xFFDC2626)),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => ReportWorkerScreen(
                      worker: _job!['worker'],
                      jobId: _job!['id'],
                    ),
                  ),
                );
              },
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _buildJobHeader(),
            const SizedBox(height: 16),
            _buildStatusCard(),
            
            // Map / Address Card (Conditional based on trip status)
            const SizedBox(height: 16),
            _buildMapAddressCard(),

            if (_job!['worker'] != null && _job!['status'] != 'CANCELLED') ...[
              const SizedBox(height: 16),
              _buildWorkerCard(),
            ],
            
            const SizedBox(height: 16),
            _buildTimeline(),
            
            if (_job!['status'] == 'COMPLETED') ...[
              const SizedBox(height: 16),
              _buildPaymentCard(),
            ],
            
            const SizedBox(height: 32),
            if (['REQUESTED', 'ACCEPTED', 'ON_THE_WAY'].contains(_job!['status']))
              TextButton(
                onPressed: _cancelJob,
                child: Text("Cancel Job", style: GoogleFonts.inter(color: Colors.red, fontWeight: FontWeight.w600)),
              ),
            const SizedBox(height: 40),
          ],
        ),
      ),
      bottomNavigationBar: _job!['worker'] != null && _job!['status'] != 'COMPLETED' ? _buildBottomAction() : null,
    );
  }

  Widget _buildJobHeader() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: const Color(0xFFFF6A00).withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                        child: Text(
                          "TASK-${(_job!['id'] ?? _job!['job_id'] ?? "000000").toString().substring(0, 6).toUpperCase()}",
                          style: GoogleFonts.inter(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold, fontSize: 10),
                        ),
                      ),
                    const SizedBox(height: 8),
                    Text(_job!['category'], style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFFFFF7F2), borderRadius: BorderRadius.circular(20)),
                child: Text("Service", style: GoogleFonts.inter(color: const Color(0xFFFF6A00), fontSize: 12, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(_job!['description'], style: GoogleFonts.inter(color: Colors.black54, fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildStatusCard() {
    final status = _job!['status'];
    // Strict backend chain: ACCEPTED -> ON_THE_WAY -> ARRIVED -> WORK_IN_PROGRESS -> COMPLETED
    final steps = ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'WORK_IN_PROGRESS', 'COMPLETED'];
    final currentIdx = steps.indexOf(status);

    if (['OPEN', 'REDISTRIBUTING', 'REASSIGNING'].contains(status)) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF7ED), 
          borderRadius: BorderRadius.circular(20), 
          border: Border.all(color: const Color(0xFFFFD8A8))
        ),
        child: Row(
          children: [
            const SizedBox(
              width: 24, 
              height: 24, 
              child: CircularProgressIndicator(color: Color(0xFFFF6A00), strokeWidth: 2.5)
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Searching Nearby Workers", style: GoogleFonts.outfit(color: const Color(0xFFC2410C), fontWeight: FontWeight.bold, fontSize: 16)),
                  Text("Finding another partner nearby...", style: GoogleFonts.inter(color: const Color(0xFF9A3412), fontSize: 12)),
                ],
              ),
            ),
          ],
        ),
      );
    }

    if (status == 'CANCELLED') {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.red[100]!)),
        child: Row(
          children: [
            const Icon(Icons.cancel, color: Colors.red),
            const SizedBox(width: 12),
            Text("Job Cancelled", style: GoogleFonts.outfit(color: Colors.red[900], fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10)]),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: const Color(0xFFFF6A00).withOpacity(0.1), shape: BoxShape.circle),
                child: const Icon(Icons.sync, color: Color(0xFFFF6A00), size: 20),
              ),
              const SizedBox(width: 16),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Current Status", style: GoogleFonts.inter(color: Colors.black54, fontSize: 13)),
                  Text(_getStatusText(status), style: GoogleFonts.outfit(color: const Color(0xFFFF6A00), fontSize: 16, fontWeight: FontWeight.bold)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(steps.length, (index) {
              bool isDone = index < currentIdx || status == 'COMPLETED';
              bool isCurrent = index == currentIdx;
              return Expanded(
                child: Row(
                  children: [
                    Container(
                      width: 14,
                      height: 14,
                      decoration: BoxDecoration(
                        color: isDone ? const Color(0xFFFF6A00) : (isCurrent ? const Color(0xFFFF6A00) : Colors.grey[200]),
                        shape: BoxShape.circle,
                        border: isCurrent ? Border.all(color: const Color(0xFFFF6A00).withOpacity(0.2), width: 4) : null,
                      ),
                    ),
                    if (index < steps.length - 1)
                      Expanded(
                        child: Container(
                          height: 2,
                          color: index < currentIdx ? const Color(0xFFFF6A00) : Colors.grey[200],
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
              _stepLabel("Accepted", 0 <= currentIdx),
              _stepLabel("On Way", 1 <= currentIdx),
              _stepLabel("Arrived", 2 <= currentIdx),
              _stepLabel("Started", 3 <= currentIdx),
              _stepLabel("Done", 4 <= currentIdx),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stepLabel(String text, bool active) {
    return Expanded(child: Text(text, textAlign: TextAlign.center, style: GoogleFonts.inter(fontSize: 9, color: active ? Colors.black87 : Colors.grey[400], fontWeight: active ? FontWeight.bold : FontWeight.normal)));
  }

  Widget _buildWorkerCard() {
    final worker = _job!['worker'];
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
      child: Row(
        children: [
          ImageUtils.buildProfileImage(worker['photoUrl'], radius: 28, name: worker['name']),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(worker['name'], style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold)),
                Row(
                  children: [
                    const Icon(Icons.star, color: Colors.orange, size: 14),
                    const SizedBox(width: 4),
                    Text("${worker['rating']} (${worker['reviews']} reviews)", style: GoogleFonts.inter(color: Colors.black54, fontSize: 12)),
                  ],
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: const Color(0xFFE0E7FF), borderRadius: BorderRadius.circular(12)),
            child: const Icon(Icons.chat_bubble_outline, color: Color(0xFF5D78FF), size: 20),
          ),
        ],
      ),
    );
  }

  Widget _buildEtaDistanceRow() {
    if (_job == null) return const SizedBox.shrink();

    String distanceStr = "-- km";
    String etaStr = "-- mins";

    if (_job!['distance'] != null) {
      distanceStr = _job!['distance'].toString();
    } else if (_job!['route_distance'] != null) {
      final double meters = double.parse(_job!['route_distance'].toString());
      final double km = meters / 1000;
      distanceStr = km < 1 ? "${meters.round()} m" : "${km.toStringAsFixed(1)} km";
    }

    if (_job!['eta'] != null) {
      etaStr = _job!['eta'].toString();
    } else if (_job!['route_duration'] != null) {
      final int duration = int.parse(_job!['route_duration'].toString());
      etaStr = "${(duration / 60).round()} mins";
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFF6A00).withOpacity(0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFF6A00).withOpacity(0.15)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          Row(
            children: [
              const Icon(Icons.directions_car_outlined, color: Color(0xFFFF6A00), size: 20),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Distance", style: GoogleFonts.inter(fontSize: 11, color: Colors.black54)),
                  Text(distanceStr, style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.black87)),
                ],
              ),
            ],
          ),
          Container(height: 24, width: 1, color: const Color(0xFFFF6A00).withOpacity(0.2)),
          Row(
            children: [
              const Icon(Icons.access_time, color: Color(0xFFFF6A00), size: 20),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Estimated Time", style: GoogleFonts.inter(fontSize: 11, color: Colors.black54)),
                  Text(etaStr, style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.black87)),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMapAddressCard() {
    final destLat = double.parse((_job!['location_lat'] ?? _job!['location']?['lat'] ?? 12.9716).toString());
    final destLng = double.parse((_job!['location_lng'] ?? _job!['location']?['lng'] ?? 77.5946).toString());

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10)]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.location_on_outlined, color: Color(0xFFB45309), size: 20),
              const SizedBox(width: 12),
              Expanded(child: Text(_job!['address'] ?? _job!['location']?['address'] ?? "Service Location", style: GoogleFonts.outfit(fontSize: 15, fontWeight: FontWeight.w600))),
            ],
          ),
          if (['ACCEPTED', 'ON_THE_WAY'].contains(_job!['status'])) ...[
            const SizedBox(height: 12),
            _buildEtaDistanceRow(),
          ],
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              height: 180,
              width: double.infinity,
              child: GoogleMap(
                initialCameraPosition: CameraPosition(target: LatLng(destLat, destLng), zoom: 14),
                markers: _markers,
                polylines: _polylines,
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                mapType: MapType.normal,
                onMapCreated: (controller) {
                  _mapController = controller;
                  _fitBounds();
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTimeline() {
    final List timeline = _job!['timeline'] ?? [];
    if (timeline.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Job Timeline", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          ...List.generate(timeline.length, (index) {
            final event = timeline[index];
            bool isLast = index == timeline.length - 1;
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Column(
                  children: [
                    Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(color: isLast ? const Color(0xFFFF6A00) : Colors.grey[300], shape: BoxShape.circle),
                    ),
                    if (!isLast) Container(width: 2, height: 30, color: Colors.grey[200]),
                  ],
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(event['title'], style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 14, color: isLast ? Colors.black87 : Colors.black45)),
                      Text(DateFormat('hh:mm a, dd MMM').format(DateTime.parse(event['timestamp'])), style: GoogleFonts.inter(color: Colors.black45, fontSize: 11)),
                      const SizedBox(height: 16),
                    ],
                  ),
                ),
              ],
            );
          }),
        ],
      ),
    );
  }

  Widget _buildPaymentCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: const Color(0xFFFFF7F2), borderRadius: BorderRadius.circular(20), border: Border.all(color: const Color(0xFFFFE4D1))),
      child: Column(
        children: [
          Text("Final Amount", style: GoogleFonts.inter(color: Colors.black54, fontSize: 14)),
          const SizedBox(height: 4),
          Text("Total Price: ₹${_job!['price'] ?? "0"}", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00))),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(color: const Color(0xFFDBEAFE), borderRadius: BorderRadius.circular(12)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.account_balance_wallet_outlined, size: 16, color: Color(0xFF1E40AF)),
                const SizedBox(width: 8),
                Text("Pay on completion", style: GoogleFonts.inter(color: Color(0xFF1E40AF), fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomAction() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(color: Colors.white, boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 10, offset: Offset(0, -5))]),
      child: SafeArea(
        child: SizedBox(
          width: double.infinity,
          height: 56,
          child: ElevatedButton.icon(
            onPressed: () => launchUrl(Uri.parse("tel:${_job!['worker']['phoneNumber']}")),
            icon: const Icon(Icons.call, color: Colors.white),
            label: Text("Call Worker", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF6A00), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), elevation: 0),
          ),
        ),
      ),
    );
  }

  String _getStatusText(String status) {
    switch (status) {
      case 'ACCEPTED': return 'Worker Assigned';
      case 'ON_THE_WAY': return 'Worker on the way';
      case 'ARRIVED': return 'Worker Arrived';
      case 'WORK_IN_PROGRESS': return 'Work in progress';
      case 'COMPLETED': return 'Completed';
      case 'CANCELLED': return 'Cancelled';
      default: return status.replaceAll('_', ' ');
    }
  }

  Future<void> _cancelJob() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text("Cancel Request", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
        content: const Text("Are you sure you want to cancel this request?"),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("No")),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text("Yes, Cancel", style: TextStyle(color: Colors.red))),
        ],
      ),
    );

    if (confirmed == true) {
      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();
      final response = await http.patch(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/$userId/${widget.jobId}'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({'status': 'CANCELLED'}),
      );
      if (response.statusCode == 200) {
        _fetchDetails();
      }
    }
  }
}
