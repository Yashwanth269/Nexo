import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';
import '../../services/cache_service.dart';

class EarningsHistoryScreen extends StatefulWidget {
  const EarningsHistoryScreen({super.key});

  @override
  State<EarningsHistoryScreen> createState() => _EarningsHistoryScreenState();
}

class _EarningsHistoryScreenState extends State<EarningsHistoryScreen> with SingleTickerProviderStateMixin {
  late TabController _subTabController;
  bool _isLoading = true;
  bool _hideEarnings = false;
  String _selectedTimeframe = "Month"; // Today, Week, Month, Year, Custom
  
  dynamic _summary = {
    'totalEarnings': 0.0,
    'withdrawableBalance': 0.0,
    'onlineEarnings': 0.0,
    'cashEarnings': 0.0,
    'totalWithdrawn': 0.0,
    'pendingEarnings': 0.0,
    'gigs': 0
  };
  List<dynamic> _history = [];

  @override
  void initState() {
    super.initState();
    _subTabController = TabController(length: 3, vsync: this);
    _subTabController.addListener(() {
      if (!_subTabController.indexIsChanging) {
        setState(() {});
      }
    });
    _loadCachedData();
    _fetchData();
  }

  @override
  void dispose() {
    _subTabController.dispose();
    super.dispose();
  }

  Future<void> _loadCachedData() async {
    final cachedSummary = await CacheService.getJsonMap('earnings_summary');
    if (cachedSummary != null && mounted) {
      setState(() {
        _summary = cachedSummary;
      });
    }
    
    final cachedHistory = await CacheService.getJsonList('earnings_history');
    if (cachedHistory != null && mounted) {
      setState(() {
        _history = cachedHistory;
        _isLoading = false;
      });
    }
  }

