'use client';

import { useEffect, useState } from 'react';
import type { Firm } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

export default function AdminFirmPage() {
  const [firm, setFirm] = useState<Partial<Firm>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(api('/api/practiceiq/admin/firm'))
      .then(r => r.json())
      .then(res => {
        if (res.error) setError(res.error);
        else setFirm(res.data ?? {});
        setLoading(false);
      });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch(api('/api/practiceiq/admin/firm'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(firm),
    }).then(r => r.json());
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setFirm(res.data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Firm details</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        These are the legal/identity details of your practice. Visible to all firm members; only admins can edit.
      </p>

      <div className="rounded-xl border p-6 space-y-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <Field label="Firm name *">
          <input value={firm.name ?? ''} onChange={e => setFirm({ ...firm, name: e.target.value })} style={input} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Firm GSTIN">
            <input value={firm.gstin ?? ''} onChange={e => setFirm({ ...firm, gstin: e.target.value.toUpperCase() })} style={input} />
          </Field>
          <Field label="Firm PAN">
            <input value={firm.pan ?? ''} onChange={e => setFirm({ ...firm, pan: e.target.value.toUpperCase() })} style={input} />
          </Field>
          <Field label="State code (2-char)">
            <input value={firm.state_code ?? ''} onChange={e => setFirm({ ...firm, state_code: e.target.value.toUpperCase() })} maxLength={2} style={input} />
          </Field>
        </div>
        <Field label="Address">
          <textarea value={firm.address ?? ''} onChange={e => setFirm({ ...firm, address: e.target.value })} style={{ ...input, minHeight: 60 }} />
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2">
          {error && <span className="text-xs" style={{ color: 'var(--red)' }}>{error}</span>}
          {saved && <span className="text-xs" style={{ color: 'var(--green)' }}>✓ Saved</span>}
          <button
            onClick={save}
            disabled={saving || !firm.name}
            className="px-4 py-2 text-sm rounded-lg"
            style={{ background: 'var(--purple)', color: '#fff', opacity: saving || !firm.name ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : 'Save firm details'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>{children}</label>;
}
const input: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)', fontSize: 13 };
