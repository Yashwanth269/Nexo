import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  ShieldAlert,
  Search,
  Eye,
  Brain,
  ShieldCheck,
  Zap,
  CheckCircle,
  FileText,
  AlertCircle
} from 'lucide-react';

export const TrustSafetyPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('Dashboard');
  const [riskFilter, setRiskFilter] = useState('ALL');

  const fetchTrust = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTrustSummary();
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrust();
  }, []);

  const kpis = data?.kpis || {};
  const cases = data?.cases || [];

  const filteredCases = cases.filter(c => {
    const term = search.toLowerCase();
    const matchesSearch = c.id.toLowerCase().includes(term) || c.user.toLowerCase().includes(term) || c.riskCategory.toLowerCase().includes(term);
    if (riskFilter === 'ALL') return matchesSearch;
    if (riskFilter === 'SOS') return matchesSearch && c.status === 'High Risk';
    if (riskFilter === 'KYC') return matchesSearch && c.riskCategory.toLowerCase().includes('identity');
    return matchesSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '24px' }}>
          {['Dashboard', 'Risk Engine', 'Investigations', 'SOS Hub'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSubTab(tab)}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '13px',
                fontWeight: '700',
                cursor: 'pointer',
                color: activeSubTab === tab ? 'var(--accent-blue)' : 'var(--text-muted)',
                paddingBottom: '10px',
                borderBottom: activeSubTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
                marginBottom: '-11px',
                transition: 'all 0.2s ease'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => showToast('Opening New Incident report composer...', 'info')}>+ New Investigation</button>
      </div>

      {/* Main Title */}
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Trust & Safety Center</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Monitor marketplace integrity, fraud prevention, identity verification, disputes, abuse reports, and safety operations in {currentZone}.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load risk registry: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchTrust}>Retry</button>
        </div>
      )}

      {/* Filter and Search Action row */}
      <div className="card" style={{ padding: '16px 20px', display: 'flex', gap: '16px', alignItems: 'center', justifycontent: 'space-between' }}>
        <div style={{ position: 'relative', width: '350px' }}>
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '9px' }} />
          <input
            type="text"
            placeholder="Search IDs, Aadhaar, PAN, User Names..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input"
            style={{ paddingLeft: '32px', fontSize: '12px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className={`pill ${riskFilter === 'KYC' ? 'active' : ''}`} onClick={() => setRiskFilter(riskFilter === 'KYC' ? 'ALL' : 'KYC')}>Pending KYC</button>
          <button className={`pill ${riskFilter === 'SOS' ? 'active' : ''}`} onClick={() => setRiskFilter(riskFilter === 'SOS' ? 'ALL' : 'SOS')}>High Risk</button>
          <button className="pill" style={{ color: 'var(--accent-red)' }} onClick={() => showToast('Opening real-time active SOS queue...', 'info')}>● SOS Cases</button>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>PENDING KYC</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.pendingKyc}
            <span className="chip chip-green" style={{ fontSize: '9px' }}>+12%</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>FRAUD ALERTS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.fraudAlerts}
            <span className="chip chip-red" style={{ fontSize: '9px' }}>-5%</span>
          </div>
        </div>

        <div className="card-sm" style={{ borderLeft: '3px solid var(--accent-red)' }}>
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>ACTIVE SOS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--accent-red)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '40px' }} /> : kpis.activeSos}
            <span className="chip chip-red" style={{ fontSize: '9px' }}>CRITICAL</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>TRUST SCORE AVG</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : `${kpis.trustScoreAvg}/5.0`}
            <span className="chip chip-blue" style={{ fontSize: '9px' }}>Stable</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Cases queue + AI Intelligence widgets */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: '20px' }}>
        {/* Risk Investigation Queue */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>Risk Investigation Queue</h3>
            <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast('Opening historical risk case archives...', 'info')}>View All →</button>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>User</th>
                <th>Risk Category</th>
                <th>Trust Score</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6"><div className="skeleton" style={{ height: '48px' }} /></td></tr>
              ) : filteredCases.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No security alerts raised in {currentZone}.
                  </td>
                </tr>
              ) : (
                filteredCases.map((c, idx) => (
                  <tr key={idx}>
                    <td style={{ fontFamily: 'monospace', fontWeight: '700', color: 'var(--accent-blue)' }}>
                      #{c.id ? c.id.slice(0, 8) : `RI-992${1 - idx}`}
                    </td>
                    <td>
                      <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>{c.user}</div>
                    </td>
                    <td>{c.riskCategory}</td>
                    <td style={{ fontWeight: '700', color: c.trustScore < 3.0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{c.trustScore.toFixed(1)}</td>
                    <td>
                      <span className={`chip ${c.status === 'High Risk' ? 'chip-red' : 'chip-orange'}`}>{c.status}</span>
                    </td>
                    <td>
                      <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', cursor: 'pointer' }} onClick={() => showToast(`Reviewing evidence log files for case #${idx}...`, 'info')}>
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* AI Risk Intelligence widget */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ border: '1px solid #e9d5ff', background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-purple)', fontWeight: '700', fontSize: '13px' }}>
              <Brain size={18} />
              <span>AI Risk Intelligence</span>
            </div>

            <div style={{ borderLeft: '3px solid var(--accent-orange)', paddingLeft: '10px', margin: '10px 0' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#7c2d12' }}>Emerging Pattern Detected</div>
              <div style={{ fontSize: '11px', color: '#9a3412', marginTop: '2px', lineHeight: '1.4' }}>
                Coordinated refund fraud detected in {currentZone} cluster. 12 accounts flagged.
              </div>
            </div>

            <div style={{ borderLeft: '3px solid var(--accent-red)', paddingLeft: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#7f1d1d' }}>Immediate Action Required</div>
              <div style={{ fontSize: '11px', color: '#991b1b', marginTop: '2px', lineHeight: '1.4' }}>
                Verify Worker #882 immediately. Biometric mismatch detected on recent shift.
              </div>
              <button className="ai-btn-purple" style={{ width: '100%', fontSize: '10px', padding: '6px 12px', marginTop: '8px' }} onClick={() => showToast('Opening investigation case review drawer...', 'info')}>
                Review Case
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default TrustSafetyPage;