  Future<void> _fetchData() async {
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
    final token = prefs.getString('worker_token') ?? '';
    if (phone == null) return;

    try {
      final responses = await Future.wait([
        http.get(
          Uri.parse('${NetworkHelper.baseUrl}/api/wallet/worker-earnings'),
          headers: {'Authorization': 'Bearer $token'},
        ),
        http.get(
          Uri.parse('${NetworkHelper.baseUrl}/api/jobs/worker/history/$phone'),
          headers: {'Authorization': 'Bearer $token'},
        ),
      ]);

      if (responses[0].statusCode == 200 && responses[1].statusCode == 200) {
        final decodedSummary = json.decode(responses[0].body)['summary'];
        final decodedHistory = json.decode(responses[1].body)['jobs'] ?? [];

        if (decodedSummary != null) {
          await CacheService.setJsonMap('earnings_summary', decodedSummary);
        }
        await CacheService.setJsonList('earnings_history', decodedHistory);

        if (mounted) {
          setState(() {
            _summary = decodedSummary ?? _summary;
            _history = decodedHistory;
            _isLoading = false;
          });
        }
      } else {
        if (mounted) setState(() => _isLoading = false);
      }
    } catch (e) {
      debugPrint("Error fetching earnings: $e");
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _withdrawFunds(double amount, String bankName, String accNum, String ifsc) async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('worker_token') ?? '';
    if (token.isEmpty) return;

    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/payment/withdraw'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'amount': amount,
          'bankDetails': {
            'bankName': bankName,
            'accountNumber': accNum,
            'ifsc': ifsc,
          }
        }),
      );

      final data = json.decode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Withdrawal request submitted successfully!"), backgroundColor: Color(0xFF10B981)),
        );
        _fetchData();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['error'] ?? "Failed to withdraw funds"), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Withdrawal connection error: $e"), backgroundColor: Colors.redAccent),
      );
    }
  }

  void _showWithdrawDialog() {
    double withdrawable = 0.0;
    try {
      withdrawable = double.tryParse(_summary['withdrawableBalance']?.toString() ?? '0') ?? 0.0;
    } catch (_) {
      withdrawable = (_summary['withdrawableBalance'] as num?)?.toDouble() ?? 0.0;
    }
    
    if (withdrawable <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("No withdrawable balance available."), backgroundColor: Colors.orangeAccent),
      );
      return;
    }

    final TextEditingController amountController = TextEditingController(text: withdrawable.toStringAsFixed(2));
    final TextEditingController bankController = TextEditingController(text: "Nexo Partner Bank");
    final TextEditingController accController = TextEditingController(text: "34891029384");
    final TextEditingController ifscController = TextEditingController(text: "NXBP0004567");

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.account_balance_rounded, color: Color(0xFFFF6A00)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                "Withdraw to Bank",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: amountController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: "Amount (₹)",
                  labelStyle: TextStyle(color: Color(0xFF64748B)),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: bankController,
                decoration: const InputDecoration(
                  labelText: "Bank Name",
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: accController,
                decoration: const InputDecoration(
                  labelText: "Account Number",
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ifscController,
                decoration: const InputDecoration(
                  labelText: "IFSC Code",
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("Cancel", style: GoogleFonts.inter(color: const Color(0xFF64748B))),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6A00),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: () {
              final double amt = double.tryParse(amountController.text) ?? 0.0;
              if (amt <= 0 || amt > withdrawable) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text("Invalid withdrawal amount."), backgroundColor: Colors.redAccent),
                );
                return;
              }
              Navigator.pop(context);
              _withdrawFunds(amt, bankController.text, accController.text, ifscController.text);
            },
            child: Text("Withdraw", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
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
          "Earnings & History",
          style: GoogleFonts.outfit(
            color: const Color(0xFF0F172A),
            fontWeight: FontWeight.w900,
            fontSize: 20,
          ),
        ),
        actions: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            margin: const EdgeInsets.only(top: 14, bottom: 14),
            decoration: BoxDecoration(
              color: const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              "FLEX",
              style: GoogleFonts.outfit(
                color: const Color(0xFFFF6A00),
                fontWeight: FontWeight.w900,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(width: 12),
          const Icon(Icons.account_circle, color: Color(0xFF64748B), size: 28),
          const SizedBox(width: 16),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Column(
            children: [
              TabBar(
                controller: _subTabController,
                indicatorColor: const Color(0xFFFF6A00),
                indicatorSize: TabBarIndicatorSize.tab,
                labelColor: const Color(0xFFFF6A00),
                unselectedLabelColor: const Color(0xFF94A3B8),
                labelStyle: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14),
                unselectedLabelStyle: GoogleFonts.outfit(fontWeight: FontWeight.w600, fontSize: 14),
                tabs: const [
                  Tab(text: "Overview"),
                  Tab(text: "Transactions"),
                  Tab(text: "Payouts"),
                ],
              ),
              Container(height: 1, color: const Color(0xFFE2E8F0)),
            ],
          ),
        ),
      ),
      body: SafeArea(
        child: TabBarView(
          controller: _subTabController,
          children: [
            _buildOverviewTab(),
            _buildTransactionsTab(),
            _buildPayoutsTab(),
          ],
        ),
      ),
    );
  }

  Widget _buildTimeframeRow() {
    final frames = ["Today", "This Week", "This Month", "This Year", "Custom"];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: frames.map((tf) {
          final isSelected = _selectedTimeframe == tf;
          return GestureDetector(
            onTap: () {
              setState(() {
                _selectedTimeframe = tf;
              });
            },
            child: Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: isSelected ? const Color(0xFFFF6A00) : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
                ),
              ),
              child: Text(
                tf,
                style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: isSelected ? Colors.white : const Color(0xFF475569),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildOverviewTab() {
    double totalEarnings = 0.0;
    double withdrawable = 0.0;
    double baseEarnings = 0.0;
    double tips = 0.0;
    double incentives = 0.0;
    double otherEarnings = 0.0;

    try {
      totalEarnings = double.tryParse(_summary['totalEarnings']?.toString() ?? '0') ?? 0.0;
      withdrawable = double.tryParse(_summary['withdrawableBalance']?.toString() ?? '0') ?? 0.0;
      baseEarnings = double.tryParse(_summary['onlineEarnings']?.toString() ?? '0') ?? 0.0;
      tips = double.tryParse(_summary['tips']?.toString() ?? '0') ?? 0.0;
      incentives = double.tryParse(_summary['incentives']?.toString() ?? '0') ?? 0.0;
      otherEarnings = double.tryParse(_summary['cashEarnings']?.toString() ?? '0') ?? 0.0;
    } catch (_) {
      totalEarnings = (_summary['totalEarnings'] as num?)?.toDouble() ?? 0.0;
      withdrawable = (_summary['withdrawableBalance'] as num?)?.toDouble() ?? 0.0;
      baseEarnings = (_summary['onlineEarnings'] as num?)?.toDouble() ?? 0.0;
      tips = (_summary['tips'] as num?)?.toDouble() ?? 0.0;
      incentives = (_summary['incentives'] as num?)?.toDouble() ?? 0.0;
      otherEarnings = (_summary['cashEarnings'] as num?)?.toDouble() ?? 0.0;
    }

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildTimeframeRow(),
          
          // Blue gradient card
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFFF6A00), Color(0xFFEA580C)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(24),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFFF6A00).withOpacity(0.2),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  )
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        "Total Earnings",
                        style: GoogleFonts.inter(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(width: 8),
                      GestureDetector(
                        onTap: () => setState(() => _hideEarnings = !_hideEarnings),
                        child: Icon(
                          _hideEarnings ? Icons.visibility_off : Icons.visibility,
                          color: Colors.white70,
                          size: 16,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _hideEarnings ? "₹ ••••" : "₹${totalEarnings.toStringAsFixed(2)}",
                    style: GoogleFonts.outfit(
                      fontSize: 34,
                      fontWeight: FontWeight.w900,
                      color: Colors.white,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Icon(Icons.trending_up, color: Color(0xFF4ADE80), size: 14),
                      const SizedBox(width: 6),
                      Text(
                        "0% from last week",
                        style: GoogleFonts.inter(color: const Color(0xFF4ADE80), fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Container(height: 1, color: Colors.white24),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            "Withdrawable Balance",
                            style: GoogleFonts.inter(color: Colors.white70, fontSize: 11),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _hideEarnings ? "₹ ••••" : "₹${withdrawable.toStringAsFixed(2)}",
                            style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                          ),
                        ],
                      ),
                      ElevatedButton(
                        onPressed: _showWithdrawDialog,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(0xFFFF6A00),
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        ),
                        child: Row(
                          children: [
                            Text(
                              "Withdraw to Bank",
                              style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(width: 6),
                            const Icon(Icons.arrow_forward_rounded, size: 12),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Earnings line graph section
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  "Earnings Overview",
                  style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: const Color(0xFF0F172A)),
                ),
                Row(
                  children: [
                    Text(
                      "This Month",
                      style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00)),
                    ),
                    const Icon(Icons.arrow_drop_down, color: Color(0xFFFF6A00)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          EarningsLineChart(
            dataPoints: const [100.0, 250.0, 180.0, 200.0, 320.0, 290.0, 410.0, 380.0, 520.0],
          ),
          const SizedBox(height: 24),

          // 2x2 grid of mini metrics cards
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(child: _buildMetricCard("Base Earnings", baseEarnings, Icons.account_balance_wallet_rounded, const Color(0xFF10B981))),
                    const SizedBox(width: 12),
                    Expanded(child: _buildMetricCard("Tips", tips, Icons.card_membership_rounded, const Color(0xFFF59E0B))),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: _buildMetricCard("Incentives", incentives, Icons.star_rounded, const Color(0xFF8B5CF6))),
                    const SizedBox(width: 12),
                    Expanded(child: _buildMetricCard("Other Earnings", otherEarnings, Icons.work_rounded, const Color(0xFF3B82F6))),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),

          // Recent Transactions Feed
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  "Recent Transactions",
                  style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: const Color(0xFF0F172A)),
                ),
                TextButton(
                  onPressed: () => _subTabController.animateTo(1),
                  child: Text(
                    "View All",
                    style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          _buildRecentTransactionsList(),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildMetricCard(String title, double amount, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: color.withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _hideEarnings ? "₹ ••••" : "₹${amount.toStringAsFixed(2)}",
                  style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF0F172A)),
                ),
                const SizedBox(height: 2),
                Text(
                  title,
                  style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B), fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRecentTransactionsList() {
    final displayList = _history.take(4).toList();
    if (displayList.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16.0),
        child: Center(
          child: Text(
            "No recent transactions found",
            style: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 13),
          ),
        ),
      );
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: displayList.length,
      itemBuilder: (context, index) {
        final tx = displayList[index];
        final price = tx['price'] ?? tx['earnings'] ?? '0';
        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFF1F5F9)),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: const BoxDecoration(
                  color: Color(0xFFEFF6FF),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.work_outline_rounded, color: Color(0xFFFF6A00), size: 18),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tx['title'] ?? tx['category'] ?? "Gig Complete",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF0F172A)),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      "Completed: ${tx['userName'] ?? 'Customer'}",
                      style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B)),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    "+₹$price",
                    style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: const Color(0xFF16A34A)),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    "Success",
                    style: GoogleFonts.inter(fontSize: 10, color: const Color(0xFF16A34A), fontWeight: FontWeight.bold),
                  ),
                ],
              )
            ],
          ),
        );
      },
    );
  }

  Widget _buildTransactionsTab() {
    if (_history.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.history_rounded, size: 48, color: Color(0xFF94A3B8)),
            const SizedBox(height: 12),
            Text(
              "No transaction history",
              style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF475569)),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _history.length,
      itemBuilder: (context, index) {
        final tx = _history[index];
        final price = tx['price'] ?? tx['earnings'] ?? '0';
        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFF1F5F9)),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: const BoxDecoration(
                  color: Color(0xFFEFF6FF),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.receipt_long_rounded, color: Color(0xFFFF6A00), size: 20),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tx['title'] ?? tx['category'] ?? "Nexo Gig",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 14, color: const Color(0xFF0F172A)),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      tx['created_at'] != null ? tx['created_at'].toString().split('T')[0] : "Completed",
                      style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B)),
                    ),
                  ],
                ),
              ),
              Text(
                "+₹$price",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF16A34A)),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildPayoutsTab() {
    double totalWithdrawn = 0.0;
    try {
      totalWithdrawn = double.tryParse(_summary['totalWithdrawn']?.toString() ?? '0') ?? 0.0;
    } catch (_) {
      totalWithdrawn = (_summary['totalWithdrawn'] as num?)?.toDouble() ?? 0.0;
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: const BoxDecoration(
                    color: Color(0xFFEFF6FF),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.account_balance_rounded, color: Color(0xFFFF6A00), size: 24),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "State Bank of India",
                        style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: const Color(0xFF0F172A)),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        "**** **** 4567",
                        style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF64748B)),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      "₹${totalWithdrawn.toStringAsFixed(2)}",
                      style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: const Color(0xFF0F172A)),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      "Total Payout",
                      style: GoogleFonts.inter(fontSize: 10, color: const Color(0xFF64748B)),
                    ),
                  ],
                )
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text(
            "Payout History",
            style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: const Color(0xFF0F172A)),
          ),
          const SizedBox(height: 12),
          if (totalWithdrawn <= 0)
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 40.0),
                child: Text(
                  "No payout withdrawals recorded yet.",
                  style: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 13),
                ),
              ),
            )
          else
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: 1,
              itemBuilder: (context, index) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFF1F5F9)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: const BoxDecoration(
                          color: Color(0xFFDCFCE7),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.check_circle_outline_rounded, color: Color(0xFF16A34A), size: 18),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              "Withdraw to Bank",
                              style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF0F172A)),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              "Processed successfully",
                              style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B)),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        "-₹${totalWithdrawn.toStringAsFixed(2)}",
                        style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: const Color(0xFF475569)),
                      )
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}

