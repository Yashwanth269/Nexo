import 'package:shared_preferences/shared_preferences.dart';

class SharedPrefsHelper {
  static const String _isLoggedInKey = 'isLoggedIn';
  static const String _userNameKey = 'userName';
  static const String _photoUrlKey = 'photoUrl';
  static const String _userIdKey = 'userId';
  static const String _phoneKey = 'phone';
  static const String _tokenKey = 'token';
  static SharedPreferences? _prefs;

  static Future<SharedPreferences> get _preferences async {
    _prefs ??= await SharedPreferences.getInstance();
    return _prefs!;
  }

  static Future<bool> isLoggedIn() async {
    final prefs = await _preferences;
    return prefs.getBool(_isLoggedInKey) ?? false;
  }

  static Future<void> setLoggedIn(bool loggedIn) async {
    final prefs = await _preferences;
    await prefs.setBool(_isLoggedInKey, loggedIn);
  }

  static Future<String?> getUserName() async {
    final prefs = await _preferences;
    return prefs.getString(_userNameKey);
  }

  static Future<void> setUserName(String name) async {
    final prefs = await _preferences;
    await prefs.setString(_userNameKey, name);
  }

  static Future<String?> getPhotoUrl() async {
    final prefs = await _preferences;
    return prefs.getString(_photoUrlKey);
  }

  static Future<void> setPhotoUrl(String? url) async {
    final prefs = await _preferences;
    if (url != null) {
      await prefs.setString(_photoUrlKey, url);
    } else {
      await prefs.remove(_photoUrlKey);
    }
  }

  static Future<String?> getUserId() async {
    final prefs = await _preferences;
    return prefs.getString(_userIdKey);
  }

  static Future<void> setUserId(String userId) async {
    final prefs = await _preferences;
    await prefs.setString(_userIdKey, userId);
  }

  static Future<String?> getPhone() async {
    final prefs = await _preferences;
    return prefs.getString(_phoneKey);
  }

  static Future<void> setPhone(String phone) async {
    final prefs = await _preferences;
    await prefs.setString(_phoneKey, phone);
  }

  static Future<String?> getToken() async {
    final prefs = await _preferences;
    return prefs.getString(_tokenKey);
  }

  static Future<void> setToken(String token) async {
    final prefs = await _preferences;
    await prefs.setString(_tokenKey, token);
  }

  static Future<void> clearUserData() async {
    final prefs = await _preferences;
    await prefs.remove(_isLoggedInKey);
    await prefs.remove(_userNameKey);
    await prefs.remove(_photoUrlKey);
    await prefs.remove(_phoneKey);
    await prefs.remove(_userIdKey);
    await prefs.remove(_tokenKey);
  }

  static Future<bool?> getBool(String key) async {
    final prefs = await _preferences;
    return prefs.getBool(key);
  }

  static Future<void> setBool(String key, bool value) async {
    final prefs = await _preferences;
    await prefs.setBool(key, value);
  }
}
