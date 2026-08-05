import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Brain,
  Cpu,
  Layers,
  Image as ImageIcon,
  Sparkles,
  Play,
  X,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export const AiCenterPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [activeTab, setActiveTab] = useState('Overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAiSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAiSummary(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error fetching AI summary: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAiSummary();
  }, [currentZone]);

  const kpis = data?.kpis || {};
  const recommendations = data?.recommendations || [];
  const automations = data?.automations || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Sub Header Tabs & Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '24px' }}>
          {['Overview', 'Analytics', 'Logs'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '13px',
                fontWeight: '700',
                cursor: 'pointer',
                color: activeTab === tab ? 'var(--accent-blue)' : 'var(--text-muted)',
                paddingBottom: '10px',
                borderBottom: activeTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
                marginBottom: '-11px',
                transition: 'all 0.2s ease'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast('Exporting AI performance metrics...', 'info')}>Export</button>
          <button className="btn btn-primary" onClick={() => showToast('Deploying current AI models to production...', 'success')}>Deploy AI</button>
        </div>
      </div>

      {/* Main Header */}
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>AI Center</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Monitor AI recommendations, automation, marketplace intelligence, content generation, and predictive insights in {currentZone}.
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to fetch AI insights: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchAiSummary}>Retry</button>
        </div>
      )}

      {/* Stats Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>TASKS COMPLETED</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.tasksCompleted?.toLocaleString() || '1,240')}
              </div>
            </div>
            <div style={{ background: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', padding: '6px', borderRadius: '8px' }}>
              <Cpu size={16} />
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>ACTIVE AUTOMATIONS</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.activeAutomations?.toLocaleString() || '42')}
              </div>
            </div>
            <div style={{ background: 'rgba(124, 58, 237, 0.08)', color: 'var(--accent-purple)', padding: '6px', borderRadius: '8px' }}>
              <Layers size={16} />
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>BANNERS GENERATED</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.bannersGenerated?.toLocaleString() || '850')}
              </div>
            </div>
            <div style={{ background: 'rgba(234, 88, 12, 0.08)', color: 'var(--accent-orange)', padding: '6px', borderRadius: '8px' }}>
              <ImageIcon size={16} />
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>JOB IMAGES</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : (kpis.jobImages?.toLocaleString() || '3,200')}
              </div>
            </div>
            <div style={{ background: 'rgba(16, 163, 74, 0.08)', color: 'var(--accent-green)', padding: '6px', borderRadius: '8px' }}>
              <Sparkles size={16} />
            </div>
          </div>
        </div>
      </div>

      {/* Smart Recommendations Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} color="var(--accent-purple)" />
          Smart Recommendations
        </h3>

        {loading ? (
          <div className="skeleton" style={{ height: '120px', width: '100%' }} />
        ) : recommendations.length === 0 ? (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            No recommendations generated for {currentZone}. System parameters are running in equilibrium.
          </div>
        ) : (
          recommendations.map(r => (
            <div key={r.id} className="card" style={{ background: '#faf5ff', border: '1px solid #e9d5ff', display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}>
              <span className="chip chip-purple" style={{ position: 'absolute', top: '16px', right: '16px' }}>{r.impact}</span>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#6b21a8' }}>{r.category}</div>
              <p style={{ fontSize: '13px', color: '#581c87', maxWidth: '80%' }}>
                {r.message}
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button className="btn btn-primary" style={{ background: '#7c3aed', boxShadow: 'none' }} onClick={() => showToast('Recommendation applied successfully!', 'success')}>
                  Apply
                </button>
                <button className="btn btn-secondary" style={{ background: '#ffffff', color: '#374151' }} onClick={() => showToast('Recommendation dismissed.', 'info')}>
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Automation Center & AI Media Studio Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Automation Center */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Automation Center</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {automations.map(a => (
              <div key={a.id} style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: '#f8fafc' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)' }}>{a.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Last run: {a.lastRun} • {a.successRate} Success</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#16a34a' }}>{a.status}</span>
                  {/* Mock Switch */}
                  <div style={{ width: '38px', height: '20px', background: 'var(--accent-blue)', borderRadius: '10px', display: 'flex', alignItems: 'center', padding: '2px', cursor: 'pointer', justifycontent: 'flex-end' }}>
                    <div style={{ width: '16px', height: '16px', background: '#ffffff', borderRadius: '50%' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Media Studio */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>AI Media Studio</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            {/* Banner Item 1 */}
            <div style={{ flex: 1, border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
              <span className="chip chip-green" style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 5 }}>Approved</span>
              <div style={{ height: '90px', background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)', fontWeight: '700', fontSize: '24px' }}>
                🏡
              </div>
              <div style={{ padding: '8px', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textAlign: 'center' }}>Home Care Banner</div>
            </div>

            {/* Banner Item 2 */}
            <div style={{ flex: 1, border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
              <span className="chip chip-orange" style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 5 }}>Pending</span>
              <div style={{ height: '90px', background: 'linear-gradient(135deg, #fff7ed, #ffedd5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-orange)', fontWeight: '700', fontSize: '24px' }}>
                🏷️
              </div>
              <div style={{ padding: '8px', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textAlign: 'center' }}>Seasonal Offer</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
