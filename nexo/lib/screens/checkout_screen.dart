import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/components/glass_components.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/rating_screen.dart';
import 'package:url_launcher/url_launcher.dart';

class CheckoutScreen extends StatefulWidget {
  final Map<String, dynamic> job;
  const CheckoutScreen({super.key, required this.job});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  String _selectedMode = "ONLINE"; // ONLINE, WALLET, CASH, PARTIAL
  double _walletBalance = 0.0;
  bool _isLoadingWallet = true;
  bool _isProcessing = false;
  
  // For Partial/Split Scenario
  final TextEditingController _advanceController = TextEditingController();
  double _remainingCash = 0.0;
  double _jobPrice = 0.0;

  static const Color primaryColor = Color(0xFFFF6A00);
  
  @override
  void initState() {
    super.initState();
    _jobPrice = double.tryParse(widget.job['price']?.toString() ?? '0') ?? 0.0;
    // Set default advance as 30% of price
    _advanceController.text = (_jobPrice * 0.3).toStringAsFixed(0);
    _updateRemainingCash();
    _fetchWalletBalance();
    
    _advanceController.addListener(() {
      _updateRemainingCash();
    });
  }

  @override
  void dispose() {
    _advanceController.dispose();
    super.dispose();
  }

  void _updateRemainingCash() {
    final double advance = double.tryParse(_advanceController.text) ?? 0.0;
    setState(() {
      _remainingCash = (_jobPrice - advance).clamp(0.0, _jobPrice);
    });
  }

