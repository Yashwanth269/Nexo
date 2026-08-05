import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Users,
  Award,
  Calendar,
  Layers,
  Search,
  Filter,
  Brain,
  Plus,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export const TeamsPage = () => {
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');

  const fetchTeams = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTeamsSummary();
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  const kpis = data?.kpis || {};
  const teams = data?.teams || [];

  const filteredTeams = teams.filter(t => {
    const term = search.toLowerCase();
    const matchesSearch = t.name.toLowerCase().includes(term) || t.leaderName.toLowerCase().includes(term);
    if (activeTab === 'ALL') return matchesSearch;
    if (activeTab === 'ACTIVE') return matchesSearch && t.status === 'Active';
    if (activeTab === 'PROJECT') return matchesSearch && t.status === 'On Project';
    return matchesSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Team Management</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Manage project teams, team leaders, attendance, assignments, incentives, and workforce collaboration.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => showToast('Exporting team performance reports...', 'info')}>Export Report</button>
          <button className="btn btn-primary" onClick={() => showToast('Opening Team Creator composer...', 'info')}>
            <Plus size={16} /> Create Team
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load team directories: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchTeams}>Retry</button>
        </div>
      )}

      {/* KPI Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px' }}>
        <div className="card-sm">
          <div style={{ fontSize: '8px', fontWeight: '700', color: 'var(--text-muted)' }}>ACTIVE TEAMS</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '18px', width: '30px' }} /> : kpis.activeTeams}
            <span className="chip chip-green" style={{ fontSize: '8px', padding: '2px 4px' }}>+12%</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '8px', fontWeight: '700', color: 'var(--text-muted)' }}>TEAM LEADERS</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '18px', width: '30px' }} /> : kpis.teamLeaders}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '8px', fontWeight: '700', color: 'var(--text-muted)' }}>TEAM MEMBERS</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '18px', width: '40px' }} /> : kpis.teamMembers}
            <span className="chip chip-blue" style={{ fontSize: '8px', padding: '2px 4px' }}>+5%</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '8px', fontWeight: '700', color: 'var(--text-muted)' }}>ONGOING PROJECTS</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '18px', width: '30px' }} /> : kpis.ongoingProjects}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '8px', fontWeight: '700', color: 'var(--text-muted)' }}>COMPLETED</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '18px', width: '40px' }} /> : kpis.completed}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '8px', fontWeight: '700', color: 'var(--text-muted)' }}>ATTENDANCE TODAY</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: '#16a34a', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '18px', width: '30px' }} /> : `${kpis.attendanceToday}%`}
          </div>
        </div>
      </div>

      {/* Main Layout: Roster Table + Side Widget */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: '20px' }}>
        {/* Left Card: Team Roster */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>Team Roster</h3>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '8px' }} />
              <input
                type="text"
                placeholder="Search teams..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '28px', padding: '6px 12px 6px 28px', fontSize: '12px' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`pill ${activeTab === 'ALL' ? 'active' : ''}`} onClick={() => setActiveTab('ALL')}>All Teams</button>
            <button className={`pill ${activeTab === 'ACTIVE' ? 'active' : ''}`} onClick={() => setActiveTab('ACTIVE')}>Active</button>
            <button className={`pill ${activeTab === 'PROJECT' ? 'active' : ''}`} onClick={() => setActiveTab('PROJECT')}>On Project</button>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Team Name</th>
                <th>Leader</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4"><div className="skeleton" style={{ height: '48px' }} /></td></tr>
              ) : filteredTeams.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No team roster records logged in database.
                  </td>
                </tr>
              ) : (
                filteredTeams.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: '700', color: 'var(--text-main)' }}>{t.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{t.membersCount} Members • {t.department}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img
                          src={`https://ui-avatars.com/api/?name=${encodeURIComponent(t.leaderName)}&background=3b82f6&color=fff&bold=true`}
                          alt=""
                          style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                        />
                        <span style={{ fontWeight: '600' }}>{t.leaderName}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`chip ${t.status === 'Active' ? 'chip-green' : 'chip-blue'}`}>{t.status}</span>
                    </td>
                    <td>
                      <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }} onClick={() => showToast('Opening team performance history dashboard...', 'info')}>Details</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Right Side Insights Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ border: '1px solid #e9d5ff', background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-purple)', fontWeight: '700', fontSize: '13px' }}>
              <Brain size={18} />
              <span>Smart Insights</span>
            </div>
            <p style={{ fontSize: '12px', color: '#6b21a8', lineHeight: '1.4' }}>
              Team 'Bravo' is projected to finish early. Consider assigning them to 'Project Zenith' next.
            </p>
            <button className="ai-btn-purple" style={{ width: '100%', fontSize: '11px', marginTop: '10px' }} onClick={() => showToast('Applying optimal team schedule re-routing...', 'success')}>
              Review Suggestion
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default TeamsPage;
