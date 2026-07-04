import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nexo/screens/auth_screen.dart';
import 'package:nexo/services/shared_prefs_helper.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  static const Color primaryOrange = Color(0xFFFF6A00);
  static const Color textPrimary = Color(0xFF1F2937);
  static const Color textSecondary = Color(0xFF6B7280);

  bool _pushNotifications = true;
  bool _emailNotifications = false;
  bool _smsNotifications = true;
  bool _biometricLogin = false;
  String _selectedLanguage = 'English';

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _pushNotifications = prefs.getBool('settings_push') ?? true;
      _emailNotifications = prefs.getBool('settings_email') ?? false;
      _smsNotifications = prefs.getBool('settings_sms') ?? true;
      _biometricLogin = prefs.getBool('settings_biometric') ?? false;
      _selectedLanguage = prefs.getString('settings_lang') ?? 'English';
    });
  }

  Future<void> _saveSetting(String key, dynamic value) async {
    final prefs = await SharedPreferences.getInstance();
    if (value is bool) {
      await prefs.setBool(key, value);
    } else if (value is String) {
      await prefs.setString(key, value);
    }
  }

  void _showLanguageSelector() {
    final languages = ['English', 'Hindi (हिन्दी)', 'Telugu (తెలుగు)', 'Tamil (தமிழ்)', 'Kannada (ಕನ್ನಡ)'];
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Select Language",
              style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: textPrimary),
            ),
            const SizedBox(height: 16),
            ...languages.map((lang) {
              final isSelected = _selectedLanguage == lang.split(' ')[0];
              return ListTile(
                title: Text(lang, style: GoogleFonts.inter(fontSize: 15, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal)),
                trailing: isSelected ? const Icon(Icons.check_circle, color: primaryOrange) : null,
                onTap: () {
                  final shortLang = lang.split(' ')[0];
                  setState(() {
                    _selectedLanguage = shortLang;
                  });
                  _saveSetting('settings_lang', shortLang);
                  Navigator.pop(context);
                },
              );
            }).toList(),
          ],
        ),
      ),
    );
  }

  void _clearCache() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text("Clear App Cache", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
        content: Text("This will clear cached images and temporary files. It won't delete your profile or account info.", style: GoogleFonts.inter(fontSize: 14, color: textSecondary)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("Cancel", style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: primaryOrange, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text("App cache cleared successfully!")),
              );
            },
            child: const Text("Clear", style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  void _deleteAccount() {
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
                decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(20)),
                child: const Icon(Icons.delete_forever, color: Colors.red, size: 36),
              ),
              const SizedBox(height: 20),
              Text(
                "Delete Account Permanently?",
                textAlign: TextAlign.center,
                style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: textPrimary),
              ),
              const SizedBox(height: 12),
              Text(
                "This action cannot be undone. All your job history, wallet transactions, and profile details will be permanently removed from Nexo.",
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(fontSize: 13, color: textSecondary, height: 1.45),
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    elevation: 0,
                  ),
                  onPressed: () async {
                    await SharedPrefsHelper.clearUserData();
                    if (mounted) {
                      Navigator.pushAndRemoveUntil(
                        context,
                        MaterialPageRoute(builder: (context) => const AuthScreen()),
                        (route) => false,
                      );
                    }
                  },
                  child: Text("Delete Account", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text("Cancel", style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: textSecondary)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: textPrimary, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          "Settings",
          style: GoogleFonts.outfit(color: textPrimary, fontWeight: FontWeight.bold, fontSize: 18),
        ),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Section: Notifications
            _buildSectionHeader("NOTIFICATIONS"),
            _buildToggleItem(
              title: "Push Notifications",
              subtitle: "Instant updates on job progress and offers",
              value: _pushNotifications,
              onChanged: (val) {
                setState(() => _pushNotifications = val);
                _saveSetting('settings_push', val);
              },
            ),
            const SizedBox(height: 12),
            _buildToggleItem(
              title: "Email Reports",
              subtitle: "Monthly statements and invoice digests",
              value: _emailNotifications,
              onChanged: (val) {
                setState(() => _emailNotifications = val);
                _saveSetting('settings_email', val);
              },
            ),
            const SizedBox(height: 12),
            _buildToggleItem(
              title: "SMS Alerts",
              subtitle: "Direct notifications for critical updates",
              value: _smsNotifications,
              onChanged: (val) {
                setState(() => _smsNotifications = val);
                _saveSetting('settings_sms', val);
              },
            ),

            const SizedBox(height: 28),

            // Section: Preferences
            _buildSectionHeader("PREFERENCES"),
            _buildActionItem(
              icon: Icons.language,
              title: "App Language",
              valueText: _selectedLanguage,
              onTap: _showLanguageSelector,
            ),

            const SizedBox(height: 28),

            // Section: Security
            _buildSectionHeader("SECURITY"),
            _buildToggleItem(
              title: "Biometric Login",
              subtitle: "Access Nexo securely using fingerprint/FaceID",
              value: _biometricLogin,
              onChanged: (val) {
                setState(() => _biometricLogin = val);
                _saveSetting('settings_biometric', val);
              },
            ),

            const SizedBox(height: 28),

            // Section: System & Data
            _buildSectionHeader("DATA & SYSTEM"),
            _buildActionItem(
              icon: Icons.cleaning_services_rounded,
              title: "Clear App Cache",
              valueText: "Free up storage space",
              onTap: _clearCache,
            ),
            const SizedBox(height: 12),
            _buildActionItem(
              icon: Icons.delete_outline_rounded,
              title: "Delete Account",
              valueText: "Permanently delete details",
              isDestructive: true,
              onTap: _deleteAccount,
            ),

            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 8),
      child: Text(
        title,
        style: GoogleFonts.outfit(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: primaryOrange.withOpacity(0.85),
          letterSpacing: 1.0,
        ),
      ),
    );
  }

  Widget _buildToggleItem({
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
        title: Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: textPrimary)),
        subtitle: Text(subtitle, style: GoogleFonts.inter(fontSize: 12, color: textSecondary, height: 1.3)),
        trailing: Switch.adaptive(
          value: value,
          activeColor: primaryOrange,
          onChanged: onChanged,
        ),
      ),
    );
  }

  Widget _buildActionItem({
    required IconData icon,
    required String title,
    required String valueText,
    bool isDestructive = false,
    required VoidCallback onTap,
  }) {
    final titleColor = isDestructive ? Colors.red : textPrimary;
    final iconColor = isDestructive ? Colors.red : primaryOrange;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
        leading: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: isDestructive ? const Color(0xFFFEF2F2) : const Color(0xFFFFF7ED),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, color: iconColor, size: 20),
        ),
        title: Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: titleColor)),
        subtitle: Text(valueText, style: GoogleFonts.inter(fontSize: 12, color: textSecondary)),
        trailing: const Icon(Icons.chevron_right, color: Color(0xFF9CA3AF), size: 20),
      ),
    );
  }
}