  Future<void> _fetchWalletBalance() async {
    try {
      final token = await SharedPrefsHelper.getToken();
      if (token == null) return;
      
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/wallet/balance'),
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          _walletBalance = double.tryParse(data['balance']?.toString() ?? '0') ?? 0.0;
          _isLoadingWallet = false;
        });
      }
    } catch (e) {
      debugPrint("Error fetching wallet balance: $e");
      setState(() => _isLoadingWallet = false);
    }
  }

  Future<void> _processPayment() async {
    setState(() => _isProcessing = true);
    final token = await SharedPrefsHelper.getToken();
    if (token == null) {
      _showError("Authentication required.");
      setState(() => _isProcessing = false);
      return;
    }

    try {
      final double finalAmount = _jobPrice;

      if (_selectedMode == 'ONLINE') {
        try {
          final response = await http.post(
            Uri.parse('${NetworkHelper.baseUrl}/api/payment/create-qr'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: json.encode({
              'jobId': widget.job['id'],
              'amount': finalAmount,
            }),
          );

          final data = json.decode(response.body);
          if (response.statusCode == 200 && data['success'] == true) {
            final String qrCodeUrl = data['qr_code_url'];
            final String qrCodeId = data['qr_code_id'];
            if (mounted) {
              _showQRCodeDialog(qrCodeUrl, qrCodeId);
            }
          } else {
            _showError(data['message'] ?? "Failed to generate payment QR");
          }
        } catch (e) {
          debugPrint("Error creating QR Code: $e");
          _showError("Connection error generating QR code.");
        } finally {
          setState(() => _isProcessing = false);
        }
        return;
      }

      Map<String, dynamic> reqBody = {
        'jobId': widget.job['id'],
        'amount': finalAmount,
        'paymentMode': _selectedMode,
      };

      if (_selectedMode == 'WALLET' && _walletBalance < finalAmount) {
        _showError("Insufficient wallet balance. Please add funds first.");
        setState(() => _isProcessing = false);
        return;
      }

      if (_selectedMode == 'PARTIAL') {
        final double advance = double.tryParse(_advanceController.text) ?? 0.0;
        if (advance <= 0 || advance >= _jobPrice) {
          _showError("Advance amount must be greater than 0 and less than ₹$_jobPrice");
          setState(() => _isProcessing = false);
          return;
        }
        reqBody['advanceAmount'] = advance;
        reqBody['remainingCashAmount'] = _remainingCash;
      }

      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/payment/create'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(reqBody),
      );

      final data = json.decode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Payment successful!"), backgroundColor: Colors.green),
          );
          // Proceed to Rating Screen
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(builder: (context) => RatingScreen(job: widget.job)),
          );
        }
      } else {
        _showError(data['message'] ?? "Failed to process payment");
      }
    } catch (e) {
      debugPrint("Error processing payment: $e");
      _showError("Connection error. Please try again.");
    } finally {
      if (mounted) {
        setState(() => _isProcessing = false);
      }
    }
  }

  void _showQRCodeDialog(String qrCodeUrl, String qrCodeId) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        bool isChecking = false;
        return StatefulBuilder(
          builder: (context, setModalState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF0F172A),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24), side: const BorderSide(color: Colors.white10)),
              title: Column(
                children: [
                  Text(
                    "Scan & Pay via UPI",
                    style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    "Amount Due: ₹${_jobPrice.toStringAsFixed(2)}",
                    style: GoogleFonts.inter(color: primaryColor, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Image.network(
                      qrCodeUrl,
                      width: 200,
                      height: 200,
                      fit: BoxFit.contain,
                      loadingBuilder: (context, child, loadingProgress) {
                        if (loadingProgress == null) return child;
                        return const SizedBox(
                          width: 200,
                          height: 200,
                          child: Center(
                            child: CircularProgressIndicator(color: primaryColor),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    "Scan this QR using any UPI app (GPay, PhonePe, Paytm)",
                    style: GoogleFonts.inter(color: Colors.white60, fontSize: 11),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
              actionsAlignment: MainAxisAlignment.spaceBetween,
              actions: [
                TextButton(
                  onPressed: isChecking ? null : () {
                    Navigator.pop(context);
                  },
                  child: Text("Cancel", style: GoogleFonts.inter(color: Colors.white38)),
                ),
                isChecking
                  ? const Padding(
                      padding: EdgeInsets.only(right: 16),
                      child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: primaryColor, strokeWidth: 2)),
                    )
                  : ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: primaryColor,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                      onPressed: () async {
                        setModalState(() => isChecking = true);
                        try {
                          final token = await SharedPrefsHelper.getToken();
                          final response = await http.post(
                            Uri.parse('${NetworkHelper.baseUrl}/api/payment/verify-qr'),
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': 'Bearer $token',
                            },
                            body: json.encode({
                              'jobId': widget.job['id'],
                              'qrCodeId': qrCodeId
                            }),
                          );

                          final data = json.decode(response.body);
                          if (response.statusCode == 200 && data['success'] == true) {
                            if (mounted) {
                              Navigator.pop(context); // close dialog
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text("Payment verified!"), backgroundColor: Colors.green),
                              );
                              Navigator.pushReplacement(
                                context,
                                MaterialPageRoute(builder: (context) => RatingScreen(job: widget.job)),
                              );
                            }
                          } else {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(data['message'] ?? "Payment not received yet."), backgroundColor: Colors.redAccent),
                              );
                            }
                          }
                        } catch (e) {
                          debugPrint("Verification error: $e");
                        } finally {
                          setModalState(() => isChecking = false);
                        }
                      },
                      child: Text("I have paid", style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
              ],
            );
          },
        );
      },
    );
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.redAccent),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? Colors.white : const Color(0xFF111111);
    final textSecondary = isDark ? Colors.white70 : Colors.black54;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, color: textPrimary),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          "Checkout & Pay",
          style: GoogleFonts.outfit(color: textPrimary, fontWeight: FontWeight.bold, fontSize: 20),
        ),
      ),
      body: PremiumBackground(
        child: SafeArea(
          child: _isProcessing
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircularProgressIndicator(color: primaryColor),
                      SizedBox(height: 16),
                      Text(
                        "Processing Secure Payment...",
                        style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold),
                      )
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Job / Amount summary
                      GlassContainer(
                        blur: 24,
                        padding: const EdgeInsets.all(22),
                        child: Column(
                          children: [
                            Text(
                              "JOB PAYMENT DUE",
                              style: GoogleFonts.inter(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: primaryColor,
                                letterSpacing: 1.5,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              "₹${_jobPrice.toStringAsFixed(2)}",
                              style: GoogleFonts.outfit(
                                fontSize: 38,
                                fontWeight: FontWeight.bold,
                                color: textPrimary,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              widget.job['category'] ?? "General Service",
                              style: GoogleFonts.inter(fontSize: 14, color: textSecondary, fontWeight: FontWeight.w600),
                            ),
                            if (widget.job['worker'] != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                "Worker: ${widget.job['worker']['name'] ?? 'Assigned Expert'}",
                                style: GoogleFonts.inter(fontSize: 12, color: textSecondary),
                              ),
                            ]
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),

                      Text(
                        "SELECT PAYMENT MODE",
                        style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold, color: textSecondary, letterSpacing: 1.2),
                      ),
                      const SizedBox(height: 12),

                      // Online Option
                      _buildOptionTile(
                        mode: "ONLINE",
                        icon: Icons.credit_card_rounded,
                        title: "Online Gateway (Simulator)",
                        subtitle: "Pay securely via Card, UPI, Netbanking",
                        color: Colors.blueAccent,
                      ),
                      const SizedBox(height: 12),

                      // Wallet Option
                      _buildOptionTile(
                        mode: "WALLET",
                        icon: Icons.account_balance_wallet_outlined,
                        title: "Pay using Wallet",
                        subtitle: _isLoadingWallet 
                            ? "Fetching wallet..." 
                            : "Available balance: ₹${_walletBalance.toStringAsFixed(2)}",
                        color: Colors.green,
                        disabled: !_isLoadingWallet && _walletBalance < _jobPrice,
                      ),
                      const SizedBox(height: 12),

                      // Cash Option
                      _buildOptionTile(
                        mode: "CASH",
                        icon: Icons.payments_outlined,
                        title: "Direct Cash Payment",
                        subtitle: "Pay worker directly in cash after completion",
                        color: const Color(0xFF10B981),
                      ),
                      const SizedBox(height: 12),

                      // Partial Option
                      _buildOptionTile(
                        mode: "PARTIAL",
                        icon: Icons.pie_chart_outline_rounded,
                        title: "Partial / Split Payment",
                        subtitle: "Pay advance online, remaining amount in cash",
                        color: Colors.purpleAccent,
                      ),
                      const SizedBox(height: 20),

                      // Split config helper
                      if (_selectedMode == 'PARTIAL') ...[
                        GlassContainer(
                          blur: 20,
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "SPLIT CONFIGURATION",
                                style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.purpleAccent, letterSpacing: 1.2),
                              ),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _advanceController,
                                      keyboardType: TextInputType.number,
                                      style: TextStyle(color: textPrimary, fontWeight: FontWeight.bold),
                                      decoration: const InputDecoration(
                                        labelText: "Online Advance (₹)",
                                        labelStyle: TextStyle(color: Colors.white54),
                                        border: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 20),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        const Text(
                                          "Cash Remaining",
                                          style: TextStyle(fontSize: 12, color: Colors.white54),
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          "₹${_remainingCash.toStringAsFixed(0)}",
                                          style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: textPrimary),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),
                      ],

                      // Submit/Pay Button
                      GlassButton(
                        onPressed: _processPayment,
                        text: _selectedMode == "CASH" 
                            ? "CONFIRM CASH PAYMENT" 
                            : _selectedMode == "PARTIAL" 
                                ? "PAY ADVANCE ₹${double.tryParse(_advanceController.text)?.toStringAsFixed(0) ?? '0'} ONLINE"
                                : "PAY ₹${_jobPrice.toStringAsFixed(0)} NOW",
                      ),
                    ],
                  ),
                ),
        ),
      ),
    );
  }

  Widget _buildOptionTile({
    required String mode,
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    bool disabled = false,
  }) {
    final bool isSelected = _selectedMode == mode;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return GestureDetector(
      onTap: disabled ? null : () {
        setState(() {
          _selectedMode = mode;
        });
      },
      child: GlassContainer(
        blur: 15,
        padding: const EdgeInsets.all(16),
        border: Border.all(
          color: isSelected 
              ? color.withOpacity(0.6) 
              : Colors.white.withOpacity(0.08),
          width: isSelected ? 2.0 : 1.0,
        ),
        color: disabled 
            ? Colors.black.withOpacity(0.4) 
            : isSelected 
                ? color.withOpacity(0.12) 
                : Colors.black.withOpacity(0.2),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: disabled ? Colors.white10 : color.withOpacity(0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: disabled ? Colors.white30 : color, size: 24),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.outfit(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: disabled ? Colors.white30 : Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      color: disabled ? Colors.white24 : Colors.white60,
                    ),
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(Icons.check_circle_rounded, color: color, size: 20)
            else if (disabled)
              const Icon(Icons.lock_outline_rounded, color: Colors.white24, size: 18)
            else
              const Icon(Icons.circle_outlined, color: Colors.white30, size: 20),
          ],
        ),
      ),
    );
  }
}
