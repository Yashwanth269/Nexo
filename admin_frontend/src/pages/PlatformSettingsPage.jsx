import React, { useState } from 'react';
import { Settings, Shield, Sliders, ToggleLeft, ToggleRight } from 'lucide-react';

export const PlatformSettingsPage = () => {
  const [autoMatching, setAutoMatching] = useState(true);
  const [surgePricing, setSurgePricing] = useState(true);
  const [shadowBanning, setShadowBanning] = useState(true);
  const [smsGateway, setSmsGateway] = useState('MSG91');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-main)' }}>Platform Settings & Feature Controls</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Realtime Feature Flags, Dispatch Overrides, AWS S3 Config & SMS Gateway Controls
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '16px' }}>Feature Toggles & Engine Controls</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>Automated PostGIS Dispatch</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Auto-assign closest 7km candidate workers</div>
              </div>
              <button
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => setAutoMatching(!autoMatching)}
              >
                {autoMatching ? <ToggleRight size={36} color="#10b981" /> : <ToggleLeft size={36} color="#64748b" />}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>Dynamic Surge Pricing</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Enable XGBoost surge multiplier algorithm</div>
              </div>
              <button
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => setSurgePricing(!surgePricing)}
              >
                {surgePricing ? <ToggleRight size={36} color="#10b981" /> : <ToggleLeft size={36} color="#64748b" />}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>Shadow Ban Enforcement</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>De-prioritize low reliability / fraud workers</div>
              </div>
              <button
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => setShadowBanning(!shadowBanning)}
              >
                {shadowBanning ? <ToggleRight size={36} color="#10b981" /> : <ToggleLeft size={36} color="#64748b" />}
              </button>
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '16px' }}>Infrastructure Configuration</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>ACTIVE SMS GATEWAY PROVIDER</label>
              <select value={smsGateway} onChange={(e) => setSmsGateway(e.target.value)} className="form-input">
                <option value="MSG91">MSG91 (Production SMS)</option>
                <option value="TWILIO">Twilio Programmable SMS</option>
                <option value="CONSOLE">Dev Console Logging</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>AWS S3 BUCKET REGION</label>
              <input type="text" value="ap-south-2 (Hyderabad)" disabled className="form-input" />
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>S3 BUCKET NAME</label>
              <input type="text" value="nexoassets" disabled className="form-input" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
