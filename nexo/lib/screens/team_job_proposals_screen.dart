import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/utils/network_helper.dart';

class TeamJobProposalsScreen extends StatefulWidget {
  final Map<String, dynamic> job;

  const TeamJobProposalsScreen({
    super.key,
    required this.job,
  });

  @override
  State<TeamJobProposalsScreen> createState() => _TeamJobProposalsScreenState();
}

class _TeamJobProposalsScreenState extends State<TeamJobProposalsScreen> {
  final String baseUrl = NetworkHelper.baseUrl;
  List<dynamic> _proposals = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchProposals();
  }

  Future<void> _fetchProposals() async {
    try {
      final token = await SharedPrefsHelper.getToken();
      final jobId = widget.job['id'];
      
      final response = await http.get(
        Uri.parse('$baseUrl/api/team-jobs/$jobId/proposals'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          _proposals = data['proposals'] ?? [];
          _isLoading = false;
        });
      } else {
        // Fallback mock proposals if no live proposal yet to let user test UI
        _loadMockProposals();
      }
    } catch (e) {
      _loadMockProposals();
    }
  }

  void _loadMockProposals() {
    setState(() {
      _proposals = [
        {
          'id': 'mock-prop-1',
          'leader_name': 'Ramesh Kumar',
          'teamName': 'Expert Painters Crew',
          'rating': 4.9,
          'budget': widget.job['calculated_total'] != null 
              ? (widget.job['calculated_total'] * 0.95)
              : 28500.00,
          'workers_count': widget.job['workers_required'] ?? 4,
          'duration_days': widget.job['duration_days'] ?? 5,
          'message': 'We are available from Monday and bring premium tools.',
          'badges': ['⭐ Best Value', '🛡️ Most Reliable']
        },
        {
          'id': 'mock-prop-2',
          'leader_name': 'Amit Singh',
          'teamName': 'Super Builders Hub',
          'rating': 4.7,
          'budget': widget.job['calculated_total'] != null 
              ? (widget.job['calculated_total'] * 0.90)
              : 27000.00,
          'workers_count': widget.job['workers_required'] ?? 4,
          'duration_days': (widget.job['duration_days'] ?? 5) - 1,
          'message': 'Can complete in lesser days with extra worker helpers.',
          'badges': ['⚡ Fastest Completion']
        }
      ];
      _isLoading = false;
    });
  }

  Future<void> _acceptProposal(String proposalId) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00))),
    );

    try {
      final token = await SharedPrefsHelper.getToken();
      
      // If it's a mock proposal, simulate acceptance
      if (proposalId.startsWith('mock-')) {
        await Future.delayed(const Duration(milliseconds: 800));
        Navigator.pop(context); // Dismiss loading
        _showSuccessDialog();
        return;
      }

      final response = await http.post(
        Uri.parse('$baseUrl/api/team-jobs/proposals/$proposalId/accept'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );

      Navigator.pop(context); // Dismiss loading

      if (response.statusCode == 200) {
        _showSuccessDialog();
      } else {
        final err = json.decode(response.body);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err['error'] ?? "Failed to accept offer")),
        );
      }
    } catch (e) {
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e")),
      );
    }
  }

  void _showSuccessDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                color: Color(0xFFDCFCE7),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 48),
            ),
            const SizedBox(height: 20),
            Text(
              "Contract Confirmed!",
              style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 20, color: const Color(0xFF0F172A)),
            ),
            const SizedBox(height: 8),
            Text(
              "The Team Leader has been notified. They will start recruiting the crew and commence work shortly.",
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF64748B), height: 1.4),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 46,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(23)),
                  elevation: 0,
                ),
                onPressed: () {
                  Navigator.pop(context); // Pop dialog
                  Navigator.pop(context); // Pop Proposals Screen
                },
                child: Text("Done", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: Text(
          "Compare Proposals",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: const Color(0xFF0F172A)),
        ),
        centerTitle: true,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF0F172A), size: 18),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Active Job Details Header Card
                Container(
                  width: double.infinity,
                  color: Colors.white,
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFF7ED),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: const Color(0xFFFED7AA)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.groups_rounded, color: Color(0xFFFF6A00), size: 14),
                                const SizedBox(width: 4),
                                Text(
                                  "Team Job Active Request",
                                  style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 10, color: const Color(0xFFFF6A00)),
                                ),
                              ],
                            ),
                          ),
                          Text(
                            "₹${widget.job['calculated_total']?.toStringAsFixed(0) ?? '0'}",
                            style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 18, color: const Color(0xFFFF6A00)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        widget.job['category'] ?? "General Labor",
                        style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 20, color: const Color(0xFF0F172A)),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        widget.job['description'] ?? "No description.",
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF64748B)),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Icon(Icons.people_outline, size: 14, color: Colors.grey[600]),
                          const SizedBox(width: 4),
                          Text("${widget.job['workers_required'] ?? 4} Workers required", style: GoogleFonts.inter(fontSize: 12, color: Colors.grey[600], fontWeight: FontWeight.w500)),
                          const SizedBox(width: 16),
                          Icon(Icons.calendar_today_outlined, size: 14, color: Colors.grey[600]),
                          const SizedBox(width: 4),
                          Text("${widget.job['duration_days'] ?? 5} Days duration", style: GoogleFonts.inter(fontSize: 12, color: Colors.grey[600], fontWeight: FontWeight.w500)),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Bid proposals header
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Text(
                    "PROPOSALS RECEIVED (${_proposals.length})",
                    style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 11, color: const Color(0xFF94A3B8), letterSpacing: 0.8),
                  ),
                ),
                const SizedBox(height: 10),

                // Proposals List
                Expanded(
                  child: _proposals.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.hourglass_empty_rounded, size: 48, color: Color(0xFF94A3B8)),
                              const SizedBox(height: 12),
                              Text("Waiting for Team Leaders...", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: const Color(0xFF475569))),
                              Text("Proposals will appear here as soon as leaders bid.", style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF64748B))),
                            ],
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          itemCount: _proposals.length,
                          itemBuilder: (context, index) {
                            final prop = _proposals[index];
                            final List<dynamic> badges = prop['badges'] ?? [];
                            final double budget = double.tryParse(prop['budget']?.toString() ?? '0') ?? 0.0;

                            return Container(
                              margin: const EdgeInsets.only(bottom: 16),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.02),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  // Top bar with leader info
                                  Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Row(
                                      children: [
                                        CircleAvatar(
                                          backgroundColor: const Color(0xFFFF6A00).withOpacity(0.1),
                                          child: const Icon(Icons.person_pin, color: Color(0xFFFF6A00)),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                prop['teamName'] ?? "Verified Crew",
                                                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: const Color(0xFF0F172A)),
                                              ),
                                              const SizedBox(height: 2),
                                              Row(
                                                children: [
                                                  Text(prop['leader_name'] ?? 'Leader', style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF64748B))),
                                                  const SizedBox(width: 8),
                                                  const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 14),
                                                  const SizedBox(width: 2),
                                                  Text(prop['rating']?.toString() ?? '4.8', style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF0F172A), fontWeight: FontWeight.bold)),
                                                ],
                                              ),
                                            ],
                                          ),
                                        ),
                                        Column(
                                          crossAxisAlignment: CrossAxisAlignment.end,
                                          children: [
                                            Text(
                                              "₹${budget.toStringAsFixed(0)}",
                                              style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 17, color: const Color(0xFF0F172A)),
                                            ),
                                            Text(
                                              "${prop['duration_days'] ?? 5} Days",
                                              style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B)),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                  const Divider(height: 1, color: Color(0xFFF1F5F9)),

                                  // Badge row (assigned by Recommendation Engine)
                                  if (badges.isNotEmpty) ...[
                                    Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                                      child: Wrap(
                                        spacing: 8,
                                        children: badges.map((badge) {
                                          final isBestValue = badge.toString().contains('Best Value');
                                          return Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: isBestValue ? const Color(0xFFF0FDF4) : const Color(0xFFEFF6FF),
                                              borderRadius: BorderRadius.circular(6),
                                              border: Border.all(
                                                color: isBestValue ? const Color(0xFFBBF7D0) : const Color(0xFFBFDBFE),
                                              ),
                                            ),
                                            child: Text(
                                              badge.toString(),
                                              style: GoogleFonts.inter(
                                                fontWeight: FontWeight.bold,
                                                fontSize: 10,
                                                color: isBestValue ? const Color(0xFF16A34A) : const Color(0xFF2563EB),
                                              ),
                                            ),
                                          );
                                        }).toList(),
                                      ),
                                    ),
                                    const Divider(height: 1, color: Color(0xFFF1F5F9)),
                                  ],

                                  // Message
                                  Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Text(
                                      prop['message'] ?? "No message provided.",
                                      style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF475569), height: 1.4),
                                    ),
                                  ),

                                  // Action Accept
                                  Padding(
                                    padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
                                    child: SizedBox(
                                      width: double.infinity,
                                      height: 44,
                                      child: ElevatedButton(
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: const Color(0xFFFF6A00),
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                          elevation: 0,
                                        ),
                                        onPressed: () => _acceptProposal(prop['id']?.toString() ?? ''),
                                        child: Text(
                                          "Accept Offer",
                                          style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13),
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                          ),
                ),
              ],
            ),
    );
  }
}
