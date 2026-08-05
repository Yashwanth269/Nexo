import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  TrendingUp,
  Download,
  Calendar,
  Percent,
  DollarSign,
  Briefcase,
  Users,
  Brain,
  FileText,
  AlertCircle,
  Plus
} from 'lucide-react';

export const AnalyticsPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('30D');

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAnalyticsSummary(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error fetching analytics: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [currentZone]);

  const kpis = data?.kpis || {};
  const trends = data?.trends || [];
  const breakdown = data?.breakdown || { payouts: 0, commission: 0, taxes: 0 };
  const topCategories = data?.topCategories || [];
  const reports = data?.reports || [];
  const briefing = data?.briefing || { achievements: [], milestones: [], risks: [] };

  // Calculate coordinates for SVG line graph
  const maxRevenue = Math.max(...trends.map(t => t.revenue), 100);
  const maxBookings = Math.max(...trends.map(t => t.bookings), 10);
  
  const width = 800;
  const height = 200;
  const padding = 20;

  const pointsRev = trends.map((t, i) => {
    const x = padding + (i * (width - padding * 2)) / Math.max(trends.length - 1, 1);
    const y = height - padding - (t.revenue * (height - padding * 2)) / maxRevenue;
    return `${x},${y}`;
  }).join(' ');

  const pointsBks = trends.map((t, i) => {
    const x = padding + (i * (width - padding * 2)) / Math.max(trends.length - 1, 1);
    const y = height - padding - (t.bookings * (height - padding * 2)) / maxBookings;
    return `${x},${y}`;
  }).join(' ');

  // SVG Donut calculations
  const totalRevBreakdown = breakdown.payouts + breakdown.commission + breakdown.taxes || 1;
  const payoutsPct = Math.round((breakdown.payouts / totalRevBreakdown) * 100);
  const commissionPct = Math.round((breakdown.commission / totalRevBreakdown) * 100);
  const taxesPct = Math.round((breakdown.taxes / totalRevBreakdown) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Analytics & Reports</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Monitor marketplace growth, operational performance, financial trends, workforce efficiency, and customer insights in {currentZone}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Time Filter */}
          <div style={{ display: 'flex', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '4px' }}>
            {['Today', '7D', '30D', '1Y'].map(t => (
              <button
                key={t}
                onClick={() => setTimeRange(t)}
                style={{
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  background: timeRange === t ? 'var(--accent-blue)' : 'transparent',
                  color: timeRange === t ? '#ffffff' : 'var(--text-muted)',
                  transition: 'all 0.2s ease'
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <button className="btn btn-primary" onClick={() => showToast('Exporting dashboard analytics data...', 'info')}>
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load analytics: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchAnalytics}>Retry</button>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        {/* KPI 1 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>TODAY'S REVENUE</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '100px' }} /> : `₹${kpis.revenue?.toLocaleString() || 0}`}
              </div>
            </div>
            <div style={{ background: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', padding: '8px', borderRadius: '10px' }}>
              <DollarSign size={18} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '11px' }}>
            <span style={{ color: '#16a34a', fontWeight: '700' }}>↑18.2%</span>
            <span style={{ color: 'var(--text-muted)' }}>vs Yesterday</span>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>TOTAL BOOKINGS</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : kpis.bookings?.toLocaleString()}
              </div>
            </div>
            <div style={{ background: 'rgba(124, 58, 237, 0.08)', color: 'var(--accent-purple)', padding: '8px', borderRadius: '10px' }}>
              <Briefcase size={18} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '11px' }}>
            <span style={{ color: '#16a34a', fontWeight: '700' }}>↑5.4%</span>
            <span style={{ color: 'var(--text-muted)' }}>vs Last Week</span>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>ACTIVE CUSTOMERS</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '80px' }} /> : kpis.activeCustomers?.toLocaleString()}
              </div>
            </div>
            <div style={{ background: 'rgba(14, 165, 233, 0.08)', color: '#0ea5e9', padding: '8px', borderRadius: '10px' }}>
              <Users size={18} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '11px' }}>
            <span style={{ color: '#16a34a', fontWeight: '700' }}>↑12.1%</span>
            <span style={{ color: 'var(--text-muted)' }}>vs Last Month</span>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>COMPLETION RATE</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
                {loading ? <div className="skeleton" style={{ height: '24px', width: '60px' }} /> : `${kpis.completionRate}%`}
              </div>
            </div>
            <div style={{ background: 'rgba(220, 38, 38, 0.08)', color: 'var(--accent-red)', padding: '8px', borderRadius: '10px' }}>
              <Percent size={18} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '11px' }}>
            <span style={{ color: '#dc2626', fontWeight: '700' }}>-1.2%</span>
            <span style={{ color: 'var(--text-muted)' }}>vs Last Month</span>
          </div>
        </div>
      </div>

      {/* Main Graph & Insight Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px' }}>
        {/* Trend Graph Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)' }}>Revenue & Bookings Trend</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>30-day overview comparing current vs previous period.</p>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="pill active" style={{ fontSize: '11px', padding: '4px 10px' }}>Daily</button>
              <button className="pill" style={{ fontSize: '11px', padding: '4px 10px' }}>Weekly</button>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? (
              <div className="skeleton" style={{ height: '200px', width: '100%' }} />
            ) : trends.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No booking transactions recorded in {currentZone} for graph mapping.</div>
            ) : (
              <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%' }}>
                {/* Background Grid Lines */}
                <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="var(--border-color)" strokeDasharray="3 3" />
                <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="var(--border-color)" strokeDasharray="3 3" />
                <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border-color)" />

                {/* Line 1: Revenue (Blue) */}
                <polyline
                  fill="none"
                  stroke="var(--accent-blue)"
                  strokeWidth="3"
                  points={pointsRev}
                />

                {/* Line 2: Bookings (Purple) */}
                <polyline
                  fill="none"
                  stroke="var(--accent-purple)"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  points={pointsBks}
                />
              </svg>
            )}
          </div>
          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', fontWeight: '700', paddingLeft: '20px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent-blue)' }} /> Current Period
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent-purple)' }} /> Previous Period
            </span>
          </div>
        </div>

        {/* AI Insights Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ flex: 1, border: '1px solid #e9d5ff', background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-purple)', fontWeight: '700', fontSize: '13px' }}>
              <Brain size={18} />
              <span>AI Insights</span>
            </div>

            <div style={{ borderLeft: '3px solid #10b981', paddingLeft: '10px', margin: '10px 0' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#047857' }}>Demand Surge Predicted</div>
              <div style={{ fontSize: '11px', color: '#065f46', marginTop: '2px', lineHeight: '1.4' }}>
                Revenue projected to increase 14% tomorrow due to local festival demand.
              </div>
            </div>

            <div style={{ borderLeft: '3px solid #ef4444', paddingLeft: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#b91c1c' }}>Workforce Shortage</div>
              <div style={{ fontSize: '11px', color: '#991b1b', marginTop: '2px', lineHeight: '1.4' }}>
                Shortage detected in {currentZone} Plumbing category.
              </div>
            </div>

            <button
              className="ai-btn-purple"
              style={{ width: '100%', padding: '8px 14px', fontSize: '11px', marginTop: 'auto' }}
              onClick={() => showToast('Applying 15% surge pricing recommendation...', 'success')}
            >
              Apply 15% Boost
            </button>
          </div>
        </div>
      </div>

      {/* Breakdowns & Lists */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
        {/* Revenue Breakdown Donut Chart */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Revenue Breakdown</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', height: '140px' }}>
            {loading ? (
              <div className="skeleton" style={{ height: '120px', width: '120px', borderRadius: '50%' }} />
            ) : (
              <>
                <svg width="120" height="120" viewBox="0 0 42 42">
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="var(--border-color)" strokeWidth="4" />
                  {/* Payouts Segment */}
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="var(--accent-blue)" strokeWidth="4.2"
                    strokeDasharray={`${payoutsPct} ${100 - payoutsPct}`} strokeDashoffset="25" />
                  {/* Commission Segment */}
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="var(--accent-purple)" strokeWidth="4.2"
                    strokeDasharray={`${commissionPct} ${100 - commissionPct}`} strokeDashoffset={25 - payoutsPct} />
                </svg>
                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)' }}>₹{(revenue / 1000).toFixed(1)}k</span>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>TOTAL</span>
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-blue)' }} /> Payouts
              </span>
              <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{payoutsPct}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-purple)' }} /> Commission
              </span>
              <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{commissionPct}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--border-color)' }} /> Taxes & Fees
              </span>
              <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{taxesPct}%</span>
            </div>
          </div>
        </div>

        {/* Top Categories list */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Top Categories</h3>
            <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast('Redirecting to Marketplace...', 'info')}>View All</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {loading ? (
              [1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '32px', width: '100%' }} />)
            ) : topCategories.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>No completed orders recorded today.</div>
            ) : (
              topCategories.map((c, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{c.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>₹{(c.revenue / 1000).toFixed(1)}k</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${Math.min((c.revenue / Math.max(revenue, 1)) * 100, 100)}%`, background: 'var(--accent-blue)' }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Report Center */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Report Center</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {reports.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '10px', background: '#f8fafc' }}>
                <div style={{ background: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', padding: '6px', borderRadius: '8px' }}>
                  <FileText size={16} />
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{r.format} • {r.lastGenerated}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Executive Briefing Section */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            📊 Executive Briefing
          </h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Next 7 Days Outlook</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px', fontSize: '12px', lineHeight: '1.5' }}>
          {/* Key Achievements */}
          <div>
            <div style={{ fontWeight: '700', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} /> Key Achievements
            </div>
            <ul style={{ paddingLeft: '16px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {briefing.achievements.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>

          {/* Marketplace Milestones */}
          <div>
            <div style={{ fontWeight: '700', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-blue)' }} /> Marketplace Milestones
            </div>
            <ul style={{ paddingLeft: '16px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {briefing.milestones.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>

          {/* Operational Risks */}
          <div>
            <div style={{ fontWeight: '700', color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-red)' }} /> Operational Risks
            </div>
            <ul style={{ paddingLeft: '16px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {briefing.risks.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
