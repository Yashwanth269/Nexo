import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';

class OpportunitiesScreen extends StatefulWidget {
  const OpportunitiesScreen({super.key});

  @override
  State<OpportunitiesScreen> createState() => _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends State<OpportunitiesScreen> {
  List<dynamic> _opportunities = [];
  bool _isLoading = true;
  String? _error;
  String? _phoneNumber;
  String? _token;

  // Filter States
  String _selectedDateFilter = 'All';
  String _selectedDistanceFilter = 'All';
  String _selectedPriceFilter = 'All';
  String _selectedTimeFilter = 'All';
  String _selectedCategoryFilter = 'All';
  String _selectedDurationFilter = 'All';
  String _selectedSortFilter = 'RECOMMENDED';
  String _searchQuery = '';

  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadWorkerInfo();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadWorkerInfo() async {
    final prefs = await SharedPreferences.getInstance();
    _phoneNumber = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
    _token = prefs.getString('worker_token');
    _fetchOpportunities();
  }

  Future<void> _fetchOpportunities() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/opportunities?workerId=${_phoneNumber ?? ''}'),
        headers: {
          'Content-Type': 'application/json',
          if (_token != null) 'Authorization': 'Bearer $_token',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          setState(() {
            _opportunities = data['opportunities'] ?? [];
            _isLoading = false;
          });
        } else {
          setState(() {
            _error = data['message'] ?? 'Failed to load scheduled opportunities';
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _error = 'Server returned code ${response.statusCode}';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Connection error. Pull to refresh.';
        _isLoading = false;
      });
    }
  }

  List<dynamic> get _filteredOpportunities {
    return _opportunities.where((job) {
      // Category Filter
      if (_selectedCategoryFilter != 'All') {
        final cat = (job['category'] ?? '').toString().toLowerCase();
        if (!cat.contains(_selectedCategoryFilter.toLowerCase())) return false;
      }

      // Search Query
      if (_searchQuery.isNotEmpty) {
        final title = (job['title'] ?? job['category'] ?? '').toString().toLowerCase();
        final desc = (job['description'] ?? '').toString().toLowerCase();
        final q = _searchQuery.toLowerCase();
        if (!title.contains(q) && !desc.contains(q)) return false;
      }

      // Price Filter
      final price = double.tryParse(job['price']?.toString() ?? '0') ?? 0.0;
      if (_selectedPriceFilter == '₹300+' && price < 300) return false;
      if (_selectedPriceFilter == '₹500+' && price < 500) return false;
      if (_selectedPriceFilter == '₹1000+' && price < 1000) return false;

      return true;
    }).toList()
      ..sort((a, b) {
        if (_selectedSortFilter == 'RECOMMENDED') {
          return (b['matchScore'] ?? 0).compareTo(a['matchScore'] ?? 0);
        } else if (_selectedSortFilter == 'HIGHEST_PAY') {
          return (double.tryParse(b['price']?.toString() ?? '0') ?? 0)
              .compareTo(double.tryParse(a['price']?.toString() ?? '0') ?? 0);
        } else if (_selectedSortFilter == 'NEWEST') {
          return (b['created_at'] ?? '').toString().compareTo((a['created_at'] ?? '').toString());
        }
        return 0;
      });
  }

