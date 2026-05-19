'use client';

/**
 * MIS Data Intake — single screen for getting every input MIS needs.
 *
 * Four tabs:
 *   1. Tally Files    — XML exports (re-uses Layer 1 file slots + Bills.xml etc.)
 *   2. Spreadsheets   — Budget Excel (download template + upload filled)
 *   3. Documents      — PDF uploads (sanction letter, lease) — manual key-value
 *   4. Manual Inputs  — form fields (headcount, order book, covenants, …)
 *
 * Side rail summarises coverage and lists what unlocks which metrics.
 *
 * The view is intentionally thin: all the input metadata lives in
 * lib/layer2/data-sources.ts and the availability logic lives in
 * lib/layer2/availability.ts.  This file is presentation only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/state';
import type { FileKey, MISDocumentRef } from '@/lib/types';
import type { ManualInputs } from '@/lib/layer2/types';
import {
  ALL_DATA_SOURCES, sourcesByKind, type DataSourceDef, type DataSourceKind,
} from '@/lib/layer2/data-sources';
import {
  coverage, checkSource, allStatuses, type SourceStatus,
} from '@/lib/layer2/availability';
import { downloadBudgetTemplate, parseBudgetExcel, currentFY } from '@/lib/layer2/budget-template';
import { ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';
import '@/lib/layer2/mis/metric-inputs';   // ensure inputs populated
import { CHART_COLORS } from './atoms';

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_COLOR = {
  available: 'var(--green)',
  partial: 'var(--amber)',
  missing: 'var(--text3)',
};

// ── Component ───────────────────────────────────────────────────────────

type IntakeTab = 'tally' | 'excel' | 'pdf' | 'manual';

export default function MISDataIntakeView() {
  const { state, dispatch } = useApp();
  // Deep-link from Missing Details: if state.misUploadDeepLink is set,
  // start on that tab and remember the source id to highlight + scroll.
  const initialTab = (state.misUploadDeepLink?.tab ?? 'tally') as IntakeTab;
  const initialHighlight = state.misUploadDeepLink?.sourceId;
  const [activeTab, setActiveTab] = useState<IntakeTab>(initialTab);
  const [highlightSourceId, setHighlightSourceId] = useState<string | undefined>(initialHighlight);
  const [onlySelected, setOnlySelected] = useState(false);

  // Consume the deep-link once.  Clear after a short delay so the
  // highlighted row gets its outline pulse, then disappears.
  useEffect(() => {
    if (!state.misUploadDeepLink) return;
    dispatch({ type: 'MIS_UPLOAD_DEEPLINK', deepLink: null });
    const t = setTimeout(() => setHighlightSourceId(undefined), 3000);
    return () => clearTimeout(t);
    // Intentionally only runs when deep-link is set; cleanup handles the highlight timeout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.misUploadDeepLink]);

  const cov = useMemo(() => coverage(state), [state]);
  const statuses = useMemo(() => allStatuses(state), [state]);
  const statusById = useMemo(() => {
    const m = new Map<string, SourceStatus>();
    for (const s of statuses) m.set(`${s.source.kind}:${s.source.id}`, s);
    return m;
  }, [statuses]);

  // Build the set of source keys (kind:id) that the user's *selected*
  // metrics depend on.  Used to filter / sort source rows.
  const selectedIds = state.misSetup.selectedMetricIds.length > 0
    ? new Set(state.misSetup.selectedMetricIds)
    : new Set(ALL_MIS_METRICS.map(m => m.id));
  const neededSources = useMemo(() => {
    const keys = new Set<string>();
    for (const m of ALL_MIS_METRICS) {
      if (!selectedIds.has(m.id)) continue;
      for (const inp of m.inputs ?? []) {
        if (inp.type === 'period') continue;
        keys.add(`${inp.type}:${inp.id}`);
      }
    }
    return keys;
  }, [selectedIds]);

  const isNeeded = (kind: DataSourceKind, id: string) => neededSources.has(`${kind}:${id}`);

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text1)' }}>
            Upload Files
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            Sources for your <strong style={{ color: 'var(--text2)' }}>{selectedIds.size}</strong> selected metrics.
            Required inputs are pinned to the top.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer shrink-0"
          style={{ color: onlySelected ? CHART_COLORS.teal : 'var(--text2)' }}>
          <input type="checkbox" checked={onlySelected} onChange={e => setOnlySelected(e.target.checked)}
            style={{ accentColor: CHART_COLORS.teal }} />
          Show only sources needed for selected metrics
        </label>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-6">
        {/* ── Main column ── */}
        <div>
          {/* Tab nav */}
          <div className="flex border-b mb-4 text-sm" style={{ borderColor: 'var(--border)' }}>
            {([
              ['tally', 'Tally Files', sourcesByKind('tally').length],
              ['excel', 'Spreadsheets', sourcesByKind('excel').length],
              ['pdf', 'Documents', sourcesByKind('pdf').length],
              ['manual', 'Manual Inputs', sourcesByKind('manual').length],
            ] as [IntakeTab, string, number][]).map(([id, label, count]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="px-4 py-2 border-b-2 transition-colors"
                style={{
                  borderColor: activeTab === id ? 'var(--teal)' : 'transparent',
                  color: activeTab === id ? 'var(--teal)' : 'var(--text2)',
                  marginBottom: -1,
                }}
              >
                {label} <span className="text-[10px] opacity-60">({count})</span>
              </button>
            ))}
          </div>

          {/* Panels */}
          {activeTab === 'tally' && <TallyPanel statusById={statusById} isNeeded={isNeeded} onlySelected={onlySelected} highlightId={highlightSourceId} />}
          {activeTab === 'excel' && <ExcelPanel state={state} dispatch={dispatch} statusById={statusById} isNeeded={isNeeded} onlySelected={onlySelected} highlightId={highlightSourceId} />}
          {activeTab === 'pdf' && <PdfPanel state={state} dispatch={dispatch} statusById={statusById} isNeeded={isNeeded} onlySelected={onlySelected} highlightId={highlightSourceId} />}
          {activeTab === 'manual' && <ManualPanel state={state} dispatch={dispatch} />}
        </div>

        {/* ── Side rail: coverage + gaps ── */}
        <div className="space-y-4">
          {/* Coverage card */}
          <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--text3)' }}>Data coverage</div>
            <div className="text-3xl font-bold mb-2" style={{ color: 'var(--teal)' }}>{Math.round(cov.pct * 100)}%</div>
            <div className="h-2 rounded-full mb-3" style={{ background: 'var(--bg4)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${cov.pct * 100}%`, background: 'var(--teal)' }} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-base font-semibold" style={{ color: 'var(--green)' }}>{cov.available}</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>Have</div>
              </div>
              <div>
                <div className="text-base font-semibold" style={{ color: 'var(--amber)' }}>{cov.partial}</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>Partial</div>
              </div>
              <div>
                <div className="text-base font-semibold" style={{ color: 'var(--text2)' }}>{cov.missing}</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>Missing</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
              <strong style={{ color: 'var(--text2)' }}>{cov.blockedMetricIds.length}</strong> of {ALL_MIS_METRICS.length} metrics blocked by missing data.
            </div>
          </div>

          {/* What unlocks the most */}
          <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            <div className="text-[10px] uppercase tracking-wide mb-3" style={{ color: 'var(--text3)' }}>Biggest unlocks</div>
            <div className="space-y-2">
              {cov.unlockMap.slice(0, 6).map(({ source, metrics }) => (
                <div key={`${source.kind}-${source.id}`} className="text-xs">
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text1)' }}>{source.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                      background: 'rgba(15,212,160,0.1)', color: 'var(--teal)',
                    }}>+{metrics.length}</span>
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>{source.kind === 'manual' ? 'Manual input' : source.kind === 'excel' ? 'Spreadsheet' : source.kind === 'pdf' ? 'PDF upload' : 'Tally XML'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tally panel — re-uses Layer 1 file slots ───────────────────────────

function TallyPanel({ statusById, isNeeded, onlySelected, highlightId }: {
  statusById: Map<string, SourceStatus>;
  isNeeded: (kind: DataSourceKind, id: string) => boolean;
  onlySelected: boolean;
  highlightId?: string;
}) {
  const sources = sourcesByKind('tally');
  const filtered = onlySelected ? sources.filter(s => isNeeded('tally', s.id)) : sources;
  // Pin needed sources to the top.
  const sorted = [...filtered].sort((a, b) => {
    const an = isNeeded('tally', a.id) ? 0 : 1;
    const bn = isNeeded('tally', b.id) ? 0 : 1;
    return an - bn;
  });
  return (
    <div>
      <div className="text-xs mb-3" style={{ color: 'var(--text3)' }}>
        Tally XML exports.  Already uploaded in <strong>Account Health → Upload Files</strong> — re-upload here only if missing.
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-xs" style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)' }}>
          Your selected metrics don't depend on any Tally XML sources beyond the Layer&nbsp;1 essentials.
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(source => (
            <SourceRow
              key={source.id}
              source={source}
              status={statusById.get(`tally:${source.id}`)}
              neededForSelected={isNeeded('tally', source.id)}
              highlight={highlightId === source.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Excel panel — budget template + upload ─────────────────────────────

function ExcelPanel({ state, dispatch, statusById, isNeeded, onlySelected, highlightId }: {
  state: ReturnType<typeof useApp>['state'];
  dispatch: ReturnType<typeof useApp>['dispatch'];
  statusById: Map<string, SourceStatus>;
  isNeeded: (kind: DataSourceKind, id: string) => boolean;
  onlySelected: boolean;
  highlightId?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const budget = await parseBudgetExcel(file);
      dispatch({ type: 'MIS_BUDGET_SET', budget });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse budget Excel');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const budget = state.misBudget;
  const sources = sourcesByKind('excel');

  return (
    <div className="space-y-4">
      <div className="text-xs" style={{ color: 'var(--text3)' }}>
        Download the template, fill in your monthly budget, and re-upload.  Unlocks budget-vs-actual variance metrics.
      </div>

      {/* Budget row */}
      <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="flex items-start gap-3">
          <StatusDot status={statusById.get('excel:budget')?.status ?? 'missing'} />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>Annual Budget</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
              Monthly budget per P&L line.  Unlocks budget-vs-actual variance.
            </div>
            {budget && (
              <div className="mt-2 text-xs" style={{ color: 'var(--green)' }}>
                ✓ Budget loaded · Revenue ₹{budget.revenue?.toLocaleString('en-IN') ?? '—'} · COGS ₹{budget.cogs?.toLocaleString('en-IN') ?? '—'} · PAT ₹{budget.pat?.toLocaleString('en-IN') ?? '—'}
              </div>
            )}
            {error && <div className="mt-2 text-xs" style={{ color: 'var(--red)' }}>{error}</div>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => downloadBudgetTemplate(currentFY())}
              className="text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap"
              style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
            >
              ⬇ Template
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap"
              style={{ borderColor: 'var(--teal)', color: 'var(--teal)', opacity: busy ? 0.5 : 1 }}
            >
              {busy ? '…' : (budget ? 'Replace' : '⬆ Upload')}
            </button>
            {budget && (
              <button
                onClick={() => dispatch({ type: 'MIS_BUDGET_SET', budget: null })}
                className="text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap"
                style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
              >
                ✕ Clear
              </button>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          </div>
        </div>
      </div>

      {/* Other excel sources — show as not-yet-supported placeholders */}
      {sources.filter(s => s.id !== 'budget').map(source => (
        <SourceRow
          key={source.id}
          source={source}
          status={statusById.get(`excel:${source.id}`)}
          deferred="Coming with sector-specific MIS work"
        />
      ))}
    </div>
  );
}

// ── PDF panel ──────────────────────────────────────────────────────────

function PdfPanel({ state, dispatch, statusById, isNeeded, onlySelected, highlightId }: {
  state: ReturnType<typeof useApp>['state'];
  dispatch: ReturnType<typeof useApp>['dispatch'];
  statusById: Map<string, SourceStatus>;
  isNeeded: (kind: DataSourceKind, id: string) => boolean;
  onlySelected: boolean;
  highlightId?: string;
}) {
  const sources = sourcesByKind('pdf');
  const filtered = onlySelected ? sources.filter(s => isNeeded('pdf', s.id)) : sources;
  return (
    <div className="space-y-3">
      <div className="text-xs" style={{ color: 'var(--text3)' }}>
        Upload supporting documents.  We don't parse PDFs automatically — after uploading,
        key the critical figures into the <strong>Manual Inputs</strong> tab so MIS can use them.
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-xs" style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)' }}>
          Your selected metrics don't depend on any supporting documents.
        </div>
      ) : filtered.map(source => (
        <PdfUploadRow
          key={source.id}
          source={source}
          status={statusById.get(`pdf:${source.id}`)}
          doc={state.misDocuments?.[source.id]}
          onUpload={(doc) => dispatch({ type: 'MIS_DOCUMENT_ADDED', doc })}
          onRemove={(id) => dispatch({ type: 'MIS_DOCUMENT_REMOVED', id })}
          highlight={highlightId === source.id}
        />
      ))}
    </div>
  );
}

function PdfUploadRow({ source, status, doc, onUpload, onRemove, highlight }: {
  source: DataSourceDef;
  status: SourceStatus | undefined;
  doc: MISDocumentRef | undefined;
  onUpload: (d: MISDocumentRef) => void;
  onRemove: (id: string) => void;
  highlight?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    onUpload({
      id: source.id,
      filename: f.name,
      size: f.size,
      uploadedAt: Date.now(),
    });
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div ref={rowRef} className="rounded-xl border p-4 transition-all" style={{
      background: highlight ? `${CHART_COLORS.teal}15` : 'var(--bg2)',
      borderColor: highlight ? CHART_COLORS.teal : 'var(--border)',
      outline: highlight ? `2px solid ${CHART_COLORS.teal}` : 'none',
    }}>
      <div className="flex items-start gap-3">
        <StatusDot status={status?.status ?? 'missing'} />
        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{source.label}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{source.description}</div>
          {doc && (
            <div className="mt-2 text-xs" style={{ color: 'var(--green)' }}>
              ✓ {doc.filename} · {fmtBytes(doc.size)}
            </div>
          )}
          <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{source.howToGet}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap"
            style={{ borderColor: 'var(--teal)', color: 'var(--teal)' }}
          >
            {doc ? 'Replace' : '⬆ Upload'}
          </button>
          {doc && (
            <button
              onClick={() => onRemove(source.id)}
              className="text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap"
              style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
            >
              ✕
            </button>
          )}
          <input ref={fileRef} type="file" accept=".pdf" onChange={handle} className="hidden" />
        </div>
      </div>
    </div>
  );
}

// ── Manual inputs panel ─────────────────────────────────────────────────

function ManualPanel({ state, dispatch }: {
  state: ReturnType<typeof useApp>['state'];
  dispatch: ReturnType<typeof useApp>['dispatch'];
}) {
  const inputs = state.misManualInputs ?? {};

  const update = (patch: Partial<ManualInputs>) => {
    dispatch({ type: 'MIS_MANUAL_INPUTS_SET', inputs: patch });
  };

  return (
    <div className="space-y-4">
      <div className="text-xs" style={{ color: 'var(--text3)' }}>
        Numbers that have no Tally source.  All optional — leave blank to skip the metrics that depend on them.
      </div>

      <NumField
        label="Current Headcount"
        hint="Total employees on payroll this period — drives cost-per-head"
        value={inputs.headcount}
        onChange={v => update({ headcount: v ?? undefined })}
        suffix="employees"
      />

      <NumField
        label="Order Book Value (₹)"
        hint="Confirmed pipeline / order book at period end"
        value={inputs.orderBook}
        onChange={v => update({ orderBook: v ?? undefined })}
        suffix="₹"
      />

      <NumField
        label="Drawing Power / Sanctioned Limit (₹)"
        hint="From bank sanction letter — drives utilisation metric"
        value={inputs.drawingPowerLimit}
        onChange={v => update({ drawingPowerLimit: v ?? undefined })}
        suffix="₹"
      />

      <NumField
        label="Contingent Liabilities (₹)"
        hint="Guarantees, disputes, litigation (disclosure)"
        value={inputs.contingentLiabilities}
        onChange={v => update({ contingentLiabilities: v ?? undefined })}
        suffix="₹"
      />

      <NumField
        label="Production Quantity (this period)"
        hint="Manufacturing only — units produced"
        value={inputs.productionQty}
        onChange={v => update({ productionQty: v ?? undefined })}
        suffix="units"
      />

      <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text1)' }}>Loan Covenants</div>
        <div className="text-xs mb-3" style={{ color: 'var(--text3)' }}>Read from sanction letter — drives covenant monitoring & breach flags.</div>
        <div className="grid grid-cols-3 gap-3">
          <NumField
            label="DSCR min"
            value={inputs.covenants?.dscrMin}
            onChange={v => update({ covenants: { ...inputs.covenants, dscrMin: v ?? undefined } })}
            suffix="×"
            inline
          />
          <NumField
            label="D/E max"
            value={inputs.covenants?.deRatioMax}
            onChange={v => update({ covenants: { ...inputs.covenants, deRatioMax: v ?? undefined } })}
            suffix="×"
            inline
          />
          <NumField
            label="Current ratio min"
            value={inputs.covenants?.currentRatioMin}
            onChange={v => update({ covenants: { ...inputs.covenants, currentRatioMin: v ?? undefined } })}
            suffix="×"
            inline
          />
        </div>
      </div>
    </div>
  );
}

function NumField({ label, hint, value, onChange, suffix, inline }: {
  label: string;
  hint?: string;
  value?: number;
  onChange: (v: number | null) => void;
  suffix?: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? '' : 'rounded-xl border p-4'} style={inline ? {} : { background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className={inline ? 'text-xs mb-1' : 'text-sm font-semibold mb-1'} style={{ color: 'var(--text1)' }}>{label}</div>
      {!inline && hint && <div className="text-xs mb-2" style={{ color: 'var(--text3)' }}>{hint}</div>}
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value ?? ''}
          onChange={e => {
            const raw = e.target.value;
            onChange(raw === '' ? null : Number(raw));
          }}
          className="flex-1 px-2 py-1.5 rounded border text-sm tabular-nums"
          style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
        />
        {suffix && <span className="text-xs" style={{ color: 'var(--text3)' }}>{suffix}</span>}
      </div>
    </div>
  );
}

// ── Reusable atoms ──────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'available' | 'missing' | 'partial' }) {
  return (
    <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: STATUS_COLOR[status] }} />
  );
}

function SourceRow({ source, status, deferred, neededForSelected, highlight }: {
  source: DataSourceDef;
  status: SourceStatus | undefined;
  deferred?: string;
  neededForSelected?: boolean;
  highlight?: boolean;
}) {
  const st = status?.status ?? 'missing';
  // Deep-link arrived pointing at this row — pulse it teal so the user
  // immediately sees what they came here to fix.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);
  return (
    <div ref={ref} className="rounded-xl border p-4 flex items-start gap-3 transition-all" style={{
      background: highlight ? `${CHART_COLORS.teal}15` : 'var(--bg2)',
      borderColor: highlight ? CHART_COLORS.teal : neededForSelected && st !== 'available' ? CHART_COLORS.teal + '55' : 'var(--border)',
      outline: highlight ? `2px solid ${CHART_COLORS.teal}` : 'none',
    }}>
      <StatusDot status={st} />
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{source.label}</span>
          {source.required && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(240,72,72,0.1)', color: 'var(--red)' }}>REQUIRED</span>}
          {neededForSelected && <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `${CHART_COLORS.teal}22`, color: CHART_COLORS.teal }}>NEEDED FOR YOUR METRICS</span>}
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
            background: `${STATUS_COLOR[st]}22`, color: STATUS_COLOR[st],
          }}>{st === 'available' ? 'Available' : st === 'partial' ? 'Partial' : 'Missing'}</span>
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{source.description}</div>
        {status?.note && <div className="text-[10px] mt-1" style={{ color: 'var(--green)' }}>✓ {status.note}</div>}
        <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{source.howToGet}</div>
        {deferred && <div className="text-[10px] mt-1" style={{ color: 'var(--amber)' }}>⚠ {deferred}</div>}
        {source.unlocks.length > 0 && (
          <div className="text-[10px] mt-2" style={{ color: 'var(--text2)' }}>
            Unlocks <strong>{source.unlocks.length}</strong> metric{source.unlocks.length === 1 ? '' : 's'}: {source.unlocks.slice(0, 4).join(', ')}{source.unlocks.length > 4 ? '…' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
