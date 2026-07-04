import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../utils/network_helper.dart';
import '../auth/login_screen.dart';
import '../profile/profile_setup_screen.dart';

class SettingsScreen extends StatefulWidget {
  final dynamic worker;
  const SettingsScreen({super.key, required this.worker});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _isLoading = false;
  String _locationPermission = "Checking...";

  String? _getPhotoUrl() {
    if (widget.worker == null || widget.worker['photoUrl'] == null) return null;
    final String url = widget.worker['photoUrl'];
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return '${NetworkHelper.baseUrl}$url';
  }

  @override
  void initState() {
    super.initState();
    _checkPermissions();
  }

  Future<void> _checkPermissions() async {
    final status = await Permission.location.status;
    setState(() {
      _locationPermission = status.isGranted ? "Always On" : "Off";
    });
  }

  Future<void> _handleLogout({bool allDevices = false}) async {
    setState(() => _isLoading = true);
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('worker_phone');

    try {
      final endpoint = allDevices ? 'logout-all' : 'logout';
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/worker/auth/$endpoint'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'phoneNumber': phone}),
      );

      await prefs.clear();
      if (mounted) {
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (context) => const LoginScreen()),
          (route) => false,
        );
      }
    } catch (e) {
      debugPrint("Logout error: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(icon: const Icon(Icons.arrow_back, color: Color(0xFFFF6A00)), onPressed: () => Navigator.pop(context)),
        title: Text("Settings", style: GoogleFonts.outfit(color: Colors.black, fontWeight: FontWeight.bold)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildProfileSummary(),
            const SizedBox(height: 32),
            _buildSectionHeader("Account"),
            _buildSettingItem("Edit Profile", Icons.person_outline, onTap: () {
              Navigator.push(context, MaterialPageRoute(builder: (context) => ProfileSetupScreen(phoneNumber: widget.worker['phoneNumber'], isEdit: true)));
            }),
            _buildSettingItem("Change Phone Number", Icons.phone_outlined, onTap: () {}),
            const SizedBox(height: 32),
            _buildSectionHeader("Permissions"),
            _buildSettingItem("Location Access", Icons.gps_fixed_outlined, trailing: _buildTag(_locationPermission, const Color(0xFFEEF2FF), const Color(0xFF4F46E5)), onTap: () async {
              await Permission.location.request();
              await openAppSettings();
            }),
            _buildSettingItem("Notification Access", Icons.notifications_none, onTap: () async {
              await Permission.notification.request();
              await openAppSettings();
            }),
            const SizedBox(height: 32),
            _buildSectionHeader("Security"),
            _buildSettingItem("Logout", Icons.logout_outlined, onTap: _handleLogout),
            _buildSettingItem("Logout from all devices", Icons.devices_outlined, onTap: () => _handleLogout(allDevices: true)),
            const SizedBox(height: 32),
            _buildSectionHeader("Support"),
            _buildSettingItem("Help & Support", Icons.help_outline, onTap: () {}),
            _buildSettingItem("Privacy Policy", Icons.security_outlined, onTap: () {}),
            _buildSettingItem("Terms & Conditions", Icons.description_outlined, onTap: () {}),
            const SizedBox(height: 40),
            Center(
              child: Column(
                children: [
                  Text("App Version 2.4.1 (2024)", style: GoogleFonts.inter(color: Colors.black26, fontSize: 12)),
                  const SizedBox(height: 4),
                  Text("DIGNITY OF LABOR", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF994B00), letterSpacing: 2, fontSize: 10)),
                ],
              ),
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildProfileSummary() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
      child: Row(
        children: [
          Stack(
            children: [
              CircleAvatar(
                radius: 35, 
                backgroundColor: const Color(0xFFFF6A00).withOpacity(0.1),
                child: widget.worker['photoUrl'] != null 
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(35),
                      child: Image.network(_getPhotoUrl()!, fit: BoxFit.cover, errorBuilder: (c, e, s) => _buildInitials()),
                    )
                  : _buildInitials(),
              ),
              Positioned(
                bottom: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: BoxDecoration(color: widget.worker['performance']['isVerified'] ? const Color(0xFF22C55E) : Colors.grey, shape: BoxShape.circle),
                  child: const Icon(Icons.verified, color: Colors.white, size: 14),
                ),
              ),
            ],
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.worker['name'] ?? "Worker", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold)),
                Text("Verified Worker • ${widget.worker['performance']['rating']} ★", style: GoogleFonts.inter(color: Colors.black45, fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInitials() {
    String name = widget.worker['name'] ?? "";
    String initials = "W";
    if (name.isNotEmpty) {
      List<String> parts = name.split(' ');
      initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0][0].toUpperCase();
    }
    return Text(initials, style: const TextStyle(fontSize: 24, color: Color(0xFFFF6A00), fontWeight: FontWeight.bold));
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 8, bottom: 12),
      child: Text(title, style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black54)),
    );
  }

  Widget _buildSettingItem(String title, IconData icon, {Widget? trailing, VoidCallback? onTap}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 2),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        onTap: onTap,
        leading: Icon(icon, color: const Color(0xFFFF6A00), size: 22),
        title: Text(title, style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w500)),
        trailing: trailing ?? const Icon(Icons.chevron_right, color: Colors.black12),
      ),
    );
  }

  Widget _buildTag(String label, Color bg, Color textCol) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: textCol)),
    );
  }
}
