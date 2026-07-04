import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';
import 'ticket_status_screen.dart';

class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key});

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  String _selectedIssueType = "Job Issue";
  final TextEditingController _issueController = TextEditingController();
  bool _isSubmitting = false;

  Future<void> _submitTicket() async {
    if (_issueController.text.isEmpty) return;

    setState(() => _isSubmitting = true);
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('worker_phone');

    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/support/tickets'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'workerPhone': phone,
          'issueType': _selectedIssueType,
          'description': _issueController.text,
        }),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (context) => TicketStatusScreen(ticketId: data['ticketId'])),
          );
        }
      }
    } catch (e) {
      debugPrint("Error submitting ticket: $e");
    } finally {
      setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        automaticallyImplyLeading: false,
        title: Text("Help & Support", style: GoogleFonts.outfit(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold)),
        actions: [
          IconButton(icon: const Icon(Icons.account_circle_outlined, color: Colors.grey), onPressed: () {}),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSupportHeader(),
            const SizedBox(height: 32),
            Text("Quick Actions", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            _buildQuickAction("Call Support", "Instant connection", Icons.phone_outlined, const Color(0xFFFFF7ED), const Color(0xFFFF6A00)),
            _buildQuickAction("Chat with Support", "2 min wait time", Icons.chat_bubble_outline, const Color(0xFFEEF2FF), const Color(0xFF4F46E5)),
            _buildQuickAction("Report an Issue", "Log a formal ticket", Icons.error_outline, const Color(0xFFFEF2F2), const Color(0xFFEF4444)),
            const SizedBox(height: 32),
            _buildTicketForm(),
            const SizedBox(height: 32),
            _buildHelpCenterLink(),
          ],
        ),
      ),
    );
  }

  Widget _buildSupportHeader() {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFFFF6A00), Color(0xFFEE8100)]),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Stack(
        children: [
          Positioned(
            right: -20,
            top: -20,
            child: Icon(Icons.support_agent, size: 140, color: Colors.white.withOpacity(0.1)),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("We're here to help", style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
                const SizedBox(height: 8),
                Text("Find solutions to your issues or contact our dedicated support team.", style: GoogleFonts.inter(color: Colors.white.withOpacity(0.9), height: 1.5)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickAction(String title, String sub, IconData icon, Color bg, Color iconCol) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
            child: Icon(icon, color: iconCol),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
                Text(sub, style: GoogleFonts.inter(color: Colors.black26, fontSize: 12)),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: Colors.black12),
        ],
      ),
    );
  }

  Widget _buildTicketForm() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Raise a Ticket", style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          Text("Select Issue Type", style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: ["Earnings Issue", "Job Execution", "Map/GPS Error", "App Problem", "Safety Concern"].map((type) => ChoiceChip(
              label: Text(type),
              selected: _selectedIssueType == type,
              onSelected: (val) => setState(() => _selectedIssueType = type),
              selectedColor: const Color(0xFFFF6A00),
              labelStyle: TextStyle(color: _selectedIssueType == type ? Colors.white : Colors.black54, fontSize: 12),
              backgroundColor: const Color(0xFFF9FAFB),
            )).toList(),
          ),
          const SizedBox(height: 24),
          Text("Describe your issue", style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          TextField(
            controller: _issueController,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: "Please provide as much detail as possible...",
              hintStyle: const TextStyle(color: Colors.black26, fontSize: 14),
              filled: true,
              fillColor: const Color(0xFFF9FAFB),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton.icon(
              onPressed: _isSubmitting ? null : _submitTicket,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF6A00),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              icon: _isSubmitting ? const SizedBox() : const Icon(Icons.send_outlined, color: Colors.white),
              label: _isSubmitting 
                ? const CircularProgressIndicator(color: Colors.white)
                : Text("Submit", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHelpCenterLink() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: const Color(0xFFFFF1EB), borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          const Icon(Icons.lightbulb_outline, color: Color(0xFFFF6A00)),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("Check our Help Center", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13)),
                Text("Common questions about payments might already have an answer.", style: GoogleFonts.inter(fontSize: 11, color: Colors.black54)),
                const SizedBox(height: 8),
                Text("Visit FAQs ↗", style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00))),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
