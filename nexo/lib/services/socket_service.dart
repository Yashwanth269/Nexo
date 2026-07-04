import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:nexo/utils/network_helper.dart';
import 'package:flutter/foundation.dart';
import 'package:nexo/services/shared_prefs_helper.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  IO.Socket? socket;
  Function(Map<String, dynamic>)? onJobAccepted;
  Function(Map<String, dynamic>)? onWorkerCancelled;

  void connect(String userId) async {
    if (socket != null && socket!.connected) return;

    debugPrint("🔌 [SOCKET] Connecting for User: $userId");
    final token = await SharedPrefsHelper.getToken();
    debugPrint("🔑 [SOCKET] Handshake Token: $token");
    
    socket = IO.io(NetworkHelper.baseUrl, IO.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'token': token})
      .setQuery({'token': token}) // Safe query-param fallback for connection robustness
      .enableAutoConnect()
      .build());

    socket!.onConnect((_) {
      debugPrint("✅ [SOCKET] Connected");
      socket!.emit('join', 'user:$userId');
    });

    socket!.on('job_accepted', (data) {
      debugPrint("📥 [SOCKET] Event: job_accepted");
      if (onJobAccepted != null) onJobAccepted!(Map<String, dynamic>.from(data));
    });

    socket!.on('JOB_ACCEPTED', (data) {
      debugPrint("📥 [SOCKET] Event: JOB_ACCEPTED");
      if (onJobAccepted != null) onJobAccepted!(Map<String, dynamic>.from(data));
    });

    socket!.on('WORKER_CANCELLED_JOB', (data) {
      debugPrint("📥 [SOCKET] Event: WORKER_CANCELLED_JOB");
      if (onWorkerCancelled != null) onWorkerCancelled!(Map<String, dynamic>.from(data));
    });

    socket!.onDisconnect((_) => debugPrint("❌ [SOCKET] Disconnected"));
  }

  void disconnect() {
    socket?.disconnect();
    socket = null;
  }
}
