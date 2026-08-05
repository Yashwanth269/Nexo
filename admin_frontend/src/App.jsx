import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { BookingsPage } from './pages/BookingsPage';
import { WorkersPage } from './pages/WorkersPage';
import { CustomersPage } from './pages/CustomersPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { TeamsPage } from './pages/TeamsPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { AiCenterPage } from './pages/AiCenterPage';
import { TrustSafetyPage } from './pages/TrustSafetyPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { MediaStudioPage } from './pages/MediaStudioPage';
import { CommunicationsPage } from './pages/CommunicationsPage';
import { RolesPermissionsPage } from './pages/RolesPermissionsPage';
import { SupportPage } from './pages/SupportPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { PlatformSettingsPage } from './pages/PlatformSettingsPage';
import { LiveOperationsPage } from './pages/LiveOperationsPage';

const ProtectedRoute = ({ children }) => {
  const { token } = useAuth();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardPage />} />
            <Route path="bookings" element={<BookingsPage />} />
            <Route path="workers" element={<WorkersPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="live" element={<LiveOperationsPage />} />
            <Route path="marketplace" element={<MarketplacePage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="ai-center" element={<AiCenterPage />} />
            <Route path="trust-safety" element={<TrustSafetyPage />} />
            <Route path="media-studio" element={<MediaStudioPage />} />
            <Route path="communications" element={<CommunicationsPage />} />
            <Route path="roles-permissions" element={<RolesPermissionsPage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="audit-logs" element={<AuditLogsPage />} />
            <Route path="settings" element={<PlatformSettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
