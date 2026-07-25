import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class JobBundleCard extends StatelessWidget {
  final Map<String, dynamic> bundle;
  final VoidCallback onAcceptBundle;

  const JobBundleCard({
    super.key,
    required this.bundle,
    required this.onAcceptBundle,
  });

  @override
  Widget build(BuildContext context) {
    final title = bundle['bundleTitle'] ?? "Apartment Cluster Bundle";
    final totalJobs = bundle['totalJobs'] ?? 3;
    final totalPayout = (bundle['totalPayout'] as num?)?.toDouble() ?? 2000.0;
    final travelKm = (bundle['totalTravelKm'] as num?)?.toDouble() ?? 2.4;
    final durationMins = bundle['estimatedDurationMins'] ?? 120;
    final List<dynamic> jobs = bundle['jobs'] ?? [];
    final rationale = bundle['aiRationale'] ?? "3 Jobs in the same apartment cluster • Only 2.4 km travel";

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1E1B4B), Color(0xFF312E81)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFF6366F1), width: 1.5),
        boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 12, offset: Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF818CF8).withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF818CF8)),
                ),
                child: Text("⚡ Smart Job Bundle", style: GoogleFonts.outfit(fontSize: 11, fontWeight: FontWeight.bold, color: const Color(0xFFC7D2FE))),
              ),
              Text("₹${totalPayout.toStringAsFixed(0)}", style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.w900, color: const Color(0xFF34D399))),
            ],
          ),

          const SizedBox(height: 10),

          Text(title, style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
          Text("Single route • $totalJobs jobs • $travelKm km travel • ${durationMins ~/ 60}h est.", style: GoogleFonts.inter(fontSize: 12, color: Colors.white70)),

          const SizedBox(height: 12),
          const Divider(color: Colors.white24, height: 1),
          const SizedBox(height: 12),

          // Sub-Jobs List
          Column(
            children: jobs.map((j) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_rounded, color: Color(0xFF34D399), size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      "${j['title']} (${j['apartment'] ?? 'Same area'})",
                      style: GoogleFonts.inter(fontSize: 12, color: Colors.white),
                    ),
                  ),
                  Text("₹${j['price']}", style: GoogleFonts.outfit(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.white70)),
                ],
              ),
            )).toList(),
          ),

          const SizedBox(height: 10),

          Text("💡 $rationale", style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFFA5B4FC), fontStyle: FontStyle.italic)),

          const SizedBox(height: 16),

          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onAcceptBundle,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF4F46E5),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: Text("Accept Bundle Opportunity", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15)),
            ),
          ),
        ],
      ),
    );
  }
}
