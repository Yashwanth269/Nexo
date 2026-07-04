import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Theme-aware text color helpers for the glass design system.
///
/// Light mode: dark text on white frosted glass
/// Dark mode: white text on dark glass
class GlassTheme {
  static Color textPrimary(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? Colors.white
        : const Color(0xFF111111); // ~rgba(0,0,0,0.93)
  }

  static Color textSecondary(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? Colors.white70
        : const Color(0xB3000000); // rgba(0,0,0,0.70)
  }

  static Color textMuted(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? Colors.white38
        : const Color(0x8C000000); // rgba(0,0,0,0.55)
  }

  static Color iconColor(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? Colors.white
        : const Color(0xCC000000); // rgba(0,0,0,0.80)
  }

  static Color surfaceBorder(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? Colors.white.withOpacity(0.18)
        : Colors.black.withOpacity(0.12);
  }

  static Color glassBackground(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return isDark
        ? Colors.black.withOpacity(0.92)
        : Colors.white.withOpacity(0.90);
  }
}

class GlassContainer extends StatelessWidget {
  final Widget child;
  final double borderRadius;
  final double blur;
  final Color? color;
  final Border? border;
  final List<BoxShadow>? shadow;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final double? width;
  final double? height;
  final Gradient? gradient;

  const GlassContainer({
    Key? key,
    required this.child,
    this.borderRadius = 20.0,
    this.blur = 15.0,
    this.color,
    this.border,
    this.shadow,
    this.padding,
    this.margin,
    this.width,
    this.height,
    this.gradient,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Container(
      width: width,
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(borderRadius),
        boxShadow: shadow ?? [
          BoxShadow(
            color: isDark
                ? Colors.black.withOpacity(0.4)
                : Colors.black.withOpacity(0.08),
            blurRadius: 25,
            offset: const Offset(0, 8),
          ),
          if (!isDark)
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 12,
              offset: const Offset(0, 2),
            ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              gradient: gradient,
              color: color ?? GlassTheme.glassBackground(context),
              borderRadius: BorderRadius.circular(borderRadius),
              border: border ??
                  Border.all(
                    color: isDark
                        ? Colors.white.withOpacity(0.15)
                        : Colors.white.withOpacity(0.6),
                    width: 1.5,
                  ),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

class PremiumBackground extends StatelessWidget {
  final Widget child;

  const PremiumBackground({Key? key, required this.child}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Stack(
      children: [
        // Base gradient background
        Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: isDark
                  ? [const Color(0xFF0D0E12), const Color(0xFF1A1D26)]
                  : [const Color(0xFFF8FAFC), const Color(0xFFE2E8F0)],
            ),
          ),
        ),
        // Soft glowing ambient circle — top right (warm orange)
        Positioned(
          top: -60,
          right: -60,
          child: Container(
            width: 200,
            height: 200,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFEA580C).withOpacity(isDark ? 0.06 : 0.08),
            ),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 60, sigmaY: 60),
              child: Container(color: Colors.transparent),
            ),
          ),
        ),
        // Soft glowing ambient circle — bottom left (warm amber)
        Positioned(
          bottom: 100,
          left: -80,
          child: Container(
            width: 180,
            height: 180,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFF59E0B).withOpacity(isDark ? 0.04 : 0.06),
            ),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 60, sigmaY: 60),
              child: Container(color: Colors.transparent),
            ),
          ),
        ),
        // Additional ambient circle — middle right (cool indigo)
        Positioned(
          top: 250,
          right: -30,
          child: Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFF6366F1).withOpacity(isDark ? 0.03 : 0.04),
            ),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 50, sigmaY: 50),
              child: Container(color: Colors.transparent),
            ),
          ),
        ),
        child,
      ],
    );
  }
}

class GlassButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  final bool isPrimary;
  final IconData? icon;
  final double? width;
  final double height;

  const GlassButton({
    Key? key,
    required this.text,
    this.onPressed,
    this.isPrimary = true,
    this.icon,
    this.width,
    this.height = 48,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (isPrimary) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(height / 2),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFEA580C).withOpacity(isDark ? 0.35 : 0.25),
              blurRadius: 15,
              offset: const Offset(0, 6),
            ),
          ],
          gradient: const LinearGradient(
            colors: [Color(0xFFF97316), Color(0xFFF59E0B)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: ElevatedButton(
          onPressed: onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            shadowColor: Colors.transparent,
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(height / 2)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...{
                Icon(icon, size: 18, color: Colors.white),
                const SizedBox(width: 8),
              },
              Text(
                text,
                style: GoogleFonts.inter(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: Colors.white,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
      );
    } else {
      // Secondary button: frosted glass with theme-aware text
      return GlassContainer(
        width: width,
        height: height,
        borderRadius: height / 2,
        blur: 12,
        padding: EdgeInsets.zero,
        color: isDark
            ? Colors.white.withOpacity(0.12)
            : Colors.white.withOpacity(0.35),
        border: Border.all(
          color: isDark
              ? Colors.white.withOpacity(0.25)
              : Colors.black.withOpacity(0.12),
          width: 1.2,
        ),
        child: TextButton(
          onPressed: onPressed,
          style: TextButton.styleFrom(
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(height / 2)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...{
                Icon(icon, size: 18, color: GlassTheme.iconColor(context)),
                const SizedBox(width: 8),
              },
              Text(
                text,
                style: GoogleFonts.inter(
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                  color: GlassTheme.textPrimary(context),
                ),
              ),
            ],
          ),
        ),
      );
    }
  }
}

class GlassIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final Color? iconColor;
  final double size;
  final double? containerSize;

  const GlassIconButton({
    Key? key,
    required this.icon,
    this.onPressed,
    this.iconColor,
    this.size = 20,
    this.containerSize,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final effectiveIconColor =
        iconColor ?? (isDark ? Colors.white : const Color(0xCC000000));
    final effectiveSize = containerSize ?? (size + 20);

    return GlassContainer(
      borderRadius: 50,
      blur: 10,
      padding: EdgeInsets.zero,
      width: effectiveSize,
      height: effectiveSize,
      child: IconButton(
        icon: Icon(icon, size: size, color: effectiveIconColor),
        onPressed: onPressed,
        padding: EdgeInsets.zero,
      ),
    );
  }
}

class DynamicIslandPulse extends StatefulWidget {
  final String text;
  final IconData icon;
  final Color pulseColor;

  const DynamicIslandPulse({
    Key? key,
    required this.text,
    required this.icon,
    this.pulseColor = Colors.greenAccent,
  }) : super(key: key);

  @override
  State<DynamicIslandPulse> createState() => _DynamicIslandPulseState();
}

class _DynamicIslandPulseState extends State<DynamicIslandPulse>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);

    _scaleAnimation = Tween<double>(begin: 1.0, end: 1.05).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOutSine),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulseController,
      builder: (context, child) {
        final pulseValue = _pulseController.value;
        return Transform.scale(
          scale: _scaleAnimation.value,
          child: GlassContainer(
            borderRadius: 30,
            blur: 18,
            color: Colors.black.withOpacity(0.88),
            border: Border.all(
              color: widget.pulseColor
                  .withOpacity(0.2 + (pulseValue * 0.3)),
              width: 1.5,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: widget.pulseColor,
                    boxShadow: [
                      BoxShadow(
                        color: widget.pulseColor.withOpacity(0.5),
                        blurRadius: 6 * pulseValue,
                        spreadRadius: 2 * pulseValue,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(widget.icon, color: Colors.white, size: 14),
                const SizedBox(width: 6),
                Text(
                  widget.text,
                  style: GoogleFonts.inter(
                    color: Colors.white.withOpacity(0.95),
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
