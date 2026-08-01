import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
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

    if (resolvedPath.startsWith('http')) {
      final decoded = Uri.decodeFull(resolvedPath);
      return S3NetworkImage(
        url: Uri.encodeFull(decoded),
        width: width,
        height: height,
        fit: fit,
        fallback: fallbackWidget,
      );
    }

    if (resolvedPath.startsWith('assets/')) {
      final lower = resolvedPath.toLowerCase();
      if (lower.contains('/logo/') ||
          lower.contains('refer_banner.png') ||
          lower.contains('worker_auth.png') ||
          lower.contains('placeholder_user.png')) {
        return Image.asset(
          resolvedPath,
          width: width,
          height: height,
          fit: fit,
          errorBuilder: (context, error, stackTrace) => fallbackWidget,
        );
      }
      final redirectUrl = '${NetworkHelper.baseUrl}/$resolvedPath';
      return S3NetworkImage(
        url: Uri.encodeFull(redirectUrl),
        width: width,
        height: height,
        fit: fit,
        fallback: fallbackWidget,
      );
    }

    final relativeUrl = resolvedPath.startsWith('/')
        ? '${NetworkHelper.baseUrl}$resolvedPath'
        : '${NetworkHelper.baseUrl}/$resolvedPath';

    return S3NetworkImage(
      url: Uri.encodeFull(relativeUrl),
      width: width,
      height: height,
      fit: fit,
      fallback: fallbackWidget,
    );
  }

  static ImageProvider getImageProvider(String? path, {String? fallbackAsset}) {
    if (path == null || path.isEmpty || path == 'null') {
      return AssetImage(fallbackAsset ?? placeholderUser);
    }

    if (path.startsWith('http')) {
      final decoded = Uri.decodeFull(path);
      return CachedNetworkImageProvider(Uri.encodeFull(decoded));
    }

    if (path.startsWith('assets/')) {
      final lower = path.toLowerCase();
      if (lower.contains('/logo/') ||
          lower.contains('refer_banner.png') ||
          lower.contains('worker_auth.png') ||
          lower.contains('placeholder_user.png')) {
        return AssetImage(path);
      }
      return CachedNetworkImageProvider(Uri.encodeFull('${NetworkHelper.baseUrl}/$path'));
    }

    final relativeUrl = path.startsWith('/')
        ? '${NetworkHelper.baseUrl}$path'
        : '${NetworkHelper.baseUrl}/$path';
    return CachedNetworkImageProvider(Uri.encodeFull(relativeUrl));
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
        backgroundImage: CachedNetworkImageProvider(fallbackUrl),
      );
    }

    return CircleAvatar(
      radius: radius,
      backgroundColor: const Color(0xFF2563EB),
      child: ClipOval(
        child: S3NetworkImage(
          url: resolvedUrl!,
          width: radius * 2,
          height: radius * 2,
          fit: BoxFit.cover,
          fallback: CachedNetworkImage(
            imageUrl: fallbackUrl,
            width: radius * 2,
            height: radius * 2,
            fit: BoxFit.cover,
          ),
        ),
      ),
    );
  }
}

class S3NetworkImage extends StatefulWidget {
  final String url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final Widget fallback;

  const S3NetworkImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    required this.fallback,
  });

  @override
  State<S3NetworkImage> createState() => _S3NetworkImageState();
}

class _S3NetworkImageState extends State<S3NetworkImage> {
  late List<String> _urlsToTry;
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    _initUrls();
  }

  @override
  void didUpdateWidget(S3NetworkImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _initUrls();
    }
  }

  void _initUrls() {
    _currentIndex = 0;
    final base = widget.url;
    _urlsToTry = [base];

    // If it's an S3/network URL, add other extension fallbacks
    if (base.contains('s3.ap-south-2.amazonaws.com') || base.contains('s3.amazonaws.com')) {
      final extIdx = base.lastIndexOf('.');
      if (extIdx != -1) {
        final pathWithoutExt = base.substring(0, extIdx);
        final extensions = ['.jpeg', '.jpg', '.webp', '.png'];
        final currentExt = base.substring(extIdx).toLowerCase();
        
        for (final ext in extensions) {
          if (ext != currentExt) {
            _urlsToTry.add(pathWithoutExt + ext);
          }
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_currentIndex >= _urlsToTry.length) {
      return widget.fallback;
    }

    return CachedNetworkImage(
      imageUrl: _urlsToTry[_currentIndex],
      width: widget.width,
      height: widget.height,
      fit: widget.fit,
      placeholder: (context, url) => widget.fallback,
      errorWidget: (context, url, error) {
        if (_currentIndex + 1 < _urlsToTry.length) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              setState(() {
                _currentIndex++;
              });
            }
          });
        }
        return widget.fallback;
      },
    );
  }
}
