import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/screens/report_worker_screen.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:nexo/utils/network_helper.dart';

class ChatDetailScreen extends StatefulWidget {
  final String jobId;
  final String name;
  final String image;
  final String service;

  const ChatDetailScreen({
    super.key,
    required this.jobId,
    required this.name,
    required this.image,
    required this.service,
  });

  @override
  State<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends State<ChatDetailScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<dynamic> _messages = [];
  final ImagePicker _picker = ImagePicker();
  bool _isLoading = true;
  late IO.Socket _socket;
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
    _initChat();
  }

  @override
  void dispose() {
    _socket.disconnect();
    _socket.dispose();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _initChat() async {
    _token = await SharedPrefsHelper.getToken() ?? '';
    await _loadMessages();
    _initSocket();
  }

  void _initSocket() {
    _socket = IO.io(NetworkHelper.baseUrl, IO.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'token': _token})
      .setQuery({'token': _token})
      .enableAutoConnect()
      .build());

    _socket.onConnect((_) {
      debugPrint("✅ [SOCKET] Connected");
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
        _loadMessages();
      }
    });
  }

  Future<void> _loadMessages() async {
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
            _messages.addAll(List<dynamic>.from(data['history'] ?? []));
            _isLoading = false;
          });
          WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
        }
      }
    } catch (e) {
      debugPrint("Error loading messages: $e");
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _sendMessage({String? text, String? imageUrl, bool isLocalFile = false}) async {
    if (text == null && imageUrl == null && _messageController.text.trim().isEmpty) return;
    
    final content = text ?? _messageController.text;
    _messageController.clear();

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
      debugPrint("Error sending message: $e");
    }
  }

  Future<void> _acceptOffer(dynamic msg) async {
    int amount = 0;
    if (msg['metadata'] != null) {
      if (msg['metadata'] is Map) {
        amount = msg['metadata']['amount'] ?? 0;
      } else if (msg['metadata'] is String) {
        try {
          final meta = json.decode(msg['metadata']);
          amount = meta['amount'] ?? 0;
        } catch (_) {}
      }
    }
    if (amount == 0) {
      final regExp = RegExp(r'₹(\d+)');
      final match = regExp.firstMatch(msg['message'] ?? '');
      if (match != null) {
        amount = int.parse(match.group(1)!);
      }
    }
    
    if (amount == 0) return;

    try {
      final response = await http.post(
        Uri.parse('${NetworkHelper.baseUrl}/api/chat/offer/accept'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: json.encode({
          'jobId': widget.jobId,
          'amount': amount,
        }),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("Price offer of ₹$amount accepted successfully!")),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("Failed to accept offer: ${data['message']}")),
          );
        }
      }
    } catch (e) {
      debugPrint("Accept offer error: $e");
    }
  }

  void _pickImage(ImageSource source) async {
    try {
      final XFile? image = await _picker.pickImage(source: source);
      if (image != null) {
        _sendMessage(text: "Shared a photo", imageUrl: image.path, isLocalFile: true);
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Error picking image: $e")));
    }
    Navigator.pop(context);
  }

  void _makeCall() async {
    final Uri launchUri = Uri(scheme: 'tel', path: '9731016442');
    try {
      await launchUrl(launchUri, mode: LaunchMode.externalApplication);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Could not initiate call: $e")));
    }
  }

  void _showWorkerDetails() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(25))),
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 24),
            Row(
              children: [
                CircleAvatar(
                  radius: 35,
                  backgroundImage: AssetImage(widget.image),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.name, style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold)),
                      Text(widget.service, style: GoogleFonts.inter(color: Colors.grey[600])),
                      const Row(
                        children: [
                          Icon(Icons.star, color: Colors.orange, size: 16),
                          Text(" 4.9 (120 reviews)", style: TextStyle(fontSize: 12)),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton.icon(
                onPressed: () {
                  Navigator.pop(context);
                  _makeCall();
                },
                icon: const Icon(Icons.phone),
                label: const Text("Call Worker"),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF6A00), foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
              ),
            ),
          ],
        ),
      ),
    );
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
                _buildAttachmentOption(Icons.description, "Document", Colors.blue, () async {
                   Navigator.pop(context);
                   FilePickerResult? result = await FilePicker.platform.pickFiles();
                   if (result != null) {
                     _sendMessage(text: "Shared a document: ${result.files.first.name}");
                   }
                }),
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
        title: InkWell(
          onTap: _showWorkerDetails,
          child: Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundImage: AssetImage(widget.image),
                onBackgroundImageError: (e, s) => const Icon(Icons.person),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.name, style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black)),
                    Text(widget.service, style: GoogleFonts.inter(fontSize: 11, color: Colors.grey[600])),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          IconButton(icon: const Icon(Icons.phone_outlined, color: Color(0xFFFF6A00)), onPressed: _makeCall),
          IconButton(
            icon: const Icon(Icons.report_gmailerrorred_outlined, color: Colors.grey),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => ReportWorkerScreen(
                    worker: {
                      'name': widget.name,
                      'phoneNumber': widget.name.replaceAll(' ', '_'),
                      'photoUrl': widget.image,
                      'category': widget.service,
                    },
                    jobId: "CHAT_${widget.name.replaceAll(' ', '_')}",
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00)))
        : Column(
            children: [
              Expanded(
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(20),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    final msg = _messages[index];
                    return _buildMessageBubble(msg);
                  },
                ),
              ),
              _buildMessageInput(),
            ],
          ),
    );
  }

  Widget _buildMessageBubble(dynamic msg) {
    bool isMe = msg['sender_type'] == 'USER';
    bool isOffer = msg['type'] == 'offer';
    String text = msg['message'] ?? '';
    String time = '';
    if (msg['created_at'] != null) {
      try {
        final date = DateTime.parse(msg['created_at']).toLocal();
        time = "${date.hour % 12 == 0 ? 12 : date.hour % 12}:${date.minute.toString().padLeft(2, '0')} ${date.hour >= 12 ? 'PM' : 'AM'}";
      } catch (e) {
        time = msg['created_at'];
      }
    }
    String status = msg['status'] ?? 'read';
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
      child: Column(
        crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(bottom: 4, top: 12),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
            decoration: BoxDecoration(
              color: isOffer 
                ? const Color(0xFFEFF6FF) 
                : (isMe ? const Color(0xFFFF6A00) : Colors.white),
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(20),
                topRight: const Radius.circular(20),
                bottomLeft: Radius.circular(isMe ? 20 : 0),
                bottomRight: Radius.circular(isMe ? 0 : 20),
              ),
              boxShadow: [
                BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 10, offset: const Offset(0, 4)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (isOffer) Row(
                  children: [
                    const Icon(Icons.payments_outlined, size: 16, color: Color(0xFF3B82F6)),
                    const SizedBox(width: 8),
                    Text("Price Offer", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: const Color(0xFF3B82F6))),
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
                Text(
                  text,
                  style: GoogleFonts.inter(
                    color: isMe && !isOffer ? Colors.white : Colors.black87,
                    fontSize: 14,
                    fontWeight: isOffer ? FontWeight.bold : FontWeight.normal,
                    height: 1.4,
                  ),
                ),
                if (isOffer && !isMe) ...[
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () => _acceptOffer(msg),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF3B82F6),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        elevation: 0,
                      ),
                      child: Text("Accept Offer", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 13)),
                    ),
                  ),
                ],
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(time, style: GoogleFonts.inter(color: isMe && !isOffer ? Colors.white70 : Colors.grey[500], fontSize: 10)),
                    if (isMe) ...[
                      const SizedBox(width: 4),
                      _buildTicks(status),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTicks(String status) {
    if (status == 'sent') return const Icon(Icons.check, size: 14, color: Colors.white70);
    if (status == 'delivered') return const Icon(Icons.done_all, size: 14, color: Colors.white70);
    return const Icon(Icons.done_all, size: 14, color: Colors.blueAccent);
  }

  Widget _buildMessageInput() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 10, offset: const Offset(0, -4)),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFFDF7F5),
                borderRadius: BorderRadius.circular(25),
              ),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.attach_file, color: Colors.grey, size: 20),
                    onPressed: _showAttachmentMenu,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      decoration: InputDecoration(
                        hintText: "Type a message...",
                        hintStyle: GoogleFonts.inter(color: Colors.grey[400], fontSize: 14),
                        border: InputBorder.none,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 12),
          GestureDetector(
            onTap: () => _sendMessage(),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: const BoxDecoration(
                color: Color(0xFFFF6A00),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}
