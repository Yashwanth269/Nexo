import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/socket_service.dart';

class HomeServicesService {
  HomeServicesService._();
  static final HomeServicesService instance = HomeServicesService._();

  final StreamController<List<Map<String, dynamic>>> _servicesController =
      StreamController<List<Map<String, dynamic>>>.broadcast();

  Stream<List<Map<String, dynamic>>> get servicesStream => _servicesController.stream;

  List<Map<String, dynamic>> _lastResult = [];
  double? _lastLat;
  double? _lastLng;
  String? _lastUserId;
  bool _socketListenerAttached = false;
  Timer? _autoRefreshTimer;

  static const String _baseUrl = NetworkHelper.baseUrl;

  Future<void> init(double lat, double lng) async {
    _lastLat = lat;
    _lastLng = lng;
    _attachSocketListener();
    await fetch(lat, lng);
    _startAutoRefresh();
  }

  void _startAutoRefresh() {
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = Timer.periodic(const Duration(seconds: 45), (_) {
      if (_lastLat != null && _lastLng != null) {
        fetch(_lastLat!, _lastLng!);
      }
    });
  }

  Future<List<Map<String, dynamic>>> fetch(
    double lat,
    double lng, {
    String? userId,
  }) async {
    _lastLat = lat;
    _lastLng = lng;

    try {
      String url = '$_baseUrl/api/home/services?lat=$lat&lng=$lng';
      if (userId != null && userId.isNotEmpty) url += '&userId=$userId';

      debugPrint('[HOME_SERVICES] Fetching: $url');

      final response = await http
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['categories'] != null) {
          final categories = (data['categories'] as List)
              .cast<Map<String, dynamic>>();

          _lastResult = categories;
          if (!_servicesController.isClosed) {
            _servicesController.add(categories);
          }

          debugPrint(
            '[HOME_SERVICES] ${categories.length} categories loaded — '
            'segment=${data['meta']?['segment']} '
            'cached=${data['meta']?['cached']}',
          );
          return categories;
        }
      }
    } catch (e) {
      debugPrint('[HOME_SERVICES] Fetch error: $e');
    }

    return _lastResult;
  }

  void _attachSocketListener() {
    if (_socketListenerAttached) return;

    final socket = SocketService().socket;
    if (socket == null) return;

    _socketListenerAttached = true;
    debugPrint('[HOME_SERVICES] Socket listener attached for services_updated');

    socket.on('services_updated', (data) {
      debugPrint('[HOME_SERVICES] Live push: services_updated — ${data['trigger']}');
      if (_lastLat != null && _lastLng != null) {
        fetch(_lastLat!, _lastLng!);
      }
    });
  }

  Future<void> updateLocation(double lat, double lng) async {
    if (lat == _lastLat && lng == _lastLng) return;
    _lastLat = lat;
    _lastLng = lng;
    await fetch(lat, lng);
  }

  Map<String, dynamic>? getCategory(String name) {
    for (final cat in _lastResult) {
      if (cat['name'] == name) return cat;
    }
    return null;
  }

  List<Map<String, dynamic>> get lastResult => _lastResult;

  void dispose() {
    _autoRefreshTimer?.cancel();
    _servicesController.close();
    _socketListenerAttached = false;
  }
}
