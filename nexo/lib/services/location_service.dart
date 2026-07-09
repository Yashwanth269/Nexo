import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';

class LocationService {
  static Future<bool> checkPermission() async {
    LocationPermission permission = await Geolocator.checkPermission();
    return permission == LocationPermission.whileInUse || permission == LocationPermission.always;
  }

  static Future<String> getAddressFromCoords(double lat, double lng) async {
    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(lat, lng).timeout(const Duration(seconds: 4));
      if (placemarks.isNotEmpty) {
        Placemark place = placemarks[0];
        
        String street = place.street ?? "";
        String subLocality = place.subLocality ?? "";
        String locality = place.locality ?? "";
        
        List<String> parts = [];
        if (street.isNotEmpty && !street.contains('+') && street != place.name) {
          parts.add(street);
        }
        if (subLocality.isNotEmpty) {
          parts.add(subLocality);
        }
        if (locality.isNotEmpty) {
          parts.add(locality);
        }
        
        String addr = parts.join(', ').trim();
        if (addr.startsWith(',')) addr = addr.substring(1).trim();
        if (addr.endsWith(',')) addr = addr.substring(0, addr.length - 1).trim();
        if (addr.isEmpty) {
          addr = place.name ?? "${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}";
        }
        return addr;
      }
    } catch (e) {
      // Fallback on geocoding exception
    }
    return "${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}";
  }

  static Future<Map<String, dynamic>> getCurrentLocation() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return {'address': 'Location services disabled', 'lat': 0.0, 'lng': 0.0};
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return {'address': 'Location permission denied', 'lat': 0.0, 'lng': 0.0};
      }
    }
    if (permission == LocationPermission.deniedForever) {
      return {'address': 'Location permission denied forever', 'lat': 0.0, 'lng': 0.0};
    }

    double latitude = 0.0;
    double longitude = 0.0;
    String finalAddress = 'Fetching location...';

    // 1. Try to get last known position first (instant feedback like Zomato)
    try {
      Position? lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null) {
        latitude = lastKnown.latitude;
        longitude = lastKnown.longitude;
        finalAddress = await getAddressFromCoords(latitude, longitude);
      }
    } catch (e) {
      // Ignore
    }

    // 2. Query live position for high accuracy
    try {
      Position position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium, // More reliable than high indoors
          timeLimit: Duration(seconds: 8),
        ),
      );
      latitude = position.latitude;
      longitude = position.longitude;
      finalAddress = await getAddressFromCoords(latitude, longitude);
    } catch (e) {
      // If we don't have lastKnown, try a lower accuracy quick check
      if (latitude == 0.0) {
        try {
          Position position = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.low,
              timeLimit: Duration(seconds: 4),
            ),
          );
          latitude = position.latitude;
          longitude = position.longitude;
          finalAddress = await getAddressFromCoords(latitude, longitude);
        } catch (err) {
          if (latitude == 0.0) {
            return {'address': 'Location timeout. Tap to retry.', 'lat': 0.0, 'lng': 0.0};
          }
        }
      }
    }

    return {'address': finalAddress, 'lat': latitude, 'lng': longitude};
  }

  static Stream<Map<String, dynamic>> getLocationStream() {
    return Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.medium,
        distanceFilter: 100,
      ),
    ).asyncMap((position) async {
      final addr = await getAddressFromCoords(position.latitude, position.longitude);
      return {'address': addr, 'lat': position.latitude, 'lng': position.longitude};
    });
  }
}
