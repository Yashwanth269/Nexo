import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/services/service_data.dart';

/// ═══════════════════════════════════════════════════════════════
///  TrendingService — Realtime "Popular Near You" Data Provider
///
///  Architecture:
///  1. Fetches rich trend data from /api/market/trending (geo + user)
///  2. Normalises API response into card-ready Map list
///  3. Subscribes to `trending_updated` socket events for live push
///  4. Joins the geo-scoped Socket.IO room for localised updates
///  5. Exposes a Stream<List<Map>> for reactive UI updates
///  6. Sends search/click events to /api/market/event for intent tracking
/// ═══════════════════════════════════════════════════════════════
class TrendingService {
  TrendingService._();
  static final TrendingService instance = TrendingService._();

  // Stream controller for the home screen to listen to
  final StreamController<List<Map<String, dynamic>>> _trendingController =
      StreamController<List<Map<String, dynamic>>>.broadcast();

  Stream<List<Map<String, dynamic>>> get trendingStream => _trendingController.stream;

  List<Map<String, dynamic>> _lastResult = [];
  double? _lastLat;
  double? _lastLng;
  String? _lastUserId;
  bool _socketListenerAttached = false;

  static const String _baseUrl = NetworkHelper.baseUrl;

  // ──────────────────────────────────────────────────────────────
  //  INITIALISE — call once from home screen initState
  // ──────────────────────────────────────────────────────────────
  Future<void> init(double lat, double lng) async {
    _lastLat = lat;
    _lastLng = lng;
    _lastUserId = await SharedPrefsHelper.getUserId();

    await _joinTrendingRoom(lat, lng);
    _attachSocketListener();
    await fetch(lat, lng, userId: _lastUserId);
  }

