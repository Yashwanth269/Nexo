import React, { useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  DollarSign, Briefcase, Users, Clock, UsersRound, CreditCard,
  Star, Ticket, Brain, PlusCircle, Megaphone, UserPlus, FileText,
  RefreshCw, AlertCircle, Navigation
} from 'lucide-react';

// Fix Leaflet default marker icon broken by Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Zone centre coordinates
const ZONE_COORDS = {
  Kolar:      [13.1367, 78.1294],
  London:     [51.5074, -0.1278],
  'New York': [40.7128, -74.0060],
  Tokyo:      [35.6762, 139.6503],
  Paris:      [48.8566, 2.3522],
};

/* ── Custom Markers ── */

// Worker: blue dot
const workerIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#2563eb;border:2.5px solid #fff;
    box-shadow:0 1px 6px rgba(37,99,235,0.5);
  "></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});

// Customer searching: pulsing orange ring
const customerSearchingIcon = L.divIcon({
  className: '',
  html: `<div style="position:relative;width:24px;height:24px;">
    <div style="
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      width:24px;height:24px;border-radius:50%;
      background:rgba(249,115,22,0.18);
      animation:nexo-pulse 1.6s ease-out infinite;
    "></div>
    <div style="
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      width:12px;height:12px;border-radius:50%;
      background:#f97316;border:2.5px solid #fff;
      box-shadow:0 1px 6px rgba(249,115,22,0.6);
    "></div>
  </div>`,
  iconSize: [24, 24], iconAnchor: [12, 12],
});

// Customer assigned (green dot)
const customerAssignedIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:12px;height:12px;border-radius:50%;
    background:#10b981;border:2px solid #fff;
    box-shadow:0 1px 5px rgba(16,185,129,0.5);
  "></div>`,
  iconSize: [12, 12], iconAnchor: [6, 6],
});

// Inject pulse animation once
if (typeof document !== 'undefined' && !document.getElementById('nexo-pulse-style')) {
  const s = document.createElement('style');
  s.id = 'nexo-pulse-style';
  s.textContent = `@keyframes nexo-pulse {
    0% { transform: translate(-50%,-50%) scale(1); opacity: 0.8; }
    100% { transform: translate(-50%,-50%) scale(3); opacity: 0; }
  }`;
  document.head.appendChild(s);
}

/* ── Map centring helper ── */
function RecenterMap({ centre }) {
  const map = useMap();
  useEffect(() => { map.setView(centre, 13, { animate: true }); }, [centre]);
  return null;
}

