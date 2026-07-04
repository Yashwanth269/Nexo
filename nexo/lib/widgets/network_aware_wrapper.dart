import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:permission_handler/permission_handler.dart';

class NetworkAwareWrapper extends StatefulWidget {
  final Widget child;
  const NetworkAwareWrapper({super.key, required this.child});

  @override
  State<NetworkAwareWrapper> createState() => _NetworkAwareWrapperState();
}

class _NetworkAwareWrapperState extends State<NetworkAwareWrapper> {
  bool _isOnline = true;
  bool _showFullScreenError = false;

  @override
  void initState() {
    super.initState();
    _isOnline = !NetworkHelper.isOffline;
    NetworkHelper.onConnectionChanged.listen((online) {
      if (mounted) {
        setState(() {
          _isOnline = online;
          if (online) _showFullScreenError = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (!_isOnline) 
          _buildFullScreenError(),
      ],
    );
  }

  Widget _buildFullScreenError() {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 30),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Circular Illustration (Matching Image)
            Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.05),
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Center(
                child: Image.network(
                  "https://cdn-icons-png.flaticon.com/512/7504/7504149.png", // Cloud with lightning icon
                  width: 100,
                  errorBuilder: (c, e, s) => const Icon(Icons.cloud_off_rounded, size: 80, color: Color(0xFFFF6A00)),
                ),
              ),
            ),
            const SizedBox(height: 50),
            Text(
              "No internet connection",
              style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.black87),
            ),
            const SizedBox(height: 12),
            Text(
              "Please check your network and try again",
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: Colors.black54, fontSize: 16, height: 1.5),
            ),
            const SizedBox(height: 40),
            
            // Retry Button
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: () async {
                  debugPrint("🔄 [NETWORK] Manual retry triggered");
                  await NetworkHelper.forceCheck();
                },
                icon: const Icon(Icons.refresh_rounded, color: Colors.white),
                label: Text("Retry", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  elevation: 0,
                ),
              ),
            ),
            const SizedBox(height: 16),
            
            // Settings Button
            SizedBox(
              width: double.infinity,
              height: 56,
              child: OutlinedButton(
                onPressed: () {
                  debugPrint("⚙️ [NETWORK] Opening settings");
                  openAppSettings();
                },
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Color(0xFF5D78FF), width: 1.5),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: Text(
                  "Check Network Settings", 
                  style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 16, color: const Color(0xFF5D78FF)),
                ),
              ),
            ),
            const SizedBox(height: 40),
            
            // Tips Card
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF7F2), // Very light orange
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFFFE4D1)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, color: Color(0xFF5D78FF), size: 24),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Tips for connection",
                          style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.black87),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          "Switch to Wi-Fi or check if Airplane Mode is on.",
                          style: GoogleFonts.inter(fontSize: 12, color: Colors.black54),
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
    );
  }
}
