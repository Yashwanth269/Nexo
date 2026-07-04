import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/job_details_screen.dart';

class NotificationScreen extends StatefulWidget {
  const NotificationScreen({super.key});

  @override
  State<NotificationScreen> createState() => _NotificationScreenState();
}

class _NotificationScreenState extends State<NotificationScreen> {
  List<dynamic> _notifications = [];
  bool _isLoading = true;
  String _activeFilter = "All";
  final String baseUrl = 'http://10.0.2.2:5000';

  @override
  void initState() {
    super.initState();
    _fetchNotifications();
  }

  Future<void> _fetchNotifications() async {
    final phone = await SharedPrefsHelper.getPhone();
    if (phone == null) return;
    try {
      final token = await SharedPrefsHelper.getToken();
      final response = await http.get(
        Uri.parse('$baseUrl/api/notifications/$phone'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted && data['success']) {
          setState(() {
            _notifications = data['notifications'] ?? [];
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      debugPrint("Error fetching notifications: $e");
    }
  }

  Future<void> _markAsRead(String id) async {
    final phone = await SharedPrefsHelper.getPhone();
    if (phone == null) return;
    try {
      final token = await SharedPrefsHelper.getToken();
      await http.post(
        Uri.parse('$baseUrl/api/notifications/read'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: json.encode({'phone': phone, 'notificationId': id}),
      );
      _fetchNotifications();
    } catch (e) {
      debugPrint("Error marking as read: $e");
    }
  }

  List<dynamic> get _filteredNotifications {
    if (_activeFilter == "All") return _notifications;
    if (_activeFilter == "Unread") return _notifications.where((n) => n['isRead'] == false).toList();
    return _notifications.where((n) => n['type'].toString().toUpperCase() == _activeFilter.toUpperCase()).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFDF7F5),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFFFF6A00)),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text("Notifications", style: GoogleFonts.outfit(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_vert, color: Colors.grey),
            onPressed: () {},
          ),
        ],
      ),
      body: Column(
        children: [
          _buildFilterTabs(),
          Expanded(
            child: _isLoading 
              ? const Center(child: CircularProgressIndicator())
              : _filteredNotifications.isEmpty
                ? _buildEmptyState()
                : _buildNotificationList(),
          ),
          _buildBonusBanner(),
        ],
      ),
    );
  }

  Widget _buildFilterTabs() {
    final filters = ["All", "Unread", "Payments", "Jobs"];
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(vertical: 12),
      color: Colors.white,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: filters.length,
        itemBuilder: (context, index) {
          final filter = filters[index];
          final isActive = _activeFilter == filter;
          return GestureDetector(
            onTap: () => setState(() => _activeFilter = filter),
            child: Container(
              margin: const EdgeInsets.only(right: 12),
              padding: const EdgeInsets.symmetric(horizontal: 24),
              decoration: BoxDecoration(
                color: isActive ? const Color(0xFFFF6A00) : const Color(0xFFEEEFFB).withOpacity(0.5),
                borderRadius: BorderRadius.circular(25),
              ),
              alignment: Alignment.center,
              child: Text(
                filter,
                style: GoogleFonts.inter(
                  color: isActive ? Colors.white : const Color(0xFF535DBC),
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildNotificationList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _filteredNotifications.length,
      itemBuilder: (context, index) {
        final notif = _filteredNotifications[index];
        return _buildNotificationCard(notif);
      },
    );
  }

  Widget _buildNotificationCard(Map<String, dynamic> notif) {
    final bool isRead = notif['isRead'] ?? false;
    final String type = notif['type'] ?? 'INFO';

    return GestureDetector(
      onTap: () {
        if (!isRead) _markAsRead(notif['id']);
        if (notif['metadata']?['jobId'] != null) {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (context) => JobDetailsScreen(jobId: notif['metadata']['jobId'])),
          );
        }
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10, offset: const Offset(0, 4))],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: IntrinsicHeight(
            child: Row(
              children: [
                if (!isRead) Container(width: 4, color: const Color(0xFFFF6A00)),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(color: const Color(0xFFF9FAFB), borderRadius: BorderRadius.circular(12)),
                          child: Icon(_getIconForType(type), color: const Color(0xFF535DBC), size: 20),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      notif['title'] ?? "New Update",
                                      style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF1F2937)),
                                    ),
                                  ),
                                  if (!isRead) Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFFFF6A00), shape: BoxShape.circle)),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                notif['message'] ?? "",
                                style: GoogleFonts.inter(fontSize: 14, color: const Color(0xFF6B7280), height: 1.4),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _getTimeAgo(notif['createdAt']),
                                style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF9CA3AF)),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBonusBanner() {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFFFF6A00), Color(0xFFD94E00)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Stack(
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(16)),
                child: const Icon(Icons.shield_outlined, color: Colors.white, size: 30),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("INSURANCE BONUS", style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 4),
                    Text("Complete 5 more jobs to unlock accident coverage.", style: GoogleFonts.inter(color: Colors.white.withOpacity(0.9), fontSize: 13)),
                  ],
                ),
              ),
            ],
          ),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), shape: BoxShape.circle),
              child: const Icon(Icons.done_all, color: Colors.white, size: 20),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.notifications_off_outlined, size: 80, color: Colors.grey[300]),
          const SizedBox(height: 16),
          Text("No notifications yet", style: GoogleFonts.outfit(fontSize: 18, color: Colors.grey[600])),
          Text("We'll alert you when something happens", style: GoogleFonts.inter(fontSize: 14, color: Colors.grey[400])),
        ],
      ),
    );
  }

  IconData _getIconForType(String type) {
    switch (type.toUpperCase()) {
      case 'JOBS': return Icons.work_outline;
      case 'PAYMENTS': return Icons.account_balance_wallet_outlined;
      case 'MESSAGES': return Icons.chat_bubble_outline;
      default: return Icons.info_outline;
    }
  }

  String _getTimeAgo(String? timestamp) {
    if (timestamp == null) return "";
    final date = DateTime.parse(timestamp);
    final diff = DateTime.now().difference(date);
    if (diff.inMinutes < 60) return "${diff.inMinutes} mins ago";
    if (diff.inHours < 24) return "${diff.inHours} hours ago";
    if (diff.inDays == 1) return "Yesterday";
    return DateFormat('MMM dd').format(date);
  }
}
