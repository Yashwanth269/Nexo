import 'dart:async';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';

class NetworkHelper {
  static const String baseUrl = 'http://10.0.2.2:5000';
  static final Connectivity _connectivity = Connectivity();
  static final StreamController<bool> _connectionStreamController = StreamController<bool>.broadcast();
  static bool _isOffline = false;

  static Stream<bool> get onConnectionChanged => _connectionStreamController.stream;
  static bool get isOffline => _isOffline;

  static void init() async {
    // Initial check
    final results = await _connectivity.checkConnectivity();
    await _updateState(results);

    _connectivity.onConnectivityChanged.listen((List<ConnectivityResult> results) async {
      await _updateState(results);
    });
  }

  static Future<void> forceCheck() async {
    final results = await _connectivity.checkConnectivity();
    await _updateState(results);
  }

  static Future<void> _updateState(List<ConnectivityResult> results) async {
    ConnectivityResult result = results.isEmpty ? ConnectivityResult.none : results.first;
    
    bool hasConnectivity = result != ConnectivityResult.none;
    
    if (!hasConnectivity) {
      _isOffline = true;
    } else {
      // Deep check: Try to reach a reliable IP or the backend
      try {
        // Try looking up a known reliable IP (Google DNS) to avoid DNS issues
        final lookup = await InternetAddress.lookup('8.8.8.8').timeout(const Duration(seconds: 3));
        _isOffline = lookup.isEmpty || lookup[0].rawAddress.isEmpty;
      } catch (_) {
        // If lookup fails, we might still have local connectivity to our server
        // In local dev, sometimes DNS is the only thing broken
        _isOffline = false; // Fallback to trust connectivity result if deep check fails
      }
    }
    
    _connectionStreamController.add(!_isOffline);
  }

  /// Exponential Backoff Retry Utility
  static Future<T> retryWithBackoff<T>(Future<T> Function() action, {int maxRetries = 3}) async {
    int retries = 0;
    while (true) {
      try {
        return await action();
      } catch (e) {
        if (retries >= maxRetries) rethrow;
        retries++;
        int delay = 1000 * (1 << retries); // Exponential: 2s, 4s, 8s...
        await Future.delayed(Duration(milliseconds: delay));
      }
    }
  }
}
