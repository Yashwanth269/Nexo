import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/auth_screen.dart';
import 'package:nexo/screens/add_location_screen.dart';
import 'package:nexo/screens/security_screen.dart';
import 'package:nexo/screens/support_screen.dart';
import 'package:nexo/screens/legal_screen.dart';
import 'package:nexo/screens/wallet_screen.dart';
import 'package:nexo/screens/my_jobs_screen.dart';
import 'package:nexo/screens/settings_screen.dart';
import 'package:nexo/utils/network_helper.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  static const Color primaryOrange = Color(0xFFFF6A00);
  static const Color textPrimary = Color(0xFF1F2937);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color dividerColor = Color(0xFFE5E7EB);

  String? _name;
  String? _phone;
  String? _photoUrl;
  List<dynamic> _locations = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadProfileData();
  }

  Future<void> _loadProfileData() async {
    try {
      final userId = await SharedPrefsHelper.getUserId();
      if (userId == null) return;

      final response = await http.get(Uri.parse('${NetworkHelper.baseUrl}/api/user/profile/$userId'));
      
      if (mounted) {
        setState(() {
          if (response.statusCode == 200) {
            final data = json.decode(response.body);
            if (data['success']) {
              final user = data['user'];
              _name = user['name'];
              _phone = user['phone'];
              _photoUrl = user['photoUrl'];
              _locations = user['locations'] ?? [];
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
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: textPrimary),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          "Profile",
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: textPrimary),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: textSecondary),
            onPressed: () {},
          ),
        ],
        centerTitle: true,
      ),
      body: _isLoading 
          ? const Center(child: CircularProgressIndicator(color: primaryOrange))
          : SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 20),
                  // Profile Header
                  Row(
                    children: [
                      _buildProfilePhoto(),
                      const SizedBox(width: 20),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _name ?? "Add your name",
                            style: GoogleFonts.outfit(
                              fontSize: 22, 
                              fontWeight: FontWeight.bold,
                              color: _name == null ? textSecondary : textPrimary,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _phone != null ? "+91 $_phone" : "No phone number",
                            style: GoogleFonts.inter(color: textSecondary, fontSize: 16),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 30),
                  const Divider(color: dividerColor, height: 1),
                  const SizedBox(height: 30),
                  
                  // Saved Locations Section
                  Text(
                    "SAVED LOCATIONS",
                    style: GoogleFonts.outfit(
                      fontSize: 14, 
                      fontWeight: FontWeight.bold, 
                      color: Color(0xFF4B3621).withOpacity(0.8),
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (_locations.isEmpty)
                    _buildEmptyState("No locations added yet", Icons.location_off_outlined)
                  else
                    ..._locations.map((loc) => _buildLocationCard(loc)).toList(),
                  
                  _buildAddLocationButton(),
                  
                  const SizedBox(height: 30),
                  const Divider(color: dividerColor, height: 1),
                  const SizedBox(height: 20),
                  
                  // Menu Options
                  _buildMenuOption(Icons.account_balance_wallet_outlined, "My Wallet", onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (context) => const WalletScreen()));
                  }),
                  _buildMenuOption(Icons.assignment_outlined, "My Jobs", onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const MyJobsScreen()));
                  }),
                  _buildMenuOption(Icons.security_outlined, "Security", onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (context) => const SecurityScreen()));
                  }),
                  _buildMenuOption(Icons.help_outline, "Help & Support", onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (context) => const SupportScreen()));
                  }),
                  _buildMenuOption(Icons.gavel_outlined, "Legal Information", onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (context) => const LegalScreen()));
                  }),
                  _buildMenuOption(Icons.settings_outlined, "Settings", onTap: () {
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
                  }),
                  _buildMenuOption(Icons.logout, "Logout", isDestructive: true, onTap: () async {
                    await SharedPrefsHelper.clearUserData();
                    if (mounted) {
                      Navigator.pushAndRemoveUntil(
                        context, 
                        MaterialPageRoute(builder: (context) => const AuthScreen()),
                        (route) => false,
                      );
                    }
                  }),
                  
                  const SizedBox(height: 40),
                ],
              ),
            ),
    );
  }

  Widget _buildProfilePhoto() {
    return Container(
      width: 80,
      height: 80,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: primaryOrange.withOpacity(0.2), width: 3),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ClipOval(
        child: _photoUrl != null && _photoUrl!.isNotEmpty
            ? Image.network(
                '${NetworkHelper.baseUrl}$_photoUrl',
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => _buildPhotoPlaceholder(),
              )
            : _buildPhotoPlaceholder(),
      ),
    );
  }

  Widget _buildPhotoPlaceholder() {
    return Container(
      color: Colors.grey[100],
      child: const Icon(Icons.person, size: 40, color: textSecondary),
    );
  }

  Widget _buildEmptyState(String message, IconData icon) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: textSecondary.withOpacity(0.5), size: 20),
          const SizedBox(width: 10),
          Text(message, style: GoogleFonts.inter(color: textSecondary, fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildLocationCard(dynamic loc) {
    IconData icon;
    switch (loc['name']?.toString().toLowerCase()) {
      case 'home': icon = Icons.home_outlined; break;
      case 'farm': icon = Icons.agriculture_outlined; break;
      case 'work': icon = Icons.business_center_outlined; break;
      default: icon = Icons.location_on_outlined;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: dividerColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: primaryOrange.withOpacity(0.05),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: primaryOrange, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  loc['name'] ?? "Location", 
                  style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: textPrimary),
                ),
                Text(
                  loc['address'] ?? "No address provided", 
                  style: GoogleFonts.inter(color: textSecondary, fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: Color(0xFFD1D5DB), size: 20),
        ],
      ),
    );
  }

  Widget _buildAddLocationButton() {
    return Container(
      width: double.infinity,
      height: 55,
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: primaryOrange.withOpacity(0.3), style: BorderStyle.solid),
      ),
      child: TextButton.icon(
        onPressed: () async {
          final result = await Navigator.push(
            context, 
            MaterialPageRoute(builder: (context) => const AddLocationScreen()),
          );
          if (result == true) {
            _loadProfileData();
          }
        },
        icon: const Icon(Icons.add_location_alt_outlined, color: primaryOrange, size: 20),
        label: Text(
          "+ Add New Location", 
          style: GoogleFonts.inter(color: primaryOrange, fontWeight: FontWeight.bold, fontSize: 14),
        ),
      ),
    );
  }

  Widget _buildMenuOption(IconData icon, String title, {bool isDestructive = false, VoidCallback? onTap}) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Row(
          children: [
            Icon(icon, color: isDestructive ? Colors.red : textPrimary, size: 24),
            const SizedBox(width: 16),
            Text(
              title, 
              style: GoogleFonts.inter(
                fontSize: 16, 
                fontWeight: FontWeight.w600, 
                color: isDestructive ? Colors.red : textPrimary,
              ),
            ),
            const Spacer(),
            if (!isDestructive)
              const Icon(Icons.chevron_right, color: Color(0xFFD1D5DB), size: 20),
          ],
        ),
      ),
    );
  }
}
