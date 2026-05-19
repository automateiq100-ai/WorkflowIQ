'use client';

/**
 * Missing Details — what's still required for the user's selected metrics,
 * grouped by the action needed to fill the gap.
 *
 * Flow:
 *   1. For each *selected* metric, resolve its inputs (data-sources.ts +
 *      metric-inputs.ts).
 *   2. Drop inputs already satisfied (availability.ts).
 *   3. Group remaining inputs by source kind (tally / excel / pdf / manual)
 *      and dedup — one row per missing source, listing the metrics it
 *      unlocks.
 *   4. Each row has a "Take me there" button that deep-links to Upload
 *      Files or Company Profile to fix it.
 */

import { useMemo, useState } from 'react';
import { useApp } from '@/lib/state';
import { runMIS } from '@/lib/layer2/mis/runner';
import { ALL_MIS_METRICS, MIS_DOMAINS } from '@/lib/layer2/mis/metrics';
import '@/lib/layer2/mis/metric-inputs';
import { coverage, checkSource } from '@/lib/layer2/availability';
import { ALL_DATA_SOURCES, type DataSourceDef, type DataSourceKind, findSource } from '@/lib/layer2/data-sources';
import type { ViewId } from '@/lib/types';
import type { MetricResultStatus } from '@/lib/layer2/types';
import { CHART_COLORS } from './atoms';

type MetricFilterMode = 'all' | 'partial' | 'missing-data' | 'manual-required';

const METRIC_FILTER_TABS: { mode: MetricFilterMode; label: string; tint: keyof typeof CHART_COLORS }[] = [
  { mode: 'all',              label: 'All affected', tint: 'teal' },
  { mode: 'partial',          label: 'Partial',      tint: 'amber' },
  { mode: 'missing-data',     label: 'Missing data', tint: 'red' },
  { mode: 'manual-required',  label: 'Manual',       tint: 'coral' },
];

const RESULT_TINT: Record<MetricResultStatus, { fg: string; bg: string; label: string }> = {
  computed:          { fg: CHART_COLORS.green,  bg: 'rgba(76,175,121,0.15)',  label: '✓ Computed' },
  partial:           { fg: CHART_COLORS.amber,  bg: 'rgba(245,166,35,0.15)',  label: '◐ Partial' },
  'missing-data':    { fg: CHART_COLORS.red,    bg: 'rgba(240,72,72,0.15)',   label: '✕ Missing' },
  'manual-required': { fg: CHART_COLORS.coral,  bg: 'rgba(242,107,91,0.15)',  label: '✎ Manual' },
  na:                { fg: 'var(--text3)',      bg: 'rgba(107,114,128,0.10)', label: 'N/A' },
};

const KIND_META: Record<DataSourceKind, { label: string; icon: string; tint: keyof typeof CHART_COLORS; targetView: ViewId; targetNote: string }> = {
  tally:  { label: 'Tally XML exports',  icon: '⬆', tint: 'teal',   targetView: 'mis-upload',  targetNote: 'Open Upload Files' },
  excel:  { label: 'Spreadsheets',       icon: '⊞', tint: 'blue',   targetView: 'mis-upload',  targetNote: 'Open Upload Files' },
  pdf:    { label: 'Documents',          icon: '📎', tint: 'amber',  targetView: 'mis-upload',  targetNote: 'Open Upload Files' },
  manual: { label: 'Manual inputs',      icon: '✎', tint: 'coral',  targetView: 'mis-profile', targetNote: 'Open Company Profile' },
};

