import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../utils/network_helper.dart';

class ConnectionMonitorOverlay extends StatefulWidget {
  final String workerId;
  final String jobId;
  final Widget child;

  const ConnectionMonitorOverlay({
    super.key,
    required this.workerId,
    required this.jobId,
    required this.child,
  });

  @override
  State<ConnectionMonitorOverlay> createState() => _ConnectionMonitorOverlayState();
}

class _ConnectionMonitorOverlayState extends State<ConnectionMonitorOverlay> {
  bool _isOnline = true;
  bool _isReconnecting = false;
  Timer? _heartbeatTimer;

  @override
  void initState() {
    super.initState();
    _startHeartbeat();
  }

  void _startHeartbeat() {
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 10), (timer) {
      _sendHeartbeat();
    });
  }

  Future<void> _sendHeartbeat() async {
    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/monitoring/heartbeat'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'workerId': widget.workerId,
          'jobId': widget.jobId,
        }),
      ).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        if (!_isOnline) setState(() => _isOnline = true);
        if (_isReconnecting) setState(() => _isReconnecting = false);
      } else {
        _handleFailure();
      }
    } catch (e) {
      _handleFailure();
    }
  }

  void _handleFailure() {
    setState(() {
      _isOnline = false;
      _isReconnecting = true;
    });
  }

  @override
  void dispose() {
    _heartbeatTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (!_isOnline) _buildConnectionErrorState(),
      ],
    );
  }

  Widget _buildConnectionErrorState() {
    return Container(
      color: Colors.white,
      width: double.infinity,
      height: double.infinity,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(color: const Color(0xFFFFF7ED), shape: BoxShape.circle),
            child: const Icon(Icons.wifi_off_outlined, color: Color(0xFFFF6A00), size: 64),
          ),
          const SizedBox(height: 32),
          Text(_isReconnecting ? "Reconnecting..." : "Connection Lost", style: GoogleFonts.outfit(fontSize: 28, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Text(
              "We're having trouble reaching the system. Please check your network to continue your active job.",
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: Colors.black45, height: 1.5),
            ),
          ),
          const SizedBox(height: 48),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              children: [
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton.icon(
                    onPressed: _sendHeartbeat,
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF6A00), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                    icon: const Icon(Icons.refresh, color: Colors.white),
                    label: Text("Retry Now", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: OutlinedButton.icon(
                    onPressed: () {}, // Implementation for native dialer
                    style: OutlinedButton.styleFrom(side: const BorderSide(color: Color(0xFF1E3A8A)), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                    icon: const Icon(Icons.phone, color: Color(0xFF1E3A8A)),
                    label: Text("Call User", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: const Color(0xFF1E3A8A))),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.help_outline, size: 16, color: Colors.black26),
              const SizedBox(width: 8),
              Text("Need help? Visit Support", style: GoogleFonts.inter(fontSize: 12, color: Colors.black26)),
            ],
          ),
        ],
      ),
    );
  }
}
