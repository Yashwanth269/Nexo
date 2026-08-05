import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  LifeBuoy,
  MessageSquare,
  PhoneCall,
  DollarSign,
  AlertTriangle,
  Clock,
  Search,
  Filter,
  Brain,
  ShieldAlert,
  AlertCircle
} from 'lucide-react';

export const SupportPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ticketSearch, setTicketSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');

  const fetchSupportSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSupportSummary(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error fetching support center: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSupportSummary();
  }, [currentZone]);

  const kpis = data?.kpis || {};
  const tickets = data?.tickets || [];
  const sosAlerts = data?.sosAlerts || [];
  const liveChats = data?.liveChatsList || [];

  const filteredTickets = tickets.filter(t => {
    const term = ticketSearch.toLowerCase();
    const matchesSearch = (
      t.id.toLowerCase().includes(term) ||
      t.customerOrWorker.toLowerCase().includes(term) ||
      t.category.toLowerCase().includes(term)
    );

    if (activeFilter === 'ALL') return matchesSearch;
    if (activeFilter === 'SOS') return matchesSearch && t.priority === 'HIGH';
    if (activeFilter === 'REFUND') return matchesSearch && t.category.toLowerCase().includes('refund');
    if (activeFilter === 'ESCALATED') return matchesSearch && t.status === 'ESCALATED';
    return matchesSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Support Center</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Manage customer support, worker assistance, disputes, escalations, refunds, and marketplace incidents in {currentZone}.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load support dashboard: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchSupportSummary}>Retry</button>
        </div>
      )}

      {/* 2-Row KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {/* KPI 1 */}
        <div className="card-sm" style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <LifeBuoy size={12} /> OPEN TICKETS
            </div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
              {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.openTickets}
            </div>
          </div>
          <span className="chip chip-orange" style={{ fontSize: '9px' }}>~12%</span>
        </div>

        {/* KPI 2 */}
        <div className="card-sm" style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <MessageSquare size={12} /> LIVE CHATS
            </div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
              {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.liveChats}
            </div>
          </div>
          <span className="chip chip-green" style={{ fontSize: '9px' }}>Live</span>
        </div>

        {/* KPI 3 */}
        <div className="card-sm" style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <PhoneCall size={12} /> ACTIVE CALLS
            </div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
              {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.activeCalls}
            </div>
          </div>
          <span className="chip chip-blue" style={{ fontSize: '9px' }}>Stable</span>
        </div>

        {/* KPI 4 */}
        <div className="card-sm" style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <DollarSign size={12} /> PENDING REFUNDS
            </div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
              {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : `₹${(kpis.pendingRefunds * 1000)?.toLocaleString()}`}
            </div>
          </div>
          <span className="chip chip-red" style={{ fontSize: '9px' }}>Action Needed</span>
        </div>

        {/* KPI 5 */}
        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>WORKER COMPLAINTS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.workerComplaints}
          </div>
        </div>

        {/* KPI 6 */}
        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>CUSTOMER COMPLAINTS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.customerComplaints}
          </div>
        </div>

        {/* KPI 7 */}
        <div className="card-sm" style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>HIGH PRIORITY CASES</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
              {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.highPriorityCases}
            </div>
          </div>
          <span className="chip chip-red" style={{ fontSize: '9px' }}>Urgent</span>
        </div>

        {/* KPI 8 */}
        <div className="card-sm" style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>AVG RESOLUTION TIME</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
              {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.avgResolutionTime}
            </div>
          </div>
          <Clock size={16} color="var(--accent-blue)" />
        </div>
      </div>

      {/* Main Content Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px' }}>
        {/* Left Column: Tickets Queue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ padding: '16px 20px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '9px' }} />
              <input
                type="text"
                placeholder="Search by Ticket ID, Customer Name, Worker..."
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '32px', fontSize: '12px' }}
              />
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px' }}><Filter size={16} /> Advanced Filters</button>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`pill ${activeFilter === 'ALL' ? 'active' : ''}`} onClick={() => setActiveFilter('ALL')}>All Open ({openTickets})</button>
            <button className={`pill ${activeFilter === 'SOS' ? 'active' : ''}`} onClick={() => setActiveFilter('SOS')}>Urgent SOS ({kpis.highPriorityCases})</button>
            <button className={`pill ${activeFilter === 'REFUND' ? 'active' : ''}`} onClick={() => setActiveFilter('REFUND')}>Pending Refunds ({kpis.pendingRefunds})</button>
            <button className={`pill ${activeFilter === 'ESCALATED' ? 'active' : ''}`} onClick={() => setActiveFilter('ESCALATED')}>Escalated ({kpis.highPriorityCases})</button>
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-main)' }}>Support Ticket Queue</h3>
              <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast('Navigating to full ticket archives...', 'info')}>View All →</button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ticket ID</th>
                  <th>Customer / Worker</th>
                  <th>Issue Category</th>
                  <th>Status</th>
                  <th>SLA Timer</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="5"><div className="skeleton" style={{ height: '48px' }} /></td></tr>
                ) : filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                      No support tickets logged matching this filter.
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((t, idx) => (
                    <tr key={idx}>
                      <td style={{ fontFamily: 'monospace', fontWeight: '700', color: 'var(--accent-blue)' }}>
                        #{t.id ? t.id.slice(0, 8) : `TCK-${9921 - idx}`}
                      </td>
                      <td>
                        <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>{t.customerOrWorker}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>via App Chat</div>
                      </td>
                      <td>{t.category}</td>
                      <td>
                        <span className={`chip ${t.status === 'OPEN' ? 'chip-blue' : 'chip-orange'}`}>{t.status}</span>
                      </td>
                      <td style={{ color: t.status === 'ESCALATED' ? 'var(--accent-red)' : 'var(--accent-blue)', fontWeight: '700' }}>
                        {t.slaTimer}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Widgets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ border: '1px solid #e9d5ff', background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-purple)', fontWeight: '700', fontSize: '13px' }}>
              <Brain size={18} />
              <span>AI Insight</span>
            </div>
            <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#581c87' }}>Anomaly Detected</h4>
            <p style={{ fontSize: '11px', color: '#6b21a8', lineHeight: '1.4' }}>
              Spike in "Late Arrival" complaints in Downtown District of {currentZone}. Proactively notify booked customers.
            </p>
            <button className="ai-btn-purple" style={{ width: '100%', fontSize: '11px' }} onClick={() => showToast('Drafting mass alert notifications...', 'info')}>
              Draft Mass Notification
            </button>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldAlert size={16} color="var(--accent-red)" /> Priority Queue
            </h3>
            {sosAlerts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', padding: '10px' }}>No active SOS alerts inside {currentZone}.</div>
            ) : (
              sosAlerts.map(sos => (
                <div key={sos.id} style={{ border: '1px solid #fca5a5', background: '#fef2f2', padding: '12px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifycontent: 'space-between', fontSize: '11px', color: '#991b1b', fontWeight: '700' }}>
                    <span>SOS Triggered</span>
                    <span>{sos.time}</span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#7f1d1d', lineHeight: '1.4' }}>
                    Worker <strong>{sos.worker}</strong> triggered alert. Job Ref #{sos.jobId.slice(0, 6)}
                  </p>
                  <button className="btn btn-primary" style={{ background: '#b91c1c', padding: '4px 10px', fontSize: '10px', width: '100%', marginTop: '4px' }} onClick={() => showToast('Initiating safety response protocols...', 'success')}>
                    Initiate Protocol
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)' }}>Live Chats</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {liveChats.map((c, i) => (
                <div key={i} style={{ padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: '10px', background: '#f8fafc', fontSize: '11px' }}>
                  <div style={{ display: 'flex', justifycontent: 'space-between', fontWeight: '700', color: 'var(--text-main)' }}>
                    <span>{c.name}</span>
                    <span style={{ color: '#16a34a', fontSize: '9px' }}>{c.status}</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    "{c.preview}"
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default SupportPage;
