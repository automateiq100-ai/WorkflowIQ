'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type PendingDoc = {
  client_id: string;
  client_name: string;
  telegram_first_name: string | null;
  doc_type: string;
  label: string;
  deadline_date: string;
  followup_start_date: string;
  days_to_deadline: number;
  last_followup_at: string | null;
  followup_count: number;
};

const DOC_TYPE_LABELS: Record<string, string> = {
  gstr1_invoices: 'GSTR-1 Invoices',
  tds_challan: 'TDS Challan',
  sales_register: 'Sales Register',
  purchase_register: 'Purchase Register',
  bank_statement: 'Bank Statement',
};

function urgencyFromDays(days: number): { label: string; bg: string; fg: string } {
  if (days < 0) return { label: 'Overdue', bg: 'rgba(239, 68, 68, 0.18)', fg: 'var(--red)' };
  if (days <= 1) return { label: 'Critical', bg: 'rgba(239, 68, 68, 0.15)', fg: 'var(--red)' };
  if (days <= 3) return { label: 'Urgent', bg: 'rgba(245, 158, 11, 0.18)', fg: '#f59e0b' };
  if (days <= 6) return { label: 'Moderate', bg: 'rgba(99, 102, 241, 0.15)', fg: 'var(--purple)' };
  return { label: 'Calm', bg: 'var(--bg3)', fg: 'var(--text2)' };
}

export default function FollowUpQueuePage() {
  const [rows, setRows] = useState<PendingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(api('/api/practiceiq/documents/checklist?status=pending'));
      if (!r.ok) {
        if (r.status === 404) {
          setRows([]);
          setError('Follow-up Queue endpoint will be wired in the next step.');
        } else {
          setError(`Load failed: ${r.status}`);
        }
        setLoading(false);
        return;
      }
      const j = await r.json();
      setRows(j.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function sendReminder(row: PendingDoc) {
    const key = `${row.client_id}:${row.doc_type}`;
    setReminding(key);
    try {
      const r = await fetch(api(`/api/practiceiq/documents/${row.client_id}/remind`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_type: row.doc_type }),
      });
      if (!r.ok) {
        alert('Reminder endpoint will be wired in the next step (needs Python service running).');
        return;
      }
      load();
    } finally {
      setReminding(null);
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          Documents — Follow-up Queue
        </h1>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Pending documents across all clients. Shalini sends reminders automatically at 9 AM IST; use this to nudge before then.
        </p>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>
      ) : error ? (
        <div
          className="rounded-xl border p-6"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          <div className="text-sm mb-1">⚠ {error}</div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            This page renders once Step C creates the <code>/api/practiceiq/documents/checklist</code> route.
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-4xl mb-3">✅</div>
          <div className="text-sm" style={{ color: 'var(--text3)' }}>Nothing pending. All clients are caught up.</div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <Th>Client</Th><Th>Document</Th><Th>Deadline</Th>
                <Th>Days left</Th><Th>Urgency</Th><Th>Last reminder</Th><Th>#</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const u = urgencyFromDays(row.days_to_deadline);
                const key = `${row.client_id}:${row.doc_type}`;
                return (
                  <tr key={key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>
                      {row.client_name}
                      {row.telegram_first_name && (
                        <span className="ml-2 text-xs" style={{ color: 'var(--text3)' }}>
                          ({row.telegram_first_name}ji)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>
                      {DOC_TYPE_LABELS[row.doc_type] ?? row.doc_type}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>
                      {new Date(row.deadline_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>
                      {row.days_to_deadline >= 0 ? `${row.days_to_deadline}d` : `${-row.days_to_deadline}d late`}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded" style={{ background: u.bg, color: u.fg }}>
                        {u.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text3)' }}>
                      {row.last_followup_at ? new Date(row.last_followup_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text3)' }}>{row.followup_count ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => sendReminder(row)}
                        disabled={reminding === key}
                        className="text-xs px-3 py-1.5 rounded"
                        style={{
                          background: 'var(--purple)',
                          color: 'white',
                          opacity: reminding === key ? 0.5 : 1,
                        }}
                      >
                        {reminding === key ? 'Sending…' : 'Send reminder'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}