  Future<void> _submitInterest(dynamic job, {double? customPrice, String? notes}) async {
    final jobId = job['id']?.toString() ?? job['_id']?.toString();
    final price = customPrice ?? (double.tryParse(job['price']?.toString() ?? '500') ?? 500.0);

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB))),
    );

    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/negotiate'),
        headers: {
          'Content-Type': 'application/json',
          if (_token != null) 'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'jobId': jobId,
          'workerId': _phoneNumber,
          'price': price,
          'notes': notes,
        }),
      );

      if (mounted) Navigator.pop(context); // close loader

      final data = json.decode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text("🎉 Interest submitted for ₹${price.toStringAsFixed(0)}! Customer will review your offer."),
            backgroundColor: const Color(0xFF10B981),
            duration: const Duration(seconds: 4),
          ),
        );
        _fetchOpportunities();
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(data['message'] ?? "Could not submit offer"),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e"), backgroundColor: Colors.redAccent),
      );
    }
  }

  void _showOfferDialog(dynamic job) {
    final basePrice = double.tryParse(job['price']?.toString() ?? '500') ?? 500.0;
    final priceController = TextEditingController(text: basePrice.toStringAsFixed(0));
    final noteController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      builder: (context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom + 20, top: 20, left: 20, right: 20),
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
                const Icon(Icons.handshake_rounded, color: Color(0xFF2563EB), size: 24),
                const SizedBox(width: 10),
                Text(
                  "Offer Your Service",
                  style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.white),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "Express interest or propose a custom price for this job.",
              style: GoogleFonts.inter(fontSize: 13, color: Colors.white60),
            ),
            const SizedBox(height: 20),

            // Price Field
            Text("Your Proposed Price (₹)", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white70, fontSize: 12)),
            const SizedBox(height: 8),
            TextField(
              controller: priceController,
              keyboardType: TextInputType.number,
              style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: const Color(0xFF34D399)),
              decoration: InputDecoration(
                prefixText: "₹ ",
                prefixStyle: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: const Color(0xFF34D399)),
                filled: true,
                fillColor: const Color(0xFF1E293B),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF334155))),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF334155))),
              ),
            ),

            const SizedBox(height: 16),
            // Note Field
            Text("Message to Customer (Optional)", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white70, fontSize: 12)),
            const SizedBox(height: 8),
            TextField(
              controller: noteController,
              maxLines: 2,
              style: GoogleFonts.inter(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                hintText: "e.g., I have 5 years experience with this brand and can bring all required tools.",
                hintStyle: GoogleFonts.inter(color: Colors.white38, fontSize: 12),
                filled: true,
                fillColor: const Color(0xFF1E293B),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF334155))),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF334155))),
              ),
            ),

            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Colors.white24),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: Text("Cancel", style: GoogleFonts.inter(color: Colors.white70, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    onPressed: () {
                      final p = double.tryParse(priceController.text) ?? basePrice;
                      Navigator.pop(context);
                      _submitInterest(job, customPrice: p, notes: noteController.text);
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: Text("Submit Proposal", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredOpportunities;

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F172A),
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  "Scheduled Opportunities",
                  style: GoogleFonts.outfit(fontWeight: FontWeight.w900, color: Colors.white, fontSize: 20),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2563EB).withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFF3B82F6).withValues(alpha: 0.5)),
                  ),
                  child: Text(
                    "${_opportunities.length} Available",
                    style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: const Color(0xFF60A5FA)),
                  ),
                ),
              ],
            ),
            Text(
              "Browse & offer for scheduled jobs • Works even when Offline ⚡",
              style: GoogleFonts.inter(color: Colors.white54, fontSize: 11),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
            onPressed: _fetchOpportunities,
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _fetchOpportunities,
          color: const Color(0xFF2563EB),
          child: Column(
            children: [
              // Offline Battery Advantage Banner
              _buildOfflineAdvantageBanner(),

              // Search Bar
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (v) => setState(() => _searchQuery = v),
                    style: GoogleFonts.inter(color: Colors.white, fontSize: 13),
                    decoration: InputDecoration(
                      hintText: "Search electric, plumbing, cleaning jobs...",
                      hintStyle: GoogleFonts.inter(color: Colors.white38, fontSize: 13),
                      border: InputBorder.none,
                      icon: const Icon(Icons.search_rounded, color: Colors.white38, size: 20),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, color: Colors.white54, size: 16),
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _searchQuery = '');
                              },
                            )
                          : null,
                    ),
                  ),
                ),
              ),

              // Filter Pills Row
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                child: Row(
                  children: [
                    _buildFilterDropdownChip("Category", _selectedCategoryFilter, [
                      "All", "Electrician", "Plumber", "Cleaning", "Painting", "Carpentry", "AC", "Moving"
                    ], (v) => setState(() => _selectedCategoryFilter = v)),
                    _buildFilterDropdownChip("Price", _selectedPriceFilter, [
                      "All", "₹300+", "₹500+", "₹1000+"
                    ], (v) => setState(() => _selectedPriceFilter = v)),
                    _buildFilterDropdownChip("Sort By", _selectedSortFilter == 'RECOMMENDED' ? '⭐ Recommended' : _selectedSortFilter == 'HIGHEST_PAY' ? '💰 Highest Pay' : '🆕 Newest', [
                      "RECOMMENDED", "HIGHEST_PAY", "NEWEST"
                    ], (v) => setState(() => _selectedSortFilter = v), displayNames: {
                      "RECOMMENDED": "⭐ Recommended",
                      "HIGHEST_PAY": "💰 Highest Pay",
                      "NEWEST": "🆕 Newest"
                    }),
                  ],
                ),
              ),

              // Main List
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
                    : _error != null
                        ? _buildErrorView()
                        : filtered.isEmpty
                            ? _buildEmptyState()
                            : ListView.builder(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                itemCount: filtered.length,
                                itemBuilder: (context, index) {
                                  final job = filtered[index];
                                  return _buildOpportunityCard(job);
                                },
                              ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOfflineAdvantageBanner() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: const BoxDecoration(
              color: Color(0xFF3B82F6),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.bolt_rounded, color: Colors.white, size: 14),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Marketplace Mode Active",
                  style: GoogleFonts.outfit(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                ),
                Text(
                  "You can browse & offer for scheduled jobs anytime without keeping Online toggle active.",
                  style: GoogleFonts.inter(fontSize: 10.5, color: Colors.white60),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterDropdownChip(String title, String currentValue, List<String> options, ValueChanged<String> onSelected, {Map<String, String>? displayNames}) {
    final isSelected = currentValue != 'All' && currentValue != 'RECOMMENDED';
    return PopupMenuButton<String>(
      onSelected: onSelected,
      color: const Color(0xFF1E293B),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      itemBuilder: (context) => options.map((opt) {
        final label = displayNames?[opt] ?? opt;
        return PopupMenuItem<String>(
          value: opt,
          child: Text(label, style: GoogleFonts.inter(color: Colors.white, fontSize: 13)),
        );
      }).toList(),
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFF2563EB) : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: isSelected ? const Color(0xFF3B82F6) : const Color(0xFF334155)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              displayNames?[currentValue] ?? "$title: $currentValue",
              style: GoogleFonts.inter(
                fontSize: 11.5,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                color: isSelected ? Colors.white : Colors.white70,
              ),
            ),
            const SizedBox(width: 4),
            Icon(Icons.arrow_drop_down, color: isSelected ? Colors.white : Colors.white54, size: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildOpportunityCard(dynamic job) {
    final price = double.tryParse(job['price']?.toString() ?? '500') ?? 500.0;
    final matchScore = job['matchScore'] ?? 92;
    final isRecommended = job['isRecommended'] == true || matchScore >= 88;
    final scheduledAtStr = job['scheduled_at'] != null ? job['scheduled_at'].toString() : 'Scheduled for Tomorrow';

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isRecommended ? const Color(0xFF3B82F6).withValues(alpha: 0.8) : const Color(0xFF334155),
          width: isRecommended ? 1.5 : 1,
        ),
        boxShadow: const [
          BoxShadow(color: Colors.black26, blurRadius: 8, offset: Offset(0, 3)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Match Badge & Scheduled Time
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: isRecommended ? const Color(0xFF2563EB).withValues(alpha: 0.25) : Colors.white.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: isRecommended ? const Color(0xFF3B82F6) : Colors.white12,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      isRecommended ? Icons.stars_rounded : Icons.calendar_month_rounded,
                      color: isRecommended ? const Color(0xFF60A5FA) : Colors.white70,
                      size: 13,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      isRecommended ? "⭐ $matchScore% Match" : "📅 Scheduled Bidding",
                      style: GoogleFonts.outfit(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: isRecommended ? const Color(0xFF93C5FD) : Colors.white70,
                      ),
                    ),
                  ],
                ),
              ),

              Text(
                "₹${price.toStringAsFixed(0)}",
                style: GoogleFonts.outfit(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  color: const Color(0xFF34D399),
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Title & Description
          Text(
            job['title'] ?? job['category'] ?? "Service Request",
            style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
          ),
          const SizedBox(height: 4),
          Text(
            job['description'] ?? "No additional description provided.",
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.inter(fontSize: 12.5, color: Colors.white60, height: 1.4),
          ),

          const SizedBox(height: 14),
          const Divider(color: Color(0xFF334155), height: 1),
          const SizedBox(height: 12),

          // Meta Info Row
          Row(
            children: [
              _buildMetaChip(Icons.location_on_rounded, job['address'] ?? job['location_name'] ?? "Nearby Area"),
              const SizedBox(width: 10),
              _buildMetaChip(Icons.access_time_filled_rounded, "Est. 1-2 Hours"),
            ],
          ),

          const SizedBox(height: 16),

          // Action Buttons
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _showOfferDialog(job),
                  icon: const Icon(Icons.tune_rounded, size: 16, color: Color(0xFF60A5FA)),
                  label: Text("Custom Bid", style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFF60A5FA))),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF3B82F6)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: ElevatedButton.icon(
                  onPressed: () => _submitInterest(job),
                  icon: const Icon(Icons.thumb_up_alt_rounded, size: 16, color: Colors.white),
                  label: Text(
                    "I'm Interested",
                    style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2563EB),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetaChip(IconData icon, String label) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.black26,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
        ),
        child: Row(
          children: [
            Icon(icon, size: 13, color: Colors.white54),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.inter(fontSize: 11, color: Colors.white70),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            Text(_error!, style: GoogleFonts.inter(color: Colors.white70, fontSize: 14), textAlign: TextAlign.center),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: _fetchOpportunities,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF2563EB),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text("Retry", style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: const Color(0xFF1E293B), shape: BoxShape.circle, border: Border.all(color: const Color(0xFF334155))),
              child: const Icon(Icons.calendar_today_rounded, color: Color(0xFF3B82F6), size: 48),
            ),
            const SizedBox(height: 20),
            Text("No Scheduled Opportunities Found", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 8),
            Text(
              "There are currently no open scheduled job requests in your category. Check back soon!",
              style: GoogleFonts.inter(fontSize: 13, color: Colors.white60, height: 1.4),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
