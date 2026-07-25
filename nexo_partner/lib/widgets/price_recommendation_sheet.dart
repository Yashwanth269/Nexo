import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class PriceRecommendationSheet extends StatelessWidget {
  final double basePrice;
  final double recommendedQuote;
  final double minRange;
  final double maxRange;
  final int winProbability;
  final String explanation;
  final Function(double price) onSubmitQuote;

  const PriceRecommendationSheet({
    super.key,
    required this.basePrice,
    required this.recommendedQuote,
    required this.minRange,
    required this.maxRange,
    required this.winProbability,
    required this.explanation,
    required this.onSubmitQuote,
  });

  @override
  Widget build(BuildContext context) {
    final TextEditingController quoteController = TextEditingController(text: recommendedQuote.toStringAsFixed(0));

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Color(0xFF0F172A),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2))),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Icon(Icons.auto_awesome_rounded, color: Color(0xFFF59E0B), size: 24),
              const SizedBox(width: 8),
              Text("AI Price Recommendation Engine", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white)),
            ],
          ),
          const SizedBox(height: 4),
          Text("Data-backed fair market pricing to maximize selection probability.", style: GoogleFonts.inter(fontSize: 12, color: Colors.white60)),

          const SizedBox(height: 20),

          // Price Recommendation & Win Probability Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFF334155)),
            ),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("AI Recommended Quote", style: GoogleFonts.inter(fontSize: 11, color: Colors.white60, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 2),
                        Text("₹${recommendedQuote.toStringAsFixed(0)}", style: GoogleFonts.outfit(fontSize: 26, fontWeight: FontWeight.w900, color: const Color(0xFF34D399))),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text("Fair Market Range", style: GoogleFonts.inter(fontSize: 11, color: Colors.white60, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 2),
                        Text("₹${minRange.toStringAsFixed(0)} – ₹${maxRange.toStringAsFixed(0)}", style: GoogleFonts.outfit(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white)),
                      ],
                    ),
                  ],
                ),

                const SizedBox(height: 14),
                const Divider(color: Color(0xFF334155), height: 1),
                const SizedBox(height: 12),

                // Win Probability Meter
                Row(
                  children: [
                    const Icon(Icons.stars_rounded, color: Color(0xFF60A5FA), size: 18),
                    const SizedBox(width: 6),
                    Text("Estimated Win Chance: $winProbability%", style: GoogleFonts.outfit(fontSize: 13, fontWeight: FontWeight.bold, color: const Color(0xFF93C5FD))),
                  ],
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: winProbability / 100.0,
                    minHeight: 8,
                    backgroundColor: Colors.white12,
                    color: const Color(0xFF34D399),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // Explanation
          Text("💡 $explanation", style: GoogleFonts.inter(fontSize: 11.5, color: Colors.white70, fontStyle: FontStyle.italic)),

          const SizedBox(height: 20),

          // Quote Input
          Text("Your Custom Quote (₹)", style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white70)),
          const SizedBox(height: 8),
          TextField(
            controller: quoteController,
            keyboardType: TextInputType.number,
            style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
            decoration: InputDecoration(
              prefixText: "₹ ",
              prefixStyle: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
              filled: true,
              fillColor: const Color(0xFF1E293B),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF334155))),
            ),
          ),

          const SizedBox(height: 24),

          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                final p = double.tryParse(quoteController.text) ?? recommendedQuote;
                onSubmitQuote(p);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF2563EB),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: Text("Submit Quote with AI Advantage", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15)),
            ),
          ),
        ],
      ),
    );
  }
}
