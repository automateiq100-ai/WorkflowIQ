/**
 * MIS metric runner.
 *
 * Takes an AppState (or already-built Period[] + manual inputs) and runs
 * every declared metric through its compute() in one pass, producing a
 * { byId, byDomain, bySection } result bundle for the UI and Excel layers
 * to consume.
 *
 * The runner is pure / deterministic — same input always produces the same
 * output.  No side effects, no async work.
 */

import type { AppState } from '../../types';
import type {
  MetricContext, MetricDef, MetricResult, ManualInputs, BudgetData,
  Layer2Module, ReadinessScore,
} from '../types';
import { STATUS_WEIGHT } from '../types';
import { periodsFromState, splitHistory, buildMonthlyPeriods } from '../periods';
import { parseBills, type Bill } from '../../bills-parser';
import { ALL_MIS_METRICS, MIS_DOMAINS, findMetric } from './metrics';
import './metric-inputs';   // side-effect: populates ALL_MIS_METRICS[*].inputs
import { sectorMetricsFor } from './sectors';
import { MIS_SECTIONS, type SectionId } from './sections';

// ── Runner inputs / outputs ──────────────────────────────────────────────

export interface MISRunInput {
  state: AppState;
  manual?: ManualInputs;
  budget?: BudgetData;
  /** Subset of metric ids to include — defaults to all (core + sector). */
  selectedMetricIds?: string[];
}

export interface MISRunOutput {
  /** Built MetricContext used for every compute call. */
  context: MetricContext;
  /** Period list used. */
  periods: ReturnType<typeof periodsFromState>;
  /** All metric defs we ran (core + sector add-ons matching ctx.sector). */
  metrics: MetricDef[];
  /** Results keyed by metric id. */
  byId: Record<string, MetricResult>;
  /** Results grouped by domain id (D1…D7). */
  byDomain: Record<string, MetricResult[]>;
  /** Results grouped by report section id. */
  bySection: Record<SectionId, MetricResult[]>;
  /** Readiness summary (selected metrics only). */
  readiness: ReadinessScore;
}

// ── Run ──────────────────────────────────────────────────────────────────

