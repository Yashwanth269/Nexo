import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ThemeManager {
  static final ValueNotifier<ThemeMode> themeModeNotifier = ValueNotifier(ThemeMode.system);

  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final themeStr = prefs.getString('theme_mode') ?? 'system';
      if (themeStr == 'dark') {
        themeModeNotifier.value = ThemeMode.dark;
      } else if (themeStr == 'light') {
        themeModeNotifier.value = ThemeMode.light;
      } else {
        themeModeNotifier.value = ThemeMode.system;
      }
    } catch (e) {
      themeModeNotifier.value = ThemeMode.system;
    }
  }

  static Future<void> setThemeMode(ThemeMode mode) async {
    themeModeNotifier.value = mode;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('theme_mode', mode.name);
    } catch (e) {
      // Ignore storage errors
    }
  }
}
