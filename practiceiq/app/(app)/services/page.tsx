'use client';

import { useEffect, useState } from 'react';
import type { ServiceTemplate, ServiceTemplateDocType } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';
import {
  ServiceEditor,
  emptyServiceDraft,
  draftToPayload,
  type ServiceDraft,
} from '@/components/practiceiq/ServiceEditor';

function templateToDraft(t: ServiceTemplate): ServiceDraft {
  return {
    id: t.id,
    service: t.service,
    cadence: t.cadence,
    deadline_day: t.deadline_day ?? '',
    deadline_month: t.deadline_month ?? '',
    followup_lead_days: t.followup_lead_days ?? '',
    doc_types: (t.doc_types ?? []).map((dt: ServiceTemplateDocType) => ({
      id: dt.id,
      doc_type: dt.doc_type,
      label: dt.label ?? '',
    })),
  };
}

export default function ServicesPage() {
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(api('/api/practiceiq/service-templates')).then(r => r.json());
    setTemplates(res.data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setDraft(emptyServiceDraft());
    setEditingId('new');
    setError(null);
  }
  function startEdit(t: ServiceTemplate) {
    setDraft(templateToDraft(t));
    setEditingId(t.id);
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
      ? api('/api/practiceiq/service-templates')
      : api(`/api/practiceiq/service-templates/${editingId}`);
    const method = editingId === 'new' ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setEditingId(null);
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this service template? Existing client services keep their settings.')) return;
    await fetch(api(`/api/practiceiq/service-templates/${id}`), { method: 'DELETE' });
    await load();
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Services
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Service templates used when onboarding clients.
          </p>
        </div>
        <button
          onClick={startNew}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          + Add Service
        </button>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : templates.length === 0 && editingId !== 'new' ? (
        <div
          className="rounded-xl border p-12 text-center"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <div className="text-4xl mb-3">🛠️</div>
          <div className="text-sm mb-2" style={{ color: 'var(--text2)' }}>No service templates yet.</div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>Add one to start picking it during client onboarding.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map(t => editingId === t.id ? (
            <ServiceEditor
              key={t.id}
              draft={draft}
              setDraft={setDraft}
              saving={saving}
              error={error}
              onSave={save}
              onCancel={cancel}
              saveLabel="Save template"
            />
          ) : (
            <div
              key={t.id}
              className="rounded-xl border p-4"
              style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm" style={{ color: 'var(--text1)' }}>
                    {t.service}{!t.active && ' · inactive'}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                    {t.cadence}
                    {t.deadline_day && ` · day ${t.deadline_day}`}
                    {t.deadline_month && ` · month ${t.deadline_month}`}
                    {t.followup_lead_days != null && ` · T-${t.followup_lead_days}`}
                  </div>
                  {t.doc_types && t.doc_types.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {t.doc_types.map(dt => (
                        <span
                          key={dt.id}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
                        >
                          {dt.label || dt.doc_type}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(t)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text2)' }}>Edit</button>
                  <button onClick={() => remove(t.id)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--red)' }}>Delete</button>
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
              saveLabel="Save template"
            />
          )}
        </div>
      )}
    </div>
  );
}
