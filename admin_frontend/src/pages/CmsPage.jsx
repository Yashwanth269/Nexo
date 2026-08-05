import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Megaphone, Plus, RefreshCw } from 'lucide-react';

export const CmsPage = () => {
  const { showToast } = useAuth();
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');

  const fetchBanners = async () => {
    setLoading(true);
    try {
      const res = await api.getCmsBanners().catch(() => ({ banners: [] }));
      setBanners(res.banners || res.data || []);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBanners();
  }, []);

  const handleCreateBanner = async (e) => {
    e.preventDefault();
    if (!title || !subtitle) {
      showToast('Please enter both title and subtitle', 'error');
      return;
    }
    try {
      await api.createCmsBanner({
        title,
        subtitle,
        badge_text: 'SPECIAL OFFER',
        cta_text: 'Book Now ->',
        target_action: 'OPEN_CATEGORY',
        action_payload: 'Home Repair'
      });
      showToast('New hero banner published live!', 'success');
      setTitle('');
      setSubtitle('');
      fetchBanners();
    } catch (err) {
      showToast(`Creation failed: ${err.message}`, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff' }}>CMS & Communications Hub</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Dynamic Hero Offer Banners, App Announcements & Quick Action Row Studio
          </p>
        </div>
        <button className="btn btn-secondary" onClick={fetchBanners} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span>Refresh Banners</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        <form onSubmit={handleCreateBanner} className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff' }}>Publish New Hero Banner</h3>
          
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>BANNER TITLE</label>
            <input
              type="text"
              placeholder="e.g. Festive Home Care Bonanza"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>SUBTITLE / PROMO TEXT</label>
            <input
              type="text"
              placeholder="e.g. Up to 40% OFF on Plumbing & Electrical"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="form-input"
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>
            <Plus size={16} />
            <span>Publish Banner</span>
          </button>
        </form>

        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', marginBottom: '16px' }}>Active App Banners</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {banners.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Default campaign hero banner active in app.</div>
            ) : (
              banners.map((b, idx) => (
                <div key={idx} style={{ background: '#0f172a', padding: '14px', borderRadius: '10px', border: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="badge badge-orange">{b.badge_text || 'SPECIAL OFFER'}</span>
                    <h4 style={{ fontSize: '15px', fontWeight: '700', color: '#ffffff', marginTop: '4px' }}>{b.title}</h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{b.subtitle}</p>
                  </div>
                  <span className="badge badge-green">LIVE</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
