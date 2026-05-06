'use client';

import { useEffect, useState } from 'react';
import type { ExpenseClaim, ExpenseCategory } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

const CATEGORIES: ExpenseCategory[] = ['travel', 'meals', 'supplies', 'other'];
const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--amber)',
  approved: 'var(--green)',
  rejected: 'var(--red)',
};

export default function MyExpensePage() {
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    const j = await fetch(api('/api/practiceiq/hrms/expense-claims')).then(r => r.json());
    setClaims(j.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>My Expense</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>Submit and track expense claims.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--purple)', color: '#fff' }}>
          + New claim
        </button>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg3)' }}>
              <tr>
                <Th>Date</Th><Th>Category</Th><Th>Amount</Th><Th>Description</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {claims.map(c => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{c.claim_date}</td>
                  <td className="px-4 py-3 capitalize" style={{ color: 'var(--text2)' }}>{c.category}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>₹{Number(c.amount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 truncate max-w-xs" style={{ color: 'var(--text3)' }}>{c.description ?? '—'}</td>
                  <td className="px-4 py-3 text-xs uppercase font-bold" style={{ color: STATUS_COLOR[c.status] }}>{c.status}</td>
                </tr>
              ))}
              {claims.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-sm" style={{ color: 'var(--text3)' }}>No claims yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <NewClaimModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}

function NewClaimModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    claim_date: new Date().toISOString().slice(0, 10),
    category: 'travel' as ExpenseCategory,
    amount: '',
    description: '',
    receipt_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const res = await fetch(api('/api/practiceiq/hrms/expense-claims'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        amount: parseFloat(form.amount),
        receipt_url: form.receipt_url || null,
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Failed'); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-md" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>New expense claim</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" value={form.claim_date} onChange={e => setForm({ ...form, claim_date: e.target.value })} style={inputStyle} /></Field>
            <Field label="Category">
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as ExpenseCategory })} style={inputStyle}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Amount (₹)"><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={inputStyle} /></Field>
          <Field label="Description"><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} /></Field>
          <Field label="Receipt URL (optional)"><input value={form.receipt_url} onChange={e => setForm({ ...form, receipt_url: e.target.value })} style={inputStyle} /></Field>
        </div>
        {err && <div className="text-xs mt-3" style={{ color: 'var(--red)' }}>{err}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.amount} className="px-4 py-2 text-sm rounded-lg" style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Submit'}
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
