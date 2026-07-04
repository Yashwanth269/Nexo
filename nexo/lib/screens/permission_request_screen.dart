import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:nexo/services/permission_service.dart';

class PermissionRequestScreen extends StatelessWidget {
  final Permission permission;
  final String title;
  final String description;
  final String iconUrl;
  final List<Map<String, dynamic>> features;

  const PermissionRequestScreen({
    super.key,
    required this.permission,
    required this.title,
    required this.description,
    required this.iconUrl,
    required this.features,
  });

  static Future<bool> show({
    required BuildContext context,
    required Permission permission,
    required String title,
    required String description,
    required String iconUrl,
    required List<Map<String, dynamic>> features,
  }) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (context) => PermissionRequestScreen(
          permission: permission,
          title: title,
          description: description,
          iconUrl: iconUrl,
          features: features,
        ),
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF1F2937)),
          onPressed: () => Navigator.pop(context, false),
        ),
        title: Text(
          "Permissions",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF1F2937)),
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          children: [
            const SizedBox(height: 20),
            // Illustration Container
            Container(
              height: 300,
              width: double.infinity,
              decoration: BoxDecoration(
                color: const Color(0xFFF9FAFB),
                borderRadius: BorderRadius.circular(24),
              ),
              child: Center(
                child: Image.network(
                  iconUrl,
                  height: 180,
                  errorBuilder: (c, e, s) => const Icon(Icons.security, size: 100, color: Color(0xFFFF6A00)),
                ),
              ),
            ),
            const SizedBox(height: 32),
            Text(
              title,
              style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: const Color(0xFF1F2937)),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            Text(
              description,
              style: GoogleFonts.inter(fontSize: 15, color: const Color(0xFF6B7280), height: 1.5),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            // Feature Grid
            Row(
              children: features.map((f) => Expanded(child: _buildFeatureCard(f))).toList(),
            ),
            const Spacer(),
            // Action Buttons
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: () async {
                  final status = await permission.request();
                  if (status.isGranted) {
                    if (context.mounted) Navigator.pop(context, true);
                  } else if (status.isPermanentlyDenied) {
                    if (context.mounted) {
                      _showSettingsDialog(context);
                    }
                  } else {
                    if (context.mounted) Navigator.pop(context, false);
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
                child: Text(
                  title.split(' ').last == 'Access' ? "Allow ${title.split(' ')[1]}" : "Allow Permission",
                  style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(
                "Not Now",
                style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 16, color: const Color(0xFF6B7280)),
              ),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.verified_user_outlined, size: 16, color: Color(0xFF6B7280)),
                const SizedBox(width: 8),
                Text(
                  "Your privacy is our priority",
                  style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF6B7280)),
                ),
              ],
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildFeatureCard(Map<String, dynamic> feature) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 6),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFFE4D1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(feature['icon'], color: const Color(0xFFFF6A00), size: 24),
          const SizedBox(height: 12),
          Text(
            feature['title'],
            style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF1F2937)),
          ),
          const SizedBox(height: 4),
          Text(
            feature['description'],
            style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF6B7280), height: 1.3),
          ),
        ],
      ),
    );
  }

  void _showSettingsDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Permission Denied"),
        content: const Text("You have permanently denied this permission. Please enable it in system settings to use this feature."),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text("Cancel")),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              PermissionService.openSettings();
            }, 
            child: const Text("Open Settings", style: TextStyle(color: Color(0xFFFF6A00))),
          ),
        ],
      ),
    );
  }
}
