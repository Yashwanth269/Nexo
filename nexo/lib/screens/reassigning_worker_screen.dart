import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/ongoing_job_screen.dart';

class ReassigningWorkerScreen extends StatefulWidget {
  final Map<String, dynamic> job;
  const ReassigningWorkerScreen({super.key, required this.job});

  @override
  State<ReassigningWorkerScreen> createState() => _ReassigningWorkerScreenState();
}

class _ReassigningWorkerScreenState extends State<ReassigningWorkerScreen> {
  Timer? _timer;
  final String baseUrl = 'http://10.0.2.2:5000';

  @override
  void initState() {
    super.initState();
    _startPolling();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startPolling() {
    _timer = Timer.periodic(const Duration(seconds: 3), (t) => _checkStatus());
  }

  Future<void> _checkStatus() async {
    final phone = await SharedPrefsHelper.getPhone();
    if (phone == null) return;

    try {
      final response = await http.get(Uri.parse('$baseUrl/api/jobs/$phone/ongoing'));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          final job = data['job'];
          
          if (job['status'] == 'ACCEPTED') {
            _timer?.cancel();
            // Show success message briefly then go to ongoing
            _showSuccessAndNavigate(job);
          } else if (job['status'] == 'FAILED') {
            _timer?.cancel();
            Navigator.pop(context); // Go back or to failure screen
          }
        }
      }
    } catch (e) {
      debugPrint("Reassign polling error: $e");
    }
  }

  void _showSuccessAndNavigate(Map<String, dynamic> job) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text("New worker assigned!"),
        backgroundColor: Colors.green,
        duration: Duration(seconds: 2),
      ),
    );
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (context) => OngoingJobScreen(initialJob: job)),
    );
  }

  @override
  Widget build(BuildContext context) {
    const Color primaryColor = Color(0xFFFF6A00);
    const Color textPrimary = Color(0xFF1A1A1A);
    const Color textSecondary = Color(0xFF6B7280);

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(30.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              // Calm Loader
              Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 120,
                    height: 120,
                    child: CircularProgressIndicator(
                      strokeWidth: 4,
                      valueColor: AlwaysStoppedAnimation<Color>(primaryColor.withOpacity(0.1)),
                    ),
                  ),
                  const SizedBox(
                    width: 100,
                    height: 100,
                    child: CircularProgressIndicator(
                      strokeWidth: 6,
                      valueColor: AlwaysStoppedAnimation<Color>(primaryColor),
                    ),
                  ),
                  const Icon(Icons.sync, size: 40, color: primaryColor),
                ],
              ),
              const SizedBox(height: 50),
              Text(
                "Finding another worker...",
                style: GoogleFonts.outfit(fontSize: 26, fontWeight: FontWeight.bold, color: textPrimary),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                "Please wait, we are checking nearby workers to handle your request quickly.",
                style: GoogleFonts.inter(fontSize: 16, color: textSecondary, height: 1.5),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                "This may take a few seconds",
                style: GoogleFonts.inter(fontSize: 14, color: primaryColor, fontWeight: FontWeight.w500),
              ),
              const Spacer(),
              
              // Action Buttons
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: () => Navigator.pop(context),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 18),
                  ),
                  child: Text("Cancel Request", style: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.red)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
