import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:nexo/services/location_service.dart';
import 'package:nexo/services/service_data.dart';
import 'package:nexo/utils/image_utils.dart';
import 'package:nexo/utils/recommendation_utils.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:nexo/services/shared_prefs_helper.dart';
import 'package:nexo/utils/network_helper.dart';
import 'package:nexo/screens/searching_workers_screen.dart';
import 'package:nexo/screens/map_location_picker_screen.dart';
import 'package:nexo/components/glass_components.dart';

class PostJobScreen extends StatefulWidget {
  final String? initialTask;
  final String? initialImage;
  final dynamic initialIcon;

  const PostJobScreen({super.key, this.initialTask, this.initialImage, this.initialIcon});

  @override
  State<PostJobScreen> createState() => _PostJobScreenState();
}

class _PostJobScreenState extends State<PostJobScreen> {
  static const Color primaryOrange = Color(0xFFFF6A00);
  int _currentWizardStep = 0; // 0: Create Job Request, 1: Review & Confirm, 2: Preference & Send
  String? _selectedCategory;
  String? _selectedTaskId;
  String? _selectedImage;
  dynamic _selectedIcon;
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _budgetController = TextEditingController(text: "500");
  final TextEditingController _flexibleUptoController = TextEditingController();
  bool _allowMessage = true;
  bool _showPopularGrid = true;
  String _location = "Fetching location...";
  bool _isUrgent = true;
  bool _onlyVerified = true;
  bool _topRatedPreferred = false;
  bool _isFlexible = false;
  String _workDuration = "2-4 Hours";
  String? _selectedDate;
  String? _selectedTime;
  double? _lat;
  double? _lng;
  StreamSubscription? _locationSubscription;
  final String baseUrl = NetworkHelper.baseUrl;
  
  // Removed local _categories list as it's now in ServiceData

  @override
  void initState() {
    super.initState();
    _selectedCategory = widget.initialTask;
    _selectedImage = widget.initialImage;
    _selectedIcon = widget.initialIcon;
    
    if (_selectedCategory != null) {
      _showPopularGrid = false;
      if (_selectedIcon == null) {
        _resolveInitialTask(_selectedCategory);
      }
    }
    
    _descriptionController.addListener(() {
      if (mounted) setState(() {});
    });
    _loadLocation();
    _startLocationUpdates();
  }

  void _resolveInitialTask(String? taskName) {
    if (taskName == null || taskName.isEmpty) return;
    for (var cat in ServiceData.categories) {
      if (cat['name'].toString().toLowerCase() == taskName.toLowerCase()) {
        setState(() {
          _selectedCategory = cat['name'];
          _selectedIcon = cat['icon'];
          _selectedImage = cat['image'];
          _showPopularGrid = false;
        });
        return;
      }
      if (cat['subcategories'] != null) {
        for (var sub in cat['subcategories']) {
          if (sub['name'].toString().toLowerCase() == taskName.toLowerCase()) {
            setState(() {
              _selectedCategory = sub['name'];
              _selectedIcon = cat['icon'];
              _selectedImage = sub['image'];
              _showPopularGrid = false;
            });
            return;
          }
          if (sub['tasks'] != null) {
            for (var task in sub['tasks']) {
              if (task['name'].toString().toLowerCase() == taskName.toLowerCase()) {
                setState(() {
                  _selectedCategory = task['name'];
                  _selectedTaskId = task['id'];
                  _selectedIcon = cat['icon'];
                  _selectedImage = task['image'];
                  _showPopularGrid = false;
                });
                return;
              }
            }
          }
        }
      }
    }
  }

  void _startLocationUpdates() {
    _locationSubscription = LocationService.getLocationStream().listen((res) {
      if (mounted) {
        setState(() {
          _location = res['address'];
          _lat = res['lat'];
          _lng = res['lng'];
        });
      }
    });
  }

  @override
  void dispose() {
    _locationSubscription?.cancel();
    super.dispose();
  }

  Future<void> _loadLocation() async {
    try {
      final res = await LocationService.getCurrentLocation();
      if (mounted) {
        setState(() {
          _location = res['address'];
          _lat = res['lat'];
          _lng = res['lng'];
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _location = "Location unavailable";
        });
      }
    }
  }

