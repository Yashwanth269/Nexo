import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _isLoading = true;
  List<dynamic> _notifications = [];

  @override
  void initState() {
    super.initState();
    _fetchNotifications();
  }

  Future<void> _fetchNotifications() async {
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('worker_phone');
    if (phone == null) return;

    try {
      final response = await http.get(Uri.parse('${NetworkHelper.baseUrl}/api/chat/list/$phone'));
      if (response.statusCode == 200) {
        setState(() {
          _notifications = json.decode(response.body)['notifications'];
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint("Error fetching notifications: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFFF7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(icon: const Icon(Icons.arrow_back, color: Color(0xFFFF6A00)), onPressed: () => Navigator.pop(context)),
        title: Text("Notifications", style: GoogleFonts.outfit(color: Colors.black, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(icon: const Icon(Icons.account_circle_outlined, color: Colors.orange), onPressed: () {}),
        ],
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
        : Column(
            children: [
              _buildUnreadHeader(),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  itemCount: _notifications.length,
                  itemBuilder: (context, index) => _buildNotificationCard(_notifications[index]),
                ),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 20),
                child: Column(
                  children: [
                    Icon(Icons.history, color: Colors.black26, size: 40),
                    SizedBox(height: 8),
                    Text("Showing notifications from the last 24 hours", style: TextStyle(color: Colors.black26, fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
    );
  }

  Widget _buildUnreadHeader() {
    final unreadCount = _notifications.where((n) => n['isUnread']).length;
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10)],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("Unread Alerts", style: GoogleFonts.inter(color: Colors.black54)),
                Text("$unreadCount New", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: const Color(0xFF994B00))),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFFE4D1),
              foregroundColor: const Color(0xFFFF6A00),
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text("Mark all read", style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildNotificationCard(dynamic n) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border(left: BorderSide(color: n['isUnread'] ? const Color(0xFF994B00) : Colors.transparent, width: 4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: _getBgColor(n['type']), shape: BoxShape.circle),
            child: Icon(_getIcon(n['type']), color: _getIconColor(n['type']), size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(n['title'], style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16)),
                    Text(n['time'], style: GoogleFonts.inter(color: Colors.black26, fontSize: 11)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(n['description'], style: GoogleFonts.inter(color: Colors.black54, fontSize: 13, height: 1.4)),
              ],
            ),
          ),
          if (n['isUnread'])
            Container(
              margin: const EdgeInsets.only(left: 8, top: 20),
              width: 8,
              height: 8,
              decoration: const BoxDecoration(color: Color(0xFF994B00), shape: BoxShape.circle),
            ),
        ],
      ),
    );
  }

  IconData _getIcon(String type) {
    switch (type) {
      case "JOB_REQUEST": return Icons.business_center_outlined;
      case "JOB_ACCEPTED": return Icons.check_circle_outline;
      case "MESSAGE": return Icons.chat_bubble_outline;
      case "PAYMENT": return Icons.account_balance_wallet_outlined;
      default: return Icons.notifications_none;
    }
  }

  Color _getIconColor(String type) {
    switch (type) {
      case "JOB_REQUEST": return Colors.orange;
      case "JOB_ACCEPTED": return Colors.blue;
      case "MESSAGE": return Colors.brown;
      case "PAYMENT": return Colors.green;
      default: return Colors.grey;
    }
  }

  Color _getBgColor(String type) {
    return _getIconColor(type).withOpacity(0.1);
  }
}
