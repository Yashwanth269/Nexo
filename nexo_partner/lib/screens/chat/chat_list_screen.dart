import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../../utils/network_helper.dart';
import 'chat_detail_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  bool _isLoading = true;
  List<dynamic> _chats = [];
  String _activeFilter = "All Chats";
  String _token = "";
  late IO.Socket _socket;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _socket.disconnect();
    _socket.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('worker_token') ?? '';
    await _fetchChats();
    _initSocket();
  }

  void _initSocket() {
    _socket = IO.io(NetworkHelper.baseUrl, IO.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'token': _token})
      .setQuery({'token': _token})
      .enableAutoConnect()
      .build());

    // Re-fetch chats list when any new message comes in (real-time updates)
    _socket.on('new_message', (_) => _fetchChats());
    _socket.on('new_price_offer', (_) => _fetchChats());
  }

  Future<void> _fetchChats() async {
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/chat/chats/worker'),
        headers: {
          'Authorization': 'Bearer $_token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) {
          setState(() {
            _chats = data['chats'] ?? [];
            _isLoading = false;
          });
        }
      } else {
        if (mounted) setState(() => _isLoading = false);
      }
    } catch (e) {
      debugPrint("Error fetching chats: $e");
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<dynamic> get _filteredChats {
    if (_activeFilter == "All Chats") return _chats;
    if (_activeFilter == "Unread") return _chats.where((c) => (c['unreadCount'] ?? 0) > 0).toList();
    if (_activeFilter == "Active Jobs") return _chats.where((c) => c['status'] == 'STARTED' || c['status'] == 'ACCEPTED').toList();
    if (_activeFilter == "Completed") return _chats.where((c) => c['status'] == 'COMPLETED').toList();
    return _chats;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: const Icon(Icons.menu, color: Color(0xFF1E3A8A)),
        title: Text("Messages", style: GoogleFonts.outfit(color: Colors.black, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(icon: const Icon(Icons.search, color: Colors.grey), onPressed: () {}),
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: CircleAvatar(radius: 18, backgroundImage: NetworkImage("https://i.pravatar.cc/150?u=worker")),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: const Color(0xFFFF6A00),
        onRefresh: _fetchChats,
        child: Column(
          children: [
            _buildFilters(),
            Expanded(
              child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
                : _filteredChats.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      padding: const EdgeInsets.all(20),
                      itemCount: _filteredChats.length + 1,
                      itemBuilder: (context, index) {
                        if (index == _filteredChats.length) return _buildArchiveFooter();
                        return _buildChatCard(_filteredChats[index]);
                      },
                    ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _fetchChats,
        backgroundColor: const Color(0xFFFF6A00),
        child: const Icon(Icons.refresh, color: Colors.white),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.chat_bubble_outline, size: 80, color: Colors.grey[300]),
          const SizedBox(height: 16),
          Text("No chats yet", style: GoogleFonts.outfit(fontSize: 18, color: Colors.grey[600], fontWeight: FontWeight.bold)),
          Text("Jobs assigned to you will appear here", style: GoogleFonts.inter(fontSize: 14, color: Colors.grey[400])),
        ],
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(vertical: 10),
      color: Colors.white,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: ["All Chats", "Unread", "Active Jobs", "Completed"].map((f) => Padding(
          padding: const EdgeInsets.only(right: 8),
          child: ChoiceChip(
            label: Text(f),
            selected: _activeFilter == f,
            onSelected: (val) => setState(() => _activeFilter = f),
            selectedColor: const Color(0xFFFF6A00),
            labelStyle: TextStyle(color: _activeFilter == f ? Colors.white : Colors.black54, fontWeight: FontWeight.bold),
            backgroundColor: const Color(0xFFF3F4F6),
            elevation: 0,
            pressElevation: 0,
          ),
        )).toList(),
      ),
    );
  }

  Widget _buildChatCard(dynamic chat) {
    final int unread = chat['unreadCount'] ?? 0;
    final String photo = chat['userPhoto'] ?? '';
    final String name = chat['userName'] ?? 'User';
    final String service = chat['serviceType'] ?? 'Service';
    final String lastMsg = chat['lastMessage'] ?? 'Tap to chat';
    final String time = chat['time'] ?? '';
    final String jobId = chat['job_id']?.toString() ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 10)],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: Stack(
          children: [
            CircleAvatar(
              radius: 28,
              backgroundImage: NetworkImage(photo.isNotEmpty ? photo : 'https://i.pravatar.cc/150?u=$name'),
              onBackgroundImageError: (e, s) {},
              child: photo.isEmpty ? Text(name.isNotEmpty ? name[0] : '?', style: const TextStyle(fontWeight: FontWeight.bold)) : null,
            ),
            if (unread > 0)
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(color: Color(0xFFFF6A00), shape: BoxShape.circle),
                  child: Text("$unread", style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                ),
              ),
          ],
        ),
        title: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(child: Text(name, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16), overflow: TextOverflow.ellipsis)),
            Text(time, style: GoogleFonts.inter(color: Colors.black38, fontSize: 12)),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(service, style: GoogleFonts.inter(color: const Color(0xFF3B82F6), fontSize: 12, fontWeight: FontWeight.w500)),
            const SizedBox(height: 4),
            Text(
              lastMsg,
              style: GoogleFonts.inter(
                color: unread > 0 ? Colors.black87 : Colors.black54,
                fontWeight: unread > 0 ? FontWeight.w600 : FontWeight.normal,
                fontSize: 13,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        onTap: () {
          if (jobId.isEmpty) return;
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => ChatScreen(
                jobId: jobId,
                userName: name,
                initialPrice: "500",
              ),
            ),
          ).then((_) => _fetchChats()); // Refresh unread counts after returning
        },
      ),
    );
  }

  Widget _buildArchiveFooter() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Colors.grey[200], borderRadius: BorderRadius.circular(12)),
            child: const Icon(Icons.archive_outlined, color: Colors.black45),
          ),
          const SizedBox(height: 12),
          Text("All archived chats", style: TextStyle(color: Colors.black26, fontSize: 13, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
