import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:nexo/services/shared_prefs_helper.dart';

class SupportScreen extends StatefulWidget {
  final String? jobId;
  const SupportScreen({super.key, this.jobId});

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  List<dynamic> _faqs = [];
  bool _isLoading = true;
  final String baseUrl = 'http://10.0.2.2:5000';

  @override
  void initState() {
    super.initState();
    _fetchFaqs();
  }

  Future<void> _fetchFaqs() async {
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('$baseUrl/api/support/faqs'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          setState(() {
            _faqs = data['faqs'];
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      debugPrint("Error fetching FAQs: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFFFF6A00)),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text("Help & Support", style: GoogleFonts.outfit(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.account_circle_outlined, color: Colors.grey),
            onPressed: () {},
          ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            _buildWelcomeHeader(),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _buildSupportCard(Icons.call_outlined, "Call Support", "Speak to our team immediately", () => launchUrl(Uri.parse("tel:1800123456"))),
                  const SizedBox(height: 12),
                  _buildSupportCard(Icons.chat_bubble_outline, "Chat with Support", "Real-time messaging", () {}),
                  const SizedBox(height: 12),
                  _buildSupportCard(Icons.report_problem_outlined, "Report an Issue", "Disputes, delays, or safety", () {
                    if (widget.jobId != null) {
                      // Navigate to specialized reporting if needed
                    }
                  }),
                  const SizedBox(height: 24),
                  _buildEmergencyBanner(),
                  const SizedBox(height: 32),
                  _buildFaqSection(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWelcomeHeader() {
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 24),
      child: Column(
        children: [
          Container(
            width: 100,
            height: 100,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFFF6A00).withOpacity(0.1), width: 4),
              image: const DecorationImage(image: NetworkImage("https://img.freepik.com/free-photo/customer-service-operator-with-headset-working-office_23-2148850943.jpg"), fit: BoxFit.cover),
            ),
          ),
          const SizedBox(height: 20),
          Text("We are here to help you", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(
            "Whether you have a question about a job or need technical assistance, our team is ready to support you 24/7.",
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(color: Colors.black54, height: 1.5, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildSupportCard(IconData icon, String title, String subtitle, VoidCallback onTap) {
    return Container(
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.grey[100]!)),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        leading: Icon(icon, color: const Color(0xFFFF6A00), size: 28),
        title: Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16)),
        subtitle: Text(subtitle, style: GoogleFonts.inter(color: Colors.black45, fontSize: 12)),
        trailing: const Icon(Icons.chevron_right, color: Colors.grey, size: 20),
      ),
    );
  }

  Widget _buildEmergencyBanner() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFFCA5A5).withOpacity(0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: const Icon(Icons.warning_amber_rounded, color: Color(0xFFDC2626), size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("Need immediate help?", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF991B1B))),
                const SizedBox(height: 4),
                Text(
                  "For critical safety issues or emergencies during a job, use our 24/7 priority line.",
                  style: GoogleFonts.inter(color: const Color(0xFF991B1B).withOpacity(0.8), fontSize: 13, height: 1.4),
                ),
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () => launchUrl(Uri.parse("tel:112")),
                  icon: const Icon(Icons.phone_forwarded, size: 16, color: Color(0xFFDC2626)),
                  label: Text("Call Now", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFFDC2626))),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFaqSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text("Common Questions", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        ..._faqs.map((faq) => Container(
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
          child: ListTile(
            title: Text(faq['question'], style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w500)),
            trailing: const Icon(Icons.chevron_right, size: 16, color: Colors.grey),
            onTap: () {},
          ),
        )).toList(),
      ],
    );
  }
}
