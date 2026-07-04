import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:io';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nexo_partner/utils/network_helper.dart';
import 'package:nexo_partner/utils/skill_data.dart';
import 'package:http_parser/http_parser.dart';
import '../home/home_screen.dart';
import '../auth/login_screen.dart';

class ProfileSetupScreen extends StatefulWidget {
  final String phoneNumber;
  final bool isEdit;
  const ProfileSetupScreen({super.key, required this.phoneNumber, this.isEdit = false});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final TextEditingController _nameController = TextEditingController();
  
  @override
  void initState() {
    super.initState();
    _fetchExistingProfile();
  }

  Future<void> _fetchExistingProfile() async {
    setState(() => _isLoading = true);
    try {
      final response = await http.get(Uri.parse('$baseUrl/api/worker/profile/details/${widget.phoneNumber}'));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] && data['worker'] != null) {
          final worker = data['worker'];
          setState(() {
            _nameController.text = worker['name'] ?? '';
            _selectedState = worker['state'];
            _selectedExperience = worker['experience'];
            _workRadius = (worker['workRadius'] ?? 15).toDouble();
            _uploadedPhotoUrl = worker['photoUrl'];
            _uploadedIdUrl = worker['idUrl'];
            if (worker['skills'] != null) {
              _selectedSkills.clear();
              _selectedSkills.addAll(List<String>.from(worker['skills']));
            }
            if (worker['tasks'] != null) {
              _selectedTasks.clear();
              _selectedTasks.addAll(List<String>.from(worker['tasks']));
            }
            if (worker['languages'] != null) {
              _selectedLanguages.clear();
              _selectedLanguages.addAll(List<String>.from(worker['languages']));
            }
          });
        }
      }
    } catch (e) {
      debugPrint("Error fetching profile setup info: $e");
    } finally {
      setState(() => _isLoading = false);
    }
  }
  final List<String> _availableSkills = SkillData.skillToTasks.keys.toList();
  final List<String> _selectedSkills = [];
  final List<String> _selectedTasks = [];
  final List<String> _languages = ["English", "Hindi", "Kannada", "Telugu", "Tamil", "Malayalam", "Marathi"];
  final List<String> _selectedLanguages = [];
  
  final List<String> _states = ["Karnataka", "Andhra Pradesh", "Telangana", "Maharashtra", "Delhi", "Other"];
  String? _selectedState;
  String? _selectedExperience;
  double _workRadius = 15;
  bool _isLoading = false;
  final String baseUrl = NetworkHelper.baseUrl;

  File? _image;
  String? _uploadedPhotoUrl;
  File? _idImage;
  String? _uploadedIdUrl;
  final ImagePicker _picker = ImagePicker();

  Future<void> _pickImage({bool isId = false}) async {
    final XFile? pickedFile = await _picker.pickImage(source: ImageSource.gallery);
    if (pickedFile != null) {
      setState(() {
        if (isId) _idImage = File(pickedFile.path);
        else _image = File(pickedFile.path);
      });
      await _uploadPhoto(isId: isId);
    }
  }

  Future<void> _uploadPhoto({bool isId = false}) async {
    final fileToUpload = isId ? _idImage : _image;
    if (fileToUpload == null) return;
    
    try {
      var request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/user/upload-photo'));
      request.files.add(await http.MultipartFile.fromPath(
        'photo',
        fileToUpload.path,
        contentType: MediaType('image', 'jpeg'),
      ));
      
      var response = await request.send();
      var responseData = await response.stream.bytesToString();
      var data = json.decode(responseData);
      
      if (data['success']) {
        setState(() {
          if (isId) _uploadedIdUrl = data['photoUrl'];
          else _uploadedPhotoUrl = data['photoUrl'];
        });
        debugPrint(isId ? "ID Uploaded: $_uploadedIdUrl" : "Photo Uploaded: $_uploadedPhotoUrl");
      }
    } catch (e) {
      debugPrint("Upload Error: $e");
    }
  }

  List<String> _getRecommendedLanguages() {
    if (_selectedState == "Karnataka") return ["Kannada", "English"];
    if (_selectedState == "Andhra Pradesh" || _selectedState == "Telangana") return ["Telugu", "English"];
    if (_selectedState == "Maharashtra") return ["Marathi", "Hindi", "English"];
    if (_selectedState == "Delhi") return ["Hindi", "English"];
    return ["English"];
  }

  Future<void> _submitProfile() async {
    if (_nameController.text.isEmpty || _selectedSkills.isEmpty || _selectedExperience == null || _selectedState == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Please fill all required fields")));
      return;
    }

    setState(() => _isLoading = true);
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/worker/profile/setup'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'phoneNumber': widget.phoneNumber,
          'name': _nameController.text,
          'skills': _selectedSkills,
          'tasks': _selectedTasks,
          'languages': _selectedLanguages,
          'state': _selectedState,
          'experience': _selectedExperience,
          'workRadius': _workRadius.toInt(),
          'photoUrl': _uploadedPhotoUrl ?? 'https://i.pravatar.cc/150?u=${widget.phoneNumber}',
          'idUrl': _uploadedIdUrl
        }),
      );

      if (response.statusCode == 200) {
        // Success: Navigate to Worker Dashboard
        if (mounted) {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setBool('isProfileComplete', true);
          await prefs.setString('workerName', _nameController.text);
          if (_uploadedPhotoUrl != null) await prefs.setString('workerPhoto', _uploadedPhotoUrl!);
          await prefs.setString('workerPhone', widget.phoneNumber);
          
          Navigator.pushAndRemoveUntil(
            context,
            MaterialPageRoute(builder: (context) => const HomeScreen()),
            (route) => false,
          );
        }
      } else {
        if (mounted) {
          final err = json.decode(response.body);
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Setup Failed: ${err['message']}")));
        }
      }
    } catch (e) {
      debugPrint("Error: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: () async {
        if (widget.isEdit) {
          return true; // pop normally
        }
        final prefs = await SharedPreferences.getInstance();
        await prefs.clear(); // Clear token to allow new login
        if (context.mounted) {
          Navigator.pushAndRemoveUntil(
            context,
            MaterialPageRoute(builder: (context) => const LoginScreen()),
            (route) => false,
          );
        }
        return false;
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFFAF9F6),
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: Color(0xFFFF6A00)),
            onPressed: () {
              Navigator.maybePop(context);
            },
          ),
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text("Complete Your Profile", style: GoogleFonts.outfit(color: const Color(0xFF1F2937), fontWeight: FontWeight.bold, fontSize: 18)),
              Text("Nexo Partner", style: GoogleFonts.inter(color: const Color(0xFFFF6A00), fontSize: 12, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Photo Upload
            Center(
              child: Stack(
                children: [
                  GestureDetector(
                    onTap: _pickImage,
                    child: Container(
                      width: 120,
                      height: 120,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.grey[200],
                        border: Border.all(color: const Color(0xFFFF6A00).withOpacity(0.3), width: 2),
                        image: _image != null 
                          ? DecorationImage(image: FileImage(_image!), fit: BoxFit.cover)
                          : (_uploadedPhotoUrl != null 
                              ? DecorationImage(
                                  image: NetworkImage(_uploadedPhotoUrl!.startsWith('http') 
                                      ? _uploadedPhotoUrl! 
                                      : '$baseUrl$_uploadedPhotoUrl'), 
                                  fit: BoxFit.cover)
                              : const DecorationImage(
                                  image: NetworkImage("https://cdn-icons-png.flaticon.com/512/149/149071.png"),
                                  fit: BoxFit.cover,
                                )),
                      ),
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: GestureDetector(
                      onTap: _pickImage,
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: const BoxDecoration(color: Color(0xFFFF6A00), shape: BoxShape.circle),
                        child: const Icon(Icons.camera_alt_outlined, color: Colors.white, size: 20),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Center(child: Text("Click to Upload Profile Photo", style: TextStyle(color: Colors.black54, fontSize: 12))),
            const SizedBox(height: 32),
            _buildLabel("Full Name"),
            TextField(
              controller: _nameController,
              decoration: _inputDecoration("Enter your full name"),
              style: GoogleFonts.inter(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 24),
            _buildLabel("Select Your Skills"),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: _availableSkills.map((skill) => _buildSkillChip(skill)).toList(),
            ),
            if (_selectedSkills.isNotEmpty) ...[
              const SizedBox(height: 24),
              _buildLabel("Tasks You Can Do (Recommended)"),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: _getRecommendedTasks().map((task) => _buildTaskChip(task)).toList(),
              ),
            ],
            const SizedBox(height: 24),
            _buildLabel("Experience"),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.grey[200]!),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _selectedExperience,
                  isExpanded: true,
                  hint: Text("Select your experience", style: GoogleFonts.inter(color: Colors.grey[400])),
                  items: ["< 1 Year", "1-3 Years", "3-5 Years", "5+ Years"]
                      .map((e) => DropdownMenuItem(value: e, child: Text(e)))
                      .toList(),
                  onChanged: (val) => setState(() => _selectedExperience = val),
                ),
              ),
            ),
            const SizedBox(height: 24),
            _buildLabel("Select Your State"),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.grey[200]!),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _selectedState,
                  isExpanded: true,
                  hint: Text("Where are you located?", style: GoogleFonts.inter(color: Colors.grey[400])),
                  items: _states.map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
                  onChanged: (val) {
                    setState(() {
                      _selectedState = val;
                      // Auto-recommend languages based on state
                      final recs = _getRecommendedLanguages();
                      for (var r in recs) {
                        if (!_selectedLanguages.contains(r)) _selectedLanguages.add(r);
                      }
                    });
                  },
                ),
              ),
            ),
            const SizedBox(height: 24),
            _buildLabel("Languages You Speak"),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: _languages.map((lang) => _buildLanguageChip(lang)).toList(),
            ),
            const SizedBox(height: 32),
            // ID Upload Section
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFFF0FDF4),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFBBF7D0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.verified_user_outlined, color: Color(0xFF166534)),
                      const SizedBox(width: 8),
                      Text("Basic Verification", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16, color: const Color(0xFF166534))),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text("Uploading an ID builds trust with users and gets you more jobs. (Optional for now)", style: GoogleFonts.inter(fontSize: 12, color: Colors.black54)),
                  const SizedBox(height: 20),
                  GestureDetector(
                    onTap: () => _pickImage(isId: true),
                    child: Container(
                      width: double.infinity,
                      height: 120,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFBBF7D0), style: BorderStyle.solid),
                      ),
                      child: _idImage != null 
                        ? ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.file(_idImage!, fit: BoxFit.cover))
                        : (_uploadedIdUrl != null
                            ? ClipRRect(
                                borderRadius: BorderRadius.circular(12),
                                child: Image.network(
                                  _uploadedIdUrl!.startsWith('http') 
                                      ? _uploadedIdUrl! 
                                      : '$baseUrl$_uploadedIdUrl',
                                  fit: BoxFit.cover,
                                ),
                              )
                            : Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.add_photo_alternate_outlined, color: Color(0xFF166534)),
                                  const SizedBox(height: 4),
                                  Text("Upload ID Proof", style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold, color: const Color(0xFF166534))),
                                ],
                              )),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            // Work Radius Card
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(20)),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text("Work Area Radius", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text("${_workRadius.toInt()}km", style: GoogleFonts.outfit(fontWeight: FontWeight.bold, color: const Color(0xFFFF6A00), fontSize: 16)),
                    ],
                  ),
                  Slider(
                    value: _workRadius,
                    min: 5,
                    max: 25,
                    activeColor: const Color(0xFFFF6A00),
                    inactiveColor: const Color(0xFFFF6A00).withOpacity(0.1),
                    onChanged: (val) => setState(() => _workRadius = val),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text("5KM", style: GoogleFonts.inter(fontSize: 10, color: Colors.black45)),
                      Text("25KM", style: GoogleFonts.inter(fontSize: 10, color: Colors.black45)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 40),
            SizedBox(
              width: double.infinity,
              height: 60,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _submitProfile,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6A00),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  elevation: 0,
                ),
                child: _isLoading
                    ? const CircularProgressIndicator(color: Colors.white)
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text("Continue", style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white)),
                          const SizedBox(width: 8),
                          const Icon(Icons.arrow_forward, color: Colors.white),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    ),
  );
}

  Widget _buildLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(text, style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: GoogleFonts.inter(color: Colors.grey[400]),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.all(16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: Colors.grey[200]!)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: Colors.grey[200]!)),
    );
  }

  Widget _buildSkillChip(String skill) {
    final isSelected = _selectedSkills.contains(skill);
    return GestureDetector(
      onTap: () {
        setState(() {
          if (isSelected) {
            _selectedSkills.remove(skill);
            // Clear tasks that belong only to this skill
            final skillTasks = SkillData.skillToTasks[skill] ?? [];
            _selectedTasks.removeWhere((t) => skillTasks.contains(t));
          } else {
            _selectedSkills.add(skill);
          }
        });
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFFFF7ED) : Colors.white,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: isSelected ? const Color(0xFFFF6A00) : Colors.grey[300]!),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(skill, style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: isSelected ? const Color(0xFF994B00) : Colors.black54, fontSize: 13)),
            if (isSelected) ...[
              const SizedBox(width: 8),
              const Icon(Icons.check_circle, color: Color(0xFF994B00), size: 16),
            ]
          ],
        ),
      ),
    );
  }

  List<String> _getRecommendedTasks() {
    List<String> tasks = [];
    for (var skill in _selectedSkills) {
      tasks.addAll(SkillData.skillToTasks[skill] ?? []);
    }
    return tasks.toSet().toList(); // Unique tasks
  }

  Widget _buildTaskChip(String task) {
    final isSelected = _selectedTasks.contains(task);
    return GestureDetector(
      onTap: () {
        setState(() {
          if (isSelected) _selectedTasks.remove(task);
          else _selectedTasks.add(task);
        });
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFEEF2FF) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? const Color(0xFF4F46E5) : Colors.grey[200]!),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(task, style: GoogleFonts.inter(fontWeight: FontWeight.w500, color: isSelected ? const Color(0xFF4F46E5) : Colors.black45, fontSize: 12)),
            if (isSelected) ...[
              const SizedBox(width: 6),
              const Icon(Icons.add_task, color: Color(0xFF4F46E5), size: 14),
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildLanguageChip(String lang) {
    final isSelected = _selectedLanguages.contains(lang);
    final isRecommended = _getRecommendedLanguages().contains(lang);
    
    return GestureDetector(
      onTap: () {
        setState(() {
          if (isSelected) _selectedLanguages.remove(lang);
          else _selectedLanguages.add(lang);
        });
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFFFF7ED) : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: isSelected ? const Color(0xFFFF6A00) : (isRecommended ? const Color(0xFFFFE4E6) : Colors.grey[200]!)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(lang, style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: isSelected ? const Color(0xFF994B00) : Colors.black54, fontSize: 12)),
            if (isRecommended && !isSelected) ...[
              const SizedBox(width: 6),
              const Icon(Icons.star, color: Color(0xFFFF6A00), size: 12),
            ]
          ],
        ),
      ),
    );
  }
}
