import React from 'react';
import { FileSpreadsheet, CheckCircle, Database } from 'lucide-react';

export const AuditLogsPage = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff' }}>Audit Logs & System Health</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          System Log Audit Trail, Database Migrations History (`schema_migrations`) & Redis Sentinel Health
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', marginBottom: '16px' }}>
          Executed PostgreSQL Schema Migrations (`schema_migrations`)
        </h3>

        <table className="data-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Migration Script Name</th>
              <th>Checksum (MD5)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: '700', color: '#60a5fa' }}>v24</td>
              <td style={{ fontWeight: '600', color: '#ffffff' }}>categories_refactor_3tier</td>
              <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>e4d3f2a18b9c...</td>
              <td><span className="badge badge-green"><CheckCircle size={12} /> APPLIED</span></td>
            </tr>
            <tr>
              <td style={{ fontWeight: '700', color: '#60a5fa' }}>v23</td>
              <td style={{ fontWeight: '600', color: '#ffffff' }}>team_jobs_and_daily_progress</td>
              <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>b9a8c7d6e5f4...</td>
              <td><span className="badge badge-green"><CheckCircle size={12} /> APPLIED</span></td>
            </tr>
            <tr>
              <td style={{ fontWeight: '700', color: '#60a5fa' }}>v22</td>
              <td style={{ fontWeight: '600', color: '#ffffff' }}>ml_training_data_extension</td>
              <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>a1b2c3d4e5f6...</td>
              <td><span className="badge badge-green"><CheckCircle size={12} /> APPLIED</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
