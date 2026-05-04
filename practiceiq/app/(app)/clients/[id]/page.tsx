'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  Client,
  Task,
  Invoice,
  ClientService,
  ClientEmail,
  ClientTelegramAccount,
  ServiceTemplate,
} from '@/lib/practiceiq/types';
import { api } from '@/lib/api';
import { ClientForm } from '../page';
import {
  ServiceEditor,
  SmallField,
  smallInput,
  emptyServiceDraft,
  toDraft,
  draftToPayload,
  type ServiceDraft,
} from '@/components/practiceiq/ServiceEditor';

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [services, setServices] = useState<ClientService[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [emails, setEmails] = useState<ClientEmail[]>([]);
  const [telegram, setTelegram] = useState<ClientTelegramAccount[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editing, setEditing] = useState(false);

  async function load() {
    const [c, s, em, tg, t, i, tpl] = await Promise.all([
      fetch(api(`/api/practiceiq/clients/${id}`)).then(r => r.json()),
      fetch(api(`/api/practiceiq/clients/${id}/services`)).then(r => r.json()),
      fetch(api(`/api/practiceiq/clients/${id}/emails`)).then(r => r.json()),
      fetch(api(`/api/practiceiq/clients/${id}/telegram-accounts`)).then(r => r.json()),
      fetch(api(`/api/practiceiq/tasks?client_id=${id}`)).then(r => r.json()),
      fetch(api(`/api/practiceiq/invoices?client_id=${id}`)).then(r => r.json()),
      fetch(api(`/api/practiceiq/service-templates`)).then(r => r.json()),
    ]);
    setClient(c.data ?? null);
    setServices(s.data ?? []);
    setEmails(em.data ?? []);
    setTelegram(tg.data ?? []);
    setTasks(t.data ?? []);
    setInvoices(i.data ?? []);
    setTemplates(tpl.data ?? []);
  }

  useEffect(() => { load(); }, [id]);

  async function handleDelete() {
    if (!confirm('Delete this client and all linked tasks/invoices?')) return;
    await fetch(api(`/api/practiceiq/clients/${id}`), { method: 'DELETE' });
    router.push('/clients');
  }

  if (!client) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/clients" className="text-xs mb-4 inline-block" style={{ color: 'var(--text3)' }}>
        ← All clients
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            {client.name}
          </h1>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            {client.client_type} {client.pan && `· PAN ${client.pan}`} {client.gstin && `· GSTIN ${client.gstin}`}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs rounded" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>
            Edit
          </button>
          <button onClick={handleDelete} className="px-3 py-1.5 text-xs rounded" style={{ background: 'var(--bg3)', color: 'var(--red)' }}>
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Box title="Contact">
          <Row k="Phone" v={client.phone} />
          <Row k="Address" v={client.address} />
          <Row k="Assigned to" v={client.assigned_to} />
          <Row k="Follow-up broadcast" v={client.followup_broadcast ? 'All accounts' : 'Primary only'} />
          {client.notes && (
            <div className="mt-3 text-xs" style={{ color: 'var(--text2)' }}>{client.notes}</div>
          )}
        </Box>

        <ServicesPanel
          clientId={id}
          services={services}
          templates={templates}
          onChanged={load}
        />
      </div>

      <div className="mb-6">
        <EmailsPanel
          clientId={id}
          emails={emails}
          onChanged={load}
        />
      </div>

      <div className="mb-6">
        <TelegramPanel
          clientId={id}
          accounts={telegram}
          onChanged={load}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Box title={`Tasks (${tasks.length})`}>
          {tasks.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>No tasks yet.</div>
          ) : tasks.slice(0, 6).map(t => (
            <div key={t.id} className="flex justify-between text-xs py-1.5">
              <span style={{ color: 'var(--text1)' }}>{t.title}</span>
              <span style={{ color: 'var(--text3)' }}>{t.status} · {t.due_date ?? '—'}</span>
            </div>
          ))}
        </Box>
        <Box title={`Invoices (${invoices.length})`}>
          {invoices.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>No invoices yet.</div>
          ) : invoices.slice(0, 6).map(i => (
            <div key={i.id} className="flex justify-between text-xs py-1.5">
              <span style={{ color: 'var(--text1)' }}>{i.invoice_number}</span>
              <span style={{ color: 'var(--text3)' }}>₹{Number(i.total).toLocaleString('en-IN')} · {i.status}</span>
            </div>
          ))}
        </Box>
      </div>

      {editing && (
        <ClientForm
          initial={client}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}
    </div>
  );
}

