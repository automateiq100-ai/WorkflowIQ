'use client';

import { useEffect, useState, useMemo } from 'react';
import type { ServiceModule, ServiceTemplate, ServiceTemplateDocType } from '@/lib/practiceiq/types';
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

const COLOR_MAP: Record<string, { bg: string; fg: string; ring: string }> = {
  teal:   { bg: 'rgba(15,212,160,0.10)',  fg: '#0fd4a0', ring: 'rgba(15,212,160,0.45)' },
  amber:  { bg: 'rgba(245,166,35,0.12)',  fg: '#f5a623', ring: 'rgba(245,166,35,0.45)' },
  blue:   { bg: 'rgba(74,158,255,0.12)',  fg: '#4a9eff', ring: 'rgba(74,158,255,0.45)' },
  purple: { bg: 'rgba(155,127,232,0.14)', fg: '#9b7fe8', ring: 'rgba(155,127,232,0.45)' },
  red:    { bg: 'rgba(240,72,72,0.10)',   fg: '#f04848', ring: 'rgba(240,72,72,0.45)' },
  green:  { bg: 'rgba(76,175,121,0.12)',  fg: '#4caf79', ring: 'rgba(76,175,121,0.45)' },
  coral:  { bg: 'rgba(242,107,91,0.10)',  fg: '#f26b5b', ring: 'rgba(242,107,91,0.45)' },
  grey:   { bg: 'rgba(154,160,173,0.10)', fg: '#9aa0ad', ring: 'rgba(154,160,173,0.45)' },
};

function colorTokens(c: string | null) {
  return COLOR_MAP[c ?? 'grey'] ?? COLOR_MAP.grey;
}