export default function MISFixView() {
  const { state, dispatch } = useApp();
  const [metricFilter, setMetricFilter] = useState<MetricFilterMode>('all');

  // Selected metrics — fall back to all when user hasn't customised.
  const selectedIds = state.misSetup.selectedMetricIds.length > 0
    ? new Set(state.misSetup.selectedMetricIds)
    : new Set(ALL_MIS_METRICS.map(m => m.id));

  const selectedMetrics = ALL_MIS_METRICS.filter(m => selectedIds.has(m.id));

  const out = useMemo(
    () => runMIS({ state, manual: state.misManualInputs ?? {}, budget: state.misBudget }),
    [state],
  );
  const cov = useMemo(() => coverage(state, selectedMetrics), [state, selectedMetrics]);

  // ── Metrics needing attention (NEW) ──
  // Every selected metric that didn't compute cleanly.  For each, also
  // figure out which specific inputs are still missing so we can show a
  // tailored "What's needed" hint per row.
  //
  // We track two things separately:
  //   missingInputs    — uploadable sources (tally / excel / pdf / manual)
  //                      that the user can directly act on.
  //   needsMorePeriods — true when the metric declares a `period` input
  //                      requirement AND all its other (non-period) inputs
  //                      are already satisfied — i.e. the only blocker is
  //                      not enough months of history.  Drives the
  //                      "Upload more periods" CTA which routes to Account
  //                      Health upload.
  const affectedMetrics = useMemo(() => {
    return selectedMetrics
      .map(m => {
        const r = out.byId[m.id];
        const status = r?.status ?? 'missing-data';
        if (status === 'computed' || status === 'na') return null;

        const inputs = m.inputs ?? [];
        const missingInputs = inputs.filter(inp => {
          if (inp.type === 'period') return false;
          const source = findSource(inp.type, inp.id);
          if (!source) return false;
          return checkSource(state, source).status !== 'available';
        });

        const declaresPeriod = inputs.some(inp => inp.type === 'period');
        const nonPeriodInputsSatisfied = inputs.every(inp => {
          if (inp.type === 'period') return true;
          const source = findSource(inp.type, inp.id);
          if (!source) return true;
          return checkSource(state, source).status === 'available';
        });
        const needsMorePeriods = declaresPeriod && nonPeriodInputsSatisfied;

        return { metric: m, result: r, status, missingInputs, needsMorePeriods };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .filter(x => metricFilter === 'all' ? true : x.status === metricFilter);
  }, [selectedMetrics, out, state, metricFilter]);

  const totalAffectedAll = selectedMetrics.filter(m => {
    const s = out.byId[m.id]?.status;
    return s && s !== 'computed' && s !== 'na';
  }).length;

  // Build the missing-source × metrics map for SELECTED metrics only.
  const grouped = useMemo(() => {
    type Row = { source: DataSourceDef; unlocks: string[]; required: boolean };
    const rows = new Map<string, Row>();
    for (const m of selectedMetrics) {
      const inputs = m.inputs ?? [];
      for (const inp of inputs) {
        // 'period' inputs are an internal hint — skip in this view; the
        // user can't "upload" a period, it just needs multi-period data.
        if (inp.type === 'period') continue;
        const source = ALL_DATA_SOURCES.find(s => s.kind === inp.type && s.id === inp.id);
        if (!source) continue;
        const status = checkSource(state, source).status;
        if (status === 'available') continue;
        const key = `${source.kind}:${source.id}`;
        const existing = rows.get(key);
        if (existing) {
          existing.unlocks.push(m.id);
          existing.required = existing.required || inp.required;
        } else {
          rows.set(key, { source, unlocks: [m.id], required: inp.required });
        }
      }
    }
    // Bucket by kind for the grouped layout.
    const byKind: Record<DataSourceKind, Row[]> = { tally: [], excel: [], pdf: [], manual: [] };
    for (const row of rows.values()) {
      byKind[row.source.kind].push(row);
    }
    // Sort each bucket by metrics-unlocked desc.
    for (const k of Object.keys(byKind) as DataSourceKind[]) {
      byKind[k].sort((a, b) => b.unlocks.length - a.unlocks.length);
    }
    return byKind;
  }, [selectedMetrics, state]);

  const totalMissing = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);
  const totalBlockedMetrics = cov.blockedMetricIds.length;

  const goTo = (view: ViewId) => dispatch({ type: 'SET_VIEW', view });
  const traceTo = (metricId: string) => {
    dispatch({ type: 'MIS_BACKUP_FOCUS', metricId });
    dispatch({ type: 'SET_VIEW', view: 'mis-report-backup' });
  };
  /**
   * Deep-link to Upload Files (or Company Profile) with a specific tab /
   * field pre-selected.  The destination view consumes
   * `state.misUploadDeepLink` on mount and clears it.  Manual inputs live
   * on Company Profile rather than Upload Files, so we route those there.
   */
  const fixThis = (kind: DataSourceKind, sourceId?: string) => {
    if (kind === 'manual') {
      dispatch({ type: 'SET_VIEW', view: 'mis-profile' });
      return;
    }
    dispatch({ type: 'MIS_UPLOAD_DEEPLINK', deepLink: { tab: kind, sourceId } });
    dispatch({ type: 'SET_VIEW', view: 'mis-upload' });
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text1)' }}>
          Missing Details
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
          What the system still needs for your <strong style={{ color: 'var(--text2)' }}>{selectedMetrics.length} selected metric{selectedMetrics.length === 1 ? '' : 's'}</strong>, grouped by where to fix it.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="MIS Score" value={out.readiness.misScore} sub={`Potential: ${out.readiness.potentialScore}`} color={CHART_COLORS.teal} />
        <Stat label="Metrics affected" value={totalAffectedAll} sub={`Of ${selectedMetrics.length} selected`} color={CHART_COLORS.amber} />
        <Stat label="Inputs missing" value={totalMissing} sub="Source uploads needed" color={CHART_COLORS.coral} />
        <Stat label="Metrics blocked" value={totalBlockedMetrics} sub={`${selectedMetrics.length - totalBlockedMetrics} ready`} color={CHART_COLORS.red} />
      </div>

      {/* ── Metrics needing attention (new) ── */}
      {totalAffectedAll > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="px-5 py-3 border-b flex items-center justify-between flex-wrap gap-2" style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>Metrics needing attention</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `${CHART_COLORS.amber}22`, color: CHART_COLORS.amber }}>
                {totalAffectedAll} of {selectedMetrics.length}
              </span>
            </div>
            <div className="flex border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {METRIC_FILTER_TABS.map(t => (
                <button key={t.mode}
                  onClick={() => setMetricFilter(t.mode)}
                  className="px-3 py-1 text-[11px] transition-colors"
                  style={{
                    background: metricFilter === t.mode ? CHART_COLORS[t.tint] : 'transparent',
                    color: metricFilter === t.mode ? '#fff' : 'var(--text2)',
                    fontWeight: metricFilter === t.mode ? 600 : 400,
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {affectedMetrics.length === 0 ? (
            <div className="p-6 text-center text-xs" style={{ color: 'var(--text3)' }}>
              No metrics in this category.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--bg3)' }}>
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-14" style={{ color: 'var(--text3)' }}>ID</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Metric</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Status</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>What it needs</th>
                  <th className="text-center px-3 py-2 font-medium" style={{ color: 'var(--text3)', width: 170 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {affectedMetrics.map(({ metric, result, status, missingInputs, needsMorePeriods }) => {
                  const tint = RESULT_TINT[status];

                  // Pick the most-actionable missing input for this metric and
                  // craft an explicit per-row CTA the user can't miss.  Each
                  // kind gets its own colour + label so the button itself tells
                  // the user what they're about to do.
                  const firstFixable = missingInputs[0];
                  const periodOnly = !firstFixable && needsMorePeriods;
                  const cta = firstFixable
                    ? {
                        tally:  { label: '⬆ Upload XML',       color: CHART_COLORS.teal },
                        excel:  { label: '⊞ Upload Excel',     color: CHART_COLORS.blue },
                        pdf:    { label: '📎 Upload PDF',      color: CHART_COLORS.amber },
                        manual: { label: '✎ Enter manually',   color: CHART_COLORS.coral },
                      }[firstFixable.type as 'tally' | 'excel' | 'pdf' | 'manual']
                    : periodOnly
                      ? { label: '⬆ Upload more periods', color: CHART_COLORS.purple }
                      : { label: 'View working', color: CHART_COLORS.teal };

                  const primaryAction = firstFixable
                    ? () => {
                        if (firstFixable.type === 'manual') {
                          dispatch({ type: 'SET_VIEW', view: 'mis-profile' });
                        } else if (firstFixable.type === 'tally' || firstFixable.type === 'excel' || firstFixable.type === 'pdf') {
                          dispatch({ type: 'MIS_UPLOAD_DEEPLINK', deepLink: { tab: firstFixable.type, sourceId: firstFixable.id } });
                          dispatch({ type: 'SET_VIEW', view: 'mis-upload' });
                        }
                      }
                    : periodOnly
                      ? () => {
                          // Multi-period uploads live in Account Health's
                          // Upload Files (single-source for all XML intake).
                          dispatch({ type: 'SET_MODULE', module: 'accounting' });
                          dispatch({ type: 'SET_VIEW', view: 'upload' });
                        }
                      : () => traceTo(metric.id);
                  return (
                    <tr key={metric.id}
                      className="border-t transition-colors hover:bg-[var(--bg3)] cursor-pointer"
                      style={{ borderColor: 'var(--border)' }}
                      onClick={primaryAction}
                      title={firstFixable ? `Go fix this — ${firstFixable.type === 'manual' ? 'Company Profile' : 'Upload Files'}` : 'View working in Backup'}>
                      <td className="px-3 py-2 tabular-nums font-mono" style={{ color: 'var(--text3)' }}>{metric.id}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text1)' }}>
                        <div>{metric.label}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>
                          {MIS_DOMAINS.find(d => d.id === metric.domainId)?.label}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap" style={{ background: tint.bg, color: tint.fg }}>
                          {tint.label}
                        </span>
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--text2)' }}>
                        {result?.reason ? (
                          <div className="text-[11px]">{result.reason}</div>
                        ) : (
                          <div className="text-[11px]" style={{ color: 'var(--text3)' }}>{metric.remediation}</div>
                        )}
                        {missingInputs.length > 0 && (
                          <div className="text-[10px] mt-1 flex flex-wrap gap-1">
                            {missingInputs.slice(0, 4).map((inp, i) => {
                              const src = inp.type === 'period' ? undefined : findSource(inp.type, inp.id);
                              return (
                                <span key={i} className="px-1.5 py-0.5 rounded" style={{
                                  background: `${CHART_COLORS.coral}22`, color: CHART_COLORS.coral,
                                }}>
                                  {src?.label ?? `${inp.type}:${inp.id}`}
                                </span>
                              );
                            })}
                            {missingInputs.length > 4 && (
                              <span className="text-[10px]" style={{ color: 'var(--text3)' }}>+{missingInputs.length - 4} more</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); primaryAction(); }}
                          className="text-[10px] px-2.5 py-1 rounded font-semibold whitespace-nowrap transition-all hover:brightness-110"
                          style={{ background: cta.color, color: '#fff' }}
                          title={cta.label}
                        >
                          {cta.label}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Section divider ── */}
      {totalMissing > 0 && (
        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text3)' }}>
            Action plan — where to fix
          </span>
          <div className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
        </div>
      )}

      {totalMissing === 0 ? (
        <div className="rounded-xl border p-6 text-center" style={{
          background: `${CHART_COLORS.green}11`, borderColor: `${CHART_COLORS.green}55`,
        }}>
          <div className="text-base font-semibold mb-1" style={{ color: CHART_COLORS.green }}>All set ✓</div>
          <div className="text-xs" style={{ color: 'var(--text2)' }}>
            Every selected metric has the data it needs.  Head to the Dashboard or any report panel.
          </div>
        </div>
      ) : (
        (Object.entries(grouped) as Array<[DataSourceKind, typeof grouped[DataSourceKind]]>).map(([kind, rows]) => {
          if (rows.length === 0) return null;
          const meta = KIND_META[kind];
          const tintColor = CHART_COLORS[meta.tint];
          return (
            <div key={kind} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)', background: `${tintColor}11` }}>
                <div className="flex items-center gap-2">
                  <span className="text-base" style={{ color: tintColor }}>{meta.icon}</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{meta.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `${tintColor}22`, color: tintColor }}>
                    {rows.length} missing
                  </span>
                </div>
                <button onClick={() => fixThis(kind)}
                  className="text-[11px] px-3 py-1.5 rounded font-semibold"
                  style={{ background: tintColor, color: '#fff' }}>
                  {meta.targetNote} →
                </button>
              </div>
              {rows.map(({ source, unlocks, required }) => (
                <div key={`${source.kind}-${source.id}`} className="px-5 py-3 border-b last:border-b-0 flex items-start gap-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{source.label}</span>
                      {required && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(240,72,72,0.15)', color: CHART_COLORS.red }}>
                          REQUIRED
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${CHART_COLORS.teal}22`, color: CHART_COLORS.teal }}>
                        Unlocks {unlocks.length}
                      </span>
                    </div>
                    <div className="text-xs mb-1" style={{ color: 'var(--text2)' }}>{source.description}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
                      <strong>How to get it:</strong> {source.howToGet}
                    </div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--text3)' }}>
                      <strong>Will unlock:</strong> {unlocks.slice(0, 6).join(', ')}{unlocks.length > 6 ? ` +${unlocks.length - 6} more` : ''}
                    </div>
                  </div>
                  <button onClick={() => fixThis(source.kind, source.id)}
                    className="text-[10px] px-3 py-1.5 rounded border whitespace-nowrap shrink-0"
                    style={{ borderColor: tintColor, color: tintColor }}>
                    Fix this →
                  </button>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{sub}</div>
    </div>
  );
}