  Future<void> _requestWorkers() async {
    if (_selectedCategory == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Please select a category first")));
      return;
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator(color: Color(0xFFFF6A00))),
    );

    try {
        final userId = await SharedPrefsHelper.getUserId();
        final token = await SharedPrefsHelper.getToken();
        print("Requesting workers for userId: $userId");
        if (userId == null) {
          Navigator.pop(context); // Close loading
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("User session expired. Please log in again.")));
          return;
        }

        final response = await http.post(
          Uri.parse('$baseUrl/api/jobs/create'),
          headers: {
            'Content-Type': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
          body: json.encode({
            'userId': userId,
            'serviceType': _selectedCategory,
            'taskId': _selectedTaskId,
            'description': _descriptionController.text.isNotEmpty 
                ? _descriptionController.text 
                : "Request for $_selectedCategory",
            'lat': _lat ?? 13.1415,
            'lng': _lng ?? 78.1449,
            'price': (double.tryParse(_budgetController.text) ?? 500.0).toInt(),
          }),
        );

      Navigator.pop(context); // Close loading

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final job = data['job'];
        
        // Navigate to Searching Screen
        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (context) => SearchingWorkersScreen(
                job: {
                  'id': job['id'],
                  'category': job['category'],
                  'userId': userId,
                  'createdAt': job['created_at'],
                },
              ),
            ),
          );
        }
      } else {
        final errorData = json.decode(response.body);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Failed: ${errorData['error'] ?? 'Unknown error'}")));
      }
    } catch (e) {
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Matching failed: $e")));
    }
  }

  void _showCategorySelection() {
    int modalStep = 0; // 0: Category, 1: Subcategory, 2: Task
    Map<String, dynamic>? currentCat;
    Map<String, dynamic>? currentSub;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(25))),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            String title = "Select Service";
            if (modalStep == 1) title = currentCat!['name'];
            if (modalStep == 2) title = currentSub!['name'];

            List items = [];
            if (modalStep == 0) items = ServiceData.categories;
            if (modalStep == 1) items = currentCat!['subcategories'];
            if (modalStep == 2) items = currentSub!['tasks'];

            return DraggableScrollableSheet(
              initialChildSize: 0.7,
              minChildSize: 0.5,
              maxChildSize: 0.95,
              expand: false,
              builder: (context, scrollController) {
                return Column(
                  children: [
                    const SizedBox(height: 12),
                    Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2))),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      child: Row(
                        children: [
                          if (modalStep > 0)
                            IconButton(
                              icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
                              onPressed: () => setModalState(() => modalStep--),
                            ),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Text(title, style: GoogleFonts.outfit(fontSize: 18, fontWeight: FontWeight.bold)),
                            ),
                          ),
                          if (modalStep == 0)
                            IconButton(icon: const Icon(Icons.search), onPressed: () {}),
                        ],
                      ),
                    ),
                    Expanded(
                      child: ListView.separated(
                        controller: scrollController,
                        itemCount: items.length,
                        separatorBuilder: (context, index) => Divider(height: 1, color: Colors.grey[100], indent: 80),
                        itemBuilder: (context, index) {
                          final item = items[index];
                          
                          if (modalStep == 0) {
                            return ListTile(
                              leading: SizedBox(
                                width: 50,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(10),
                                  child: ImageUtils.buildServiceImage(
                                    item['image'],
                                    taskName: item['name'],
                                    width: 50,
                                    height: 50,
                                    fit: BoxFit.cover,
                                    fallback: Container(
                                      width: 50, height: 50, color: Colors.grey[100],
                                      child: (item['icon'] is IconData && item['icon'] is! FaIconData)
                                          ? Icon(item['icon'], size: 20, color: Colors.grey)
                                          : FaIcon(item['icon'], size: 20, color: Colors.grey),
                                    ),
                                  ),
                                ),
                              ),
                              title: Text(item['name'], style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
                              trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Colors.grey),
                              onTap: () => setModalState(() {
                                currentCat = item;
                                modalStep = 1;
                              }),
                            );
                          } else if (modalStep == 1) {
                            return ListTile(
                              leading: SizedBox(
                                width: 50,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(10),
                                  child: ImageUtils.buildServiceImage(
                                    item['image'],
                                    taskName: item['name'],
                                    width: 50,
                                    height: 50,
                                    fit: BoxFit.cover,
                                    fallback: Container(
                                      width: 50, height: 50, color: Colors.grey[100],
                                      child: const Icon(Icons.category, size: 20, color: Colors.grey),
                                    ),
                                  ),
                                ),
                              ),
                              title: Text(item['name'], style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
                              trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Colors.grey),
                              onTap: () => setModalState(() {
                                currentSub = item;
                                modalStep = 2;
                              }),
                            );
                          } else {
                            final String taskName = item is Map ? (item['name'] ?? "") : item.toString();
                            final String taskImage = item is Map ? (item['image'] ?? "") : "";

                            return ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 4),
                              title: Text(taskName, style: GoogleFonts.inter(fontWeight: FontWeight.w500)),
                              onTap: () {
                                setState(() {
                                  _selectedCategory = taskName;
                                  _selectedTaskId = item is Map ? item['id'] : null;
                                  _selectedImage = taskImage.isNotEmpty ? taskImage : currentCat!['image'];
                                  _selectedIcon = currentCat!['icon'];
                                  _showPopularGrid = false;
                                  _descriptionController.clear();
                                });
                                Navigator.pop(context);
                              },
                            );
                          }
                        },
                      ),
                    ),
                  ],
                );
              },
            );
          },
        );
      },
    );
  }

  final List<Map<String, dynamic>> _popularCategories = [
    {'name': 'Home Repair', 'icon': Icons.home_repair_service_rounded, 'color': const Color(0xFFFF6A00)},
    {'name': 'Cleaning', 'icon': Icons.cleaning_services_rounded, 'color': const Color(0xFF2563EB)},
    {'name': 'Plumbing', 'icon': Icons.water_drop_rounded, 'color': const Color(0xFF10B981)},
    {'name': 'Electrical', 'icon': Icons.bolt_rounded, 'color': const Color(0xFFF59E0B)},
    {'name': 'Painting', 'icon': Icons.format_paint_rounded, 'color': const Color(0xFF8B5CF6)},
    {'name': 'Carpentry', 'icon': Icons.handyman_rounded, 'color': const Color(0xFFB45309)},
    {'name': 'Appliance Repair', 'icon': Icons.settings_suggest_rounded, 'color': const Color(0xFF0D9488)},
    {'name': 'Moving & Transport', 'icon': Icons.local_shipping_rounded, 'color': const Color(0xFF059669)},
    {'name': 'More', 'icon': Icons.more_horiz_rounded, 'color': const Color(0xFF64748B)},
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        leading: Padding(
          padding: const EdgeInsets.all(8.0),
          child: Container(
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: IconButton(
              icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF0F172A), size: 18),
              onPressed: () {
                if (_currentWizardStep > 0) {
                  setState(() => _currentWizardStep--);
                } else {
                  Navigator.pop(context);
                }
              },
            ),
          ),
        ),
        title: _buildStepIndicator(),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStepHeader(),
              const SizedBox(height: 24),
              if (_currentWizardStep == 0) _buildStep1Form(),
              if (_currentWizardStep == 1) _buildStep2Review(),
              if (_currentWizardStep == 2) _buildStep3Request(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStepIndicator() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildStepCircle(1, _currentWizardStep >= 0),
        _buildStepLine(_currentWizardStep >= 1),
        _buildStepCircle(2, _currentWizardStep >= 1),
        _buildStepLine(_currentWizardStep >= 2),
        _buildStepCircle(3, _currentWizardStep >= 2),
      ],
    );
  }

  Widget _buildStepCircle(int step, bool isActive) {
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        color: isActive ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          step.toString(),
          style: GoogleFonts.outfit(
            color: isActive ? Colors.white : const Color(0xFF94A3B8),
            fontWeight: FontWeight.bold,
            fontSize: 11,
          ),
        ),
      ),
    );
  }

  Widget _buildStepLine(bool isActive) {
    return Container(
      width: 32,
      height: 2,
      color: isActive ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
    );
  }

  Widget _buildStepHeader() {
    String title = "";
    String subtitle = "";
    if (_currentWizardStep == 0) {
      title = "What do you need help with?";
      subtitle = "Select a category and describe your work";
    } else if (_currentWizardStep == 1) {
      title = "Review your request";
      subtitle = "Please confirm the details below";
    } else {
      title = "Almost there!";
      subtitle = "We'll notify the best workers near you";
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: GoogleFonts.outfit(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: const Color(0xFF0F172A),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: GoogleFonts.inter(
            fontSize: 13,
            color: const Color(0xFF64748B),
          ),
        ),
      ],
    );
  }

  // ==========================================
  // STEP 1 WIDGETS
  // ==========================================

  Widget _buildStep1Form() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSearchBar(),
        const SizedBox(height: 12),
        _buildSelectedCategoryDisplay(),
        const SizedBox(height: 12),
        
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              "POPULAR CATEGORIES",
              style: GoogleFonts.inter(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF94A3B8),
                letterSpacing: 1.0,
              ),
            ),
            GestureDetector(
              onTap: () {
                setState(() {
                  _showPopularGrid = !_showPopularGrid;
                });
              },
              child: Row(
                children: [
                  Text(
                    _showPopularGrid ? "Minimise" : "Maximise",
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFFFF6A00),
                    ),
                  ),
                  Icon(
                    _showPopularGrid ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                    color: const Color(0xFFFF6A00),
                    size: 14,
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (_showPopularGrid) ...[
          _buildCategoryGrid(),
          const SizedBox(height: 24),
        ],

        Text(
          "Describe your work",
          style: GoogleFonts.outfit(
            fontSize: 14,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF0F172A),
          ),
        ),
        const SizedBox(height: 8),
        _buildDescriptionFieldRedesigned(),
        const SizedBox(height: 24),

        Text(
          "Location",
          style: GoogleFonts.outfit(
            fontSize: 14,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF0F172A),
          ),
        ),
        const SizedBox(height: 8),
        _buildLocationCardRedesigned(),
        const SizedBox(height: 28),

        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: () {
              if (_selectedCategory == null) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text("Please select a category first")),
                );
                return;
              }
              setState(() => _currentWizardStep = 1);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6A00),
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  "Continue",
                  style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _buildSelectedCategoryDisplay() {
    if (_selectedCategory == null) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFED7AA), width: 1.2),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: const Color(0xFFFF6A00).withOpacity(0.12),
              shape: BoxShape.circle,
            ),
            child: _buildSelectedIcon(size: 16),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Selected Category",
                  style: GoogleFonts.inter(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFFEA580C),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _selectedCategory!,
                  style: GoogleFonts.outfit(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF0F172A),
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: _showCategorySelection,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              backgroundColor: const Color(0xFFFF6A00).withOpacity(0.1),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: Text(
              "Change",
              style: GoogleFonts.inter(
                color: const Color(0xFFFF6A00),
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      child: TextField(
        readOnly: true,
        onTap: _showCategorySelection,
        decoration: InputDecoration(
          hintText: "Search category",
          hintStyle: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 14),
          border: InputBorder.none,
          suffixIcon: const Icon(Icons.search, color: Color(0xFF94A3B8)),
        ),
      ),
    );
  }

  Widget _buildCategoryGrid() {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 1.05,
      ),
      itemCount: _popularCategories.length,
      itemBuilder: (context, index) {
        final cat = _popularCategories[index];
        final isSelected = _selectedCategory == cat['name'];
        return GestureDetector(
          onTap: () {
            if (cat['name'] == 'More') {
              _showCategorySelection();
            } else {
              setState(() {
                _selectedCategory = cat['name'];
                _selectedIcon = cat['icon'];
                _selectedImage = null;
                _showPopularGrid = false;
              });
            }
          },
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
                    width: isSelected ? 2 : 1.5,
                  ),
                  boxShadow: isSelected ? [
                    BoxShadow(
                      color: const Color(0xFFFF6A00).withOpacity(0.08),
                      blurRadius: 8,
                      offset: const Offset(0, 4),
                    )
                  ] : null,
                ),
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: (cat['color'] as Color).withOpacity(0.1),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(cat['icon'] as IconData, color: cat['color'] as Color, size: 20),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        cat['name'] as String,
                        style: GoogleFonts.outfit(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0F172A),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (isSelected)
                Positioned(
                  top: -4,
                  right: -4,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: const BoxDecoration(
                      color: Color(0xFFFF6A00),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.check, color: Colors.white, size: 10),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildDescriptionFieldRedesigned() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _descriptionController,
            maxLines: 2,
            maxLength: 200,
            style: GoogleFonts.inter(
              color: const Color(0xFF0F172A),
              fontSize: 14,
            ),
            decoration: InputDecoration(
              hintText: "Briefly describe what you need help with...",
              hintStyle: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 13),
              border: InputBorder.none,
              counterText: "",
            ),
          ),
          _buildSuggestions(),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.bottomRight,
            child: Text(
              "${_descriptionController.text.length}/200",
              style: GoogleFonts.inter(
                color: const Color(0xFF94A3B8),
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLocationCardRedesigned() {
    return Column(
      children: [
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              const Icon(Icons.location_on_rounded, color: Color(0xFFFF6A00), size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: GestureDetector(
                  onTap: _showCustomLocationDialog,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Work Location",
                        style: GoogleFonts.outfit(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                          color: const Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _location,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          color: const Color(0xFF64748B),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: const Icon(Icons.edit_location_alt_rounded, color: Color(0xFFFF6A00), size: 20),
                onPressed: _showCustomLocationDialog,
              ),
              const SizedBox(width: 8),
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: const Icon(Icons.gps_fixed_rounded, color: Color(0xFFFF6A00), size: 20),
                onPressed: _loadLocation,
              )
            ],
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF7ED),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFFED7AA)),
          ),
          child: Row(
            children: [
              const Icon(Icons.verified_user_outlined, color: Color(0xFFEA580C), size: 14),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  "Your exact location helps us find nearby workers",
                  style: GoogleFonts.inter(
                    color: const Color(0xFFEA580C),
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ==========================================
  // STEP 2 WIDGETS
  // ==========================================

  Widget _buildStep2Review() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Category Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF7ED),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFFF6A00).withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(_selectedIcon is IconData ? _selectedIcon : Icons.work_outline_rounded, color: const Color(0xFFFF6A00), size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("Category", style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFFEA580C), fontWeight: FontWeight.bold)),
                    const SizedBox(height: 2),
                    Text(_selectedCategory ?? "Home Repair", style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: const Color(0xFF0F172A))),
                  ],
                ),
              ),
              TextButton(
                onPressed: _showCategorySelection,
                child: Text("Change", style: GoogleFonts.inter(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Description Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text("Your Description", style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF64748B), fontWeight: FontWeight.bold)),
                  GestureDetector(
                    onTap: () => setState(() => _currentWizardStep = 0),
                    child: Text("Edit", style: GoogleFonts.inter(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold, fontSize: 13)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                _descriptionController.text.isNotEmpty ? _descriptionController.text : "No description provided.",
                style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF334155), height: 1.45),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Location Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
          ),
          child: Row(
            children: [
              const Icon(Icons.location_on_rounded, color: Color(0xFFFF6A00), size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("Location", style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B), fontWeight: FontWeight.bold)),
                    const SizedBox(height: 2),
                    Text(_location, maxLines: 1, overflow: TextOverflow.ellipsis, style: GoogleFonts.inter(fontSize: 13, color: const Color(0xFF334155), fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
              TextButton(
                onPressed: _showCustomLocationDialog,
                child: Text("Change", style: GoogleFonts.inter(color: const Color(0xFFFF6A00), fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),

        Text(
          "Additional Details (Optional)",
          style: GoogleFonts.outfit(
            fontSize: 14,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF0F172A),
          ),
        ),
        Text(
          "Help us match you better (You can skip)",
          style: GoogleFonts.inter(
            fontSize: 12,
            color: const Color(0xFF64748B),
          ),
        ),
        const SizedBox(height: 16),

        Text(
          "When do you need the service?",
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF64748B),
          ),
        ),
        const SizedBox(height: 8),
        _buildTimingSelectorRedesigned(),
        const SizedBox(height: 20),

        Text(
          "Estimated Budget (Optional)",
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF64748B),
          ),
        ),
        Text(
          "You can adjust later",
          style: GoogleFonts.inter(
            fontSize: 10,
            color: const Color(0xFF94A3B8),
          ),
        ),
        const SizedBox(height: 8),
        _buildBudgetPills(),
        const SizedBox(height: 20),

        Text(
          "Expected Duration (Optional)",
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF64748B),
          ),
        ),
        Text(
          "Helps us match the right professional",
          style: GoogleFonts.inter(
            fontSize: 10,
            color: const Color(0xFF94A3B8),
          ),
        ),
        const SizedBox(height: 8),
        _buildDurationPills(),
        const SizedBox(height: 32),

        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: () {
              setState(() => _currentWizardStep = 2);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6A00),
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  "Continue",
                  style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _buildTimingSelectorRedesigned() {
    return Row(
      children: [
        Expanded(
          child: GestureDetector(
            onTap: () => setState(() => _isUrgent = true),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                color: _isUrgent ? const Color(0xFFFFF7ED) : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _isUrgent ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
                  width: 1.5,
                ),
              ),
              child: Column(
                children: [
                  const Icon(Icons.bolt_rounded, color: Color(0xFFFF6A00), size: 20),
                  const SizedBox(height: 4),
                  Text("ASAP", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 12, color: _isUrgent ? const Color(0xFFFF6A00) : const Color(0xFF0F172A))),
                  Text("(Urgent)", style: GoogleFonts.inter(fontSize: 10, color: _isUrgent ? const Color(0xFFFF6A00) : const Color(0xFF64748B))),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: GestureDetector(
            onTap: () {
              setState(() => _isUrgent = false);
              _showScheduleModal();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                color: !_isUrgent ? const Color(0xFFFFF7ED) : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: !_isUrgent ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
                  width: 1.5,
                ),
              ),
              child: Column(
                children: [
                  const Icon(Icons.calendar_month_rounded, color: Color(0xFFFF6A00), size: 20),
                  const SizedBox(height: 4),
                  Text("Schedule", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 12, color: !_isUrgent ? const Color(0xFFFF6A00) : const Color(0xFF0F172A))),
                  Text((!_isUrgent && _selectedDate != null) ? "${_selectedDate} ${_selectedTime ?? ''}" : "(Later)", style: GoogleFonts.inter(fontSize: 10, color: !_isUrgent ? const Color(0xFFFF6A00) : const Color(0xFF64748B))),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildBudgetPills() {
    final budgets = [300, 500, 1000];
    final currentBudgetVal = int.tryParse(_budgetController.text) ?? 0;
    bool isOtherSelected = !budgets.contains(currentBudgetVal) && _budgetController.text.isNotEmpty;
    
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        ...budgets.map((amt) {
          final isSelected = currentBudgetVal == amt && !isOtherSelected;
          return Expanded(
            child: GestureDetector(
              onTap: () {
                setState(() {
                  _budgetController.text = amt.toString();
                });
              },
              child: Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: isSelected ? const Color(0xFFFFF7ED) : Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
                    width: 1.5,
                  ),
                ),
                child: Center(
                  child: Text(
                    "₹$amt",
                    style: GoogleFonts.inter(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFF64748B),
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
        Expanded(
          child: GestureDetector(
            onTap: _showCustomBudgetSheet,
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: isOtherSelected ? const Color(0xFFFFF7ED) : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isOtherSelected ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
                  width: 1.5,
                ),
              ),
              child: Center(
                child: Text(
                  isOtherSelected ? "₹${_budgetController.text}" : "Other",
                  style: GoogleFonts.inter(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: isOtherSelected ? const Color(0xFFFF6A00) : const Color(0xFF64748B),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  void _showCustomBudgetSheet() {
    final controller = TextEditingController(text: _budgetController.text);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2))),
              ),
              const SizedBox(height: 20),
              Text(
                "Set Custom Budget",
                style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 18, color: const Color(0xFF0F172A)),
              ),
              const SizedBox(height: 4),
              Text(
                "Enter the hourly rate you want to pay.",
                style: GoogleFonts.inter(fontSize: 12, color: const Color(0xFF64748B)),
              ),
              const SizedBox(height: 20),
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: TextField(
                  controller: controller,
                  keyboardType: TextInputType.number,
                  autofocus: true,
                  style: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00)),
                  decoration: InputDecoration(
                    prefixText: "₹ ",
                    prefixStyle: GoogleFonts.outfit(fontSize: 22, fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00)),
                    border: InputBorder.none,
                    hintText: "0",
                  ),
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF6A00),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(25)),
                    elevation: 0,
                  ),
                  onPressed: () {
                    setState(() {
                      _budgetController.text = controller.text;
                    });
                    Navigator.pop(context);
                  },
                  child: Text("Confirm Budget", style: GoogleFonts.inter(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 15)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDurationPills() {
    final durations = ["< 2 Hrs", "2-4 Hrs", "4-8 Hrs", "Full Day"];
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: durations.map((dur) {
        final isSelected = _workDuration == dur;
        return Expanded(
          child: GestureDetector(
            onTap: () {
              setState(() {
                _workDuration = dur;
              });
            },
            child: Container(
              margin: const EdgeInsets.only(right: 6),
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: isSelected ? const Color(0xFFFFF7ED) : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFFE2E8F0),
                  width: 1.5,
                ),
              ),
              child: Center(
                child: Text(
                  dur,
                  style: GoogleFonts.inter(
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                    color: isSelected ? const Color(0xFFFF6A00) : const Color(0xFF64748B),
                  ),
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  // ==========================================
  // STEP 3 WIDGETS
  // ==========================================

  Widget _buildStep3Request() {
    return Column(
      children: [
        _buildIllustration(),
        const SizedBox(height: 24),
        _buildStep3Toggles(),
        const SizedBox(height: 20),
        _buildSafetyBox(),
        const SizedBox(height: 36),
        _buildStep3RequestButton(),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _buildIllustration() {
    return Container(
      height: 160,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Positioned(
            child: Container(
              width: 140,
              height: 140,
              decoration: BoxDecoration(
                color: const Color(0xFFFF6A00).withOpacity(0.04),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            child: Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                color: const Color(0xFFFF6A00).withOpacity(0.08),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            child: Container(
              width: 80,
              height: 80,
              decoration: const BoxDecoration(
                color: Color(0xFFFFE5D9),
                shape: BoxShape.circle,
              ),
              child: const Center(
                child: Icon(Icons.person_pin_rounded, color: Color(0xFFFF6A00), size: 48),
              ),
            ),
          ),
          Positioned(
            top: 25,
            right: MediaQuery.of(context).size.width * 0.28,
            child: Container(
              padding: const EdgeInsets.all(6),
              decoration: const BoxDecoration(
                color: Color(0xFFDCFCE7),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.verified_user_rounded, color: Color(0xFF16A34A), size: 22),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStep3Toggles() {
    return Column(
      children: [
        _buildStep3ToggleItem(
          icon: Icons.shield_rounded,
          iconColor: const Color(0xFF10B981),
          bgColor: const Color(0xFFECFDF5),
          title: "Verified Professionals Only",
          desc: "We'll match you with verified and trusted workers",
          value: _onlyVerified,
          onChanged: (v) => setState(() => _onlyVerified = v),
        ),
        const SizedBox(height: 12),
        _buildStep3ToggleItem(
          icon: Icons.star_rounded,
          iconColor: const Color(0xFFF59E0B),
          bgColor: const Color(0xFFFEF3C7),
          title: "Top Rated Workers",
          desc: "Prefer top-rated and highly recommended workers",
          value: _topRatedPreferred,
          onChanged: (v) => setState(() => _topRatedPreferred = v),
        ),
        const SizedBox(height: 12),
        _buildStep3ToggleItem(
          icon: Icons.message_rounded,
          iconColor: const Color(0xFF8B5CF6),
          bgColor: const Color(0xFFF5F3FF),
          title: "Allow Workers to Message",
          desc: "Workers can message you for better understanding",
          value: _allowMessage,
          onChanged: (v) => setState(() => _allowMessage = v),
        ),
      ],
    );
  }

  Widget _buildStep3ToggleItem({
    required IconData icon,
    required Color iconColor,
    required Color bgColor,
    required String title,
    required String desc,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: bgColor, shape: BoxShape.circle),
            child: Icon(icon, color: iconColor, size: 18),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF0F172A))),
                const SizedBox(height: 2),
                Text(desc, style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF64748B))),
              ],
            ),
          ),
          Switch(
            value: value,
            activeColor: const Color(0xFFFF6A00),
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }

  Widget _buildSafetyBox() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F3FF),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFDDD6FE)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: const BoxDecoration(color: Color(0xFFEDE9FE), shape: BoxShape.circle),
            child: const Icon(Icons.health_and_safety_rounded, color: Color(0xFF7C3AED), size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Your Safety is Our Priority",
                  style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 13, color: const Color(0xFF5B21B6)),
                ),
                const SizedBox(height: 4),
                Text(
                  "All workers are background verified and your payments are 100% secure.",
                  style: GoogleFonts.inter(fontSize: 11.5, color: const Color(0xFF6D28D9), height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStep3RequestButton() {
    return Column(
      children: [
        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: _requestWorkers,
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6A00),
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  "Request Workers",
                  style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.lock_outline_rounded, color: Color(0xFF94A3B8), size: 14),
            const SizedBox(width: 6),
            Text(
              "You can review and confirm before anyone accepts",
              style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF94A3B8)),
            ),
          ],
        )
      ],
    );
  }

  Future<void> _showScheduleModal() async {
    final DateTime? pickedDate = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 30)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.dark(
              primary: Color(0xFFFF6A00),
              onPrimary: Colors.white,
              surface: Color(0xFF1E293B),
              onSurface: Colors.white,
            ),
          ),
          child: child!,
        );
      },
    );

    if (pickedDate != null && mounted) {
      final TimeOfDay? pickedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.now(),
        builder: (context, child) {
          return Theme(
            data: Theme.of(context).copyWith(
              colorScheme: const ColorScheme.dark(
                primary: Color(0xFFFF6A00),
                onPrimary: Colors.white,
                surface: Color(0xFF1E293B),
                onSurface: Colors.white,
              ),
            ),
            child: child!,
          );
        },
      );

      if (pickedTime != null && mounted) {
        setState(() {
          _selectedDate = "${pickedDate.day}/${pickedDate.month}/${pickedDate.year}";
          _selectedTime = pickedTime.format(context);
        });
      }
    }
  }

  Widget _buildSelectedIcon({double size = 24}) {
    if (_selectedIcon == null) {
      return Icon(Icons.work_outline_rounded, size: size, color: const Color(0xFFFF6A00));
    }
    if (_selectedIcon is IconData && _selectedIcon is! FaIconData) {
      return Icon(_selectedIcon, size: size, color: const Color(0xFFFF6A00));
    }
    return FaIcon(_selectedIcon, size: size, color: const Color(0xFFFF6A00));
  }

  Widget _buildSuggestions() {
    if (_selectedCategory == null) return const SizedBox.shrink();
    final suggestions = RecommendationUtils.getSuggestions(_selectedCategory!);
    if (suggestions.isEmpty) return const SizedBox.shrink();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: suggestions.map((s) => Padding(
          padding: const EdgeInsets.only(right: 8),
          child: ActionChip(
            label: Text(s),
            backgroundColor: isDark ? Colors.indigo.withOpacity(0.15) : Colors.blue.withOpacity(0.05),
            labelStyle: GoogleFonts.inter(
              color: isDark ? const Color(0xFF818CF8) : Colors.blue[800],
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            onPressed: () {
              setState(() {
                _descriptionController.text = s;
              });
            },
          ),
        )).toList(),
      ),
    );
  }

  Future<void> _showCustomLocationDialog() async {
    final result = await Navigator.push<String>(
      context,
      MaterialPageRoute(
        builder: (context) => const MapLocationPickerScreen(),
      ),
    );
    if (result != null && result.isNotEmpty && mounted) {
      setState(() => _location = result);
    }
  }
}
