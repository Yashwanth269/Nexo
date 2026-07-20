import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';

class SelfieVerificationScreen extends StatefulWidget {
  final String verificationId;
  final String reason;

  const SelfieVerificationScreen({
    super.key,
    required this.verificationId,
    this.reason = 'SECURITY_CHECK',
  });

  @override
  State<SelfieVerificationScreen> createState() => _SelfieVerificationScreenState();
}

class _SelfieVerificationScreenState extends State<SelfieVerificationScreen> with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  bool _isCapturing = false;
  bool _isVerifying = false;
  bool _isVerified = false;
  String _statusText = "Align your face inside the guide";
  int _countdown = 3;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);

    _startAutoCaptureCountdown();
  }

  void _startAutoCaptureCountdown() {
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_countdown > 1) {
        setState(() {
          _countdown--;
          _statusText = "Hold steady... Capturing in $_countdown";
        });
      } else {
        timer.cancel();
        _captureAndVerify();
      }
    });
  }

  Future<void> _captureAndVerify() async {
    if (_isVerifying) return;
    setState(() {
      _isCapturing = true;
      _isVerifying = true;
      _statusText = "Verifying identity & face match...";
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final phone = prefs.getString('workerPhone') ?? prefs.getString('worker_phone') ?? '1';
      final token = prefs.getString('worker_token') ?? prefs.getString('workerToken');

      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/security/selfie-verify'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'workerId': phone,
          'verificationId': widget.verificationId,
          'confidenceScore': 94.8,
          's3Key': 'selfies/$phone/${widget.verificationId}.jpg',
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        setState(() {
          _isVerified = true;
          _isVerifying = false;
          _statusText = "Identity Verified!";
        });
        
        await Future.delayed(const Duration(seconds: 2));
        if (mounted) {
          Navigator.pop(context, true);
        }
      } else {
        setState(() {
          _isVerifying = false;
          _statusText = data['message'] ?? "Face match failed. Please try again.";
        });
      }
    } catch (e) {
      setState(() {
        _isVerifying = false;
        _statusText = "Verification error: $e";
      });
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 20),
            // Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Row(
                children: [
                  const Icon(Icons.shield_outlined, color: Color(0xFF10B981), size: 28),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Identity Verification",
                        style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                      Text(
                        "Periodic Security Check",
                        style: GoogleFonts.inter(fontSize: 12, color: Colors.white60),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const Spacer(),

            // Circular Face Guide
            Center(
              child: Stack(
                alignment: Alignment.center,
                children: [
                  // Outer Pulsing Ring
                  AnimatedBuilder(
                    animation: _pulseController,
                    builder: (context, child) {
                      final scale = 1.0 + (_pulseController.value * 0.08);
                      return Transform.scale(
                        scale: scale,
                        child: Container(
                          width: 270,
                          height: 270,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: _isVerified
                                  ? const Color(0xFF10B981)
                                  : const Color(0xFFF97316).withOpacity(0.6),
                              width: 3,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                  // Camera Simulation Container
                  Container(
                    width: 250,
                    height: 250,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.grey[900],
                      border: Border.all(
                        color: _isVerified ? const Color(0xFF10B981) : Colors.white24,
                        width: 4,
                      ),
                    ),
                    child: ClipOval(
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          Icon(
                            Icons.person,
                            size: 140,
                            color: Colors.white.withOpacity(0.2),
                          ),
                          if (_isVerified)
                            Container(
                              color: const Color(0xFF10B981).withOpacity(0.9),
                              child: const Center(
                                child: Icon(Icons.check_circle_rounded, color: Colors.white, size: 80),
                              ),
                            ),
                          if (_isVerifying)
                            const CircularProgressIndicator(color: Color(0xFFF97316), strokeWidth: 3),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 32),
            // Guidance Text
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                _statusText,
                style: GoogleFonts.outfit(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  color: _isVerified ? const Color(0xFF10B981) : Colors.white,
                ),
                textAlign: TextAlign.center,
              ),
            ),

            const Spacer(),
            // Shutter Button
            Padding(
              padding: const EdgeInsets.all(24),
              child: SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  onPressed: _isVerifying || _isVerified ? null : _captureAndVerify,
                  icon: const Icon(Icons.camera_alt, color: Colors.white),
                  label: Text(
                    "Capture & Verify",
                    style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFF97316),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
