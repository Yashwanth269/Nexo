import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../utils/image_utils.dart';
import '../../utils/network_helper.dart';
import '../../components/glass_components.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:math' as math;
import 'dart:io';
import 'package:image_picker/image_picker.dart';
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../home/home_screen.dart';

class JobCompletionScreen extends StatefulWidget {
  final Map<String, dynamic> job;
  final String timeElapsed;

  const JobCompletionScreen({
    super.key, 
    required this.job,
    required this.timeElapsed,
  });

  @override
  State<JobCompletionScreen> createState() => _JobCompletionScreenState();
}

class _JobCompletionScreenState extends State<JobCompletionScreen> {
  int _rating = 0;
  bool _isSubmitting = false;
  bool _ratingSubmitted = false;

  File? _proofImage;
  String? _uploadedPhotoUrl;
  bool _isUploadingPhoto = false;
  final ImagePicker _picker = ImagePicker();

  Future<void> _pickImage(ImageSource source) async {
    try {
      final XFile? pickedFile = await _picker.pickImage(
        source: source,
        imageQuality: 70,
        maxWidth: 1080,
      );
      if (pickedFile != null) {
        setState(() {
          _proofImage = File(pickedFile.path);
          _isUploadingPhoto = true;
        });
        await _uploadPhoto();
      }
    } catch (e) {
      debugPrint("Error picking image: $e");
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Failed to access camera/gallery"), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _uploadPhoto() async {
    if (_proofImage == null) return;
    try {
      final baseUrl = NetworkHelper.baseUrl;
      var request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/user/upload-photo'));
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('worker_token');
      if (token != null) {
        request.headers['Authorization'] = 'Bearer $token';
      }
      request.files.add(await http.MultipartFile.fromPath(
        'photo',
        _proofImage!.path,
        contentType: MediaType('image', 'jpeg'),
      ));
      
      var response = await request.send();
      var responseData = await response.stream.bytesToString();
      var data = json.decode(responseData);
      
      if (data['success'] && data['photoUrl'] != null) {
        setState(() {
          _uploadedPhotoUrl = data['photoUrl'];
          _isUploadingPhoto = false;
        });
        debugPrint("Proof Photo Uploaded: $_uploadedPhotoUrl");
      } else {
        setState(() => _isUploadingPhoto = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Failed to upload photo"), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      debugPrint("Upload Error: $e");
      setState(() => _isUploadingPhoto = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Error uploading photo"), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _saveCompletionProof() async {
    if (_uploadedPhotoUrl == null) return;
    try {
      final jobId = widget.job['id'];
      final baseUrl = NetworkHelper.baseUrl;
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('worker_token');
      await http.post(
        Uri.parse('$baseUrl/api/jobs/$jobId/completion-photo'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({'photoUrl': _uploadedPhotoUrl}),
      );
      debugPrint("Job Completion Proof linked successfully.");
    } catch (e) {
      debugPrint("Error saving completion proof: $e");
    }
  }

  void _showImageSourceSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return GlassContainer(
          borderRadius: 30,
          blur: 25,
          padding: const EdgeInsets.all(24),
          margin: const EdgeInsets.all(16),
          color: Colors.black.withOpacity(0.9),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Upload Completion Proof",
                style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              ),
              const SizedBox(height: 8),
              Text(
                "Provide visual proof of completion for instant verification",
                style: GoogleFonts.inter(fontSize: 12, color: Colors.white60),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _buildSourceButton(Icons.camera_alt_rounded, "Camera", () {
                    Navigator.pop(context);
                    _pickImage(ImageSource.camera);
                  }),
                  _buildSourceButton(Icons.photo_library_rounded, "Gallery", () {
                    Navigator.pop(context);
                    _pickImage(ImageSource.gallery);
                  }),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSourceButton(IconData icon, String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFF97316).withOpacity(0.12),
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFF97316).withOpacity(0.3)),
            ),
            child: Icon(icon, color: const Color(0xFFF97316), size: 28),
          ),
          const SizedBox(height: 8),
          Text(label, style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.white70)),
        ],
      ),
    );
  }

  Future<void> _submitRating() async {
    if (_rating == 0) return;
    setState(() => _isSubmitting = true);

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('worker_token');
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/ratings/user'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'jobId': widget.job['id'],
          'workerId': widget.job['worker_id'],
          'userId': widget.job['user_id'],
          'rating': _rating,
          'feedback': 'Excellent customer experience!',
          'tags': [],
        }),
      );

      final data = json.decode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        setState(() => _ratingSubmitted = true);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Rating submitted successfully!"), backgroundColor: Colors.green),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(data['error'] ?? "Failed to submit rating"), backgroundColor: Colors.redAccent),
          );
        }
      }
    } catch (e) {
      debugPrint("Error submitting rating: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Connection error"), backgroundColor: Colors.redAccent),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const Color primaryColor = Color(0xFFF97316);
    const Color textPrimary = Colors.white;
    const Color textSecondary = Colors.white70;

    return Scaffold(
      body: PremiumBackground(
        child: Stack(
          children: [
            // Emoji Rain Animation
            const Positioned.fill(child: FallingEmojisWidget()),

            // Main Content
            SafeArea(
              child: Column(
                children: [
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 30),
                      children: [
                        const SizedBox(height: 10),
                        // Success Header Glass Card
                        GlassContainer(
                          blur: 25,
                          padding: const EdgeInsets.all(24),
                          color: Colors.black.withOpacity(0.65),
                          border: Border.all(color: Colors.white.withOpacity(0.12)),
                          child: Column(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(20),
                                decoration: BoxDecoration(
                                  color: primaryColor.withOpacity(0.2),
                                  shape: BoxShape.circle,
                                  border: Border.all(color: primaryColor.withOpacity(0.3)),
                                ),
                                child: const Icon(Icons.check_rounded, color: primaryColor, size: 40),
                              ),
                              const SizedBox(height: 20),
                              Text(
                                "Job Completed Successfully",
                                style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: textPrimary),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                "Your earnings have been added to your wallet.",
                                style: GoogleFonts.inter(fontSize: 13, color: textSecondary),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Earnings Glass Card
                        GlassContainer(
                          blur: 25,
                          padding: const EdgeInsets.all(24),
                          color: Colors.black.withOpacity(0.7),
                          border: Border.all(color: Colors.white.withOpacity(0.15)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "TOTAL EARNINGS",
                                style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: primaryColor, letterSpacing: 1.2),
                              ),
                              const SizedBox(height: 12),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.baseline,
                                textBaseline: TextBaseline.alphabetic,
                                children: [
                                  Text(
                                    "₹${widget.job['price']}",
                                    style: GoogleFonts.outfit(fontSize: 44, fontWeight: FontWeight.bold, color: textPrimary),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    "INR",
                                    style: GoogleFonts.inter(fontSize: 14, color: textSecondary, fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                decoration: BoxDecoration(
                                  color: Colors.greenAccent.withOpacity(0.08),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: Colors.greenAccent.withOpacity(0.2)),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.account_balance_wallet_outlined, size: 16, color: Colors.greenAccent),
                                    const SizedBox(width: 8),
                                    Text(
                                      "Verified Wallet Payment",
                                      style: GoogleFonts.inter(fontSize: 12, color: Colors.greenAccent, fontWeight: FontWeight.w600),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Stats Row
                        Row(
                          children: [
                            Expanded(
                              child: _buildGlassStatTile(
                                Icons.work_outline,
                                "Service Role",
                                widget.job['category'] ?? "Service",
                                primaryColor,
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: _buildGlassStatTile(
                                Icons.timer_outlined,
                                "Time Taken",
                                widget.timeElapsed,
                                Colors.blueAccent,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),

                        // Optional Completion Proof Card
                        GlassContainer(
                          blur: 25,
                          padding: const EdgeInsets.all(20),
                          color: Colors.black.withOpacity(0.7),
                          border: Border.all(color: Colors.white.withOpacity(0.12)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "JOB COMPLETION PROOF",
                                style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: primaryColor, letterSpacing: 1.2),
                              ),
                              const SizedBox(height: 14),
                              if (_proofImage == null) ...[
                                GestureDetector(
                                  onTap: _showImageSourceSheet,
                                  child: Container(
                                    height: 120,
                                    width: double.infinity,
                                    decoration: BoxDecoration(
                                      color: Colors.white.withOpacity(0.03),
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(color: Colors.white12, style: BorderStyle.solid),
                                    ),
                                    child: Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Icon(Icons.add_a_photo_outlined, color: primaryColor.withOpacity(0.8), size: 32),
                                        const SizedBox(height: 8),
                                        Text(
                                          "Add Completion Photo",
                                          style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.white),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          "Optional proof of completion (faster payouts)",
                                          style: GoogleFonts.inter(fontSize: 10, color: Colors.white38),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ] else ...[
                                Stack(
                                  children: [
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(16),
                                      child: SizedBox(
                                        height: 160,
                                        width: double.infinity,
                                        child: Image.file(_proofImage!, fit: BoxFit.cover),
                                      ),
                                    ),
                                    if (_isUploadingPhoto)
                                      Positioned.fill(
                                        child: Container(
                                          decoration: BoxDecoration(
                                            color: Colors.black45,
                                            borderRadius: BorderRadius.circular(16),
                                          ),
                                          child: const Center(
                                            child: CircularProgressIndicator(color: primaryColor),
                                          ),
                                        ),
                                      )
                                    else
                                      Positioned(
                                        top: 8,
                                        right: 8,
                                        child: GestureDetector(
                                          onTap: () {
                                            setState(() {
                                              _proofImage = null;
                                              _uploadedPhotoUrl = null;
                                            });
                                          },
                                          child: Container(
                                            padding: const EdgeInsets.all(6),
                                            decoration: const BoxDecoration(
                                              color: Colors.black54,
                                              shape: BoxShape.circle,
                                            ),
                                            child: const Icon(Icons.close_rounded, color: Colors.white, size: 18),
                                          ),
                                        ),
                                      ),
                                    if (!_isUploadingPhoto && _uploadedPhotoUrl != null)
                                      Positioned(
                                        bottom: 8,
                                        left: 8,
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: Colors.green.withOpacity(0.85),
                                            borderRadius: BorderRadius.circular(20),
                                          ),
                                          child: Row(
                                            children: [
                                              const Icon(Icons.check_circle_outline_rounded, color: Colors.white, size: 12),
                                              const SizedBox(width: 4),
                                              Text(
                                                "Uploaded & Ready",
                                                style: GoogleFonts.inter(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Rating Glass Card
                        GlassContainer(
                          blur: 25,
                          padding: const EdgeInsets.all(20),
                          color: Colors.black.withOpacity(0.75),
                          border: Border.all(color: Colors.white.withOpacity(0.12)),
                          child: Column(
                            children: [
                              Row(
                                children: [
                                  ImageUtils.buildProfileImage(
                                    widget.job['userPhoto'] != null ? '${NetworkHelper.baseUrl}${widget.job['userPhoto']}' : null,
                                    radius: 22,
                                    name: widget.job['userName'],
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          "Rate ${widget.job['userName'] ?? 'Customer'}",
                                          style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary),
                                        ),
                                        Text(
                                          "Customer Reliability Rating",
                                          style: GoogleFonts.inter(fontSize: 11, color: textSecondary),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 20),
                              if (!_ratingSubmitted) ...[
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: List.generate(5, (index) {
                                    return GestureDetector(
                                      onTap: () => setState(() => _rating = index + 1),
                                      child: Padding(
                                        padding: const EdgeInsets.symmetric(horizontal: 6),
                                        child: Icon(
                                          index < _rating ? Icons.star_rounded : Icons.star_outline_rounded,
                                          color: index < _rating ? primaryColor : Colors.white24,
                                          size: 36,
                                        ),
                                      ),
                                    );
                                  }),
                                ),
                                const SizedBox(height: 20),
                                SizedBox(
                                  width: double.infinity,
                                  child: _isSubmitting 
                                    ? const Center(child: CircularProgressIndicator(color: primaryColor))
                                    : GlassButton(
                                        onPressed: _rating > 0 ? _submitRating : null,
                                        text: "SUBMIT CUSTOMER RATING",
                                      ),
                                ),
                              ] else ...[
                                Container(
                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      const Icon(Icons.check_circle, color: Colors.greenAccent, size: 20),
                                      const SizedBox(width: 8),
                                      Text(
                                        "Rating Submitted! Thank you.",
                                        style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.greenAccent, fontSize: 13),
                                      ),
                                    ],
                                  ),
                                ),
                              ]
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Footer Home Button
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _isUploadingPhoto ? null : () async {
                          if (_uploadedPhotoUrl != null) {
                            await _saveCompletionProof();
                          }
                          HomeScreen.pendingTabIndex = 2; // Switch to Earnings tab
                          if (mounted) {
                            Navigator.of(context).popUntil((route) => route.isFirst);
                          }
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: primaryColor,
                          padding: const EdgeInsets.symmetric(vertical: 18),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          elevation: 4,
                          shadowColor: primaryColor.withOpacity(0.4),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              _proofImage != null ? "Submit & View Earnings" : "Skip & View Earnings",
                              style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGlassStatTile(IconData icon, String label, String value, Color accentColor) {
    return GlassContainer(
      blur: 20,
      padding: const EdgeInsets.all(16),
      color: Colors.black.withOpacity(0.65),
      border: Border.all(color: Colors.white.withOpacity(0.12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: accentColor),
          const SizedBox(height: 12),
          Text(label, style: GoogleFonts.inter(fontSize: 11, color: Colors.white60)),
          const SizedBox(height: 4),
          Text(
            value,
            style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

// Falling Emojis Rain Widget
class FallingEmojisWidget extends StatefulWidget {
  const FallingEmojisWidget({super.key});

  @override
  State<FallingEmojisWidget> createState() => _FallingEmojisWidgetState();
}

class _FallingEmojisWidgetState extends State<FallingEmojisWidget> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  final List<_EmojiParticle> _particles = [];
  final List<String> _emojis = ['🎉', '🍾', '👏', '👑', '🧡', '🌟', '✨', '💰', '🥳', '🎈'];
  final math.Random _random = math.Random();

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 10))..repeat();
    _controller.addListener(_updateParticles);
  }

  void _updateParticles() {
    if (!mounted) return;
    setState(() {
      if (_particles.length < 30 && _random.nextDouble() < 0.15) {
        _particles.add(_EmojiParticle(
          emoji: _emojis[_random.nextInt(_emojis.length)],
          x: _random.nextDouble(),
          y: -50.0,
          speed: 1.5 + _random.nextDouble() * 2.5,
          scale: 0.8 + _random.nextDouble() * 0.8,
          rotation: _random.nextDouble() * 3.14,
          rotationSpeed: -0.04 + _random.nextDouble() * 0.08,
        ));
      }

      for (int i = _particles.length - 1; i >= 0; i--) {
        final p = _particles[i];
        p.y += p.speed;
        p.rotation += p.rotationSpeed;
        if (p.y > MediaQuery.of(context).size.height + 50) {
          _particles.removeAt(i);
        }
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: _particles.map((p) {
        return Positioned(
          left: p.x * MediaQuery.of(context).size.width,
          top: p.y,
          child: Transform.rotate(
            angle: p.rotation,
            child: Transform.scale(
              scale: p.scale,
              child: Text(
                p.emoji,
                style: const TextStyle(fontSize: 24),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _EmojiParticle {
  final String emoji;
  final double x;
  double y;
  final double speed;
  final double scale;
  double rotation;
  final double rotationSpeed;

  _EmojiParticle({
    required this.emoji,
    required this.x,
    required this.y,
    required this.speed,
    required this.scale,
    required this.rotation,
    required this.rotationSpeed,
  });
}
