'use client';

import { useEffect, useState } from 'react';
import type { RecurringTemplate, Cadence, Client } from '@/lib/practiceiq/types';
import { RECURRING_PRESETS } from '@/lib/practiceiq/compliance-calendar';

const CADENCES: Cadence[] = ['monthly', 'quarterly', 'annual'];

export default function RecurringPage() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);
  const [spawning, setSpawning] = useState(false);
  const [spawnMsg, setSpawnMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [t, c] = await Promise.all([
      fetch('/api/practiceiq/recurring').then(r => r.json()),
      fetch('/api/practiceiq/clients').then(r => r.json()),
    ]);
    setTemplates(t.data ?? []);
    setClients(c.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function spawn() {
    setSpawning(true);
    setSpawnMsg(null);
    const res = await fetch('/api/practiceiq/recurring/spawn', { method: 'POST' }).then(r => r.json());
    setSpawning(false);
    if (res.error) setSpawnMsg(`Error: ${res.error}`);
    else setSpawnMsg(`Created ${res.created} task${res.created === 1 ? '' : 's'}, skipped ${res.skipped} (already existed for this period).`);
  }

  async function toggleActive(t: RecurringTemplate) {
    await fetch(`/api/practiceiq/recurring/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: !t.active }),
    });
    load();
  }

  async function del(t: RecurringTemplate) {
    if (!confirm(`Delete recurring template "${t.title}"?`)) return;
    await fetch(`/api/practiceiq/recurring/${t.id}`, { method: 'DELETE' });
    load();
  }

  async function applyPreset(preset: typeof RECURRING_PRESETS[number]) {
    if (clients.length === 0) {
      alert('Add a client first before applying a preset.');
      return;
    }
    const clientId = prompt(
      `Apply "${preset.title}" to which client?\n\n${clients.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}\n\nEnter number:`
    );
    if (!clientId) return;
    const idx = parseInt(clientId) - 1;
    if (idx < 0 || idx >= clients.length) return;

    await fetch('/api/practiceiq/recurring', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...preset,
        client_id: clients[idx].id,
        active: true,
      }),
    });
    load();
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Recurring Templates
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Auto-generate compliance tasks on a cadence (GST, TDS, ROC, ITR)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={spawn}
            disabled={spawning || templates.filter(t => t.active).length === 0}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--teal)', color: '#000', opacity: spawning ? 0.5 : 1 }}
          >
            {spawning ? 'Generating...' : '⚡ Generate Next Tasks'}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--purple)', color: '#fff' }}
          >
            + Custom Template
          </button>
        </div>
      </div>

      {spawnMsg && (
        <div
          className="mb-4 px-4 py-2 rounded-lg text-sm"
          style={{ background: 'var(--bg3)', color: 'var(--teal)' }}
        >
          {spawnMsg}
        </div>
      )}

      {/* Preset library */}
      <div className="mb-8">
        <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Quick presets — click to apply</div>
        <div className="flex flex-wrap gap-2">
          {RECURRING_PRESETS.map(p => (
            <button
              key={p.title}
              onClick={() => applyPreset(p)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)' }}
            >
              {p.title} <span style={{ color: 'var(--text3)' }}>· {p.cadence}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Active templates</div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>
      ) : templates.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <div className="text-sm" style={{ color: 'var(--text3)' }}>
            No recurring templates yet. Click a preset above to add one.
          </div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <Th>Title</Th><Th>Client</Th><Th>Cadence</Th><Th>When</Th><Th>Last spawned</Th><Th>Active</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => {
                const client = clients.find(c => c.id === t.client_id);
                return (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{t.title}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{client?.name ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{t.cadence}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>
                      Day {t.day_of_month ?? '?'}{t.month_of_year ? `, month ${t.month_of_year}` : ''}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{t.last_spawned_for ?? '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(t)}
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: t.active ? 'rgba(15,212,160,0.15)' : 'var(--bg3)',
                          color: t.active ? 'var(--teal)' : 'var(--text3)',
                        }}
                      >
                        {t.active ? 'Active' : 'Paused'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditing(t)} className="text-xs mr-3" style={{ color: 'var(--purple)' }}>Edit</button>
                      <button onClick={() => del(t)} className="text-xs" style={{ color: 'var(--red)' }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(showForm || editing) && (
        <TemplateForm
          initial={editing ?? undefined}
          clients={clients}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}

function TemplateForm({
  initial, clients, onClose, onSaved,
}: {
  initial?: RecurringTemplate; clients: Client[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<RecurringTemplate>>(
    initial ?? { cadence: 'monthly', active: true, day_of_month: 11 }
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const url = initial?.id ? `/api/practiceiq/recurring/${initial.id}` : '/api/practiceiq/recurring';
    const method = initial?.id ? 'PATCH' : 'POST';
    await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        client_id: form.client_id || null,
        fee_amount: form.fee_amount === undefined || (form.fee_amount as unknown) === '' ? null : Number(form.fee_amount),
        day_of_month: form.day_of_month != null ? Number(form.day_of_month) : null,
        month_of_year: form.month_of_year != null ? Number(form.month_of_year) : null,
      }),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-xl" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          {initial?.id ? 'Edit Template' : 'New Recurring Template'}
        </h2>
        <div className="space-y-3">
          <Field label="Title *">
            <input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              <select value={form.client_id ?? ''} onChange={e => setForm({ ...form, client_id: e.target.value || null })} style={inputStyle}>
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Cadence">
              <select value={form.cadence ?? 'monthly'} onChange={e => setForm({ ...form, cadence: e.target.value as Cadence })} style={inputStyle}>
                {CADENCES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Day of month (1–31)">
              <input type="number" min={1} max={31} value={form.day_of_month ?? ''} onChange={e => setForm({ ...form, day_of_month: Number(e.target.value) })} style={inputStyle} />
            </Field>
            <Field label="Month of year (1–12, for annual/quarterly)">
              <input type="number" min={1} max={12} value={form.month_of_year ?? ''} onChange={e => setForm({ ...form, month_of_year: Number(e.target.value) })} style={inputStyle} />
            </Field>
            <Field label="Fee (₹)">
              <input type="number" value={form.fee_amount ?? ''} onChange={e => setForm({ ...form, fee_amount: Number(e.target.value) })} style={inputStyle} />
            </Field>
            <Field label="Assigned to">
              <input value={form.assigned_to ?? ''} onChange={e => setForm({ ...form, assigned_to: e.target.value })} style={inputStyle} />
            </Field>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.title} className="px-4 py-2 text-sm rounded-lg"
            style={{ background: 'var(--purple)', color: '#fff', opacity: saving || !form.title ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text1)',
  fontSize: 13,
};