export default function ServicesPage() {
  const [modules, setModules] = useState<ServiceModule[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewModule, setShowNewModule] = useState(false);
  const [editingModule, setEditingModule] = useState<ServiceModule | null>(null);

  async function load() {
    setLoading(true);
    const [mRes, tRes] = await Promise.all([
      fetch(api('/api/practiceiq/service-modules')).then(r => r.json()),
      fetch(api('/api/practiceiq/service-templates')).then(r => r.json()),
    ]);
    const mods: ServiceModule[] = mRes.data ?? [];
    setModules(mods);
    setTemplates(tRes.data ?? []);
    if (!selectedModuleId && mods.length > 0) {
      setSelectedModuleId(mods[0].id);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filingsForSelected = useMemo(
    () => templates.filter(t => t.module_id === selectedModuleId),
    [templates, selectedModuleId],
  );

  const selectedModule = useMemo(
    () => modules.find(m => m.id === selectedModuleId) ?? null,
    [modules, selectedModuleId],
  );

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
    if (!draft.service.trim()) { setError('Filing name required'); return; }
    setSaving(true);
    setError(null);
    const payload = { ...draftToPayload(draft), module_id: selectedModuleId };
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
    if (!confirm('Delete this filing? Existing client services keep their settings.')) return;
    await fetch(api(`/api/practiceiq/service-templates/${id}`), { method: 'DELETE' });
    await load();
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Services
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Modules group the work your firm does; each module contains the standard filings (e.g. GST → GSTR-1, GSTR-3B).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-5">
          {/* Left rail — modules */}
          <div className="rounded-xl border" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b text-xs uppercase font-semibold flex items-center justify-between"
              style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
              <span>Modules ({modules.length})</span>
            </div>
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              {modules.map(m => {
                const c = colorTokens(m.color);
                const active = m.id === selectedModuleId;
                const count = m.filing_count ?? templates.filter(t => t.module_id === m.id).length;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedModuleId(m.id); setEditingId(null); }}
                    className="w-full text-left rounded-md px-3 py-2 mb-1 flex items-center gap-3 transition-colors"
                    style={{
                      background: active ? c.bg : 'transparent',
                      border: '1px solid',
                      borderColor: active ? c.ring : 'transparent',
                    }}
                  >
                    <div className="text-lg w-6 text-center" aria-hidden>{m.icon ?? '📁'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--text1)' }}>
                        {m.name}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: c.fg }}>
                        {m.code}{m.is_system ? '' : ' · custom'}
                      </div>
                    </div>
                    <div
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: c.bg, color: c.fg }}
                    >
                      {count}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setShowNewModule(true)}
                className="w-full px-3 py-2 text-xs rounded-md font-semibold"
                style={{ background: 'var(--purple)', color: '#fff' }}
              >
                + New module
              </button>
            </div>
          </div>

          {/* Right pane — filings inside the selected module */}
          <div className="min-w-0">
            {selectedModule ? (
              <>
                <ModuleHeader
                  mod={selectedModule}
                  onAdd={startNew}
                  onEdit={() => setEditingModule(selectedModule)}
                />
                {editingId === 'new' && (
                  <div className="mb-3">
                    <ServiceEditor
                      draft={draft}
                      setDraft={setDraft}
                      saving={saving}
                      error={error}
                      onSave={save}
                      onCancel={cancel}
                      saveLabel="Save filing"
                    />
                  </div>
                )}

                {filingsForSelected.length === 0 && editingId !== 'new' ? (
                  <div className="rounded-xl border p-12 text-center"
                    style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                    <div className="text-4xl mb-3">{selectedModule.icon ?? '📁'}</div>
                    <div className="text-sm mb-2" style={{ color: 'var(--text2)' }}>
                      No filings in this module yet.
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text3)' }}>
                      Click "+ Add filing" to set one up.
                    </div>
                  </div>
                ) : (
                  // Independent scroll container so big modules (GST has 16
                  // filings) don't push the page miles down. Mirrors the
                  // left rail's behavior. The pr-1 pads for the scrollbar.
                  <div
                    className="flex flex-col gap-2 overflow-y-auto pr-1"
                    style={{ maxHeight: 'calc(100vh - 280px)' }}
                  >
                    {filingsForSelected.map(t => editingId === t.id ? (
                      <ServiceEditor
                        key={t.id}
                        draft={draft}
                        setDraft={setDraft}
                        saving={saving}
                        error={error}
                        onSave={save}
                        onCancel={cancel}
                        saveLabel="Save filing"
                      />
                    ) : (
                      <FilingRow key={t.id} t={t} mod={selectedModule} onEdit={() => startEdit(t)} onDelete={() => remove(t.id)} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm" style={{ color: 'var(--text3)' }}>Select a module from the left.</div>
            )}
          </div>
        </div>
      )}

      {showNewModule && (
        <ModuleModal
          onClose={() => setShowNewModule(false)}
          onSaved={async (id) => {
            setShowNewModule(false);
            await load();
            if (id) setSelectedModuleId(id);
          }}
        />
      )}

      {editingModule && (
        <ModuleModal
          existing={editingModule}
          onClose={() => setEditingModule(null)}
          onSaved={async () => {
            setEditingModule(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ModuleHeader({ mod, onAdd, onEdit }: { mod: ServiceModule; onAdd: () => void; onEdit: () => void }) {
  const c = colorTokens(mod.color);
  return (
    <div
      className="rounded-xl border p-4 mb-3 flex items-start justify-between gap-4"
      style={{ background: c.bg, borderColor: c.ring }}
    >
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="text-2xl" aria-hidden>{mod.icon ?? '📁'}</div>
          <div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text1)' }}>{mod.name}</div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: c.fg }}>{mod.code}</div>
          </div>
        </div>
        {mod.description && (
          <div className="text-xs mt-1" style={{ color: 'var(--text2)' }}>{mod.description}</div>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onEdit}
          className="text-xs px-3 py-1.5 rounded"
          style={{ background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)' }}
        >
          Edit module
        </button>
        <button
          onClick={onAdd}
          className="text-xs px-3 py-1.5 rounded font-semibold"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          + Add filing
        </button>
      </div>
    </div>
  );
}

function FilingRow({ t, mod, onEdit, onDelete }: { t: ServiceTemplate; mod: ServiceModule; onEdit: () => void; onDelete: () => void }) {
  const c = colorTokens(mod.color);
  return (
    <div
      className="rounded-lg border p-4 flex items-start justify-between gap-4"
      style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded"
            style={{ background: c.bg, color: c.fg }}
          >
            {mod.code}
          </span>
          <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
            {t.service}{!t.active && <span className="ml-2 text-xs" style={{ color: 'var(--text3)' }}>· inactive</span>}
            {t.is_system && <span className="ml-2 text-[10px] uppercase" style={{ color: 'var(--text3)' }}>system</span>}
          </div>
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
      <div className="flex gap-1 shrink-0">
        <button onClick={onEdit} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text2)' }}>Edit</button>
        <button onClick={onDelete} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--red)' }}>Delete</button>
      </div>
    </div>
  );
}

const ICON_OPTIONS = ['🧾','💰','📄','🏢','🔍','👥','🛡️','📋','🌐','🌍','🔑','™️','🚀','📚','💡','📂','📊','📦','✨','⚙️'];
const COLOR_OPTIONS = ['teal','amber','blue','purple','red','green','coral','grey'];

function ModuleModal({ existing, onClose, onSaved }: {
  existing?: ServiceModule;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    code: existing?.code ?? '',
    description: existing?.description ?? '',
    icon: existing?.icon ?? '📁',
    color: existing?.color ?? 'grey',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!existing;
  const isSystem = existing?.is_system ?? false;

  async function save() {
    setErr(null);
    if (!form.name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    const url = isEdit
      ? api(`/api/practiceiq/service-modules/${existing!.id}`)
      : api('/api/practiceiq/service-modules');
    const method = isEdit ? 'PATCH' : 'POST';
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description || null,
      icon: form.icon,
      color: form.color,
    };
    if (!isEdit) body.code = form.code.trim() || undefined;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      const j = await res.json();
      onSaved(j.data?.id);
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? 'Failed');
    }
  }

  async function del() {
    if (!existing) return;
    if (!confirm(`Delete module "${existing.name}"? Filings inside will be unassigned.`)) return;
    const res = await fetch(api(`/api/practiceiq/service-modules/${existing.id}`), { method: 'DELETE' });
    if (res.ok) onSaved();
    else { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Failed'); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-md" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          {isEdit ? `Edit ${existing!.name}` : 'New module'}
        </h2>
        <div className="space-y-3">
          <label className="block">
            <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Name</div>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </label>
          {!isEdit && (
            <label className="block">
              <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Code (optional)</div>
              <input
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                placeholder="auto-derived from name"
                style={inputStyle}
              />
            </label>
          )}
          <label className="block">
            <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Description</div>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} />
          </label>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Icon</div>
            <div className="flex flex-wrap gap-1">
              {ICON_OPTIONS.map(ic => (
                <button
                  key={ic}
                  onClick={() => setForm({ ...form, icon: ic })}
                  className="rounded text-lg"
                  style={{
                    width: 32, height: 32,
                    background: form.icon === ic ? 'var(--bg4)' : 'var(--bg3)',
                    border: `1px solid ${form.icon === ic ? 'var(--purple)' : 'var(--border)'}`,
                  }}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Color</div>
            <div className="flex flex-wrap gap-1">
              {COLOR_OPTIONS.map(c => {
                const t = colorTokens(c);
                return (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className="rounded text-[10px] uppercase font-semibold px-2 py-1"
                    style={{
                      background: t.bg,
                      color: t.fg,
                      border: `1px solid ${form.color === c ? t.fg : 'var(--border)'}`,
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {err && <div className="text-xs mt-3" style={{ color: 'var(--red)' }}>{err}</div>}
        <div className="mt-6 flex justify-between">
          {isEdit && !isSystem ? (
            <button onClick={del} className="text-xs" style={{ color: 'var(--red)' }}>Delete module</button>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text3)' }}>{isSystem ? 'System modules cannot be deleted.' : ''}</span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg" style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', fontSize: 13,
};