// Chart Painter
class EarningsLineChart extends StatelessWidget {
  final List<double> dataPoints;
  const EarningsLineChart({super.key, required this.dataPoints});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 120,
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: CustomPaint(
        painter: LineChartPainter(dataPoints: dataPoints),
      ),
    );
  }
}

class LineChartPainter extends CustomPainter {
  final List<double> dataPoints;
  LineChartPainter({required this.dataPoints});

  @override
  void paint(Canvas canvas, Size size) {
    if (dataPoints.isEmpty) return;
    
    final paint = Paint()
      ..color = const Color(0xFFFF6A00)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round;

    final fillPaint = Paint()
      ..style = PaintingStyle.fill;

    final path = Path();
    final fillPath = Path();

    final double widthBetweenPoints = size.width / (dataPoints.length - 1);
    final double maxValue = dataPoints.reduce((a, b) => a > b ? a : b);
    final double minValue = dataPoints.reduce((a, b) => a < b ? a : b);
    final double valueRange = maxValue - minValue == 0 ? 1 : maxValue - minValue;

    double getX(int index) => index * widthBetweenPoints;
    double getY(double val) {
      final double percentage = (val - minValue) / valueRange;
      return size.height - (percentage * (size.height * 0.7) + (size.height * 0.15));
    }

    path.moveTo(getX(0), getY(dataPoints[0]));
    fillPath.moveTo(getX(0), size.height);
    fillPath.lineTo(getX(0), getY(dataPoints[0]));

    for (int i = 1; i < dataPoints.length; i++) {
      path.lineTo(getX(i), getY(dataPoints[i]));
      fillPath.lineTo(getX(i), getY(dataPoints[i]));
    }

    fillPath.lineTo(getX(dataPoints.length - 1), size.height);
    fillPath.close();

    final rect = Rect.fromLTWH(0, 0, size.width, size.height);
    fillPaint.shader = LinearGradient(
      colors: [
        const Color(0xFFFF6A00).withOpacity(0.2),
        const Color(0xFFFF6A00).withOpacity(0.0),
      ],
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
    ).createShader(rect);

    canvas.drawPath(fillPath, fillPaint);
    canvas.drawPath(path, paint);

    final pointPaint = Paint()
      ..color = const Color(0xFFFF6A00)
      ..style = PaintingStyle.fill;
    final borderPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;

    for (int i = 0; i < dataPoints.length; i++) {
      final center = Offset(getX(i), getY(dataPoints[i]));
      canvas.drawCircle(center, 4, pointPaint);
      canvas.drawCircle(center, 4, borderPaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
