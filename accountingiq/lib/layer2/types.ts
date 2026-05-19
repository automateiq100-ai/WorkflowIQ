/**
 * Layer 2 — shared contracts.
 *
 * Every Layer 2 module (MIS, GST, Income Tax, Statutory Audit, ...) implements
 * the same shape:
 *   - a catalogue of MetricDefs grouped into DomainDefs
 *   - optional sector-specific add-on metrics
 *   - a deterministic compute() per metric that takes a MetricContext
 *     (current period + prior period + history + manual inputs + budget)
 *     and returns a MetricResult.
 *
 * No AI is invoked at this layer.  Module-level UI / report generators
 * consume MetricResult[] to render dashboards and downloadable reports.
 */

import type { ParsedData, ChunkedStats } from '../types';
import type { Bill } from '../bills-parser';

// ── Status & result shapes ────────────────────────────────────────────────

/** Declared status of a metric in the spec.  Drives the readiness score. */
export type MetricStatus = 'auto' | 'partial' | 'manual' | 'new-xml';

/** Status produced after the compute() actually runs against a real period.
 *  Distinct from MetricStatus because a declared-auto metric can still come
 *  back missing-data (e.g. P&L XML wasn't uploaded). */
export type MetricResultStatus =
  | 'computed'         // value populated, fully reliable
  | 'partial'          // value populated with caveats (e.g. only 1 period available)
  | 'missing-data'     // source XML or field absent
  | 'manual-required'  // declared-manual metric with no user input
  | 'na';              // not applicable for this company (e.g. sector mismatch)

/** Unit of measurement — controls how the UI / Excel renderers format. */
export type MetricUnit = 'INR' | 'pct' | 'days' | 'ratio' | 'count' | 'text';

/** Reading direction for "better is …" — used for trend arrows and severity. */
export type MetricDirection = 'higher-better' | 'lower-better' | 'neutral';

// ── Period model ──────────────────────────────────────────────────────────

/**
 * One reporting period.  The current single-period state maps to a length-1
 * Period[] where the only entry is the active dataset.  Future multi-period
 * uploads add more entries.
 */
export interface Period {
  /** Stable id (e.g. "2025-04" or "current") for cross-period joins. */
  id: string;
  /** Human label shown in UI (e.g. "Apr 2025"). */
  label: string;
  /** All ParsedData fields the engine produced for this period. */
  parsedData: Partial<ParsedData>;
  /** DayBook chunked stats — null when DayBook wasn't uploaded. */
  chunkedStats: ChunkedStats | null;
  /** Layer 1 score for this period (0–100); null when not analysed. */
  l1Score: number | null;
  /** Period start/end (YYYY-MM-DD) — derived from DayBook DATE range. */
  startDate?: string;
  endDate?: string;
}

// ── Manual & budget inputs (Step 2 setup screen) ─────────────────────────

export interface ManualInputs {
  /** Total employees on payroll — drives employee-cost-per-head metric. */
  headcount?: number;
  /** Confirmed pipeline / order book value (₹). */
  orderBook?: number;
  /** Sanctioned drawing power / credit limit on term loans (₹). */
  drawingPowerLimit?: number;
  /** Loan covenants from sanction letter. */
  covenants?: {
    dscrMin?: number;
    deRatioMax?: number;
    currentRatioMin?: number;
  };
  /** Disclosed contingent liabilities (₹). */
  contingentLiabilities?: number;
  /** Voucher ids the user flagged as non-recurring / one-time. */
  nonRecurringVoucherIds?: string[];
  /** Production quantity (manufacturing) — drives cost-per-unit. */
  productionQty?: number;
}

/**
 * Budget upload — line-by-line monthly targets.  Optional; only populated
 * when the user has uploaded a budget Excel in setup.
 */
export interface BudgetData {
  revenue?: number;
  cogs?: number;
  employeeCost?: number;
  rent?: number;
  marketing?: number;
  admin?: number;
  depreciation?: number;
  interest?: number;
  pat?: number;
  /** Any additional cost lines keyed by name — for budget vs actual on
   *  arbitrary P&L heads. */
  customLines?: Record<string, number>;
}

// ── Context passed to compute() ──────────────────────────────────────────

