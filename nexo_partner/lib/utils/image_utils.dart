import 'package:flutter/material.dart';
import 'package:nexo_partner/utils/network_helper.dart';
import 'package:cached_network_image/cached_network_image.dart';

class ImageUtils {
  static const String placeholderUser = 'assets/images/placeholder_user.png';
  
  static Widget getCategoryIcon(String? category, {double size = 24, Color? color}) {
    final cat = category?.trim().toLowerCase() ?? '';
    IconData iconData = Icons.handyman;
    Color iconColor = color ?? const Color(0xFFFF6A00);

    if (cat.contains('ac') || cat.contains('air condition') || cat.contains('cooling')) {
      iconData = Icons.ac_unit;
    } else if (cat.contains('electric') || cat.contains('wire') || cat.contains('fan') || cat.contains('switch')) {
      iconData = Icons.electric_bolt;
    } else if (cat.contains('plumb') || cat.contains('tap') || cat.contains('pipe') || cat.contains('leak')) {
      iconData = Icons.plumbing;
    } else if (cat.contains('clean') || cat.contains('wash') || cat.contains('mop')) {
      iconData = Icons.cleaning_services;
    } else if (cat.contains('tractor') || cat.contains('plough') || cat.contains('farm') || cat.contains('agricultur')) {
      iconData = Icons.agriculture;
    } else if (cat.contains('mason') || cat.contains('brick') || cat.contains('construct') || cat.contains('repair') || cat.contains('home repair')) {
      iconData = Icons.home_repair_service;
    } else if (cat.contains('deliver') || cat.contains('parcel') || cat.contains('courier')) {
      iconData = Icons.local_shipping;
    } else if (cat.contains('mechanic') || cat.contains('bike') || cat.contains('car') || cat.contains('vehicle')) {
      iconData = Icons.build_circle;
    } else if (cat.contains('paint')) {
      iconData = Icons.format_paint;
    } else if (cat.contains('carpent')) {
      iconData = Icons.carpenter;
    }

    return Icon(iconData, size: size, color: iconColor);
  }

  static Widget buildServiceImage(String? path, {String? taskName, double? width, double? height, BoxFit fit = BoxFit.cover, Widget? fallback}) {
    String? resolvedPath = path;
    
    if (resolvedPath == null || resolvedPath.isEmpty || resolvedPath == 'null') {
      return fallback ?? Container(
        width: width ?? 40,
        height: height ?? 40,
        alignment: Alignment.center,
        child: getCategoryIcon(taskName, size: (width ?? 24) * 0.7),
      );
    }

    // Handle network images or server upload paths
    String finalUrl = resolvedPath;
    if (!resolvedPath.startsWith('http')) {
      if (resolvedPath.startsWith('assets/')) {
        // Local logo asset only
        if (resolvedPath.contains('logo')) {
          return Image.asset(
            'assets/images/logo/Nexo_partner_logo.png',
            width: width,
            height: height,
            fit: fit,
            errorBuilder: (_, __, ___) => getCategoryIcon(taskName, size: (width ?? 24) * 0.7),
          );
        }
        // Non-existent local asset path - fallback directly to category icon
        return fallback ?? Container(
          width: width ?? 40,
          height: height ?? 40,
          alignment: Alignment.center,
          child: getCategoryIcon(taskName, size: (width ?? 24) * 0.7),
        );
      }
      finalUrl = '${NetworkHelper.baseUrl}${resolvedPath.startsWith('/') ? '' : '/'}$resolvedPath';
    }

    finalUrl = Uri.encodeFull(finalUrl);

    return CachedNetworkImage(
      imageUrl: finalUrl,
      width: width,
      height: height,
      fit: fit,
      placeholder: (context, url) => Container(
        width: width,
        height: height,
        color: const Color(0xFFF1F5F9),
        child: Center(child: getCategoryIcon(taskName, size: (width ?? 24) * 0.6)),
      ),
      errorWidget: (context, url, error) => fallback ?? Container(
        width: width,
        height: height,
        alignment: Alignment.center,
        child: getCategoryIcon(taskName, size: (width ?? 24) * 0.7),
      ),
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
        backgroundColor: const Color(0xFFEFF6FF),
        child: name != null && name.isNotEmpty
            ? Text(
                name[0].toUpperCase(),
                style: TextStyle(
                  color: const Color(0xFFFF6A00),
                  fontWeight: FontWeight.bold,
                  fontSize: radius * 0.8,
                ),
              )
            : Icon(Icons.person, size: radius, color: const Color(0xFF94A3B8)),
      );
    }

    return CircleAvatar(
      radius: radius,
      backgroundImage: NetworkImage(resolvedUrl),
      backgroundColor: Colors.transparent,
      onBackgroundImageError: (_, __) {},
    );
  }
}
