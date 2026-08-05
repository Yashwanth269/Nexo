import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Megaphone,
  Sparkles,
  Send,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  History,
  Activity,
  AlertCircle
} from 'lucide-react';

export const CommunicationsPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Composer Form States
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('Workers');
  const [channel, setChannel] = useState('Push');
  const [composeLoading, setComposeLoading] = useState(false);

  const fetchComms = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCommunicationsSummary(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComms();
  }, [currentZone]);

  const handleCompose = async (e) => {
    e.preventDefault();
    if (!title || !body) {
      showToast('Please fill in title and message body', 'error');
      return;
    }
    setComposeLoading(true);
    try {
      await api.composeCommunication({
        name: title,
        audience,
        channel,
        body
      }, currentZone);
      showToast('Campaign composed and saved to drafts!', 'success');
      setTitle('');
      setBody('');
      fetchComms();
    } catch (err) {
      showToast(`Composer failed: ${err.message}`, 'error');
    } finally {
      setComposeLoading(false);
    }
  };

  const kpis = data?.kpis || {};
  const campaigns = data?.campaigns || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Communications Hub</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Create, schedule, manage, and monitor every communication sent across the marketplace in {currentZone}.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load communications: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchComms}>Retry</button>
        </div>
      )}

      {/* KPI Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>SENT TODAY</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '80px' }} /> : kpis.sentToday?.toLocaleString()}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>PUSH DELIVERY</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : `${kpis.pushDelivery}%`}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>SCHEDULED CAMPAIGNS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '40px' }} /> : kpis.scheduledCount}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>AVG. CTR</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: '#16a34a', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : `${kpis.avgCtr}%`}
          </div>
        </div>
      </div>

      {/* Live Alerts & Assistant Banner */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px' }}>
        {/* Live Broadcast Card */}
        <div className="card" style={{ border: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={16} /> Live Broadcast Center
            </span>
            <span className="chip chip-red" style={{ fontSize: '9px' }}>New Alert</span>
          </div>
          <p style={{ fontSize: '13px', color: '#7f1d1d', lineHeight: '1.4' }}>
            <strong>Target: {currentZone} (All Users)</strong><br />
            Due to heavy rain warning, dispatch ETA buffers are extended by 25 mins. Enforcing safe travel speeds.
          </p>
        </div>

        {/* AI Campaign Assistant */}
        <div className="card" style={{ border: '1px solid #e9d5ff', background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-purple)', fontWeight: '700', fontSize: '12px' }}>
            <Sparkles size={14} /> AI Campaign Assistant
          </div>
          <div style={{ fontSize: '11px', color: '#581c87', marginTop: '2px' }}>
            Optimal Sending Time: <strong>10:00 AM</strong>. Yields 14% higher click-through-rates.
          </div>
          <button className="ai-btn-purple" style={{ width: '100%', fontSize: '10px', padding: '6px 12px', marginTop: 'auto' }} onClick={() => showToast('Translating copies to Kannada/Telugu...', 'success')}>
            Generate Multilingual Copies
          </button>
        </div>
      </div>

      {/* Composers & Log lists */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', gap: '20px' }}>
        {/* Composer Form */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>Quick Composer</h3>
          <form onSubmit={handleCompose} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>AUDIENCE SEGMENT</label>
                <select value={audience} onChange={(e) => setAudience(e.target.value)} className="form-input" style={{ fontSize: '12px' }}>
                  <option value="Workers">Service Workers</option>
                  <option value="All Customers">All Customers</option>
                  <option value="Inactive Users">Inactive Users</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>BROADCAST CHANNEL</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className="form-input" style={{ fontSize: '12px' }}>
                  <option value="Push">Push Notification</option>
                  <option value="SMS">SMS Message</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Email">Email</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>CAMPAIGN TITLE</label>
              <input
                type="text"
                placeholder="e.g. Weekend Home Cleaning Special!"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="form-input"
                style={{ fontSize: '12px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>MESSAGE BODY</label>
              <textarea
                placeholder="Write your push announcement copy..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="form-input"
                style={{ minHeight: '80px', fontSize: '12px', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button type="submit" disabled={composeLoading} className="btn btn-secondary" style={{ background: '#ffffff', color: '#374151' }}>
                Save Draft
              </button>
              <button type="button" onClick={() => showToast('Campaign dispatch triggered!', 'success')} className="btn btn-primary" style={{ marginLeft: 'auto' }}>
                <Send size={14} /> Schedule & Broadcast
              </button>
            </div>
          </form>
        </div>

        {/* Live Preview (iOS mockup) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px' }}>LIVE PREVIEW (iOS SIMULATOR)</span>
          {/* Phone Shell */}
          <div style={{ width: '220px', height: '180px', border: '6px solid #1e293b', borderRadius: '24px', background: '#0f172a', padding: '14px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px', color: '#ffffff', overflow: 'hidden' }}>
            <div style={{ width: '60px', height: '12px', background: '#000', borderRadius: '6px', margin: '0 auto 6px' }} />
            {title || body ? (
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '12px', padding: '10px', fontSize: '10px' }}>
                <div style={{ fontWeight: '800', display: 'flex', justifycontent: 'space-between' }}>
                  <span>NEXO {audience.toUpperCase().slice(0, 6)}</span>
                  <span style={{ fontSize: '8px', color: '#94a3b8' }}>Now</span>
                </div>
                <div style={{ fontWeight: '700', marginTop: '4px' }}>{title || 'Diwali Special!'}</div>
                <div style={{ color: '#cbd5e1', marginTop: '2px', lineHeight: '1.3' }}>{body || 'Get up to Rs. 500 cashback...'}</div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#64748b', fontSize: '11px', marginTop: '30px' }}>
                Enter title and text body to preview push layout.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Broadcast History Table */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-main)' }}>Broadcast History</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Campaign Name</th>
              <th>Audience</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Metrics CTR</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5"><div className="skeleton" style={{ height: '40px' }} /></td></tr>
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>No campaigns sent in {currentZone}.</td>
              </tr>
            ) : (
              campaigns.map((c, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: '700', color: 'var(--text-main)' }}>{c.name}</td>
                  <td><span className="badge badge-blue">{c.audience}</span></td>
                  <td>{c.channel}</td>
                  <td>
                    <span className={`chip ${c.status === 'Completed' ? 'chip-green' : c.status === 'Sending' ? 'chip-blue' : 'chip-orange'}`}>{c.status}</span>
                  </td>
                  <td style={{ fontWeight: '700', color: '#16a34a' }}>{c.ctr > 0 ? `${c.ctr}% CTR` : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
export default CommunicationsPage;
