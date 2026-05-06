'use client';

import { useEffect, useState } from 'react';
import type { FirmSettings } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';
import { BASE_PATH } from '@/lib/api';

type GmailStatus = { email: string; connected_at: string; last_history_id: string | null };

type CaSetupLink = { token: string; url: string | null; bot_configured: boolean; expires_at: string };

const DEFAULT_CLIENT_AGENT_PROMPT = `You are Shalini, a friendly Hinglish-speaking assistant for an Indian Chartered Accountancy practice. You speak with the CA's clients (small business owners, salaried professionals) on Telegram.

Style rules:
- Reply in Hinglish (Hindi + English mix in Roman script). Natural, warm, respectful.
- Use 'aap', 'ji' suffix where appropriate. Address by client first name when known.
- Keep replies short (1-3 sentences usually). Use simple words.
- Never use emoji except a single check (✅) for confirmations.
- Never ask for OTPs, passwords, PAN, or Aadhaar in chat.
- Never make up filing dates or rules. If you don't know, say 'CA sir/madam will check kar denge'.
- Don't repeat the client's name in every line.
- No translation, no explanation of what you're saying — just say it.`;

export default function SettingsPage() {
  const [form, setForm] = useState<Partial<FirmSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [gmailMsg, setGmailMsg] = useState<string | null>(null);
  const [caSetup, setCaSetup] = useState<CaSetupLink | null>(null);
  const [caSetupErr, setCaSetupErr] = useState<string | null>(null);
  const [caManual, setCaManual] = useState('');
  const [promptDraft, setPromptDraft] = useState<string>('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptShowDefault, setPromptShowDefault] = useState(false);

  async function loadGmail() {
    const res = await fetch(api('/api/practiceiq/integrations/gmail/status')).then(r => r.json());
    setGmail(res.data ?? null);
  }

  async function reloadSettings() {
    const res = await fetch(api('/api/practiceiq/settings')).then(r => r.json());
    const data = res.data ?? { default_tax_rate: 18, invoice_prefix: 'INV', invoice_counter: 1 };
    setForm(data);
    setPromptDraft(data.client_agent_prompt ?? '');
  }

  useEffect(() => {
    fetch(api('/api/practiceiq/settings')).then(r => r.json()).then(res => {
      const data = res.data ?? { default_tax_rate: 18, invoice_prefix: 'INV', invoice_counter: 1 };
      setForm(data);
      setPromptDraft(data.client_agent_prompt ?? '');
      setLoading(false);
    });
    loadGmail();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const status = params.get('gmail');
      if (status === 'connected') setGmailMsg('✓ Gmail connected');
      else if (status === 'error') setGmailMsg(`Gmail connect failed: ${params.get('msg') || 'unknown'}`);
      if (status) {
        // Strip query params after consuming them.
        const u = new URL(window.location.href);
        u.searchParams.delete('gmail');
        u.searchParams.delete('msg');
        window.history.replaceState({}, '', u.toString());
      }
    }
  }, []);

  // While a CA-setup link is active, poll settings every 5s so we detect when the
  // CA clicks the link from their phone and the chat_id gets written by the bot.
  useEffect(() => {
    if (!caSetup) return;
    const expires = new Date(caSetup.expires_at).getTime();
    const tick = setInterval(async () => {
      if (Date.now() > expires) {
        setCaSetup(null);
        setCaSetupErr('Link expired. Generate a new one.');
        return;
      }
      const res = await fetch(api('/api/practiceiq/settings')).then(r => r.json());
      const newId = res.data?.ca_telegram_chat_id;
      if (newId && newId !== form.ca_telegram_chat_id) {
        setForm(res.data);
        setCaSetup(null);
        setCaSetupErr(null);
      }
    }, 5000);
    return () => clearInterval(tick);
  }, [caSetup, form.ca_telegram_chat_id]);

  async function generateCaSetupLink() {
    setCaSetupErr(null);
    const res = await fetch(api('/api/practiceiq/settings/telegram-setup-link'), { method: 'POST' }).then(r => r.json());
    if (res.error) { setCaSetupErr(res.error); return; }
    setCaSetup(res.data);
  }

  async function saveManualCaChatId() {
    if (!caManual.trim()) return;
    if (!/^-?\d+$/.test(caManual.trim())) {
      setCaSetupErr('Chat ID should be a number (use @userinfobot in Telegram to find it).');
      return;
    }
    setCaSetupErr(null);
    await fetch(api('/api/practiceiq/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, ca_telegram_chat_id: caManual.trim() }),
    });
    setCaManual('');
    await reloadSettings();
  }

  async function saveClientPrompt() {
    setPromptSaving(true);
    setPromptSaved(false);
    const value = promptDraft.trim() || null;
    await fetch(api('/api/practiceiq/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, client_agent_prompt: value }),
    });
    setPromptSaving(false);
    setPromptSaved(true);
    setTimeout(() => setPromptSaved(false), 2000);
    await reloadSettings();
  }

  function loadDefaultIntoDraft() {
    setPromptDraft(DEFAULT_CLIENT_AGENT_PROMPT);
  }

  async function clearCustomPrompt() {
    if (!confirm('Clear your custom prompt? Shalini will revert to the default Hinglish persona.')) return;
    setPromptDraft('');
    await fetch(api('/api/practiceiq/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, client_agent_prompt: null }),
    });
    await reloadSettings();
  }

  async function disconnectCaTelegram() {
    if (!confirm('Disconnect your Telegram from PracticeIQ? You will stop receiving completion notifications and the daily digest.')) return;
    await fetch(api('/api/practiceiq/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, ca_telegram_chat_id: null }),
    });
    await reloadSettings();
  }

  async function disconnectGmail() {
    if (!confirm('Disconnect Gmail? Email ingestion will stop.')) return;
    await fetch(api('/api/practiceiq/integrations/gmail/disconnect'), { method: 'POST' });
    setGmail(null);
    setGmailMsg('Disconnected.');
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    await fetch(api('/api/practiceiq/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, default_tax_rate: Number(form.default_tax_rate ?? 18), invoice_counter: Number(form.invoice_counter ?? 1) }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Firm Settings</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>These details appear on your invoices.</p>

      <div className="rounded-xl border p-6 space-y-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <Field label="Firm Name"><input value={form.firm_name ?? ''} onChange={e => setForm({ ...form, firm_name: e.target.value })} style={input} /></Field>
        <Field label="Address"><textarea value={form.firm_address ?? ''} onChange={e => setForm({ ...form, firm_address: e.target.value })} style={{ ...input, minHeight: 60 }} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Firm GSTIN"><input value={form.firm_gstin ?? ''} onChange={e => setForm({ ...form, firm_gstin: e.target.value.toUpperCase() })} style={input} /></Field>
          <Field label="Firm PAN"><input value={form.firm_pan ?? ''} onChange={e => setForm({ ...form, firm_pan: e.target.value.toUpperCase() })} style={input} /></Field>
          <Field label="Default Tax Rate (%)"><input type="number" value={form.default_tax_rate ?? 18} onChange={e => setForm({ ...form, default_tax_rate: Number(e.target.value) })} style={input} /></Field>
          <Field label="Invoice Prefix"><input value={form.invoice_prefix ?? 'INV'} onChange={e => setForm({ ...form, invoice_prefix: e.target.value })} style={input} /></Field>
          <Field label="Next Invoice Number"><input type="number" value={form.invoice_counter ?? 1} onChange={e => setForm({ ...form, invoice_counter: Number(e.target.value) })} style={input} /></Field>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && <span className="text-xs" style={{ color: 'var(--green)' }}>✓ Saved</span>}
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg" style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <h2 className="text-lg mt-8 mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        Your Telegram
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
        Connect your own Telegram so the bot can send you the daily digest and notify you when a client finishes uploading documents.
      </p>

      <div className="rounded-xl border p-6 space-y-3" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        {form.ca_telegram_chat_id ? (
          <>
            <div className="text-sm" style={{ color: 'var(--text1)' }}>
              ✓ Connected · chat_id <span style={{ fontFamily: 'var(--font-dm-mono)' }}>{form.ca_telegram_chat_id}</span>
            </div>
            <button
              onClick={disconnectCaTelegram}
              className="text-sm px-3 py-1.5 rounded"
              style={{ background: 'var(--bg3)', color: 'var(--red)', border: '1px solid var(--border)' }}
            >
              Disconnect
            </button>
          </>
        ) : caSetup ? (
          <>
            <div className="text-sm" style={{ color: 'var(--text1)' }}>
              Open this link from your Telegram-installed phone, then tap <strong>Start</strong>:
            </div>
            {caSetup.url ? (
              <>
                <div className="text-xs break-all" style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--purple)' }}>
                  {caSetup.url}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(caSetup.url!)}
                  className="text-xs px-2 py-1 rounded mt-1"
                  style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
                >
                  Copy URL
                </button>
              </>
            ) : (
              <div className="text-xs" style={{ color: 'var(--red)' }}>
                Bot username not set. Add TELEGRAM_BOT_USERNAME to .env to auto-build the URL.
              </div>
            )}
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              Expires {new Date(caSetup.expires_at).toLocaleTimeString()} · auto-detecting (refreshes every 5s)
            </div>
            <button
              onClick={() => setCaSetup(null)}
              className="text-xs"
              style={{ color: 'var(--text3)' }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <div className="text-sm" style={{ color: 'var(--text2)' }}>
              No Telegram connected.
            </div>
            <button
              onClick={generateCaSetupLink}
              className="text-sm px-3 py-1.5 rounded"
              style={{ background: 'var(--purple)', color: '#fff' }}
            >
              Connect via Telegram
            </button>
            <details className="text-xs pt-2" style={{ color: 'var(--text3)' }}>
              <summary className="cursor-pointer">Or paste your chat ID manually</summary>
              <div className="flex gap-2 mt-2 items-center">
                <input
                  value={caManual}
                  onChange={e => setCaManual(e.target.value)}
                  placeholder="e.g. 1825600707"
                  style={{ ...input, maxWidth: 200 }}
                />
                <button
                  onClick={saveManualCaChatId}
                  className="text-xs px-3 py-1.5 rounded"
                  style={{ background: 'var(--bg3)', color: 'var(--text1)', border: '1px solid var(--border)' }}
                >
                  Save
                </button>
              </div>
              <div className="mt-1">
                Get your chat ID by DMing <span style={{ color: 'var(--text2)' }}>@userinfobot</span> on Telegram.
              </div>
            </details>
          </>
        )}
        {caSetupErr && (
          <div className="text-xs" style={{ color: 'var(--red)' }}>{caSetupErr}</div>
        )}
      </div>

      <h2 className="text-lg mt-8 mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        Shalini's behavior
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
        Edit the system prompt that controls how Shalini speaks to your clients. Empty = default Hinglish persona.
      </p>

      <div
        className="rounded-xl border p-6 space-y-3"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div
          className="text-xs rounded-lg p-3"
          style={{ background: 'rgba(240,72,72,0.08)', border: '1px solid var(--red)', color: 'var(--text2)' }}
        >
          <strong style={{ color: 'var(--red)' }}>⚠ This replaces the entire system prompt.</strong>{' '}
          The default persona includes safety rails (no OTPs, PAN, or Aadhaar requests; no fabricated filing dates).
          If you remove these from your custom prompt, Shalini may behave in ways that break DPDPA compliance —
          you own the prompt, so you own the consequences.
        </div>

        <textarea
          value={promptDraft}
          onChange={e => setPromptDraft(e.target.value)}
          rows={12}
          placeholder="Empty = the default safe Hinglish persona is used."
          style={{ ...input, minHeight: 240, fontFamily: 'var(--font-dm-mono)', fontSize: 12 }}
        />

        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={saveClientPrompt}
            disabled={promptSaving}
            className="px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--purple)', color: '#fff', opacity: promptSaving ? 0.5 : 1 }}
          >
            {promptSaving ? 'Saving…' : 'Save prompt'}
          </button>
          <button
            onClick={loadDefaultIntoDraft}
            className="px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--bg3)', color: 'var(--text1)', border: '1px solid var(--border)' }}
          >
            Insert default text
          </button>
          {form.client_agent_prompt && (
            <button
              onClick={clearCustomPrompt}
              className="px-3 py-1.5 text-sm rounded"
              style={{ background: 'var(--bg3)', color: 'var(--red)', border: '1px solid var(--border)' }}
            >
              Clear (use default)
            </button>
          )}
          {promptSaved && (
            <span className="text-xs" style={{ color: 'var(--green)' }}>✓ Saved</span>
          )}
        </div>

        <div className="text-xs" style={{ color: 'var(--text3)' }}>
          {form.client_agent_prompt
            ? 'Custom prompt is active — clients see your version of Shalini.'
            : 'Default prompt is active — clients see the standard safe Hinglish persona.'}
        </div>

        <button
          onClick={() => setPromptShowDefault(v => !v)}
          className="text-xs"
          style={{ color: 'var(--text2)' }}
        >
          {promptShowDefault ? 'Hide default reference ▲' : 'Show default reference ▼'}
        </button>
        {promptShowDefault && (
          <pre
            className="text-[11px] rounded p-3 overflow-auto whitespace-pre-wrap"
            style={{ background: 'var(--bg3)', color: 'var(--text2)', maxHeight: 280, fontFamily: 'var(--font-dm-mono)' }}
          >
{DEFAULT_CLIENT_AGENT_PROMPT}
          </pre>
        )}
      </div>

      <h2 className="text-lg mt-8 mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        Gmail integration
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
        Connect a firm Gmail. Attachments from known clients land in the Documents inbox automatically; bodies are searchable in Ask Shalini.
      </p>

      <div className="rounded-xl border p-6 space-y-3" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        {gmail ? (
          <>
            <div className="text-sm" style={{ color: 'var(--text1)' }}>
              ✓ Connected as <span style={{ fontFamily: 'var(--font-dm-mono)' }}>{gmail.email}</span>
            </div>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              Connected on {new Date(gmail.connected_at).toLocaleDateString()}
              {gmail.last_history_id && ` · last sync historyId ${gmail.last_history_id}`}
            </div>
            <button
              onClick={disconnectGmail}
              className="text-sm px-3 py-1.5 rounded"
              style={{ background: 'var(--bg3)', color: 'var(--red)', border: '1px solid var(--border)' }}
            >
              Disconnect Gmail
            </button>
          </>
        ) : (
          <>
            <div className="text-sm" style={{ color: 'var(--text2)' }}>
              No Gmail connected. The bot can still collect via Telegram in the meantime.
            </div>
            <a
              href={`${BASE_PATH}/api/practiceiq/integrations/gmail/start`}
              className="inline-block text-sm px-3 py-1.5 rounded"
              style={{ background: 'var(--purple)', color: '#fff' }}
            >
              Connect Gmail
            </a>
          </>
        )}
        {gmailMsg && (
          <div className="text-xs mt-2" style={{ color: gmailMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>
            {gmailMsg}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>{children}</label>;
}
const input: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)', fontSize: 13 };
