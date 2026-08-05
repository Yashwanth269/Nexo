import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem('nexo_admin_token') || null);
  const [user, setUser] = useState(
    JSON.parse(localStorage.getItem('nexo_admin_user') || 'null') || {
      name: 'Executive Auditor',
      role: 'SUPER_ADMIN',
      email: 'admin@nexo.app',
      avatar: 'https://ui-avatars.com/api/?name=Admin+Auditor&background=2563eb&color=fff&bold=true'
    }
  );
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const handleAuthExpired = () => {
      setToken(null);
      setUser(null);
      localStorage.removeItem('nexo_admin_user');
      showToast('Session expired. Please log in again.', 'error');
    };

    window.addEventListener('nexo_auth_expired', handleAuthExpired);
    return () => window.removeEventListener('nexo_auth_expired', handleAuthExpired);
  }, []);

  const showToast = (message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const login = async (phoneNumber, otp) => {
    try {
      const res = await api.login(phoneNumber, otp);
      if (res.token || res.success) {
        const authToken = res.token || 'mock_jwt_admin_token_session';
        const userData = {
          name: res.user?.name || 'Enterprise Admin',
          role: res.user?.role || 'SUPER_ADMIN',
          email: res.user?.email || 'admin@nexo.app',
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(res.user?.name || 'Admin')}&background=2563eb&color=fff&bold=true`
        };

        api.setToken(authToken);
        setToken(authToken);
        setUser(userData);
        localStorage.setItem('nexo_admin_user', JSON.stringify(userData));
        showToast('Successfully authenticated as Enterprise Admin', 'success');
        return true;
      }
    } catch (err) {
      showToast(err.message || 'Authentication failed', 'error');
      return false;
    }
  };

  const logout = () => {
    api.setToken(null);
    setToken(null);
    setUser(null);
    localStorage.removeItem('nexo_admin_user');
    showToast('Logged out of Admin Portal', 'info');
  };

  const hasRole = (allowedRoles) => {
    if (!user) return false;
    if (user.role === 'SUPER_ADMIN') return true;
    return allowedRoles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, hasRole, showToast, toast }}>
      {children}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          padding: '12px 20px',
          borderRadius: '10px',
          background: toast.type === 'error' ? '#ef4444' : toast.type === 'success' ? '#10b981' : '#2563eb',
          color: '#ffffff',
          fontWeight: '600',
          fontSize: '14px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          animation: 'fadeIn 0.3s ease'
        }}>
          <span>{toast.type === 'error' ? '🚨' : toast.type === 'success' ? '✅' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
