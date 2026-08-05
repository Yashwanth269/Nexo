import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Activity,
  Search,
  Bell,
  AlertOctagon,
  CheckCircle2,
  Users,
  MapPin,
  Cpu,
  RefreshCw,
  Compass,
  Radio,
  Layers
} from 'lucide-react';

export const LiveOperationsPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchLiveOps = async () => {
    setLoading(true);
    try {
      const res = await api.getOverviewStats(currentZone);
      setData(res);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveOps();
  }, [currentZone]);

  return (
    <div style={{
      background: '#090d16',
      color: '#f8fafc',
      padding: '24px',
      borderRadius: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
      minHeight: '85vh'
    }}>
      {/* Top Dark Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ fontSize: '20px', fontWeight: '800', color: '#60a5fa', letterSpacing: '-0.5px' }}>
            NCC <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600' }}>ZONE OPERATIONS ENGINE ({currentZone.toUpperCase()})</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34d399',
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '11px',
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} />
            SYSTEM_LIVE
          </span>
          <button className="btn btn-secondary" onClick={fetchLiveOps} disabled={loading} style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155' }}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Top 3 Metric Cards with Micro Bar Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
        <div style={{ background: '#131b2e', padding: '18px', borderRadius: '16px', border: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
            <span>REVENUE</span>
            <span style={{ color: '#34d399' }}>+12%</span>
          </div>
          <div style={{ fontSize: '26px', fontWeight: '800', color: '#ffffff', marginTop: '4px' }}>
            ₹{(data?.todaysRevenue ?? 42500).toLocaleString()}
          </div>
          <div style={{ display: 'flex', gap: '4px', height: '16px', alignItems: 'flex-end', marginTop: '10px' }}>
            {[30, 45, 60, 50, 75, 90, 100].map((h, i) => (
              <div key={i} style={{ flex: 1, background: '#2563eb', height: `${h}%`, borderRadius: '2px' }} />
            ))}
          </div>
        </div>

        <div style={{ background: '#131b2e', padding: '18px', borderRadius: '16px', border: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
            <span>ACTIVE JOBS</span>
            <span className="badge badge-purple" style={{ fontSize: '9px' }}>LIVE</span>
          </div>
          <div style={{ fontSize: '26px', fontWeight: '800', color: '#ffffff', marginTop: '4px' }}>
            {data?.activeBookings ?? 840}
          </div>
          <div style={{ display: 'flex', gap: '4px', height: '16px', alignItems: 'flex-end', marginTop: '10px' }}>
            {[40, 55, 30, 70, 85, 60, 95].map((h, i) => (
              <div key={i} style={{ flex: 1, background: '#7c3aed', height: `${h}%`, borderRadius: '2px' }} />
            ))}
          </div>
        </div>

        <div style={{ background: '#131b2e', padding: '18px', borderRadius: '16px', border: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>
            <span>WORKERS</span>
            <span className="badge badge-blue" style={{ fontSize: '9px' }}>SYNCED</span>
          </div>
          <div style={{ fontSize: '26px', fontWeight: '800', color: '#ffffff', marginTop: '4px' }}>
            {data?.workersOnline ?? 842}
          </div>
          <div style={{ display: 'flex', gap: '4px', height: '16px', alignItems: 'flex-end', marginTop: '10px' }}>
            {[60, 60, 70, 80, 85, 90, 100].map((h, i) => (
              <div key={i} style={{ flex: 1, background: '#38bdf8', height: `${h}%`, borderRadius: '2px' }} />
            ))}
          </div>
        </div>
      </div>

      {/* 3-Panel Split Live Maps View */}
      <div style={{
        background: '#131b2e',
        borderRadius: '16px',
        border: '1px solid #1e293b',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' }}>
          <span>HYPERLOCAL SECTOR DISPATCH MAP ({currentZone.toUpperCase()})</span>
          <span>LOC: 13.0827° N, 80.2707° E</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', height: '180px' }}>
          <div style={{ background: '#090d16', borderRadius: '12px', border: '1px solid #1e293b', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MapPin size={24} color="#f97316" />
            <span style={{ position: 'absolute', bottom: '8px', left: '8px', fontSize: '10px', color: '#94a3b8' }}>SECTOR 1 — HIGH DEMAND</span>
          </div>
          <div style={{ background: '#090d16', borderRadius: '12px', border: '1px solid #1e293b', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MapPin size={24} color="#60a5fa" />
            <span style={{ position: 'absolute', bottom: '8px', left: '8px', fontSize: '10px', color: '#94a3b8' }}>SECTOR 2 — OPTIMAL FLEET</span>
          </div>
          <div style={{ background: '#090d16', borderRadius: '12px', border: '1px solid #1e293b', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MapPin size={24} color="#f87171" />
            <span style={{ position: 'absolute', bottom: '8px', left: '8px', fontSize: '10px', color: '#94a3b8' }}>SECTOR 3 — SOS SURGE ALERT</span>
          </div>
        </div>
      </div>

      {/* Operations Feed */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Radio size={16} color="#f87171" /> REAL-TIME OPERATIONS FEED
        </h3>

        <div style={{ background: '#131b2e', padding: '14px', borderRadius: '12px', border: '1px solid #ef4444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AlertOctagon size={20} color="#ef4444" />
            <div>
              <div style={{ fontWeight: '700', color: '#ffffff', fontSize: '13px' }}>SOS Triggered in {currentZone} Sector 4</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Support responding. Agent ID: #X9002</div>
            </div>
          </div>
          <span style={{ fontSize: '10px', color: '#94a3b8' }}>10s ago</span>
        </div>

        <div style={{ background: '#131b2e', padding: '14px', borderRadius: '12px', border: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckCircle2 size={20} color="#34d399" />
            <div>
              <div style={{ fontWeight: '700', color: '#ffffff', fontSize: '13px' }}>Worker accepted Construction Job</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>High-priority status. Est. Arrival: 14 mins</div>
            </div>
          </div>
          <span style={{ fontSize: '10px', color: '#94a3b8' }}>Just now</span>
        </div>
      </div>

      {/* Marketplace Health Progress Bars */}
      <div style={{ background: '#131b2e', padding: '20px', borderRadius: '16px', border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff' }}>MARKETPLACE HEALTH</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              <span>Supply vs Demand</span><span style={{ color: '#60a5fa', fontWeight: '700' }}>94%</span>
            </div>
            <div style={{ height: '6px', background: '#090d16', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '94%', background: '#60a5fa' }} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              <span>Dispatch Efficiency</span><span style={{ color: '#38bdf8', fontWeight: '700' }}>88%</span>
            </div>
            <div style={{ height: '6px', background: '#090d16', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '88%', background: '#38bdf8' }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cpu size={18} color="#c084fc" />
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#ffffff' }}>AI Confidence Index</span>
          </div>
          <span style={{ fontSize: '16px', fontWeight: '800', color: '#c084fc' }}>99.9%</span>
        </div>
      </div>
    </div>
  );
};
