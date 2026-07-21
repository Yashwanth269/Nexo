import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nexo_partner/utils/network_helper.dart';
import '../profile/profile_setup_screen.dart';
import '../home/home_screen.dart';
import '../../components/glass_components.dart';

class OtpScreen extends StatefulWidget {
  final String phoneNumber;
  const OtpScreen({super.key, required this.phoneNumber});

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final List<TextEditingController> _controllers = List.generate(6, (index) => TextEditingController());
  final List<FocusNode> _otpFocusNodes = [];
  bool _isLoading = false;
  final String baseUrl = NetworkHelper.baseUrl;
  
  // Timer Logic
  int _resendTimer = 60;
  Timer? _timer;
  bool _canResend = false;

  @override
  void initState() {
    super.initState();
    _startTimer();
    for (int i = 0; i < 6; i++) {
      final node = FocusNode(
        onKeyEvent: (node, event) {
          if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.backspace) {
            if (_controllers[i].text.isEmpty && i > 0) {
              _otpFocusNodes[i - 1].requestFocus();
              return KeyEventResult.handled;
            }
          }
          return KeyEventResult.ignored;
        },
      );
      node.addListener(() {
        if (mounted) setState(() {});
      });
      _otpFocusNodes.add(node);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (var node in _otpFocusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  void _startTimer() {
    _canResend = false;
    _resendTimer = 60;
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_resendTimer == 0) {
        setState(() {
          _canResend = true;
          timer.cancel();
        });
      } else {
        setState(() => _resendTimer--);
      }
    });
  }

  Future<void> _resendOtp() async {
    if (!_canResend) return;
    
    setState(() => _isLoading = true);
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/worker/auth/send-otp'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'phoneNumber': widget.phoneNumber}),
      ).timeout(const Duration(seconds: 30));
      final data = json.decode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        _startTimer();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: const Color(0xFF10B981),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              content: Text(
                "OTP Resent Successfully!",
                style: GoogleFonts.inter(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: Colors.redAccent,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              content: Row(
                children: [
                  const Icon(Icons.error_outline_rounded, color: Colors.white, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      data['message'] ?? data['error'] ?? "Failed to resend OTP",
                      style: GoogleFonts.inter(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }
      }
    } catch (e) {
      debugPrint("Resend Error: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            content: Text(
              "Connection error. Is the server running?",
              style: GoogleFonts.inter(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _verifyOtp() async {
    String otp = _controllers.map((c) => c.text).join();
    if (otp.length < 6) return;

    setState(() => _isLoading = true);
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/worker/auth/verify-otp'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'phoneNumber': widget.phoneNumber, 'otp': otp}),
      ).timeout(const Duration(seconds: 30));

      debugPrint("Verify Status: ${response.statusCode}");
      debugPrint("Verify Body: ${response.body}");

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('worker_token', data['token']);
        await prefs.setString('workerPhone', widget.phoneNumber);
        if (data['workerId'] != null) await prefs.setString('workerId', data['workerId']);
        if (data['workerName'] != null) await prefs.setString('workerName', data['workerName']);
        if (data['workerPhoto'] != null) await prefs.setString('workerPhoto', data['workerPhoto']);

        if (mounted) {
          bool isComplete = data['isProfileComplete'] ?? false;
          await prefs.setBool('isProfileComplete', isComplete);
          debugPrint("Is Profile Complete: $isComplete");
          
          if (isComplete) {
            Navigator.pushAndRemoveUntil(
              context,
              MaterialPageRoute(builder: (context) => const HomeScreen()),
              (route) => false,
            );
          } else {
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(
                builder: (context) => ProfileSetupScreen(phoneNumber: widget.phoneNumber),
              ),
            );
          }
        }
      } else {
        if (mounted) {
          final errData = json.decode(response.body);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: Colors.redAccent,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              content: Row(
                children: [
                  const Icon(Icons.error_outline_rounded, color: Colors.white, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      errData['message'] ?? errData['error'] ?? "Invalid OTP Code",
                      style: GoogleFonts.inter(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }
      }
    } catch (e) {
      debugPrint("Verify Error: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            content: Text(
              "Network Error: Could not connect to server ($e)",
              style: GoogleFonts.inter(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Widget _buildOtpBox(int index) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: 44,
      height: 54,
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: _otpFocusNodes[index].hasFocus ? const Color(0xFF0D9488) : const Color(0xFFE2E8F0),
          width: 1.5,
        ),
      ),
      child: Center(
        child: TextField(
          controller: _controllers[index],
          focusNode: _otpFocusNodes[index],
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          maxLength: 1,
          style: GoogleFonts.inter(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF0F172A),
          ),
          decoration: const InputDecoration(counterText: "", border: InputBorder.none),
          onChanged: (value) {
            if (value.isNotEmpty && index < 5) {
              _otpFocusNodes[index + 1].requestFocus();
            }
            if (value.isEmpty && index > 0) {
              _otpFocusNodes[index - 1].requestFocus();
            }
          },
        ),
      ),
    );
  }

  Widget _buildSafetyBanner() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GlassContainer(
      borderRadius: 20,
      blur: 12,
      padding: const EdgeInsets.all(16),
      color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03),
      border: Border.all(
        color: isDark ? Colors.white.withOpacity(0.1) : Colors.black.withOpacity(0.05),
        width: 1,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Safety First", 
                  style: GoogleFonts.outfit(
                    fontWeight: FontWeight.bold, 
                    color: isDark ? Colors.white : Colors.black87
                  )
                ),
                const SizedBox(height: 4),
                Text(
                  "Never share your OTP with anyone.", 
                  style: GoogleFonts.inter(
                    color: isDark ? Colors.white60 : Colors.black54, 
                    fontSize: 12
                  )
                ),
              ],
            ),
          ),
          CircleAvatar(
            backgroundColor: isDark ? Colors.white10 : Colors.black.withOpacity(0.05),
            radius: 20,
            child: const Icon(Icons.security, color: Color(0xFFFF6A00), size: 20),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F6FB),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF0D9488), size: 20),
          onPressed: () => Navigator.maybePop(context),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Centered Top Logo
                Image.asset(
                  'assets/images/logo/Nexo_partner_logo.png',
                  height: 48,
                  fit: BoxFit.contain,
                ),
                const SizedBox(height: 12),
                Text(
                  "PROFESSIONAL PARTNER PORTAL",
                  style: GoogleFonts.inter(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFFFF6A00),
                    letterSpacing: 1.5,
                  ),
                ),
                const SizedBox(height: 28),
                // Main Login Card
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 24),
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(32),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.04),
                        blurRadius: 24,
                        offset: const Offset(0, 10),
                      ),
                    ],
                    border: Border.all(
                      color: const Color(0xFFF1F5F9),
                      width: 1,
                    ),
                  ),
                  width: 400,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          CircleAvatar(
                            radius: 12,
                            backgroundColor: const Color(0xFFCCFBF1),
                            child: Icon(Icons.verified_user_outlined, color: const Color(0xFF0D9488), size: 14),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: const Color(0xFFCCFBF1),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              "OTP CODE SENT",
                              style: GoogleFonts.inter(
                                color: const Color(0xFF0F766E),
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),
                      Text(
                        "Verify Security",
                        textAlign: TextAlign.center,
                        style: GoogleFonts.outfit(
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          color: const Color(0xFF0F172A),
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 10),
                      RichText(
                        textAlign: TextAlign.center,
                        text: TextSpan(
                          text: "Please enter the 6-digit verification code sent to ",
                          style: GoogleFonts.inter(
                            color: const Color(0xFF64748B),
                            fontSize: 14,
                            height: 1.4,
                          ),
                          children: [
                            TextSpan(
                              text: "+91 ${widget.phoneNumber}",
                              style: GoogleFonts.inter(
                                color: const Color(0xFF14B8A6),
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 28),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: List.generate(6, (index) => _buildOtpBox(index)),
                      ),
                      const SizedBox(height: 24),
                      Center(
                        child: Text(
                          _canResend ? "Resend code" : "Resend code in ${_resendTimer}s",
                          style: GoogleFonts.inter(
                            color: _canResend ? const Color(0xFF0D9488) : const Color(0xFF64748B),
                            fontWeight: _canResend ? FontWeight.bold : FontWeight.w500,
                            fontSize: 14,
                          ),
                        ),
                      ),
                      const SizedBox(height: 28),
                      Container(
                        width: double.infinity,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(30),
                          gradient: const LinearGradient(
                            colors: [
                              Color(0xFF3B82F6),
                              Color(0xFF14B8A6),
                            ],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF3B82F6).withOpacity(0.25),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: ElevatedButton(
                          onPressed: _isLoading ? null : _verifyOtp,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.transparent,
                            foregroundColor: Colors.white,
                            shadowColor: Colors.transparent,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(30),
                            ),
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                _isLoading ? "Validating..." : "Verify OTP Code",
                                style: GoogleFonts.inter(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(width: 8),
                              const Icon(Icons.arrow_forward_rounded, size: 20),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                // Resend code display under the card (mockup 2)
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      "Didn't receive code? ",
                      style: GoogleFonts.inter(
                        color: const Color(0xFF64748B),
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    GestureDetector(
                      onTap: _canResend ? _resendOtp : null,
                      child: Text(
                        "Resend OTP",
                        style: GoogleFonts.inter(
                          color: _canResend ? const Color(0xFF0D9488) : const Color(0xFF94A3B8),
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                // Security indicator tag
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.check_circle_outline_rounded, size: 16, color: Color(0xFF0D9488)),
                    const SizedBox(width: 8),
                    Text(
                      "Trusted by verified professionals",
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      "By continuing, you agree to our ",
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        color: const Color(0xFF94A3B8),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    GestureDetector(
                      onTap: () {},
                      child: Text(
                        "Terms",
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0D9488),
                        ),
                      ),
                    ),
                    Text(
                      " & ",
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        color: const Color(0xFF94A3B8),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    GestureDetector(
                      onTap: () {},
                      child: Text(
                        "Privacy Policy",
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0D9488),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
