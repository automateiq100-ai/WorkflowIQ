'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Client, ClientType, ServiceTemplate } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';
import {
  SmallField,
  smallInput,
  emptyServiceDraft,
  draftToPayload,
  templateToServiceDraft,
  type ServiceDraft,
} from '@/components/practiceiq/ServiceEditor';

type TelegramDraft = {
  telegram_chat_id: string;
  label: string;
  is_primary: boolean;
};

type EmailDraft = {
  email: string;
  label: string;
  is_primary: boolean;
};

const TYPES: ClientType[] = ['individual', 'company', 'llp', 'partnership'];

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch(api('/api/practiceiq/clients')).then(r => r.json());
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
                <Th>Contact</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td>
                    <Link href={`/clients/${c.id}`} style={{ color: 'var(--text1)' }}>
                      {c.name}
                    </Link>
                  </Td>
                  <Td color="var(--text2)">{c.client_type ?? '—'}</Td>
                  <Td color="var(--text2)" mono>{c.pan ?? '—'}</Td>
                  <Td color="var(--text2)" mono>{c.gstin ?? '—'}</Td>
                  <Td color="var(--text3)">{c.phone ?? '—'}</Td>
                  <Td>
                    <Link href={`/clients/${c.id}`} style={{ color: 'var(--purple)', fontSize: 12 }}>
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
  const isNew = !initial?.id;
  const [form, setForm] = useState<Partial<Client>>(
    initial ?? { client_type: 'individual', followup_broadcast: false },
  );
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [emails, setEmails] = useState<EmailDraft[]>([]);
  const [telegram, setTelegram] = useState<TelegramDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew) return;
    fetch(api('/api/practiceiq/service-templates'))
      .then(r => r.json())
      .then(r => setTemplates(r.data ?? []));
  }, [isNew]);

  async function save() {
    setSaving(true);
    setError(null);

    const clientUrl = initial?.id ? api(`/api/practiceiq/clients/${initial.id}`) : api('/api/practiceiq/clients');
    const clientMethod = initial?.id ? 'PATCH' : 'POST';
    const clientRes = await fetch(clientUrl, {
      method: clientMethod,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    }).then(r => r.json());

    if (clientRes.error) {
      setSaving(false);
      setError(clientRes.error);
      return;
    }

    if (isNew) {
      const newId = clientRes.data.id;

      for (const s of services) {
        if (!s.service.trim()) continue;
        const r = await fetch(api(`/api/practiceiq/clients/${newId}/services`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draftToPayload(s)),
        }).then(r => r.json());
        if (r.error) {
          setSaving(false);
          setError(`Client created but service "${s.service}" failed: ${r.error}. Continue editing on the client page.`);
          onSaved();
          return;
        }
      }

      let primaryEmailAssigned = false;
      for (const em of emails) {
        if (!em.email.trim()) continue;
        const wantsPrimary = em.is_primary && !primaryEmailAssigned;
        if (wantsPrimary) primaryEmailAssigned = true;
        const r = await fetch(api(`/api/practiceiq/clients/${newId}/emails`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: em.email.trim(),
            label: em.label.trim() || null,
            is_primary: wantsPrimary,
          }),
        }).then(r => r.json());
        if (r.error) {
          setSaving(false);
          setError(`Client created but email "${em.email}" failed: ${r.error}. Continue editing on the client page.`);
          onSaved();
          return;
        }
      }

      let primaryAssigned = false;
      for (const t of telegram) {
        if (!t.telegram_chat_id.trim()) continue;
        const wantsPrimary = t.is_primary && !primaryAssigned;
        if (wantsPrimary) primaryAssigned = true;
        const r = await fetch(api(`/api/practiceiq/clients/${newId}/telegram-accounts`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            telegram_chat_id: Number(t.telegram_chat_id),
            label: t.label.trim() || null,
            is_primary: wantsPrimary,
          }),
        }).then(r => r.json());
        if (r.error) {
          setSaving(false);
          setError(`Client created but Telegram account "${t.label || t.telegram_chat_id}" failed: ${r.error}. Continue editing on the client page.`);
          onSaved();
          return;
        }
      }
    }

    setSaving(false);
    onSaved();
  }

  function addService() {
    setServices([...services, emptyServiceDraft()]);
  }
  function pickServiceTemplate(idx: number, serviceName: string) {
    const next = services.slice();
    if (!serviceName) {
      next[idx] = emptyServiceDraft();
    } else {
      const t = templates.find(x => x.service === serviceName);
      if (t) next[idx] = templateToServiceDraft(t);
    }
    setServices(next);
  }
  function removeService(idx: number) {
    setServices(services.filter((_, i) => i !== idx));
  }

  function addTelegram() {
    setTelegram([...telegram, { telegram_chat_id: '', label: '', is_primary: telegram.length === 0 }]);
  }
  function updateTelegram(idx: number, patch: Partial<TelegramDraft>) {
    const next = telegram.slice();
    next[idx] = { ...next[idx], ...patch };
    if (patch.is_primary) {
      next.forEach((t, i) => { if (i !== idx) t.is_primary = false; });
    }
    setTelegram(next);
  }
  function removeTelegram(idx: number) {
    setTelegram(telegram.filter((_, i) => i !== idx));
  }

  function addEmail() {
    setEmails([...emails, { email: '', label: '', is_primary: emails.length === 0 }]);
  }
  function updateEmail(idx: number, patch: Partial<EmailDraft>) {
    const next = emails.slice();
    next[idx] = { ...next[idx], ...patch };
    if (patch.is_primary) {
      next.forEach((em, i) => { if (i !== idx) em.is_primary = false; });
    }
    setEmails(next);
  }
  function removeEmail(idx: number) {
    setEmails(emails.filter((_, i) => i !== idx));
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

        <div
          className="mt-4 flex items-center justify-between rounded-lg p-3"
          style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
        >
          <div>
            <div className="text-xs" style={{ color: 'var(--text1)' }}>Broadcast follow-ups to all linked Telegram accounts</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
              Off = primary account only.
            </div>
          </div>
          <input
            type="checkbox"
            checked={!!form.followup_broadcast}
            onChange={e => setForm({ ...form, followup_broadcast: e.target.checked })}
          />
        </div>

        <div className="mt-4">
          <Field label="Notes">
            <textarea value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} />
          </Field>
        </div>

        {isNew && (
          <>
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase" style={{ color: 'var(--text3)' }}>
                  Services ({services.length})
                </div>
                <button
                  onClick={addService}
                  className="text-[11px] px-2 py-1 rounded"
                  style={{ background: 'var(--purple)', color: '#fff' }}
                >
                  + Add service
                </button>
              </div>

              {templates.length === 0 ? (
                <div
                  className="text-[11px] rounded-lg p-3"
                  style={{ background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}
                >
                  No service templates yet. Create them on the Services page first.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {services.map((s, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg p-3"
                      style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-center gap-2">
                        <select
                          value={s.service}
                          onChange={e => pickServiceTemplate(idx, e.target.value)}
                          style={{ ...smallInput, flex: 1 }}
                        >
                          <option value="">Pick a template…</option>
                          {templates.map(t => (
                            <option key={t.id} value={t.service}>{t.service}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeService(idx)}
                          style={{ color: 'var(--red)', fontSize: 14, padding: '0 6px' }}
                        >×</button>
                      </div>
                      {s.service && (
                        <div className="text-[11px] mt-2" style={{ color: 'var(--text3)' }}>
                          {s.cadence}
                          {s.deadline_day !== '' && ` · day ${s.deadline_day}`}
                          {s.deadline_month !== '' && ` · month ${s.deadline_month}`}
                          {s.followup_lead_days !== '' && ` · T-${s.followup_lead_days}`}
                          {s.doc_types.length > 0 && ` · ${s.doc_types.length} doc type${s.doc_types.length === 1 ? '' : 's'}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase" style={{ color: 'var(--text3)' }}>
                  Emails ({emails.length})
                </div>
                <button
                  onClick={addEmail}
                  className="text-[11px] px-2 py-1 rounded"
                  style={{ background: 'var(--purple)', color: '#fff' }}
                >
                  + Add email
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {emails.map((em, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg p-3"
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
                  >
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <SmallField label="Email *">
                          <input
                            type="email"
                            value={em.email}
                            onChange={e => updateEmail(idx, { email: e.target.value })}
                            placeholder="rajesh@example.com"
                            style={smallInput}
                          />
                        </SmallField>
                      </div>
                      <div className="col-span-4">
                        <SmallField label="Label">
                          <input
                            value={em.label}
                            onChange={e => updateEmail(idx, { label: e.target.value })}
                            placeholder="e.g. Personal / Office"
                            style={smallInput}
                          />
                        </SmallField>
                      </div>
                      <label className="col-span-2 flex items-center gap-1 text-[11px]" style={{ color: 'var(--text2)' }}>
                        <input
                          type="radio"
                          name="primary-email"
                          checked={em.is_primary}
                          onChange={() => updateEmail(idx, { is_primary: true })}
                        />
                        Primary
                      </label>
                      <button
                        onClick={() => removeEmail(idx)}
                        className="col-span-1 text-right"
                        style={{ color: 'var(--red)', fontSize: 14 }}
                      >×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase" style={{ color: 'var(--text3)' }}>
                  Telegram accounts ({telegram.length})
                </div>
                <button
                  onClick={addTelegram}
                  className="text-[11px] px-2 py-1 rounded"
                  style={{ background: 'var(--purple)', color: '#fff' }}
                >
                  + Add account
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {telegram.map((t, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg p-3"
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
                  >
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <SmallField label="Chat ID *">
                          <input
                            value={t.telegram_chat_id}
                            onChange={e => updateTelegram(idx, { telegram_chat_id: e.target.value })}
                            placeholder="123456789"
                            style={smallInput}
                          />
                        </SmallField>
                      </div>
                      <div className="col-span-4">
                        <SmallField label="Label">
                          <input
                            value={t.label}
                            onChange={e => updateTelegram(idx, { label: e.target.value })}
                            placeholder="e.g. Rajesh-ji"
                            style={smallInput}
                          />
                        </SmallField>
                      </div>
                      <label className="col-span-2 flex items-center gap-1 text-[11px]" style={{ color: 'var(--text2)' }}>
                        <input
                          type="radio"
                          name="primary-telegram"
                          checked={t.is_primary}
                          onChange={() => updateTelegram(idx, { is_primary: true })}
                        />
                        Primary
                      </label>
                      <button
                        onClick={() => removeTelegram(idx)}
                        className="col-span-1 text-right"
                        style={{ color: 'var(--red)', fontSize: 14 }}
                      >×</button>
                    </div>
                  </div>
                ))}
              </div>

              {telegram.length > 0 && (
                <div className="mt-2 text-[11px]" style={{ color: 'var(--text3)' }}>
                  Generate t.me invite links from the client detail page after saving.
                </div>
              )}
            </div>
          </>
        )}

        {!isNew && (
          <div
            className="mt-4 text-[11px] rounded-lg p-3"
            style={{ background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}
          >
            Manage services and Telegram accounts on the client detail page.
          </div>
        )}

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
