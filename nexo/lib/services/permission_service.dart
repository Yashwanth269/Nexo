import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

class PermissionService {
  static const String _locationKey = 'location_permission_status';
  static const String _notificationKey = 'notification_permission_status';

  static Future<bool> hasLocationPermission() async {
    final status = await Permission.location.status;
    return status.isGranted;
  }

  static Future<bool> hasNotificationPermission() async {
    final status = await Permission.notification.status;
    return status.isGranted;
  }

  static Future<PermissionStatus> requestLocationPermission() async {
    final status = await Permission.location.request();
    await _saveStatus(_locationKey, status);
    return status;
  }

  static Future<PermissionStatus> requestNotificationPermission() async {
    final status = await Permission.notification.request();
    await _saveStatus(_notificationKey, status);
    return status;
  }

  static Future<void> _saveStatus(String key, PermissionStatus status) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, status.toString());
  }

  static Future<void> openSettings() async {
    await openAppSettings();
  }

  static Future<bool> isPermanentlyDenied(Permission permission) async {
    return await permission.isPermanentlyDenied;
  }
}
