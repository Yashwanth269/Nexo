import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'dart:async';

class NetworkHelper {
  static String get baseUrl {
    return 'http://18.60.211.0:5000';
  }

  // Robust Request Manager with Exponential Backoff
  static Future<http.Response> safeRequest(
    Future<http.Response> Function() requestFn, {
    int maxRetries = 3,
  }) async {
    int attempt = 0;
    while (attempt < maxRetries) {
      try {
        final response = await requestFn().timeout(const Duration(seconds: 30));
        if (response.statusCode >= 200 && response.statusCode < 300) {
          return response;
        }
        throw HttpException("Server returned ${response.statusCode}");
      } catch (e) {
        attempt++;
        if (attempt >= maxRetries) {
          _trackFailure(e.toString());
          rethrow;
        }
        debugPrint("⚠️ Network attempt $attempt failed: $e. Retrying in ${attempt * 2}s...");
        await Future.delayed(Duration(seconds: attempt * 2));
      }
    }
    throw const HttpException("Failed after retries");
  }

  // ML Signals: Track failure patterns
  static void _trackFailure(String error) {
    debugPrint("📊 [ML SIGNAL] System Reliability: Failure detected. Error: $error");
    // In production, send to /api/ml/events
  }
}
