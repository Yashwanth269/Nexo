import 'dart:async';
import 'dart:convert';
import 'dart:math' show min;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/screens/chat_detail_screen.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/utils/image_utils.dart';

class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key});

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  final Color primaryColor = const Color(0xFFFF6A00);
  List<Map<String, dynamic>> _chats = [];
  bool _isLoading = true;
  String? _phone;
  String? _userPhoto;
  String _sortBy = "Newest";
  int _selectedTab = 0; // 0 = All Chats, 1 = Active Jobs, 2 = Support
  String _searchQuery = "";
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _initData();
  }

  Future<void> _initData() async {
    _phone = await SharedPrefsHelper.getPhone();
    _userPhoto = await SharedPrefsHelper.getPhotoUrl();
    if (mounted) setState(() {});
    await _loadProfile();
    await _loadChats();
  }

  Future<void> _loadProfile() async {
    if (_phone == null) return;
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/user/profile/$_phone'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          setState(() {
            _userPhoto = data['user']['photoUrl'];
          });
          if (_userPhoto != null) {
            await SharedPrefsHelper.setPhotoUrl(_userPhoto!);
          }
        }
      }
    } catch (e) {
      debugPrint("Error loading profile: $e");
    }
  }

  Future<void> _loadChats() async {
    if (_phone == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/chats/$_phone'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) {
          setState(() {
            _chats = List<Map<String, dynamic>>.from(data['chats'] ?? []);
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Map<String, dynamic> _getSupportChatItem() {
    return {
      'job_id': 'SUPPORT-001',
      'name': 'Nexo Support',
      'service': 'Support Team',
      'lastMsg': 'How can we help you today?',
      'time': '3 days ago',
      'image': 'https://api.dicebear.com/7.x/bottts/png?seed=NexoSupport',
      'unreadCount': 1,
    };
  }

  List<Map<String, dynamic>> _getFilteredChats() {
    List<Map<String, dynamic>> baseList = [];
    if (_selectedTab == 0) {
      baseList = [..._chats, _getSupportChatItem()];
    } else if (_selectedTab == 1) {
      baseList = _chats;
    } else if (_selectedTab == 2) {
      baseList = [_getSupportChatItem()];
    }

    // Sort
    if (_sortBy == "Oldest") {
      baseList.sort((a, b) => (a['time'] ?? '').compareTo(b['time'] ?? ''));
    }

    // Search filter
    if (_searchQuery.isEmpty) return baseList;
    final query = _searchQuery.toLowerCase();
    return baseList.where((chat) {
      final name = (chat['name'] ?? '').toLowerCase();
      final service = (chat['service'] ?? '').toLowerCase();
      final lastMsg = (chat['lastMsg'] ?? '').toLowerCase();
      return name.contains(query) || service.contains(query) || lastMsg.contains(query);
    }).toList();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _getFilteredChats();

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        toolbarHeight: 76,
        leading: Padding(
          padding: const EdgeInsets.only(left: 20),
          child: Center(
            child: Container(
              width: 44,
              height: 44,
              decoration: const BoxDecoration(
                color: Color(0xFFFFF0E8),
                shape: BoxShape.circle,
              ),
              child: _userPhoto != null && _userPhoto!.isNotEmpty
                  ? ClipOval(
                      child: Image.network(
                        '${NetworkHelper.baseUrl}$_userPhoto',
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const Center(
                          child: Icon(Icons.person, color: Color(0xFFFF6A00), size: 24),
                        ),
                      ),
                    )
                  : const Center(
                      child: Icon(Icons.person, color: Color(0xFFFF6A00), size: 24),
                    ),
            ),
          ),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              "Inbox",
              style: GoogleFonts.outfit(
                color: const Color(0xFF0F172A),
                fontWeight: FontWeight.w900,
                fontSize: 24,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              "All your conversations in one place",
              style: GoogleFonts.inter(
                color: const Color(0xFF64748B),
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 20),
            child: Center(
              child: Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
                ),
                child: IconButton(
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.tune_rounded, color: Color(0xFFFF6A00), size: 20),
                  onPressed: _showSortOptions,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Tabs Row
            _buildTabsRow(),

            // Scrollable Content
            Expanded(
              child: RefreshIndicator(
                onRefresh: _loadChats,
                color: primaryColor,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.only(bottom: 24),
                  children: [
                    // Banner
                    _buildBannerCard(),

                    // Search Bar
                    _buildSearchBar(),

                    // Recent Chats Header
                    _buildRecentChatsHeader(),

                    // Chat Items
                    if (_isLoading)
                      const Padding(
                        padding: EdgeInsets.only(top: 40),
                        child: Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00))),
                      )
                    else if (filtered.isEmpty)
                      _buildEmptyState()
                    else
                      ...filtered.map((chat) => _buildChatCard(chat)),

                    // Security Banner
                    const SizedBox(height: 12),
                    _buildSecureBanner(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTabsRow() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Row(
        children: [
          _buildTabButton(0, "All Chats", Icons.chat_bubble_rounded),
          const SizedBox(width: 10),
          _buildTabButton(1, "Active Jobs", Icons.work_rounded),
          const SizedBox(width: 10),
          _buildTabButton(2, "Support", Icons.headset_mic_rounded),
        ],
      ),
    );
  }

  Widget _buildTabButton(int index, String label, IconData icon) {
    final isSelected = _selectedTab == index;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedTab = index),
        child: Container(
          height: 46,
          decoration: BoxDecoration(
            color: isSelected ? primaryColor : Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: isSelected
                ? null
                : Border.all(color: const Color(0xFFE2E8F0), width: 1.2),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                color: isSelected ? Colors.white : const Color(0xFF64748B),
                size: 16,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: GoogleFonts.inter(
                  color: isSelected ? Colors.white : const Color(0xFF0F172A),
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBannerCard() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFF8F5), Color(0xFFFFF1EB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFFFECE5), width: 1),
      ),
      child: Row(
        children: [
          // Icon Box
          Container(
            width: 48,
            height: 48,
            decoration: const BoxDecoration(
              color: Color(0xFFFFECE0),
              shape: BoxShape.circle,
            ),
            child: const Center(
              child: Icon(Icons.notifications_active_rounded, color: Color(0xFFFF6A00), size: 24),
            ),
          ),
          const SizedBox(width: 14),
          // Content
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Get instant updates",
                  style: GoogleFonts.outfit(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF0F172A),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  "Stay updated with workers and your job conversations",
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    color: const Color(0xFF64748B),
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          // Button
          TextButton(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text("Notifications enabled!")),
              );
            },
            style: TextButton.styleFrom(
              backgroundColor: const Color(0xFFFFF0E8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            ),
            child: Text(
              "Turn on\nnotifications",
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                color: const Color(0xFFFF6A00),
                fontSize: 10,
                fontWeight: FontWeight.bold,
                height: 1.2,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.2),
      ),
      child: TextField(
        controller: _searchController,
        onChanged: (val) => setState(() => _searchQuery = val),
        style: GoogleFonts.inter(fontSize: 14, color: const Color(0xFF0F172A)),
        decoration: InputDecoration(
          prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFF94A3B8)),
          hintText: "Search chats, workers or jobs...",
          hintStyle: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 13.5),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 14),
        ),
      ),
    );
  }

  Widget _buildRecentChatsHeader() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            "Recent Chats",
            style: GoogleFonts.outfit(
              color: const Color(0xFF0F172A),
              fontWeight: FontWeight.bold,
              fontSize: 16,
            ),
          ),
          Text(
            "View all",
            style: GoogleFonts.inter(
              color: const Color(0xFFFF6A00),
              fontWeight: FontWeight.bold,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChatCard(Map<String, dynamic> chat) {
    final String jobId = chat['job_id']?.toString() ?? '';
    final String name = chat['name'] ?? 'Expert Worker';
    final String service = chat['service'] ?? chat['serviceType'] ?? 'Skilled Service';
    final String lastMsg = chat['lastMsg'] ?? chat['lastMessage'] ?? '';
    final String time = chat['time'] ?? '';
    final String image = chat['image'] ?? chat['userPhoto'] ?? '';
    final int unreadCount = chat['unreadCount'] ?? 0;
    final bool isSupport = jobId.startsWith('SUPPORT');

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.015),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1.2),
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => ChatDetailScreen(
                jobId: jobId,
                name: name,
                image: image,
                service: service,
              ),
            ),
          ).then((_) => _loadChats());
        },
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              // Avatar Stack
              Stack(
                children: [
                  if (isSupport)
                    Container(
                      width: 48,
                      height: 48,
                      decoration: const BoxDecoration(
                        color: Color(0xFFF5F3FF),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(Icons.headset_mic_rounded, color: Color(0xFF8B5CF6), size: 24),
                      ),
                    )
                  else
                    ClipOval(
                      child: ImageUtils.buildProfileImage(
                        image,
                        radius: 24,
                        name: name,
                      ),
                    ),
                  // Green online dot
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: const Color(0xFF22C55E),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 14),
              // Name + Info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: GoogleFonts.outfit(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      isSupport
                          ? "Support Team"
                          : "$service • Job #NEXO-${jobId.substring(0, min(4, jobId.length)).toUpperCase()}",
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        color: const Color(0xFF94A3B8),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      lastMsg,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        color: const Color(0xFF475569),
                        fontWeight: unreadCount > 0 ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              // Time + Badge
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    time,
                    style: GoogleFonts.inter(
                      fontSize: 10.5,
                      color: const Color(0xFF94A3B8),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (unreadCount > 0)
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: const BoxDecoration(
                        color: Color(0xFFFF6A00),
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        "$unreadCount",
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSecureBanner() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFDCFCE7), width: 1),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: const BoxDecoration(
              color: Color(0xFFDCFCE7),
              shape: BoxShape.circle,
            ),
            child: const Center(
              child: Icon(Icons.shield_rounded, color: Color(0xFF16A34A), size: 20),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Your conversations are secure",
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF16A34A),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  "We never share your personal chats",
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    color: const Color(0xFF15803D),
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded, color: Color(0xFF16A34A)),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.only(top: 48, bottom: 24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.chat_bubble_outline_rounded, size: 64, color: Colors.grey[200]),
            const SizedBox(height: 16),
            Text(
              "No active chats",
              style: GoogleFonts.outfit(fontSize: 18, color: Colors.grey[600], fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              "Start a conversation with a worker to see it here",
              style: GoogleFonts.inter(fontSize: 12, color: Colors.grey[400]),
            ),
          ],
        ),
      ),
    );
  }

  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (context) => Container(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text("Sort By", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 10),
            ListTile(
              leading: const Icon(Icons.access_time),
              title: const Text("Newest First"),
              onTap: () {
                setState(() => _sortBy = "Newest");
                Navigator.pop(context);
              },
              trailing: _sortBy == "Newest" ? Icon(Icons.check, color: primaryColor) : null,
            ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text("Oldest First"),
              onTap: () {
                setState(() => _sortBy = "Oldest");
                Navigator.pop(context);
              },
              trailing: _sortBy == "Oldest" ? Icon(Icons.check, color: primaryColor) : null,
            ),
          ],
        ),
      ),
    );
  }
}
