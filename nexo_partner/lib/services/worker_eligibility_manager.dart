import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:geolocator/geolocator.dart';
import 'package:nexo_partner/services/socket_service.dart';

class EligibilityItem {
  final String key;
  final String title;
  final String description;
  final IconData icon;
  final bool isGranted;
  final bool isMandatory;
  /// Whether tapping FIX opens Android Settings (requires app resume to re-check)
  final bool requiresSettingsReturn;
  final Future<void> Function() onFix;

  EligibilityItem({
    required this.key,
    required this.title,
    required this.description,
    required this.icon,
    required this.isGranted,
    this.isMandatory = true,
    this.requiresSettingsReturn = false,
    required this.onFix,
  });
}

class EligibilityReport {
  final bool isFullyEligible;
  final List<EligibilityItem> items;

  EligibilityReport({required this.isFullyEligible, required this.items});

  List<EligibilityItem> get missingMandatory =>
      items.where((i) => !i.isGranted && i.isMandatory).toList();
}

class WorkerEligibilityManager {
  static const MethodChannel _platform = MethodChannel('com.nexo.partner/foreground');

  static Future<EligibilityReport> checkEligibility() async {
    final List<EligibilityItem> items = [];

    // 1. Location Permission (Foreground) - MANDATORY
    final locStatus = await Permission.location.status;
    final isLocGranted = locStatus.isGranted;
    items.add(EligibilityItem(
      key: 'location',
      title: 'Location Access',
      description: 'Required to calculate customer distance & receive nearby jobs',
      icon: Icons.location_on_rounded,
      isGranted: isLocGranted,
      isMandatory: true,
      requiresSettingsReturn: locStatus.isPermanentlyDenied,
      onFix: () async {
        if (locStatus.isPermanentlyDenied) {
          await openAppSettings();
        } else {
          await Permission.location.request();
        }
      },
    ));

    // 2. Background Location - OPTIONAL (Android 11+ requires manual grant in Settings)
    final bgStatus = await Permission.locationAlways.status;
    final isBgGranted = bgStatus.isGranted;
    items.add(EligibilityItem(
      key: 'background_location',
      title: 'Background Location',
      description: 'Recommended to dispatch offers while app is closed',
      icon: Icons.my_location_rounded,
      isGranted: isBgGranted,
      isMandatory: false,
      requiresSettingsReturn: true,
      onFix: () async {
        await openAppSettings();
      },
    ));

    // 3. GPS Hardware Service Enabled - MANDATORY
    bool isGpsOn = false;
    try {
      final res = await _platform.invokeMethod<bool>('isGpsEnabled');
      isGpsOn = res ?? false;
    } catch (_) {
      isGpsOn = await Geolocator.isLocationServiceEnabled();
    }
    items.add(EligibilityItem(
      key: 'gps',
      title: 'GPS Service ON',
      description: 'Device GPS must be enabled for real-time location tracking',
      icon: Icons.gps_fixed_rounded,
      isGranted: isGpsOn,
      isMandatory: true,
      requiresSettingsReturn: true,
      onFix: () async {
        try {
          await _platform.invokeMethod('openGpsSettings');
        } catch (_) {
          await Geolocator.openLocationSettings();
        }
      },
    ));

    // 4. Notification Permission - MANDATORY
    final notifStatus = await Permission.notification.status;
    final isNotifGranted = notifStatus.isGranted;
    items.add(EligibilityItem(
      key: 'notification',
      title: 'Notifications',
      description: 'Required to sound loud ringers & popups for incoming orders',
      icon: Icons.notifications_active_rounded,
      isGranted: isNotifGranted,
      isMandatory: true,
      requiresSettingsReturn: notifStatus.isPermanentlyDenied,
      onFix: () async {
        if (notifStatus.isPermanentlyDenied) {
          await openAppSettings();
        } else {
          await Permission.notification.request();
        }
      },
    ));

    // 5. Display Over Other Apps (Overlay) - MANDATORY, always requires Settings
    bool isOverlayGranted = true;
    try {
      final res = await _platform.invokeMethod<bool>('checkOverlayPermission');
      isOverlayGranted = res ?? true;
    } catch (_) {
      isOverlayGranted = true; // If channel fails, assume granted to avoid blocking
    }
    items.add(EligibilityItem(
      key: 'overlay',
      title: 'Display Over Apps',
      description: 'Mandatory to display incoming job popup when screen is locked',
      icon: Icons.layers_rounded,
      isGranted: isOverlayGranted,
      isMandatory: true,
      requiresSettingsReturn: true,
      onFix: () async {
        try {
          await _platform.invokeMethod('requestOverlayPermission');
        } catch (_) {
          await openAppSettings();
        }
      },
    ));

    // 6. Socket Connection - OPTIONAL
    final isSocketConnected = SocketService().socket?.connected == true;
    items.add(EligibilityItem(
      key: 'socket',
      title: 'Live Server Connection',
      description: 'Must have active live network connection to backend dispatch',
      icon: Icons.wifi_tethering_rounded,
      isGranted: isSocketConnected,
      isMandatory: false,
      requiresSettingsReturn: false,
      onFix: () async {
        SocketService().connect((_) {});
      },
    ));

    // 7. Battery Optimization - OPTIONAL
    bool isBatteryIgnored = true;
    try {
      final res = await _platform.invokeMethod<bool>('isBatteryOptimizationIgnored');
      isBatteryIgnored = res ?? true;
    } catch (_) {}
    items.add(EligibilityItem(
      key: 'battery',
      title: 'Unrestricted Battery',
      description: 'Recommended to prevent Android from killing app in background',
      icon: Icons.battery_charging_full_rounded,
      isGranted: isBatteryIgnored,
      isMandatory: false,
      requiresSettingsReturn: true,
      onFix: () async {
        try {
          await _platform.invokeMethod('requestIgnoreBatteryOptimization');
        } catch (_) {
          await openAppSettings();
        }
      },
    ));

    final isFullyEligible = items.every((i) => !i.isMandatory || i.isGranted);
    return EligibilityReport(isFullyEligible: isFullyEligible, items: items);
  }

