import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';
import '../../utils/image_utils.dart';
import '../../services/cache_service.dart';
import 'job_execution_screen.dart';
import 'new_job_offer_screen.dart';
import '../chat/chat_detail_screen.dart';

class ActiveJobsScreen extends StatefulWidget {
  const ActiveJobsScreen({super.key});

  @override
  State<ActiveJobsScreen> createState() => _ActiveJobsScreenState();
}

class _ActiveJobsScreenState extends State<ActiveJobsScreen> {
  final Color primaryColor = const Color(0xFF2563EB);
  String _selectedStatusFilter = "All";
  String _sortBy = "Latest";
  List<dynamic> _jobs = [];
  bool _isLoading = true;
  String? _phoneNumber;
  String? _token;

  // Active filters
  DateTime? _selectedFilterDate;
  double? _filterMinPrice;
  String? _filterCategory;

  Map<String, String> _getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
  }

  String _formatDateTime(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return "";
    try {
      final dt = DateTime.parse(dateStr).toLocal();
      return DateFormat('dd MMM • hh:mm a').format(dt);
    } catch (e) {
      return "";
    }
  }

  String _formatTimeOnly(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return "";
    try {
      final dt = DateTime.parse(dateStr).toLocal();
      return DateFormat('hh:mm a').format(dt);
    } catch (e) {
      return "";
    }
  }

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final prefs = await SharedPreferences.getInstance();
    _phoneNumber = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
    _token = prefs.getString('worker_token');
    if (_phoneNumber != null) {
      final cached = await CacheService.getJsonList('active_gigs');
      if (cached != null) {
        setState(() {
          _jobs = cached.map((job) => {...job, 'isCached': true}).toList();
          _isLoading = false;
        });
      }
      _fetchJobs();
    } else {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _fetchJobs() async {
    if (_phoneNumber == null) return;
    try {
      final responses = await Future.wait([
        http.get(Uri.parse('${NetworkHelper.baseUrl}/api/jobs/offers/pending/$_phoneNumber'), headers: _getAuthHeaders()),
        http.get(Uri.parse('${NetworkHelper.baseUrl}/api/jobs/worker/active-jobs-light/$_phoneNumber'), headers: _getAuthHeaders()),
        http.get(Uri.parse('${NetworkHelper.baseUrl}/api/jobs/worker/history/$_phoneNumber'), headers: _getAuthHeaders()),
      ]);

      List<dynamic> pendingList = [];
      List<dynamic> activeList = [];
      List<dynamic> historyList = [];

      if (responses[0].statusCode == 200) {
        final data = json.decode(responses[0].body);
        pendingList = (data['jobs'] as List?)?.where((j) => j != null).toList() ?? [];
        for (var job in pendingList) {
          job['status'] = job['status'] ?? 'OPEN';
        }
      }

      if (responses[1].statusCode == 200) {
        final data = json.decode(responses[1].body);
        activeList = (data['jobs'] as List?)?.where((j) => j != null).toList() ?? [];
        await CacheService.setJsonList('active_gigs', activeList);
      }

      if (responses[2].statusCode == 200) {
        final data = json.decode(responses[2].body);
        historyList = (data['jobs'] as List?)?.where((j) => j != null).toList() ?? [];
      }

      final List<dynamic> merged = [];
      merged.addAll(pendingList);
      merged.addAll(activeList);
      merged.addAll(historyList);

      if (mounted) {
        setState(() {
          _jobs = merged;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint("Error fetching jobs: $e");
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _acceptJob(dynamic job) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB))),
    );

    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/accept'),
        headers: _getAuthHeaders(),
        body: json.encode({
          'jobId': job['id'],
          'workerId': _phoneNumber,
        }),
      );
      
      if (mounted) Navigator.pop(context);

      final data = json.decode(response.body);

      if (response.statusCode == 200 && data['success']) {
        _fetchJobs();
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => JobExecutionScreen(jobId: job['id'], initialJob: data['job'] ?? job),
          ),
        );
      } else {
        String errorMsg = data['message'] ?? "Could not accept job";
        if (errorMsg == "WORKER_ALREADY_BUSY") errorMsg = "You already have an active job!";
        if (errorMsg == "JOB_ALREADY_TAKEN") errorMsg = "Sorry, this job was just taken by another worker.";
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(errorMsg), backgroundColor: Colors.redAccent),
        );
        _fetchJobs();
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Connection error. Please try again."), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _rejectJob(String jobId) async {
    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/reject'),
        headers: _getAuthHeaders(),
        body: json.encode({
          'jobId': jobId,
          'workerId': _phoneNumber,
        }),
      );
      _fetchJobs();
    } catch (e) {
      debugPrint("Reject error: $e");
    }
  }

  Future<void> _submitCounterOffer(String jobId, double price) async {
    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/jobs/negotiate'),
        headers: _getAuthHeaders(),
        body: json.encode({
          'jobId': jobId,
          'workerId': _phoneNumber,
          'price': price,
        }),
      );
      
      if (response.statusCode == 200) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Counter offer sent successfully!")),
          );
        }
        _fetchJobs();
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Failed to send counter offer.")),
          );
        }
      }
    } catch (e) {
      debugPrint("Negotiate error: $e");
    }
  }

  void _openNewJobOffer(dynamic job) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => NewJobOfferScreen(
          job: job,
          onAccept: () => _acceptJob(job),
          onDecline: () => _rejectJob(job['id']),
          onCounterOffer: (price) => _submitCounterOffer(job['id'], price),
        ),
      ),
    ).then((_) => _fetchJobs());
  }

  void _openActiveJob(dynamic job) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => JobExecutionScreen(jobId: job['id'], initialJob: job),
      ),
    ).then((_) => _fetchJobs());
  }

  Future<void> _showCalendarFilter() async {
    final selectedDate = await showDatePicker(
      context: context,
      initialDate: _selectedFilterDate ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: Color(0xFF2563EB),
              onPrimary: Colors.white,
              surface: Colors.white,
              onSurface: Color(0xFF0F172A),
            ),
          ),
          child: child!,
        );
      },
    );
    if (selectedDate != null) {
      setState(() {
        _selectedFilterDate = selectedDate;
      });
    }
  }

  void _showCategoryPriceFilter() {
    final minPriceController = TextEditingController(text: _filterMinPrice?.toString() ?? "");
    String activeCategory = _filterCategory ?? "All Categories";
    
    // Categories list dynamically calculated
    final categories = ["All Categories", ..._jobs.map((j) => (j['category'] ?? "General").toString()).toSet().toList()];

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) {
          return AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            title: Row(
              children: [
                const Icon(Icons.filter_list_rounded, color: Color(0xFF2563EB)),
                const SizedBox(width: 10),
                Expanded(
                  child: Text("Filter Gigs", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
                ),
              ],
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("Category", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF475569))),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: activeCategory,
                  decoration: InputDecoration(
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                  items: categories.map((cat) => DropdownMenuItem(value: cat, child: Text(cat))).toList(),
                  onChanged: (val) {
                    if (val != null) {
                      setModalState(() => activeCategory = val);
                    }
                  },
                ),
                const SizedBox(height: 16),
                Text("Minimum Price (₹)", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF475569))),
                const SizedBox(height: 8),
                TextField(
                  controller: minPriceController,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    hintText: "Enter min price e.g. 500",
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () {
                  setState(() {
                    _filterMinPrice = null;
                    _filterCategory = null;
                    _selectedFilterDate = null;
                  });
                  Navigator.pop(context);
                },
                child: Text("Clear All", style: GoogleFonts.inter(color: Colors.redAccent)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () {
                  setState(() {
                    _filterMinPrice = double.tryParse(minPriceController.text);
                    _filterCategory = activeCategory;
                  });
                  Navigator.pop(context);
                },
                child: Text("Apply Filters", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
              ),
            ],
          );
        }
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    // Split gigs into categories dynamically from the loaded state
    final allGigs = _jobs;
    final activeGigs = _jobs.where((j) {
      final s = j['status'] ?? "";
      return s == 'ACCEPTED' || s == 'ON_THE_WAY' || s == 'ARRIVED' || s == 'STARTED' || s == 'IN_PROGRESS' || s == 'WORK_IN_PROGRESS';
    }).toList();
    
    final upcomingGigs = _jobs.where((j) {
      final s = j['status'] ?? "";
      return s == 'OPEN' || s == 'REQUESTED' || s == 'REDISTRIBUTING' || s == 'REASSIGNING';
    }).toList();

    final completedGigs = _jobs.where((j) => j['status'] == 'COMPLETED').toList();
    final cancelledGigs = _jobs.where((j) => j['status'] == 'CANCELLED' || j['status'] == 'EXPIRED').toList();

    // Sort matching active order
    List<dynamic> targetGigs = [];
    if (_selectedStatusFilter == "All") targetGigs = List.from(allGigs);
    else if (_selectedStatusFilter == "Active") targetGigs = List.from(activeGigs);
    else if (_selectedStatusFilter == "Upcoming") targetGigs = List.from(upcomingGigs);
    else if (_selectedStatusFilter == "Completed") targetGigs = List.from(completedGigs);
    else if (_selectedStatusFilter == "Cancelled") targetGigs = List.from(cancelledGigs);

    // Apply active filters
    if (_selectedFilterDate != null) {
      targetGigs = targetGigs.where((j) {
        final dateStr = j['created_at'] ?? j['completed_at'] ?? "";
        if (dateStr.isEmpty) return false;
        try {
          final dt = DateTime.parse(dateStr).toLocal();
          return dt.year == _selectedFilterDate!.year &&
                 dt.month == _selectedFilterDate!.month &&
                 dt.day == _selectedFilterDate!.day;
        } catch (_) {
          return false;
        }
      }).toList();
    }

    if (_filterMinPrice != null) {
      targetGigs = targetGigs.where((j) {
        final price = double.tryParse(j['price']?.toString() ?? '0') ?? 0.0;
        return price >= _filterMinPrice!;
      }).toList();
    }

    if (_filterCategory != null && _filterCategory != "All Categories") {
      targetGigs = targetGigs.where((j) {
        return (j['category'] ?? "").toString().toLowerCase() == _filterCategory!.toLowerCase();
      }).toList();
    }

    if (_sortBy == "Price") {
      targetGigs.sort((a, b) => (double.tryParse(b['price']?.toString() ?? '0') ?? 0.0)
          .compareTo(double.tryParse(a['price']?.toString() ?? '0') ?? 0.0));
    } else {
      // Latest
      targetGigs.sort((a, b) => (b['created_at'] ?? "").toString().compareTo((a['created_at'] ?? "").toString()));
    }

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: Navigator.canPop(context) 
            ? IconButton(
                icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF0F172A)), 
                onPressed: () => Navigator.pop(context),
              ) 
            : null,
        title: Text(
          "My Gigs",
          style: GoogleFonts.outfit(
            color: const Color(0xFF0F172A),
            fontWeight: FontWeight.w900,
            fontSize: 20,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.filter_list_rounded, color: Color(0xFF2563EB)),
            onPressed: _showCategoryPriceFilter,
          ),
          IconButton(
            icon: const Icon(Icons.calendar_today_rounded, color: Color(0xFF2563EB)),
            onPressed: _showCalendarFilter,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Filter pills row
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  _buildFilterPill("All", allGigs.length),
                  _buildFilterPill("Active", activeGigs.length, countColor: Colors.green),
                  _buildFilterPill("Upcoming", upcomingGigs.length, countColor: Colors.blue),
                  _buildFilterPill("Completed", completedGigs.length, countColor: Colors.teal),
                  _buildFilterPill("Cancelled", cancelledGigs.length, countColor: Colors.red),
                ],
              ),
            ),
            
            // Active filter chips
            if (_selectedFilterDate != null || (_filterCategory != null && _filterCategory != "All Categories") || _filterMinPrice != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      if (_selectedFilterDate != null)
                        Chip(
                          label: Text(
                            "Date: ${DateFormat('dd MMM').format(_selectedFilterDate!)}",
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                          ),
                          backgroundColor: const Color(0xFFEFF6FF),
                          onDeleted: () => setState(() => _selectedFilterDate = null),
                          deleteIconColor: const Color(0xFF2563EB),
                        ),
                      if (_selectedFilterDate != null && (_filterCategory != null && _filterCategory != "All Categories"))
                        const SizedBox(width: 8),
                      if (_filterCategory != null && _filterCategory != "All Categories")
                        Chip(
                          label: Text(
                            "Category: $_filterCategory",
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                          ),
                          backgroundColor: const Color(0xFFEFF6FF),
                          onDeleted: () => setState(() => _filterCategory = null),
                          deleteIconColor: const Color(0xFF2563EB),
                        ),
                      if (_filterMinPrice != null) ...[
                        const SizedBox(width: 8),
                        Chip(
                          label: Text(
                            "Min Price: ₹${_filterMinPrice!.toInt()}",
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                          ),
                          backgroundColor: const Color(0xFFEFF6FF),
                          onDeleted: () => setState(() => _filterMinPrice = null),
                          deleteIconColor: const Color(0xFF2563EB),
                        ),
                      ]
                    ],
                  ),
                ),
              ),

            // Sort line
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
              child: Row(
                children: [
                  Text(
                    "Sort by: ",
                    style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF94A3B8)),
                  ),
                  DropdownButton<String>(
                    value: _sortBy,
                    elevation: 1,
                    underline: const SizedBox.shrink(),
                    style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFF2563EB)),
                    items: const [
                      DropdownMenuItem(value: "Latest", child: Text("Latest")),
                      DropdownMenuItem(value: "Price", child: Text("Highest Price")),
                    ],
                    onChanged: (val) {
                      if (val != null) setState(() => _sortBy = val);
                    },
                  ),
                ],
              ),
            ),

            Expanded(
              child: RefreshIndicator(
                onRefresh: _fetchJobs,
                color: const Color(0xFF2563EB),
                child: _isLoading && targetGigs.isEmpty
                    ? _buildSkeletonList()
                    : targetGigs.isEmpty
                        ? _buildEmptyState()
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                            itemCount: targetGigs.length,
                            itemBuilder: (context, index) {
                              final job = targetGigs[index];
                              return _buildInteractiveGigCard(job);
                            },
                          ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterPill(String label, int count, {Color? countColor}) {
    final isSelected = _selectedStatusFilter == label;
    return GestureDetector(
      onTap: () => setState(() => _selectedStatusFilter = label),
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFF2563EB) : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0),
            width: 1,
          ),
          boxShadow: [
            if (isSelected)
              BoxShadow(
                color: const Color(0xFF2563EB).withOpacity(0.15),
                blurRadius: 8,
                offset: const Offset(0, 4),
              )
          ],
        ),
        child: Row(
          children: [
            Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: isSelected ? Colors.white : const Color(0xFF475569),
              ),
            ),
            const SizedBox(width: 6),
            Text(
              "$count",
              style: GoogleFonts.inter(
                fontSize: 13,
                fontWeight: FontWeight.w900,
                color: isSelected 
                    ? Colors.white 
                    : (countColor ?? const Color(0xFF94A3B8)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInteractiveGigCard(dynamic job) {
    final status = job['status'] ?? 'OPEN';
    final bool isCompleted = status == 'COMPLETED';
    final bool isCancelled = status == 'CANCELLED' || status == 'EXPIRED';
    final bool isActive = !isCompleted && !isCancelled && status != 'OPEN' && status != 'REQUESTED' && status != 'REDISTRIBUTING' && status != 'REASSIGNING';
    
    // Status text & colors matching mockup
    String statusText = "UPCOMING";
    Color statusBg = const Color(0xFFEFF6FF);
    Color statusTextCol = const Color(0xFF2563EB);

    if (isActive) {
      statusText = "IN PROGRESS";
      statusBg = const Color(0xFFDCFCE7);
      statusTextCol = const Color(0xFF16A34A);
    } else if (isCompleted) {
      statusText = "COMPLETED";
      statusBg = const Color(0xFFE0F2FE);
      statusTextCol = const Color(0xFF0369A1);
    } else if (isCancelled) {
      statusText = "CANCELLED";
      statusBg = const Color(0xFFFEE2E2);
      statusTextCol = const Color(0xFFEF4444);
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 2),
          )
        ],
        border: Border.all(
          color: const Color(0xFFF1F5F9),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: isCompleted
                      ? const Color(0xFFDCFCE7)
                      : (isCancelled ? const Color(0xFFFEE2E2) : const Color(0xFFEFF6FF)),
                  shape: BoxShape.circle,
                ),
                child: ImageUtils.buildServiceImage(
                  null,
                  taskName: job['category'],
                  width: 28,
                  height: 28,
                  fit: BoxFit.cover,
                  fallback: Icon(Icons.handyman, color: statusTextCol, size: 24),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: statusBg,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            statusText,
                            style: GoogleFonts.inter(
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                              color: statusTextCol,
                            ),
                          ),
                        ),
                        if (!isActive)
                          GestureDetector(
                            onTap: () {
                              if (statusText == "UPCOMING") {
                                _openNewJobOffer(job);
                              } else {
                                _openActiveJob(job);
                              }
                            },
                            child: const Icon(
                              Icons.chevron_right_rounded,
                              color: Color(0xFF94A3B8),
                              size: 20,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      job['title'] ?? job['category'] ?? "Gig Request",
                      style: GoogleFonts.outfit(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: const Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      job['userName'] ?? "John Doe",
                      style: GoogleFonts.inter(
                        color: const Color(0xFF64748B),
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.location_on, size: 14, color: Color(0xFF94A3B8)),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            job['userAddress'] ?? "California, USA",
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.inter(
                              color: const Color(0xFF64748B),
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    "₹${job['price'] ?? '500'}",
                    style: GoogleFonts.outfit(
                      fontWeight: FontWeight.w900,
                      fontSize: 16,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    isActive 
                        ? "Started ${_formatTimeOnly(job['started_at'])}" 
                        : (isCompleted 
                            ? _formatDateTime(job['completed_at'] ?? job['complete_at']) 
                            : _formatTimeOnly(job['created_at'])),
                    style: GoogleFonts.inter(
                      color: const Color(0xFF94A3B8),
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (isActive) ...[
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _openActiveJob(job),
                    icon: const Icon(Icons.navigation_rounded, size: 16, color: Color(0xFF2563EB)),
                    label: Text(
                      "Navigate",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF2563EB)),
                    ),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      side: const BorderSide(color: Color(0xFFE2E8F0)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => _openActiveJob(job),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      elevation: 0,
                    ),
                    child: Text(
                      "View Details",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                  ),
                ),
              ],
            )
          ]
        ],
      ),
    );
  }

  Widget _buildSkeletonList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: 3,
      itemBuilder: (context, index) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        height: 100,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFF1F5F9)),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: const BoxDecoration(
              color: Color(0xFFEFF6FF),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.work_outline_rounded, size: 48, color: Color(0xFF2563EB)),
          ),
          const SizedBox(height: 16),
          Text(
            "No gigs found",
            style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: const Color(0xFF0F172A)),
          ),
          const SizedBox(height: 6),
          Text(
            "Any gigs under this filter will be listed here.",
            style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF94A3B8)),
          ),
        ],
      ),
    );
  }
}