export function runMIS(input: MISRunInput): MISRunOutput {
  const { state, manual = {}, budget } = input;
  const periods = periodsFromState(state);
  const { current, prior, history } = splitHistory(periods);

  // Empty / pre-analysis state: produce a bundle of missing-data results
  // so the UI can still render a coherent "no data yet" view.
  if (!current) {
    const empty: Record<string, MetricResult> = {};
    for (const m of ALL_MIS_METRICS) {
      empty[m.id] = { id: m.id, status: 'missing-data', value: null, reason: 'No analysed period available' };
    }
    return {
      context: blankContext(state, manual, budget),
      periods, metrics: ALL_MIS_METRICS,
      byId: empty,
      byDomain: bucketByDomain(ALL_MIS_METRICS, empty),
      bySection: bucketBySection(empty),
      readiness: {
        l1Score: 0, selectedCount: 0, computable: 0, readinessPct: 0,
        misScore: 0, potentialScore: 0, gaps: [],
      },
    };
  }

  const sector = state.misSetup.sector ?? null;
  // Derive monthly slices from voucher data when the single upload spans 2+
  // calendar months — used by MoM / trend / "N of 12" metrics that would
  // otherwise stall as `partial` with "only 1 period uploaded".
  const monthlyPeriods = buildMonthlyPeriods(state, current);
  // Parse Bills.xml / Payables.xml when uploaded so WC3, aging, and overdue
  // metrics can read per-bill outstanding amounts directly (rather than
  // approximating from TB closing balances or DayBook party turnover).
  const bills: Bill[] = [];
  const billsXml = state.files.bills?.content;
  const payablesXml = state.files.payables?.content;
  if (billsXml) bills.push(...parseBills(billsXml, 'receivable'));
  if (payablesXml) bills.push(...parseBills(payablesXml, 'payable'));
  const context: MetricContext = {
    current, prior, history, manual, budget, sector,
    monthlyPeriods: monthlyPeriods.length >= 2 ? monthlyPeriods : undefined,
    bills: bills.length > 0 ? bills : undefined,
  };

  // Core 73 + sector add-ons for the selected sector
  const sectorMetrics = sectorMetricsFor(sector);
  const allMetrics = [...ALL_MIS_METRICS, ...sectorMetrics];

  // Subset based on user selection (when provided) — sector add-ons
  // default to OFF unless explicitly selected in setup.
  const selectedIds = input.selectedMetricIds && input.selectedMetricIds.length > 0
    ? new Set(input.selectedMetricIds)
    : new Set(ALL_MIS_METRICS.map(m => m.id));   // sector add-ons opt-in only

  const byId: Record<string, MetricResult> = {};
  for (const m of allMetrics) {
    // Always compute every metric we know about — the *selection* filter
    // only affects readiness scoring, not the result map.  Lets the UI
    // show off-selection metrics in tooltips / what-if previews without
    // re-running compute.
    try {
      byId[m.id] = m.compute(context);
    } catch (err) {
      // Defensive: a compute throw shouldn't crash the whole run.
      byId[m.id] = { id: m.id, status: 'missing-data', value: null,
        reason: `Compute error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const byDomain = bucketByDomain(allMetrics, byId);
  const bySection = bucketBySection(byId);
  const readiness = computeReadiness(state, allMetrics, byId, selectedIds);

  return { context, periods, metrics: allMetrics, byId, byDomain, bySection, readiness };
}

// ── Convenience helpers ─────────────────────────────────────────────────

export function bucketByDomain(
  metrics: MetricDef[], byId: Record<string, MetricResult>,
): Record<string, MetricResult[]> {
  const out: Record<string, MetricResult[]> = {};
  for (const m of metrics) {
    const r = byId[m.id];
    if (!r) continue;
    (out[m.domainId] ??= []).push(r);
  }
  return out;
}

export function bucketBySection(
  byId: Record<string, MetricResult>,
): Record<SectionId, MetricResult[]> {
  const out = Object.fromEntries(MIS_SECTIONS.map(s => [s.id, [] as MetricResult[]])) as Record<SectionId, MetricResult[]>;
  for (const s of MIS_SECTIONS) {
    for (const id of s.metricIds) {
      if (byId[id]) out[s.id].push(byId[id]);
    }
  }
  return out;
}

function computeReadiness(
  state: AppState,
  metrics: MetricDef[],
  byId: Record<string, MetricResult>,
  selected: Set<string>,
): ReadinessScore {
  const l1 = state.results?.cappedScore ?? state.results?.overall ?? 0;
  const selectedMetrics = metrics.filter(m => selected.has(m.id));
  const computable = selectedMetrics.reduce((s, m) => s + STATUS_WEIGHT[m.defaultStatus], 0);
  const denom = selectedMetrics.length;
  const readinessPct = denom > 0 ? computable / denom : 0;
  const misScore = Math.round(l1 * readinessPct);
  // Gaps: non-auto metrics, with per-metric score impact in points.
  const gaps = selectedMetrics
    .filter(m => m.defaultStatus !== 'auto')
    .map(m => {
      const lift = m.defaultStatus === 'partial' ? 0.4 : 1.0;
      return {
        id: m.id,
        label: m.label,
        status: m.defaultStatus,
        remediation: m.remediation,
        scoreImpact: denom > 0 ? Math.round((l1 * lift) / denom) : 0,
      };
    })
    .sort((a, b) => b.scoreImpact - a.scoreImpact);
  return { l1Score: l1, selectedCount: denom, computable, readinessPct, misScore, potentialScore: l1, gaps };
}

function blankContext(state: AppState, manual: ManualInputs, budget?: BudgetData): MetricContext {
  const blankPeriod = {
    id: 'pending', label: 'Pending',
    parsedData: {}, chunkedStats: null, l1Score: null,
  };
  return { current: blankPeriod, history: [blankPeriod], manual, budget, sector: state.misSetup.sector ?? null };
}

// ── Module export ───────────────────────────────────────────────────────

/**
 * Layer2Module descriptor for MIS.  Future GST / IT / SA modules ship the
 * same shape and the registry composes them.
 */
export const MIS_MODULE: Layer2Module = {
  id: 'mis',
  label: 'MIS Readiness',
  domains: MIS_DOMAINS.map(d => ({ ...d, metrics: d.metrics })),
  sectorAddOns: undefined, // populated lazily from MIS_SECTOR_ADDONS at consumer site
};

export { findMetric };
