import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class TicketStatusScreen extends StatelessWidget {
  final String ticketId;
  const TicketStatusScreen({super.key, required this.ticketId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(icon: const Icon(Icons.arrow_back, color: Color(0xFFFF6A00)), onPressed: () => Navigator.pop(context)),
        title: Text("Help & Support", style: GoogleFonts.outfit(color: Colors.black, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(icon: const Icon(Icons.account_circle_outlined, color: Colors.grey), onPressed: () {}),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            const SizedBox(height: 20),
            Container(
              width: 200,
              height: 200,
              decoration: BoxDecoration(color: const Color(0xFFFFC09F).withOpacity(0.3), shape: BoxShape.circle),
              child: const Center(child: Icon(Icons.mark_chat_read_outlined, size: 80, color: Color(0xFF994B00))),
            ),
            const SizedBox(height: 32),
            Text("Your request is being reviewed", style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold, height: 1.2), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Text("We've received your inquiry. Our support specialist will review the details and get back to you within 24 hours.", 
              style: GoogleFonts.inter(color: Colors.black54, height: 1.5), textAlign: TextAlign.center),
            const SizedBox(height: 40),
            _buildStatusCard(),
            const SizedBox(height: 40),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: () => Navigator.popUntil(context, (route) => route.isFirst),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF994B00), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                child: Text("Back to Home", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: OutlinedButton(
                onPressed: () {},
                style: OutlinedButton.styleFrom(side: const BorderSide(color: Color(0xFF1E3A8A)), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                child: Text("View My Tickets", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF1E3A8A))),
              ),
            ),
            const SizedBox(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.verified_user_outlined, size: 16, color: Color(0xFF1E3A8A)),
                const SizedBox(width: 8),
                Text("Secured Support Response", style: GoogleFonts.inter(fontSize: 12, color: Colors.black26, fontWeight: FontWeight.bold)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusCard() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: const Color(0xFFFEE2E2))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text("TICKET ID", style: GoogleFonts.inter(fontSize: 12, color: Colors.black26, fontWeight: FontWeight.bold)),
              Text("#$ticketId", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF1E3A8A))),
            ],
          ),
          const SizedBox(height: 24),
          _buildStep(Icons.check_circle, "Request Submitted", "Today at 10:45 AM", true),
          _buildStepDivider(true),
          _buildStep(Icons.radio_button_checked, "Under Review", "Assigned to Support Team", true),
          _buildStepDivider(false),
          _buildStep(Icons.pending_actions, "Resolution", "Pending action", false),
        ],
      ),
    );
  }

  Widget _buildStep(IconData icon, String title, String sub, bool active) {
    return Row(
      children: [
        Icon(icon, color: active ? const Color(0xFF994B00) : Colors.black12, size: 24),
        const SizedBox(width: 16),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: active ? Colors.black : Colors.black26)),
            Text(sub, style: GoogleFonts.inter(fontSize: 12, color: Colors.black26)),
          ],
        ),
      ],
    );
  }

  Widget _buildStepDivider(bool active) {
    return Container(
      margin: const EdgeInsets.only(left: 11),
      height: 24,
      width: 2,
      color: active ? const Color(0xFF994B00).withOpacity(0.3) : Colors.black12,
    );
  }
}