export interface MetricContext {
  /** Period currently being reported on (most recent uploaded). */
  current: Period;
  /** Period immediately before `current` (if any) — for MoM deltas. */
  prior?: Period;
  /** All periods sorted chronologically; current is last. */
  history: Period[];
  /** Manual inputs collected in the Setup screen. */
  manual: ManualInputs;
  /** Budget data if uploaded — undefined when not provided. */
  budget?: BudgetData;
  /** Sector selected in Setup — drives sector-specific compute branches. */
  sector?: string | null;
  /**
   * Voucher-derived monthly slices of the SINGLE current upload.  Populated
   * when DayBook vouchers span 2+ calendar months but only one aggregate
   * Period was uploaded.  Each entry has flow values (revenue, expenses,
   * COGS) re-derived per month from voucher legs, plus chunkedStats filtered
   * to that month.  Balance-sheet fields are intentionally left undefined —
   * Tally exports give a point-in-time BS, so per-month BS isn't derivable.
   *
   * Use this opt-in field for MoM / trend / "N of 12 months" metrics that
   * would otherwise bail out as `partial` with "only 1 period uploaded".
   * Do NOT route balance-sheet-delta metrics through it.
   */
  monthlyPeriods?: Period[];
  /**
   * Parsed open bills from Bills.xml / Payables.xml (when uploaded).  Drives
   * WC3 (Top 10 debtors), WC4 (overdue debtors aging), payable aging, etc.
   * `type: 'receivable'` for Bills.xml entries, `'payable'` for Payables.xml.
   * Empty array means neither file was uploaded.
   */
  bills?: Bill[];
}

// ── Metric result ────────────────────────────────────────────────────────

/**
 * Optional named breakdown items — used by metrics whose primary output is
 * a list (e.g. top-10 debtors, aging buckets, sales by segment).
 */
export interface MetricBreakdownItem {
  label: string;
  value: number;
  /** Optional secondary number — e.g. days outstanding next to amount. */
  secondary?: number;
  /** Optional badge for status (e.g. "Critical", "MSME"). */
  badge?: string;
  /** Optional unit override for this row. */
  unit?: MetricUnit;
}

export interface MetricTrendPoint {
  periodId: string;
  periodLabel: string;
  value: number;
}

export interface MetricValue {
  /** Primary numeric value — the headline number for this metric. */
  numeric?: number;
  /** Formatted text (used when the metric is qualitative or the
   *  caller wants to pre-format, e.g. "1.84×" or "47 days"). */
  text?: string;
  /** Optional breakdown rows (top-10 lists, aging buckets, etc.). */
  breakdown?: MetricBreakdownItem[];
  /** Optional MoM / multi-period trend points. */
  trend?: MetricTrendPoint[];
  /** Unit (overrides MetricDef.unit when present). */
  unit?: MetricUnit;
  /** MoM change vs prior (signed; in same unit unless `momIsPct` set). */
  mom?: number;
  /** When true, `mom` is interpreted as a percentage. */
  momIsPct?: boolean;
}

export interface MetricResult {
  id: string;
  status: MetricResultStatus;
  value: MetricValue | null;
  /** Why partial / missing — surfaces in the gap list and in the UI. */
  reason?: string;
  /** Human-readable formula for the Backup Working panel. */
  formula?: string;
  /** XML source label for the Backup Working panel. */
  source?: string;
  /** Ledger names included in the computation (for traceability). */
  ledgers?: string[];
}

// ── Metric & domain definitions ──────────────────────────────────────────

/**
 * Structured declaration of the inputs a metric depends on.  Drives the
 * MIS Data Intake view (what to upload), the "X missing inputs blocks N
 * metrics" gap list, and the per-metric data-availability indicator.
 *
 * Distinct from MetricStatus (which is the spec's declared classification):
 * inputs[] is the *factual* dependency graph between metric and data
 * source, used at runtime to decide whether compute() can succeed.
 */
export type MetricInputType =
  | 'tally'        // a Tally XML file (id = FileKey, e.g. 'pandl', 'bills')
  | 'excel'        // an uploaded spreadsheet (id = template id, e.g. 'budget')
  | 'pdf'          // an uploaded PDF (id = doc id, e.g. 'loan-sanction')
  | 'manual'       // a field on ManualInputs (id = field name)
  | 'period';      // requires N additional periods (id = min count as string)

export interface MetricInput {
  type: MetricInputType;
  /** Stable id of the source — interpreted per type (see MetricInputType). */
  id: string;
  /** When false, metric still produces a partial result without this input.
   *  When true, missing this input means the metric cannot compute at all. */
  required: boolean;
  /** Optional human note explaining the role this input plays. */
  note?: string;
}

