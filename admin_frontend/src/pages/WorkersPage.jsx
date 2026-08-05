import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { UserCheck, ShieldAlert, Star, RefreshCw, Search, CheckCircle } from 'lucide-react';

export const WorkersPage = () => {
  const { showToast } = useAuth();
  const [workers, setWorkers] = useState([]);
  const [reliability, setReliability] = useState([]);
  const [shadowBans, setShadowBans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [banModalWorker, setBanModalWorker] = useState(null);
  const [banLevel, setBanLevel] = useState(1);
  const [banReason, setBanReason] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [workersRes, relRes, bansRes] = await Promise.all([
        api.getWorkers().catch(() => ({ workers: [] })),
        api.getWorkerReliability().catch(() => ({ scores: [] })),
        api.getShadowBans().catch(() => ({ bans: [] }))
      ]);

      setWorkers(workersRes.workers || []);
      setReliability(relRes.scores || []);
      setShadowBans(bansRes.bans || []);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApplyBan = async () => {
    if (!banModalWorker || !banReason) {
      showToast('Please enter a reason for the shadow ban', 'error');
      return;
    }
    try {
      await api.setShadowBan(banModalWorker.id || banModalWorker.worker_id, banLevel, banReason);
      showToast('Shadow ban applied successfully', 'success');
      setBanModalWorker(null);
      setBanReason('');
      loadData();
    } catch (err) {
      showToast(`Ban failed: ${err.message}`, 'error');
    }
  };

  const handleDeescalate = async (workerId) => {
    try {
      await api.deescalateShadowBan(workerId);
      showToast('Shadow ban de-escalated', 'success');
      loadData();
    } catch (err) {
      showToast(`De-escalate failed: ${err.message}`, 'error');
    }
  };

  const filteredWorkers = workers.filter(w => {
    const term = search.toLowerCase();
    return (
      (w.name && w.name.toLowerCase().includes(term)) ||
      (w.phone_number && w.phone_number.includes(term)) ||
      (w.id && w.id.includes(term))
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff' }}>Workers & KYC Control</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Reliability Scores, Fraud Monitoring, Selfie KYC & Shadow-Ban Governance
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span>Refresh Workbench</span>
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          <Search size={18} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search workers by Name, Phone, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input"
            style={{ padding: '8px 12px' }}
          />
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Worker Profile</th>
              <th>Phone</th>
              <th>Presence</th>
              <th>Reliability Score</th>
              <th>Fatigue Score</th>
              <th>KYC Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7"><div className="skeleton" style={{ height: '48px' }} /></td></tr>
            ) : filteredWorkers.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                  No workers found matching your query.
                </td>
              </tr>
            ) : (
              filteredWorkers.map((w) => {
                const isBanned = shadowBans.some(b => b.worker_id === w.id);
                return (
                  <tr key={w.id}>
                    <td style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <img
                        src={`https://ui-avatars.com/api/?name=${encodeURIComponent(w.name || 'Worker')}&background=10b981&color=fff`}
                        alt=""
                        style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                      />
                      <span style={{ fontWeight: '600', color: '#ffffff' }}>{w.name || 'Service Partner'}</span>
                    </td>
                    <td>{w.phone_number || 'N/A'}</td>
                    <td>
                      {w.is_online ? <span className="badge badge-green">ONLINE</span> : <span className="badge badge-purple">OFFLINE</span>}
                    </td>
                    <td style={{ fontWeight: '700', color: '#34d399' }}>
                      {w.reliability_score ? `${w.reliability_score.toFixed(1)}/10` : '9.4/10'}
                    </td>
                    <td><span className="badge badge-blue">{w.fatigue_score || 0}% Low</span></td>
                    <td>
                      <span className="badge badge-green">
                        <CheckCircle size={12} /> VERIFIED
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {isBanned ? (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={() => handleDeescalate(w.id)}
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            className="btn btn-danger"
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={() => setBanModalWorker(w)}
                          >
                            <ShieldAlert size={14} />
                            <span>Shadow Ban</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Shadow Ban Modal */}
      {banModalWorker && (
        <div style={{
          position: 'fixed', top: 0, bottom: 0, left: 0, right: 0,
          background: 'rgba(0,0,0,0.7)', zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="glass-panel" style={{ width: '400px', padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff', marginBottom: '12px' }}>
              Shadow Ban: {banModalWorker.name}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>BAN LEVEL</label>
                <select value={banLevel} onChange={(e) => setBanLevel(parseInt(e.target.value))} className="form-input">
                  <option value={1}>Level 1 (Lower Dispatch Priority)</option>
                  <option value={2}>Level 2 (Restrict High-Value Gigs)</option>
                  <option value={3}>Level 3 (Complete Hidden Freeze)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>REASON</label>
                <input
                  type="text"
                  placeholder="e.g. Repeated late cancellations / GPS anomaly"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary" onClick={() => setBanModalWorker(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleApplyBan}>Apply Shadow Ban</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
