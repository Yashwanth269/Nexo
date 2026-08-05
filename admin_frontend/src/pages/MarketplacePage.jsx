import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  ShoppingBag,
  Globe,
  Layers,
  Activity,
  Percent,
  Plus,
  Settings,
  AlertCircle
} from 'lucide-react';

export const MarketplacePage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Toggle state triggers
  const [autoCancel, setAutoCancel] = useState(true);
  const [aiDispatch, setAiDispatch] = useState(true);

  const fetchMarketplaceSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMarketplaceSummary(currentZone);
      setData(res);
      if (res.logic) {
        setAutoCancel(res.logic.autoCancellation);
        setAiDispatch(res.logic.aiDispatchPriority);
      }
    } catch (err) {
      setError(err.message);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketplaceSummary();
  }, [currentZone]);

  const kpis = data?.kpis || {};
  const categories = data?.categories || [];
  const auditLogs = data?.auditLogs || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifycontent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Marketplace Management</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Configure marketplace operations, service categories, pricing, incentives, availability, campaigns, and platform rules in {currentZone}.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load marketplace summary: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchMarketplaceSummary}>Retry</button>
        </div>
      )}

      {/* Top Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>ACTIVE CITIES</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '60px' }} /> : kpis.activeCities}
                <span className="chip chip-green" style={{ fontSize: '10px' }}>+2 this month</span>
              </div>
            </div>
            <div style={{ background: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', padding: '6px', borderRadius: '8px' }}>
              <Globe size={16} />
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>SERVICE CATEGORIES</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '60px' }} /> : kpis.serviceCategories}
                <span className="chip chip-blue" style={{ fontSize: '10px' }}>All Live</span>
              </div>
            </div>
            <div style={{ background: 'rgba(124, 58, 237, 0.08)', color: 'var(--accent-purple)', padding: '6px', borderRadius: '8px' }}>
              <Layers size={16} />
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>PLATFORM AVAILABILITY</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : `${kpis.platformAvailability}%`}
              </div>
            </div>
            <div style={{ background: 'rgba(16, 185, 129, 0.08)', color: 'var(--accent-green)', padding: '6px', borderRadius: '8px' }}>
              <Activity size={16} />
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>MARKETPLACE COVERAGE</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '60px' }} /> : `${kpis.marketplaceCoverage}%`}
                <span className="chip chip-blue" style={{ fontSize: '10px' }}>Optimal</span>
              </div>
            </div>
            <div style={{ background: 'rgba(234, 88, 12, 0.08)', color: 'var(--accent-orange)', padding: '6px', borderRadius: '8px' }}>
              <Percent size={16} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Category List + Logic Toggles */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px' }}>
        {/* Left Column: Service Categories list */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>Service Categories</h3>
            <button className="btn btn-primary" onClick={() => showToast('Opening Add Category modal...', 'info')} style={{ padding: '6px 12px', fontSize: '12px' }}>
              <Plus size={14} /> Add Category
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {loading ? (
              [1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '100px' }} />)
            ) : categories.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', gridColumn: '1 / -1', padding: '30px' }}>No categories registered.</div>
            ) : (
              categories.map((c, i) => (
                <div key={i} className="card-sm" style={{ border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifycontent: 'space-between' }}>
                  <div style={{ fontWeight: '700', color: 'var(--text-main)', fontSize: '14px' }}>{c.name}</div>
                  <div style={{ display: 'flex', justifycontent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '20px' }}>
                    <span>{c.jobsToday} Jobs Today</span>
                    <span>•</span>
                    <span>{c.activeWorkers} Active Workers</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Platform Logic Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Static Purple Ad banner or background slot */}
          <div className="card" style={{ height: '140px', background: 'linear-gradient(135deg, #a78bfa, #c084fc)', borderRadius: '16px', display: 'flex', justifycontent: 'center', alignItems: 'center', border: 'none' }}>
            <span style={{ fontSize: '32px' }}>✨</span>
          </div>

          {/* Platform Logic */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Settings size={16} /> Platform Logic
              </h3>
            </div>

            {/* Toggle 1 */}
            <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
              <div>
                <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>Auto-cancellation</div>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Cancel unaccepted jobs after 10m</div>
              </div>
              {/* Switch */}
              <div
                onClick={() => { setAutoCancel(!autoCancel); showToast(`Auto-cancellation ${!autoCancel ? 'enabled' : 'disabled'}.`, 'success'); }}
                style={{ width: '38px', height: '20px', background: autoCancel ? 'var(--accent-blue)' : '#cbd5e1', borderRadius: '10px', display: 'flex', alignItems: 'center', padding: '2px', cursor: 'pointer', justifycontent: autoCancel ? 'flex-end' : 'flex-start' }}
              >
                <div style={{ width: '16px', height: '16px', background: '#ffffff', borderRadius: '50%' }} />
              </div>
            </div>

            {/* Toggle 2 */}
            <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
              <div>
                <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>AI Dispatch Priority</div>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Route to highest rated first</div>
              </div>
              {/* Switch */}
              <div
                onClick={() => { setAiDispatch(!aiDispatch); showToast(`AI Dispatch Priority ${!aiDispatch ? 'enabled' : 'disabled'}.`, 'success'); }}
                style={{ width: '38px', height: '20px', background: aiDispatch ? 'var(--accent-blue)' : '#cbd5e1', borderRadius: '10px', display: 'flex', alignItems: 'center', padding: '2px', cursor: 'pointer', justifycontent: aiDispatch ? 'flex-end' : 'flex-start' }}
              >
                <div style={{ width: '16px', height: '16px', background: '#ffffff', borderRadius: '50%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Audit Log Table */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-main)' }}>Audit Log</h3>
          <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast('Navigating to full audit logs dashboard...', 'info')}>View Full Log</button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Options</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4"><div className="skeleton" style={{ height: '40px' }} /></td></tr>
            ) : auditLogs.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>No recent audit events in Kolar.</td>
              </tr>
            ) : (
              auditLogs.map((log, idx) => (
                <tr key={idx}>
                  <td>{log.timestamp}</td>
                  <td style={{ fontWeight: '700', color: 'var(--text-main)' }}>{log.user}</td>
                  <td>{log.action}</td>
                  <td>
                    <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast(`Opening audit details for entry #${idx}...`, 'info')}>Details</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
export default MarketplacePage;
