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

    // 2. Keyword-based fallback to S3 URLs
    if (cat.contains('electric')) return ServiceData.s3Url('Electrician', '1:1');
    if (cat.contains('ac') || cat.contains('air condition') || cat.contains('appliance')) return ServiceData.s3Url('AC Repair', '1:1');
    if (cat.contains('plumb') || cat.contains('pipe') || cat.contains('tap') || cat.contains('leak')) return ServiceData.s3Url('Plumber', '1:1');
    if (cat.contains('clean') || cat.contains('house keep')) return ServiceData.s3Url('House Cleaning', '1:1');
    if (cat.contains('tractor') || cat.contains('plough') || cat.contains('agri') || cat.contains('farm')) return ServiceData.s3Url('Tractor Work', '1:1');
    if (cat.contains('mason') || cat.contains('brick') || cat.contains('construct')) return ServiceData.s3Url('Construction Labour', '1:1');
    if (cat.contains('delivery') || cat.contains('parcel') || cat.contains('errand')) return ServiceData.s3Url('Parcel Delivery', '1:1');
    if (cat.contains('mechanic') || cat.contains('bike') || cat.contains('car') || cat.contains('vehicle')) return ServiceData.s3Url('Car Mechanic', '1:1');
    if (cat.contains('driver') || cat.contains('transport')) return ServiceData.s3Url('Personal Driver', '1:1');
    if (cat.contains('maid') || cat.contains('cook') || cat.contains('house')) return ServiceData.s3Url('Home Cook', '1:1');
    if (cat.contains('cctv') || cat.contains('camera') || cat.contains('solar') || cat.contains('tech')) return ServiceData.s3Url('CCTV Installation', '1:1');
    if (cat.contains('event') || cat.contains('stage') || cat.contains('sound')) return ServiceData.s3Url('Event Helpers', '1:1');
    if (cat.contains('paint')) return ServiceData.s3Url('House Painting', '1:1');
    if (cat.contains('carpenter') || cat.contains('wood')) return ServiceData.s3Url('Carpenter', '1:1');
    if (cat.contains('beauty') || cat.contains('salon') || cat.contains('barber')) return ServiceData.s3Url('Salon at Home', '1:1');
    if (cat.contains('pet') || cat.contains('dog') || cat.contains('vet')) return ServiceData.s3Url('Dog Walking', '1:1');
    if (cat.contains('education') || cat.contains('tutor') || cat.contains('teacher')) return ServiceData.s3Url('Home Tutor', '1:1');
    if (cat.contains('creative') || cat.contains('design') || cat.contains('logo')) return ServiceData.s3Url('Graphic Designer', '1:1');
    if (cat.contains('logistics') || cat.contains('packer') || cat.contains('mover')) return ServiceData.s3Url('Packers & Movers', '1:1');
    if (cat.contains('home repair') || cat.contains('repair')) return ServiceData.s3Url('Electrician', '1:1');

    // 3. Direct name match fallback
    return ServiceData.s3Url(category?.trim() ?? 'Electrician', '1:1');
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

    return Image(
      image: getImageProvider(resolvedPath),
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (context, error, stackTrace) => fallbackWidget,
    );
  }

  static ImageProvider getImageProvider(String? path, {String? fallbackAsset}) {
    if (path == null || path.isEmpty || path == 'null') {
      return AssetImage(fallbackAsset ?? placeholderUser);
    }

    if (path.startsWith('http')) {
      final decoded = Uri.decodeFull(path);
      return NetworkImage(Uri.encodeFull(decoded));
    }

    if (path.startsWith('assets/')) {
      final lower = path.toLowerCase();
      // Keep only these specific assets in the local Flutter bundle
      if (lower.contains('/logo/') ||
          lower.contains('refer_banner.png') ||
          lower.contains('worker_auth.png') ||
          lower.contains('placeholder_user.png')) {
        return AssetImage(path);
      }
      // Redirect all other assets (like job/category images) to backend static file hosting
      return NetworkImage(Uri.encodeFull('${NetworkHelper.baseUrl}/$path'));
    }

    // Default fallback to backend relative path
    final relativeUrl = path.startsWith('/')
        ? '${NetworkHelper.baseUrl}$path'
        : '${NetworkHelper.baseUrl}/$path';
    return NetworkImage(Uri.encodeFull(relativeUrl));
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

    final bool isGhostUrl = resolvedUrl == null ||
        resolvedUrl.isEmpty ||
        resolvedUrl == 'null' ||
        resolvedUrl.contains('randomuser.me') ||
        resolvedUrl.contains('images.unsplash.com') ||
        resolvedUrl.contains('pravatar.cc') ||
        resolvedUrl.contains('adventurer');

    final String displayName = (name != null && name.isNotEmpty) ? name : 'Nexo';
    final String fallbackUrl = "https://ui-avatars.com/api/?name=${Uri.encodeComponent(displayName)}&background=2563eb&color=fff&size=128&bold=true";

    if (isGhostUrl) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: const Color(0xFF2563EB),
        backgroundImage: NetworkImage(fallbackUrl),
      );
    }

    return CircleAvatar(
      radius: radius,
      backgroundColor: const Color(0xFF2563EB),
      child: ClipOval(
        child: Image.network(
          resolvedUrl!,
          width: radius * 2,
          height: radius * 2,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) {
            return Image.network(
              fallbackUrl,
              width: radius * 2,
              height: radius * 2,
              fit: BoxFit.cover,
            );
          },
        ),
      ),
    );
  }
}
