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
  final Future<void> Function() onFix;

  EligibilityItem({
    required this.key,
    required this.title,
    required this.description,
    required this.icon,
    required this.isGranted,
    this.isMandatory = true,
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

    // 1. Location Permission (Foreground)
    final locStatus = await Permission.location.status;
    final isLocGranted = locStatus.isGranted;
    items.add(EligibilityItem(
      key: 'location',
      title: 'Location Access',
      description: 'Required to calculate customer distance & receive nearby jobs',
      icon: Icons.location_on_rounded,
      isGranted: isLocGranted,
      onFix: () async {
        await Permission.location.request();
      },
    ));

    // 2. Background Location
    final bgStatus = await Permission.locationAlways.status;
    final isBgGranted = bgStatus.isGranted;
    items.add(EligibilityItem(
      key: 'background_location',
      title: 'Background Location',
      description: 'Required to track route & dispatch offers while app is closed',
      icon: Icons.my_location_rounded,
      isGranted: isBgGranted,
      onFix: () async {
        await Permission.locationAlways.request();
      },
    ));

    // 3. GPS Hardware Service Enabled
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
      onFix: () async {
        try {
          await _platform.invokeMethod('openGpsSettings');
        } catch (_) {
          await Geolocator.openLocationSettings();
        }
      },
    ));

    // 4. Notification Permission
    final notifStatus = await Permission.notification.status;
    final isNotifGranted = notifStatus.isGranted;
    items.add(EligibilityItem(
      key: 'notification',
      title: 'Notifications',
      description: 'Required to sound loud ringers & popups for incoming orders',
      icon: Icons.notifications_active_rounded,
      isGranted: isNotifGranted,
      onFix: () async {
        await Permission.notification.request();
      },
    ));

    // 5. Display Over Other Apps (Overlay)
    bool isOverlayGranted = true;
    try {
      final res = await _platform.invokeMethod<bool>('checkOverlayPermission');
      isOverlayGranted = res ?? true;
    } catch (_) {}
    items.add(EligibilityItem(
      key: 'overlay',
      title: 'Display Over Apps',
      description: 'Mandatory to display incoming job popup when screen is locked',
      icon: Icons.layers_rounded,
      isGranted: isOverlayGranted,
      onFix: () async {
        try {
          await _platform.invokeMethod('requestOverlayPermission');
        } catch (_) {
          await openAppSettings();
        }
      },
    ));

    // 6. Socket Connection
    final isSocketConnected = SocketService().socket?.connected == true;
    items.add(EligibilityItem(
      key: 'socket',
      title: 'Live Server Connection',
      description: 'Must have active live network connection to backend dispatch',
      icon: Icons.wifi_tethering_rounded,
      isGranted: isSocketConnected,
      onFix: () async {
        SocketService().connect((_) {});
      },
    ));

    // 7. Battery Optimization (Recommended)
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

    // Background fixing: request missing permissions sequentially
    for (var item in report.missingMandatory) {
      await item.onFix();
      // Slight delay to allow system permission dialogs to resolve
      await Future.delayed(const Duration(milliseconds: 500));
    }

    // Re-check after attempting to fix
    report = await checkEligibility();
    if (!report.isFullyEligible) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("Please grant all required permissions to go online."),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
      return false;
    }
    return true;
  }
}

class _EligibilityModal extends StatefulWidget {
  final EligibilityReport initialReport;
  const _EligibilityModal({required this.initialReport});

  @override
  State<_EligibilityModal> createState() => _EligibilityModalState();
}

class _EligibilityModalState extends State<_EligibilityModal> {
  late EligibilityReport _report;
  bool _isChecking = false;

  @override
  void initState() {
    super.initState();
    _report = widget.initialReport;
  }

  Future<void> _refreshReport() async {
    setState(() => _isChecking = true);
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
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    Text(
                      "All permissions & services must be active",
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
                        : const Color(0xFF2D1515),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: item.isGranted
                          ? Colors.green.withOpacity(0.3)
                          : Colors.redAccent.withOpacity(0.4),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        item.icon,
                        color: item.isGranted ? Colors.greenAccent : Colors.redAccent,
                        size: 24,
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  item.title,
                                  style: GoogleFonts.outfit(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
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
                                color: Colors.white60,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      if (item.isGranted)
                        const Icon(Icons.check_circle, color: Colors.greenAccent, size: 22)
                      else
                        ElevatedButton(
                          onPressed: () async {
                            await item.onFix();
                            await _refreshReport();
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.redAccent,
                            foregroundColor: Colors.white,
                            padding:
                                const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                            elevation: 0,
                          ),
                          child: Text(
                            "FIX",
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
          const SizedBox(height: 20),
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
