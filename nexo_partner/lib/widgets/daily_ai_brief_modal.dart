import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class DailyAIBriefModal extends StatelessWidget {
  final Map<String, dynamic> brief;
  final VoidCallback onDismiss;

  const DailyAIBriefModal({
    super.key,
    required this.brief,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final greeting = brief['greeting'] ?? "Good Morning, Rahul 👋";
    final earnings = (brief['potentialEarnings'] as num?)?.toDouble() ?? 5850.0;
    final slots = (brief['availableSlots'] as List?)?.cast<String>() ?? ["09:30–11:00", "02:00–05:30"];
    final recCount = brief['recommendedCount'] ?? 12;
    final areas = (brief['highDemandAreas'] as List?)?.cast<String>() ?? ["HSR Layout", "Koramangala"];

    return Dialog(
      backgroundColor: const Color(0xFF0F172A),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.wb_sunny_rounded, color: Color(0xFFF59E0B), size: 24),
                    const SizedBox(width: 8),
                    Text("Daily AI Briefing", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white)),
                  ],
                ),
                GestureDetector(
                  onTap: onDismiss,
                  child: const Icon(Icons.close_rounded, color: Colors.white54, size: 20),
                ),
              ],
            ),
            const SizedBox(height: 16),

            Text(greeting, style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.w900, color: Colors.white)),
            Text("Today's Business Outlook", style: GoogleFonts.inter(fontSize: 12, color: Colors.white60)),

            const SizedBox(height: 18),

            // Potential Earnings Tile
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)]),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Estimated Potential Earnings", style: GoogleFonts.inter(fontSize: 11, color: Colors.white70, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  Text("₹${earnings.toStringAsFixed(0)}", style: GoogleFonts.outfit(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.white)),
                  const SizedBox(height: 6),
                  Text("$recCount Opportunities Recommended • ${slots.length} Free Windows", style: GoogleFonts.inter(fontSize: 11, color: Colors.white70)),
                ],
              ),
            ),

            const SizedBox(height: 16),

            // Available Slots
            Text("Available Slots", style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white70)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: slots.map((s) => Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF334155))),
                child: Text(s, style: GoogleFonts.outfit(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFF60A5FA))),
              )).toList(),
            ),

            const SizedBox(height: 14),

            // High Demand Areas
            Text("High Demand Zones: ${areas.join(' • ')}", style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF34D399), fontWeight: FontWeight.bold)),

            const SizedBox(height: 12),

            // Traffic Alert & AI Suggestion
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFF334155))),
              child: Row(
                children: [
                  const Icon(Icons.tips_and_updates_rounded, color: Color(0xFFFBBF24), size: 18),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      brief['aiSuggestion'] ?? "Accept at least one scheduled opportunity before noon for maximum earnings.",
                      style: GoogleFonts.inter(fontSize: 11.5, color: Colors.white70),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: onDismiss,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: Text("Explore Opportunities", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
