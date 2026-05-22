/**
 * Period helpers.
 *
 * Bridges the current single-period AppState into the Layer 2 multi-period
 * Period[] model.  Today the array is length-1 (the active company's only
 * analysed dataset); when multi-period uploads land, additional periods get
 * appended in chronological order.
 *
 * Pure functions only — no React state access here.
 */

import type { AppState, Voucher, ChunkedStats, ParsedData } from '../types';
import type { Period } from './types';

/**
 * Derive a label like "Apr 2025" from a YYYYMMDD date range.
 *  - Single-month range → "Apr 2025"
 *  - Multi-month → "Apr–Jul 2025" or "FY 2025-26" if it spans a financial year
 *  - Empty → "Current"
 */
export function deriveLabel(startISO?: string, endISO?: string): string {
  if (!startISO || !endISO) return 'Current';
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  if (!start || !end) return 'Current';
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `${monthNames[start.getMonth()]}–${monthNames[end.getMonth()]} ${start.getFullYear()}`;
  }
  // Cross-year — likely a full FY
  const startFY = startsFinancialYear(start) && endsFinancialYear(end);
  if (startFY) {
    return `FY ${start.getFullYear()}-${(end.getFullYear() % 100).toString().padStart(2, '0')}`;
  }
  return `${monthNames[start.getMonth()]} ${start.getFullYear()}–${monthNames[end.getMonth()]} ${end.getFullYear()}`;
}