/* ── Fallback worker pins (when no real data yet) ── */
function getFallbackPins(center, count) {
  return Array.from({ length: count }, () => [
    center[0] + (Math.random() - 0.5) * 0.08,
    center[1] + (Math.random() - 0.5) * 0.08,
  ]);
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD PAGE
   ════════════════════════════════════════════════════════════ */
export const DashboardPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data,    setData]    = useState(null);
  const [mapData, setMapData] = useState({ customers: [], workers: [] });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const mapPollRef = useRef(null);

  /* ── Fetch KPI stats ── */
  const fetchDashboardData = async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.getOverviewStats(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  /* ── Fetch live map pins ── */
  const fetchLiveMap = async () => {
    try {
      const res = await api.getLiveMap(currentZone);
      if (res?.success) setMapData({ customers: res.customers || [], workers: res.workers || [] });
    } catch (_) { /* silent fail for map */ }
  };

  useEffect(() => {
    setSelectedCustomer(null);
    setSelectedWorker(null);
    fetchDashboardData();
    fetchLiveMap();
    // Poll map every 10 seconds
    mapPollRef.current = setInterval(fetchLiveMap, 10000);
    return () => clearInterval(mapPollRef.current);
  }, [currentZone]);

  const centre       = ZONE_COORDS[currentZone] || ZONE_COORDS['Kolar'];
  const live         = data?.liveStatus || {};
  const realWorkers  = mapData.workers;
  const realCustomers= mapData.customers;

  // Use real worker pins if available; else scatter fallback dots
  const workerPins = realWorkers.length > 0
    ? realWorkers
    : getFallbackPins(centre, data?.workersOnline || 5).map(([lat, lng]) => ({ lat, lng, name: 'Worker', skills: [], rating: '4.9', isAvailable: true, id: Math.random() }));

  /* ── KPI helper ── */
  const kpi = (val, prefix = '', suffix = '') =>
    loading
      ? <div className="skeleton" style={{ height: '28px', width: '70px', borderRadius: '6px' }} />
      : `${prefix}${(val ?? 0).toLocaleString()}${suffix}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Good Morning, Operations</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Here's what's happening across your network in <strong>{currentZone}</strong> today.
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

      {/* Error banner */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} /> Failed to load stats for zone "{currentZone}": {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchDashboardData}>Retry</button>
        </div>
      )}

      {/* ── 8 KPI Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {[
          { label: "Today's Revenue",    val: data?.todaysRevenue,    icon: <DollarSign  size={20} color="#2563eb" />, bg: '#dbeafe', badge: '+12%',  badgeColor: '#10b981', prefix: '₹' },
          { label: 'Active Bookings',    val: data?.activeBookings,   icon: <Briefcase   size={20} color="#7c3aed" />, bg: '#f3e8ff', badge: '+5%',   badgeColor: '#10b981' },
          { label: 'Workers Online',     val: data?.workersOnline,    icon: <Users       size={20} color="#10b981" />, bg: '#d1fae5', badge: 'Live',   badgeColor: '#64748b' },
          { label: 'Customers Waiting',  val: data?.customersWaiting, icon: <Clock       size={20} color="#f97316" />, bg: '#ffedd5', badge: null },
          { label: 'Team Projects',      val: data?.teamProjects,     icon: <UsersRound  size={20} color="#2563eb" />, bg: '#dbeafe', badge: null },
          { label: 'Pending Payments',   val: data?.pendingPayments,  icon: <CreditCard  size={20} color="#ef4444" />, bg: '#fee2e2', badge: null, prefix: '₹' },
          { label: 'Avg Rating',         val: data?.avgRating,        icon: <Star        size={20} color="#d97706" />, bg: '#fef3c7', badge: null },
          { label: 'Open Tickets',       val: data?.openTickets,      icon: <Ticket      size={20} color="#64748b" />, bg: '#f1f5f9', badge: 'New',   badgeColor: '#f97316' },
        ].map(({ label, val, icon, bg, badge, badgeColor, prefix }) => (
          <div className="card" key={label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
              {badge && <span style={{ fontSize: '11px', fontWeight: '700', color: badgeColor }}>{badge}</span>}
            </div>
            <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)', marginTop: '2px' }}>{kpi(val, prefix)}</div>
          </div>
        ))}
      </div>

      {/* ── Live Operations Map ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Map header */}
        <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Live Operations Map</h3>
          <div style={{ display: 'flex', gap: '18px', fontSize: '12px', color: 'var(--text-muted)', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#2563eb' }} /> Workers ({workerPins.length})
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f97316' }} />
              Searching ({realCustomers.filter(c => ['OPEN', 'REQUESTED', 'MATCHING', 'REDISTRIBUTING', 'REASSIGNING'].includes(c.status)).length})
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
              Assigned ({realCustomers.filter(c => ['ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'WORK_IN_PROGRESS'].includes(c.status)).length})
            </span>
            <span style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>Refreshes every 10s</span>
          </div>
        </div>

        <MapContainer
          center={centre}
          zoom={13}
          style={{ height: '340px', width: '100%' }}
          zoomControl
          attributionControl={false}
          key={currentZone}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <RecenterMap centre={centre} />

          {/* Demand hotspot ring */}
          <Circle
            center={centre}
            radius={1400}
            pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.06, weight: 1.5, dashArray: '6 4' }}
          />

          {/* ── Worker pins (blue) ── */}
          {workerPins.map((w, i) => (
            <Marker
              key={`worker-${w.id || i}`}
              position={[w.lat, w.lng]}
              icon={workerIcon}
              eventHandlers={{
                click: () => setSelectedWorker(w),
              }}
            />
          ))}

          {/* ── Customer pins ── */}
          {realCustomers.map((c) => {
            const isSearching = ['OPEN', 'REQUESTED', 'MATCHING', 'REDISTRIBUTING', 'REASSIGNING'].includes(c.status);
            return (
              <Marker
                key={`cust-${c.id}`}
                position={[c.lat, c.lng]}
                icon={isSearching ? customerSearchingIcon : customerAssignedIcon}
                eventHandlers={{
                  click: () => setSelectedCustomer(c),
                }}
              />
            );
          })}

          {selectedWorker && (
            <Popup
              position={[selectedWorker.lat, selectedWorker.lng]}
              onClose={() => setSelectedWorker(null)}
            >
              <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
                <strong>👷 {selectedWorker.name}</strong><br />
                <span style={{ color: '#64748b' }}>Skills: {Array.isArray(selectedWorker.skills) ? selectedWorker.skills.slice(0, 2).join(', ') || 'General' : 'General'}</span><br />
                <span style={{ color: '#d97706' }}>⭐ {selectedWorker.rating}</span>
                {selectedWorker.isAvailable
                  ? <span style={{ color: '#10b981', marginLeft: '8px' }}>● Available</span>
                  : <span style={{ color: '#f97316', marginLeft: '8px' }}>● Busy</span>}
              </div>
            </Popup>
          )}

          {selectedCustomer && (
            <Popup
              position={[selectedCustomer.lat, selectedCustomer.lng]}
              onClose={() => setSelectedCustomer(null)}
            >
              <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
                <strong>🔍 Customer</strong><br />
                <span style={{ fontWeight: '700', color: '#f97316' }}>{selectedCustomer.category}</span><br />
                <span style={{
                  display: 'inline-block', marginTop: '2px',
                  padding: '1px 7px', borderRadius: '10px',
                  background: ['OPEN', 'REQUESTED', 'MATCHING', 'REDISTRIBUTING', 'REASSIGNING'].includes(selectedCustomer.status) ? '#fff7ed' : '#f0fdf4',
                  color: ['OPEN', 'REQUESTED', 'MATCHING', 'REDISTRIBUTING', 'REASSIGNING'].includes(selectedCustomer.status) ? '#f97316' : '#16a34a',
                  fontWeight: '700', fontSize: '11px'
                }}>{selectedCustomer.status.replace(/_/g, ' ')}</span><br />
                {selectedCustomer.address && <span style={{ color: '#94a3b8', fontSize: '10px' }}>📍 {selectedCustomer.address.slice(0, 40)}</span>}
              </div>
            </Popup>
          )}
        </MapContainer>
      </div>

      {/* ── Middle Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        <div className="ai-banner" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#7c3aed', fontWeight: '700', fontSize: '14px', marginBottom: '10px' }}>
              <Brain size={20} /> <span>AI Strategy Insight</span>
            </div>
            <p style={{ fontSize: '13px', color: '#581c87', lineHeight: '1.5', fontWeight: '500' }}>
              {data?.aiInsight?.message || `Demand prediction models suggest increasing worker incentive boost in ${currentZone} by 12% for peak evening slots.`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button className="ai-btn-purple" onClick={() => showToast('Strategy Applied!', 'success')}>Apply Strategy</button>
            <button className="btn btn-secondary" onClick={() => showToast('Opening Analysis...', 'info')}>View Analysis</button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '14px' }}>Quick Actions</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              { label: 'Create Booking', icon: <PlusCircle size={18} color="#2563eb" />, toast: 'Create Booking Dialog' },
              { label: 'Broadcast',      icon: <Megaphone  size={18} color="#7c3aed" />,  toast: 'Broadcast Notification' },
              { label: 'Add Worker',     icon: <UserPlus   size={18} color="#10b981" />,  toast: 'Add Worker Dialog' },
              { label: 'Reports',        icon: <FileText   size={18} color="#f97316" />,  toast: 'Export Zone Reports' },
            ].map(({ label, icon, toast: msg }) => (
              <button key={label} className="btn btn-secondary" style={{ flexDirection: 'column', height: '70px', justifyContent: 'center' }} onClick={() => showToast(msg, 'info')}>
                {icon}
                <span style={{ fontSize: '11px', marginTop: '4px' }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom 3-col ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>

        {/* Recent Activity */}
        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '14px' }}>Recent Activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {loading ? [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '36px', borderRadius: '8px' }} />) :
             (!data?.recentActivity?.length)
              ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', padding: '20px 0' }}>No recent activity yet.</div>
              : data.recentActivity.map((act, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: i === 0 ? '#10b981' : i === 1 ? '#2563eb' : '#f97316', marginTop: '6px', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-main)' }}>{act.title}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>{act.timeAgo}</div>
                    </div>
                  </div>
                ))
            }
          </div>
        </div>

        {/* Live Status Tracking */}
        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '14px' }}>Live Status Tracking</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { label: 'Searching',  pct: live.pctSearching ?? 0, color: '#94a3b8' },
              { label: 'Assigned',   pct: live.pctAssigned  ?? 0, color: '#2563eb' },
              { label: 'On Route',   pct: live.pctOnRoute   ?? 0, color: '#7c3aed' },
              { label: 'Working',    pct: live.pctWorking   ?? 0, color: '#10b981' },
            ].map(({ label, pct, color }) => (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{pct}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${Math.max(pct, 1)}%`, background: color, transition: 'width 0.8s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Rated Workers */}
        <div className="card">
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '14px' }}>Top Rated Workers</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {loading ? [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '32px', borderRadius: '8px' }} />) :
             (!data?.topRatedWorkers?.length)
              ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', padding: '20px 0' }}>No worker data available yet.</div>
              : data.topRatedWorkers.map((w, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img
                      src={`https://ui-avatars.com/api/?name=${encodeURIComponent(w.name)}&background=2563eb&color=fff&bold=true`}
                      alt="" style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>{w.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{w.category}</div>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: '800', color: '#d97706' }}>⭐ {w.rating}</span>
                  </div>
                ))
            }
          </div>
        </div>
      </div>
    </div>
  );
};
