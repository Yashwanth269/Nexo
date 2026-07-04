import 'dart:async';
import 'dart:convert';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import '../utils/network_helper.dart';

class BackgroundTracker {
  static Future<void> initializeService() async {
    final service = FlutterBackgroundService();

    // Configure Notifications for Foreground Service
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      'gigworker_tracking_channel',
      'Live Tracking Service',
      description: 'Used for keeping your location updated during active jobs',
      importance: Importance.high,
    );

    final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
        FlutterLocalNotificationsPlugin();

    await flutterLocalNotificationsPlugin
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: onStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: 'gigworker_tracking_channel',
        initialNotificationTitle: 'GigWorker Active',
        initialNotificationContent: 'Connecting to routing engine...',
        foregroundServiceNotificationId: 888,
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: onStart,
        onBackground: onIosBackground,
      ),
    );
  }

  static Future<void> startTracking(String jobId) async {
    final service = FlutterBackgroundService();
    final isRunning = await service.isRunning();
    if (!isRunning) {
      await service.startService();
    }
    // Pass the job id to the service
    service.invoke("setJobId", {"jobId": jobId});
  }

  static Future<void> stopTracking() async {
    final service = FlutterBackgroundService();
    service.invoke("stopService");
  }
}

@pragma('vm:entry-point')
Future<bool> onIosBackground(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  return true;
}

@pragma('vm:entry-point')
void onStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  
  if (service is AndroidServiceInstance) {
    service.on('setAsForeground').listen((event) {
      service.setAsForegroundService();
    });
    service.on('setAsBackground').listen((event) {
      service.setAsBackgroundService();
    });
  }

  service.on('stopService').listen((event) {
    service.stopSelf();
  });

  String? currentJobId;
  service.on('setJobId').listen((event) {
    if (event != null && event['jobId'] != null) {
      currentJobId = event['jobId'].toString();
    }
  });

  // Track location changes
  final LocationSettings locationSettings = LocationSettings(
    accuracy: LocationAccuracy.high,
    distanceFilter: 10,
  );

  StreamSubscription<Position>? positionStream;

  positionStream = Geolocator.getPositionStream(locationSettings: locationSettings).listen(
    (Position position) async {
      if (currentJobId == null) return;
      
      if (service is AndroidServiceInstance) {
        service.setForegroundNotificationInfo(
          title: "On The Way",
          content: "Location updating... (${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)})",
        );
      }
      
      // Sync with backend via HTTP (since sockets might drop in pure background execution)
      try {
        final prefs = await SharedPreferences.getInstance();
        final token = prefs.getString('workerToken');
        
        await http.post(
          Uri.parse('${NetworkHelper.baseUrl}/api/jobs/location/sync'),
          headers: {
            'Content-Type': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
          body: jsonEncode({
            'jobId': currentJobId, 
            'lat': position.latitude, 
            'lng': position.longitude
          }),
        );
      } catch (e) {
        debugPrint("Background Sync Failed: $e");
      }
    }
  );

  service.on('stopService').listen((event) {
    positionStream?.cancel();
    service.stopSelf();
  });
}
