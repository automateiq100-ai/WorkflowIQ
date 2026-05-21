'use client';

/**
 * MIS Metrics Checklist — the full 73-metric inventory.
 *
 * Mirrors Account Health's ChecklistView: header with summary counts,
 * filter tabs, per-domain collapsible sections, every metric row with
 * status / weight / score contribution / formula / source / current value
 * + a "View working" hyperlink that traces to Backup Working.
 *
 * Differs from MIS Analysis (which is the score + gaps rollup) in that
 * this view is a per-metric audit table — every entry visible, drillable,
 * exportable to CSV.
 */

import { useMemo, useState } from 'react';
import { useApp } from '@/lib/state';
import { runMIS } from '@/lib/layer2/mis/runner';
import { MIS_DOMAINS, ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';
import '@/lib/layer2/mis/metric-inputs';
import { STATUS_WEIGHT, type MetricStatus, type MetricResult, type MetricResultStatus } from '@/lib/layer2/types';
import { runRules, DEFAULT_RULES, violationsByMetric, topViolation } from '@/lib/layer2/rules';
import { CHART_COLORS, fmtResult, type ReportUnit, SEVERITY_COLOR } from './atoms';

// ── Filter tabs ─────────────────────────────────────────────────────────

type FilterMode = 'all' | 'auto' | 'partial' | 'manual' | 'new-xml' | 'computed' | 'missing';

const FILTER_TABS: { mode: FilterMode; label: string }[] = [
  { mode: 'all',       label: 'All' },
  { mode: 'computed',  label: 'Computed' },
  { mode: 'partial',   label: 'Partial' },
  { mode: 'missing',   label: 'Missing data' },
  { mode: 'manual',    label: 'Manual' },
  { mode: 'new-xml',   label: 'New XML' },
];

const STATUS_TINT: Record<MetricStatus, { bg: string; fg: string; label: string }> = {
  auto:      { bg: 'rgba(76,175,121,0.12)',  fg: CHART_COLORS.green,  label: 'Auto' },
  partial:   { bg: 'rgba(245,166,35,0.12)',  fg: CHART_COLORS.amber,  label: 'Partial' },
  manual:    { bg: 'rgba(242,107,91,0.12)',  fg: CHART_COLORS.coral,  label: 'Manual' },
  'new-xml': { bg: 'rgba(240,72,72,0.12)',   fg: CHART_COLORS.red,    label: 'New XML' },
};

const RESULT_TINT: Record<MetricResultStatus, { bg: string; fg: string; label: string }> = {
  computed:          { bg: 'rgba(76,175,121,0.15)', fg: CHART_COLORS.green,  label: '✓ Computed' },
  partial:           { bg: 'rgba(245,166,35,0.15)', fg: CHART_COLORS.amber,  label: '◐ Partial' },
  'missing-data':    { bg: 'rgba(107,114,128,0.15)', fg: 'var(--text3)',    label: '— Missing' },
  'manual-required': { bg: 'rgba(242,107,91,0.15)', fg: CHART_COLORS.coral,  label: '✎ Manual' },
  na:                { bg: 'rgba(107,114,128,0.10)', fg: 'var(--text3)',    label: 'N/A' },
};

// ── CSV export ──────────────────────────────────────────────────────────

function exportCSV(rows: Array<{
  id: string; domain: string; label: string;
  declared: MetricStatus; actual: MetricResultStatus;
  formula: string; source: string;
  weight: number; contribution: number;
  value: string; reason: string;
}>) {
  const header = ['ID', 'Domain', 'Metric', 'Declared status', 'Actual status', 'Weight', 'Score contribution', 'Value', 'Formula', 'Source', 'Reason'];
  const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
  const lines = rows.map(r => [
    r.id, esc(r.domain), esc(r.label), r.declared, r.actual,
    r.weight, r.contribution.toFixed(2), esc(r.value),
    esc(r.formula), esc(r.source), esc(r.reason),
  ].join(','));
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MIS_Metrics_Checklist.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ───────────────────────────────────────────────────────────

export default function MISMetricsChecklistView() {
  const { state, dispatch } = useApp();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const unit: ReportUnit = 'lakhs';

  const out = useMemo(
    () => runMIS({ state, manual: state.misManualInputs ?? {}, budget: state.misBudget }),
    [state],
  );
  const violations = useMemo(
    () => runRules(state.misRules ?? DEFAULT_RULES, out.byId, state.misSetup.sector),
    [state.misRules, out.byId, state.misSetup.sector],
  );
  const vByMetric = useMemo(() => violationsByMetric(violations), [violations]);

  const selectedIds = state.misSetup.selectedMetricIds.length > 0
    ? new Set(state.misSetup.selectedMetricIds)
    : new Set(ALL_MIS_METRICS.map(m => m.id));

  // Filter predicate.
  function matchesFilter(m: typeof ALL_MIS_METRICS[number], r: MetricResult | undefined): boolean {
    if (!selectedIds.has(m.id)) return false;
    switch (filter) {
      case 'auto':     return m.defaultStatus === 'auto';
      case 'partial':  return m.defaultStatus === 'partial';
      case 'manual':   return m.defaultStatus === 'manual';
      case 'new-xml':  return m.defaultStatus === 'new-xml';
      case 'computed': return r?.status === 'computed';
      case 'missing':  return r?.status === 'missing-data' || r?.status === 'manual-required';
      default:         return true;
    }
  }

  const filteredMetrics = ALL_MIS_METRICS.filter(m => matchesFilter(m, out.byId[m.id]));
  const totalCount = filteredMetrics.length;

  // Headline summary
  const total = ALL_MIS_METRICS.filter(m => selectedIds.has(m.id)).length;
  const computed = ALL_MIS_METRICS.filter(m => selectedIds.has(m.id) && out.byId[m.id]?.status === 'computed').length;
  const partial = ALL_MIS_METRICS.filter(m => selectedIds.has(m.id) && out.byId[m.id]?.status === 'partial').length;
  const missing = ALL_MIS_METRICS.filter(m => selectedIds.has(m.id) && (out.byId[m.id]?.status === 'missing-data' || out.byId[m.id]?.status === 'manual-required')).length;

  function toggleCollapse(domainId: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return next;
    });
  }

  // Pre-compute rows for CSV.
  const allRows = ALL_MIS_METRICS.filter(m => selectedIds.has(m.id)).map(m => {
    const r = out.byId[m.id];
    const weight = STATUS_WEIGHT[m.defaultStatus];
    const contrib = (r?.status === 'computed' || r?.status === 'partial') ? weight : 0;
    return {
      id: m.id,
      domain: MIS_DOMAINS.find(d => d.id === m.domainId)?.label ?? m.domainId,
      label: m.label,
      declared: m.defaultStatus,
      actual: r?.status ?? 'missing-data',
      formula: m.formula ?? '',
      source: m.source ?? '',
      weight,
      contribution: contrib,
      value: fmtResult(r, unit),
      reason: r?.reason ?? '',
    };
  });

  const trace = (metricId: string) => {
    dispatch({ type: 'MIS_BACKUP_FOCUS', metricId });
    dispatch({ type: 'SET_VIEW', view: 'mis-report-backup' });
  };

  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text1)' }}>Metrics Checklist</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            Every metric — its declared status, current result, weight, score contribution, formula, and source.
            Click any row to jump to its working in Backup.
          </p>
        </div>
        <button onClick={() => exportCSV(allRows)}
          className="text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
          ↓ Export CSV
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-5 gap-3">
        <Stat label="Total" value={total} color={CHART_COLORS.teal} />
        <Stat label="Computed" value={computed} color={CHART_COLORS.green} />
        <Stat label="Partial" value={partial} color={CHART_COLORS.amber} />
        <Stat label="Missing / Manual" value={missing} color={CHART_COLORS.coral} />
        <Stat label="MIS Score" value={out.readiness.misScore} color={CHART_COLORS.teal} sub={`/ ${out.readiness.potentialScore}`} highlight />
      </div>

      {/* Filter tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
        {FILTER_TABS.map(t => (
          <button key={t.mode}
            onClick={() => setFilter(t.mode)}
            className="px-4 py-2 text-xs border-b-2 transition-colors whitespace-nowrap"
            style={{
              borderColor: filter === t.mode ? CHART_COLORS.teal : 'transparent',
              color: filter === t.mode ? CHART_COLORS.teal : 'var(--text2)',
              marginBottom: -1,
              fontWeight: filter === t.mode ? 600 : 400,
            }}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto text-[11px] py-2 px-2" style={{ color: 'var(--text3)' }}>
          Showing <strong>{totalCount}</strong> of {total} metrics
        </div>
      </div>

      {/* Domain-grouped rows */}
      {MIS_DOMAINS.map(domain => {
        const domainMetrics = filteredMetrics.filter(m => m.domainId === domain.id);
        if (domainMetrics.length === 0) return null;
        const isCollapsed = collapsed.has(domain.id);

        // Domain rollup
        const domainSelected = domain.metrics.filter(m => selectedIds.has(m.id));
        const domainComputable = domainSelected.reduce((s, m) => s + STATUS_WEIGHT[m.defaultStatus], 0);
        const domainReadiness = domainSelected.length > 0 ? (domainComputable / domainSelected.length) * 100 : 0;
        const domainComputedCount = domainSelected.filter(m => out.byId[m.id]?.status === 'computed').length;

        return (
          <div key={domain.id} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            <button onClick={() => toggleCollapse(domain.id)}
              className="w-full px-5 py-3 border-b flex items-center gap-3 transition-colors hover:bg-[var(--bg3)]"
              style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}>
              <span className="text-xs font-bold tabular-nums w-6 text-left" style={{ color: 'var(--text3)' }}>{domain.id}</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{domain.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${CHART_COLORS.teal}22`, color: CHART_COLORS.teal }}>
                {domainComputedCount} / {domainSelected.length} computed
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text3)' }}>
                · Readiness {domainReadiness.toFixed(0)}%
              </span>
              <div className="ml-auto h-1.5 rounded-full w-24" style={{ background: 'var(--bg4)' }}>
                <div className="h-full rounded-full transition-all" style={{
                  width: `${domainReadiness}%`,
                  background: domainReadiness > 80 ? CHART_COLORS.green : domainReadiness > 50 ? CHART_COLORS.amber : CHART_COLORS.red,
                }} />
              </div>
              <span className="text-xs ml-2" style={{ color: 'var(--text3)' }}>{isCollapsed ? '▸' : '▾'}</span>
            </button>

            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead style={{ background: 'var(--bg3)' }}>
                    <tr>
                      <th className="text-left px-3 py-2 font-medium w-14" style={{ color: 'var(--text3)' }}>ID</th>
                      <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Metric</th>
                      <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Declared</th>
                      <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Status</th>
                      <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Value</th>
                      <th className="text-center px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Weight</th>
                      <th className="text-center px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Contrib.</th>
                      <th className="text-center px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domainMetrics.map(m => {
                      const r = out.byId[m.id];
                      const declared = STATUS_TINT[m.defaultStatus];
                      const result = RESULT_TINT[r?.status ?? 'missing-data'];
                      const weight = STATUS_WEIGHT[m.defaultStatus];
                      const computedOrPartial = r?.status === 'computed' || r?.status === 'partial';
                      const contrib = computedOrPartial ? weight : 0;
                      const top = topViolation(vByMetric[m.id]);

                      return (
                        <tr key={m.id}
                          className="border-t transition-colors hover:bg-[var(--bg3)] cursor-pointer"
                          style={{ borderColor: 'var(--border)' }}
                          onClick={() => trace(m.id)}
                          title="View working in Backup">
                          <td className="px-3 py-2 tabular-nums font-mono" style={{ color: 'var(--text3)' }}>{m.id}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--text1)' }}>
                            <div className="flex items-center gap-2">
                              <span>{m.label}</span>
                              {top && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                                  style={{ background: `${SEVERITY_COLOR[top.severity]}22`, color: SEVERITY_COLOR[top.severity] }}
                                  title={top.message}>
                                  {top.severity}
                                </span>
                              )}
                            </div>
                            {m.formula && (
                              <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text3)' }}>{m.formula}</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: declared.bg, color: declared.fg }}>
                              {declared.label}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: result.bg, color: result.fg }}>
                              {result.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text1)' }}>
                            {fmtResult(r, unit)}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums" style={{ color: 'var(--text3)' }}>
                            {weight.toFixed(1)}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums" style={{
                            color: contrib > 0 ? CHART_COLORS.green : 'var(--text3)',
                            fontWeight: contrib > 0 ? 600 : 400,
                          }}>
                            {contrib > 0 ? `+${contrib.toFixed(1)}` : '0'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-[10px]" style={{ color: CHART_COLORS.teal }}>View →</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {filteredMetrics.length === 0 && (
        <div className="rounded-xl border p-8 text-center text-xs" style={{
          background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)',
        }}>
          No metrics match this filter.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, sub, highlight }: { label: string; value: number; color: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border p-4" style={{
      background: highlight ? `${color}15` : 'var(--bg2)',
      borderColor: highlight ? color : 'var(--border)',
    }}>
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-2xl font-bold tabular-nums flex items-baseline gap-1" style={{ color }}>
        {value}
        {sub && <span className="text-xs" style={{ color: 'var(--text3)' }}>{sub}</span>}
      </div>
    </div>
  );
}
