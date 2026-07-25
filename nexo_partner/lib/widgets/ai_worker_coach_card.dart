import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AIWorkerCoachCard extends StatelessWidget {
  final Map<String, dynamic> coachData;

  const AIWorkerCoachCard({
    super.key,
    required this.coachData,
  });

  @override
  Widget build(BuildContext context) {
    final headline = coachData['headline'] ?? "Good Evening Rahul 👋";
    final monthlyEarnings = (coachData['monthlyEarningsSoFar'] as num?)?.toDouble() ?? 62400.0;
    final topSkill = coachData['topSkill'] ?? "Electrical";
    final growingArea = coachData['fastestGrowingArea'] ?? "Whitefield";
    final List<dynamic> recommendations = coachData['coachingRecommendations'] ?? [];
    final skillExp = coachData['suggestedSkillExpansion'] ?? {};

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFF2563EB).withValues(alpha: 0.6), width: 1.5),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 10, offset: Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.psychology_rounded, color: Color(0xFF60A5FA), size: 22),
                  const SizedBox(width: 8),
                  Text("AI Business Coach", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(10)),
                child: Text("Top 5% Growth", style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: const Color(0xFFB45309))),
              ),
            ],
          ),

          const SizedBox(height: 12),
          Text(headline, style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
          Text("Monthly Earnings So Far: ₹${monthlyEarnings.toStringAsFixed(0)} • Top Skill: $topSkill • Surge Area: $growingArea", style: GoogleFonts.inter(fontSize: 12, color: Colors.white70)),

          const SizedBox(height: 12),
          const Divider(color: Color(0xFF334155), height: 1),
          const SizedBox(height: 12),

          // Coaching Bullet Points
          Column(
            children: recommendations.map((rec) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.auto_awesome_rounded, color: Color(0xFFF59E0B), size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(rec.toString(), style: GoogleFonts.inter(fontSize: 12, color: Colors.white)),
                  ),
                ],
              ),
            )).toList(),
          ),

          if (skillExp.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF2563EB).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFF3B82F6)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.school_rounded, color: Color(0xFF93C5FD), size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("Suggested Skill Expansion: ${skillExp['recommendedSkill']}", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white)),
                        Text("Demand: ${skillExp['demandSurge']} • Est. Income Gain: ${skillExp['potentialIncomeIncrease']}", style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF93C5FD))),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