function Box({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase" style={{ color: 'var(--text3)' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span style={{ color: 'var(--text3)' }}>{k}</span>
      <span style={{ color: 'var(--text1)' }}>{v ?? '—'}</span>
    </div>
  );
}

// ---------------- Services panel ----------------

function ServicesPanel({
  clientId,
  services,
  templates,
  onChanged,
}: {
  clientId: string;
  services: ClientService[];
  templates: ServiceTemplate[];
  onChanged: () => void | Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setDraft(emptyServiceDraft());
    setEditingId('new');
    setError(null);
  }

  function startEdit(s: ClientService) {
    setDraft(toDraft(s));
    setEditingId(s.id);
    setError(null);
  }

  function cancel() {
    setEditingId(null);
    setError(null);
  }

  async function save() {
    if (!draft.service.trim()) { setError('Service name required'); return; }
    setSaving(true);
    setError(null);

    const payload = draftToPayload(draft);

    const url = editingId === 'new'
      ? api(`/api/practiceiq/clients/${clientId}/services`)
      : api(`/api/practiceiq/clients/${clientId}/services/${editingId}`);
    const method = editingId === 'new' ? 'POST' : 'PATCH';

    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());

    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setEditingId(null);
    await onChanged();
  }

  async function remove(serviceId: string) {
    if (!confirm('Delete this service and its checklist mapping?')) return;
    await fetch(api(`/api/practiceiq/clients/${clientId}/services/${serviceId}`), { method: 'DELETE' });
    await onChanged();
  }

  return (
    <Box
      title={`Services (${services.length})`}
      action={
        <button
          onClick={startNew}
          className="text-[11px] px-2 py-1 rounded"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          + Add
        </button>
      }
    >
      {services.length === 0 && editingId !== 'new' && (
        <div className="text-xs" style={{ color: 'var(--text3)' }}>No services configured.</div>
      )}

      <div className="flex flex-col gap-2">
        {services.map(s => editingId === s.id ? (
          <ServiceEditor
            key={s.id}
            draft={draft}
            setDraft={setDraft}
            saving={saving}
            error={error}
            onSave={save}
            onCancel={cancel}
          />
        ) : (
          <div
            key={s.id}
            className="rounded-lg p-3"
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs" style={{ color: 'var(--text1)' }}>
                  {s.service}{!s.active && ' · inactive'}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                  {s.cadence}
                  {s.deadline_day && ` · day ${s.deadline_day}`}
                  {s.deadline_month && ` · month ${s.deadline_month}`}
                  {s.followup_lead_days != null && ` · T-${s.followup_lead_days}`}
                </div>
                {s.doc_types && s.doc_types.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.doc_types.map(dt => (
                      <span
                        key={dt.id}
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
                      >
                        {dt.label || dt.doc_type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(s)} className="text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--text2)' }}>Edit</button>
                <button onClick={() => remove(s.id)} className="text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--red)' }}>Delete</button>
              </div>
            </div>
          </div>
        ))}

        {editingId === 'new' && (
          <ServiceEditor
            draft={draft}
            setDraft={setDraft}
            saving={saving}
            error={error}
            onSave={save}
            onCancel={cancel}
            templates={templates}
          />
        )}
      </div>
    </Box>
  );
}

// ---------------- Emails panel ----------------

function EmailsPanel({
  clientId,
  emails,
  onChanged,
}: {
  clientId: string;
  emails: ClientEmail[];
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [label, setLabel] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!emailValue.trim()) { setError('Email required'); return; }
    const res = await fetch(api(`/api/practiceiq/clients/${clientId}/emails`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: emailValue.trim(),
        label: label || null,
        is_primary: isPrimary,
      }),
    }).then(r => r.json());
    if (res.error) { setError(res.error); return; }
    setEmailValue(''); setLabel(''); setIsPrimary(false); setAdding(false);
    await onChanged();
  }

  async function setPrimary(id: string) {
    await fetch(api(`/api/practiceiq/clients/${clientId}/emails/${id}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_primary: true }),
    });
    await onChanged();
  }

  async function remove(id: string) {
    if (!confirm('Remove this email?')) return;
    await fetch(api(`/api/practiceiq/clients/${clientId}/emails/${id}`), { method: 'DELETE' });
    await onChanged();
  }

  return (
    <Box
      title={`Emails (${emails.length})`}
      action={
        <button
          onClick={() => setAdding(v => !v)}
          className="text-[11px] px-2 py-1 rounded"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          {adding ? 'Cancel' : '+ Add email'}
        </button>
      }
    >
      {emails.length === 0 && !adding && (
        <div className="text-xs" style={{ color: 'var(--text3)' }}>No emails on file.</div>
      )}

      <div className="flex flex-col gap-2">
        {emails.map(em => (
          <div
            key={em.id}
            className="rounded-lg p-3 flex items-center justify-between"
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
          >
            <div>
              <div className="text-xs" style={{ color: 'var(--text1)' }}>
                {em.email}
                {em.is_primary && (
                  <span
                    className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--purple)', color: '#fff' }}
                  >PRIMARY</span>
                )}
              </div>
              {em.label && (
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>{em.label}</div>
              )}
            </div>
            <div className="flex gap-1">
              {!em.is_primary && (
                <button onClick={() => setPrimary(em.id)} className="text-[11px] px-2 py-0.5" style={{ color: 'var(--text2)' }}>
                  Make primary
                </button>
              )}
              <button onClick={() => remove(em.id)} className="text-[11px] px-2 py-0.5" style={{ color: 'var(--red)' }}>
                Remove
              </button>
            </div>
          </div>
        ))}

        {adding && (
          <div
            className="rounded-lg p-3"
            style={{ background: 'var(--bg3)', border: '1px solid var(--purple)' }}
          >
            <div className="grid grid-cols-3 gap-2">
              <SmallField label="Email *">
                <input type="email" value={emailValue} onChange={e => setEmailValue(e.target.value)} placeholder="rajesh@example.com" style={smallInput} />
              </SmallField>
              <SmallField label="Label">
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Personal" style={smallInput} />
              </SmallField>
              <SmallField label="Primary?">
                <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
              </SmallField>
            </div>
            {error && <div className="mt-2 text-[11px]" style={{ color: 'var(--red)' }}>{error}</div>}
            <div className="mt-2 flex justify-end">
              <button onClick={add} className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--purple)', color: '#fff' }}>
                Add email
              </button>
            </div>
          </div>
        )}
      </div>
    </Box>
  );
}

// ---------------- Telegram panel ----------------

function TelegramPanel({
  clientId,
  accounts,
  onChanged,
}: {
  clientId: string;
  accounts: ClientTelegramAccount[];
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [chatId, setChatId] = useState('');
  const [label, setLabel] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ token: string; url: string | null; bot_configured: boolean; expires_at: string } | null>(null);

  async function addManual() {
    setError(null);
    if (!chatId.trim()) { setError('Chat ID required'); return; }
    const res = await fetch(api(`/api/practiceiq/clients/${clientId}/telegram-accounts`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        telegram_chat_id: Number(chatId),
        label: label || null,
        is_primary: isPrimary,
      }),
    }).then(r => r.json());
    if (res.error) { setError(res.error); return; }
    setChatId(''); setLabel(''); setIsPrimary(false); setAdding(false);
    await onChanged();
  }

  async function generateInvite(inviteLabel: string) {
    setError(null);
    const res = await fetch(api(`/api/practiceiq/clients/${clientId}/telegram-invite`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: inviteLabel || null }),
    }).then(r => r.json());
    if (res.error) { setError(res.error); return; }
    setInvite(res.data);
  }

  async function setPrimary(id: string) {
    await fetch(api(`/api/practiceiq/clients/${clientId}/telegram-accounts/${id}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_primary: true }),
    });
    await onChanged();
  }

  async function removeAccount(id: string) {
    if (!confirm('Remove this Telegram account?')) return;
    await fetch(api(`/api/practiceiq/clients/${clientId}/telegram-accounts/${id}`), { method: 'DELETE' });
    await onChanged();
  }

  return (
    <Box
      title={`Telegram accounts (${accounts.length})`}
      action={
        <div className="flex gap-1">
          <button
            onClick={() => generateInvite(label)}
            className="text-[11px] px-2 py-1 rounded"
            style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
          >
            Generate invite
          </button>
          <button
            onClick={() => setAdding(v => !v)}
            className="text-[11px] px-2 py-1 rounded"
            style={{ background: 'var(--purple)', color: '#fff' }}
          >
            {adding ? 'Cancel' : '+ Add manually'}
          </button>
        </div>
      }
    >
      {accounts.length === 0 && !adding && !invite && (
        <div className="text-xs" style={{ color: 'var(--text3)' }}>No Telegram accounts linked yet.</div>
      )}

      <div className="flex flex-col gap-2">
        {accounts.map(a => (
          <div
            key={a.id}
            className="rounded-lg p-3 flex items-center justify-between"
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
          >
            <div>
              <div className="text-xs" style={{ color: 'var(--text1)' }}>
                {a.label || a.telegram_first_name || `@${a.telegram_username ?? a.telegram_chat_id}`}
                {a.is_primary && (
                  <span
                    className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--purple)', color: '#fff' }}
                  >PRIMARY</span>
                )}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                chat_id {String(a.telegram_chat_id)}
                {a.telegram_username && ` · @${a.telegram_username}`}
                {' · '}
                {a.consent_given ? 'consented' : 'no consent'}
              </div>
            </div>
            <div className="flex gap-1">
              {!a.is_primary && (
                <button onClick={() => setPrimary(a.id)} className="text-[11px] px-2 py-0.5" style={{ color: 'var(--text2)' }}>
                  Make primary
                </button>
              )}
              <button onClick={() => removeAccount(a.id)} className="text-[11px] px-2 py-0.5" style={{ color: 'var(--red)' }}>
                Remove
              </button>
            </div>
          </div>
        ))}

        {adding && (
          <div
            className="rounded-lg p-3"
            style={{ background: 'var(--bg3)', border: '1px solid var(--purple)' }}
          >
            <div className="grid grid-cols-3 gap-2">
              <SmallField label="Chat ID *">
                <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="123456789" style={smallInput} />
              </SmallField>
              <SmallField label="Label">
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Rajesh-ji" style={smallInput} />
              </SmallField>
              <SmallField label="Primary?">
                <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
              </SmallField>
            </div>
            {error && <div className="mt-2 text-[11px]" style={{ color: 'var(--red)' }}>{error}</div>}
            <div className="mt-2 flex justify-end">
              <button onClick={addManual} className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--purple)', color: '#fff' }}>
                Add account
              </button>
            </div>
          </div>
        )}

        {invite && (
          <div
            className="rounded-lg p-3 text-[11px]"
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)' }}
          >
            <div style={{ color: 'var(--text1)' }}>
              Invite expires {new Date(invite.expires_at).toLocaleDateString()}
            </div>
            {invite.url ? (
              <>
                <div className="mt-1 break-all" style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--purple)' }}>
                  {invite.url}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(invite.url!)}
                  className="mt-2 text-[11px] px-2 py-0.5 rounded"
                  style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
                >
                  Copy URL
                </button>
              </>
            ) : (
              <>
                <div className="mt-1 break-all" style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--text1)' }}>
                  invite_{invite.token}
                </div>
                <div className="mt-1" style={{ color: 'var(--red)' }}>
                  Set TELEGRAM_BOT_USERNAME in env to auto-build the t.me URL.
                </div>
              </>
            )}
            <button
              onClick={() => setInvite(null)}
              className="mt-2 ml-2 text-[11px]"
              style={{ color: 'var(--text3)' }}
            >Dismiss</button>
          </div>
        )}
      </div>
    </Box>
  );
}