export interface MetricDef {
  id: string;
  /** Domain id this metric belongs to (D1–D7 for MIS). */
  domainId: string;
  /** Human label as it appears in the catalogue / setup screen. */
  label: string;
  /** Declared status per the spec — drives readiness score weighting. */
  defaultStatus: MetricStatus;
  /** XML source(s) — surfaces in Setup and in Backup Working. */
  source: string;
  /** Structured input dependencies — drives the Data Intake UI.  When
   *  empty/undefined the metric is treated as compute-from-base-XMLs only
   *  (the implicit defaults: daybook/trialbal/pandl/bsheet are assumed
   *  available once Layer 1 analysis has run). */
  inputs?: MetricInput[];
  /** Caveat text from the spec (shown under the metric label). */
  caveat?: string;
  /** One-line remediation step. */
  remediation: string;
  /** Unit for primary numeric output. */
  unit?: MetricUnit;
  /** Reading direction for trend arrows / severity classification. */
  direction?: MetricDirection;
  /** Human-readable formula for Backup Working — copied into MetricResult
   *  when compute doesn't override.  Spec calls this the "formula" column. */
  formula?: string;
  /**
   * Deterministic compute function.  Pure: same context → same result.
   * Must not throw — return { status: 'missing-data', reason: … } instead.
   */
  compute(ctx: MetricContext): MetricResult;
}

export interface DomainDef {
  id: string;
  label: string;
  metrics: MetricDef[];
}

export interface SectorAddOn {
  /** Sector this add-on belongs to (matches MISSector strings). */
  sector: string;
  metrics: MetricDef[];
}

// ── Layer 2 module ───────────────────────────────────────────────────────

export interface Layer2Module {
  /** Stable module id — slug used in URLs and registry lookup. */
  id: 'mis' | 'gst' | 'income-tax' | 'statutory-audit';
  /** Module label shown in the sidebar / module switcher. */
  label: string;
  /** Domain catalogue. */
  domains: DomainDef[];
  /** Sector-specific add-on metrics, keyed by sector name. */
  sectorAddOns?: SectorAddOn[];
}

// ── Readiness score ──────────────────────────────────────────────────────

/** Weight applied to each declared status when computing readiness. */
export const STATUS_WEIGHT: Record<MetricStatus, number> = {
  auto: 1.0,
  partial: 0.6,
  manual: 0,
  'new-xml': 0,
};

export interface ReadinessScore {
  l1Score: number;
  selectedCount: number;
  computable: number;        // sum of STATUS_WEIGHT over selected metrics
  readinessPct: number;      // computable / selectedCount  (0–1)
  misScore: number;          // round(l1 * readinessPct)
  potentialScore: number;    // = l1 (all metrics provided)
  gaps: Array<{
    id: string;
    label: string;
    status: MetricStatus;
    remediation: string;
    scoreImpact: number;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Convenience: build a `MetricResult` for a missing-data case. */
export function missingDataResult(id: string, reason: string): MetricResult {
  return { id, status: 'missing-data', value: null, reason };
}

/** Convenience: build a `MetricResult` for a successful computation. */
export function computedResult(
  id: string,
  value: MetricValue,
  opts: { formula?: string; source?: string; ledgers?: string[]; partial?: boolean; reason?: string } = {},
): MetricResult {
  return {
    id,
    status: opts.partial ? 'partial' : 'computed',
    value,
    formula: opts.formula,
    source: opts.source,
    ledgers: opts.ledgers,
    reason: opts.reason,
  };
}

/** Convenience: build a `MetricResult` for a metric that requires manual input. */
export function manualRequiredResult(id: string, reason: string): MetricResult {
  return { id, status: 'manual-required', value: null, reason };
}

/** Safe division — returns null when divisor is 0 / non-finite. */
export function safeDiv(num: number, denom: number): number | null {
  if (!isFinite(num) || !isFinite(denom) || Math.abs(denom) < 1e-9) return null;
  return num / denom;
}

/** Pull a parsedData field that may be undefined; treat missing as null. */
export function field<K extends keyof ParsedData>(
  ctx: MetricContext,
  key: K,
): ParsedData[K] | null {
  const v = ctx.current.parsedData[key];
  return (v === undefined ? null : v) as ParsedData[K] | null;
}
