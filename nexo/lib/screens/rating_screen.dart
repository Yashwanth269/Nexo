import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/components/glass_components.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/shared_prefs_helper.dart';

class RatingScreen extends StatefulWidget {
  final Map<String, dynamic> job;
  const RatingScreen({super.key, required this.job});

  @override
  State<RatingScreen> createState() => _RatingScreenState();
}

class _RatingScreenState extends State<RatingScreen> {
  int _rating = 0;
  final TextEditingController _commentController = TextEditingController();
  bool _isSubmitting = false;
  final FocusNode _commentFocusNode = FocusNode();
  bool _isCommentFocused = false;

  @override
  void initState() {
    super.initState();
    _commentFocusNode.addListener(() {
      setState(() {
        _isCommentFocused = _commentFocusNode.hasFocus;
      });
    });
  }

  @override
  void dispose() {
    _commentFocusNode.dispose();
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submitRating() async {
    if (_rating == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Please select a rating"), backgroundColor: Colors.orangeAccent),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    final worker = widget.job['worker'];

    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/ratings/worker'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'jobId': widget.job['id'],
          'userId': widget.job['user_id'],
          'workerId': worker['id'],
          'rating': _rating,
          'feedback': _commentController.text,
          'tags': [],
        }),
      );

      final data = json.decode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        if (mounted) {
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Thank you for your feedback!"), backgroundColor: Colors.green),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(data['message'] ?? "Failed to submit rating"), backgroundColor: Colors.redAccent),
          );
        }
      }
    } catch (e) {
      debugPrint("Error submitting rating: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Connection error. Please try again."), backgroundColor: Colors.redAccent),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final worker = widget.job['worker'] ?? {};
    const Color primaryColor = Color(0xFFFF6A00);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? Colors.white : const Color(0xFF111111);
    final textSecondary = isDark ? Colors.white70 : Colors.black54;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        automaticallyImplyLeading: false,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(
                "Skip",
                style: GoogleFonts.inter(
                  color: isDark ? Colors.white54 : Colors.black45,
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
            ),
          ),
        ],
      ),
      body: PremiumBackground(
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
            child: Column(
              children: [
                const SizedBox(height: 20),
                
                // Profile & Job Card
                GlassContainer(
                  blur: 24,
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      // Worker Avatar with glowing border
                      Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: primaryColor.withOpacity(0.5), width: 3),
                          boxShadow: [
                            BoxShadow(
                              color: primaryColor.withOpacity(0.2),
                              blurRadius: 16,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: CircleAvatar(
                          radius: 54,
                          backgroundColor: Colors.white10,
                          backgroundImage: worker['photoUrl'] != null && worker['photoUrl'].toString().isNotEmpty
                              ? NetworkImage(worker['photoUrl'].toString().startsWith('http')
                                  ? worker['photoUrl']
                                  : '${NetworkHelper.baseUrl}${worker['photoUrl']}')
                              : null,
                          child: worker['photoUrl'] == null || worker['photoUrl'].toString().isEmpty
                              ? Icon(Icons.person_rounded, size: 54, color: textSecondary)
                              : null,
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        "Rate Your Experience",
                        style: GoogleFonts.outfit(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: textPrimary,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        "How was your session with ${worker['name'] ?? 'your technician'}?",
                        style: GoogleFonts.inter(
                          fontSize: 14,
                          color: textSecondary,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: primaryColor.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: primaryColor.withOpacity(0.2)),
                        ),
                        child: Text(
                          (worker['category'] ?? "Expert").toString().toUpperCase(),
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: primaryColor,
                            letterSpacing: 1.0,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                
                const SizedBox(height: 24),

                // Stars Card
                GlassContainer(
                  blur: 24,
                  padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
                  child: Column(
                    children: [
                      Text(
                        "TAP TO RATE",
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: isDark ? Colors.white54 : Colors.black45,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(5, (index) {
                          final isActive = index < _rating;
                          return GestureDetector(
                            onTap: () {
                              setState(() {
                                _rating = index + 1;
                              });
                            },
                            child: AnimatedScale(
                              scale: isActive ? 1.15 : 1.0,
                              duration: const Duration(milliseconds: 200),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 6),
                                child: Icon(
                                  isActive ? Icons.star_rounded : Icons.star_outline_rounded,
                                  color: isActive ? const Color(0xFFFFB300) : (isDark ? Colors.white30 : Colors.black26),
                                  size: 48,
                                ),
                              ),
                            ),
                          );
                        }),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 24),

                // Comment Card
                GlassContainer(
                  blur: 24,
                  padding: const EdgeInsets.all(20),
                  border: Border.all(
                    color: _isCommentFocused
                        ? primaryColor.withOpacity(0.4)
                        : (isDark ? Colors.white.withOpacity(0.12) : Colors.black.withOpacity(0.06)),
                    width: 1.5,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "ADDITIONAL COMMENTS",
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: isDark ? Colors.white54 : Colors.black45,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _commentController,
                        focusNode: _commentFocusNode,
                        maxLines: 3,
                        style: GoogleFonts.inter(color: textPrimary, fontSize: 14),
                        decoration: InputDecoration(
                          hintText: "Tell us about the service quality, professionalism...",
                          hintStyle: GoogleFonts.inter(color: isDark ? Colors.white30 : Colors.black26, fontSize: 13),
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 32),

                // Submit Button
                SizedBox(
                  width: double.infinity,
                  child: GlassButton(
                    onPressed: _isSubmitting ? null : _submitRating,
                    text: _isSubmitting ? "SUBMITTING..." : "SUBMIT FEEDBACK",
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
