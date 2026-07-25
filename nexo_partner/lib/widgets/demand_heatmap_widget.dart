import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class DemandHeatMapWidget extends StatelessWidget {
  final List<dynamic> zones;
  final Function(String zoneName) onSelectZone;

  const DemandHeatMapWidget({
    super.key,
    required this.zones,
    required this.onSelectZone,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.local_fire_department_rounded, color: Color(0xFFEF4444), size: 22),
                  const SizedBox(width: 8),
                  Text("Live Demand Heat Map", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: Colors.redAccent.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(10)),
                child: Text("High Surge", style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.redAccent)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text("Areas with high active requests and worker shortages.", style: GoogleFonts.inter(fontSize: 11.5, color: Colors.white54)),

          const SizedBox(height: 14),

          // Zone Cards List
          Column(
            children: zones.map((z) {
              final heatLevel = z['heatLevel'] ?? "NORMAL";
              final color = heatLevel.contains("CRITICAL") || heatLevel.contains("VERY_HIGH")
                  ? Colors.redAccent
                  : (heatLevel.contains("HIGH") ? Colors.orangeAccent : Colors.amber);

              return GestureDetector(
                onTap: () => onSelectZone(z['name'] ?? ''),
                child: Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: color.withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(z['name'] ?? '', style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                              const SizedBox(width: 8),
                              Text("• ${z['heatLevel']}", style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: color)),
                            ],
                          ),
                          Text("Expected +₹${z['expectedEarningsAdd']} add. earnings", style: GoogleFonts.inter(fontSize: 11, color: Colors.white60)),
                        ],
                      ),
                      const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white38, size: 14),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
