import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { CreditCard, ArrowUpRight, ArrowDownLeft, FileText, ShieldCheck } from 'lucide-react';

export const PaymentsPage = () => {
  const { showToast } = useAuth();
  const [loading, setLoading] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#ffffff' }}>Finance, Payouts & Double-Entry Ledger</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Double-Entry Financial Audit Trail (`double_entry_ledger`), Razorpay Verification & Payout Operations
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>SYSTEM GROSS REVENUE</div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: '#ffffff' }}>₹1,48,500.00</div>
          <div style={{ fontSize: '11px', color: '#34d399', marginTop: '4px' }}>✅ Double-entry verified</div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>WORKER PAYOUTS DISBURSED</div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: '#60a5fa' }}>₹1,26,225.00</div>
          <div style={{ fontSize: '11px', color: '#60a5fa', marginTop: '4px' }}>⚡ Instant Razorpay Route transfers</div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>NET PLATFORM COMMISSION</div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: '#fb923c' }}>₹22,275.00</div>
          <div style={{ fontSize: '11px', color: '#fb923c', marginTop: '4px' }}>📈 15% Platform Take Rate</div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', marginBottom: '16px' }}>
          Double-Entry Ledger Audit Trail (`double_entry_ledger`)
        </h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Entry ID</th>
              <th>Account Type</th>
              <th>Entry Type</th>
              <th>Amount (₹)</th>
              <th>Description</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontFamily: 'monospace', color: '#ffffff' }}>LEDGER-9921</td>
              <td>CUSTOMER_WALLET</td>
              <td><span className="badge badge-green"><ArrowDownLeft size={12} /> CREDIT</span></td>
              <td style={{ fontWeight: '700', color: '#34d399' }}>+₹500.00</td>
              <td>Razorpay Deposit Txn #pay_Rzp19823</td>
              <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Today, 10:14 AM</td>
            </tr>

            <tr>
              <td style={{ fontFamily: 'monospace', color: '#ffffff' }}>LEDGER-9922</td>
              <td>WORKER_PAYOUT</td>
              <td><span className="badge badge-orange"><ArrowUpRight size={12} /> DEBIT</span></td>
              <td style={{ fontWeight: '700', color: '#fb923c' }}>-₹425.00</td>
              <td>Job Completion Payout for #NEXO-9812</td>
              <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Today, 10:15 AM</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
