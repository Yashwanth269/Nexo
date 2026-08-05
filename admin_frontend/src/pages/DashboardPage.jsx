import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  DollarSign,
  Briefcase,
  Users,
  Clock,
  UsersRound,
  CreditCard,
  Star,
  Ticket,
  Brain,
  PlusCircle,
  Megaphone,
  UserPlus,
  FileText,
  Activity,
  CheckCircle2,
  MapPin,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export const DashboardPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getOverviewStats(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error fetching zone dashboard: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [currentZone]);

  const live = data?.liveStatus || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner Status Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>Good Morning, Operations</h1>
          <p style={{ fontSize: '13px', color: '#64748b' }}>
            Here's what's happening across your network in {currentZone} today.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#d1fae5', border: '1px solid #a7f3d0', padding: '6px 14px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#065f46', fontWeight: '600' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            Stable Network Connection
          </div>
          <button className="btn btn-secondary" onClick={fetchDashboardData} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error Retry Banner */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600' }}>
            ⚠️ Failed to load real backend stats for zone "{currentZone}": {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchDashboardData}>Retry API Call</button>
        </div>
      )}

      {/* 8 KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={20} color="#2563eb" />
            </div>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981' }}>+12%</span>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Today's Revenue</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : `₹${(data?.todaysRevenue ?? 42500).toLocaleString()}`}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Briefcase size={20} color="#7c3aed" />
            </div>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981' }}>+5%</span>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Active Bookings</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : (data?.activeBookings ?? 1240)}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={20} color="#10b981" />
            </div>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b' }}>Live</span>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Workers Online</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : (data?.workersOnline ?? 842)}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#ffedd5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={20} color="#f97316" />
            </div>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#f97316' }}>+8 min</span>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Customers Waiting</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : (data?.customersWaiting ?? 45)}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UsersRound size={20} color="#2563eb" />
            </div>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Team Projects</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : (data?.teamProjects ?? 12)}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CreditCard size={20} color="#ef4444" />
            </div>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Pending Payments</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : `₹${(data?.pendingPayments ?? 12000).toLocaleString()}`}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Star size={20} color="#d97706" />
            </div>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Avg Rating</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : (data?.avgRating ?? 4.9)}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ticket size={20} color="#64748b" />
            </div>
            <span className="chip chip-orange" style={{ fontSize: '9px' }}>New</span>
          </div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Open Tickets</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
            {loading ? <div className="skeleton" style={{ height: '28px' }} /> : (data?.openTickets ?? 8)}
          </div>
        </div>
      </div>

      {/* Live Operations Map */}
      <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>Live Operations Map</h3>
          <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#64748b' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2563eb' }} /> Workers
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316' }} /> Hotspots
            </span>
          </div>
        </div>

        {/* Map Container Representation */}
        <div style={{
          height: '240px',
          background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)',
          borderRadius: '14px',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}>
          <MapPin size={32} color="#2563eb" style={{ position: 'absolute', top: '40%', left: '48%' }} />
          <div style={{
            position: 'absolute', bottom: '16px', left: '16px',
            background: '#ffffff', padding: '8px 16px', borderRadius: '20px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px', fontWeight: '700', color: '#0f172a'
          }}>
            📍 12 active workers in Sector 4 ({currentZone})
          </div>
        </div>
      </div>

      {/* Middle Row: AI Strategy Insight + Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        {/* AI Strategy Insight */}
        <div className="ai-banner" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#7c3aed', fontWeight: '700', fontSize: '14px', marginBottom: '10px' }}>
              <Brain size={20} />
              <span>AI Strategy Insight</span>
            </div>
            <p style={{ fontSize: '13px', color: '#581c87', lineHeight: '1.5', fontWeight: '500' }}>
              {data?.aiInsight?.message || `"Increase worker incentives in Sector 7 (${currentZone}) to match predicted evening demand. Current completion rate is dipping below 85%."`}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button className="ai-btn-purple" onClick={() => showToast('Strategy Applied to Zone Dispatch Engine!', 'success')}>
              Apply Strategy
            </button>
            <button className="btn btn-secondary" onClick={() => showToast('Opening Strategy Analysis...', 'info')}>
              View Analysis
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '14px' }}>Quick Actions</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button className="btn btn-secondary" style={{ flexDirection: 'column', height: '70px', justifyContent: 'center' }} onClick={() => showToast('Create Booking Dialog', 'info')}>
              <PlusCircle size={18} color="#2563eb" />
              <span style={{ fontSize: '11px', marginTop: '4px' }}>Create Booking</span>
            </button>

            <button className="btn btn-secondary" style={{ flexDirection: 'column', height: '70px', justifyContent: 'center' }} onClick={() => showToast('Broadcast Notification Dialog', 'info')}>
              <Megaphone size={18} color="#7c3aed" />
              <span style={{ fontSize: '11px', marginTop: '4px' }}>Broadcast</span>
            </button>

            <button className="btn btn-secondary" style={{ flexDirection: 'column', height: '70px', justifyContent: 'center' }} onClick={() => showToast('Add Worker Dialog', 'info')}>
              <UserPlus size={18} color="#10b981" />
              <span style={{ fontSize: '11px', marginTop: '4px' }}>Add Worker</span>
            </button>

            <button className="btn btn-secondary" style={{ flexDirection: 'column', height: '70px', justifyContent: 'center' }} onClick={() => showToast('Export Zone Reports', 'info')}>
              <FileText size={18} color="#f97316" />
              <span style={{ fontSize: '11px', marginTop: '4px' }}>Reports</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section (3 columns) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
        {/* Recent Activity */}
        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '14px' }}>Recent Activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(data?.recentActivity || [
              { title: 'Booking #2904 accepted by Electrician', timeAgo: '2 minutes ago' },
              { title: 'New registration: John Doe (Plumber)', timeAgo: '15 minutes ago' },
              { title: 'Demand surge detected in Sector 4', timeAgo: '24 minutes ago' }
            ]).map((act, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: i === 0 ? '#10b981' : i === 1 ? '#2563eb' : '#f97316', marginTop: '6px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#0f172a' }}>{act.title}</div>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>{act.timeAgo}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Status Tracking */}
        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '14px' }}>Live Status Tracking</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                <span>Searching</span><span style={{ fontWeight: '700' }}>{live.pctSearching ?? 12}%</span>
              </div>
              <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${live.pctSearching ?? 12}%`, background: '#94a3b8' }} /></div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                <span>Assigned</span><span style={{ fontWeight: '700' }}>{live.pctAssigned ?? 45}%</span>
              </div>
              <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${live.pctAssigned ?? 45}%`, background: '#2563eb' }} /></div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                <span>On Route</span><span style={{ fontWeight: '700' }}>{live.pctOnRoute ?? 28}%</span>
              </div>
              <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${live.pctOnRoute ?? 28}%`, background: '#7c3aed' }} /></div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                <span>Working</span><span style={{ fontWeight: '700' }}>{live.pctWorking ?? 15}%</span>
              </div>
              <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${live.pctWorking ?? 15}%`, background: '#10b981' }} /></div>
            </div>
          </div>
        </div>

        {/* Support Queue */}
        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '14px' }}>Support Queue</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ background: '#fef2f2', padding: '10px 14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#991b1b' }}>Urgent: Server Lag</span>
              <span className="chip chip-red" style={{ fontSize: '9px' }}>High</span>
            </div>

            <div style={{ background: '#fff7ed', padding: '10px 14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#9a3412' }}>Dispute: #8821 Payment</span>
              <span className="chip chip-orange" style={{ fontSize: '9px' }}>Med</span>
            </div>

            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>Refund: #9022 Cancel</span>
              <span className="chip chip-blue" style={{ fontSize: '9px' }}>Low</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
