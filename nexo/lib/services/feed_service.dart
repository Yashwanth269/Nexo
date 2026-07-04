import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/services/socket_service.dart';
import 'package:nexo/services/shared_prefs_helper.dart';

/// ═══════════════════════════════════════════════════════════════
///  FeedService — Realtime Localized "Recently Completed" Social Feed
///
///  Architecture:
///  1. Fetches hybrid-ranked feed data from /api/feed/nearby (geo + user)
///  2. Supports active pros facepile list at the region header
///  3. Subscribes to `feed_updated` socket room pushes for instant syncs
///  4. Integrates POST requests for likes, saves, and view tracking
///  5. Exposes a Stream<List<Map>> for reactive feed items state
/// ═══════════════════════════════════════════════════════════════
class FeedService {
  FeedService._();
  static final FeedService instance = FeedService._();

  final StreamController<List<Map<String, dynamic>>> _feedController =
      StreamController<List<Map<String, dynamic>>>.broadcast();

  Stream<List<Map<String, dynamic>>> get feedStream => _feedController.stream;

  List<Map<String, dynamic>> _lastFeedResult = [];
  List<Map<String, dynamic>> _activeWorkers = [];
  double? _lastLat;
  double? _lastLng;
  String? _lastUserId;
  bool _socketListenerAttached = false;
  String? _nextCursor;

  static const String _baseUrl = NetworkHelper.baseUrl;

  List<Map<String, dynamic>> get lastResult => _lastFeedResult;
  List<Map<String, dynamic>> get activeWorkers => _activeWorkers;
  String? get nextCursor => _nextCursor;

  // ──────────────────────────────────────────────────────────────
  //  INITIALISE — Bind on screen creation
  // ──────────────────────────────────────────────────────────────
  Future<void> init(double lat, double lng) async {
    _lastLat = lat;
    _lastLng = lng;
    _lastUserId = await SharedPrefsHelper.getUserId();

    _attachSocketListener();
    await fetch(lat, lng, userId: _lastUserId, clearPage: true);
  }

