import 'package:flutter/material.dart';

class ThemeUtils {
  static bool isDarkMode(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark;
  }

  static Color getScaffoldBg(BuildContext context) {
    return isDarkMode(context) ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC);
  }

  static Color getCardBg(BuildContext context) {
    return isDarkMode(context) ? const Color(0xFF1E293B) : Colors.white;
  }

  static Color getTextPrimary(BuildContext context) {
    return isDarkMode(context) ? Colors.white : const Color(0xFF0F172A);
  }

  static Color getTextSecondary(BuildContext context) {
    return isDarkMode(context) ? const Color(0xFF94A3B8) : const Color(0xFF64748B);
  }

  static Color getBorderColor(BuildContext context) {
    return isDarkMode(context) ? const Color(0xFF334155) : const Color(0xFFE2E8F0);
  }

  static BoxDecoration buildBoxDecoration(
    BuildContext context, {
    Color? borderColor,
    double borderRadius = 20.0,
    Color? fillColor,
  }) {
    final isDark = isDarkMode(context);
    final defaultBorderColor = getBorderColor(context);
    final activeBorderColor = borderColor ?? defaultBorderColor;

    return BoxDecoration(
      color: fillColor ?? getCardBg(context),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: activeBorderColor,
        width: isDark ? 1.5 : 1.0,
      ),
      boxShadow: isDark
          ? [
              BoxShadow(
                color: activeBorderColor.withValues(alpha: 0.15),
                blurRadius: 10,
                spreadRadius: 1,
              )
            ]
          : [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 16,
                offset: const Offset(0, 4),
              )
            ],
    );
  }
}
