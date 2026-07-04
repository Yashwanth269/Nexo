import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:dotted_line/dotted_line.dart';
import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import '../../utils/image_utils.dart';
import '../../utils/network_helper.dart';
import '../../components/glass_components.dart';

class NewJobOfferScreen extends StatefulWidget {
  final dynamic job;
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  final Function(double) onCounterOffer;

  const NewJobOfferScreen({
    super.key,
    required this.job,
    required this.onAccept,
    required this.onDecline,
    required this.onCounterOffer,
  });

  @override
  State<NewJobOfferScreen> createState() => _NewJobOfferScreenState();
}

class _NewJobOfferScreenState extends State<NewJobOfferScreen> with SingleTickerProviderStateMixin {
  int _timeLeft = 60; // Increased to 60s
  Timer? _timer;
  final TextEditingController _priceController = TextEditingController();
  final FocusNode _priceFocus = FocusNode();
  bool _isNegotiating = false;
  AnimationController? _pulseController;
  Animation<double>? _pulseAnimation;
  final AudioPlayer _audioPlayer = AudioPlayer();

  @override
  void initState() {
    super.initState();
    if (widget.job['expiresIn'] != null) {
      _timeLeft = int.tryParse(widget.job['expiresIn'].toString()) ?? 60;
    }
    _priceController.text = widget.job['price']?.toString() ?? "";
    _priceController.addListener(() {
      if (_priceController.text != widget.job['price']?.toString()) {
        if (!_isNegotiating) setState(() => _isNegotiating = true);
      } else {
        if (_isNegotiating) setState(() => _isNegotiating = false);
      }
    });

    final job = widget.job;
    final isUrgent = job['isUrgent'] == true || job['status'] == 'REDISTRIBUTING' || job['status'] == 'REASSIGNING';
    if (isUrgent) {
      _pulseController = AnimationController(
        vsync: this,
        duration: const Duration(seconds: 1),
      )..repeat(reverse: true);
      _pulseAnimation = Tween<double>(begin: 0.85, end: 1.0).animate(
        CurvedAnimation(parent: _pulseController!, curve: Curves.easeInOut),
      );
    }

    _startTimer();
    _playRingtone();
  }

