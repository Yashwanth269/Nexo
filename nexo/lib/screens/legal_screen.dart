import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';

class LegalScreen extends StatefulWidget {
  final bool showAcceptButton;
  const LegalScreen({super.key, this.showAcceptButton = false});

  @override
  State<LegalScreen> createState() => _LegalScreenState();
}

class _LegalScreenState extends State<LegalScreen> {
  List<dynamic> _terms = [];
  String _version = "1.0.0";
  String _lastUpdated = "";
  bool _isLoading = true;
  final String baseUrl = 'http://10.0.2.2:5000';

  @override
  void initState() {
    super.initState();
    _fetchTerms();
  }

  Future<void> _fetchTerms() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/api/legal/terms'));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          setState(() {
            _terms = data['terms'];
            _version = data['version'];
            _lastUpdated = data['lastUpdated'];
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      debugPrint("Error fetching terms: $e");
    }
  }

  Future<void> _acceptTerms() async {
    final phone = await SharedPrefsHelper.getPhone();
    if (phone == null) return;

    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/legal/accept'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'phoneNumber': phone, 'version': _version}),
      );
      if (response.statusCode == 200 && mounted) {
        Navigator.pop(context);
      }
    } catch (e) {
      debugPrint("Error accepting terms: $e");
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
        title: Text("Legal Information", style: GoogleFonts.outfit(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold)),
      ),
      body: _isLoading 
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
          : Column(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("Terms & Conditions", style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold, color: const Color(0xFF1F2937))),
                        const SizedBox(height: 4),
                        Text("Last updated: $_lastUpdated", style: GoogleFonts.inter(color: Colors.black45, fontSize: 13)),
                        const SizedBox(height: 32),
                        ..._terms.map((term) => _buildTermCard(term)).toList(),
                        const SizedBox(height: 24),
                        _buildProtocolBadge(),
                        const SizedBox(height: 32),
                        _buildTrustBanner(),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
                ),
                if (widget.showAcceptButton) _buildBottomAction(),
              ],
            ),
    );
  }

  Widget _buildTermCard(dynamic term) {
    IconData iconData;
    Color iconColor;

    switch (term['color']) {
      case 'orange': iconColor = Colors.orange; break;
      case 'blue': iconColor = Colors.blue; break;
      case 'red': iconColor = Colors.red; break;
      case 'deepOrange': iconColor = Colors.deepOrange; break;
      default: iconColor = Colors.grey;
    }

    switch (term['icon']) {
      case 'person_outline': iconData = Icons.person_outline; break;
      case 'settings_outlined': iconData = Icons.settings_outlined; break;
      case 'payments_outlined': iconData = Icons.payments_outlined; break;
      case 'event_busy_outlined': iconData = Icons.event_busy_outlined; break;
      case 'gavel_outlined': iconData = Icons.gavel_outlined; break;
      default: iconData = Icons.info_outline;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: term['id'] == 'liability' ? Border.all(color: Colors.orange.withOpacity(0.3)) : null,
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: iconColor.withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
                child: Icon(iconData, color: iconColor, size: 22),
              ),
              const SizedBox(width: 16),
              Text(term['title'], style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: const Color(0xFF1F2937))),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            term['content'],
            style: GoogleFonts.inter(color: Colors.black87, fontSize: 14, height: 1.6, letterSpacing: 0.2),
          ),
          if (term['id'] == 'service') ...[
            const SizedBox(height: 16),
            _buildCheckRow("Marketplace mediation only."),
            _buildCheckRow("Compliance with local labor laws."),
          ]
        ],
      ),
    );
  }

  Widget _buildCheckRow(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          const Icon(Icons.check_circle_outline, color: Color(0xFF10B981), size: 16),
          const SizedBox(width: 8),
          Text(text, style: GoogleFonts.inter(fontSize: 13, color: Colors.black54, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _buildProtocolBadge() {
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFFEEF2FF),
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: const Color(0xFFC7D2FE)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.verified_user_outlined, color: Color(0xFF4F46E5), size: 18),
            const SizedBox(width: 10),
            Text("Verified Marketplace Protocol", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF4F46E5), fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Widget _buildTrustBanner() {
    return Container(
      width: double.infinity,
      height: 180,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        image: const DecorationImage(
          image: NetworkImage("https://images.unsplash.com/photo-1521791136064-7986c2959213?auto=format&fit=crop&q=80&w=800"),
          fit: BoxFit.cover,
        ),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black.withOpacity(0.8)]),
        ),
        padding: const EdgeInsets.all(24),
        alignment: Alignment.bottomLeft,
        child: Text(
          "By continuing, you agree to our community standards and trust protocols.",
          style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14, height: 1.4),
        ),
      ),
    );
  }

  Widget _buildBottomAction() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0xFFE5E7EB)))),
      child: SizedBox(
        width: double.infinity,
        height: 56,
        child: ElevatedButton.icon(
          onPressed: _acceptTerms,
          icon: const Icon(Icons.chevron_right, size: 20),
          label: Text("Accept & Continue", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16)),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFFF6A00),
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            elevation: 0,
          ),
        ),
      ),
    );
  }
}
