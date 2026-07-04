import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:geolocator/geolocator.dart';
import '../utils/network_helper.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  io.Socket? socket;
  final String baseUrl = NetworkHelper.baseUrl;

  void connect(Function(dynamic) onJobRequest) async {
    if (socket?.connected == true) return;

    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('workerPhone');
    final token = prefs.getString('worker_token');

    // Retrieve current position with a timeout fallback
    Position? position;
    try {
      position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 3),
      );
    } catch (e) {
      debugPrint("⚠️ [SOCKET] Could not fetch startup position: $e");
    }

    socket = io.io(baseUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {
        'token': token
      }
    });

    socket!.onConnect((_) {
      debugPrint('🔌 [SOCKET] Connected to Backend');
      if (phone != null) {
        socket!.emit('worker_online', {
          'phoneNumber': phone,
          if (position != null) 'location': {
            'lat': position.latitude,
            'lng': position.longitude,
          }
        });
      }
    });

    socket!.on('new_job_request', (data) {
      debugPrint('🔔 [SOCKET] New Job Received: $data');
      if (data is Map && data['offerId'] != null) {
        socket!.emit('new_job_request_ack', {'offerId': data['offerId']});
      }
      onJobRequest(data);
    });

    socket!.on('job_taken', (data) {
      if (data != null) {
        debugPrint('🚫 [SOCKET] Job Taken: ${data['jobId']}');
      }
      // Broadcast globally or handle via callbacks
    });

    socket!.onDisconnect((_) => debugPrint('❌ [SOCKET] Disconnected'));

    socket!.connect();
  }

  void updateLocation(double lat, double lng) async {
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('workerPhone');
    
    if (socket?.connected == true && phone != null) {
      socket!.emit('update_location', {
        'phoneNumber': phone,
        'location': {'lat': lat, 'lng': lng}
      });
    }
  }

  void disconnect() {
    socket?.disconnect();
    socket = null;
  }
}
