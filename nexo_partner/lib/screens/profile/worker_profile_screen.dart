import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image_picker/image_picker.dart';
import '../../utils/network_helper.dart';
import '../../utils/image_utils.dart';
import '../settings/settings_screen.dart';
import 'profile_setup_screen.dart';
import '../auth/login_screen.dart';

class WorkerProfileScreen extends StatefulWidget {
  final bool isTab;
  const WorkerProfileScreen({super.key, this.isTab = false});

  @override
  State<WorkerProfileScreen> createState() => _WorkerProfileScreenState();
}

class _WorkerProfileScreenState extends State<WorkerProfileScreen> {
  bool _isLoading = true;
  dynamic _worker;
  final ImagePicker _picker = ImagePicker();

  final List<String> _prebuiltAvatars = [
    "https://api.dicebear.com/7.x/adventurer/png?seed=John",
    "https://api.dicebear.com/7.x/adventurer/png?seed=Alex",
    "https://api.dicebear.com/7.x/adventurer/png?seed=Sara",
    "https://api.dicebear.com/7.x/adventurer/png?seed=Mia",
    "https://api.dicebear.com/7.x/adventurer/png?seed=Robert",
  ];

  @override
  void initState() {
    super.initState();
    _fetchProfile();
  }

  Future<void> _fetchProfile() async {
    setState(() {
      _isLoading = true;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      final phone = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
      if (phone == null) {
        setState(() {
          _isLoading = false;
        });
        return;
      }
      final token = prefs.getString('worker_token');
      final Map<String, String> headers = {};
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
      }
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/worker/profile/details/$phone'),
        headers: headers,
      );
      if (response.statusCode == 200) {
        setState(() {
          _worker = json.decode(response.body)['worker'];
          _isLoading = false;
        });
      } else {
        setState(() {
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint("Error fetching profile: $e");
      setState(() {
        _isLoading = false;
      });
    }
  }

  Future<void> _uploadCustomPhoto() async {
    try {
      final XFile? file = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 70);
      if (file == null) return;

      setState(() => _isLoading = true);

      // Upload file to server
      var request = http.MultipartRequest('POST', Uri.parse('${NetworkHelper.baseUrl}/api/user/upload-photo'));
      request.files.add(await http.MultipartFile.fromPath('photo', file.path));
      
      final responseStream = await request.send();
      final response = await http.Response.fromStream(responseStream);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final String photoUrl = data['photoUrl'];
        await _updateProfilePhoto(photoUrl);
      } else {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Failed to upload image to server."), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error picking image: $e"), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _updateProfilePhoto(String photoUrl) async {
    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/worker/profile/update-photo'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'phoneNumber': _worker['phoneNumber'],
          'photoUrl': photoUrl,
        }),
      );

