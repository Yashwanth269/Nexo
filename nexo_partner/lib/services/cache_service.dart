import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CacheService {
  static SharedPreferences? _prefs;

  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    debugPrint("⚡ [CACHE_SERVICE] SharedPreferences initialized.");
  }

  static Future<SharedPreferences> _getPrefs() async {
    if (_prefs != null) return _prefs!;
    _prefs = await SharedPreferences.getInstance();
    return _prefs!;
  }

  // Set local JSON list
  static Future<bool> setJsonList(String key, List<dynamic> data) async {
    try {
      final prefs = await _getPrefs();
      final String jsonStr = json.encode(data);
      return await prefs.setString(key, jsonStr);
    } catch (e) {
      debugPrint("❌ [CACHE_WRITE_ERROR] Key: $key, Error: $e");
      return false;
    }
  }

  // Get local JSON list
  static Future<List<dynamic>?> getJsonList(String key) async {
    try {
      final prefs = await _getPrefs();
      final String? jsonStr = prefs.getString(key);
      if (jsonStr != null) {
        debugPrint("⚡ [CACHE_HIT] Key: $key");
        return json.decode(jsonStr) as List<dynamic>;
      }
      debugPrint("🔍 [CACHE_MISS] Key: $key");
      return null;
    } catch (e) {
      debugPrint("❌ [CACHE_READ_ERROR] Key: $key, Error: $e");
      return null;
    }
  }

  // Set local JSON map
  static Future<bool> setJsonMap(String key, Map<String, dynamic> data) async {
    try {
      final prefs = await _getPrefs();
      final String jsonStr = json.encode(data);
      return await prefs.setString(key, jsonStr);
    } catch (e) {
      debugPrint("❌ [CACHE_WRITE_ERROR] Key: $key, Error: $e");
      return false;
    }
  }

  // Get local JSON map
  static Future<Map<String, dynamic>?> getJsonMap(String key) async {
    try {
      final prefs = await _getPrefs();
      final String? jsonStr = prefs.getString(key);
      if (jsonStr != null) {
        debugPrint("⚡ [CACHE_HIT] Key: $key");
        return json.decode(jsonStr) as Map<String, dynamic>;
      }
      debugPrint("🔍 [CACHE_MISS] Key: $key");
      return null;
    } catch (e) {
      debugPrint("❌ [CACHE_READ_ERROR] Key: $key, Error: $e");
      return null;
    }
  }
}
