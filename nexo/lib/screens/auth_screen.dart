import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:image_picker/image_picker.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:app_links/app_links.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import 'home_screen.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final PageController _pageController = PageController();
  int _currentStep = 0;

  // Theme Colors
  static const Color primaryColor = Color(0xFFFF6A00); // Orange
  static const Color secondaryColor = Color(0xFF1E3A8A); // Blue

  // OTP Timer
  int _resendTimer = 30;
  Timer? _timer;
  bool _canResend = false;

  // Loading state
  bool _isLoading = false;

  // Deep Link handler
  late AppLinks _appLinks;
  StreamSubscription<Uri>? _linkSubscription;

  // Image picker
  final ImagePicker _imagePicker = ImagePicker();
  File? _profileImage;

  // Controllers for inputs
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _cityController = TextEditingController();
  final List<TextEditingController> _otpControllers = List.generate(6, (_) => TextEditingController());
  final List<FocusNode> _otpFocusNodes = List.generate(6, (_) => FocusNode());

  // State for Step 3
  List<String> _selectedSkills = ["Delivery", "Plumbing"];

  final String baseUrl = NetworkHelper.baseUrl;

  @override
  void initState() {
    super.initState();
    _checkIfLoggedIn();
    _initDeepLinking();
    for (int i = 0; i < 6; i++) {
      _otpFocusNodes[i].addListener(() {
        if (mounted) setState(() {});
      });
      _otpFocusNodes[i].onKeyEvent = (node, event) {
        if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.backspace) {
          if (_otpControllers[i].text.isEmpty && i > 0) {
            _otpFocusNodes[i - 1].requestFocus();
            return KeyEventResult.handled;
          }
        }
        return KeyEventResult.ignored;
      };
    }
  }

  void _initDeepLinking() {
    _appLinks = AppLinks();
    
    // Listen to incoming links while app is running
    _linkSubscription = _appLinks.uriLinkStream.listen((uri) {
      _handleDeepLink(uri);
    }, onError: (err) {
      print("Deep link listener error: $err");
    });

    // Check for initial link if app is launched via deep link
    _appLinks.getInitialLink().then((uri) {
      if (uri != null) {
        _handleDeepLink(uri);
      }
    });
  }

  void _handleDeepLink(Uri uri) {
    print("Received deep link: $uri");
    if (uri.scheme == 'gigs' && uri.host == 'otp') {
      final phone = uri.queryParameters['phone'];
      final code = uri.queryParameters['code'];
      if (code != null) {
        _autoVerifyWithLink(phone ?? '', code);
      }
    }
  }

  void _autoVerifyWithLink(String phone, String code) {
    if (phone.isNotEmpty) {
      String cleanPhone = phone;
      if (cleanPhone.startsWith('+91')) {
        cleanPhone = cleanPhone.substring(3);
      } else if (cleanPhone.startsWith('91') && cleanPhone.length > 10) {
        cleanPhone = cleanPhone.substring(2);
      }
      _phoneController.text = cleanPhone.trim();
    }
    
    for (int i = 0; i < 6; i++) {
      if (i < code.length) {
        _otpControllers[i].text = code[i];
      } else {
        _otpControllers[i].text = '';
      }
    }
    
    FocusScope.of(context).unfocus();

    if (_currentStep == 0) {
      setState(() {
        _currentStep = 1;
      });
      _pageController.animateToPage(
        1,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
    }
    
    _verifyOtp();
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final XFile? pickedFile = await _imagePicker.pickImage(
        source: source,
        maxWidth: 800,
        maxHeight: 800,
        imageQuality: 80,
        requestFullMetadata: false,
      );
      
      if (pickedFile != null && mounted) {
        setState(() {
          _profileImage = File(pickedFile.path);
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error picking image: ${e.toString()}")),
        );
      }
    }
  }

  void _showImageSourceDialog() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              "Select Photo Source",
              style: GoogleFonts.plusJakartaSans(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: secondaryColor,
              ),
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildSourceOption(
                  icon: Icons.camera_alt_rounded,
                  label: "Camera",
                  onTap: () {
                    Navigator.pop(context);
                    _pickImage(ImageSource.camera);
                  },
                ),
                _buildSourceOption(
                  icon: Icons.photo_library_rounded,
                  label: "Gallery",
                  onTap: () {
                    Navigator.pop(context);
                    _pickImage(ImageSource.gallery);
                  },
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildSourceOption({required IconData icon, required String label, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Column(
          children: [
            Container(
              width: 60,
              height: 60,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: primaryColor.withOpacity(0.1),
                border: Border.all(color: primaryColor.withOpacity(0.2), width: 1.5),
              ),
              child: Icon(icon, size: 26, color: primaryColor),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              style: GoogleFonts.plusJakartaSans(
                fontWeight: FontWeight.w600,
                color: secondaryColor,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _fetchLiveLocation() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.always || permission == LocationPermission.whileInUse) {
        Position position = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high,
          timeLimit: const Duration(seconds: 5),
        );
        List<Placemark> placemarks = await placemarkFromCoordinates(position.latitude, position.longitude);
        if (placemarks.isNotEmpty) {
          Placemark place = placemarks[0];
          String city = place.locality ?? place.subAdministrativeArea ?? place.administrativeArea ?? "";
          String area = place.subLocality ?? "";
          String fullLocation = area.isNotEmpty ? "$area, $city" : city;
          if (mounted && _cityController.text.isEmpty) {
            setState(() {
              _cityController.text = fullLocation;
            });
          }
        }
      }
    } catch (e) {
      print("Error fetching live location: $e");
    }
  }

  Future<void> _sendOtp() async {
    if (_isLoading) return;
    if (_phoneController.text.length != 10) return;
    setState(() => _isLoading = true);
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/auth/send-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'phoneNumber': _phoneController.text}),
      );
      final data = jsonDecode(response.body);
      if (data['success']) {
        _startResendTimer();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: const Color(0xFF10B981),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              content: Text(
                "OTP sent successfully!",
                style: GoogleFonts.plusJakartaSans(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          );
          _nextPage();
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
                      data['message'] ?? data['error'] ?? "Failed to send OTP. Please try again.",
                      style: GoogleFonts.plusJakartaSans(
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
                    "Connection error. Is the server running?",
                    style: GoogleFonts.plusJakartaSans(
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
      print(e);
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _startResendTimer() {
    setState(() { _resendTimer = 30; _canResend = false; });
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        if (_resendTimer > 0) _resendTimer--;
        else { _canResend = true; timer.cancel(); }
      });
    });
  }

  Future<void> _verifyOtp() async {
    if (_isLoading) return;
    final otp = _otpControllers.map((c) => c.text).join();
    if (otp.length != 6) return;
    setState(() => _isLoading = true);
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/auth/verify-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'phoneNumber': _phoneController.text, 'otp': otp}),
      );
      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        // Save auth data immediately so it's available
        await SharedPrefsHelper.setUserId(data['userId']);
        await SharedPrefsHelper.setToken(data['token']);
        await SharedPrefsHelper.setPhone(_phoneController.text);
        
        if (data['isNewUser'] == false) {
          // Fetch existing profile (Structured Sync)
          final profileRes = await http.get(
            Uri.parse('$baseUrl/api/user/profile/${data['userId']}'),
            headers: {'Authorization': 'Bearer ${data['token']}'},
          );
          final profileData = jsonDecode(profileRes.body);
          if (profileData['success'] == true) {
            final user = profileData['user'];
            await SharedPrefsHelper.setLoggedIn(true);
            await SharedPrefsHelper.setUserName(user['name'] ?? "");
            await SharedPrefsHelper.setPhotoUrl(user['photoUrl']);
            
            if (mounted) {
              Navigator.pushReplacement(context, MaterialPageRoute(builder: (context) => const HomeScreen()));
            }
            return;
          }
        }
        _nextPage();
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
                      data['message'] ?? data['error'] ?? "Invalid OTP Code",
                      style: GoogleFonts.plusJakartaSans(
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
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error verifying OTP: ${e.toString()}")),
        );
      }
      print(e);
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _saveUserProfile() async {
    if (_isLoading) return;
    setState(() => _isLoading = true);
    try {
      String? photoUrl;
      if (_profileImage != null) {
        if (await _profileImage!.exists()) {
          final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/user/upload-photo'));
          request.files.add(await http.MultipartFile.fromPath('photo', _profileImage!.path));
          final streamedRes = await request.send();
          final res = await http.Response.fromStream(streamedRes);
          final uploadData = jsonDecode(res.body);
          if (uploadData['success'] == true) photoUrl = uploadData['photoUrl'];
        } else {
          print("Profile image file not found at path: ${_profileImage!.path}");
          _profileImage = null; // Reset if file is missing
        }
      }

      final userId = await SharedPrefsHelper.getUserId();
      final token = await SharedPrefsHelper.getToken();
      
      final response = await http.post(
        Uri.parse('$baseUrl/api/user/save-profile'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'userId': userId,
          'phoneNumber': _phoneController.text,
          'name': _nameController.text,
          'location': _cityController.text,
          'skills': _selectedSkills,
          'photoUrl': photoUrl,
        }),
      );
      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        await SharedPrefsHelper.setLoggedIn(true);
        await SharedPrefsHelper.setUserName(_nameController.text);
        await SharedPrefsHelper.setPhotoUrl(photoUrl);
        await SharedPrefsHelper.setPhone(_phoneController.text);
        if (data['userId'] != null) await SharedPrefsHelper.setUserId(data['userId']);
        if (data['token'] != null) await SharedPrefsHelper.setToken(data['token']);
        if (mounted) _nextPage();
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(data['error'] ?? "Failed to save profile")),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error saving profile: ${e.toString()}")),
        );
      }
      print(e);
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _checkIfLoggedIn() async {
    final isLoggedIn = await SharedPrefsHelper.isLoggedIn();
    final phone = await SharedPrefsHelper.getPhone();
    
    if (isLoggedIn) {
      if (phone != null && mounted) {
        Navigator.pushReplacement(context, MaterialPageRoute(builder: (context) => const HomeScreen()));
      } else {
        await SharedPrefsHelper.clearUserData();
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _linkSubscription?.cancel();
    _pageController.dispose();
    _phoneController.dispose();
    _nameController.dispose();
    _cityController.dispose();
    for (var c in _otpControllers) c.dispose();
    for (var n in _otpFocusNodes) n.dispose();
    super.dispose();
  }

  void _nextPage() {
    if (_currentStep < 2) {
      _pageController.nextPage(duration: const Duration(milliseconds: 400), curve: Curves.easeOutCubic);
      setState(() {
        _currentStep++;
        if (_currentStep == 2) {
          _fetchLiveLocation();
        }
      });
    } else {
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (context) => const HomeScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F6FB),
      body: SafeArea(
        child: Stack(
          children: [
            // Floating back button in the top-left corner
            if (_currentStep > 0)
              Positioned(
                top: 8,
                left: 8,
                child: IconButton(
                  icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF64748B), size: 20),
                  onPressed: () {
                    _pageController.previousPage(duration: const Duration(milliseconds: 400), curve: Curves.easeOutCubic);
                    setState(() => _currentStep--);
                  },
                ),
              ),
            Center(
              child: SingleChildScrollView(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const SizedBox(height: 24),
                    // Centered Top Logo
                    Image.asset(
                      'assets/images/logo/Nexo_logo.png',
                      height: 48,
                      fit: BoxFit.contain,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      "TRUSTED LOCAL SERVICES",
                      style: GoogleFonts.plusJakartaSans(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF64748B),
                        letterSpacing: 1.5,
                      ),
                    ),
                    const SizedBox(height: 28),
                    // Main Login Card
                    Container(
                      margin: const EdgeInsets.symmetric(horizontal: 24),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 24),
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
                      height: 480,
                      child: PageView(
                        controller: _pageController,
                        physics: const NeverScrollableScrollPhysics(),
                        children: [
                          _buildPhoneStep(),
                          _buildOtpStep(),
                          _buildProfileStep(),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    // Resend code display under the card (mockup 1)
                    if (_currentStep == 1) ...[
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            "Didn't receive code? ",
                            style: GoogleFonts.plusJakartaSans(
                              color: const Color(0xFF64748B),
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          GestureDetector(
                            onTap: _canResend ? _sendOtp : null,
                            child: Text(
                              "Resend OTP",
                              style: GoogleFonts.plusJakartaSans(
                                color: _canResend ? const Color(0xFF3B82F6) : const Color(0xFF94A3B8),
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                    ],
                    // Securely encrypted tag
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.verified_user_outlined, size: 16, color: Color(0xFF3B82F6)),
                        const SizedBox(width: 8),
                        Text(
                          "Your number is securely encrypted",
                          style: GoogleFonts.plusJakartaSans(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          "By continuing, you agree to our ",
                          style: GoogleFonts.plusJakartaSans(
                            fontSize: 13,
                            color: const Color(0xFF94A3B8),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        GestureDetector(
                          onTap: () {},
                          child: Text(
                            "Terms",
                            style: GoogleFonts.plusJakartaSans(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF3B82F6),
                            ),
                          ),
                        ),
                        Text(
                          " & ",
                          style: GoogleFonts.plusJakartaSans(
                            fontSize: 13,
                            color: const Color(0xFF94A3B8),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        GestureDetector(
                          onTap: () {},
                          child: Text(
                            "Privacy Policy",
                            style: GoogleFonts.plusJakartaSans(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF3B82F6),
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
          ],
        ),
      ),
    );
  }

  Widget _buildOtpStep() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 12,
                backgroundColor: const Color(0xFFEFF6FF),
                child: Icon(Icons.verified_user_outlined, color: const Color(0xFF2563EB), size: 14),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  "OTP CODE SENT",
                  style: GoogleFonts.plusJakartaSans(
                    color: const Color(0xFF2563EB),
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            "Verify Security",
            style: GoogleFonts.plusJakartaSans(
              fontSize: 30,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF0F172A),
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 8),
          RichText(
            text: TextSpan(
              text: "Please enter the 6-digit verification code sent to ",
              style: GoogleFonts.plusJakartaSans(
                color: const Color(0xFF64748B),
                fontSize: 14,
                height: 1.4,
              ),
              children: [
                TextSpan(
                  text: "+91 ${_phoneController.text}",
                  style: GoogleFonts.plusJakartaSans(
                    color: const Color(0xFF2563EB),
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(6, (index) => _buildOtpField(index)),
          ),
          const SizedBox(height: 20),
          Center(
            child: Text(
              _canResend ? "Resend code" : "Resend code in ${_resendTimer}s",
              style: GoogleFonts.plusJakartaSans(
                color: _canResend ? const Color(0xFF3B82F6) : const Color(0xFF64748B),
                fontWeight: _canResend ? FontWeight.bold : FontWeight.w500,
                fontSize: 14,
              ),
            ),
          ),
          const Spacer(),
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(30),
              gradient: const LinearGradient(
                colors: [
                  Color(0xFF3B82F6),
                  Color(0xFF60A5FA),
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
                    style: GoogleFonts.plusJakartaSans(
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
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  Widget _buildPhoneStep() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: const Color(0xFFEFF6FF),
                child: Icon(Icons.shield_outlined, color: const Color(0xFF2563EB), size: 20),
              ),
              const SizedBox(width: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  "VERIFIED PLATFORM",
                  style: GoogleFonts.plusJakartaSans(
                    color: const Color(0xFF2563EB),
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            "Welcome to Nexo",
            style: GoogleFonts.plusJakartaSans(
              fontSize: 30,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF0F172A),
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            "Enter your mobile number to continue securely.",
            style: GoogleFonts.plusJakartaSans(
              color: const Color(0xFF64748B),
              fontSize: 15,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 28),
          Text(
            "Phone Number",
            style: GoogleFonts.plusJakartaSans(
              fontWeight: FontWeight.bold,
              fontSize: 12,
              color: const Color(0xFF475569),
            ),
          ),
          const SizedBox(height: 8),
          Focus(
            child: Builder(
              builder: (context) {
                final isFocused = Focus.of(context).hasFocus;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(30),
                    border: Border.all(
                      color: isFocused ? const Color(0xFF3B82F6) : const Color(0xFFE2E8F0),
                      width: 1.5,
                    ),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                  child: Row(
                    children: [
                      Text(
                        "🇮🇳 +91",
                        style: GoogleFonts.plusJakartaSans(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color: const Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Container(
                        width: 1,
                        height: 20,
                        color: const Color(0xFFE2E8F0),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _phoneController,
                          keyboardType: TextInputType.phone,
                          maxLength: 10,
                          style: GoogleFonts.plusJakartaSans(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF0F172A),
                          ),
                          decoration: InputDecoration(
                            border: InputBorder.none,
                            counterText: "",
                            hintText: "98765 43210",
                            hintStyle: GoogleFonts.plusJakartaSans(color: const Color(0xFF94A3B8)),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }
            ),
          ),
          const Spacer(),
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(30),
              gradient: const LinearGradient(
                colors: [
                  Color(0xFF3B82F6),
                  Color(0xFF60A5FA),
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
              onPressed: _isLoading ? null : () async {
                if (_phoneController.text.length == 10) await _sendOtp();
              },
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
                    _isLoading ? "Processing..." : "Continue",
                    style: GoogleFonts.plusJakartaSans(
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
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  Widget _buildProfileStep() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: const Color(0xFFEFF6FF),
                child: Icon(Icons.person_outline_rounded, color: const Color(0xFF2563EB), size: 20),
              ),
              const SizedBox(width: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  "BUILD PROFILE",
                  style: GoogleFonts.plusJakartaSans(
                    color: const Color(0xFF2563EB),
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Center(
            child: GestureDetector(
              onTap: _showImageSourceDialog,
              child: Stack(
                children: [
                  Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF3B82F6).withOpacity(0.1),
                          blurRadius: 20,
                          spreadRadius: 2,
                        )
                      ],
                    ),
                    child: CircleAvatar(
                      radius: 54,
                      backgroundColor: const Color(0xFFF8FAFC),
                      backgroundImage: _profileImage != null ? FileImage(_profileImage!) : null,
                      child: _profileImage == null
                          ? Icon(Icons.person_add_outlined, size: 36, color: const Color(0xFF3B82F6).withOpacity(0.6))
                          : null,
                    ),
                  ),
                  Positioned(
                    bottom: 2,
                    right: 2,
                    child: Container(
                      height: 32,
                      width: 32,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF3B82F6), Color(0xFF60A5FA)],
                        ),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                      child: const Center(
                        child: Icon(Icons.camera_alt_rounded, color: Colors.white, size: 14),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          _buildTextField("FULL NAME", _nameController, Icons.person_rounded),
          const SizedBox(height: 16),
          _buildTextField("CITY / CURRENT LOCATION", _cityController, Icons.location_on_rounded),
          const SizedBox(height: 24),
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(30),
              gradient: const LinearGradient(
                colors: [
                  Color(0xFF3B82F6),
                  Color(0xFF60A5FA),
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
              onPressed: _isLoading ? null : _saveUserProfile,
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
                    _isLoading ? "Saving..." : "Finalize Profile",
                    style: GoogleFonts.plusJakartaSans(
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
    );
  }

  Widget _buildOtpField(int index) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: 44,
      height: 54,
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: _otpFocusNodes[index].hasFocus ? const Color(0xFF3B82F6) : const Color(0xFFE2E8F0),
          width: 1.5,
        ),
      ),
      child: Center(
        child: TextField(
          controller: _otpControllers[index],
          focusNode: _otpFocusNodes[index],
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          maxLength: 1,
          style: GoogleFonts.plusJakartaSans(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF0F172A),
          ),
          decoration: const InputDecoration(border: InputBorder.none, counterText: ""),
          onChanged: (value) {
            if (value.isNotEmpty && index < 5) _otpFocusNodes[index + 1].requestFocus();
            if (value.isEmpty && index > 0) _otpFocusNodes[index - 1].requestFocus();
          },
        ),
      ),
    );
  }

  Widget _buildTextField(String label, TextEditingController controller, IconData icon) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 12, bottom: 6),
          child: Text(
            label,
            style: GoogleFonts.plusJakartaSans(
              fontWeight: FontWeight.bold,
              fontSize: 11,
              color: const Color(0xFF475569),
              letterSpacing: 1.0,
            ),
          ),
        ),
        Focus(
          child: Builder(
            builder: (context) {
              final isFocused = Focus.of(context).hasFocus;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(30),
                  border: Border.all(
                    color: isFocused ? const Color(0xFF3B82F6) : const Color(0xFFE2E8F0),
                    width: 1.5,
                  ),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                child: TextField(
                  controller: controller,
                  style: GoogleFonts.plusJakartaSans(fontWeight: FontWeight.w600, color: const Color(0xFF0F172A), fontSize: 15),
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    icon: Icon(icon, size: 20, color: isFocused ? const Color(0xFF3B82F6) : const Color(0xFF64748B)),
                    hintText: "Enter your ${label.toLowerCase()}",
                    hintStyle: GoogleFonts.plusJakartaSans(color: const Color(0xFF94A3B8), fontSize: 14),
                  ),
                ),
              );
            }
          ),
        ),
      ],
    );
  }
}
