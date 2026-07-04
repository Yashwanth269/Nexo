import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shimmer/shimmer.dart';

class SkeletonComponents {
  // Base Shimmer Wrapper
  static Widget _shimmerWrapper({required Widget child}) {
    return Shimmer.fromColors(
      baseColor: Colors.grey[200]!,
      highlightColor: Colors.grey[100]!,
      period: const Duration(milliseconds: 1500),
      child: child,
    );
  }

  // 1. Home Screen Skeleton
  static Widget buildHomeSkeleton() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Skeleton
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _shimmerWrapper(child: Container(width: 100, height: 14, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)))),
                  const SizedBox(height: 8),
                  _shimmerWrapper(child: Container(width: 160, height: 28, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)))),
                ],
              ),
              _shimmerWrapper(child: const CircleAvatar(radius: 24, backgroundColor: Colors.white)),
            ],
          ),
          const SizedBox(height: 32),
          // Search Bar Skeleton
          _shimmerWrapper(child: Container(width: double.infinity, height: 56, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)))),
          const SizedBox(height: 32),
          // Categories Grid Skeleton
          _shimmerWrapper(child: Container(width: 120, height: 20, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)))),
          const SizedBox(height: 16),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 4, mainAxisSpacing: 16, crossAxisSpacing: 16, childAspectRatio: 0.8),
            itemCount: 8,
            itemBuilder: (_, __) => Column(
              children: [
                _shimmerWrapper(child: Container(height: 60, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)))),
                const SizedBox(height: 8),
                _shimmerWrapper(child: Container(width: 40, height: 10, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(2)))),
              ],
            ),
          ),
          const SizedBox(height: 32),
          // Job Cards Skeleton
          _shimmerWrapper(child: Container(width: 100, height: 20, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)))),
          const SizedBox(height: 16),
          ...List.generate(3, (index) => Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _shimmerWrapper(
              child: Container(
                height: 120,
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
              ),
            ),
          )),
        ],
      ),
    );
  }

  // 2. Categories Screen Skeleton
  static Widget buildCategoriesSkeleton() {
    return GridView.builder(
      padding: const EdgeInsets.all(20),
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: 20, crossAxisSpacing: 20, childAspectRatio: 0.9),
      itemCount: 12,
      itemBuilder: (_, __) => Container(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.grey[100]!)),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _shimmerWrapper(child: const CircleAvatar(radius: 25, backgroundColor: Colors.white)),
            const SizedBox(height: 12),
            _shimmerWrapper(child: Container(width: 60, height: 10, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(2)))),
          ],
        ),
      ),
    );
  }

  // 3. Minimal Loading Screen
  static Widget buildLoadingExperience() {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Circular Logo with Progress
            Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 100,
                  height: 100,
                  child: CircularProgressIndicator(
                    valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFFFF6A00)),
                    strokeWidth: 4,
                    backgroundColor: const Color(0xFFFF6A00).withOpacity(0.1),
                  ),
                ),
                Container(
                  width: 60,
                  height: 60,
                  decoration: const BoxDecoration(color: Color(0xFFFF6A00), shape: BoxShape.circle),
                  child: const Icon(Icons.business_center, color: Colors.white, size: 30),
                ),
              ],
            ),
            const SizedBox(height: 40),
            Text(
              "Loading your experience...",
              style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: const Color(0xFF1F2937)),
            ),
            const SizedBox(height: 12),
            Text(
              "We're connecting you with the best\nopportunities in your area.",
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: Colors.black54, fontSize: 15, height: 1.5),
            ),
            const SizedBox(height: 40),
            // Subtle Progress Bar
            Container(
              width: 200,
              height: 4,
              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(2)),
              child: _shimmerWrapper(
                child: Container(
                  width: 100,
                  height: 4,
                  decoration: BoxDecoration(color: const Color(0xFFFF6A00), borderRadius: BorderRadius.circular(2)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
