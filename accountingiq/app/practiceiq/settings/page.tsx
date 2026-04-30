'use client';

import { useEffect, useState } from 'react';
import type { FirmSettings } from '@/lib/practiceiq/types';

export default function SettingsPage() {
  const [form, setForm] = useState<Partial<FirmSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/practiceiq/settings').then(r => r.json()).then(res => {
      setForm(res.data ?? { default_tax_rate: 18, invoice_prefix: 'INV', invoice_counter: 1 });
      setLoading(false);
    });
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    await fetch('/api/practiceiq/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        default_tax_rate: Number(form.default_tax_rate ?? 18),
        invoice_counter: Number(form.invoice_counter ?? 1),
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        Firm Settings
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        These details appear on your invoices.
      </p>

      <div className="rounded-xl border p-6 space-y-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <Field label="Firm Name">
          <input value={form.firm_name ?? ''} onChange={e => setForm({ ...form, firm_name: e.target.value })} style={input} />
        </Field>
        <Field label="Address">
          <textarea value={form.firm_address ?? ''} onChange={e => setForm({ ...form, firm_address: e.target.value })} style={{ ...input, minHeight: 60 }} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Firm GSTIN">
            <input value={form.firm_gstin ?? ''} onChange={e => setForm({ ...form, firm_gstin: e.target.value.toUpperCase() })} style={input} />
          </Field>
          <Field label="Firm PAN">
            <input value={form.firm_pan ?? ''} onChange={e => setForm({ ...form, firm_pan: e.target.value.toUpperCase() })} style={input} />
          </Field>
          <Field label="Default Tax Rate (%)">
            <input type="number" value={form.default_tax_rate ?? 18} onChange={e => setForm({ ...form, default_tax_rate: Number(e.target.value) })} style={input} />
          </Field>
          <Field label="Invoice Prefix">
            <input value={form.invoice_prefix ?? 'INV'} onChange={e => setForm({ ...form, invoice_prefix: e.target.value })} style={input} />
          </Field>
          <Field label="Next Invoice Number">
            <input type="number" value={form.invoice_counter ?? 1} onChange={e => setForm({ ...form, invoice_counter: Number(e.target.value) })} style={input} />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && <span className="text-xs" style={{ color: 'var(--green)' }}>✓ Saved</span>}
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg"
            style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
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
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text1)',
  fontSize: 13,
};
