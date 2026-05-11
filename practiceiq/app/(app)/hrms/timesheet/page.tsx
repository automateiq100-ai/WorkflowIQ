'use client';

import { useEffect, useState, useMemo } from 'react';
import type { TimesheetEntry, Client } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay() === 0 ? 6 : x.getDay() - 1; // ISO week starts Monday
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmt(d: Date) { return d.toISOString().slice(0, 10); }

export default function TimesheetPage() {
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()));
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
  }), [weekStart]);

  async function load() {
    setLoading(true);
    const from = fmt(days[0]);
    const to = fmt(days[6]);
    const [t, c] = await Promise.all([
      fetch(api(`/api/practiceiq/hrms/timesheet?from=${from}&to=${to}`)).then(r => r.json()),
      fetch(api('/api/practiceiq/clients')).then(r => r.json()),
    ]);
    setEntries(t.data ?? []);
    setClients(c.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart]);

  function shift(deltaDays: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + deltaDays);
    setWeekStart(startOfWeek(d));
  }

  // Group entries: rows are unique (client_id, billable) combos; columns are days.
  const rows = useMemo(() => {
    type Key = string;
    const m = new Map<Key, { client_id: string | null; billable: boolean; byDate: Record<string, number> }>();
    for (const e of entries) {
      const k = `${e.client_id ?? '_'}|${e.billable ? 'b' : 'nb'}`;
      const cur = m.get(k) ?? { client_id: e.client_id, billable: e.billable, byDate: {} };
      cur.byDate[e.date] = (cur.byDate[e.date] ?? 0) + Number(e.hours);
      m.set(k, cur);
    }
    return Array.from(m.values());
  }, [entries]);

  const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Timesheet</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Week of {fmt(days[0])} — {fmt(days[6])} · {totalHours.toFixed(2)} h logged
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-7)} className="px-3 py-1 text-xs rounded" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>← Prev</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="px-3 py-1 text-xs rounded" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>This week</button>
          <button onClick={() => shift(7)} className="px-3 py-1 text-xs rounded" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>Next →</button>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--purple)', color: '#fff' }}>+ New entry</button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg3)' }}>
              <tr>
                <Th>Client</Th>
                <Th>Type</Th>
                {days.map(d => (
                  <Th key={fmt(d)}>{d.toLocaleDateString([], { weekday: 'short' })} {d.getDate()}</Th>
                ))}
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const clientName = r.client_id ? (clients.find(c => c.id === r.client_id)?.name ?? '—') : 'No client';
                const total = days.reduce((s, d) => s + (r.byDate[fmt(d)] ?? 0), 0);
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2" style={{ color: 'var(--text1)' }}>{clientName}</td>
                    <td className="px-4 py-2 text-xs" style={{ color: r.billable ? 'var(--green)' : 'var(--text3)' }}>
                      {r.billable ? 'Billable' : 'Non-billable'}
                    </td>
                    {days.map(d => {
                      const h = r.byDate[fmt(d)] ?? 0;
                      return <td key={fmt(d)} className="px-4 py-2" style={{ color: 'var(--text2)' }}>{h ? h.toFixed(2) : '—'}</td>;
                    })}
                    <td className="px-4 py-2" style={{ color: 'var(--text1)' }}>{total.toFixed(2)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={days.length + 3} className="text-center py-8 text-sm" style={{ color: 'var(--text3)' }}>No entries for this week.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <NewEntryModal
          clients={clients}
          defaultDate={fmt(days[0])}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}

function NewEntryModal({ clients, defaultDate, onClose, onSaved }: {
  clients: Client[]; defaultDate: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    date: defaultDate,
    client_id: '',
    hours: '',
    description: '',
    billable: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const res = await fetch(api('/api/practiceiq/hrms/timesheet'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: form.date,
        client_id: form.client_id || null,
        hours: parseFloat(form.hours),
        description: form.description || null,
        billable: form.billable,
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Failed'); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-md" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>New timesheet entry</h2>
        <div className="space-y-3">
          <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inputStyle} /></Field>
          <Field label="Client (optional)">
            <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} style={inputStyle}>
              <option value="">— None —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Hours"><input type="number" step="0.25" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} style={inputStyle} /></Field>
          <Field label="Description"><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} /></Field>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text1)' }}>
            <input type="checkbox" checked={form.billable} onChange={e => setForm({ ...form, billable: e.target.checked })} />
            <span>Billable</span>
          </label>
        </div>
        {err && <div className="text-xs mt-3" style={{ color: 'var(--red)' }}>{err}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.hours} className="px-4 py-2 text-sm rounded-lg" style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
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
