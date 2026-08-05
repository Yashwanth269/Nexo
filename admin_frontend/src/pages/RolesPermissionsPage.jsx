import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Users,
  ShieldCheck,
  Lock,
  Smartphone,
  ShieldAlert,
  Search,
  Plus,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export const RolesPermissionsPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sessionTimeout, setSessionTimeout] = useState('30 min');
  const [mfaGlobally, setMfaGlobally] = useState(true);

  const fetchRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRolesSummary(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, [currentZone]);

  const handleMfaToggle = async (adminId) => {
    try {
      await api.toggleMfa(adminId);
      showToast('MFA configuration status updated!', 'success');
      fetchRoles();
    } catch (err) {
      showToast(`MFA toggle failed: ${err.message}`, 'error');
    }
  };

  const kpis = data?.kpis || {};
  const admins = data?.admins || [];

  const filteredAdmins = admins.filter(a => {
    const term = search.toLowerCase();
    return a.name.toLowerCase().includes(term) || a.role.toLowerCase().includes(term);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Roles, Permissions & Admin Management</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Manage administrators, departments, access control, permissions, security policies, and platform governance in {currentZone}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => showToast('Exporting administrator activity logs...', 'info')}>Export Report</button>
          <button className="btn btn-primary" onClick={() => showToast('Opening Invite Admin invitation panel...', 'info')}>
            <Plus size={16} /> Invite Admin
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load admin directory: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchRoles}>Retry</button>
        </div>
      )}

      {/* KPI Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>TOTAL ADMINISTRATORS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.totalAdmins}
            <span className="chip chip-green" style={{ fontSize: '10px' }}>+2</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>ACTIVE SESSIONS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.activeSessions}
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Right now</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>MFA ENABLED</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : `${kpis.mfaEnabledPercent}%`}
            <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: '700' }}>✓ Target: 100%</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>PENDING REQUESTS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', justifycontent: 'space-between', width: '100%' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '40px' }} /> : kpis.pendingRequests}
            <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast('Opening approval requests queue...', 'info')}>Review All</button>
          </div>
        </div>
      </div>

      {/* Main Grid: Directory + Side Panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: '20px' }}>
        {/* Administrator Directory */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>Administrator Directory</h3>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '8px' }} />
              <input
                type="text"
                placeholder="Filter admins..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '28px', padding: '6px 12px 6px 28px', fontSize: '12px' }}
              />
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Admin</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4"><div className="skeleton" style={{ height: '48px' }} /></td></tr>
              ) : filteredAdmins.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No administrators found matching this filter.
                  </td>
                </tr>
              ) : (
                filteredAdmins.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>{a.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{a.empId} • {a.department}</div>
                    </td>
                    <td>
                      <span className="badge badge-blue">{a.role}</span>
                    </td>
                    <td>
                      {a.status === 'Active' ? (
                        <span style={{ color: '#16a34a', fontSize: '12px', fontWeight: '700' }}>● Active</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Offline (2h ago)</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleMfaToggle(a.id)}>
                          {a.mfaEnabled ? 'Disable MFA' : 'Enable MFA'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Security Controls & Warnings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* AI Governance Alert */}
          <div className="card" style={{ border: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-red)', fontWeight: '700', fontSize: '13px' }}>
              <ShieldAlert size={16} /> AI Governance
            </div>
            <h4 style={{ fontSize: '12px', fontWeight: '700', color: '#991b1b', marginTop: '4px' }}>Over-privileged Admins</h4>
            <p style={{ fontSize: '11px', color: '#7f1d1d', lineHeight: '1.4' }}>
              3 users in Support have 'Delete' access they haven't used in 90 days.
            </p>
            <button className="btn btn-primary" style={{ background: '#b91c1c', padding: '6px 12px', fontSize: '10px', width: '100%', marginTop: '4px' }} onClick={() => showToast('Opening security permission settings...', 'info')}>
              Review Access
            </button>
          </div>

          {/* Security Policies */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Security Policies</h3>

            {/* Switch MFA globally */}
            <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
              <div>
                <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>Enforce MFA Globally</div>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Require for all admin logins</div>
              </div>
              <div
                onClick={() => { setMfaGlobally(!mfaGlobally); showToast(`Global MFA ${!mfaGlobally ? 'enforced' : 'released'}.`, 'success'); }}
                style={{ width: '38px', height: '20px', background: mfaGlobally ? 'var(--accent-blue)' : '#cbd5e1', borderRadius: '10px', display: 'flex', alignItems: 'center', padding: '2px', cursor: 'pointer', justifycontent: mfaGlobally ? 'flex-end' : 'flex-start' }}
              >
                <div style={{ width: '16px', height: '16px', background: '#ffffff', borderRadius: '50%' }} />
              </div>
            </div>

            {/* Session Timeout */}
            <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
              <div>
                <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>Session Timeout</div>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Idle limit before auto-logout</div>
              </div>
              <select value={sessionTimeout} onChange={(e) => { setSessionTimeout(e.target.value); showToast(`Session timeout updated to ${e.target.value}`, 'success'); }} className="form-input" style={{ width: '80px', padding: '4px 8px', fontSize: '11px' }}>
                <option value="15 min">15 min</option>
                <option value="30 min">30 min</option>
                <option value="60 min">60 min</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default RolesPermissionsPage;
