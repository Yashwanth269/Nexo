import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/network_helper.dart';
import '../utils/image_utils.dart';
import '../../services/socket_service.dart';
import '../screens/job/job_execution_screen.dart';

class JobRequestModal extends StatefulWidget {
  final dynamic job;
  const JobRequestModal({super.key, required this.job});

  @override
  State<JobRequestModal> createState() => _JobRequestModalState();
}

class _JobRequestModalState extends State<JobRequestModal> {
  int _secondsLeft = 120; // Updated to 2 mins
  Timer? _timer;
  bool _isAccepting = false;
  bool _showNegotiation = false;
  final TextEditingController _priceController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _startTimer();
    _listenForTaken();
  }

  void _listenForTaken() {
    SocketService().socket?.on('job_taken', (data) {
      if (data != null && data['jobId'] == widget.job['id']) {
        _timer?.cancel();
        if (mounted) {
          Navigator.pop(context);
          _showUnavailableDialog(alreadyTaken: true);
        }
      }
    });
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_secondsLeft > 0) {
        if (mounted) setState(() => _secondsLeft--);
      } else {
        _timer?.cancel();
        if (mounted) {
          Navigator.pop(context, false);
          _showUnavailableDialog();
        }
      }
    });
  }

  void _showUnavailableDialog({bool alreadyTaken = false}) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(alreadyTaken ? Icons.person_off_outlined : Icons.timer_off_outlined, color: const Color(0xFFFF6A00), size: 48),
            const SizedBox(height: 16),
            Text(alreadyTaken ? "Job Already Taken" : "Job No Longer Available", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 8),
            Text(alreadyTaken ? "Another worker was slightly faster! Keep an eye out for the next one." : "The request window has closed or the job was withdrawn.", textAlign: TextAlign.center, style: GoogleFonts.inter(color: Colors.black54)),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(context),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF6A00), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                child: const Text("Return to Dashboard", style: TextStyle(color: Colors.white)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showRejectConfirmation() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        contentPadding: const EdgeInsets.all(24),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Warning Icon
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: const Color(0xFFFF6A00).withOpacity(0.1), shape: BoxShape.circle),
              child: const Icon(Icons.warning_amber_rounded, color: Color(0xFFFF6A00), size: 40),
            ),
            const SizedBox(height: 24),
            Text("Are you sure you want to reject?", textAlign: TextAlign.center, style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.black87)),
            const SizedBox(height: 16),
            
            // Warning Box
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(16),
                border: const Border(left: BorderSide(color: Color(0xFFB91C1C), width: 4)),
              ),
              child: Text(
                "Rejecting too many jobs may reduce your chances of receiving new job requests.",
                style: GoogleFonts.inter(fontSize: 14, color: Colors.black87, height: 1.4),
              ),
            ),
            const SizedBox(height: 24),
            
            // Actions
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context); // Close dialog
                  Navigator.pop(context, false); // Reject job
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
                child: Text("Yes, Reject", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(context),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFFE7D6),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
                child: Text("Cancel", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: const Color(0xFF994B00))),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              "We prioritize workers who respond positively to job requests.",
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(fontSize: 12, color: Colors.black45, fontStyle: FontStyle.italic),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _acceptJob() async {
    setState(() => _isAccepting = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final workerId = prefs.getString('workerPhone') ?? prefs.getString('worker_phone') ?? '';
      final token = prefs.getString('worker_token');
      if (workerId.isEmpty) {
        debugPrint('❌ [ACCEPT_JOB] No workerPhone found in prefs');
        _showUnavailableDialog();
        return;
      }

      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/accept'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({'jobId': widget.job['id'], 'workerId': workerId}),
      ).timeout(const Duration(seconds: 10));

      final data = json.decode(response.body);
      debugPrint('📡 [ACCEPT_JOB] Response: ${response.statusCode} ${response.body}');
      if (data['success'] == true) {
        _timer?.cancel();
        if (mounted) {
          Navigator.pop(context);
          Navigator.push(context, MaterialPageRoute(
            builder: (context) => JobExecutionScreen(
              jobId: widget.job['id'].toString(),
              initialJob: data['job'],
            ),
          ));
        }
      } else {
        _timer?.cancel();
        if (mounted) {
          Navigator.pop(context);
          final msg = data['message'] ?? data['error'] ?? 'Job no longer available';
          debugPrint('❌ [ACCEPT_JOB] Failed: $msg');
          _showUnavailableDialog();
        }
      }
    } catch (e) {
      debugPrint('❌ [ACCEPT_JOB] Exception: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Network error. Please try again.'), backgroundColor: Colors.redAccent),
        );
      }
    } finally {
      if (mounted) setState(() => _isAccepting = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _priceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final job = widget.job;
    
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFFFAF9F6),
        borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Icon(Icons.menu, color: Color(0xFFFF6A00)),
                  Text("New Opportunity", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 20)),
                  const Icon(Icons.help_outline, color: Colors.blueGrey),
                ],
              ),
            ),
            
            // Orange Priority Card
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: const Color(0xFFFF6A00),
                borderRadius: BorderRadius.circular(24),
              ),
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(20),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text("PRIORITY TASK", style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white.withOpacity(0.8))),
                            Text("New Job Request", style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white)),
                          ],
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(20)),
                          child: Row(
                            children: [
                              const Icon(Icons.timer_outlined, color: Colors.white, size: 20),
                              const SizedBox(width: 4),
                              Text("${_secondsLeft}s", style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  
                  // White Content Card
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.vertical(top: Radius.circular(24), bottom: Radius.circular(24)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // User Profile Bar
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF7ED),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            children: [
                              Stack(
                                children: [
                                  ImageUtils.buildProfileImage(
                                    job['userPhoto'] != null ? '${NetworkHelper.baseUrl}${job['userPhoto']}' : null,
                                    radius: 28,
                                    name: job['userName']
                                  ),
                                  Positioned(bottom: 0, right: 0, child: Icon(Icons.verified, color: Colors.blue[700], size: 20)),
                                ],
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Text(job['userName'] ?? "Ramesh", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold)),
                                        const SizedBox(width: 8),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                          decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(8)),
                                          child: Text("Verified", style: GoogleFonts.inter(fontSize: 10, color: Colors.blue[700], fontWeight: FontWeight.bold)),
                                        ),
                                      ],
                                    ),
                                    Text(job['userPhone'] ?? "+91 9XXXXXX123", style: GoogleFonts.inter(color: Colors.black54)),
                                  ],
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(border: Border.all(color: Colors.black12), shape: BoxShape.circle),
                                child: const Icon(Icons.call, color: Color(0xFF1E3A8A)),
                              ),
                            ],
                          ),
                        ),
                        
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            _buildTag("INDUSTRIAL HUB", const Color(0xFFEFF6FF), const Color(0xFF1D4ED8)),
                            const SizedBox(width: 8),
                            _buildTag("URGENT", const Color(0xFFFEF2F2), const Color(0xFFB91C1C)),
                          ],
                        ),
                        
                        const SizedBox(height: 16),
                        Text(job['title'] ?? "Master Electrician", style: GoogleFonts.outfit(fontSize: 28, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Text(job['description'] ?? "Repairing circuit breaker and industrial wiring in a commercial manufacturing unit. All tools provided on-site.", 
                          style: GoogleFonts.inter(color: Colors.black54, height: 1.5)),
                        
                        const SizedBox(height: 24),
                        // Stats Grid
                        GridView.count(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          crossAxisCount: 2,
                          childAspectRatio: 1.8,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                          children: [
                            _buildStatCard(Icons.location_on_outlined, "Distance", "${job['distance'] ?? '2.3 km'} away"),
                            _buildStatCard(Icons.access_time, "Duration", job['duration'] ?? "1–2 hours"),
                            _buildStatCard(Icons.payments_outlined, "Budget", "₹${job['price'] ?? '1,200'}"),
                            _buildStatCard(Icons.bolt_outlined, "Urgency", job['urgency'] ?? "Immediate"),
                          ],
                        ),
                        
                        const SizedBox(height: 24),
                        const Divider(height: 1, color: Colors.black12),
                        const SizedBox(height: 24),
                        
                        // Negotiate Bar
                        GestureDetector(
                          onTap: () => setState(() => _showNegotiation = !_showNegotiation),
                          child: Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: _showNegotiation ? Colors.transparent : const Color(0xFFFFF7ED),
                              border: Border.all(color: const Color(0xFFFF6A00).withOpacity(_showNegotiation ? 0.1 : 0.3)),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Row(
                                      children: [
                                        const Icon(Icons.edit_note, color: Color(0xFF994B00)),
                                        const SizedBox(width: 8),
                                        Text("Request Better Price", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF994B00))),
                                      ],
                                    ),
                                    Icon(_showNegotiation ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down, color: const Color(0xFF994B00)),
                                  ],
                                ),
                                if (_showNegotiation) ...[
                                  const SizedBox(height: 12),
                                  TextField(
                                    controller: _priceController,
                                    keyboardType: TextInputType.number,
                                    decoration: InputDecoration(
                                      hintText: "Enter your expected price",
                                      prefixText: "₹ ",
                                      filled: true,
                                      fillColor: Colors.white,
                                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.black12)),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            
            // Footer Actions
            Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: _showRejectConfirmation,
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: const Color(0xFFFEF2F2), shape: BoxShape.circle),
                      child: const Icon(Icons.close, color: Color(0xFFB91C1C)),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: SizedBox(
                      height: 60,
                      child: ElevatedButton(
                        onPressed: _isAccepting ? null : _acceptJob,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF166534),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                        ),
                        child: _isAccepting 
                          ? const CircularProgressIndicator(color: Colors.white)
                          : Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.check_circle_outline, color: Colors.white),
                                const SizedBox(width: 8),
                                Text(_showNegotiation ? "Send Request" : "Accept Job", style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                              ],
                            ),
                      ),
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

  Widget _buildTag(String text, Color bg, Color textCol) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Text(text, style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: textCol)),
    );
  }

  Widget _buildStatCard(IconData icon, String label, String value) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFFFFF7ED).withOpacity(0.5), borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFFFF6A00), size: 24),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(label, style: GoogleFonts.inter(fontSize: 10, color: Colors.black45)),
                Text(value, style: GoogleFonts.outfit(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.black87)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
