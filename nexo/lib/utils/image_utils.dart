import 'package:flutter/material.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/service_data.dart';

class ImageUtils {
  static const String placeholderUser = 'assets/images/placeholder_user.png';

  static IconData getCategoryIcon(String? category) {
    final cat = category?.trim().toLowerCase() ?? '';
    if (cat.contains('electric')) return Icons.electric_bolt_rounded;
    if (cat.contains('ac') || cat.contains('air condition') || cat.contains('appliance')) return Icons.ac_unit_rounded;
    if (cat.contains('plumb') || cat.contains('pipe') || cat.contains('tap') || cat.contains('leak')) return Icons.plumbing_rounded;
    if (cat.contains('clean') || cat.contains('house keep')) return Icons.cleaning_services_rounded;
    if (cat.contains('tractor') || cat.contains('plough') || cat.contains('agri') || cat.contains('farm')) return Icons.agriculture_rounded;
    if (cat.contains('mason') || cat.contains('brick') || cat.contains('construct')) return Icons.foundation_rounded;
    if (cat.contains('delivery') || cat.contains('parcel') || cat.contains('errand')) return Icons.local_shipping_rounded;
    if (cat.contains('mechanic') || cat.contains('bike') || cat.contains('car') || cat.contains('vehicle')) return Icons.two_wheeler_rounded;
    if (cat.contains('driver') || cat.contains('transport')) return Icons.directions_car_rounded;
    if (cat.contains('maid') || cat.contains('cook') || cat.contains('house')) return Icons.family_restroom_rounded;
    if (cat.contains('cctv') || cat.contains('camera') || cat.contains('solar') || cat.contains('tech')) return Icons.solar_power_rounded;
    if (cat.contains('event') || cat.contains('stage') || cat.contains('sound')) return Icons.festival_rounded;
    if (cat.contains('paint')) return Icons.format_paint_rounded;
    if (cat.contains('carpenter') || cat.contains('wood')) return Icons.handyman_rounded;
    return Icons.home_repair_service_rounded;
  }

