import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:nexo/screens/post_job_screen.dart';

class NoWorkersFoundScreen extends StatelessWidget {
  final Map<String, dynamic> job;
  const NoWorkersFoundScreen({super.key, required this.job});

  @override
  Widget build(BuildContext context) {
    const Color primaryColor = Color(0xFFFF6A00);
    const Color textPrimary = Color(0xFF1A1A1A);
    const Color textSecondary = Color(0xFF6B7280);

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 40),
          child: Column(
            children: [
              const Spacer(),
              // Friendly Illustration Placeholder
              Container(
                height: 200,
                width: 200,
                decoration: BoxDecoration(
                  color: primaryColor.withOpacity(0.05),
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Icon(Icons.person_search, size: 100, color: primaryColor.withOpacity(0.2)),
                      const Icon(Icons.error_outline, size: 40, color: primaryColor),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 40),
              Text(
                "No workers available right now",
                style: GoogleFonts.outfit(fontSize: 26, fontWeight: FontWeight.bold, color: textPrimary),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                "We searched extensively but couldn't find a professional nearby for your request. Try again or choose a different time.",
                style: GoogleFonts.inter(fontSize: 15, color: textSecondary, height: 1.5),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 30),
              // Tip Box
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.blue[50],
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.lightbulb_outline, color: Colors.blue),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        "Tip: More workers are usually available in the evening between 5-7 PM.",
                        style: GoogleFonts.inter(color: Colors.blue[800], fontSize: 13, fontWeight: FontWeight.w500),
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              
              // Action Buttons
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pushReplacement(
                      context,
                      MaterialPageRoute(builder: (context) => PostJobScreen(
                        initialTask: job['category'],
                        initialImage: null, // or reuse if possible
                      )),
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: primaryColor,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 18),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                  child: Text("Try Again", style: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: () => Navigator.pop(context),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 18),
                  ),
                  child: Text("Post for Later", style: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary)),
                ),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.help_outline, size: 18, color: textSecondary),
                label: Text("Need help?", style: GoogleFonts.inter(color: textSecondary, fontSize: 14)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