  // ──────────────────────────────────────────────────────────────
  //  FETCH from /api/feed/nearby
  // ──────────────────────────────────────────────────────────────
  Future<List<Map<String, dynamic>>> fetch(
    double lat,
    double lng, {
    String? userId,
    bool clearPage = false,
    bool bypassCache = false,
  }) async {
    _lastLat = lat;
    _lastLng = lng;
    _lastUserId = userId ?? _lastUserId;

    _attachSocketListener();

    if (clearPage) {
      _nextCursor = null;
    }

    try {
      String url = '$_baseUrl/api/feed/nearby?lat=$lat&lng=$lng&limit=10';
      if (_lastUserId != null && _lastUserId!.isNotEmpty) {
        url += '&userId=$_lastUserId';
      }
      if (_nextCursor != null && _nextCursor!.isNotEmpty) {
        url += '&cursor=${Uri.encodeComponent(_nextCursor!)}';
      }
      if (bypassCache) {
        url += '&bypass=1';
      }

      debugPrint('[FEED_SERVICE] Fetching feed: $url');

      final response = await http
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['posts'] != null) {
          final raw = (data['posts'] as List).cast<Map<String, dynamic>>();
          
          final List<Map<String, dynamic>> parsedWorkers = data['activeWorkers'] != null 
              ? (data['activeWorkers'] as List).cast<Map<String, dynamic>>()
              : [];
          _activeWorkers = parsedWorkers;
          _nextCursor = data['nextCursor'] as String?;

          final List<Map<String, dynamic>> list = clearPage ? [] : List.from(_lastFeedResult);
          
          // De-duplicate items
          for (var post in raw) {
            list.removeWhere((existing) => existing['id'] == post['id']);
            list.add(post);
          }

          _lastFeedResult = list;
          if (!_feedController.isClosed) {
            _feedController.add(list);
          }

          final meta = data['meta'] as Map<String, dynamic>? ?? {};
          debugPrint(
            '[FEED_SERVICE] ✅ Loaded ${raw.length} posts. Latency: ${meta["latencyMs"]}ms. Cached: ${meta["cached"]}',
          );
          return list;
        }
      }
    } catch (e) {
      debugPrint('[FEED_SERVICE] ❌ Fetch error: $e');
    }

    return _lastFeedResult;
  }

  // ──────────────────────────────────────────────────────────────
  //  TOGGLE LIKE
  // ──────────────────────────────────────────────────────────────
  Future<bool> likePost(String postId) async {
    try {
      final url = '$_baseUrl/api/feed/$postId/like';
      debugPrint('[FEED_SERVICE] POST Like: $url');
      
      final response = await http.post(
        Uri.parse(url),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'userId': _lastUserId}),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          final liked = data['liked'] as bool;
          
          // Instantly update local list state
          final idx = _lastFeedResult.indexWhere((p) => p['id'] == postId);
          if (idx != -1) {
            final p = Map<String, dynamic>.from(_lastFeedResult[idx]);
            p['isLiked'] = liked;
            p['likesCount'] = (p['likesCount'] as int) + (liked ? 1 : -1);
            _lastFeedResult[idx] = p;
            _feedController.add(_lastFeedResult);
          }
          return liked;
        }
      }
    } catch (e) {
      debugPrint('[FEED_SERVICE] ❌ Like toggle error: $e');
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────────
  //  TOGGLE SAVE
  // ──────────────────────────────────────────────────────────────
  Future<bool> savePost(String postId) async {
    try {
      final url = '$_baseUrl/api/feed/$postId/save';
      debugPrint('[FEED_SERVICE] POST Save: $url');

      final response = await http.post(
        Uri.parse(url),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'userId': _lastUserId}),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          final saved = data['saved'] as bool;

          final idx = _lastFeedResult.indexWhere((p) => p['id'] == postId);
          if (idx != -1) {
            final p = Map<String, dynamic>.from(_lastFeedResult[idx]);
            p['isSaved'] = saved;
            p['savesCount'] = (p['savesCount'] as int) + (saved ? 1 : -1);
            _lastFeedResult[idx] = p;
            _feedController.add(_lastFeedResult);
          }
          return saved;
        }
      }
    } catch (e) {
      debugPrint('[FEED_SERVICE] ❌ Save toggle error: $e');
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────────
  //  RECORD VIEW
  // ──────────────────────────────────────────────────────────────
  Future<void> recordView(String postId) async {
    try {
      final url = '$_baseUrl/api/feed/$postId/view';
      
      final response = await http.post(
        Uri.parse(url),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'userId': _lastUserId}),
      );

      if (response.statusCode == 200) {
        final idx = _lastFeedResult.indexWhere((p) => p['id'] == postId);
        if (idx != -1) {
          final p = Map<String, dynamic>.from(_lastFeedResult[idx]);
          p['viewsCount'] = (p['viewsCount'] as int) + 1;
          _lastFeedResult[idx] = p;
          _feedController.add(_lastFeedResult);
        }
      }
    } catch (e) {
      debugPrint('[FEED_SERVICE] ❌ Record view error: $e');
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  SOCKET LISTENER — feed_updated pushes
  // ──────────────────────────────────────────────────────────────
  void _attachSocketListener() {
    if (_socketListenerAttached) return;

    final socket = SocketService().socket;
    if (socket == null) return;

    _socketListenerAttached = true;
    debugPrint('[FEED_SERVICE] ✅ Socket listener attached for feed_updated');

    socket.on('feed_updated', (data) {
      debugPrint('[FEED_SERVICE] 🔴 Received live push update: feed_updated — postId=${data["postId"]}');
      
      final postId = data['postId'] as String?;
      final likesCount = data['likesCount'] as int?;
      
      if (postId != null && likesCount != null) {
        final idx = _lastFeedResult.indexWhere((p) => p['id'] == postId);
        if (idx != -1) {
          final p = Map<String, dynamic>.from(_lastFeedResult[idx]);
          p['likesCount'] = likesCount;
          _lastFeedResult[idx] = p;
          _feedController.add(_lastFeedResult);
          return;
        }
      }

      // Fallback reload
      if (_lastLat != null && _lastLng != null) {
        fetch(_lastLat!, _lastLng!, userId: _lastUserId, clearPage: true, bypassCache: true);
      }
    });
  }

  void dispose() {
    _feedController.close();
    _socketListenerAttached = false;
  }
}
