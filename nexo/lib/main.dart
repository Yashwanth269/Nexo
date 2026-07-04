import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:nexo/screens/auth_screen.dart';
import 'package:nexo/screens/home_screen.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/widgets/network_aware_wrapper.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  NetworkHelper.init(); // Initialize connectivity monitor
  final isLoggedIn = await SharedPrefsHelper.isLoggedIn();
  final phone = await SharedPrefsHelper.getPhone();
  final token = await SharedPrefsHelper.getToken();
  
  // If logged in but token is missing, force re-authentication for socket integrity
  final bool showHome = isLoggedIn && phone != null && token != null && token.isNotEmpty;
  if (isLoggedIn && (token == null || token.isEmpty)) {
    await SharedPrefsHelper.clearUserData();
  }
  
  runApp(GigApp(showHome: showHome));
}

class GigApp extends StatelessWidget {
  final bool showHome;
  const GigApp({super.key, required this.showHome});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Local Gig Marketplace',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF6A00),
          primary: const Color(0xFFFF6A00),
          secondary: const Color(0xFF1E3A8A),
          surface: const Color(0xFFFFF8F6),
        ),
        textTheme: GoogleFonts.plusJakartaSansTextTheme(),
        scaffoldBackgroundColor: const Color(0xFFFFF8F6),
      ),
      builder: (context, child) {
        return NetworkAwareWrapper(child: child!);
      },
      home: showHome ? const HomeScreen() : const AuthScreen(),
    );
  }
}
