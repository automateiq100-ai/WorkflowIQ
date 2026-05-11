'use client';

import type { ClientService, ClientServiceDocType, ServiceTemplate, Cadence } from '@/lib/practiceiq/types';

const CADENCES: Cadence[] = ['monthly', 'quarterly', 'annual'];

export type ServiceDraft = {
  id?: string;
  service: string;
  cadence: Cadence;
  deadline_day: number | '';
  deadline_month: number | '';
  followup_lead_days: number | '';
  doc_types: { id?: string; doc_type: string; label: string }[];
};

export function emptyServiceDraft(): ServiceDraft {
  return {
    service: '',
    cadence: 'monthly',
    deadline_day: '',
    deadline_month: '',
    followup_lead_days: 6,
    doc_types: [],
  };
}

export function toDraft(s: ClientService): ServiceDraft {
  return {
    id: s.id,
    service: s.service,
    cadence: s.cadence,
    deadline_day: s.deadline_day ?? '',
    deadline_month: s.deadline_month ?? '',
    followup_lead_days: s.followup_lead_days ?? '',
    doc_types: (s.doc_types ?? []).map((dt: ClientServiceDocType) => ({
      id: dt.id,
      doc_type: dt.doc_type,
      label: dt.label ?? '',
    })),
  };
}

export function templateToServiceDraft(t: ServiceTemplate): ServiceDraft {
  return {
    service: t.service,
    cadence: t.cadence,
    deadline_day: t.deadline_day ?? '',
    deadline_month: t.deadline_month ?? '',
    followup_lead_days: t.followup_lead_days ?? '',
    doc_types: (t.doc_types ?? []).map(dt => ({
      doc_type: dt.doc_type,
      label: dt.label ?? '',
    })),
  };
}

export function draftToPayload(d: ServiceDraft) {
  return {
    service: d.service.trim(),
    cadence: d.cadence,
    deadline_day: d.deadline_day === '' ? null : Number(d.deadline_day),
    deadline_month: d.deadline_month === '' ? null : Number(d.deadline_month),
    followup_lead_days: d.followup_lead_days === '' ? null : Number(d.followup_lead_days),
    doc_types: d.doc_types
      .filter(dt => dt.doc_type.trim())
      .map(dt => ({ doc_type: dt.doc_type.trim(), label: dt.label.trim() || null })),
  };
}

export function ServiceEditor({
  draft,
  setDraft,
  saving,
  error,
  onSave,
  onCancel,
  saveLabel = 'Save service',
  templates,
}: {
  draft: ServiceDraft;
  setDraft: (d: ServiceDraft) => void;
  saving?: boolean;
  error?: string | null;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  templates?: ServiceTemplate[];
}) {
  const showMonth = draft.cadence === 'quarterly' || draft.cadence === 'annual';
  const usingTemplates = Array.isArray(templates);

  function setDocType(idx: number, patch: Partial<{ doc_type: string; label: string }>) {
    const next = draft.doc_types.slice();
    next[idx] = { ...next[idx], ...patch };
    setDraft({ ...draft, doc_types: next });
  }

  function pickTemplate(serviceName: string) {
    if (!templates) return;
    if (!serviceName) {
      setDraft({ ...draft, service: '' });
      return;
    }
    const t = templates.find(x => x.service === serviceName);
    if (t) setDraft(templateToServiceDraft(t));
  }

  return (
    <div
      className="rounded-lg p-3"
      style={{ background: 'var(--bg3)', border: '1px solid var(--purple)' }}
    >
      <div className="grid grid-cols-2 gap-2">
        <SmallField label="Service">
          {usingTemplates ? (
            templates.length === 0 ? (
              <div className="text-[11px] py-1" style={{ color: 'var(--text3)' }}>
                No templates yet — create one on the Services page.
              </div>
            ) : (
              <select
                value={draft.service}
                onChange={e => pickTemplate(e.target.value)}
                style={smallInput}
              >
                <option value="">Pick a template…</option>
                {templates.map(t => (
                  <option key={t.id} value={t.service}>{t.service}</option>
                ))}
              </select>
            )
          ) : (
            <input
              value={draft.service}
              onChange={e => setDraft({ ...draft, service: e.target.value })}
              placeholder="e.g. gst_gstr1"
              style={smallInput}
            />
          )}
        </SmallField>
        <SmallField label="Cadence">
          <select
            value={draft.cadence}
            onChange={e => setDraft({ ...draft, cadence: e.target.value as Cadence })}
            style={smallInput}
          >
            {CADENCES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </SmallField>
        <SmallField label="Deadline day">
          <input
            type="number" min={1} max={31}
            value={draft.deadline_day}
            onChange={e => setDraft({ ...draft, deadline_day: e.target.value === '' ? '' : Number(e.target.value) })}
            style={smallInput}
          />
        </SmallField>
        {showMonth && (
          <SmallField label="Deadline month">
            <input
              type="number" min={1} max={12}
              value={draft.deadline_month}
              onChange={e => setDraft({ ...draft, deadline_month: e.target.value === '' ? '' : Number(e.target.value) })}
              style={smallInput}
            />
          </SmallField>
        )}
        <SmallField label="Follow-up lead days (T-n)">
          <input
            type="number" min={0}
            value={draft.followup_lead_days}
            onChange={e => setDraft({ ...draft, followup_lead_days: e.target.value === '' ? '' : Number(e.target.value) })}
            style={smallInput}
          />
        </SmallField>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] uppercase" style={{ color: 'var(--text3)' }}>Doc types to collect</div>
          <button
            onClick={() => setDraft({ ...draft, doc_types: [...draft.doc_types, { doc_type: '', label: '' }] })}
            className="text-[11px]"
            style={{ color: 'var(--purple)' }}
          >
            + Add
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {draft.doc_types.map((dt, idx) => (
            <div key={idx} className="flex gap-1 items-center">
              <input
                value={dt.doc_type}
                onChange={e => setDocType(idx, { doc_type: e.target.value })}
                placeholder="doc_type (e.g. sales_register)"
                style={{ ...smallInput, flex: 1 }}
              />
              <input
                value={dt.label}
                onChange={e => setDocType(idx, { label: e.target.value })}
                placeholder="label (optional)"
                style={{ ...smallInput, flex: 1 }}
              />
              <button
                onClick={() => setDraft({ ...draft, doc_types: draft.doc_types.filter((_, i) => i !== idx) })}
                style={{ color: 'var(--red)', fontSize: 11, padding: '0 6px' }}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {error && <div className="mt-2 text-[11px]" style={{ color: 'var(--red)' }}>{error}</div>}

      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="text-[11px] px-2 py-1" style={{ color: 'var(--text3)' }}>Cancel</button>
        <button
          onClick={onSave}
          disabled={saving}
          className="text-[11px] px-2 py-1 rounded"
          style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

export function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--text3)' }}>{label}</div>
      {children}
    </label>
  );
}

export const smallInput: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  borderRadius: 6,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  color: 'var(--text1)',
  fontSize: 12,
};
