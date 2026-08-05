import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Users,
  UserPlus,
  Download,
  Search,
  Filter,
  Star,
  Brain,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  AlertCircle
} from 'lucide-react';

export const CustomersPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('ALL');
  const [page, setPage] = useState(1);
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);

  const fetchCustomers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCustomersSummary(currentZone, page, 10);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error loading zone customers: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [currentZone, page]);

  const kpis = data?.kpis || {};
  const customers = data?.customers || [];
  const filteredCustomers = customers.filter(c => {
    if (showOnlineOnly && !c.is_online) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>Customers</h1>
          <p style={{ fontSize: '13px', color: '#64748b' }}>
            Manage customer accounts, bookings, payments, support requests, trust scores, and marketplace activity in {currentZone}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => showToast('Exporting customer dataset...', 'info')}>
            <Download size={16} />
            <span>Export</span>
          </button>
          <button className="btn btn-primary" onClick={() => showToast('Opening Add Customer modal...', 'info')}>
            <UserPlus size={16} />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600' }}>
            ⚠️ Failed to load customer data for zone "{currentZone}": {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchCustomers}>Retry API Call</button>
        </div>
      )}

      {/* Top Stats Bar */}
      <div className="card" style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifycontent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>TOTAL CUSTOMERS</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.totalCustomers?.toLocaleString() ?? '142,893')}
            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>↑12%</span>
          </div>
        </div>

        <div style={{ height: '32px', width: '1px', background: 'var(--border-color)' }} />

        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>ACTIVE TODAY</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.activeToday?.toLocaleString() ?? '12,450')}
            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>↑5%</span>
          </div>
        </div>

        <div style={{ height: '32px', width: '1px', background: 'var(--border-color)' }} />

        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>NEW REG</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.newReg?.toLocaleString() ?? '892')}
            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>↑2.1%</span>
          </div>
        </div>

        <div style={{ height: '32px', width: '1px', background: 'var(--border-color)' }} />

        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>PREMIUM</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.premiumCount?.toLocaleString() ?? '4,521')}
            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>↑8%</span>
          </div>
        </div>

        <div style={{ height: '32px', width: '1px', background: 'var(--border-color)' }} />

        <div className="chip chip-purple" style={{ padding: '6px 12px', fontSize: '12px' }}>
          <Brain size={14} /> AI Insights
        </div>
      </div>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px' }}>
        {/* Left Column: Filter Pills + Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Tabs & Search */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className={`pill ${activeTab === 'ALL' ? 'active' : ''}`} onClick={() => setActiveTab('ALL')}>
                All {kpis.totalCustomers ? `${Math.round(kpis.totalCustomers / 1000)}k` : '142k'}
              </button>
              <button className={`pill ${activeTab === 'ACTIVE' ? 'active' : ''}`} onClick={() => setActiveTab('ACTIVE')}>
                Active Today {kpis.activeToday ? `${Math.round(kpis.activeToday / 1000)}k` : '12k'}
              </button>
              <button className={`pill ${activeTab === 'VIP' ? 'active' : ''}`} onClick={() => setActiveTab('VIP')}>
                ⭐ VIP
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--text-main)', fontWeight: '600' }}>
                <input
                  type="checkbox"
                  checked={showOnlineOnly}
                  onChange={(e) => setShowOnlineOnly(e.target.checked)}
                  style={{ width: '15px', height: '15px', accentColor: '#10b981', cursor: 'pointer' }}
                />
                <span>Online Only</span>
              </label>
              <button className="btn btn-secondary" style={{ padding: '6px 12px' }}><Filter size={16} /></button>
            </div>
          </div>

          {/* Table */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Location</th>
                <th>Presence</th>
                <th>Trust / Rating</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5"><div className="skeleton" style={{ height: '60px' }} /></td></tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                    No customer accounts recorded in zone {currentZone}.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: '#dbeafe', color: '#1e40af', fontWeight: '700',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px'
                        }}>
                          {c.name ? c.name.split(' ').map(n => n[0]).join('').slice(0, 2) : 'JD'}
                        </div>
                        <div>
                          <div style={{ fontWeight: '700', color: 'var(--text-main)', fontSize: '14px' }}>{c.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ID: {c.id.slice(0, 8)} • {c.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '13px' }}>{c.location || currentZone}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Joined: {c.joinedDate}</div>
                    </td>
                    <td>
                      {c.is_online ? <span className="badge badge-green">ONLINE</span> : <span className="badge badge-purple">OFFLINE</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ color: '#eab308', display: 'flex' }}>
                          <Star size={14} fill="#eab308" /><Star size={14} fill="#eab308" /><Star size={14} fill="#eab308" /><Star size={14} fill="#eab308" /><Star size={14} fill="#eab308" />
                        </div>
                        <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-main)' }}>{c.rating}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#10b981', fontWeight: '600', marginTop: '2px' }}>
                        Trust: Very High ({c.trustScore})
                      </div>
                    </td>
                    <td>
                      <span className="chip chip-green">Active</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span>Showing 1-10 of {kpis.totalCustomers || 142893}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn btn-secondary" style={{ padding: '4px 12px' }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <button className="btn btn-secondary" style={{ padding: '4px 12px' }} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        </div>

        {/* Right Sidebar Widgets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* AI Insights Card */}
          <div className="card" style={{ border: '1px solid #e9d5ff', background: '#faf5ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#7c3aed', fontWeight: '700', fontSize: '13px', marginBottom: '8px' }}>
              <Brain size={18} />
              <span>AI Insights</span>
            </div>
            <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#581c87', marginBottom: '6px' }}>
              {data?.aiInsights?.title || 'Churn Risk Detected'}
            </h4>
            <p style={{ fontSize: '12px', color: '#6b21a8', marginBottom: '12px', lineHeight: '1.4' }}>
              {data?.aiInsights?.message || `14 VIP users in ${currentZone} haven't booked in 30 days. Recommend automated retention campaign.`}
            </p>
            <button style={{ background: 'transparent', border: 'none', color: '#7c3aed', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }} onClick={() => showToast('Redirecting to Retention Cohort Workbench...', 'info')}>
              {data?.aiInsights?.action || 'Review Cohort →'}
            </button>
          </div>

          {/* Support & Refunds Widget */}
          <div className="card">
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '14px' }}>Support & Refunds</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316' }} />
                  Pending Refunds
                </span>
                <span style={{ fontWeight: '700', color: '#0f172a' }}>{kpis.pendingRefunds ?? 24}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                  Active Disputes
                </span>
                <span style={{ fontWeight: '700', color: '#0f172a' }}>{kpis.activeDisputes ?? 7}</span>
              </div>
            </div>

            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => showToast('Opening Resolution Center...', 'info')}>
              Go to Resolution Center
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
