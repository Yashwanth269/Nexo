import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:flutter_polyline_points/flutter_polyline_points.dart';

class MapsService {
  static const String apiKey = "AIzaSyB6SnWAcEupDUfXAXW82Jp1Du9nwuIEEBU";

  static Future<Map<String, dynamic>?> getDirections({
    required LatLng origin,
    required LatLng destination,
  }) async {
    final String url =
        "https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&key=$apiKey";

    try {
      print("📡 [ROUTE_FETCH_STARTED] origin: ${origin.latitude},${origin.longitude} -> dest: ${destination.latitude},${destination.longitude}");
      final response = await http.get(Uri.parse(url));
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['status'] == 'OK') {
          final route = data['routes'][0];
          final leg = route['legs'][0];
          
          final distance = leg['distance']['text'];
          final duration = leg['duration']['text'];
          final points = route['overview_polyline']['points'];
          
          print("✅ [ROUTE_FETCH_SUCCESS] Distance: $distance, Duration: $duration");
          
          return {
            'distance': distance,
            'duration': duration,
            'polyline_points': points,
            'bounds': _getBounds(route['bounds']),
          };
        } else {
          print("❌ [ROUTE_FETCH_ERROR] Status: ${data['status']}");
        }
      }
    } catch (e) {
      print("❌ [ROUTE_FETCH_ERROR] Exception: $e");
    }
    return null;
  }

  static LatLngBounds _getBounds(Map<String, dynamic> bounds) {
    return LatLngBounds(
      northeast: LatLng(bounds['northeast']['lat'], bounds['northeast']['lng']),
      southwest: LatLng(bounds['southwest']['lat'], bounds['southwest']['lng']),
    );
  }

  static List<LatLng> decodePolyline(String encoded) {
    List<PointLatLng> result = PolylinePoints.decodePolyline(encoded);
    return result.map((p) => LatLng(p.latitude, p.longitude)).toList();
  }
}
