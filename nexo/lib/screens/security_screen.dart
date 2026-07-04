import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/auth_screen.dart';

class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key});

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  final String baseUrl = 'http://10.0.2.2:5000';
  bool _isLoading = false;

  Future<void> _logoutAllDevices() async {
    setState(() => _isLoading = true);
    final phone = await SharedPrefsHelper.getPhone();
    final token = await SharedPrefsHelper.getToken();
    
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/auth/logout-all'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'phone': phone}),
      );

      if (response.statusCode == 200) {
        await SharedPrefsHelper.clearUserData();
        if (mounted) {
          Navigator.pushAndRemoveUntil(
            context,
            MaterialPageRoute(builder: (context) => const AuthScreen()),
            (route) => false,
          );
        }
      }
    } catch (e) {
      debugPrint("Logout error: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showLogoutDialog() {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: const Color(0xFFFFF7F2), borderRadius: BorderRadius.circular(20)),
                child: const Icon(Icons.phonelink_erase, color: Color(0xFFFF6A00), size: 32),
              ),
              const SizedBox(height: 20),
              Text(
                "Are you sure you want to logout from all devices?",
                textAlign: TextAlign.center,
                style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: const Color(0xFF1F2937)),
              ),
              const SizedBox(height: 12),
              Text(
                "This will end all your active sessions except for this one. You'll need to log back in on other devices.",
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(fontSize: 14, color: const Color(0xFF6B7280), height: 1.5),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pop(context);
                    _logoutAllDevices();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF6A00),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                  child: Text("Confirm", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
                ),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text("Cancel", style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 16, color: const Color(0xFFB45309))),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF1F2937)),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text("Security", style: GoogleFonts.outfit(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const SizedBox(height: 40),
            Center(
              child: Container(
                padding: const EdgeInsets.all(32),
                decoration: BoxDecoration(color: const Color(0xFFFFF7F2), shape: BoxShape.circle),
                child: const Icon(Icons.shield_outlined, size: 80, color: Color(0xFFFF6A00)),
              ),
            ),
            const SizedBox(height: 32),
            _buildSecurityOption(
              icon: Icons.devices_other,
              title: "Logout from all devices",
              subtitle: "End all active sessions on other phones",
              onTap: _showLogoutDialog,
            ),
            const SizedBox(height: 16),
            _buildSecurityOption(
              icon: Icons.security_update_good,
              title: "Login Activity",
              subtitle: "Monitor unusual login behavior",
              onTap: () {},
            ),
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: const Color(0xFFEFF6FF), borderRadius: BorderRadius.circular(16)),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, color: Color(0xFF1D4ED8), size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      "Your security is our priority. If you notice any suspicious activity, contact support immediately.",
                      style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF1D4ED8), height: 1.4),
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

  Widget _buildSecurityOption({required IconData icon, required String title, required String subtitle, required VoidCallback onTap}) {
    return Container(
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10, offset: const Offset(0, 4))]),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        leading: Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: const Color(0xFFF9FAFB), borderRadius: BorderRadius.circular(12)), child: Icon(icon, color: const Color(0xFFFF6A00))),
        title: Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF1F2937))),
        subtitle: Text(subtitle, style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF6B7280))),
        trailing: const Icon(Icons.chevron_right, color: Color(0xFF9CA3AF)),
        onTap: onTap,
      ),
    );
  }
}
