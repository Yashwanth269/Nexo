# Error Screen Audit

## Overview

Complete audit of error/empty/loading states across the Flutter codebase (mobile_app = 41 dart files, worker_app = 29 dart files).

## Coverage Summary

| Category | mobile_app | worker_app | Status |
|----------|-----------|------------|--------|
| Network / Connectivity | ✅ NetworkAwareWrapper + NetworkHelper | ✅ ConnectionMonitorOverlay + NetworkHelper | Covered |
| No Workers Found | ✅ NoWorkersFoundScreen | N/A | Covered |
| Job Already Assigned | ✅ ErrorComponents.showJobAssignedDialog | N/A | Covered |
| Generic Full-Screen Error | ✅ ErrorComponents.buildFullScreenError | ❌ Missing | Partial |
| Worker Emergency Reassignment | ✅ ReassigningWorkerScreen | N/A | Covered |
| Payment Errors | ⚠️ SnackBar only | ⚠️ SnackBar only | Needs screen |
| GPS/Location Errors | ❌ Silent fallback strings | ❌ Silent fallback strings | Needs screen |
| Permission Denied | ✅ PermissionRequestScreen | N/A | Covered |
| Upload Errors | ⚠️ SnackBar only | ⚠️ SnackBar only | Needs screen |
| Booking/Cancellation | ⚠️ SnackBar + AlertDialog | ⚠️ SnackBar + AlertDialog | Needs screen |
| Chat Errors | ⚠️ SnackBar only | ⚠️ SnackBar only | Needs screen |
| Auth/OTP Errors | ⚠️ SnackBar only | ⚠️ SnackBar only | Needs screen |
| Session Expired | ⚠️ SnackBar only | ❌ Missing | Needs screen |
| Server Error (5xx) | ❌ Missing | ❌ Missing | Missing |
| Maintenance Mode | ❌ Missing | ❌ Missing | Missing |
| Rate Limiting | ❌ Missing | ❌ Missing | Missing |
| Wallet Errors | ⚠️ SnackBar only | ⚠️ SnackBar only | Needs screen |
| Empty Inbox/Messages | ⚠️ Inline _buildEmptyState | ⚠️ Inline _buildEmptyState | Needs widget |
| Empty Notifications | ⚠️ Inline _buildEmptyState | ⚠️ Inline _buildEmptyState | Needs widget |
| Empty Wallet | ⚠️ Inline _buildEmptyState | ⚠️ Inline _buildEmptyState | Needs widget |
| Empty Jobs List | ⚠️ Inline _buildEmptyJobs | ⚠️ Inline _buildEmptyJobs | Needs widget |
| Emergency/SOS | ❌ Missing | ❌ Missing | Missing |
| Chat Disconnect | ❌ Silent console.log | ❌ Silent console.log | Missing |
| Worker Offline | N/A | ⚠️ Job-scoped only | Needs global |

## Existing Error-Related Files

### Dedicated Screens
- `mobile_app/lib/screens/no_workers_found_screen.dart` - No workers available
- `mobile_app/lib/screens/reassigning_worker_screen.dart` - Worker reassignment
- `mobile_app/lib/screens/permission_request_screen.dart` - Permission denied

### Error Components
- `mobile_app/lib/components/error_components.dart` - JobAssignedDialog, FullScreenError, Error toast
- `mobile_app/lib/widgets/network_aware_wrapper.dart` - No internet full-screen overlay
- `worker_app/lib/widgets/connection_monitor_overlay.dart` - Connection lost overlay (job-scoped)

### Loading States
- `mobile_app/lib/components/skeleton_components.dart` - Full skeleton screens
- `mobile_app/lib/widgets/shimmer_loading.dart` - Shimmer loading widget
- `mobile_app/lib/widgets/skeleton_loader.dart` - Reusable skeleton loader
- `worker_app/lib/widgets/skeleton_loader.dart` - Reusable skeleton loader

## Error Handling Patterns

| Pattern | Count | Where |
|---------|-------|-------|
| SnackBar (ScaffoldMessenger) | ~136 | Nearly every screen |
| AlertDialog | ~14 | Confirmations + errors |
| showModalBottomSheet | ~19 | Info + modals |
| CircularProgressIndicator | ~30 | Loading states |
| Inline _buildEmptyState() | ~12 | Per-screen empty states |
| Silent catch + log | ~8 | Socket, location, reassignment |
| Dedicated error screen | 5 | NoWorkersFound, NetworkAware, ConnectionMonitor, PermissionRequest, ReassigningWorker |

## Key Gaps

1. **No consistent error architecture** - Errors handled ad-hoc, no centralized error state management
2. **ErrorComponents underutilized** - Only 3 methods, most screens ignore it
3. **Worker app has no ErrorComponents** - No dedicated error component file
4. **No ErrorWidget.builder** - Neither app replaces the Flutter default error widget
5. **Empty states fragmented** - Every screen builds its own inline empty state
6. **GPS errors silently swallowed** - LocationService returns fallback strings only
7. **Chat disconnect invisible** - No user-facing feedback on socket disconnect
8. **Worker ConnectionMonitor is job-scoped** - No global connectivity overlay

## Recommended Priority (for next phase)

1. Create shared `EmptyStateWidget` for both apps
2. Create `GenericErrorScreen` with retry + support options
3. Create `GpsErrorScreen` for location failures
4. Create `EmergencySosScreen` for panic scenarios
5. Create global `ConnectionMonitor` for worker app
6. Add `ErrorWidget.builder` replacement in both main.dart
7. Expand `ErrorComponents` with all error categories
8. Create centralized error state management (Cubit/Provider)
