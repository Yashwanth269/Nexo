import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:io';
import 'package:image_picker/image_picker.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:shared_preferences/shared_preferences.dart';
import '../../utils/network_helper.dart';

class ChatScreen extends StatefulWidget {
  final String jobId;
  final String userName;
  final String initialPrice;

  const ChatScreen({
    super.key,
    required this.jobId,
    required this.userName,
    required this.initialPrice,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final ImagePicker _picker = ImagePicker();
  final List<dynamic> _messages = [];
  List<String> _quickReplies = [];
  late IO.Socket _socket;
  bool _isLoading = true;
  String _token = "";

  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  void initState() {
    super.initState();
    _initData();
  }

  @override
  void dispose() {
    _socket.disconnect();
    _socket.dispose();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _initData() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('worker_token') ?? '';
    await _fetchHistory();
    await _fetchQuickReplies();
    _initSocket();
  }

  Future<void> _fetchQuickReplies() async {
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/chat/replies/${widget.jobId}'),
        headers: {
          'Authorization': 'Bearer $_token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) setState(() => _quickReplies = List<String>.from(data['replies']));
      }
    } catch (e) {
      debugPrint("Quick replies error: $e");
    }
  }

  void _initSocket() {
    _socket = IO.io(NetworkHelper.baseUrl, IO.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'token': _token})
      .setQuery({'token': _token})
      .enableAutoConnect()
      .build());

    _socket.onConnect((_) {
      _socket.emit('join', 'job:${widget.jobId}');
    });

    _socket.on('new_message', (data) {
      if (data != null && mounted) {
        setState(() {
          bool exists = _messages.any((m) => m['id'] == data['id']);
          if (!exists) {
            _messages.add(data);
          }
        });
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
      }
    });

    _socket.on('new_price_offer', (data) {
      if (data != null && mounted) {
        setState(() {
          bool exists = _messages.any((m) => m['id'] == data['id']);
          if (!exists) {
            _messages.add(data);
          }
        });
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
      }
    });