/** Derive a stable id like "2025-04" from a start date. */
export function deriveId(startISO?: string, endISO?: string): string {
  if (!startISO) return 'current';
  const d = parseISODate(startISO);
  if (!d) return 'current';
  const sameMonth =
    endISO && parseISODate(endISO)?.getMonth() === d.getMonth() &&
    parseISODate(endISO)?.getFullYear() === d.getFullYear();
  if (sameMonth) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-range`;
}

/**
 * Build a Period from the current single-period AppState.  Uses the
 * DayBook dateSet (sorted YYYYMMDD list) to infer start/end dates and a
 * sensible label.  Returns null when there's no analysis result.
 */
export function periodFromState(state: AppState): Period | null {
  if (!state.results) return null;

  const cs = state.files.daybook.chunkedStats ?? null;
  const dates = (cs?.dateSet ?? []).filter(Boolean).sort();
  const startISO = dates.length > 0 ? dateSetEntryToISO(dates[0]) : undefined;
  const endISO = dates.length > 0 ? dateSetEntryToISO(dates[dates.length - 1]) : undefined;

  return {
    id: deriveId(startISO, endISO),
    label: deriveLabel(startISO, endISO),
    parsedData: state.parsedData,
    chunkedStats: cs,
    l1Score: state.results.cappedScore ?? state.results.overall ?? null,
    startDate: startISO,
    endDate: endISO,
  };
}

/**
 * Periods[] for the current session.  Today this is just length-1 derived
 * from the active state.  Reserved for the multi-period upload grid:
 * when state.periods[] (future field) is populated, return that instead.
 */
export function periodsFromState(state: AppState): Period[] {
  // Future hook: if `state.periods` is added, prefer that array here.
  // For now, single-period passthrough — keeps every downstream consumer
  // (MetricContext, runner, forecast, Excel) working out of the box.
  const current = periodFromState(state);
  return current ? [current] : [];
}

/**
 * Convenience: given a period array sorted chronologically, return
 * { current, prior, history } as expected by MetricContext.
 */
export function splitHistory(periods: Period[]): {
  current: Period | null;
  prior?: Period;
  history: Period[];
} {
  if (periods.length === 0) return { current: null, history: [] };
  const current = periods[periods.length - 1];
  const prior = periods.length >= 2 ? periods[periods.length - 2] : undefined;
  return { current, prior, history: periods };
}

// ── Monthly slices derived from voucher data ─────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Match a sales-side voucher type (Sales, Sales Invoice, etc.) — excludes returns. */
function isSaleType(t: string): boolean {
  const lc = t.toLowerCase();
  return /sale/.test(lc) && !/return|credit note|credit-note/.test(lc);
}
/** Match a sales-return / credit-note voucher type. */
function isSaleReturnType(t: string): boolean {
  return /credit note|credit-note|sales? return/.test(t.toLowerCase());
}
/** Match a purchase-side voucher type (Purchase, Purchase Invoice). */
function isPurchaseType(t: string): boolean {
  const lc = t.toLowerCase();
  return /(purchase|^pur\b)/.test(lc) && !/return|debit note|debit-note/.test(lc);
}
/** Match a purchase-return / debit-note voucher type. */
function isPurchaseReturnType(t: string): boolean {
  return /debit note|debit-note|purchase? return/.test(t.toLowerCase());
}

/** Cr-side leg posted to a revenue / sales / income ledger. */
function isRevenueLeg(legName: string, dr: boolean): boolean {
  return !dr && /sale|revenue|income/i.test(legName) && !/return/i.test(legName);
}
/** Dr-side leg posted to a purchase / cost-of / consumption ledger. */
function isPurchaseLeg(legName: string, dr: boolean): boolean {
  return dr && /purchase|cost of|consumption/i.test(legName);
}
/** Dr-side leg posted to an expense ledger (rough heuristic). */
function isExpenseLeg(legName: string, dr: boolean): boolean {
  return dr && /(expense|salary|wages|payroll|rent|utility|electric|repair|fuel|petrol|diesel|stationer|insurance|telephone|interest|depreciation|professional|legal|audit|tax|duty)/i.test(legName);
}

/** Sum revenue across a month's vouchers (Cr legs to revenue ledgers, less sales returns). */
function monthlyRevenue(vouchers: Voucher[]): number {
  let total = 0;
  for (const v of vouchers) {
    const sale = isSaleType(v.type), ret = isSaleReturnType(v.type);
    if (!sale && !ret) continue;
    const sign = ret ? -1 : 1;
    if (v.legs && v.legs.length) {
      for (const leg of v.legs) {
        if (isRevenueLeg(leg.name, leg.dr)) total += sign * leg.amt;
      }
    } else {
      total += sign * Math.abs(v.amount);
    }
  }
  return Math.max(0, total);
}

/** Sum purchases across a month's vouchers (Dr legs to purchase/COGS ledgers, less purchase returns). */
function monthlyPurchases(vouchers: Voucher[]): number {
  let total = 0;
  for (const v of vouchers) {
    const pur = isPurchaseType(v.type), ret = isPurchaseReturnType(v.type);
    if (!pur && !ret) continue;
    const sign = ret ? -1 : 1;
    if (v.legs && v.legs.length) {
      for (const leg of v.legs) {
        if (isPurchaseLeg(leg.name, leg.dr)) total += sign * leg.amt;
      }
    } else {
      total += sign * Math.abs(v.amount);
    }
  }
  return Math.max(0, total);
}

/** Sum non-COGS expenses across a month's vouchers (Dr legs to expense ledgers). */
function monthlyExpenses(vouchers: Voucher[]): number {
  let total = 0;
  for (const v of vouchers) {
    const t = v.type.toLowerCase();
    // Skip pure cash/bank transfers (contras) and trade vouchers — expenses
    // typically post via Journal or Payment.
    if (/contra|sale|purchase|^pur\b/.test(t)) continue;
    if (!v.legs || v.legs.length === 0) continue;
    for (const leg of v.legs) {
      if (isExpenseLeg(leg.name, leg.dr)) total += leg.amt;
    }
  }
  return Math.max(0, total);
}

/** Sum sales-voucher gross amounts (matches ChunkedStats.salesVoucherTotal). */
function monthlySalesVoucherTotal(vouchers: Voucher[]): number {
  let total = 0;
  for (const v of vouchers) {
    if (isSaleType(v.type)) total += Math.abs(v.amount);
  }
  return total;
}

function monthlyPurchaseVoucherTotal(vouchers: Voucher[]): number {
  let total = 0;
  for (const v of vouchers) {
    if (isPurchaseType(v.type)) total += Math.abs(v.amount);
  }
  return total;
}

/**
 * A minimal ChunkedStats clone scoped to one month's vouchers.  Only the
 * fields read by trend/MoM-aware metrics are populated; everything else
 * inherits sensible zero/empty defaults so downstream code never NPEs on a
 * monthly slice that lacks aggregate-only counters.
 */
function buildMonthlyChunkedStats(
  yymm: string,
  vouchers: Voucher[],
  aggregate: ChunkedStats,
): ChunkedStats {
  const dateSet = new Set<string>();
  const custMap: Record<string, number> = {};
  const vendMap: Record<string, number> = {};
  for (const v of vouchers) {
    if (v.date) dateSet.add(v.date);
    // Sale-side vouchers contribute revenue to the customer (party); purchase-
    // side to the vendor.  Mirrors how the chunked parser builds the aggregate
    // custMap / vendMap, just scoped to this month.
    if (!v.party) continue;
    if (isSaleType(v.type)) {
      custMap[v.party] = (custMap[v.party] ?? 0) + Math.abs(v.amount);
    } else if (isPurchaseType(v.type)) {
      vendMap[v.party] = (vendMap[v.party] ?? 0) + Math.abs(v.amount);
    }
  }
  return {
    ...aggregate,
    totalVouchers: vouchers.length,
    vouchers,
    dateSet: [...dateSet],
    monthCounts: { [yymm]: vouchers.length },
    salesVoucherTotal: monthlySalesVoucherTotal(vouchers),
    purchVoucherTotal: monthlyPurchaseVoucherTotal(vouchers),
    custMap,
    vendMap,
  };
}

/**
 * Slice a single multi-month upload into voucher-derived monthly Periods.
 * Returns an empty array when DayBook is missing or contains vouchers in
 * fewer than 2 distinct calendar months.
 *
 * Each returned Period has:
 *  - parsedData with flow fields (revenue, expenses, costOfMaterials,
 *    netProfit) computed from THIS month's voucher legs only
 *  - BS / point-in-time fields LEFT UNDEFINED (so BS-delta metrics correctly
 *    identify per-month BS as unavailable instead of using an aggregate
 *    proxy)
 *  - chunkedStats scoped to this month's vouchers
 */
export function buildMonthlyPeriods(state: AppState, aggregate: Period): Period[] {
  const cs = aggregate.chunkedStats;
  if (!cs || !cs.vouchers || cs.vouchers.length === 0) return [];

  const byMonth = new Map<string, Voucher[]>();
  for (const v of cs.vouchers) {
    if (!v.date || !/^\d{8}$/.test(v.date)) continue;
    const yymm = v.date.slice(0, 6);
    let arr = byMonth.get(yymm);
    if (!arr) { arr = []; byMonth.set(yymm, arr); }
    arr.push(v);
  }
  if (byMonth.size < 2) return [];

  // Drop months whose only entries are isolated opening-balance or stray
  // adjustment vouchers — they create misleading flat lines on the trend.
  // A "real" month has at least some flow activity (sale, purchase, payment,
  // receipt, or 3+ vouchers of any type).
  const isFlowVoucher = (v: Voucher) => {
    const t = v.type.toLowerCase();
    return /sale|purchase|payment|receipt/.test(t) && Math.abs(v.amount) > 0;
  };
  const months = [...byMonth.entries()]
    .filter(([, vs]) => vs.some(isFlowVoucher) || vs.length >= 3)
    .map(([k]) => k)
    .sort();
  if (months.length < 2) return [];

  return months.map(yymm => {
    const monthVouchers = byMonth.get(yymm)!;
    const y = +yymm.slice(0, 4);
    const m = +yymm.slice(4, 6);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const startISO = `${yymm.slice(0, 4)}-${yymm.slice(4, 6)}-01`;
    const endISO = `${yymm.slice(0, 4)}-${yymm.slice(4, 6)}-${String(lastDay).padStart(2, '0')}`;

    const revenue = monthlyRevenue(monthVouchers);
    const costOfMaterials = monthlyPurchases(monthVouchers);
    const expenses = monthlyExpenses(monthVouchers);
    // Approximate net profit per month — no per-month BS so we can't read
    // bsNetProfit; this is the P&L-derived equivalent.
    const netProfit = revenue - costOfMaterials - expenses;

    // Build a Partial<ParsedData> with ONLY the flow fields populated.  BS
    // fields, TB ledgers, plSections etc. are intentionally omitted — the
    // monthly slice does not have access to per-month BS / TB closings.
    const monthlyParsed: Partial<ParsedData> = {
      revenue,
      costOfMaterials,
      expenses,
      netProfit,
      // depAmt / depFound carry through as 0 — depreciation is annualised in
      // Tally and can't be split monthly without explicit per-month accruals.
      depAmt: 0,
      depFound: false,
      // Stock movements aren't derivable per month — let cogsOf fall back to
      // purchases.
      openingStock: 0,
      closingStock: 0,
      plClosingStock: 0,
    };

    return {
      id: `${yymm.slice(0, 4)}-${yymm.slice(4, 6)}`,
      label: `${MONTH_NAMES[m - 1] ?? '?'} ${y}`,
      parsedData: monthlyParsed,
      chunkedStats: buildMonthlyChunkedStats(yymm, monthVouchers, cs),
      l1Score: aggregate.l1Score,
      startDate: startISO,
      endDate: endISO,
    };
  });
}

// ── Date parsing helpers ─────────────────────────────────────────────────

/**
 * DayBook dateSet entries are stored as YYYYMMDD strings (the parser's
 * canonical Tally form).  Convert to ISO YYYY-MM-DD; null when malformed.
 */
function dateSetEntryToISO(s: string): string | undefined {
  if (!s) return undefined;
  // Allow either "20250401" or "2025-04-01" inputs to be forgiving.
  const compact = s.replace(/-/g, '');
  if (!/^\d{8}$/.test(compact)) return undefined;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function parseISODate(s: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Indian financial year starts 1 April. */
function startsFinancialYear(d: Date): boolean {
  return d.getUTCMonth() === 3 && d.getUTCDate() === 1;
}

/** Indian financial year ends 31 March. */
function endsFinancialYear(d: Date): boolean {
  return d.getUTCMonth() === 2 && d.getUTCDate() === 31;
}