  static Future<bool> showEligibilitySheet(BuildContext context) async {
    EligibilityReport report = await checkEligibility();
    if (report.isFullyEligible) return true;

    // For inline-grantable permissions (not permanently denied), request first
    for (final item in report.missingMandatory) {
      if (!item.requiresSettingsReturn) {
        await item.onFix();
        await Future.delayed(const Duration(milliseconds: 400));
      }
    }

    // Re-check after inline grants
    report = await checkEligibility();
    if (report.isFullyEligible) return true;

    // Still missing some - show bottom sheet for manual fixing
    if (context.mounted) {
      final result = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        isDismissible: false,
        enableDrag: false,
        builder: (context) => _EligibilityModal(initialReport: report),
      );
      return result ?? false;
    }
    return false;
  }
}

/// Uses WidgetsBindingObserver to auto-refresh when user returns from Settings
class _EligibilityModal extends StatefulWidget {
  final EligibilityReport initialReport;
  const _EligibilityModal({required this.initialReport});

  @override
  State<_EligibilityModal> createState() => _EligibilityModalState();
}

class _EligibilityModalState extends State<_EligibilityModal> with WidgetsBindingObserver {
  late EligibilityReport _report;
  bool _isChecking = false;
  bool _awaitingSettingsReturn = false;

  @override
  void initState() {
    super.initState();
    _report = widget.initialReport;
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Auto-called when the app comes back to foreground after visiting Settings
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _awaitingSettingsReturn) {
      _awaitingSettingsReturn = false;
      _refreshReport();
    }
  }

  Future<void> _refreshReport() async {
    if (_isChecking) return;
    setState(() => _isChecking = true);
    // Small delay to let Android settle permission state after returning from Settings
    await Future.delayed(const Duration(milliseconds: 600));
    final newReport = await WorkerEligibilityManager.checkEligibility();
    if (mounted) {
      setState(() {
        _report = newReport;
        _isChecking = false;
      });
      if (newReport.isFullyEligible) {
        Navigator.pop(context, true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        top: 24,
        left: 20,
        right: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFF151515),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        border: Border(top: BorderSide(color: Colors.white12)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.amber.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.shield_outlined, color: Colors.amber, size: 28),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Go Online Requirements",
                      style: GoogleFonts.outfit(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    Text(
                      "Grant the required permissions to go online",
                      style: GoogleFonts.inter(color: Colors.white54, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Flexible(
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: _report.items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final item = _report.items[index];
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: item.isGranted
                        ? const Color(0xFF1E293B).withOpacity(0.4)
                        : item.isMandatory
                            ? const Color(0xFF2D1515)
                            : const Color(0xFF1E1E2A),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: item.isGranted
                          ? Colors.green.withOpacity(0.3)
                          : item.isMandatory
                              ? Colors.redAccent.withOpacity(0.4)
                              : Colors.white12,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        item.icon,
                        color: item.isGranted
                            ? Colors.greenAccent
                            : item.isMandatory
                                ? Colors.redAccent
                                : Colors.white38,
                        size: 24,
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    item.title,
                                    style: GoogleFonts.outfit(
                                      fontSize: 15,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                                if (!item.isMandatory)
                                  Padding(
                                    padding: const EdgeInsets.only(left: 6),
                                    child: Text(
                                      "(Optional)",
                                      style: GoogleFonts.inter(
                                          fontSize: 11, color: Colors.white38),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              item.description,
                              style: GoogleFonts.inter(
                                fontSize: 12,
                                color: Colors.white54,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      if (item.isGranted)
                        const Icon(Icons.check_circle, color: Colors.greenAccent, size: 22)
                      else if (!item.isMandatory)
                        const SizedBox.shrink()
                      else
                        ElevatedButton(
                          onPressed: _isChecking
                              ? null
                              : () async {
                                  if (item.requiresSettingsReturn) {
                                    setState(() => _awaitingSettingsReturn = true);
                                  }
                                  await item.onFix();
                                  if (!item.requiresSettingsReturn) {
                                    await _refreshReport();
                                  }
                                },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFFF6A00),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                            elevation: 0,
                          ),
                          child: Text(
                            item.requiresSettingsReturn ? "OPEN" : "FIX",
                            style: GoogleFonts.outfit(
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          if (_awaitingSettingsReturn)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.amber),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    "Waiting for you to return from Settings...",
                    style: GoogleFonts.inter(fontSize: 12, color: Colors.amber),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context, false),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Colors.white24),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                  ),
                  child: Text(
                    "Cancel",
                    style: GoogleFonts.outfit(
                        color: Colors.white70, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: _isChecking
                      ? null
                      : () async {
                          await _refreshReport();
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _report.isFullyEligible
                        ? const Color(0xFF10B981)
                        : const Color(0xFF2563EB),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                  ),
                  child: _isChecking
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : Text(
                          _report.isFullyEligible ? "GO ONLINE" : "RE-CHECK",
                          style: GoogleFonts.outfit(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
