import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:nexo/services/shared_prefs_helper.dart';

class AddLocationScreen extends StatefulWidget {
  const AddLocationScreen({super.key});

  @override
  State<AddLocationScreen> createState() => _AddLocationScreenState();
}

class _AddLocationScreenState extends State<AddLocationScreen> {
  static const Color primaryOrange = Color(0xFFFF6A00);
  
  GoogleMapController? _mapController;
  LatLng _currentPosition = const LatLng(13.1425, 78.1426); // Default Kolar
  String _currentAddress = "Loading address...";
  String _locationName = "Home";
  bool _isLoading = true;
  bool _isSaving = false;

  final List<String> _locationTypes = ["Home", "Farm", "Work", "Shop", "Other"];

  @override
  void initState() {
    super.initState();
    _determinePosition();
  }

  Future<void> _determinePosition() async {
    try {
      Position position = await Geolocator.getCurrentPosition();
      setState(() {
        _currentPosition = LatLng(position.latitude, position.longitude);
        _isLoading = false;
      });
      _getAddressFromLatLng(_currentPosition);
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _getAddressFromLatLng(LatLng position) async {
    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(position.latitude, position.longitude);
      Placemark place = placemarks[0];
      setState(() {
        _currentAddress = "${place.street}, ${place.locality}, ${place.postalCode}";
      });
    } catch (e) {
      setState(() => _currentAddress = "Unknown location");
    }
  }

  Future<void> _saveLocation() async {
    setState(() => _isSaving = true);
    try {
      final userId = await SharedPrefsHelper.getUserId();
      final response = await http.post(
        Uri.parse('http://10.0.2.2:5000/api/user/locations'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'userId': userId,
          'name': _locationName,
          'lat': _currentPosition.latitude,
          'lng': _currentPosition.longitude,
          'address': _currentAddress,
          'isDefault': true
        }),
      );

      if (response.statusCode == 200) {
        if (mounted) Navigator.pop(context, true);
      }
    } catch (e) {
      // Handle error
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text("Add Location", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: Colors.black)),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(icon: const Icon(Icons.arrow_back, color: Colors.black), onPressed: () => Navigator.pop(context)),
      ),
      body: Stack(
        children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(target: _currentPosition, zoom: 15),
            onMapCreated: (controller) => _mapController = controller,
            onCameraMove: (position) => _currentPosition = position.target,
            onCameraIdle: () => _getAddressFromLatLng(_currentPosition),
            myLocationEnabled: true,
            myLocationButtonEnabled: true,
          ),
          const Center(
            child: Icon(Icons.location_on, size: 45, color: primaryOrange),
          ),
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: _buildDetailsPanel(),
          ),
          if (_isSaving)
            const Center(child: CircularProgressIndicator(color: primaryOrange)),
        ],
      ),
    );
  }

  Widget _buildDetailsPanel() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 20)],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Label this location", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18)),
          const SizedBox(height: 16),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _locationTypes.map((type) => _buildTypeChip(type)).toList(),
            ),
          ),
          const SizedBox(height: 24),
          Text("Address", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.grey)),
          const SizedBox(height: 8),
          Text(_currentAddress, style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w500)),
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            height: 55,
            child: ElevatedButton(
              onPressed: _saveLocation,
              style: ElevatedButton.styleFrom(backgroundColor: primaryOrange, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
              child: Text("CONFIRM LOCATION", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTypeChip(String type) {
    bool isSelected = _locationName == type;
    return GestureDetector(
      onTap: () => setState(() => _locationName = type),
      child: Container(
        margin: const EdgeInsets.only(right: 12),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? primaryOrange : Colors.grey[100],
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          type, 
          style: GoogleFonts.inter(
            color: isSelected ? Colors.white : Colors.black, 
            fontWeight: FontWeight.bold
          )
        ),
      ),
    );
  }
}
