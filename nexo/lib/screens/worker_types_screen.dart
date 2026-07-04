import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:nexo/screens/post_job_screen.dart';
import 'package:nexo/services/service_data.dart';
import 'package:nexo/utils/image_utils.dart';

class WorkerTypesScreen extends StatefulWidget {
  final String categoryName;
  final List<String> workerTypes;
  final Color color;

  const WorkerTypesScreen({
    super.key,
    required this.categoryName,
    required this.workerTypes,
    required this.color,
  });

  @override
  State<WorkerTypesScreen> createState() => _WorkerTypesScreenState();
}

class _WorkerTypesScreenState extends State<WorkerTypesScreen> {
  static const Color textPrimary = Color(0xFF1A1A1A);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color bgColor = Color(0xFFF6F7F9);

  int? _selectedIndex;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new, color: textPrimary, size: 20),
          onPressed: () {
            if (_selectedIndex != null) {
              setState(() {
                _selectedIndex = null;
              });
            } else {
              Navigator.pop(context);
            }
          },
        ),
        title: Text(
          _selectedIndex != null ? widget.workerTypes[_selectedIndex!] : widget.categoryName,
          style: GoogleFonts.outfit(
            fontWeight: FontWeight.w700,
            color: textPrimary,
            fontSize: 18,
          ),
        ),
      ),
      body: _selectedIndex != null ? _buildTaskList() : _buildWorkerTypeList(),
    );
  }

  Widget _buildWorkerTypeList() {
    final categoryData = ServiceData.categories.firstWhere(
      (cat) => cat["name"] == widget.categoryName,
      orElse: () => {},
    );

    final subcategories = (categoryData["subcategories"] as List?) ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          color: Colors.white,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "Need a specific worker?",
                style: GoogleFonts.outfit(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                "Select a specialization within ${widget.categoryName} to find the best matched professionals near you.",
                style: GoogleFonts.inter(
                  fontSize: 14,
                  color: textSecondary,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(20),
            itemCount: widget.workerTypes.length,
            itemBuilder: (context, index) {
              final subcat = index < subcategories.length ? subcategories[index] : null;
              final taskCount = subcat != null ? (subcat["tasks"] as List?)?.length ?? 0 : 0;

              return Container(
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.02),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  leading: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: widget.color.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      _getIconForCategory(widget.workerTypes[index]),
                      color: widget.color,
                      size: 24,
                    ),
                  ),
                  title: Text(
                    widget.workerTypes[index],
                    style: GoogleFonts.inter(
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                      color: textPrimary,
                    ),
                  ),
                  subtitle: Text(
                    taskCount > 0 ? "$taskCount tasks available" : "Available professionals: ${10 + index * 2}",
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      color: textSecondary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 16, color: Color(0xFFD1D5DB)),
                  onTap: () {
                    setState(() {
                      _selectedIndex = index;
                    });
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildTaskList() {
    final categoryData = ServiceData.categories.firstWhere(
      (cat) => cat["name"] == widget.categoryName,
      orElse: () => {},
    );

    final subcategories = (categoryData["subcategories"] as List?) ?? [];
    final List<Map<String, dynamic>> taskDataList = [];

    if (_selectedIndex != null && _selectedIndex! < subcategories.length) {
      final subcat = subcategories[_selectedIndex!];
      if (subcat is Map<String, dynamic>) {
        final rawTasks = subcat["tasks"] as List?;
        if (rawTasks != null) {
          for (var task in rawTasks) {
            if (task is Map<String, dynamic>) {
              taskDataList.add(task);
            } else if (task is String) {
              taskDataList.add({"name": task, "image": ""});
            }
          }
        }
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          color: Colors.white,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "Select a task",
                style: GoogleFonts.outfit(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                "Choose a specific task you need help with",
                style: GoogleFonts.inter(
                  fontSize: 14,
                  color: textSecondary,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(20),
            itemCount: taskDataList.length,
            itemBuilder: (context, index) {
              final taskData = taskDataList[index];
              final taskName = taskData["name"] as String? ?? "";
              final taskImage = taskData["image"] as String? ?? "";

              return Container(
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.grey[200]!),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    GestureDetector(
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => PostJobScreen(
                              initialTask: taskName,
                              initialIcon: _getIconForCategory(widget.workerTypes[_selectedIndex!]),
                              initialImage: taskImage,
                            ),
                          ),
                        );
                      },
                      child: ClipRRect(
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                        child: Stack(
                          children: [
                            Container(
                              height: 160,
                              width: double.infinity,
                              color: widget.color.withValues(alpha: 0.1),
                              child: ImageUtils.buildServiceImage(
                                taskImage,
                                taskName: taskName,
                                fit: BoxFit.cover,
                                fallback: Center(
                                  child: Icon(
                                    _getIconForCategory(widget.workerTypes[_selectedIndex!]),
                                    size: 48,
                                    color: widget.color.withValues(alpha: 0.3),
                                    ),
                                  ),
                                ),
                              ),
                            Positioned(
                              top: 12,
                              left: 12,
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.6),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.check_circle, size: 14, color: Colors.white),
                                    const SizedBox(width: 4),
                                    Text(
                                      "Verified",
                                      style: GoogleFonts.inter(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  taskName,
                                  style: GoogleFonts.inter(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 16,
                                    color: textPrimary,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  "Starting from ₹300",
                                  style: GoogleFonts.inter(
                                    fontSize: 13,
                                    color: textSecondary,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          GestureDetector(
                            onTap: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (context) => PostJobScreen(
                                    initialTask: taskName,
                                    initialIcon: _getIconForCategory(widget.workerTypes[_selectedIndex!]),
                                    initialImage: taskImage,
                                  ),
                                ),
                              );
                            },
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                              decoration: BoxDecoration(
                                color: widget.color,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                "HIRE",
                                style: GoogleFonts.inter(
                                  fontWeight: FontWeight.w800,
                                  fontSize: 12,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  IconData _getIconForCategory(String category) {
    final icons = {
      "Equipment & Machine Rental": Icons.agriculture,
      "Field Work & Labor": Icons.grass,
      "Irrigation & Water": Icons.water_drop,
      "Animal & Farm Support": Icons.pets,
      "Core Work": Icons.foundation,
      "Helpers": Icons.support_agent,
      "Finishing Work": Icons.format_paint,
      "Specialized": Icons.construction,
      "Electrical": Icons.electrical_services,
      "Plumbing": Icons.plumbing,
      "Appliance Repair": Icons.kitchen,
      "Cleaning": Icons.cleaning_services,
      "Vehicles": Icons.local_shipping,
      "Moving": Icons.move_to_inbox,
      "Support": Icons.groups,
      "Drivers": Icons.drive_eta,
      "Vehicle Repair": Icons.two_wheeler,
      "General Repair": Icons.build,
      "Care & Help": Icons.face,
      "Business Help": Icons.storefront,
      "Errands": Icons.local_shipping_outlined,
      "Event Staff": Icons.celebration,
      "Trades": Icons.handyman,
      "Installation": Icons.settings_suggest,
    };
    return icons[category] ?? Icons.person;
  }
}
