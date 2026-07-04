import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:geolocator/geolocator.dart';
import '../utils/network_helper.dart';
import 'notification_service.dart';

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
      // Try last known position first (instant cache lookup)
      position = await Geolocator.getLastKnownPosition();
      
      // Fallback to low accuracy getCurrentPosition if no cached location is available
      position ??= await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.low,
        timeLimit: const Duration(seconds: 2),
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
      dynamic jobMap;
      if (data is List) {
        if (data.isEmpty) return;
        jobMap = data.first;
      } else {
        jobMap = data;
      }

      if (jobMap is Map && jobMap['offerId'] != null) {
        socket!.emit('new_job_request_ack', {'offerId': jobMap['offerId']});
      }
      
      // Trigger background / local notifications
      try {
        final title = (jobMap is Map) ? (jobMap['category'] ?? "New Job Request") : "New Job Request";
        final price = (jobMap is Map) ? (jobMap['price'] ?? jobMap['earnings'] ?? "0") : "0";
        final distance = (jobMap is Map) ? (jobMap['distance'] ?? "Nearby") : "Nearby";
        LocalNotificationService.showNewJobNotification(
          "New Gig Request: $title",
          "Earnings: ₹$price | Distance: $distance. Tap to open!",
        );
      } catch (e) {
        debugPrint("⚠️ [SOCKET] Failed to show local notification: $e");
      }

      onJobRequest(jobMap);
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
