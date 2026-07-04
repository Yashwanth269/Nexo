import 'package:flutter/material.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/service_data.dart';

class ImageUtils {
  static const String placeholderUser = 'assets/images/placeholder_user.png';
  
  static String getCategoryAsset(String? category) {
    print('[JOB_CATEGORY] $category');
    final cat = category?.trim().toLowerCase() ?? '';
    
    // Dynamic lookup in ServiceData to resolve exact task images
    if (category != null && category.trim().isNotEmpty) {
      final nameLower = category.trim().toLowerCase();
      for (var c in ServiceData.categories) {
        if (c['subcategories'] != null) {
          for (var sub in c['subcategories']) {
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
    
    if (cat.contains('ac') || cat.contains('air condition')) return 'assets/images/home services/appliance repair/ac repair.jpg';
    if (cat.contains('electrician') || cat.contains('wire') || cat.contains('switch')) return 'assets/images/home services/electrical/wiring.webp';
    if (cat.contains('plumb') || cat.contains('leak') || cat.contains('pipe')) return 'assets/images/home services/plumbing/tap repair.jpg';
    if (cat.contains('clean') || cat.contains('house keep')) return 'assets/images/home services/cleaning/full house cleaner.jpeg';
    if (cat.contains('tractor') || cat.contains('plough')) return 'assets/images/Agriculture/Equipment Rental/tractor ploughing.jpg';
    if (cat.contains('mason') || cat.contains('brick') || cat.contains('construction')) return 'assets/images/construction/core work/mason brick work.webp';
    if (cat.contains('delivery') || cat.contains('parcel')) return 'assets/images/delivery/errands/parcel delivery.jpg';
    if (cat.contains('mechanic') || cat.contains('bike') || cat.contains('car')) return 'assets/images/mechanic/vehicle repair/bike repair.webp';
    if (cat.contains('driver') || cat.contains('transport')) return 'assets/images/transport/vehicles/pickup vehicle.webp';
    if (cat.contains('maid') || cat.contains('cook') || cat.contains('help')) return 'assets/images/household/care and help/maid.jpg';
    if (cat.contains('cctv') || cat.contains('camera') || cat.contains('solar')) return 'assets/images/smart tech/installation/solar panel installation.jpg';
    if (cat.contains('event') || cat.contains('stage') || cat.contains('sound')) return 'assets/images/events/event staff/sound or light setup.jpg';
    if (cat.contains('painter')) return 'assets/images/construction/finishing work/painter.jpg';
    if (cat.contains('carpenter')) return 'assets/images/skilled/trades/carpenter.webp';

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
      default: return 'assets/images/skilled/trades/ac technician.jpg';
    }
  }

  static Widget buildServiceImage(String? path, {String? taskName, double? width, double? height, BoxFit fit = BoxFit.cover, Widget? fallback}) {
    print('[SERVICE_IMAGE_REQUEST] Path: $path, Task: $taskName');
    
    String? resolvedPath = path;
    
    // Fallback to taskName mapping if path is missing or placeholder
    if ((resolvedPath == null || resolvedPath.isEmpty || resolvedPath == 'null') && taskName != null) {
      resolvedPath = getCategoryAsset(taskName);
    }
    
    if (resolvedPath == null || resolvedPath.isEmpty || resolvedPath == 'null') {
      return fallback ?? Icon(Icons.image, size: width ?? 24, color: Colors.grey);
    }

    // If resolvedPath starts with assets/ (or contains assets/images/ directly), treat it as a local asset
    if (resolvedPath.startsWith('assets/') || resolvedPath.contains('assets/images/')) {
      final localPath = resolvedPath.startsWith('assets/') ? resolvedPath : 'assets/images/${resolvedPath.split('assets/images/')[1]}';
      return Image.asset(
        localPath,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (context, error, stackTrace) {
          print('❌ [ASSET_LOAD_ERROR] Failed to load local asset: $localPath');
          return fallback ?? Icon(Icons.broken_image, size: width ?? 24, color: Colors.grey);
        },
      );
    }

    String finalUrl = resolvedPath;
    if (!resolvedPath.startsWith('http')) {
       finalUrl = '${NetworkHelper.baseUrl}$resolvedPath';
    }
    
    finalUrl = Uri.encodeFull(finalUrl);

    return Image.network(
      finalUrl,
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (context, error, stackTrace) {
        print('❌ [ASSET_LOAD_ERROR] Failed to load: $finalUrl');
        return fallback ?? Icon(Icons.broken_image, size: width ?? 24, color: Colors.grey);
      },
    );
  }

  static Widget buildProfileImage(String? url, {double radius = 24, String? name}) {
    print('[PROFILE_IMAGE_SOURCE] ${url ?? "NULL (Showing Placeholder)"}');
    
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
      onBackgroundImageError: (e, s) {
        print('❌ [IMAGE_LOAD_ERROR] Failed to load: $resolvedUrl');
      },
    );
  }
}