  // ──────────────────────────────────────────────────────────────
  //  FETCH from /api/market/trending
  // ──────────────────────────────────────────────────────────────
  Future<List<Map<String, dynamic>>> fetch(
    double lat,
    double lng, {
    String? userId,
    bool bypassCache = false,
  }) async {
    _lastLat = lat;
    _lastLng = lng;

    await _joinTrendingRoom(lat, lng);
    _attachSocketListener();

    try {
      String url = '$_baseUrl/api/market/trending?lat=$lat&lng=$lng&limit=6';
      if (userId != null && userId.isNotEmpty) url += '&userId=$userId';
      if (bypassCache) url += '&bypass=1';

      debugPrint('[TRENDING_SERVICE] Fetching: $url');

      final response = await http
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['trending'] != null) {
          final raw = (data['trending'] as List).cast<Map<String, dynamic>>();
          final mapped = raw.map(_mapApiCardToUiCard).toList();

          _lastResult = mapped;
          if (!_trendingController.isClosed) {
            _trendingController.add(mapped);
          }

          final meta = data['meta'] as Map<String, dynamic>? ?? {};
          debugPrint(
            '[TRENDING_SERVICE] ✅ ${mapped.length} results — '
            'segment=${meta["segment"]} area=${meta["areaType"]} '
            'cached=${meta["cached"]}',
          );
          return mapped;
        }
      }
    } catch (e) {
      debugPrint('[TRENDING_SERVICE] ❌ Fetch error: $e');
    }

    // Return cached result on error (do NOT push empty)
    return _lastResult;
  }

  // ──────────────────────────────────────────────────────────────
  //  MAP API RESPONSE CARD → UI CARD
  //  Translates the rich backend payload into the format
  //  expected by _buildPopularServicesList in home_screen.dart
  // ──────────────────────────────────────────────────────────────
  Map<String, dynamic> _mapApiCardToUiCard(Map<String, dynamic> api) {
    final name        = api['name']          as String? ?? 'Service';
    final rank        = api['rank']          as String? ?? '#1 Rank';
    final badge       = api['badge']         as String? ?? '📈 TRENDING';
    final badgeType   = api['badgeType']     as String? ?? 'TRENDING';
    final growthText  = api['growthText']    as String? ?? '';
    final activeW     = api['activeWorkers'] as int?    ?? 0;
    final shortage    = api['workerShortage']as bool?   ?? false;
    final confidence  = (api['confidence']   as num?)?.toDouble() ?? 0.5;
    final isFallback  = api['isFallback']    as bool? ?? false;

    // Look up the correct image from ServiceData
    final catData = ServiceData.categories.firstWhere(
      (c) => c['name'] == name || (c['workers'] as List).contains(name),
      orElse: () => <String, dynamic>{},
    );
    final image = catData.isNotEmpty ? catData['image'] as String? : null;

    // Build tags from API — fallback to badge if no tags
    final rawTags = api['tags'] as List<dynamic>? ?? [];
    final tags = rawTags.map<Map<String, dynamic>>((t) {
      final tag = t as Map<String, dynamic>;
      return {
        'text': tag['text'] as String? ?? badge,
        'bg'  : _hexToColor(tag['bg'] as String? ?? '#FFF1F2'),
        'fg'  : _hexToColor(tag['fg'] as String? ?? '#E11D48'),
      };
    }).toList();

    // Ensure at least 3 tags
    final extraTagPool = [
      {'text': '🛡️ TRUSTED SERVICE', 'bg': '#EFF6FF', 'fg': '#2563EB'},
      {'text': '⏱️ FAST RESPONSE',   'bg': '#FFF7ED', 'fg': '#EA580C'},
      {'text': '✅ VERIFIED PRO',     'bg': '#ECFDF5', 'fg': '#059669'},
      {'text': '🏅 MOST RELIABLE',    'bg': '#FEF3C7', 'fg': '#D97706'},
      {'text': '🌟 TOP PICK',          'bg': '#F5F3FF', 'fg': '#7C3AED'},
    ];
    int extraIdx = 0;
    while (tags.length < 3) {
      final extra = extraTagPool[extraIdx % extraTagPool.length];
      tags.add({
        'text': extra['text']!,
        'bg'  : _hexToColor(extra['bg']!),
        'fg'  : _hexToColor(extra['fg']!),
      });
      extraIdx++;
    }

    // Metrics
    final reqCountText    = api['reqCountText']       as String? ?? '${api['reqCountToday'] ?? 0} requests today';
    final workersText     = api['activeWorkersText']  as String? ?? '$activeW workers active';
    final satText         = api['satisfaction']       as String? ?? '${api['completionRate'] ?? 80}% satisfaction';
    final respText        = api['responseTime']       as String? ?? '~${api['avgResponseMinutes'] ?? 8} min response';
    final bookedText      = api['bookedToday']        as String? ?? '';
    final growthFull      = growthText.isNotEmpty ? growthText : '';
    final shortage_text   = shortage ? 'Only $activeW workers left!' : workersText;

    return {
      'name'                : name,
      'image'               : image,       // ✅ correct per-category image
      'rank'                : rank,
      'tags'                : tags,
      'badge'               : badge,
      'badgeType'           : badgeType,
      'trendScore'          : api['trendScore'] ?? 0.5,
      'confidence'          : confidence,
      'isFallback'          : isFallback,
      'isHotZone'           : api['isHotZone'] ?? false,
      'areaType'            : api['areaType'] ?? 'mixed',
      'segment'             : api['segment'] ?? 'day',
      'userBoosted'         : api['userBoosted'] ?? false,
      // Metrics for card display (real API data)
      'reqCount'            : reqCountText,
      'reqCountToday'       : api['reqCountToday'] ?? 0,
      'responseTime'        : respText,
      'detailRow2'          : shortage_text,
      'detailIcon'          : shortage ? 'warning_amber_rounded' : 'circle',
      'detailIconColor'     : shortage ? 0xFFE11D48 : 0xFF10B981,
      'detailRow3'          : growthFull.isNotEmpty ? growthFull : satText,
      'detailRow3Icon'      : growthFull.isNotEmpty ? 'trending_up_rounded' : 'sentiment_very_satisfied_rounded',
      'detailRow3IconColor' : growthFull.isNotEmpty ? 0xFF10B981 : 0xFFEAB308,
      'bookedToday'         : bookedText,
      'usersBooked'         : '${api['reqCountToday'] ?? 0} booked today',
      'avgPrice'            : 'See prices',
      'satisfaction'        : satText,
      // Internal fields
      '_workerShortage'     : shortage,
      '_activeWorkers'      : activeW,
      '_growthPct'          : api['growthPct'] ?? 0,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  HEX COLOR PARSER
  // ──────────────────────────────────────────────────────────────
  int _hexToColor(String hex) {
    final clean = hex.replaceAll('#', '');
    if (clean.length == 6) return int.parse('FF$clean', radix: 16);
    if (clean.length == 8) return int.parse(clean, radix: 16);
    return 0xFFFFF1F2; // fallback
  }

  // ──────────────────────────────────────────────────────────────
  //  JOIN GEO-SCOPED SOCKET.IO ROOM
  //  Emits join_trending_room to get localised trending_updated pushes
  // ──────────────────────────────────────────────────────────────
  Future<void> _joinTrendingRoom(double lat, double lng) async {
    try {
      final socket = SocketService().socket;
      if (socket != null && socket.connected) {
        socket.emit('join_trending_room', {'lat': lat, 'lng': lng});
        debugPrint('[TRENDING_SERVICE] Joined trending room for lat=$lat, lng=$lng');
      }
    } catch (e) {
      debugPrint('[TRENDING_SERVICE] Socket room join error: $e');
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  SOCKET LISTENER — trending_updated push event
  // ──────────────────────────────────────────────────────────────
  void _attachSocketListener() {
    if (_socketListenerAttached) return;

    final socket = SocketService().socket;
    if (socket == null) return;

    _socketListenerAttached = true;
    debugPrint('[TRENDING_SERVICE] ✅ Socket listener attached for trending_updated');

    socket.on('trending_updated', (data) {
      debugPrint('[TRENDING_SERVICE] 🔴 Live push received: trending_updated — trigger=${data["trigger"]}');
      // Re-fetch with cache bypass to get freshest data
      if (_lastLat != null && _lastLng != null) {
        fetch(_lastLat!, _lastLng!, userId: _lastUserId, bypassCache: true);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────
  //  SEND SEARCH INTENT EVENT
  //  Call when user taps a category, searches, or views a profile
  // ──────────────────────────────────────────────────────────────
  Future<void> trackIntent(String type, String category, double lat, double lng) async {
    try {
      // Prefer socket for low-latency signalling
      final socket = SocketService().socket;
      if (socket != null && socket.connected) {
        socket.emit('market_event', {
          'type'    : type,
          'category': category,
          'lat'     : lat,
          'lng'     : lng,
          'userId'  : _lastUserId,
        });
      } else {
        // HTTP fallback
        await http.post(
          Uri.parse('$_baseUrl/api/market/event'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'type': type, 'category': category, 'lat': lat, 'lng': lng, 'userId': _lastUserId}),
        );
      }
      debugPrint('[TRENDING_SERVICE] Intent tracked: $type → $category');
    } catch (e) {
      debugPrint('[TRENDING_SERVICE] Intent tracking error: $e');
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  UPDATE LOCATION (when user moves)
  // ──────────────────────────────────────────────────────────────
  Future<void> updateLocation(double lat, double lng) async {
    if (lat == _lastLat && lng == _lastLng) return;
    _lastLat = lat;
    _lastLng = lng;
    await _joinTrendingRoom(lat, lng);
    await fetch(lat, lng, userId: _lastUserId, bypassCache: true);
  }

  /// Returns the last cached result synchronously (for initial render)
  List<Map<String, dynamic>> get lastResult => _lastResult;

  void dispose() {
    _trendingController.close();
    _socketListenerAttached = false;
  }
}
