'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Client, ClientType, ServiceTag } from '@/lib/practiceiq/types';

const SERVICES: ServiceTag[] = ['gst', 'tds', 'itr', 'audit', 'roc', 'bookkeeping'];
const TYPES: ClientType[] = ['individual', 'company', 'llp', 'partnership'];

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/practiceiq/clients').then(r => r.json());
    setClients(res.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = clients.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.pan?.toLowerCase().includes(search.toLowerCase()) ||
    c.gstin?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Clients
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            {clients.length} client{clients.length === 1 ? '' : 's'} on file
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          + Add Client
        </button>
      </div>

      <input
        placeholder="Search by name, PAN, GSTIN..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full mb-4 px-4 py-2 rounded-lg text-sm"
        style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text1)' }}
      />

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-xl border p-12 text-center"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <div className="text-4xl mb-3">👥</div>
          <div className="text-sm mb-2" style={{ color: 'var(--text2)' }}>No clients yet.</div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>Click "Add Client" to get started.</div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>PAN</Th>
                <Th>GSTIN</Th>
                <Th>Services</Th>
                <Th>Contact</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td>
                    <Link href={`/practiceiq/clients/${c.id}`} style={{ color: 'var(--text1)' }}>
                      {c.name}
                    </Link>
                  </Td>
                  <Td color="var(--text2)">{c.client_type ?? '—'}</Td>
                  <Td color="var(--text2)" mono>{c.pan ?? '—'}</Td>
                  <Td color="var(--text2)" mono>{c.gstin ?? '—'}</Td>
                  <Td color="var(--text3)">{c.services?.join(', ') ?? '—'}</Td>
                  <Td color="var(--text3)">{c.email ?? c.phone ?? '—'}</Td>
                  <Td>
                    <Link href={`/practiceiq/clients/${c.id}`} style={{ color: 'var(--purple)', fontSize: 12 }}>
                      View →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ClientForm
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
function Td({ children, color, mono }: { children: React.ReactNode; color?: string; mono?: boolean }) {
  return (
    <td
      className="px-4 py-3"
      style={{ color: color ?? 'var(--text1)', fontFamily: mono ? 'var(--font-dm-mono)' : undefined }}
    >
      {children}
    </td>
  );
}

export function ClientForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Partial<Client>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Client>>(initial ?? { client_type: 'individual', services: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const url = initial?.id ? `/api/practiceiq/clients/${initial.id}` : '/api/practiceiq/clients';
    const method = initial?.id ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    }).then(r => r.json());
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  }

  function toggleService(s: ServiceTag) {
    const cur = form.services ?? [];
    setForm({ ...form, services: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border p-6 w-full max-w-2xl max-h-[90vh] overflow-auto"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          {initial?.id ? 'Edit Client' : 'New Client'}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name *">
            <input value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Type">
            <select value={form.client_type ?? ''} onChange={e => setForm({ ...form, client_type: e.target.value as ClientType })} style={inputStyle}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="PAN">
            <input value={form.pan ?? ''} onChange={e => setForm({ ...form, pan: e.target.value.toUpperCase() })} style={inputStyle} />
          </Field>
          <Field label="GSTIN">
            <input value={form.gstin ?? ''} onChange={e => setForm({ ...form, gstin: e.target.value.toUpperCase() })} style={inputStyle} />
          </Field>
          <Field label="Email">
            <input value={form.email ?? ''} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Phone">
            <input value={form.phone ?? ''} onChange={e => setForm({ ...form, phone: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Assigned to">
            <input value={form.assigned_to ?? ''} onChange={e => setForm({ ...form, assigned_to: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Address">
            <input value={form.address ?? ''} onChange={e => setForm({ ...form, address: e.target.value })} style={inputStyle} />
          </Field>
        </div>

        <div className="mt-4">
          <div className="text-xs mb-2" style={{ color: 'var(--text3)' }}>Services</div>
          <div className="flex flex-wrap gap-2">
            {SERVICES.map(s => {
              const active = form.services?.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleService(s)}
                  className="px-3 py-1 rounded-full text-xs uppercase"
                  style={{
                    background: active ? 'var(--purple)' : 'var(--bg3)',
                    color: active ? '#fff' : 'var(--text2)',
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <Field label="Notes">
            <textarea value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} />
          </Field>
        </div>

        {error && <div className="mt-3 text-xs" style={{ color: 'var(--red)' }}>{error}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
          <button
            onClick={save}
            disabled={saving || !form.name}
            className="px-4 py-2 text-sm rounded-lg"
            style={{ background: 'var(--purple)', color: '#fff', opacity: saving || !form.name ? 0.5 : 1 }}
          >
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
