import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  FolderOpen,
  Sparkles,
  Upload,
  Grid,
  List,
  Search,
  Filter,
  Trash2,
  Copy,
  ExternalLink,
  Brain,
  AlertCircle
} from 'lucide-react';

export const MediaStudioPage = () => {
  const { currentZone } = useOutletContext() || { currentZone: 'Kolar' };
  const { showToast } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState('ALL');

  const fetchMedia = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMediaSummary(currentZone);
      setData(res);
    } catch (err) {
      setError(err.message);
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, [currentZone]);

  const kpis = data?.kpis || {};
  const assets = data?.assets || [];

  const filteredAssets = assets.filter(a => {
    const term = search.toLowerCase();
    const matchesSearch = a.name.toLowerCase().includes(term) || a.category?.toLowerCase().includes(term);
    if (assetFilter === 'ALL') return matchesSearch;
    return matchesSearch && a.status === assetFilter;
  });

  const handleCopyUrl = (url) => {
    navigator.clipboard.writeText(url);
    showToast('Asset URL copied to clipboard!', 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Title Bar */}
      <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Media Studio</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Central digital asset management, AI generation, and publishing workflows for the marketplace in {currentZone}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => showToast('Opening bulk upload dialog...', 'info')}>
            <Upload size={16} /> Bulk Upload
          </button>
          <button className="btn btn-primary" onClick={() => showToast('Generating creative assets via AI...', 'success')}>
            <Sparkles size={16} /> AI Generator
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '12px', display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#991b1b', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            Failed to load media: {error}
          </div>
          <button className="btn btn-secondary" onClick={fetchMedia}>Retry</button>
        </div>
      )}

      {/* Stats Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>TOTAL DIGITAL ASSETS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '80px' }} /> : kpis.totalAssets?.toLocaleString()}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>AI GENERATED IMAGES</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.aiGenerated?.toLocaleString()}
          </div>
        </div>

        <div className="card-sm" style={{ borderLeft: '3px solid var(--accent-orange)' }}>
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>PENDING APPROVALS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '40px' }} /> : kpis.pendingApprovals}
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>STORAGE USAGE</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : `${kpis.storageUsage} TB`}
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>/ 10 TB</span>
          </div>
        </div>

        <div className="card-sm">
          <div style={{ fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)' }}>CDN CACHE STATUS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: '#16a34a', marginTop: '4px' }}>
            {loading ? <div className="skeleton" style={{ height: '20px', width: '60px' }} /> : kpis.cdnStatus}
          </div>
        </div>
      </div>

      {/* Main layout: Sidebar widgets + assets grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '20px' }}>
        {/* Left Side Utilities */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Content Assistant Widget */}
          <div className="card" style={{ border: '1px solid #e9d5ff', background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-purple)', fontWeight: '700', fontSize: '13px' }}>
              <Brain size={18} />
              <span>Content Assistant</span>
            </div>
            <p style={{ fontSize: '11px', color: '#6b21a8', lineHeight: '1.4' }}>
              Generate localized banners or predict engagement for campaigns.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              <button className="ai-btn-purple" style={{ width: '100%', fontSize: '11px' }} onClick={() => showToast('Generating creative campaign banner...', 'success')}>
                Generate Campaign Banner
              </button>
              <button className="btn btn-secondary" style={{ background: '#ffffff', color: '#374151', fontSize: '11px', width: '100%', padding: '6px' }} onClick={() => showToast('Rewriting copy options...', 'info')}>
                Rewrite Marketing Copy
              </button>
            </div>
          </div>

          {/* Filters card */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)' }}>Filters</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button className={`pill ${assetFilter === 'ALL' ? 'active' : ''}`} style={{ width: '100%', justifycontent: 'flex-start' }} onClick={() => setAssetFilter('ALL')}>All Assets</button>
              <button className={`pill ${assetFilter === 'Published' ? 'active' : ''}`} style={{ width: '100%', justifycontent: 'flex-start' }} onClick={() => setAssetFilter('Published')}>Published Only</button>
              <button className={`pill ${assetFilter === 'Pending' ? 'active' : ''}`} style={{ width: '100%', justifycontent: 'flex-start' }} onClick={() => setAssetFilter('Pending')}>Pending Approval</button>
              <button className={`pill ${assetFilter === 'Draft' ? 'active' : ''}`} style={{ width: '100%', justifycontent: 'flex-start' }} onClick={() => setAssetFilter('Draft')}>Drafts</button>
            </div>
          </div>
        </div>

        {/* Right Side Assets List */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '300px' }}>
              <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '9px' }} />
              <input
                type="text"
                placeholder="Search asset files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '32px', fontSize: '12px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '6px', background: 'var(--border-color)', padding: '2px', borderRadius: '8px' }}>
              <button
                onClick={() => setViewMode('grid')}
                style={{ border: 'none', background: viewMode === 'grid' ? '#ffffff' : 'transparent', padding: '4px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <Grid size={16} color={viewMode === 'grid' ? 'var(--text-main)' : 'var(--text-muted)'} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                style={{ border: 'none', background: viewMode === 'list' ? '#ffffff' : 'transparent', padding: '4px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <List size={16} color={viewMode === 'list' ? 'var(--text-main)' : 'var(--text-muted)'} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="skeleton" style={{ height: '300px', width: '100%' }} />
          ) : filteredAssets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: '13px' }}>
              No asset records found in {currentZone} S3 bucket.
            </div>
          ) : viewMode === 'grid' ? (
            /* Grid View */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
              {filteredAssets.map(a => (
                <div key={a.id} className="card-sm" style={{ border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden', padding: 0 }}>
                  <div style={{ height: '120px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifycontent: 'center', overflow: 'hidden', position: 'relative' }}>
                    <span className={`chip ${a.status === 'Published' ? 'chip-green' : 'chip-orange'}`} style={{ position: 'absolute', top: '8px', right: '8px' }}>
                      {a.status}
                    </span>
                    {a.type === 'Image' ? (
                      <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '32px' }}>📹</span>
                    )}
                  </div>
                  <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: '700', color: 'var(--text-main)', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{a.category} • {a.size_mb} MB</div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                      <button style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--accent-blue)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '700' }} onClick={() => handleCopyUrl(a.url)}>
                        <Copy size={12} /> URL
                      </button>
                      <button style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--accent-red)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '700', marginLeft: 'auto' }} onClick={() => showToast('Deleting asset from S3 bucket...', 'info')}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* List View */
            <table className="data-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: '700', color: 'var(--text-main)' }}>{a.name}</td>
                    <td>{a.category}</td>
                    <td>{a.size_mb} MB</td>
                    <td>
                      <span className={`chip ${a.status === 'Published' ? 'chip-green' : 'chip-orange'}`}>{a.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-blue)', cursor: 'pointer' }} onClick={() => handleCopyUrl(a.url)}><Copy size={14} /></button>
                        <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}><ExternalLink size={14} /></a>
                        <button style={{ border: 'none', background: 'transparent', color: 'var(--accent-red)', cursor: 'pointer' }} onClick={() => showToast('Archiving asset...', 'info')}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
export default MediaStudioPage;