  static String getCategoryAsset(String? category) {
    final cat = category?.trim().toLowerCase() ?? '';

    // 1. Dynamic exact task matching in ServiceData
    if (category != null && category.trim().isNotEmpty) {
      final nameLower = category.trim().toLowerCase();
      for (var c in ServiceData.categories) {
        if (c['name']?.toString().toLowerCase() == nameLower && c['image'] != null) {
          return c['image'].toString();
        }
        if (c['subcategories'] != null) {
          for (var sub in c['subcategories']) {
            if (sub['name']?.toString().toLowerCase() == nameLower && sub['image'] != null) {
              return sub['image'].toString();
            }
            if (sub['tasks'] != null) {
              for (var t in sub['tasks']) {
                if (t['name'] != null && t['name'].toString().trim().toLowerCase() == nameLower) {
                  final img = t['image'];
                  if (img != null && img.toString().isNotEmpty) {
                    return img.toString();
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. Precise keyword matching
    if (cat.contains('electric')) return 'assets/images/home services/electrical/wiring.webp';
    if (cat.contains('ac') || cat.contains('air condition') || cat.contains('appliance')) return 'assets/images/home services/appliance repair/ac repair.jpg';
    if (cat.contains('plumb') || cat.contains('pipe') || cat.contains('tap') || cat.contains('leak')) return 'assets/images/home services/plumbing/tap repair.jpg';
    if (cat.contains('clean') || cat.contains('house keep')) return 'assets/images/home services/cleaning/full house cleaner.jpeg';
    if (cat.contains('tractor') || cat.contains('plough') || cat.contains('agri') || cat.contains('farm')) return 'assets/images/Agriculture/Equipment Rental/tractor ploughing.jpg';
    if (cat.contains('mason') || cat.contains('brick') || cat.contains('construct')) return 'assets/images/construction/core work/mason brick work.webp';
    if (cat.contains('delivery') || cat.contains('parcel') || cat.contains('errand')) return 'assets/images/delivery/errands/parcel delivery.jpg';
    if (cat.contains('mechanic') || cat.contains('bike') || cat.contains('car') || cat.contains('vehicle')) return 'assets/images/mechanic/vehicle repair/bike repair.webp';
    if (cat.contains('driver') || cat.contains('transport')) return 'assets/images/transport/vehicles/pickup vehicle.webp';
    if (cat.contains('maid') || cat.contains('cook') || cat.contains('house')) return 'assets/images/household/care and help/maid.jpg';
    if (cat.contains('cctv') || cat.contains('camera') || cat.contains('solar') || cat.contains('tech')) return 'assets/images/smart tech/installation/solar panel installation.jpg';
    if (cat.contains('event') || cat.contains('stage') || cat.contains('sound')) return 'assets/images/events/event staff/sound or light setup.jpg';
    if (cat.contains('paint')) return 'assets/images/construction/finishing work/painter.jpg';
    if (cat.contains('carpenter') || cat.contains('wood')) return 'assets/images/skilled/trades/carpenter.webp';
    if (cat.contains('home repair') || cat.contains('repair')) return 'assets/images/home services/electrical/wiring.webp';

    switch (category?.trim()) {
      case 'Agriculture': return 'assets/images/Agriculture/Equipment Rental/tractor ploughing.jpg';
      case 'Construction': return 'assets/images/construction/core work/mason brick work.webp';
      case 'Home Services': return 'assets/images/home services/cleaning/full house cleaner.jpeg';
      case 'Transport': return 'assets/images/transport/vehicles/pickup vehicle.webp';
      case 'Mechanic': return 'assets/images/mechanic/vehicle repair/bike repair.webp';
      case 'Household': return 'assets/images/household/care and help/maid.jpg';
      case 'Shops': return 'assets/images/shops/business help/sales assistant.jpg';
      case 'Delivery': return 'assets/images/delivery/errands/parcel delivery.jpg';
      case 'Events': return 'assets/images/events/event staff/sound or light setup.jpg';
      case 'Skilled': return 'assets/images/skilled/trades/ac technician.jpg';
      case 'Smart Tech': return 'assets/images/smart tech/installation/solar panel installation.jpg';
      default: return 'assets/images/home services/electrical/wiring.webp';
    }
  }

  static Widget buildFallbackIcon(String? taskName, {double? width, double? height, Color? color}) {
    final iconData = getCategoryIcon(taskName);
    return Container(
      width: width,
      height: height,
      color: (color ?? const Color(0xFFFF6A00)).withValues(alpha: 0.1),
      alignment: Alignment.center,
      child: Icon(
        iconData,
        size: (width != null && height != null) ? (width < height ? width * 0.5 : height * 0.5) : 28,
        color: color ?? const Color(0xFFFF6A00),
      ),
    );
  }

  static Widget buildServiceImage(
    String? path, {
    String? taskName,
    double? width,
    double? height,
    BoxFit fit = BoxFit.cover,
    Widget? fallback,
  }) {
    String? resolvedPath = path;

    // Fallback to taskName mapping if path is missing or placeholder
    if ((resolvedPath == null || resolvedPath.isEmpty || resolvedPath == 'null') && taskName != null) {
      resolvedPath = getCategoryAsset(taskName);
    }

    final fallbackWidget = fallback ?? buildFallbackIcon(taskName, width: width, height: height);

    if (resolvedPath == null || resolvedPath.isEmpty || resolvedPath == 'null') {
      return fallbackWidget;
    }

    final safePath = resolvedPath;

    // If path starts with http/https, render network image directly
    if (safePath.startsWith('http')) {
      final finalUrl = Uri.encodeFull(safePath);
      return Image.network(
        finalUrl,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (context, error, stackTrace) => fallbackWidget,
      );
    }

    // If path is a local asset
    if (safePath.startsWith('assets/')) {
      if (safePath.contains('logo') || safePath.contains('refer_banner') || safePath.contains('worker_auth')) {
        return Image.asset(
          safePath,
          width: width,
          height: height,
          fit: fit,
          errorBuilder: (context, error, stackTrace) => fallbackWidget,
        );
      }
      // Non-existent category asset path - fallback cleanly to category icon
      return fallbackWidget;
    }

    // Fallback URL relative path
    final relativeUrl = Uri.encodeFull(
      safePath.startsWith('/')
          ? '${NetworkHelper.baseUrl}$safePath'
          : '${NetworkHelper.baseUrl}/$safePath',
    );

    return Image.network(
      relativeUrl,
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (context, error, stackTrace) => fallbackWidget,
    );
  }

  static Widget buildProfileImage(String? url, {double radius = 24, String? name}) {
    String? resolvedUrl = url;
    if (resolvedUrl != null && !resolvedUrl.startsWith('http') && resolvedUrl.isNotEmpty) {
      if (resolvedUrl.startsWith('/')) {
        resolvedUrl = '${NetworkHelper.baseUrl}$resolvedUrl';
      } else {
        resolvedUrl = '${NetworkHelper.baseUrl}/$resolvedUrl';
      }
    }

    if (resolvedUrl == null || resolvedUrl.isEmpty || resolvedUrl.contains('randomuser.me')) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: Colors.grey[200],
        child: name != null && name.isNotEmpty
            ? Text(
                name[0].toUpperCase(),
                style: TextStyle(
                  color: Colors.grey[700],
                  fontWeight: FontWeight.bold,
                  fontSize: radius * 0.8,
                ),
              )
            : Icon(Icons.person, size: radius, color: Colors.grey[400]),
      );
    }

    return CircleAvatar(
      radius: radius,
      backgroundImage: NetworkImage(resolvedUrl),
      backgroundColor: Colors.transparent,
      onBackgroundImageError: (e, s) {},
    );
  }
}
