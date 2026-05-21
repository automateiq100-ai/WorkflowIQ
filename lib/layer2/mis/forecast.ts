/**
 * Deterministic forecast engine.
 *
 * Generates a base / upside / downside scenario for the next 3 monthly
 * periods (and next 2 quarterly periods, totalling ~6 months) based purely
 * on historical Period data — no AI, no external calls.
 *
 * Methodology:
 *   1. Revenue growth — 3-month average MoM growth from history (clamped
 *      to ±25% to avoid blow-up when the dataset is volatile).
 *   2. Gross margin % — average of last 3 periods.
 *   3. Fixed operating cost base — average of last 3 periods (rent +
 *      salary + admin + interest + depreciation).
 *   4. Capex — average ICF over last 3 periods.
 *   5. Cash carries over period-to-period.
 *
 * The user can override every assumption — `forecastMIS` accepts an
 * `assumptions` object that takes precedence over auto-derived defaults.
 */

import type { Period, MetricContext } from '../types';

// ── Assumptions ──────────────────────────────────────────────────────────

export interface ForecastAssumptions {
  /** MoM revenue growth rate (e.g. 0.06 = +6%).  Default: 3-month avg actual. */
  revenueGrowthMoM?: number;
  /** Gross margin % (e.g. 0.289).  Default: 3-month avg. */
  grossMarginPct?: number;
  /** Fixed operating cost per month (₹).  Default: 3-month avg. */
  fixedOpsCostMonth?: number;
  /** Interest expense per month (₹).  Default: 3-month avg. */
  interestMonth?: number;
  /** Capex per month (₹).  Default: 3-month avg ICF magnitude. */
  capexMonth?: number;
  /** Target DSO days for collection lag.  Default: latest actual DSO. */
  targetDSO?: number;
}

export type ScenarioId = 'base' | 'upside' | 'downside';

export interface ForecastRow {
  periodLabel: string;
  isActual: boolean;
  revenue: number;
  grossProfitPct: number;
  ebitda: number;
  pat: number;
  cashPosition: number;
  dso: number;
}

export interface ScenarioForecast {
  id: ScenarioId;
  label: string;
  rows: ForecastRow[];
  assumptions: ForecastAssumptions;
}

