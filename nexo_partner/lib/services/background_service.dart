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
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:flutter/services.dart';
import 'notification_service.dart';

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

  static Future<void> startOnlineService() async {
    final service = FlutterBackgroundService();
    final isRunning = await service.isRunning();
    if (!isRunning) {
      await service.startService();
    }
    service.invoke("setJobId", {"jobId": null});
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
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  await LocalNotificationService.initialize();
  
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
    if (event != null) {
      currentJobId = event['jobId']?.toString();
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
      final prefs = await SharedPreferences.getInstance();
      final isOnline = prefs.getBool('isOnline') ?? false;
      final workerPhone = prefs.getString('workerPhone') ?? prefs.getString('worker_phone');
      final token = prefs.getString('worker_token') ?? prefs.getString('workerToken');

      if (currentJobId != null) {
        if (service is AndroidServiceInstance) {
          service.setForegroundNotificationInfo(
            title: "On The Way",
            content: "Location tracking active. Syncing with customer...",
          );
        }
        
        // Sync with backend via HTTP (since sockets might drop in pure background execution)
        try {
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
      } else if (isOnline && workerPhone != null) {
        if (service is AndroidServiceInstance) {
          service.setForegroundNotificationInfo(
            title: "Available & Online",
            content: "Waiting for nearby jobs...",
          );
        }
        
        // Sync worker location
        try {
          await http.post(
            Uri.parse('${NetworkHelper.baseUrl}/api/workers/location'),
            headers: {
              'Content-Type': 'application/json',
              if (token != null) 'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'workerId': workerPhone, 
              'lat': position.latitude, 
              'lng': position.longitude
            }),
          );
        } catch (e) {
          debugPrint("Background Online Location Sync Failed: $e");
        }
      } else {
        // If not online and no job, we can stop the service to save battery
        service.stopSelf();
      }
    }
  );

  // Read preferences for background socket
  final prefs = await SharedPreferences.getInstance();
  final String workerPhone = prefs.getString('workerPhone') ?? prefs.getString('worker_phone') ?? "";
  final String token = prefs.getString('worker_token') ?? prefs.getString('workerToken') ?? "";
  
  if (workerPhone.isNotEmpty) {
    io.Socket socket = io.io(NetworkHelper.baseUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {'token': token}
    });

    socket.onConnect((_) async {
      Position? position;
      try {
        position = await Geolocator.getLastKnownPosition();
        position ??= await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.low,
            timeLimit: Duration(seconds: 3),
          ),
        );
      } catch (e) {
        debugPrint("Background socket startup location fetch failed: $e");
      }

      socket.emit('worker_online', {
        'phoneNumber': workerPhone,
        if (position != null) 'location': {
          'lat': position.latitude,
          'lng': position.longitude,
        }
      });
    });

    socket.on('new_job_request', (data) async {
      dynamic jobMap;
      if (data is List) {
        if (data.isEmpty) return;
        jobMap = data.first;
      } else {
        jobMap = data;
      }

      if (jobMap != null) {
        try {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('pending_incoming_job', jsonEncode(jobMap));
        } catch (e) {
          debugPrint("Failed to persist background incoming job: $e");
        }
      }

      // 1. Trigger FullScreenIntent local notification to wake device!
      try {
        final title = (jobMap is Map) ? (jobMap['category'] ?? "New Job Request") : "New Job Request";
        final price = (jobMap is Map) ? (jobMap['price'] ?? jobMap['earnings'] ?? "0") : "0";
        final distance = (jobMap is Map) ? (jobMap['distance'] ?? "Nearby") : "Nearby";
        
        await LocalNotificationService.showNewJobNotification(
          "New Gig Request: $title",
          "Earnings: ₹$price | Distance: $distance",
        );
      } catch (e) {
        debugPrint("Background notification failed: $e");
      }
      
      // 2. Also try native MethodChannel (fallback)
      const platform = MethodChannel('com.nexo.partner/foreground');
      try {
        await platform.invokeMethod('bringToForeground');
      } catch (e) {
        debugPrint("Background wake failed: $e");
      }
      
      // 3. Send the job data to the main isolate to display the UI
      service.invoke('incoming_job', {'job': jobMap});
    });

    socket.connect();
    
    service.on('stopService').listen((event) {
      socket.disconnect();
      positionStream?.cancel();
      service.stopSelf();
    });
  } else {
    service.on('stopService').listen((event) {
      positionStream?.cancel();
      service.stopSelf();
    });
  }
}
