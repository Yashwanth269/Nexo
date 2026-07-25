import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class TravelHomeBanner extends StatelessWidget {
  final String homeAddress;
  final int minsRemaining;
  final double potentialEarnings;
  final int jobsCount;
  final List<dynamic> routeJobs;
  final VoidCallback onStopTravelHome;
  final Function(dynamic job) onSelectJob;

  const TravelHomeBanner({
    super.key,
    required this.homeAddress,
    required this.minsRemaining,
    required this.potentialEarnings,
    required this.jobsCount,
    required this.routeJobs,
    required this.onStopTravelHome,
    required this.onSelectJob,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF15803D), Color(0xFF166534)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
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
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: const BoxDecoration(color: Colors.white24, shape: BoxShape.circle),
                    child: const Icon(Icons.home_rounded, color: Colors.white, size: 20),
                  ),
                  const SizedBox(width: 10),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("Heading Home to $homeAddress", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: Colors.white)),
                      Text("$minsRemaining mins est. journey • Battery Saver Mode (15s GPS)", style: GoogleFonts.inter(fontSize: 11, color: Colors.white70)),
                    ],
                  ),
                ],
              ),
              GestureDetector(
                onTap: onStopTravelHome,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(12)),
                  child: Text("End", style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white70)),
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),
          const Divider(color: Colors.white24, height: 1),
          const SizedBox(height: 12),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text("Route Potential Earnings", style: GoogleFonts.inter(fontSize: 11, color: Colors.white70, fontWeight: FontWeight.bold)),
              Text("₹${potentialEarnings.toStringAsFixed(0)} ($jobsCount jobs along route)", style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: const Color(0xFF86EFAC))),
            ],
          ),

          if (routeJobs.isNotEmpty) ...[
            const SizedBox(height: 12),
            SizedBox(
              height: 100,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: routeJobs.length,
                itemBuilder: (context, idx) {
                  final job = routeJobs[idx];
                  final detour = job['detourTimeMins'] ?? 6;
                  final price = double.tryParse(job['price']?.toString() ?? '500') ?? 500.0;

                  return GestureDetector(
                    onTap: () => onSelectJob(job),
                    child: Container(
                      width: 220,
                      margin: const EdgeInsets.only(right: 10),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(job['category'] ?? "Service", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF0F172A))),
                              Text("₹${price.toStringAsFixed(0)}", style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 14, color: const Color(0xFF16A34A))),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text("💡 Only adds +$detour mins detour", style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF2563EB), fontWeight: FontWeight.bold)),
                          const Spacer(),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(job['address'] ?? "Along route", style: GoogleFonts.inter(fontSize: 10, color: const Color(0xFF64748B))),
                              Text("Accept >", style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: const Color(0xFF16A34A))),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}
