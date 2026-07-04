import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class ErrorComponents {
  // 1. Job Already Assigned Dialog
  static void showJobAssignedDialog(BuildContext context) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(color: Color(0xFFFEF2F2), shape: BoxShape.circle),
                child: const Icon(Icons.calendar_today_outlined, color: Color(0xFFDC2626), size: 40),
              ),
              const SizedBox(height: 24),
              Text(
                "Job already assigned",
                style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: const Color(0xFF1F2937)),
              ),
              const SizedBox(height: 12),
              Text(
                "We're sorry, this gig was just taken by another worker. Opportunities move fast on GigMarket!",
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(color: Colors.black54, fontSize: 15, height: 1.5),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  onPressed: () {
                    Navigator.pop(context); // Close dialog
                    Navigator.pop(context); // Go back to search/list
                  },
                  icon: const Icon(Icons.search, size: 20),
                  label: Text("View Other Jobs", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 16)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF6A00),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    side: const BorderSide(color: Color(0xFFE5E7EB)),
                  ),
                  child: Text("Go to My Jobs", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF4B5563), fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 2. Full Screen Error State
  static Widget buildFullScreenError({
    required String title,
    required String message,
    required String errorCode,
    VoidCallback? onRetry,
    VoidCallback? onDashboard,
  }) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: const BackButton(color: Colors.black87),
        title: Text("GigMarket", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00))),
      ),
      body: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 220,
              height: 220,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.grey[50],
                image: const DecorationImage(
                  image: NetworkImage("https://img.freepik.com/free-vector/no-data-concept-illustration_114360-616.jpg"),
                  fit: BoxFit.cover,
                ),
              ),
            ),
            const SizedBox(height: 40),
            Text(
              title,
              textAlign: TextAlign.center,
              style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold, color: const Color(0xFF1F2937)),
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: Colors.black54, fontSize: 16, height: 1.5),
            ),
            const SizedBox(height: 40),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 20),
                label: Text("Retry", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 16)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: OutlinedButton(
                onPressed: onDashboard,
                style: OutlinedButton.styleFrom(
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  side: const BorderSide(color: Color(0xFFE5E7EB)),
                ),
                child: Text("Go to Dashboard", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF4B5563), fontSize: 16)),
              ),
            ),
            const SizedBox(height: 40),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.verified_user_outlined, size: 16, color: Color(0xFF9CA3AF)),
                const SizedBox(width: 8),
                Text(
                  "Error Code: $errorCode",
                  style: GoogleFonts.inter(color: const Color(0xFF9CA3AF), fontSize: 13, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // 3. Global Toast / SnackBar
  static void showUnableToProcessToast(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(0xFF111827),
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        margin: const EdgeInsets.all(16),
        content: Row(
          children: [
            const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                "Unable to process request",
                style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.w500),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close, color: Colors.white54, size: 18),
              onPressed: () => ScaffoldMessenger.of(context).hideCurrentSnackBar(),
            ),
          ],
        ),
      ),
    );
  }
}
