import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';

class LocationService {
  static Future<bool> checkPermission() async {
    LocationPermission permission = await Geolocator.checkPermission();
    return permission == LocationPermission.whileInUse || permission == LocationPermission.always;
  }

  static Future<Map<String, dynamic>> getCurrentLocation() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return {'address': 'Location services disabled', 'lat': 0.0, 'lng': 0.0};

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
       return {'address': 'No Permission', 'lat': 0.0, 'lng': 0.0};
    }

    try {
      Position position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 5)),
      );

      List<Placemark> placemarks = await placemarkFromCoordinates(position.latitude, position.longitude);
      
      if (placemarks.isNotEmpty) {
        Placemark place = placemarks[0];
        String addr = '${place.subLocality ?? ""}, ${place.locality ?? ""}'.trim();
        if (addr.startsWith(',')) addr = addr.substring(1).trim();
        if (addr.endsWith(',')) addr = addr.substring(0, addr.length - 1).trim();
        if (addr.isEmpty) addr = place.name ?? "Unknown location";
        
        return {'address': addr, 'lat': position.latitude, 'lng': position.longitude};
      }
      return {'address': 'Address not found', 'lat': position.latitude, 'lng': position.longitude};
    } catch (e) {
      return {'address': 'Locating...', 'lat': 0.0, 'lng': 0.0};
    }
  }

  static Stream<Map<String, dynamic>> getLocationStream() {
    return Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 100,
      ),
    ).asyncMap((position) async {
      try {
        List<Placemark> placemarks = await placemarkFromCoordinates(position.latitude, position.longitude);
        if (placemarks.isNotEmpty) {
          Placemark place = placemarks[0];
          String addr = '${place.subLocality ?? ""}, ${place.locality ?? ""}'.trim();
          if (addr.startsWith(',')) addr = addr.substring(1).trim();
          if (addr.endsWith(',')) addr = addr.substring(0, addr.length - 1).trim();
          
          return {'address': addr, 'lat': position.latitude, 'lng': position.longitude};
        }
        return {'address': 'Updating...', 'lat': position.latitude, 'lng': position.longitude};
      } catch (e) {
        return {'address': 'Live Tracking...', 'lat': position.latitude, 'lng': position.longitude};
      }
    });
  }
}
