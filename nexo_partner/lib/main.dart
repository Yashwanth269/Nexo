import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens/auth/login_screen.dart';
import 'screens/home/home_screen.dart';
import 'screens/profile/profile_setup_screen.dart';

import 'package:nexo_partner/services/cache_service.dart';
import 'package:nexo_partner/services/background_service.dart';
import 'package:nexo_partner/services/notification_service.dart';
import 'package:nexo_partner/utils/theme_manager.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await BackgroundTracker.initializeService();
  await LocalNotificationService.initialize();
  await CacheService.init();
  await ThemeManager.init(); // Load active theme from preferences

  final prefs = await SharedPreferences.getInstance();
  final String? token = prefs.getString('worker_token');
  final bool isProfileComplete = prefs.getBool('isProfileComplete') ?? false;
  final String? phone = prefs.getString('workerPhone');

  Widget initialScreen = const LoginScreen();
  if (token != null) {
    if (isProfileComplete) {
      initialScreen = const HomeScreen();
    } else if (phone != null) {
      initialScreen = ProfileSetupScreen(phoneNumber: phone);
    }
  }

  runApp(NexoPartnerApp(initialScreen: initialScreen));
}

class NexoPartnerApp extends StatelessWidget {
  final Widget initialScreen;
  const NexoPartnerApp({super.key, required this.initialScreen});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: ThemeManager.themeModeNotifier,
      builder: (context, currentThemeMode, child) {
        return MaterialApp(
          title: 'Nexo Partner',
          debugShowCheckedModeBanner: false,
          themeMode: currentThemeMode,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFFFF6A00),
              brightness: Brightness.light,
            ),
            useMaterial3: true,
            textTheme: GoogleFonts.interTextTheme(),
            scaffoldBackgroundColor: const Color(0xFFF8FAFC),
          ),
          darkTheme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFFFF6A00),
              brightness: Brightness.dark,
            ),
            useMaterial3: true,
            textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme),
            scaffoldBackgroundColor: const Color(0xFF0F172A),
          ),
          home: initialScreen,
        );
      },
    );
  }
}

