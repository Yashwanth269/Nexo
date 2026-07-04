import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';

class ReportWorkerScreen extends StatefulWidget {
  final Map<String, dynamic> worker;
  final String jobId;

  const ReportWorkerScreen({super.key, required this.worker, required this.jobId});

  @override
  State<ReportWorkerScreen> createState() => _ReportWorkerScreenState();
}

class _ReportWorkerScreenState extends State<ReportWorkerScreen> {
  String? _selectedReason;
  final TextEditingController _detailsController = TextEditingController();
  bool _isSubmitting = false;
  final String baseUrl = 'http://10.0.2.2:5000';

  final List<String> _reasons = [
    "Late arrival",
    "Bad behavior",
    "Overcharging",
    "Fraud",
    "Other"
  ];

  Future<void> _submitReport() async {
    if (_selectedReason == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Please select a reason")),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    final userId = await SharedPrefsHelper.getPhone();

    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.post(
        Uri.parse('$baseUrl/api/safety/report'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'userId': userId,
          'workerId': widget.worker['phoneNumber'],
          'reason': _selectedReason,
          'jobId': widget.jobId,
          'description': _detailsController.text,
        }),
      );

      if (mounted) {
        final data = json.decode(response.body);
        if (data['success']) {
          _showSuccessSheet("Report Submitted", "Thank you for helping us keep our community safe. We will review this report immediately.");
        }
      }
    } catch (e) {
      debugPrint("Report error: $e");
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _blockWorker() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text("Block Worker?", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
        content: Text("You will no longer see ${widget.worker['name']} in your matches or suggestions. This action is permanent."),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Cancel")),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text("Block", style: TextStyle(color: Colors.red))),
        ],
      ),
    );

    if (confirmed == true) {
      setState(() => _isSubmitting = true);
      final userId = await SharedPrefsHelper.getPhone();
      try {
        final token = await SharedPrefsHelper.getToken();
        final response = await http.post(
          Uri.parse('$baseUrl/api/safety/block'),
          headers: {
            'Content-Type': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
          body: json.encode({
            'userId': userId,
            'workerId': widget.worker['phoneNumber'],
          }),
        );
        if (mounted) {
          final data = json.decode(response.body);
          if (data['success']) {
            _showSuccessSheet("Worker Blocked", "${widget.worker['name']} has been blocked and will not appear in your future matches.");
          }
        }
      } catch (e) {
        debugPrint("Block error: $e");
      } finally {
        if (mounted) setState(() => _isSubmitting = false);
      }
    }
  }

  void _showSuccessSheet(String title, String message) {
    showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(30))),
      builder: (context) => Container(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(color: Color(0xFFFFF7F2), shape: BoxShape.circle),
              child: const Icon(Icons.check_circle, color: Color(0xFFFF6A00), size: 40),
            ),
            const SizedBox(height: 24),
            Text(title, style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: Colors.black54, fontSize: 15, height: 1.5),
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context); // Close sheet
                  Navigator.pop(context); // Close report screen
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
                child: Text("Close", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 16)),
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
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF1F2937)),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text("Report Worker", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF1F2937))),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildWorkerCard(),
            const SizedBox(height: 24),
            Text("REASON FOR REPORTING", style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: const Color(0xFF4B3621).withOpacity(0.8), letterSpacing: 1.2)),
            const SizedBox(height: 16),
            ..._reasons.map((reason) => _buildReasonItem(reason)).toList(),
            const SizedBox(height: 24),
            Text("ADDITIONAL DETAILS", style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: const Color(0xFF4B3621).withOpacity(0.8), letterSpacing: 1.2)),
            const SizedBox(height: 12),
            TextField(
              controller: _detailsController,
              maxLines: 4,
              decoration: InputDecoration(
                hintText: "Add details (optional)",
                hintStyle: GoogleFonts.inter(color: Colors.grey[400]),
                filled: true,
                fillColor: Colors.white,
                contentPadding: const EdgeInsets.all(16),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: Colors.grey[200]!)),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: Colors.grey[200]!)),
              ),
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: _isSubmitting ? null : _submitReport,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
                child: _isSubmitting
                    ? const CircularProgressIndicator(color: Colors.white)
                    : Text("Submit Report", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
              ),
            ),
            const SizedBox(height: 20),
            Center(
              child: TextButton.icon(
                onPressed: _isSubmitting ? null : _blockWorker,
                icon: const Icon(Icons.block, color: Color(0xFFDC2626), size: 20),
                label: Text("Block Worker", style: GoogleFonts.inter(color: const Color(0xFFDC2626), fontWeight: FontWeight.bold, fontSize: 16)),
              ),
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildWorkerCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 20, offset: const Offset(0, 4))],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 35,
            backgroundImage: NetworkImage(widget.worker['photoUrl'] ?? ""),
            backgroundColor: Colors.grey[100],
            child: widget.worker['photoUrl'] == null ? const Icon(Icons.person, color: Colors.grey) : null,
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.worker['name'] ?? "Worker", style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: const Color(0xFF1F2937))),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.flash_on, size: 14, color: Color(0xFF4B3621)),
                    const SizedBox(width: 4),
                    Text(widget.worker['category'] ?? "Electrician", style: GoogleFonts.inter(color: Colors.black54, fontSize: 15)),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReasonItem(String reason) {
    bool isSelected = _selectedReason == reason;
    return GestureDetector(
      onTap: () => setState(() => _selectedReason = reason),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFFFF7F2) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFFE5E7EB), width: 1.5),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(reason, style: GoogleFonts.inter(fontSize: 16, fontWeight: isSelected ? FontWeight.bold : FontWeight.w500, color: const Color(0xFF1F2937))),
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: isSelected ? const Color(0xFFFF6A00) : Colors.grey[300]!, width: 2),
                color: isSelected ? const Color(0xFFFF6A00) : Colors.transparent,
              ),
              child: isSelected ? const Icon(Icons.check, color: Colors.white, size: 16) : null,
            ),
          ],
        ),
      ),
    );
  }
}