export interface MISForecast {
  /** Base case derived purely from history. */
  base: ScenarioForecast;
  /** +15% revenue growth scenario. */
  upside: ScenarioForecast;
  /** −10% revenue decline scenario. */
  downside: ScenarioForecast;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function abs(n: number | null | undefined): number {
  return n != null && isFinite(n) ? Math.abs(n) : 0;
}

function revenueOf(p: Period): number {
  return abs(p.parsedData.revenue);
}

function netProfitOf(p: Period): number {
  return (p.parsedData.bsNetProfit ?? p.parsedData.netProfit ?? 0);
}

function fixedOpsOf(p: Period): number {
  const tb = p.parsedData.tbLedgers ?? [];
  let total = 0;
  for (const l of tb) {
    if (/salary|wages|rent|utility|admin|electricity/i.test(l.name)) total += abs(l.closing);
  }
  return total;
}

function interestOf(p: Period): number {
  const tb = p.parsedData.tbLedgers ?? [];
  let i = 0;
  for (const l of tb) if (/interest|finance/i.test(l.name)) i += abs(l.closing);
  return i;
}

function depOf(p: Period): number {
  return abs(p.parsedData.depAmt);
}

function dsoOf(p: Period): number {
  const debtors = abs(p.parsedData.debtorBal);
  const rev = revenueOf(p);
  if (!debtors || !rev) return 0;
  return (debtors / rev) * 30;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function nextMonthLabel(base: string, offset: number): string {
  // base is a free-form label like "Apr 2025" or period id "2025-04"
  const m = /^(\d{4})-(\d{2})$/.exec(base);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let year = 0, month = 0;
  if (m) {
    year = +m[1];
    month = +m[2] - 1;
  } else {
    const m2 = /([A-Za-z]+)\s+(\d{4})/.exec(base);
    if (!m2) return `+${offset}m`;
    year = +m2[2];
    month = monthNames.findIndex(x => x.toLowerCase() === m2[1].slice(0, 3).toLowerCase());
    if (month < 0) return `+${offset}m`;
  }
  const t = new Date(Date.UTC(year, month + offset, 1));
  return `${monthNames[t.getUTCMonth()]} ${t.getUTCFullYear()} (F)`;
}

// ── Public entry ────────────────────────────────────────────────────────

export function forecastMIS(
  ctx: MetricContext,
  overrides: Partial<ForecastAssumptions> = {},
): MISForecast {
  const history = ctx.history;
  if (history.length === 0) {
    return emptyForecast();
  }
  const last3 = history.slice(-3);

  // ── 1. Derive base assumptions from history ───────────────────────
  const momGrowths: number[] = [];
  for (let i = 1; i < last3.length; i++) {
    const a = revenueOf(last3[i]);
    const b = revenueOf(last3[i - 1]);
    if (b > 0) momGrowths.push((a - b) / b);
  }
  const histMoM = momGrowths.length > 0 ? clamp(avg(momGrowths), -0.25, 0.25) : 0.06;
  const baseAssumptions: ForecastAssumptions = {
    revenueGrowthMoM: overrides.revenueGrowthMoM ?? histMoM,
    grossMarginPct: overrides.grossMarginPct ?? clamp(avg(last3.map(p => {
      const r = revenueOf(p);
      if (!r) return 0.28;
      const gp = r - abs(p.parsedData.costOfMaterials) - abs(p.parsedData.openingStock) + abs(p.parsedData.plClosingStock ?? p.parsedData.closingStock);
      return gp / r;
    })), 0.05, 0.6),
    fixedOpsCostMonth: overrides.fixedOpsCostMonth ?? avg(last3.map(fixedOpsOf)),
    interestMonth: overrides.interestMonth ?? avg(last3.map(interestOf)),
    capexMonth: overrides.capexMonth ?? avg(last3.map(p => abs(p.parsedData.investingCF))),
    targetDSO: overrides.targetDSO ?? dsoOf(history[history.length - 1]),
  };

  const base = buildScenario('base', 'Base case', ctx, baseAssumptions);

  // Upside: +5pp revenue growth, +50bps margin
  const upside = buildScenario('upside', 'Upside (+15%)', ctx, {
    ...baseAssumptions,
    revenueGrowthMoM: (baseAssumptions.revenueGrowthMoM ?? 0) + 0.05,
    grossMarginPct: (baseAssumptions.grossMarginPct ?? 0.28) + 0.005,
  });

  // Downside: −10% growth, −100bps margin
  const downside = buildScenario('downside', 'Downside (−10%)', ctx, {
    ...baseAssumptions,
    revenueGrowthMoM: (baseAssumptions.revenueGrowthMoM ?? 0) - 0.10,
    grossMarginPct: (baseAssumptions.grossMarginPct ?? 0.28) - 0.01,
  });

  return { base, upside, downside };
}

function buildScenario(
  id: ScenarioId, label: string,
  ctx: MetricContext, a: ForecastAssumptions,
): ScenarioForecast {
  const current = ctx.current;
  const rows: ForecastRow[] = [];

  // Actual current row.
  const actualRevenue = revenueOf(current);
  const actualNP = netProfitOf(current);
  const actualGPpct = actualRevenue ? (actualRevenue - abs(current.parsedData.costOfMaterials)) / actualRevenue : 0;
  const actualEBITDA = actualNP + interestOf(current) + depOf(current);
  rows.push({
    periodLabel: current.label || 'Current',
    isActual: true,
    revenue: actualRevenue,
    grossProfitPct: actualGPpct,
    ebitda: actualEBITDA,
    pat: actualNP,
    cashPosition: abs(current.parsedData.bsCashBankTotal),
    dso: dsoOf(current),
  });

  // 3 forecast months
  let rev = actualRevenue;
  let cash = abs(current.parsedData.bsCashBankTotal);
  const baseLabel = current.id;
  for (let i = 1; i <= 3; i++) {
    rev = rev * (1 + (a.revenueGrowthMoM ?? 0));
    const gp = rev * (a.grossMarginPct ?? 0.28);
    const ops = a.fixedOpsCostMonth ?? 0;
    const interest = a.interestMonth ?? 0;
    const dep = depOf(current);
    const ebitda = gp - ops;
    const pat = ebitda - interest - dep;
    cash = cash + pat + dep - (a.capexMonth ?? 0);
    const dsoBase = a.targetDSO ?? dsoOf(current);
    const dsoStep = (id === 'base' ? -1 : id === 'upside' ? -2 : 0) * i;
    rows.push({
      periodLabel: nextMonthLabel(baseLabel, i),
      isActual: false,
      revenue: rev,
      grossProfitPct: a.grossMarginPct ?? 0.28,
      ebitda,
      pat,
      cashPosition: cash,
      dso: Math.max(15, dsoBase + dsoStep),
    });
  }
  return { id, label, rows, assumptions: a };
}

function emptyForecast(): MISForecast {
  const blank = (id: ScenarioId, label: string): ScenarioForecast => ({
    id, label, rows: [], assumptions: {},
  });
  return {
    base: blank('base', 'Base case'),
    upside: blank('upside', 'Upside (+15%)'),
    downside: blank('downside', 'Downside (−10%)'),
  };
}
