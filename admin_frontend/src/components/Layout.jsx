import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  UserCheck,
  ShoppingBag,
  UsersRound,
  CreditCard,
  BrainCircuit,
  ShieldAlert,
  Megaphone,
  FileSpreadsheet,
  Settings,
  LogOut,
  Bell,
  Search,
  BarChart3,
  ShieldCheck,
  LifeBuoy
} from 'lucide-react';

export const Layout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentZone, setCurrentZone] = useState(api.getZone());
  const [searchTerm, setSearchTerm] = useState('');

  const zones = ['Kolar', 'London', 'New York', 'Tokyo', 'Paris'];

  const handleZoneSelect = (z) => {
    setCurrentZone(z);
    api.setZone(z);
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/bookings', label: 'Bookings', icon: CalendarCheck },
    { path: '/workers', label: 'Workers', icon: UserCheck },
    { path: '/customers', label: 'Customers', icon: Users },
    { path: '/analytics', label: 'Analytics', icon: BarChart3 },
    { path: '/marketplace', label: 'Marketplace', icon: ShoppingBag },
    { path: '/teams', label: 'Team Management', icon: UsersRound },
    { path: '/media-studio', label: 'Media Studio', icon: BrainCircuit },
    { path: '/communications', label: 'Communications Hub', icon: Megaphone },
    { path: '/roles-permissions', label: 'Roles & Permissions', icon: ShieldCheck },
    { path: '/trust-safety', label: 'Trust & Safety', icon: ShieldAlert },
    { path: '/support', label: 'Support Center', icon: LifeBuoy },
    { path: '/payments', label: 'Payments', icon: CreditCard },
    { path: '/ai-center', label: 'AI Center', icon: BrainCircuit },
    { path: '/audit-logs', label: 'Audit Logs', icon: FileSpreadsheet },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-dark)', color: 'var(--text-main)' }}>
      {/* Left Sidebar */}
      <aside style={{
        width: 'var(--sidebar-width)',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: 0,
        zIndex: 100
      }}>
        {/* Brand */}
        <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #2563eb, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '800',
            fontSize: '18px',
            color: '#fff'
          }}>
            N
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--text-main)', letterSpacing: '-0.5px' }}>
              Nexo Control
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>
              Enterprise Hub
            </div>
          </div>
        </div>

        {/* Nav Links */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  marginBottom: '4px',
                  fontSize: '13px',
                  fontWeight: isActive ? '600' : '500',
                  color: isActive ? '#2563eb' : '#64748b',
                  background: isActive ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'all 0.2s ease'
                })}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>

        {/* User Profile Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <img
            src={user?.avatar || `https://ui-avatars.com/api/?name=Zone+Admin&background=2563eb&color=fff`}
            alt=""
            style={{ width: '36px', height: '36px', borderRadius: '50%' }}
          />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name || 'Zone Admin'}
            </div>
            <div style={{ fontSize: '10px', color: '#2563eb', fontWeight: '700' }}>
              ZONE: {currentZone.toUpperCase()}
            </div>
          </div>
          <button
            onClick={() => { logout(); navigate('/login'); }}
            style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div style={{ flex: 1, marginLeft: 'var(--sidebar-width)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Header */}
        <header style={{
          height: '60px',
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 90
        }}>
          {/* Zone Selector Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Nexo Control Center</span>

            {/* Zone Selector Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f1f5f9', padding: '4px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
              {zones.map((z) => (
                <button
                  key={z}
                  onClick={() => handleZoneSelect(z)}
                  style={{
                    border: 'none',
                    padding: '4px 12px',
                    borderRadius: '16px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    background: currentZone === z ? '#2563eb' : 'transparent',
                    color: currentZone === z ? '#ffffff' : '#64748b',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {z}
                </button>
              ))}
            </div>
          </div>

          {/* Right Header Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={16} color="#64748b" style={{ position: 'absolute', left: '10px', top: '9px' }} />
              <input
                type="text"
                placeholder="Global Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '32px', fontSize: '12px' }}
              />
            </div>

            <div style={{ position: 'relative', cursor: 'pointer' }}>
              <Bell size={18} color="#64748b" />
              <span style={{ position: 'absolute', top: -2, right: -2, width: '8px', height: '8px', background: '#dc2626', borderRadius: '50%' }} />
            </div>

            <img
              src={user?.avatar || `https://ui-avatars.com/api/?name=Zone+Admin&background=2563eb&color=fff`}
              alt=""
              style={{ width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }}
            />
          </div>
        </header>

        {/* Page Content */}
        <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          <Outlet context={{ currentZone }} />
        </main>
      </div>
    </div>
  );
};
export default Layout;
