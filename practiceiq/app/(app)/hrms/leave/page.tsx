'use client';

import { useEffect, useState } from 'react';
import type { LeaveRequest, LeaveType } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

const LEAVE_TYPES: LeaveType[] = ['casual', 'sick', 'earned', 'unpaid'];

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--amber)',
  approved: 'var(--green)',
  rejected: 'var(--red)',
};

export default function MyLeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch(api('/api/practiceiq/hrms/leave-requests')).then(r => r.json());
    setRequests(r.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>My Leave</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>Apply for leave and review your history.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--purple)', color: '#fff' }}>
          + Apply leave
        </button>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg3)' }}>
              <tr>
                <Th>Type</Th><Th>From</Th><Th>To</Th><Th>Days</Th><Th>Reason</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-4 py-3 capitalize" style={{ color: 'var(--text1)' }}>{r.leave_type}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{r.from_date}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{r.to_date}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{r.days}</td>
                  <td className="px-4 py-3 truncate max-w-xs" style={{ color: 'var(--text3)' }}>{r.reason ?? '—'}</td>
                  <td className="px-4 py-3 text-xs uppercase font-bold" style={{ color: STATUS_COLOR[r.status] }}>{r.status}</td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--text3)' }}>No leave requests yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ApplyLeaveModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}

function ApplyLeaveModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<{ leave_type: LeaveType; from_date: string; to_date: string; reason: string }>({
    leave_type: 'casual',
    from_date: new Date().toISOString().slice(0, 10),
    to_date: new Date().toISOString().slice(0, 10),
    reason: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const res = await fetch(api('/api/practiceiq/hrms/leave-requests'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Failed'); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-md" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Apply for leave</h2>
        <div className="space-y-3">
          <Field label="Leave type">
            <select value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value as LeaveType })} style={inputStyle}>
              {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" value={form.from_date} onChange={e => setForm({ ...form, from_date: e.target.value })} style={inputStyle} /></Field>
            <Field label="To"><input type="date" value={form.to_date} onChange={e => setForm({ ...form, to_date: e.target.value })} style={inputStyle} /></Field>
          </div>
          <Field label="Reason"><textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} /></Field>
        </div>
        {err && <div className="text-xs mt-3" style={{ color: 'var(--red)' }}>{err}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg" style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>{children}</label>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', fontSize: 13,
};