    _socket.on('offer_accepted', (data) {
      if (data != null && mounted) {
        setState(() {
          _fetchHistory();
        });
      }
    });
  }

  Future<void> _fetchHistory() async {
    try {
      final response = await http.get(
        Uri.parse('${NetworkHelper.baseUrl}/api/chat/history/${widget.jobId}'),
        headers: {
          'Authorization': 'Bearer $_token',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (mounted) {
          setState(() {
            _messages.clear();
            _messages.addAll(data['history']);
            _isLoading = false;
          });
          WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
        }
      }
    } catch (e) {
      debugPrint("Chat history error: $e");
    }
  }

  void _sendMessage({String? text, String? imageUrl, bool isLocalFile = false}) async {
    if (text == null && imageUrl == null && _controller.text.isEmpty) return;
    final content = text ?? _controller.text;
    _controller.clear();

    try {
      String? remoteImageUrl;
      if (imageUrl != null && isLocalFile) {
        final request = http.MultipartRequest('POST', Uri.parse('${NetworkHelper.baseUrl}/api/user/upload-photo'));
        request.headers['Authorization'] = 'Bearer $_token';
        request.files.add(await http.MultipartFile.fromPath('photo', imageUrl));
        
        final streamedRes = await request.send();
        final res = await http.Response.fromStream(streamedRes);
        if (res.statusCode == 200) {
          final uploadData = jsonDecode(res.body);
          if (uploadData['success'] == true) {
            remoteImageUrl = uploadData['photoUrl'];
          }
        }
      }

      final body = {
        'jobId': widget.jobId,
        'message': content,
        'type': remoteImageUrl != null ? 'image' : 'text',
        'metadata': remoteImageUrl != null ? {'imageUrl': remoteImageUrl} : {},
      };

      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/chat/send'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: json.encode(body),
      );
    } catch (e) {
      debugPrint("Send error: $e");
    }
  }

  void _pickImage(ImageSource source) async {
    try {
      final XFile? image = await _picker.pickImage(source: source);
      if (image != null) {
        _sendMessage(text: "Shared a photo", imageUrl: image.path, isLocalFile: true);
      }
    } catch (e) {
      debugPrint("Error picking image: $e");
    }
    Navigator.pop(context);
  }

  void _showAttachmentMenu() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(30))),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildAttachmentOption(Icons.camera_alt, "Camera", Colors.pink, () => _pickImage(ImageSource.camera)),
                _buildAttachmentOption(Icons.photo, "Gallery", Colors.purple, () => _pickImage(ImageSource.gallery)),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildAttachmentOption(IconData icon, String label, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: color.withOpacity(0.1), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 28),
          ),
          const SizedBox(height: 8),
          Text(label, style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.grey[800])),
        ],
      ),
    );
  }

  void _showOfferModal() {
    final TextEditingController offerController = TextEditingController(text: widget.initialPrice);
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(32))),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(color: Color(0xFFFFF7ED), shape: BoxShape.circle),
                child: const Icon(Icons.payments_outlined, color: Color(0xFFFF6A00), size: 32),
              ),
              const SizedBox(height: 16),
              Text("Make an Offer", style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold)),
              Text("Negotiate a fair price for your service.", style: GoogleFonts.inter(color: Colors.black45)),
              const SizedBox(height: 24),
              TextField(
                controller: offerController,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                style: GoogleFonts.outfit(fontSize: 32, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00)),
                decoration: InputDecoration(
                  prefixText: "₹ ",
                  hintText: "Enter price",
                  filled: true,
                  fillColor: const Color(0xFFFFF7ED),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [400, 500, 600].map((val) => GestureDetector(
                  onTap: () => offerController.text = val.toString(),
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(color: const Color(0xFFEFF6FF), borderRadius: BorderRadius.circular(20)),
                    child: Text("₹$val", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF3B82F6))),
                  ),
                )).toList(),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  onPressed: () async {
                    Navigator.pop(context);
                    await _sendOffer(offerController.text);
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF6A00), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                  icon: const Icon(Icons.send, color: Colors.white),
                  label: Text("Send Offer", style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
                ),
              ),
              const SizedBox(height: 12),
              TextButton(onPressed: () => Navigator.pop(context), child: const Text("Cancel", style: TextStyle(color: Colors.grey))),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _sendQuickReply(String text) async {
    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/chat/send'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'jobId': widget.jobId,
          'message': text,
        }),
      );
    } catch (e) {
      debugPrint("Quick reply send error: $e");
    }
  }
  Future<void> _sendOffer(String amount) async {
    try {
      await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/chat/offer/send'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'jobId': widget.jobId,
          'amount': int.parse(amount),
        }),
      );
    } catch (e) {
      debugPrint("Offer error: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(icon: const Icon(Icons.arrow_back, color: Color(0xFFFF6A00)), onPressed: () => Navigator.pop(context)),
        title: Row(
          children: [
            CircleAvatar(radius: 18, backgroundImage: NetworkImage("https://i.pravatar.cc/150?u=${widget.userName}")),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.userName, style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black)),
                Text("Plumbing Job", style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFFB91C1C))),
              ],
            ),
          ],
        ),
        actions: [IconButton(icon: const Icon(Icons.phone_outlined, color: Colors.grey), onPressed: () {})],
      ),
      body: Column(
        children: [
          Expanded(
            child: _isLoading 
              ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(20),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) => _buildMessageBubble(_messages[index]),
                ),
          ),
          _buildQuickRepliesBar(),
          _buildInputSection(),
        ],
      ),
    );
  }

  Widget _buildQuickRepliesBar() {
    if (_quickReplies.isEmpty) return const SizedBox();
    return Container(
      height: 50,
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _quickReplies.length,
        itemBuilder: (context, index) => GestureDetector(
          onTap: () => _sendQuickReply(_quickReplies[index]),
          child: Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFFF6A00).withOpacity(0.2)),
              boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10)],
            ),
            child: Text(_quickReplies[index], style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600, color: const Color(0xFFFF6A00))),
          ),
        ),
      ),
    );
  }

  Widget _buildMessageBubble(dynamic msg) {
    bool isMe = msg['sender_type'] == 'WORKER';
    bool isOffer = msg['type'] == 'offer';

    String? imageUrl;
    if (msg['metadata'] != null) {
      if (msg['metadata'] is Map) {
        imageUrl = msg['metadata']['imageUrl'] ?? msg['metadata']['image'];
      } else if (msg['metadata'] is String) {
        try {
          final meta = json.decode(msg['metadata']);
          imageUrl = meta['imageUrl'] ?? meta['image'];
        } catch (_) {}
      }
    }

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isOffer ? const Color(0xFFEFF6FF) : (isMe ? const Color(0xFFFF6A00) : Colors.white),
          borderRadius: BorderRadius.circular(20).copyWith(
            bottomRight: isMe ? const Radius.circular(0) : const Radius.circular(20),
            bottomLeft: !isMe ? const Radius.circular(0) : const Radius.circular(20),
          ),
          boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10)],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isOffer) Row(
              children: [
                const Icon(Icons.payments_outlined, size: 16, color: Color(0xFF3B82F6)),
                const SizedBox(width: 8),
                Text("Price Negotiation", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF3B82F6))),
              ],
            ),
            if (isOffer) const SizedBox(height: 8),
            if (imageUrl != null && imageUrl.isNotEmpty) ...[
               ClipRRect(
                 borderRadius: BorderRadius.circular(12),
                 child: imageUrl.startsWith('/')
                   ? Image.network('${NetworkHelper.baseUrl}$imageUrl', fit: BoxFit.cover, errorBuilder: (c, e, s) => const Icon(Icons.broken_image))
                   : imageUrl.startsWith('http')
                       ? Image.network(imageUrl, fit: BoxFit.cover, errorBuilder: (c, e, s) => const Icon(Icons.broken_image))
                       : Image.file(File(imageUrl), fit: BoxFit.cover, errorBuilder: (c, e, s) => const Icon(Icons.broken_image)),
               ),
               const SizedBox(height: 8),
            ],
            Text(msg['message'], style: GoogleFonts.inter(color: isMe && !isOffer ? Colors.white : Colors.black87, fontWeight: isOffer ? FontWeight.bold : FontWeight.normal)),
          ],
        ),
      ),
    );
  }

  Widget _buildInputSection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      child: Column(
        children: [
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _showOfferModal,
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E3A8A), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), elevation: 0),
              icon: const Icon(Icons.label_outlined, color: Colors.white, size: 20),
              label: Text("Send Price Offer", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.white)),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              IconButton(icon: const Icon(Icons.add_circle_outline, color: Colors.grey), onPressed: _showAttachmentMenu),
              Expanded(
                child: TextField(
                  controller: _controller,
                  decoration: InputDecoration(
                    hintText: "Type message...",
                    filled: true,
                    fillColor: const Color(0xFFF3F4F6),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(30), borderSide: BorderSide.none),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              GestureDetector(
                onTap: _sendMessage,
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: const BoxDecoration(color: Color(0xFFFF6A00), shape: BoxShape.circle),
                  child: const Icon(Icons.send, color: Colors.white, size: 20),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
