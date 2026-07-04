import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/location_service.dart';
import 'package:nexo/services/service_data.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:nexo/screens/worker_types_screen.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/profile_screen.dart';
import 'package:nexo/components/skeleton_components.dart';
import 'package:nexo/widgets/shimmer_loading.dart';
import 'package:nexo/utils/network_helper.dart';

class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({super.key});

  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  static const Color primaryOrange = Color(0xFFFF6A00);
  static const Color primaryBlue = Color(0xFF5D78FF);
  static const Color bgColor = Color(0xFFF9FAFB);
  static const Color textPrimary = Color(0xFF1F2937);
  static const Color textSecondary = Color(0xFF6B7280);

  List<dynamic> _activities = [];
  List<dynamic> _trending = [];
  List<String> _recommendations = [];
  List<dynamic> _recentUsed = [];
  bool _isLoading = true;
  String _locationName = "Fetching...";
  Map<String, Map<String, dynamic>> _homeServiceMetrics = {};
  double? _currentLat;
  double? _currentLng;

  @override
  void initState() {
    super.initState();
    _loadAllMarketData();
  }

  Future<void> _loadAllMarketData() async {
    setState(() => _isLoading = true);
    try {
      final loc = await LocationService.getCurrentLocation();
      _currentLat = loc['lat'];
      _currentLng = loc['lng'];
      final lat = _currentLat!;
      final lng = _currentLng!;
      final phone = await SharedPrefsHelper.getPhone() ?? "9731016442";
      final baseUrl = NetworkHelper.baseUrl;

      _locationName = loc['address'] ?? loc['city'] ?? 'Your Area';

      final results = await NetworkHelper.retryWithBackoff(() => Future.wait([
        http.get(Uri.parse('$baseUrl/api/market/live?lat=$lat&lng=$lng')),
        http.get(Uri.parse('$baseUrl/api/market/trending?lat=$lat&lng=$lng')),
        http.get(Uri.parse('$baseUrl/api/market/recommendations?userId=$phone&lat=$lat&lng=$lng')),
        http.get(Uri.parse('$baseUrl/api/market/recent?userId=$phone')),
        http.get(Uri.parse('$baseUrl/api/home/services?lat=$lat&lng=$lng')),
      ]));

      if (mounted) {
        setState(() {
          if (results[0].statusCode == 200) {
            _activities = json.decode(results[0].body)['activities'];
          }
          if (results[1].statusCode == 200) {
            _trending = json.decode(results[1].body)['trending'];
          }
          if (results[2].statusCode == 200) {
            final recData = json.decode(results[2].body)['recommendations'] as List;
            _recommendations = recData.cast<String>();
          }
          if (results[3].statusCode == 200) {
            _recentUsed = json.decode(results[3].body)['recent'];
          }
          if (results[4].statusCode == 200) {
            final homeData = json.decode(results[4].body);
            if (homeData['success'] == true && homeData['categories'] != null) {
              for (final cat in homeData['categories']) {
                _homeServiceMetrics[cat['name']] = cat;
              }
            }
          }
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: const Icon(Icons.menu_rounded, color: textPrimary),
        title: Text(
          "Explore",
          style: GoogleFonts.outfit(
            fontWeight: FontWeight.w900,
            color: textPrimary,
            fontSize: 22,
          ),
        ),
        actions: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            margin: const EdgeInsets.only(right: 12, top: 10, bottom: 10),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                const Icon(Icons.location_on_rounded, color: primaryOrange, size: 12),
                const SizedBox(width: 4),
                Text(
                  _locationName,
                  style: GoogleFonts.inter(color: textPrimary, fontWeight: FontWeight.bold, fontSize: 10),
                ),
              ],
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadAllMarketData,
        color: primaryOrange,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Search Bar row
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    Expanded(
                      child: Container(
                        height: 48,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        child: Row(
                          children: [
                            const Icon(Icons.search_rounded, color: Color(0xFF94A3B8), size: 20),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextField(
                                decoration: InputDecoration(
                                  hintText: "Search categories...",
                                  hintStyle: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 13),
                                  border: InputBorder.none,
                                  contentPadding: EdgeInsets.zero,
                                ),
                              ),
                            ),
                            Container(
                              height: 32,
                              width: 32,
                              decoration: BoxDecoration(
                                color: primaryOrange,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Center(
                                child: Icon(Icons.tune_rounded, color: Colors.white, size: 16),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Container(
                      height: 48,
                      width: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
                      ),
                      child: const Center(
                        child: Icon(Icons.mic_none_rounded, color: textPrimary, size: 20),
                      ),
                    ),
                  ],
                ),
              ),

              // Horizontal pills / recommended categories
              if (_isLoading)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    children: [
                      const ShimmerLoading(width: 100, height: 40, borderRadius: 30),
                      const SizedBox(width: 8),
                      const ShimmerLoading(width: 100, height: 40, borderRadius: 30),
                    ],
                  ),
                )
              else if (_recommendations.isNotEmpty)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    children: _recommendations.map((cat) {
                      final categoryInfo = ServiceData.categories.firstWhere(
                        (c) => c['name'] == cat,
                        orElse: () => ServiceData.categories[0],
                      );
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: _buildFilterChip(categoryInfo['icon'], "Hire $cat", cat),
                      );
                    }).toList(),
                  ),
                ),

              const SizedBox(height: 24),
              // Trending Near You Section
              _buildSectionHeader("Trending Near You", onSeeAll: () {}),
              const SizedBox(height: 12),
              SizedBox(
                height: 160,
                child: _isLoading 
                    ? ListView.builder(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: 3,
                        itemBuilder: (context, index) => const Padding(
                          padding: EdgeInsets.only(right: 12),
                          child: ShimmerLoading(width: 140, height: 160, borderRadius: 24),
                        ),
                      )
                    : _trending.isEmpty
                        ? _buildEmptyTrending()
                        : ListView.builder(
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: _trending.length,
                            itemBuilder: (context, index) {
                              final trend = _trending[index];
                              final String trendName = trend['name'] ?? 'Service';
                              final String trendLabel = trend['growthText'] ?? trend['reqCountText'] ?? 'High demand';
                              final double trendScore = (trend['trendScore'] as num?)?.toDouble() ?? 0.5;

                              final categoryInfo = ServiceData.categories.firstWhere(
                                (c) => c['name'] == trendName || (c['workers'] as List).contains(trendName),
                                orElse: () => ServiceData.categories[0],
                              );
                              return Padding(
                                padding: const EdgeInsets.only(right: 12),
                                child: _buildTrendingCard(
                                  title: trendName,
                                  subtitle: trendLabel,
                                  image: ImageUtils.getCategoryAsset(trendName),
                                  color: categoryInfo['color'] as Color? ?? const Color(0xFF10B981),
                                  score: trendScore,
                                ),
                              );
                            },
                          ),
              ),

              const SizedBox(height: 24),
              // Live Local Market
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          "Live in Your Area",
                          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: textPrimary),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.green.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 4,
                                height: 4,
                                decoration: const BoxDecoration(color: Colors.green, shape: BoxShape.circle),
                              ),
                              const SizedBox(width: 4),
                              Text("LIVE", style: GoogleFonts.inter(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 8)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (_isLoading)
                      const Column(children: [CardShimmer(), CardShimmer()])
                    else if (_activities.isEmpty)
                      _buildEmptyMarket()
                    else
                      Column(
                        children: _activities.map((act) => _buildActivityCard(act)).toList(),
                      ),
                  ],
                ),
              ),

              if (_recentUsed.isNotEmpty) ...[
                const SizedBox(height: 24),
                _buildSectionHeader("Recently Used", isTitleCase: true),
                const SizedBox(height: 12),
                SizedBox(
                  height: 80,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _recentUsed.length,
                    itemBuilder: (context, index) {
                      final item = _recentUsed[index];
                      final categoryInfo = ServiceData.categories.firstWhere(
                        (c) => c['name'] == item['name'],
                        orElse: () => ServiceData.categories[0],
                      );
                      return Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: _buildRecentCard(
                          item['name'], 
                          item['subtitle'], 
                          categoryInfo['icon'], 
                          categoryInfo['color'].withValues(alpha: 0.1), 
                          categoryInfo['color'],
                        ),
                      );
                    },
                  ),
                ),
              ],

              const SizedBox(height: 28),
              // All Categories Grid (2 Columns, Detailed cards)
              _buildSectionHeader("All Categories", isTitleCase: true),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _isLoading ? SkeletonComponents.buildCategoriesSkeleton() : GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: ServiceData.categories.length,
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 2.2,
                  ),
                  itemBuilder: (context, index) {
                    final cat = ServiceData.categories[index];
                    return _buildCategoryGridItem(cat["name"], cat["image"], cat["color"], cat["icon"]);
                  },
                ),
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyTrending() {
    return Container(
      width: 250,
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey[100]!),
      ),
      child: Center(
        child: Text("Stay tuned for local trends!", style: GoogleFonts.inter(color: textSecondary, fontSize: 12)),
      ),
    );
  }

  Widget _buildSectionHeader(String title, {VoidCallback? onSeeAll, bool isTitleCase = true}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            isTitleCase ? title : title.toUpperCase(),
            style: GoogleFonts.outfit(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: textPrimary,
              letterSpacing: isTitleCase ? 0 : 1,
            ),
          ),
          if (onSeeAll != null)
            TextButton(
              onPressed: onSeeAll,
              child: Text("See all", style: GoogleFonts.inter(color: primaryOrange, fontWeight: FontWeight.w600)),
            ),
        ],
      ),
    );
  }

  Widget _buildTrendingCard({
    required String title, 
    required String subtitle, 
    required String image, 
    required Color color,
    required double score,
  }) {
    return GestureDetector(
      onTap: () {
        final categoryData = ServiceData.categories.firstWhere(
          (c) {
            final name = c['name'] as String?;
            if (name == title) return true;
            final workers = c['workers'] as List?;
            if (workers != null && workers.contains(title)) return true;
            return false;
          },
          orElse: () => ServiceData.categories[0],
        );
        Navigator.push(context, MaterialPageRoute(builder: (context) => WorkerTypesScreen(
          categoryName: categoryData['name'] ?? title,
          workerTypes: (categoryData['subcategories'] as List?)?.map((s) => s['name'] as String).toList() ?? [],
          color: color,
        )));
      },
      child: Container(
        width: 160,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(color: color.withValues(alpha: 0.3), blurRadius: 12, offset: const Offset(0, 6)),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: Stack(
            children: [
              ImageUtils.buildServiceImage(
                image,
                taskName: title,
                fit: BoxFit.cover,
                width: 160,
                height: 200,
                fallback: Container(color: color.withValues(alpha: 0.3)),
              ),
              Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Colors.black.withValues(alpha: 0.8)],
                  ),
                ),
              ),
              if (score > 0.8)
                Positioned(
                  top: 12,
                  right: 12,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.red, borderRadius: BorderRadius.circular(8)),
                    child: Text("HOT", style: GoogleFonts.inter(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Text(
                      title,
                      style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18, height: 1.1),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.trending_up, color: Colors.greenAccent, size: 14),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            subtitle,
                            style: GoogleFonts.inter(color: Colors.white.withValues(alpha: 0.9), fontSize: 11, fontWeight: FontWeight.w600),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterChip(dynamic icon, String label, String category) {
    return GestureDetector(
      onTap: () {
        final categoryData = ServiceData.categories.firstWhere(
          (c) => c['name'] == category,
          orElse: () => ServiceData.categories[0],
        );
        Navigator.push(context, MaterialPageRoute(builder: (context) => WorkerTypesScreen(
          categoryName: category,
          workerTypes: (categoryData['subcategories'] as List).map((s) => s['name'] as String).toList(),
          color: categoryData['color'],
        )));
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: primaryOrange.withValues(alpha: 0.2)),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 4, offset: const Offset(0, 2)),
          ],
        ),
        child: Row(
          children: [
            if (icon is IconData && icon is! FaIconData)
              Icon(icon, color: primaryBlue, size: 16)
            else
              FaIcon(icon, color: primaryBlue, size: 16),
            const SizedBox(width: 8),
            Text(label, style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: textPrimary, fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Widget _buildRecentCard(String title, String subtitle, dynamic icon, Color bgColor, Color iconColor) {
    return GestureDetector(
      onTap: () {
        final categoryData = ServiceData.categories.firstWhere(
          (c) => c['name'] == title,
          orElse: () => ServiceData.categories[0],
        );
        Navigator.push(context, MaterialPageRoute(builder: (context) => WorkerTypesScreen(
          categoryName: title,
          workerTypes: (categoryData['subcategories'] as List).map((s) => s['name'] as String).toList(),
          color: iconColor,
        )));
      },
      child: Container(
        width: 180,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: bgColor, borderRadius: BorderRadius.circular(12)),
              child: (icon is IconData && icon is! FaIconData)
                  ? Icon(icon, color: iconColor, size: 20)
                  : FaIcon(icon, color: iconColor, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14)),
                  Text(subtitle, style: GoogleFonts.inter(color: textSecondary, fontSize: 10)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyMarket() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey[100]!),
      ),
      child: Column(
        children: [
          Icon(Icons.radar_rounded, size: 40, color: Colors.grey[300]),
          const SizedBox(height: 12),
          Text(
            "No recent activity in your area",
            style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: textSecondary),
          ),
          const SizedBox(height: 4),
          Text(
            "Be the first to post a job nearby",
            style: GoogleFonts.inter(color: Colors.grey[400], fontSize: 12),
          ),
          const SizedBox(height: 16),
          TextButton(
            onPressed: () {},
            child: Text("Post a Job Now", style: GoogleFonts.inter(color: primaryOrange, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildActivityCard(dynamic act) {
    IconData icon;
    Color color;
    String title;
    String? subtitle;
    String? timeStr;
    String ctaText = "View";

    switch (act['type']) {
      case 'LIVE_JOB':
        icon = Icons.bolt_rounded;
        color = Colors.orange;
        title = "${act['category']} needed";
        subtitle = "Nearby demand";
        timeStr = _formatTime(act['time']);
        ctaText = "View";
        break;
      case 'AVAILABILITY':
        icon = Icons.people_rounded;
        color = Colors.blue;
        title = "${act['count']} ${act['category']}s available nearby";
        ctaText = "Hire now";
        break;
      case 'TRENDING':
        icon = Icons.trending_up_rounded;
        color = Colors.red;
        title = "${act['category']} work trending";
        subtitle = "High demand now";
        break;
      case 'COMPLETION':
        icon = Icons.check_circle_rounded;
        color = Colors.green;
        title = "${act['category']} job completed recently";
        subtitle = "Builds trust in area";
        break;
      default:
        return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.1), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: textPrimary)),
                if (subtitle != null)
                  Text(subtitle, style: GoogleFonts.inter(color: textSecondary, fontSize: 12)),
                if (timeStr != null)
                  Text(timeStr, style: GoogleFonts.inter(color: Colors.grey[400], fontSize: 10)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(
              backgroundColor: color.withValues(alpha: 0.05),
              foregroundColor: color,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: Text(ctaText, style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 12)),
          ),
        ],
      ),
    );
  }

  String _formatTime(String? timestamp) {
    if (timestamp == null) return "";
    final date = DateTime.parse(timestamp);
    final diff = DateTime.now().difference(date);
    if (diff.inMinutes < 60) return "${diff.inMinutes} mins ago";
    if (diff.inHours < 24) return "${diff.inHours} hours ago";
    return "${diff.inDays} days ago";
  }

  Widget _buildCategoryGridItem(String name, String image, Color color, dynamic icon) {
    final serviceData = _homeServiceMetrics[name];
    String subtitleText;
    Color subtitleColor;

    if (serviceData != null) {
      final onlineWorkers = serviceData['onlineWorkers'] ?? 0;
      final statusLabel = serviceData['statusLabel'] ?? '';
      if (onlineWorkers > 0) {
        subtitleText = '$onlineWorkers available';
        subtitleColor = const Color(0xFF10B981);
      } else if (statusLabel.isNotEmpty) {
        subtitleText = statusLabel;
        subtitleColor = const Color(0xFFF97316);
      } else {
        subtitleText = 'Checking availability...';
        subtitleColor = const Color(0xFF94A3B8);
      }
    } else {
      subtitleText = 'Checking availability...';
      subtitleColor = const Color(0xFF94A3B8);
    }

    return GestureDetector(
      onTap: () {
        final catData = ServiceData.categories.firstWhere(
          (c) => c['name'] == name,
          orElse: () => ServiceData.categories[0],
        );
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => WorkerTypesScreen(
              categoryName: name,
              workerTypes: (catData['subcategories'] as List).map((s) => s['name'] as String).toList(),
              color: color,
            ),
          ),
        );
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: ImageUtils.buildServiceImage(
                image, 
                taskName: name,
                width: 38, 
                height: 38, 
                fit: BoxFit.cover,
                fallback: Container(
                  width: 38, 
                  height: 38, 
                  color: color.withValues(alpha: 0.1),
                  child: Center(
                    child: (icon is IconData && icon is! FaIconData)
                      ? Icon(icon, color: color, size: 16)
                      : FaIcon(icon, color: color, size: 16),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13, color: textPrimary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitleText,
                    style: GoogleFonts.inter(color: subtitleColor, fontSize: 10, fontWeight: FontWeight.w500),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