      if (response.statusCode == 200) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('workerPhoto', photoUrl);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Profile picture updated successfully!"), backgroundColor: Color(0xFF10B981)),
        );
        _fetchProfile();
      } else {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Failed to update profile picture database record."), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error updating photo: $e"), backgroundColor: Colors.redAccent),
      );
    }
  }

  void _showChangePhotoOptions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 16),
            Text(
              "Change Profile Picture",
              style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded, color: Color(0xFF2563EB)),
              title: Text("Upload Own Photo", style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
              onTap: () {
                Navigator.pop(context);
                _uploadCustomPhoto();
              },
            ),
            ListTile(
              leading: const Icon(Icons.face_rounded, color: Color(0xFF10B981)),
              title: Text("Choose Pre-built Avatar", style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
              onTap: () {
                Navigator.pop(context);
                _showAvatarPicker();
              },
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  void _showAvatarPicker() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Text("Select Avatar", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
        content: SizedBox(
          width: double.maxFinite,
          child: GridView.builder(
            shrinkWrap: true,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
            ),
            itemCount: _prebuiltAvatars.length,
            itemBuilder: (context, index) {
              final avatarUrl = _prebuiltAvatars[index];
              return GestureDetector(
                onTap: () {
                  Navigator.pop(context);
                  setState(() => _isLoading = true);
                  _updateProfilePhoto(avatarUrl);
                },
                child: Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
                  ),
                  child: ClipOval(
                    child: Image.network(avatarUrl, fit: BoxFit.cover),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    if (mounted) {
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (context) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: Color(0xFF2563EB))),
      );
    }

    if (_worker == null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline_rounded, size: 48, color: Colors.redAccent),
              const SizedBox(height: 12),
              Text("Failed to load profile", style: GoogleFonts.outfit(fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              TextButton(onPressed: _fetchProfile, child: const Text("Retry")),
            ],
          ),
        ),
      );
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final photoUrl = _worker['photoUrl'];
    final name = _worker['name'] ?? "Handyman Partner";
    final profession = _worker['skills'] != null && (_worker['skills'] as List).isNotEmpty
        ? (_worker['skills'] as List)[0].toString()
        : "Nexo Partner";

    final jobsCompleted = _worker['performance']?['totalJobs'] ?? 0;
    final completionRate = _worker['performance']?['completionRate'] ?? "100%";
    final rating = _worker['performance']?['rating'] ?? 4.8;
    final isVerified = _worker['verificationStatus'] == 'VERIFIED';

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: widget.isTab
            ? null
            : IconButton(
                icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF0F172A)),
                onPressed: () => Navigator.pop(context),
              ),
        title: Text(
          "Worker Profile",
          style: GoogleFonts.outfit(
            color: const Color(0xFF0F172A),
            fontWeight: FontWeight.w900,
            fontSize: 20,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: Color(0xFF0F172A)),
            onPressed: () {
              Navigator.push(context, MaterialPageRoute(builder: (context) => SettingsScreen(worker: _worker)));
            },
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
        child: Column(
          children: [
            // Top Section (Profile Details Card)
            Row(
              children: [
                GestureDetector(
                  onTap: _showChangePhotoOptions,
                  child: Stack(
                    children: [
                      Container(
                        width: 76,
                        height: 76,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFFE2E8F0), width: 2),
                        ),
                        child: ClipOval(
                          child: photoUrl != null
                              ? Image.network(
                                  photoUrl.startsWith('http') ? photoUrl : '${NetworkHelper.baseUrl}$photoUrl',
                                  fit: BoxFit.cover,
                                  errorBuilder: (c, e, s) => Image.network("https://api.dicebear.com/7.x/adventurer/png?seed=$name"),
                                )
                              : Image.network("https://api.dicebear.com/7.x/adventurer/png?seed=$name"),
                        ),
                      ),
                      Positioned(
                        bottom: 0,
                        right: 0,
                        child: Container(
                          width: 18,
                          height: 18,
                          decoration: BoxDecoration(
                            color: const Color(0xFF10B981),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 20, color: const Color(0xFF0F172A)),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        profession,
                        style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF64748B), fontWeight: FontWeight.w500),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 16),
                          const SizedBox(width: 4),
                          Text(
                            "$rating",
                            style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF0F172A)),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            "(128 Reviews)",
                            style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF94A3B8)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Mini stats row
            Container(
              padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _buildStatCol("$jobsCompleted", "Jobs Complete"),
                  Container(width: 1, height: 28, color: const Color(0xFFE2E8F0)),
                  _buildStatCol(completionRate, "Completion"),
                  Container(width: 1, height: 28, color: const Color(0xFFE2E8F0)),
                  _buildStatCol("$rating", "Rating"),
                  Container(width: 1, height: 28, color: const Color(0xFFE2E8F0)),
                  _buildStatCol("1h 25m", "Response"),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Verified Partner Banner
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFDBEAFE)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.verified_user_rounded, color: Color(0xFF2563EB), size: 24),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isVerified ? "Profile is Verified" : "Verification Pending",
                          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFF1E3A8A), fontSize: 14),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          isVerified 
                              ? "You are a verified Nexo partner." 
                              : "Submit your KYC details to verify.",
                          style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF1E3A8A).withOpacity(0.7)),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded, color: Color(0xFF2563EB), size: 20),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Section Account
            _buildSectionHeader("Account"),
            const SizedBox(height: 8),
            _buildListItem("Personal Information", Icons.person_outline_rounded),
            _buildListItem("Bank & Payout Details", Icons.account_balance_outlined),
            _buildListItem("Documents", Icons.description_outlined),
            _buildListItem("Verification", Icons.verified_user_outlined),
            _buildListItem("Change Password", Icons.lock_outline_rounded),
            const SizedBox(height: 20),

            // Section Preferences
            _buildSectionHeader("Preferences"),
            const SizedBox(height: 8),
            _buildListItem("Notification Settings", Icons.notifications_none_rounded),
            _buildListItem("Work Preferences", Icons.work_outline_rounded),
            _buildListItem("Language", Icons.language_rounded, trailing: "English"),
            const SizedBox(height: 20),

            // Section Performance
            _buildSectionHeader("Performance"),
            const SizedBox(height: 8),
            _buildListItem("Acceptance Rate", Icons.check_circle_outline_rounded, trailing: "98%"),
            _buildListItem("On-time Rate", Icons.access_time_rounded, trailing: "100%"),
            _buildListItem("Cancellation Rate", Icons.cancel_outlined, trailing: "0%"),
            _buildListItem("Response Time", Icons.hourglass_empty_rounded, trailing: "1h 25m"),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFECFDF5),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFA7F3D0)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.emoji_events_rounded, color: Color(0xFF059669), size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      "Great Job! You are among the top 10% of workers",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 11, color: const Color(0xFF065F46)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Section Achievements
            _buildSectionHeader("Achievements"),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildBadgeItem("Top Performer", Icons.workspace_premium_rounded, const Color(0xFFF59E0B)),
                _buildBadgeItem("100+ Gigs", Icons.done_all_rounded, const Color(0xFF10B981)),
                _buildBadgeItem("5 Star Rated", Icons.stars_rounded, const Color(0xFF3B82F6)),
                _buildBadgeItem("Quick Responder", Icons.bolt_rounded, const Color(0xFF8B5CF6)),
              ],
            ),
            const SizedBox(height: 28),

            // Section Help & Support
            _buildSectionHeader("Help & Support"),
            const SizedBox(height: 8),
            _buildListItem("Help Center", Icons.help_outline_rounded),
            _buildListItem("Contact Support", Icons.chat_bubble_outline_rounded),
            _buildListItem("Report an Issue", Icons.report_problem_outlined),
            _buildListItem("Safety Center", Icons.security_rounded),
            const SizedBox(height: 24),

            // Logout row
            GestureDetector(
              onTap: _logout,
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFFEE2E2)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.logout_rounded, color: Color(0xFFEF4444), size: 20),
                    const SizedBox(width: 8),
                    Text(
                      "Logout",
                      style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFFEF4444)),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              "App Version 2.1.0",
              style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF94A3B8)),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildStatCol(String val, String label) {
    return Column(
      children: [
        Text(
          val,
          style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF0F172A)),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: GoogleFonts.inter(fontSize: 10, color: const Color(0xFF64748B)),
        ),
      ],
    );
  }

  Widget _buildSectionHeader(String title) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Text(
        title,
        style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 15, color: const Color(0xFF64748B)),
      ),
    );
  }

  Widget _buildListItem(String title, IconData icon, {String? trailing}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFF1F5F9)),
      ),
      child: ListTile(
        leading: Icon(icon, color: const Color(0xFF475569), size: 20),
        title: Text(
          title,
          style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 13, color: const Color(0xFF0F172A)),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (trailing != null) ...[
              Text(
                trailing,
                style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFF64748B)),
              ),
              const SizedBox(width: 4),
            ],
            const Icon(Icons.chevron_right_rounded, color: Color(0xFF94A3B8), size: 18),
          ],
        ),
      ),
    );
  }

  Widget _buildBadgeItem(String title, IconData icon, Color color) {
    return SizedBox(
      width: 75,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: color.withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(height: 6),
          Text(
            title,
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: const Color(0xFF475569)),
          ),
        ],
      ),
    );
  }
}
