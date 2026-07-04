import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/utils/network_helper.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  bool _isLoading = true;
  double _balance = 0.0;
  double _holdBalance = 0.0;
  List<dynamic> _transactions = [];
  String _token = "";
  late Razorpay _razorpay;
  double _depositAmountPending = 0.0;

  @override
  void initState() {
    super.initState();
    _fetchWalletData();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handlePaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handlePaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _handleExternalWallet);
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  void _handlePaymentSuccess(PaymentSuccessResponse response) {
    if (response.paymentId != null) {
      _verifyRealDeposit(
        response.orderId ?? '',
        response.paymentId!,
        response.signature ?? '',
        _depositAmountPending,
      );
    }
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text("Payment Failed: ${response.message ?? 'Unknown Error'} (Code: ${response.code})"),
        backgroundColor: Colors.red,
      ),
    );
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text("External wallet: ${response.walletName}")),
    );
  }

  Future<void> _verifyRealDeposit(String orderId, String paymentId, String signature, double amount) async {
    setState(() => _isLoading = true);
    try {
      final verifyResponse = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/wallet/verify-deposit'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'razorpay_order_id': orderId,
          'razorpay_payment_id': paymentId,
          'razorpay_signature': signature,
          'amount': amount
        }),
      );

      final verifyData = json.decode(verifyResponse.body);
      if (verifyResponse.statusCode == 200 && verifyData['success'] == true) {
        if (mounted) {
          _showPaymentSuccessModal(paymentId, amount);
        }
        _fetchWalletData();
      } else {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Verification failed: ${verifyData['message'] ?? 'Error'}")),
        );
      }
    } catch (e) {
      setState(() => _isLoading = false);
      debugPrint("Verification exception: $e");
    }
  }

  Future<void> _fetchWalletData() async {
    _token = await SharedPrefsHelper.getToken() ?? '';
    if (_token.isEmpty) return;

    try {
      final balanceResponse = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/wallet/balance'),
        headers: {'Authorization': 'Bearer $_token'},
      );

      final transResponse = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/wallet/transactions'),
        headers: {'Authorization': 'Bearer $_token'},
      );

      if (balanceResponse.statusCode == 200 && transResponse.statusCode == 200) {
        final balanceData = json.decode(balanceResponse.body);
        final transData = json.decode(transResponse.body);

        if (mounted) {
          setState(() {
            _balance = double.tryParse(balanceData['balance']?.toString() ?? '0') ?? 0;
            _holdBalance = double.tryParse(balanceData['holdBalance']?.toString() ?? '0') ?? 0;
            _transactions = transData['transactions'] ?? [];
            _isLoading = false;
          });
        }
      } else {
        if (mounted) setState(() => _isLoading = false);
      }
    } catch (e) {
      debugPrint("Error fetching wallet data: $e");
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _initiateRazorpayPayment(double amount) async {
    setState(() => _isLoading = true);
    String? orderId;
    bool isSimulated = false;
    try {
      final orderResponse = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/wallet/create-deposit-order'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: json.encode({'amount': amount}),
      ).timeout(const Duration(seconds: 5));

      final orderData = json.decode(orderResponse.body);
      if (orderResponse.statusCode == 200 && orderData['success'] == true) {
        orderId = orderData['order_id'];
        isSimulated = orderData['isSimulated'] ?? false;
      }
    } catch (e) {
      debugPrint("Error creating Razorpay order: $e");
    }

    if (orderId == null) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Failed to initiate payment gateway")),
      );
      return;
    }

    setState(() => _isLoading = false);

    if (isSimulated) {
      // Open Custom Mock Branded Sheet (for placeholder/invalid credentials)
      _showRazorpayCheckoutSheet(orderId, amount);
    } else {
      // Launch Real Razorpay SDK Checkout (for real/valid credentials)
      String keyId = 'rzp_test_T1woiscWDbu4xf';
      try {
        final keyResponse = await http.get(Uri.parse('${NetworkHelper.baseUrl}/api/payment/razorpay-key'));
        final keyData = json.decode(keyResponse.body);
        keyId = keyData['keyId'] ?? keyId;
      } catch (e) {
        debugPrint("Error fetching Razorpay key: $e");
      }

      _depositAmountPending = amount;
      final options = {
        'key': keyId,
        'amount': (amount * 100).round(), // amount in paise
        'name': 'Nexo',
        'order_id': orderId,
        'description': 'Wallet Deposit',
        'timeout': 300,
        'prefill': {
          'contact': '',
          'email': '',
        }
      };

      try {
        _razorpay.open(options);
      } catch (e) {
        debugPrint("Razorpay SDK launch error: $e");
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("SDK launch failed: $e")),
        );
      }
    }
  }

  void _showRazorpayCheckoutSheet(String orderId, double amount) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) {
          return Container(
            height: MediaQuery.of(context).size.height * 0.75,
            decoration: const BoxDecoration(
              color: Color(0xFF0C193A), // Razorpay dark navy
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: Column(
              children: [
                // Razorpay Header Bar
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                  decoration: const BoxDecoration(
                    color: Color(0xFF13244F),
                    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(10)),
                        child: Text("N", style: GoogleFonts.outfit(fontWeight: FontWeight.w900, fontSize: 16, color: Colors.white)),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text("Nexo Payments (Demo Mode)", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: Colors.white)),
                          Text("Order ID: $orderId", style: GoogleFonts.inter(fontSize: 10, color: Colors.white54)),
                        ],
                      ),
                      const Spacer(),
                      Text(
                        "₹${amount.toStringAsFixed(2)}",
                        style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white),
                      ),
                    ],
                  ),
                ),
                
                // Razorpay Body / Options
                Expanded(
                  child: Container(
                    color: const Color(0xFF0C193A),
                    padding: const EdgeInsets.all(24),
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text("CHOOSE PAYMENT METHOD", style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white38, letterSpacing: 1.0)),
                          const SizedBox(height: 16),
                          
                          // Option: UPI
                          _buildPaymentMethodTile(
                            icon: Icons.qr_code_2_rounded,
                            title: "UPI / GooglePay / PhonePe",
                            subtitle: "Pay instantly using any UPI app",
                            onTap: () => _simulatePaymentMethodFlow(orderId, amount, "UPI"),
                          ),
                          const SizedBox(height: 12),
                          
                          // Option: Card
                          _buildPaymentMethodTile(
                            icon: Icons.credit_card_rounded,
                            title: "Card",
                            subtitle: "Visa, Mastercard, RuPay, Maestro",
                            onTap: () => _simulatePaymentMethodFlow(orderId, amount, "CARD"),
                          ),
                          const SizedBox(height: 12),
                          
                          // Option: Netbanking
                          _buildPaymentMethodTile(
                            icon: Icons.account_balance_rounded,
                            title: "Netbanking",
                            subtitle: "All major Indian banks available",
                            onTap: () => _simulatePaymentMethodFlow(orderId, amount, "NETBANKING"),
                          ),
                          
                          const SizedBox(height: 40),
                          Center(
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.security, color: Colors.greenAccent, size: 14),
                                const SizedBox(width: 6),
                                Text(
                                  "Secured by Razorpay • PCI-DSS Compliant",
                                  style: GoogleFonts.inter(fontSize: 10, color: Colors.white30),
                                ),
                              ],
                            ),
                          )
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        }
      ),
    );
  }

  Widget _buildPaymentMethodTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF13244F),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        leading: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: Colors.white.withOpacity(0.08), borderRadius: BorderRadius.circular(12)),
          child: Icon(icon, color: const Color(0xFF3399FF), size: 22),
        ),
        title: Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
        subtitle: Text(subtitle, style: GoogleFonts.inter(fontSize: 11, color: Colors.white54)),
        trailing: const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white24, size: 14),
      ),
    );
  }

  void _simulatePaymentMethodFlow(String orderId, double amount, String method) {
    Navigator.pop(context); // Close checkout bottom sheet
 
    // Show simulated authorization screen
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) {
          Future.delayed(const Duration(seconds: 2), () {
            if (mounted) {
              Navigator.pop(context); // Close auth modal
              _verifySimulatedDeposit(orderId, amount);
            }
          });
 
          return Dialog(
            backgroundColor: const Color(0xFF0C193A),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                    width: 50,
                    height: 50,
                    child: CircularProgressIndicator(
                      color: Color(0xFF3399FF),
                      strokeWidth: 3.5,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    "Authorizing Payment...",
                    style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Processing transaction via Razorpay Secure gateway",
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(fontSize: 12, color: Colors.white54, height: 1.45),
                  ),
                ],
              ),
            ),
          );
        }
      ),
    );
  }

  Future<void> _verifySimulatedDeposit(String orderId, double amount) async {
    setState(() => _isLoading = true);
    final String paymentId = 'pay_dep_${DateTime.now().millisecondsSinceEpoch}';

    try {
      final verifyResponse = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/wallet/verify-deposit-simulation'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'razorpay_order_id': orderId,
          'razorpay_payment_id': paymentId,
          'amount': amount
        }),
      );

      final verifyData = json.decode(verifyResponse.body);
      if (verifyResponse.statusCode == 200 && verifyData['success'] == true) {
        if (mounted) {
          _showPaymentSuccessModal(paymentId, amount);
        }
        _fetchWalletData();
      } else {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Deposit signature verification failed")),
        );
      }
    } catch (e) {
      setState(() => _isLoading = false);
      debugPrint("Verification exception: $e");
    }
  }

  void _showPaymentSuccessModal(String paymentId, double amount) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(color: Color(0xFFECFDF5), shape: BoxShape.circle),
                child: const Icon(Icons.check_circle, color: Color(0xFF10B981), size: 48),
              ),
              const SizedBox(height: 20),
              Text(
                "Funds Deposited!",
                style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: const Color(0xFF0F172A)),
              ),
              const SizedBox(height: 8),
              Text(
                "Successfully added ₹${amount.toStringAsFixed(2)} to your platform wallet.",
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF64748B), height: 1.45),
              ),
              const SizedBox(height: 24),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(16)),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text("Payment ID", style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B))),
                        Text(paymentId, style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: const Color(0xFF334155))),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF6A00),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    elevation: 0,
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: Text("Done", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showAddFundsDialog() {
    final TextEditingController amountController = TextEditingController(text: "1000");
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text("Add Funds", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text("Enter amount to add to your Nexo wallet.", style: GoogleFonts.inter(fontSize: 13, color: Colors.black54)),
            const SizedBox(height: 16),
            TextField(
              controller: amountController,
              keyboardType: TextInputType.number,
              style: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00)),
              decoration: InputDecoration(
                prefixText: "₹ ",
                filled: true,
                fillColor: const Color(0xFFFFF7ED),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("Cancel", style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6A00),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: () {
              final double amt = double.tryParse(amountController.text) ?? 0;
              if (amt <= 0) return;
              Navigator.pop(context);
              _initiateRazorpayPayment(amt);
            },
            child: const Text("Add", style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFDF7F5),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.black, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          "My Wallet",
          style: GoogleFonts.outfit(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 18),
        ),
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
        : RefreshIndicator(
            onRefresh: _fetchWalletData,
            color: const Color(0xFFFF6A00),
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Wallet Card
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(28),
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFF6A00), Color(0xFFE05600)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFFF6A00).withOpacity(0.3),
                          blurRadius: 15,
                          offset: const Offset(0, 8),
                        )
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "WALLET BALANCE",
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: Colors.white70,
                            letterSpacing: 1.5,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              "₹${_balance.toStringAsFixed(2)}",
                              style: GoogleFonts.outfit(
                                fontSize: 36,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.add_circle, color: Colors.white, size: 40),
                              onPressed: _showAddFundsDialog,
                            ),
                          ],
                        ),
                        if (_holdBalance > 0) ...[
                          const SizedBox(height: 12),
                          Text(
                            "Hold Balance: ₹${_holdBalance.toStringAsFixed(2)}",
                            style: GoogleFonts.inter(fontSize: 12, color: Colors.white60),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 28),

                  // Transaction History Header
                  Text(
                    "Transaction History",
                    style: GoogleFonts.outfit(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Colors.black87,
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Transaction List
                  if (_transactions.isEmpty)
                    Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 40),
                        child: Column(
                          children: [
                            Icon(Icons.payment_outlined, size: 64, color: Colors.grey[300]),
                            const SizedBox(height: 12),
                            Text(
                              "No transactions yet",
                              style: GoogleFonts.inter(color: Colors.grey[500]),
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    ListView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: _transactions.length,
                      itemBuilder: (context, index) {
                        final tx = _transactions[index];
                        final String type = tx['type'] ?? 'DEPOSIT';
                        final double amount = double.tryParse(tx['amount']?.toString() ?? '0') ?? 0;
                        final String dateRaw = tx['created_at'] ?? '';
                        String date = '';
                        try {
                          final parsed = DateTime.parse(dateRaw).toLocal();
                          date = "${parsed.day}/${parsed.month}/${parsed.year} ${parsed.hour}:${parsed.minute.toString().padLeft(2, '0')}";
                        } catch (_) {}

                        final bool isCredit = type == 'DEPOSIT' || type == 'REFUND' || type == 'RELEASE';
                        final Color color = isCredit ? Colors.green : Colors.red;
                        final String prefix = isCredit ? "+" : "-";

                        return Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: [
                              BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10)
                            ],
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    type,
                                    style: GoogleFonts.outfit(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 15,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    date,
                                    style: GoogleFonts.inter(
                                      color: Colors.grey[500],
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ),
                              Text(
                                "$prefix₹${amount.toStringAsFixed(2)}",
                                style: GoogleFonts.outfit(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 16,
                                  color: color,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                ],
              ),
            ),
          ),
    );
  }
}