  Future<void> _playRingtone() async {
    try {
      await _audioPlayer.setReleaseMode(ReleaseMode.loop);
      await _audioPlayer.play(AssetSource('sounds/New gigs/zomato_sms.mp3'));
      debugPrint("🎵 [RINGTONE] Started playing zomato_sms.mp3 in loop");
    } catch (e) {
      debugPrint("⚠️ [RINGTONE] Error playing audio: $e");
    }
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_timeLeft > 0) {
        if (mounted) setState(() => _timeLeft--);
      } else {
        _timer?.cancel();
        if (mounted) {
          widget.onDecline();
          Navigator.pop(context);
        }
      }
    });
  }

  @override
  void dispose() {
    _audioPlayer.stop();
    _audioPlayer.dispose();
    _timer?.cancel();
    _pulseController?.dispose();
    _priceController.dispose();
    _priceFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final job = widget.job;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryColor = const Color(0xFFFF6A00);
    final isUrgent = job['isUrgent'] == true || job['status'] == 'REDISTRIBUTING' || job['status'] == 'REASSIGNING';

    return PopScope(
      canPop: false,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          automaticallyImplyLeading: false, // Disables automatic back button
          title: Text(
            "New Opportunity",
          style: GoogleFonts.outfit(
            fontWeight: FontWeight.w900,
            color: isDark ? Colors.white : Colors.black87,
            fontSize: 22,
            letterSpacing: 0.5,
          ),
        ),
        centerTitle: true,
      ),
      body: PremiumBackground(
        child: SafeArea(
          child: Stack(
            children: [
              SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 120),
                child: Column(
                  children: [
                    // Priority Task Card
                    GlassContainer(
                      borderRadius: 28,
                      blur: 20,
                      color: isDark ? Colors.black.withOpacity(0.65) : Colors.white.withOpacity(0.85),
                      border: Border.all(
                        color: isDark ? Colors.white.withOpacity(0.15) : Colors.black.withOpacity(0.08),
                        width: 1.5,
                      ),
                      padding: EdgeInsets.zero,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Radiant Header Banner
                          AnimatedBuilder(
                            animation: _pulseController ?? const AlwaysStoppedAnimation(0.0),
                            builder: (context, child) {
                              final double pulseValue = _pulseAnimation?.value ?? 1.0;
                              return Container(
                                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    colors: isUrgent
                                        ? [
                                            const Color(0xFFEF4444).withOpacity(pulseValue),
                                            const Color(0xFFB91C1C).withOpacity(pulseValue),
                                          ]
                                        : [const Color(0xFFFF8C00), const Color(0xFFFF6A00)],
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                  ),
                                  borderRadius: const BorderRadius.only(
                                    topLeft: Radius.circular(26),
                                    topRight: Radius.circular(26),
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: (isUrgent ? const Color(0xFFEF4444) : const Color(0xFFFF6A00)).withOpacity(0.3 * pulseValue),
                                      blurRadius: 15 * pulseValue,
                                      offset: const Offset(0, 4),
                                    )
                                  ],
                                ),
                                child: child,
                              );
                            },
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      isUrgent ? "URGENT REDISTRIBUTION" : "PRIORITY DISPATCH",
                                      style: GoogleFonts.inter(
                                        color: Colors.white.withOpacity(0.85),
                                        fontSize: 10,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: 1.5,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      isUrgent ? "Urgent Re-Dispatch" : "Exclusive Offer",
                                      style: GoogleFonts.outfit(
                                        color: Colors.white,
                                        fontSize: 20,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withOpacity(0.2),
                                    borderRadius: BorderRadius.circular(30),
                                    border: Border.all(color: Colors.white30),
                                  ),
                                  child: Row(
                                    children: [
                                      const Icon(Icons.timer_outlined, color: Colors.white, size: 16),
                                      const SizedBox(width: 6),
                                      Text(
                                        "${_timeLeft}s Left",
                                        style: GoogleFonts.inter(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),

                          Padding(
                            padding: const EdgeInsets.all(22),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Customer Profile Section
                                GlassContainer(
                                  borderRadius: 20,
                                  blur: 14,
                                  color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03),
                                  border: Border.all(
                                    color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.04),
                                    width: 1,
                                  ),
                                  padding: const EdgeInsets.all(16),
                                  child: Row(
                                    children: [
                                      ImageUtils.buildProfileImage(
                                        job['userPhoto'] != null ? '${NetworkHelper.baseUrl}${job['userPhoto']}' : null,
                                        radius: 26,
                                        name: job['userName']
                                      ),
                                      const SizedBox(width: 14),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Row(
                                              children: [
                                                Flexible(
                                                  child: Text(
                                                    job['userName'] ?? "Customer",
                                                    style: GoogleFonts.outfit(
                                                      fontSize: 17,
                                                      fontWeight: FontWeight.bold,
                                                      color: isDark ? Colors.white : Colors.black87,
                                                    ),
                                                    overflow: TextOverflow.ellipsis,
                                                  ),
                                                ),
                                                const SizedBox(width: 8),
                                                Container(
                                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                  decoration: BoxDecoration(
                                                    color: const Color(0xFF4F46E5).withOpacity(0.12),
                                                    borderRadius: BorderRadius.circular(6),
                                                    border: Border.all(color: const Color(0xFF4F46E5).withOpacity(0.3)),
                                                  ),
                                                  child: Text(
                                                    "VERIFIED",
                                                    style: GoogleFonts.inter(
                                                      color: const Color(0xFF818CF8),
                                                      fontSize: 8,
                                                      fontWeight: FontWeight.w900,
                                                      letterSpacing: 0.5,
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              "Customer ID: #${job['userId']?.toString().substring(0, 6) ?? '10482'}",
                                              style: GoogleFonts.inter(
                                                color: isDark ? Colors.white38 : Colors.black38,
                                                fontSize: 12,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Container(
                                        decoration: BoxDecoration(
                                          color: primaryColor.withOpacity(0.12),
                                          shape: BoxShape.circle,
                                          border: Border.all(color: primaryColor.withOpacity(0.2)),
                                        ),
                                        child: IconButton(
                                          icon: Icon(Icons.phone_in_talk_rounded, color: primaryColor, size: 20),
                                          onPressed: () {},
                                        ),
                                      ),
                                    ],
                                  ),
                                ),

                                const SizedBox(height: 24),

                                // Category & Badges
                                Row(
                                  children: [
                                    _buildBadge("INDUSTRIAL ZONE", const Color(0xFFDBEAFE), const Color(0xFF1E40AF)),
                                    const SizedBox(width: 8),
                                    _buildBadge("URGENT GIG", const Color(0xFFFEE2E2), const Color(0xFF991B1B)),
                                  ],
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  job['category'] ?? "Master Expert Task",
                                  style: GoogleFonts.outfit(
                                    fontSize: 26,
                                    fontWeight: FontWeight.bold,
                                    color: isDark ? Colors.white : Colors.black87,
                                    letterSpacing: -0.3,
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  job['description'] ?? "No additional information has been provided for this gig.",
                                  style: GoogleFonts.inter(
                                    color: isDark ? Colors.white70 : Colors.black54,
                                    fontSize: 14,
                                    height: 1.5,
                                  ),
                                ),
                                const SizedBox(height: 28),

                                // Micro Info Cards
                                Row(
                                  children: [
                                    Expanded(child: _buildInfoCard("Distance", "${job['distance'] ?? '2.3 km'} away", Icons.location_on_rounded)),
                                    const SizedBox(width: 10),
                                    Expanded(child: _buildInfoCard("Duration", "1–2 hours", Icons.access_time_filled_rounded)),
                                  ],
                                ),
                                const SizedBox(height: 10),
                                Row(
                                  children: [
                                    Expanded(child: _buildInfoCard("Original Bid", "₹${job['price'] ?? '1,200'}", Icons.payments_rounded)),
                                    const SizedBox(width: 10),
                                    Expanded(child: _buildInfoCard("Urgency", "Immediate", Icons.offline_bolt_rounded)),
                                  ],
                                ),

                                const SizedBox(height: 28),
                                const Divider(color: Colors.white12, height: 1),
                                const SizedBox(height: 28),

                                // Price Tagger / Negotiation Inputs
                                Row(
                                  children: [
                                    Icon(Icons.tune_rounded, color: primaryColor, size: 18),
                                    const SizedBox(width: 8),
                                    Text(
                                      "Propose Counter Bid (Negotiate)",
                                      style: GoogleFonts.outfit(
                                        fontSize: 15,
                                        fontWeight: FontWeight.bold,
                                        color: isDark ? Colors.white70 : Colors.black.withOpacity(0.7),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Focus(
                                  child: Builder(
                                    builder: (context) {
                                      final isFocused = Focus.of(context).hasFocus;
                                      return AnimatedContainer(
                                        duration: const Duration(milliseconds: 200),
                                        decoration: BoxDecoration(
                                          borderRadius: BorderRadius.circular(16),
                                          boxShadow: [
                                            if (isFocused)
                                              BoxShadow(
                                                color: primaryColor.withOpacity(0.12),
                                                blurRadius: 10,
                                                spreadRadius: 1,
                                              )
                                          ],
                                        ),
                                        child: GlassContainer(
                                          borderRadius: 16,
                                          blur: 12,
                                          color: isFocused
                                              ? (isDark ? Colors.black.withOpacity(0.55) : Colors.white.withOpacity(0.95))
                                              : (isDark ? Colors.black.withOpacity(0.2) : Colors.white.withOpacity(0.6)),
                                          border: Border.all(
                                            color: isFocused ? primaryColor : (isDark ? Colors.white.withOpacity(0.1) : Colors.black.withOpacity(0.06)),
                                            width: 1.5,
                                          ),
                                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                                          child: TextField(
                                            controller: _priceController,
                                            focusNode: _priceFocus,
                                            keyboardType: TextInputType.number,
                                            style: GoogleFonts.inter(
                                              fontWeight: FontWeight.bold, 
                                              fontSize: 16,
                                              color: isDark ? Colors.white : Colors.black87,
                                            ),
                                            decoration: InputDecoration(
                                              hintText: "Enter custom bid price",
                                              hintStyle: GoogleFonts.inter(color: isDark ? Colors.white24 : Colors.black26),
                                              suffixText: "₹",
                                              suffixStyle: GoogleFonts.outfit(
                                                fontWeight: FontWeight.bold,
                                                color: primaryColor,
                                                fontSize: 18,
                                              ),
                                              border: InputBorder.none,
                                            ),
                                          ),
                                        ),
                                      );
                                    }
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              // Floating Premium Glass Action Pill at the bottom
              Positioned(
                bottom: 24,
                left: 18,
                right: 18,
                child: GlassContainer(
                  borderRadius: 24,
                  blur: 20,
                  color: isDark ? Colors.black.withOpacity(0.82) : Colors.white.withOpacity(0.88),
                  border: Border.all(
                    color: isDark ? Colors.white.withOpacity(0.12) : Colors.black.withOpacity(0.08),
                    width: 1.5,
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                  child: Row(
                    children: [
                      // Decline button - Frosted Crimson
                      GestureDetector(
                        onTap: () {
                          widget.onDecline();
                          Navigator.pop(context);
                        },
                        child: GlassContainer(
                          borderRadius: 18,
                          blur: 10,
                          width: 52,
                          height: 52,
                          padding: EdgeInsets.zero,
                          color: Colors.redAccent.withOpacity(0.15),
                          border: Border.all(color: Colors.redAccent.withOpacity(0.3), width: 1.2),
                          child: const Center(
                            child: Icon(Icons.close_rounded, color: Colors.redAccent, size: 24),
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      // Accept / Propose button
                      Expanded(
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 250),
                          height: 52,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(26),
                            boxShadow: [
                              BoxShadow(
                                color: (_isNegotiating ? primaryColor : const Color(0xFF10B981)).withOpacity(0.35),
                                blurRadius: 15,
                                offset: const Offset(0, 6),
                              ),
                            ],
                            gradient: LinearGradient(
                              colors: _isNegotiating
                                  ? [const Color(0xFFFF8C00), const Color(0xFFFF6A00)]
                                  : [const Color(0xFF10B981), const Color(0xFF059669)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                          ),
                          child: ElevatedButton(
                            onPressed: () {
                              if (_isNegotiating) {
                                final price = double.tryParse(_priceController.text);
                                if (price != null) {
                                  widget.onCounterOffer(price);
                                }
                              } else {
                                widget.onAccept();
                              }
                              Navigator.pop(context);
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.transparent,
                              shadowColor: Colors.transparent,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                              padding: const EdgeInsets.symmetric(horizontal: 20),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  _isNegotiating ? Icons.send_rounded : Icons.check_circle_outline_rounded,
                                  color: Colors.white,
                                  size: 20,
                                ),
                                const SizedBox(width: 10),
                                Text(
                                  _isNegotiating ? "Propose Counter Bid" : "Accept & Dispatched",
                                  style: GoogleFonts.inter(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 15,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

  Widget _buildBadge(String text, Color bgColor, Color textColor) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bgColor.withOpacity(0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: bgColor.withOpacity(0.3), width: 1),
      ),
      child: Text(
        text,
        style: GoogleFonts.inter(
          color: textColor,
          fontSize: 9,
          fontWeight: FontWeight.w900,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Widget _buildInfoCard(String label, String value, IconData icon) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryColor = const Color(0xFFFF6A00);
    return GlassContainer(
      borderRadius: 14,
      blur: 10,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      color: isDark ? Colors.white.withOpacity(0.03) : Colors.black.withOpacity(0.02),
      border: Border.all(
        color: isDark ? Colors.white.withOpacity(0.06) : Colors.black.withOpacity(0.04),
        width: 1,
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: primaryColor.withOpacity(0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: primaryColor, size: 16),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: GoogleFonts.inter(
                    color: isDark ? Colors.white38 : Colors.black45,
                    fontSize: 9,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: GoogleFonts.outfit(
                    color: isDark ? Colors.white : Colors.black87,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
