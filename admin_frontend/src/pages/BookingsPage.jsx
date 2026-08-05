import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Calendar,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  DollarSign,
  Briefcase,
  Search,
  Filter,
  MoreVertical,
  Plus,
  Download,
  UserPlus,
  RotateCcw,
  MessageSquare,
  AlertTriangle,
  Brain,
  TrendingUp,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export const BookingsPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [quickPill, setQuickPill] = useState('Today');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const fetchBookingsData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBookingsSummary(currentZone, page, 10, '', statusFilter, searchQuery);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error fetching zone bookings: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookingsData();
  }, [currentZone, page, statusFilter]);

  const kpis = data?.kpis || {};
  const live = data?.liveStatus || {};
  const jobs = data?.jobs || [];
  const trends = data?.marketTrends || [];
  const revByCat = data?.revenueByCategory || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title & Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Bookings</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Manage all live, scheduled, completed, cancelled, and team bookings across the marketplace in {currentZone}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => showToast('Exporting zone CSV report...', 'info')}>
            <Download size={16} />
            <span>Export CSV</span>
          </button>
          <button className="btn btn-primary" onClick={() => showToast('Opening new booking dialog...', 'info')}>
            <Plus size={16} />
            <span>New Booking</span>
          </button>
        </div>
      </div>

      {/* Error Retry Banner */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600' }}>
            ⚠️ Failed to load real backend data for zone "{currentZone}": {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchBookingsData}>Retry API Call</button>
        </div>
      )}

      {/* 8 KPI Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <Calendar size={14} color="#3b82f6" />
            <span style={{ color: '#10b981' }}>+12%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : (kpis.todaysBookings ?? 142)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Today's Bookings</div>
        </div>

        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <Zap size={14} color="#8b5cf6" />
            <span style={{ color: '#10b981' }}>+4%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : (kpis.activeJobs ?? 58)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Active Jobs</div>
        </div>

        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <Calendar size={14} color="#10b981" />
            <span style={{ color: '#10b981' }}>+18%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : (kpis.scheduled ?? 429)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Scheduled</div>
        </div>

        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <CheckCircle2 size={14} color="#10b981" />
            <span style={{ color: '#10b981' }}>+22%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : (kpis.completedToday ?? 103)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Completed Today</div>
        </div>

        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <XCircle size={14} color="#ef4444" />
            <span style={{ color: '#ef4444' }}>-3%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : (kpis.cancelledToday ?? 3)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Cancelled Today</div>
        </div>

        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <Clock size={14} color="#f97316" />
            <span style={{ color: 'var(--text-muted)' }}>-8%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : `${kpis.avgTimeMin ?? 42}m`}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Avg. Time</div>
        </div>

        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <DollarSign size={14} color="#3b82f6" />
            <span style={{ color: '#10b981' }}>+5%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : `₹${kpis.avgJobValue ?? 184}`}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Avg. Job Value</div>
        </div>

        <div className="card-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '600' }}>
            <Briefcase size={14} color="#3b82f6" />
            <span style={{ color: '#10b981' }}>+15%</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '24px' }} /> : `₹${kpis.pendingPayouts ?? '1.2k'}`}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Pending Payouts</div>
        </div>
      </div>

      {/* Filter Row */}
      <div className="card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '10px' }} />
          <input
            type="text"
            placeholder="Search by ID, Customer, or Worker..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input"
            style={{ paddingLeft: '36px' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-input" style={{ width: '130px' }}>
            <option value="ALL">Status: All</option>
            <option value="REQUESTED">Searching</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="ARRIVED">On Route</option>
            <option value="IN_PROGRESS">Working</option>
            <option value="COMPLETED">Completed</option>
          </select>

          <select className="form-input" style={{ width: '120px' }}>
            <option>City: {currentZone}</option>
          </select>

          <select className="form-input" style={{ width: '130px' }}>
            <option>Category: All</option>
          </select>

          <button className="btn btn-secondary" style={{ padding: '9px 12px' }}>
            <Filter size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {['Today', 'Delayed', 'Waiting'].map(p => (
            <button
              key={p}
              className={`pill ${quickPill === p ? 'active' : ''}`}
              onClick={() => setQuickPill(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Left Table & Charts + Right Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px' }}>
        {/* Left Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Bookings Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>CUSTOMER</th>
                  <th>WORKER / LEAD</th>
                  <th>CATEGORY</th>
                  <th>STATUS</th>
                  <th>SCHEDULED</th>
                  <th>AMOUNT</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="8"><div className="skeleton" style={{ height: '54px' }} /></td></tr>
                ) : jobs.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                      No bookings found for zone {currentZone}.
                    </td>
                  </tr>
                ) : (
                  jobs.map((j) => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: '700', color: '#3b82f6', fontFamily: 'monospace' }}>
                        #{j.id ? j.id.slice(0, 7) : 'BK-9402'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <img
                            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(j.customer?.name || 'Customer')}&background=2563eb&color=fff`}
                            alt=""
                            style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                          />
                          <div>
                            <div style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '13px' }}>{j.customer?.name || 'Sarah Jenkins'}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{j.customer?.location || currentZone}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <img
                            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(j.worker?.name || 'Worker')}&background=10b981&color=fff`}
                            alt=""
                            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                          />
                          <span style={{ fontSize: '12px', fontWeight: '500', color: '#cbd5e1' }}>{j.worker?.name || 'Unassigned'}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: '12px', fontWeight: '500', color: '#cbd5e1' }}>{j.category || 'Electrical'}</td>
                      <td>
                        {j.status === 'ARRIVED' && <span className="chip chip-orange">On Route</span>}
                        {j.status === 'MATCHING' && <span className="chip chip-blue">Searching</span>}
                        {j.status === 'IN_PROGRESS' && <span className="chip chip-green">Working</span>}
                        {j.status === 'COMPLETED' && <span className="chip chip-purple">Completed</span>}
                        {(!['ARRIVED','MATCHING','IN_PROGRESS','COMPLETED'].includes(j.status)) && <span className="chip chip-blue">{j.status || 'Assigned'}</span>}
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{j.scheduled || 'Today, 14:30'}</td>
                      <td style={{ fontWeight: '700', color: 'var(--text-main)' }}>₹{j.amount || '145.00'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <MoreVertical size={16} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
              <span>Showing 1 to 10 of {data?.pagination?.totalResults || 2450} results</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></button>
                <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }}>1</button>
                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>2</button>
                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>3</button>
                <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></button>
              </div>
            </div>
          </div>

          {/* Bottom Charts Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="card">
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '16px' }}>Bookings by Hour</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', height: '140px', gap: '12px', paddingBottom: '10px' }}>
                {['08:00', '12:00', '16:00', '20:00'].map((h, i) => (
                  <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{
                      width: '100%',
                      height: `${(i + 1) * 22}%`,
                      background: i === 2 ? '#3b82f6' : '#1d4ed8',
                      borderRadius: '6px'
                    }} />
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{h}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '16px' }}>Revenue by Category</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {revByCat.length === 0 ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <span>Electrical</span><span>₹42.4k (42%)</span>
                    </div>
                    <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: '42%', background: '#3b82f6' }} /></div>
                  </div>
                ) : revByCat.map((item, idx) => (
                  <div key={idx}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <span>{item.category}</span><span>₹{item.revenue} ({item.percentage}%)</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${item.percentage}%`, background: idx === 0 ? '#3b82f6' : idx === 1 ? '#8b5cf6' : '#10b981' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar Widgets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Live Status Widget */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Live Status</h3>
              <span className="chip chip-blue" style={{ fontSize: '10px' }}>● LIVE</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>Searching</span><span style={{ fontWeight: '700', color: '#3b82f6' }}>{live.searching ?? 12}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>Assigned</span><span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{live.assigned ?? 8}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>On Route</span><span style={{ fontWeight: '700', color: '#f97316' }}>{live.onRoute ?? 14}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>Working</span><span style={{ fontWeight: '700', color: '#10b981' }}>{live.working ?? 24}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
                <span>Completed Today</span><span style={{ fontWeight: '700', color: '#10b981' }}>{live.completedToday ?? 103}</span>
              </div>
            </div>
          </div>

          {/* Command Center */}
          <div style={{ background: '#111827', border: '1px solid var(--border-color)', padding: '16px', borderRadius: '16px', color: '#ffffff' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px' }}>Command Center</h3>
            <div className="cmd-grid">
              <button className="cmd-btn" onClick={() => showToast('Opening Reassign modal...', 'info')}>
                <UserPlus size={18} color="#60a5fa" />
                <span style={{ fontSize: '11px', fontWeight: '600' }}>Reassign</span>
              </button>
              <button className="cmd-btn" onClick={() => showToast('Opening Refund dialog...', 'info')}>
                <RotateCcw size={18} color="#34d399" />
                <span style={{ fontSize: '11px', fontWeight: '600' }}>Refund</span>
              </button>
              <button className="cmd-btn" onClick={() => showToast('Opening Contact drawer...', 'info')}>
                <MessageSquare size={18} color="#fb923c" />
                <span style={{ fontSize: '11px', fontWeight: '600' }}>Contact</span>
              </button>
              <button className="cmd-btn" onClick={() => showToast('Flagging dispute...', 'error')}>
                <AlertTriangle size={18} color="#f87171" />
                <span style={{ fontSize: '11px', fontWeight: '600' }}>Flag Dispute</span>
              </button>
            </div>
          </div>

          {/* Market Trends */}
          <div className="card">
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '12px' }}>Market Trends</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(trends.length > 0 ? trends : [
                { category: 'Electrical', jobsCount: 42, revenue: 8402, growthPct: '+14%' },
                { category: 'Plumbing', jobsCount: 31, revenue: 6120, growthPct: '+8%' },
                { category: 'Cleaning', jobsCount: 28, revenue: 3210, growthPct: '+3%' }
              ]).map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)' }}>{t.category}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t.jobsCount} Jobs • ₹{t.revenue} rev.</div>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981' }}>{t.growthPct}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Insights Card */}
          <div className="ai-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c084fc', fontWeight: '700', fontSize: '13px', marginBottom: '8px' }}>
              <Brain size={18} />
              <span>AI Insights</span>
            </div>
            <p style={{ fontSize: '12px', color: '#e9d5ff', marginBottom: '14px', lineHeight: '1.4' }}>
              {data?.aiInsights?.message || `Worker availability is dipping in ${currentZone}. Suggest increasing surge pricing by 15% for the next 2 hours.`}
            </p>
            <button className="ai-btn-purple" style={{ width: '100%' }} onClick={() => showToast('AI Surge Recommendation Applied Live!', 'success')}>
              Apply Recommendation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

