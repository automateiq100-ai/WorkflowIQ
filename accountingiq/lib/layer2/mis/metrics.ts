/**
 * MIS metric catalogue — 73 core metrics across 7 domains.
 *
 * Each MetricDef has a deterministic compute() that takes a MetricContext
 * (current + prior + history + manual + budget) and returns a MetricResult.
 * No AI is invoked here.  Compute functions never throw — when source data
 * is missing they return { status: 'missing-data', reason: … }.
 *
 * Sign convention: parsedData fields mirror Tally — positive = Credit,
 * negative = Debit.  Revenue is stored as a positive number (engine.ts
 * normalises it), expenses likewise.  Where we need to compare ratios we
 * use the absolute values consistently.
 */

import type {
  MetricContext, MetricDef, MetricResult, MetricBreakdownItem, Period,
} from '../types';
import {
  computedResult, missingDataResult, manualRequiredResult, safeDiv,
} from '../types';
import { billDaysOverdue, agingBucketOf, type AgingBucket, type Bill } from '../../bills-parser';
import { classifyVoucherType } from '../../tally-voucher-types';
import { classifyLedger, buildBSHierarchyMap, type LedgerCategory } from '../../tally-groups';
import type { MasterEntry } from '../../types';

// ── Shared helpers ────────────────────────────────────────────────────────

/** Absolute value, but null-safe — returns 0 if input is null/undefined. */
function abs(n: number | null | undefined): number {
  return n != null && isFinite(n) ? Math.abs(n) : 0;
}

/** Coerce a field to number; returns null when missing / non-finite. */
function num(v: unknown): number | null {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return v;
}

/** Revenue for a period (absolute, GST excluded — engine.ts already normalises). */
function revenueOf(p: Period): number | null {
  const r = num(p.parsedData.revenue);
  return r == null ? null : Math.abs(r);
}

/** Total expenses (absolute). */
function expensesOf(p: Period): number | null {
  const e = num(p.parsedData.expenses);
  return e == null ? null : Math.abs(e);
}

/** Net profit — prefers BS-derived value, falls back to P&L. */
function netProfitOf(p: Period): number | null {
  const bs = num(p.parsedData.bsNetProfit);
  if (bs != null) return bs;
  return num(p.parsedData.netProfit);
}

/** Depreciation amount; 0 when ledger not found. */
function depreciationOf(p: Period): number {
  return abs(p.parsedData.depAmt);
}

/** Interest expense — TB ledgers under Indirect / Direct Expenses whose
 *  name matches /interest|finance|bank charges/, excluding "received" /
 *  "income" lookalikes.  Master classification keeps "Interest Received"
 *  (an income ledger) and "Interest Payable" (a liability) out, so we
 *  don't double-count or flip signs. */
function interestExpenseOf(p: Period): number {
  const tb = p.parsedData.tbLedgers ?? [];
  let total = 0;
  for (const l of tb) {
    const cat = categoryOf(p, l.name);
    if (cat !== 'indirect-expense' && cat !== 'direct-expense') continue;
    if (!/interest|finance\s*(cost|charge)|bank\s*charges/i.test(l.name)) continue;
    if (/received|income/i.test(l.name)) continue;
    total += abs(l.closing);
  }
  return total;
}

/** Compact ₹ formatter for inline result text (L / Cr suffixes). */
function fmtCompactINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000)    return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000)       return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** TB ledger name reads like a cash / bank account (not a charges/interest
 *  P&L ledger that merely contains the word "bank"). */
function isCashBankLedgerName(name: string): boolean {
  return /\bcash\b|\bbank\b|petty\s*cash|hdfc|sbi|icici|axis|kotak|yes\s*bank|\bpnb\b|\bbob\b|citi|standard\s*chartered/i.test(name)
    && !/charges|interest|fee|commission|\bloan\b|overdraft\s*interest/i.test(name);
}

// ── Master-driven ledger classification (cached per Period) ─────────────

/**
 * Per-Period ledger category map.  Built lazily on first request, cached
 * via WeakMap so multiple metrics that need the same classification (CF9,
 * CF10, WC3 BS-rows fallback, etc.) don't each rebuild the masterMap.
 *
 *  Uses the parsedData.masterEntries that the engine already extracted —
 *  no extra XML parsing required.  Ledger overrides aren't carried on
 *  Period yet (they live on AppState), so master + BS-hierarchy form the
 *  classification signal here; that's enough to reliably distinguish
 *  expense ledgers from same-named asset/liability ledgers.
 */
const classMapCache = new WeakMap<Period, Map<string, LedgerCategory>>();
function getLedgerClassMap(p: Period): Map<string, LedgerCategory> {
  const hit = classMapCache.get(p);
  if (hit) return hit;
  const masterMap = new Map<string, MasterEntry>();
  for (const e of p.parsedData.masterEntries ?? []) {
    masterMap.set(e.name.toLowerCase().trim(), e);
  }
  const bsHierarchy = buildBSHierarchyMap(p.parsedData.bsheetStatement ?? null);
  const out = new Map<string, LedgerCategory>();
  for (const l of p.parsedData.tbLedgers ?? []) {
    const cls = classifyLedger(l.name, masterMap, undefined, bsHierarchy);
    out.set(l.nl, cls.category);
  }
  classMapCache.set(p, out);
  return out;
}

/** TB ledger category lookup — falls back to 'unknown' when the ledger
 *  isn't in the TB or when the master file is missing. */
function categoryOf(p: Period, ledgerName: string): LedgerCategory {
  return getLedgerClassMap(p).get(ledgerName.toLowerCase().trim()) ?? 'unknown';
}

/**
 * Period FIXED operating costs from the TB.
 *
 *  Two-stage filter — master classification first (the ledger must sit
 *  under Indirect or Direct Expenses, not a same-named asset / liability),
 *  then a name pattern to keep only the FIXED-cost subset (salary, rent,
 *  utility, insurance, telephone, admin, depreciation, interest, etc.).
 *  Variable items like purchases or sales commission are excluded.
 *
 *  Returns the period-cumulative figure as it sits in the TB.  Callers
 *  divide by period months to get a per-month rate.
 */
function fixedCostsOf(p: Period): { total: number; ledgers: string[] } {
  const tb = p.parsedData.tbLedgers ?? [];
  const FIXED_NAME_RE = /salary|wages|rent|utility|electricity|water|insurance|telephone|internet|mobile|admin|office|depreciation|interest|professional\s*fee|audit\s*fee|legal\s*fee/i;
  const VARIABLE_EXCLUDE_RE = /received|receivable|commission\s*(received|income)/i;
  let total = 0;
  const ledgers: string[] = [];
  for (const l of tb) {
    const cat = categoryOf(p, l.name);
    if (cat !== 'indirect-expense' && cat !== 'direct-expense') continue;
    if (!FIXED_NAME_RE.test(l.name)) continue;
    if (VARIABLE_EXCLUDE_RE.test(l.name)) continue;
    total += Math.abs(l.closing);
    ledgers.push(l.name);
  }
  return { total, ledgers };
}

/** Period length in months, rounded to at least 1. */
function periodMonths(p: Period): number {
  return Math.max(1, Math.round(periodDays(p) / 30));
}

/**
 * Period cash + bank flow, sign-aware.
 *
 *  Walks DayBook vouchers and classifies each by `classifyVoucherType`
 *  semantic.  Receipt / payment totals net out "wrong-direction" entries
 *  (e.g. a Payment voucher whose cash/bank leg is on the Dr side — a
 *  refund returned by a vendor — counts as a NEGATIVE payment, NOT a
 *  positive outflow).  Matches Tally's net Debit/Credit on the
 *  Receipt-Vouchers / Payment-Vouchers daybook lists.
 *
 *  The legacy `chunkedStats.cashBankNetMovement` adds receipts +
 *  payments + contras as gross magnitudes, which is misleading — use
 *  this helper for any "net cash movement" computation.
 */
function computeCashBankFlow(p: Period): {
  receipts: number; payments: number; contras: number;
  rCount: number;   pCount: number;   cCount: number;
  /** receipts − payments (contras excluded — internal transfer). */
  net: number;
} {
  let receipts = 0, payments = 0, contras = 0;
  let rCount = 0,   pCount = 0,   cCount = 0;
  const vouchers = p.chunkedStats?.vouchers ?? [];
  for (const v of vouchers) {
    const sem = classifyVoucherType(v.type).semantic;
    const amt = Math.abs(v.amount);
    // Detect the direction of the voucher's cash/bank leg — drives the
    // refund-vs-payment sign decision below.
    let hasCashLeg = false, cashLegIsDr = false;
    for (const leg of v.legs ?? []) {
      if (isCashBankLedgerName(leg.name)) {
        hasCashLeg = true;
        cashLegIsDr = leg.dr;
        break;
      }
    }
    if (sem === 'receipt') {
      rCount++;
      // Normal receipt: cash/bank Dr (money in) → +amt.
      // Reversed receipt: cash/bank Cr (money refunded to customer) → −amt.
      receipts += (hasCashLeg && !cashLegIsDr) ? -amt : amt;
    } else if (sem === 'payment') {
      pCount++;
      // Normal payment: cash/bank Cr (money out) → +amt.
      // Refund-style payment: cash/bank Dr (money returned) → −amt.
      payments += (hasCashLeg && cashLegIsDr) ? -amt : amt;
    } else if (/contra/i.test(v.type)) {
      cCount++;
      contras += amt;
    }
  }
  return { receipts, payments, contras, rCount, pCount, cCount, net: receipts - payments };
}

/**
 * Opening cash + bank balance for a period.
 *
 *  Priority:
 *   1. Sum of `opening` over cash/bank TB ledgers (exact — present when the
 *      TB export carried opening balances).
 *   2. closing − net movement, where net movement comes from the TB's
 *      signed cash/bank net (`tbCashBankNetMovement`) or, failing that,
 *      the DayBook's `cashBankNetMovement`.
 *  Returns null when neither opening data nor a movement figure exists.
 */
function openingCashBankOf(p: Period): number | null {
  const tb = p.parsedData.tbLedgers ?? [];
  let openSum = 0;
  let sawOpening = false;
  for (const l of tb) {
    if (!isCashBankLedgerName(l.name)) continue;
    if (l.opening === undefined) continue;
    sawOpening = true;
    openSum += l.opening;
  }
  if (sawOpening) return openSum;

  // Fallback: closing − net movement.  Prefer the TB's signed net
  // (closing − opening across cash/bank ledgers) when populated; else
  // compute the proper sign-aware DayBook net via computeCashBankFlow
  // — NOT the misnamed `chunkedStats.cashBankNetMovement`, which is a
  // gross total (Receipts + Payments + Contras), not a net movement.
  const closing = num(p.parsedData.bsCashBankTotal);
  if (closing == null) return null;
  const tbNet = num(p.parsedData.tbCashBankNetMovement);
  const dbNet = p.chunkedStats ? computeCashBankFlow(p).net : null;
  const net = (tbNet != null && tbNet !== 0) ? tbNet
            : (dbNet != null && dbNet !== 0) ? dbNet
            : null;
  if (net == null) return null;
  return closing - net;
}

/** Cost of goods sold = Opening Stock + Purchases − Closing Stock + Direct Expenses.
 *
 *  Per Indian P&L convention (and Tally Prime's "Cost of Sales :" rollup),
 *  Direct Expenses sit ABOVE the Gross Profit line and are part of the
 *  COGS deduction.  The `expenses` bucket from the parser holds INDIRECT
 *  expenses only; direct items (factory wages, freight inward, carriage,
 *  power for production) come through `directExpenses`. */
function cogsOf(p: Period): number {
  const opening = abs(p.parsedData.openingStock);
  const purchases = abs(p.parsedData.costOfMaterials);
  const closing = abs(p.parsedData.plClosingStock ?? p.parsedData.closingStock);
  const directExp = abs(p.parsedData.directExpenses);
  const stockMov = (opening || closing) ? Math.max(0, opening + purchases - closing) : purchases;
  return stockMov + directExp;
}

/** Gross profit = revenue − cogs.
 *
 *  Sanity floor: by definition GP = PAT + OpEx + Interest + Tax + Depreciation,
 *  so GP must be ≥ PAT.  If our COGS heuristic over-counts (e.g. lumping
 *  Manufacturing or Cost-of-Sales rollups that already include direct
 *  expenses), we'd compute GP < PAT — which is impossible.  Clamp from
 *  below to PAT in that case and let P5 surface the "computed GP capped"
 *  partial reason. */
function gpOf(p: Period): number | null {
  const rev = revenueOf(p);
  if (rev == null) return null;
  const raw = rev - cogsOf(p);
  const np = netProfitOf(p);
  // Clamp from below regardless of sign: even at a loss, GP = NP + OpEx +
  // Int + Tax with all add-backs non-negative, so GP ≥ NP must hold.
  if (np != null && raw < np) return np;
  return raw;
}

/** True when the parser-derived gross profit had to be clamped up to PAT —
 *  signals that COGS extraction is likely over-counting. */
function gpWasClamped(p: Period): boolean {
  const rev = revenueOf(p);
  if (rev == null) return false;
  const raw = rev - cogsOf(p);
  const np = netProfitOf(p);
  return np != null && raw < np;
}

/** EBITDA = Net profit + interest + depreciation + tax. */
function ebitdaOf(p: Period): number | null {
  const np = netProfitOf(p);
  if (np == null) return null;
  return np + interestExpenseOf(p) + depreciationOf(p);
}

/** MoM percentage delta (current − prior) / prior × 100.  Null when prior absent. */
/**
 * Month-over-month percentage change.  Returns null when the comparison
 * isn't meaningful:
 *   - Missing data on either side
 *   - Prior period exactly zero (divide-by-zero)
 *   - Prior period magnitude is < 0.1% of current — a near-zero prior
 *     dragged by a single residual voucher produces "+100,000% MoM"
 *     artefacts that mislead the reader.  Below that threshold the
 *     ratio is statistical noise, not a signal.
 *   - Result outside ±1000%, which the dashboard can't render usefully.
 * The trend chart still plots the underlying values regardless.
 */
function momPct(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  if (!isFinite(current) || !isFinite(prior)) return null;
  // Reject ratios where the prior is too small to be a meaningful base.
  if (Math.abs(prior) < Math.abs(current) * 0.001 && Math.abs(prior) < 1000) return null;
  const ratio = ((current - prior) / Math.abs(prior)) * 100;
  if (!isFinite(ratio)) return null;
  if (Math.abs(ratio) > 1000) return null;
  return ratio;
}

/**
 * Build a trend by applying `picker` over a period array — used for both
 * actual multi-period uploads (ctx.history) and voucher-derived monthly
 * slices (ctx.monthlyPeriods).
 */
function buildTrendFrom(
  periods: Period[],
  picker: (p: Period) => number | null,
): Array<{ periodId: string; periodLabel: string; value: number }> {
  return periods
    .map(p => {
      const v = picker(p);
      return v == null ? null : { periodId: p.id, periodLabel: p.label, value: v };
    })
    .filter((x): x is { periodId: string; periodLabel: string; value: number } => x !== null);
}

/**
 * Prefer the actual multi-period history when it has 2+ entries; otherwise
 * fall back to voucher-derived monthly slices when the single upload spans
 * multiple months.  Returns an empty array when neither is available.
 */
function trendPeriods(ctx: MetricContext): Period[] {
  if (ctx.history.length >= 2) return ctx.history;
  if (ctx.monthlyPeriods && ctx.monthlyPeriods.length >= 2) return ctx.monthlyPeriods;
  return [];
}

// ── DOMAIN 1: Profitability & P&L  (10 metrics) ──────────────────────────

const D1_METRICS: MetricDef[] = [
  {
    id: 'P1', domainId: 'D1', label: 'Total revenue (net of GST)',
    defaultStatus: 'auto', source: 'P&L', unit: 'INR', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(Sales group ledgers — GST excluded)',
    compute(ctx) {
      const r = revenueOf(ctx.current);
      if (r == null) return missingDataResult(this.id, 'P&L not uploaded or revenue not detected');
      const priorR = ctx.prior ? revenueOf(ctx.prior) : null;
      const trend = buildTrendFrom(trendPeriods(ctx), revenueOf);
      const monthlyMoM = trend.length >= 2
        ? momPct(trend[trend.length - 1].value, trend[trend.length - 2].value)
        : null;
      const directRev = abs(ctx.current.parsedData.directRevenue);
      const otherInc = abs(ctx.current.parsedData.otherIncome);
      return computedResult(this.id, {
        numeric: r,
        unit: 'INR',
        mom: momPct(r, priorR) ?? monthlyMoM ?? undefined,
        momIsPct: true,
        trend,
        breakdown: [
          { label: 'Direct Revenue (Sales / Turnover)', value: directRev, unit: 'INR' },
          { label: '+ Other / Indirect Income', value: otherInc, unit: 'INR' },
          { label: 'Total revenue (net of GST)', value: r, unit: 'INR', badge: 'NET' },
        ],
      }, { formula: this.formula, source: 'P&L.xml', ledgers: ['Sales A/c', 'Direct Income'] });
    },
  },
  {
    id: 'P2', domainId: 'D1', label: 'Revenue MoM growth rate',
    defaultStatus: 'partial', source: 'P&L (2+ periods)', unit: 'pct', direction: 'higher-better',
    caveat: 'Needs 2+ months of P&L XMLs',
    remediation: 'Upload P&L XMLs for at least 2 months',
    formula: '(curr.revenue − prior.revenue) / prior.revenue × 100',
    compute(ctx) {
      const r = revenueOf(ctx.current);
      if (r == null) return missingDataResult(this.id, 'Current P&L missing');
      // Prefer an actual prior-period upload; otherwise fall back to the
      // last two voucher-derived monthly slices from the current upload.
      const pr = ctx.prior ? revenueOf(ctx.prior) : null;
      const periods = trendPeriods(ctx);
      if (pr == null && periods.length < 2) {
        return { id: this.id, status: 'partial', value: { text: 'Need ≥ 2 periods', unit: 'pct' }, reason: 'DayBook contains only 1 calendar month — MoM unavailable', formula: this.formula };
      }
      const trend = buildTrendFrom(periods, revenueOf);
      const mom = pr != null
        ? momPct(r, pr)!
        : momPct(trend[trend.length - 1].value, trend[trend.length - 2].value)!;
      return computedResult(this.id, { numeric: mom, unit: 'pct', trend }, { formula: this.formula });
    },
  },
  {
    id: 'P3', domainId: 'D1', label: 'Revenue vs budget variance',
    defaultStatus: 'manual', source: 'Budget upload', unit: 'pct', direction: 'higher-better',
    remediation: 'Upload budget Excel or enter figures in Setup',
    formula: '(actual − budget) / budget × 100',
    compute(ctx) {
      const r = revenueOf(ctx.current);
      const b = ctx.budget?.revenue;
      if (r == null) return missingDataResult(this.id, 'P&L missing');
      if (b == null || b === 0) return manualRequiredResult(this.id, 'Budget revenue not provided');
      return computedResult(this.id, { numeric: ((r - b) / b) * 100, unit: 'pct' }, { formula: this.formula });
    },
  },
  {
    id: 'P4', domainId: 'D1', label: 'Revenue by segment / product',
    defaultStatus: 'auto', source: 'P&L + DayBook', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'P&L Sales group ledgers (else group Sales vouchers by revenue leg)',
    compute(ctx) {
      const pd = ctx.current.parsedData;
      const segMap = new Map<string, number>();

      // 1) Primary: children of the P&L "Sales Accounts" group.  This is the
      //    ledger-level revenue split Tally shows in Group Summary — and it
      //    catches revenue ledgers whose NAME doesn't read like "sales"
      //    (e.g. "GST Services" sitting under Sales Accounts).  The old
      //    voucher-leg name regex silently dropped those.
      const plSections = pd.plSections ?? [];
      for (const sec of plSections) {
        const nl = sec.name.toLowerCase();
        const isSalesGroup =
          (/sale|revenue|turnover/.test(nl)) &&
          !/cost of sales/.test(nl) &&
          !nl.trim().endsWith(':');               // skip rollup headers
        if (!isSalesGroup) continue;
        for (const ch of sec.children) {
          const amt = Math.abs(ch.amount);
          if (amt > 0) segMap.set(ch.name, (segMap.get(ch.name) ?? 0) + amt);
        }
      }

      // 2) Fallback: group Sales-voucher revenue legs by ledger name.  Used
      //    when the P&L XML didn't carry a child breakdown.
      if (segMap.size === 0) {
        const cs = ctx.current.chunkedStats;
        if (!cs) return missingDataResult(this.id, 'P&L / DayBook not uploaded');
        for (const v of cs.vouchers) {
          if (!/sale/i.test(v.type) || /return|credit/i.test(v.type)) continue;
          for (const leg of v.legs ?? []) {
            if (!leg.dr && /sale|revenue|income/i.test(leg.name)) {
              segMap.set(leg.name, (segMap.get(leg.name) ?? 0) + leg.amt);
            }
          }
        }
      }

      const breakdown: MetricBreakdownItem[] = [...segMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, value]) => ({ label, value, unit: 'INR' }));
      if (breakdown.length === 0) return { id: this.id, status: 'partial', value: { text: 'No segment ledgers detected', unit: 'INR' }, reason: 'All sales posted to a single sales ledger — segment split unavailable', formula: this.formula };
      if (breakdown.length === 1) return { id: this.id, status: 'partial', value: { numeric: breakdown[0].value, unit: 'INR', breakdown }, reason: 'Only one revenue ledger in use — create separate ledgers per segment for a split', formula: this.formula };
      const total = breakdown.reduce((s, b) => s + b.value, 0);
      return computedResult(this.id, { numeric: total, unit: 'INR', breakdown }, { formula: this.formula, source: 'P&L.xml' });
    },
  },
  {
    id: 'P5', domainId: 'D1', label: 'Gross profit & gross margin %',
    defaultStatus: 'auto', source: 'P&L', unit: 'INR', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'Gross Profit = Revenue − COGS;  GM% = GP / Revenue × 100',
    compute(ctx) {
      const gp = gpOf(ctx.current);
      const r = revenueOf(ctx.current);
      if (gp == null || r == null) return missingDataResult(this.id, 'Revenue or COGS not parsed');
      const gm = safeDiv(gp, r);
      const trend = buildTrendFrom(trendPeriods(ctx), gpOf);
      const clamped = gpWasClamped(ctx.current);
      const opening = abs(ctx.current.parsedData.openingStock);
      const purchases = abs(ctx.current.parsedData.costOfMaterials);
      const closing = abs(ctx.current.parsedData.plClosingStock ?? ctx.current.parsedData.closingStock);
      const directExp = abs(ctx.current.parsedData.directExpenses);
      return computedResult(this.id, {
        numeric: gp, unit: 'INR',
        text: `₹${gp.toFixed(0)}  ·  GM ${gm != null ? (gm * 100).toFixed(1) : '—'}%`,
        trend,
        breakdown: [
          { label: 'Revenue', value: r, unit: 'INR' },
          { label: '− Opening Stock', value: -opening, unit: 'INR' },
          { label: '− Purchases', value: -purchases, unit: 'INR' },
          { label: '+ Closing Stock', value: closing, unit: 'INR' },
          { label: '− Direct Expenses', value: -directExp, unit: 'INR' },
          { label: 'Gross Profit', value: gp, unit: 'INR', badge: 'NET' },
          { label: 'Gross Margin %', value: gm != null ? gm * 100 : 0, unit: 'pct' },
        ],
      }, {
        formula: this.formula, source: 'P&L.xml',
        partial: clamped,
        reason: clamped ? 'Parser COGS exceeded (Revenue − PAT) — Gross Profit floored to PAT. Check P&L for non-purchase items lumped under Cost of Sales / Manufacturing.' : undefined,
      });
    },
  },
  {
    id: 'P6', domainId: 'D1', label: 'EBITDA & EBITDA margin %',
    defaultStatus: 'auto', source: 'P&L', unit: 'INR', direction: 'higher-better',
    caveat: 'Interest & depreciation must be separate P&L lines',
    remediation: 'Ensure depreciation & interest are separate ledgers in Tally',
    formula: 'EBITDA = Net Profit + Interest + Depreciation;  margin = EBITDA / Revenue × 100',
    compute(ctx) {
      const e = ebitdaOf(ctx.current);
      const r = revenueOf(ctx.current);
      if (e == null || r == null) return missingDataResult(this.id, 'Net profit / interest / depreciation not detected');
      const partial = !ctx.current.parsedData.depFound;
      const margin = safeDiv(e, r);
      const np = netProfitOf(ctx.current) ?? 0;
      const intExp = interestExpenseOf(ctx.current);
      const depExp = depreciationOf(ctx.current);
      return computedResult(this.id, {
        numeric: e, unit: 'INR',
        text: `₹${e.toFixed(0)}  ·  ${margin != null ? (margin * 100).toFixed(1) : '—'}%`,
        trend: buildTrendFrom(trendPeriods(ctx), ebitdaOf),
        breakdown: [
          { label: 'Net Profit (PAT)', value: np, unit: 'INR' },
          { label: '+ Interest expense', value: intExp, unit: 'INR' },
          { label: '+ Depreciation', value: depExp, unit: 'INR' },
          { label: 'EBITDA', value: e, unit: 'INR', badge: 'NET' },
          { label: 'EBITDA margin %', value: margin != null ? margin * 100 : 0, unit: 'pct' },
        ],
      }, {
        formula: this.formula, source: 'P&L.xml',
        partial, reason: partial ? 'Depreciation ledger not found — EBITDA may understate add-back' : undefined,
      });
    },
  },
  {
    id: 'P7', domainId: 'D1', label: 'Net profit (PAT) & PAT margin %',
    defaultStatus: 'auto', source: 'P&L', unit: 'INR', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'PAT = BS retained earnings movement OR P&L bottom line;  margin = PAT / Revenue',
    compute(ctx) {
      const pat = netProfitOf(ctx.current);
      const r = revenueOf(ctx.current);
      if (pat == null) return missingDataResult(this.id, 'Net profit not detected');
      const margin = r ? safeDiv(pat, r) : null;
      const trend = buildTrendFrom(trendPeriods(ctx), netProfitOf);
      const priorPat = ctx.prior ? netProfitOf(ctx.prior) : null;
      const monthlyMoM = trend.length >= 2
        ? momPct(trend[trend.length - 1].value, trend[trend.length - 2].value)
        : null;
      // Build a P&L bridge from Revenue down to PAT so the Backup view
      // shows where every rupee went.
      const gp = gpOf(ctx.current) ?? 0;
      const indirectExp = abs(ctx.current.parsedData.expenses)
        - abs(ctx.current.parsedData.costOfMaterials)
        - abs(ctx.current.parsedData.directExpenses);
      const bsSourced = ctx.current.parsedData.bsNetProfit != null;
      return computedResult(this.id, {
        numeric: pat, unit: 'INR',
        text: `₹${pat.toFixed(0)}  ·  ${margin != null ? (margin * 100).toFixed(1) : '—'}%`,
        mom: momPct(pat, priorPat) ?? monthlyMoM ?? undefined,
        momIsPct: true,
        trend,
        breakdown: [
          { label: 'Revenue (incl. Other Income)', value: r ?? 0, unit: 'INR' },
          { label: '− COGS (Opening + Purchases − Closing + Direct Exp)', value: -cogsOf(ctx.current), unit: 'INR' },
          { label: 'Gross Profit', value: gp, unit: 'INR' },
          { label: '− Indirect Expenses (period)', value: -Math.max(0, indirectExp), unit: 'INR' },
          { label: bsSourced ? 'Net Profit (PAT, from BS P&L A/c)' : 'Net Profit (PAT, P&L derived)', value: pat, unit: 'INR', badge: 'NET' },
          { label: 'PAT margin %', value: margin != null ? margin * 100 : 0, unit: 'pct' },
        ],
      }, { formula: this.formula, source: 'P&L.xml + BS.xml' });
    },
  },
  {
    id: 'P8', domainId: 'D1', label: 'Contribution margin per product',
    defaultStatus: 'partial', source: 'P&L + DayBook', unit: 'pct',
    caveat: 'Variable cost split not always explicit in Tally',
    remediation: 'Configure cost centres for variable vs fixed cost in Tally',
    formula: '(Revenue − Variable costs) / Revenue × 100',
    compute(ctx) {
      const r = revenueOf(ctx.current);
      if (r == null) return missingDataResult(this.id, 'Revenue missing');
      // Variable cost proxy: COGS + marketing (no cost centre tagging).
      const vc = cogsOf(ctx.current);
      const cm = safeDiv(r - vc, r);
      if (cm == null) return missingDataResult(this.id, 'Cannot compute — revenue zero');
      return { id: this.id, status: 'partial', value: { numeric: cm * 100, unit: 'pct' }, reason: 'Variable cost = COGS proxy (cost centre tagging required for precise split)', formula: this.formula };
    },
  },
  {
    id: 'P9', domainId: 'D1', label: '12-month P&L trend (rolling)',
    defaultStatus: 'partial', source: 'P&L (multi)', unit: 'INR',
    caveat: 'Needs up to 12 months of P&L XMLs',
    remediation: 'Upload P&L XMLs for each month in the period grid',
    formula: 'series(revenue, GP, EBITDA, PAT for each period)',
    compute(ctx) {
      const periods = trendPeriods(ctx);
      // Pick the widest available series: real multi-period history or
      // voucher-derived monthly slices, else the single current period.
      const series = periods.length > 0
        ? periods
        : (ctx.history.length > 0 ? ctx.history : []);
      if (series.length === 0) return missingDataResult(this.id, 'No periods analysed');
      const trend = buildTrendFrom(series, revenueOf);
      if (trend.length === 0) return missingDataResult(this.id, 'No revenue data across periods');
      const partial = trend.length < 12;
      const months = `${trend.length} month${trend.length === 1 ? '' : 's'}`;
      const latest = trend[trend.length - 1].value;
      return computedResult(this.id, {
        // Trend-only metric — give the table a readable scalar so it doesn't
        // render blank.  The chart consumes `trend`.
        text: `${months} tracked · latest ${fmtCompactINR(latest)}`,
        unit: 'INR',
        trend,
      }, {
        formula: this.formula, partial,
        reason: partial
          ? (trend.length === 1
              ? 'Only 1 month of data available — DayBook spans a single calendar month'
              : `${trend.length} of 12 months available — upload more periods to extend the rolling view`)
          : undefined,
      });
    },
  },
  {
    id: 'P10', domainId: 'D1', label: 'Prior year same period comparison',
    defaultStatus: 'partial', source: 'P&L (multi)',
    caveat: "Upload last year's P&L XML as prior period",
    remediation: "Upload last year's P&L XML in the period upload grid",
    formula: 'curr period vs same period prior FY',
    compute(ctx) {
      const r = revenueOf(ctx.current);
      const currId = ctx.current.id;             // e.g. "2025-04"
      const m = /^(\d{4})-(\d{2})/.exec(currId);
      if (!m || r == null) return missingDataResult(this.id, 'Cannot identify period');
      const priorYear = `${+m[1] - 1}-${m[2]}`;
      const py = ctx.history.find(p => p.id === priorYear);
      if (!py) return { id: this.id, status: 'partial', value: { text: `Need ${priorYear} P&L` }, reason: `Prior-year ${priorYear} not uploaded`, formula: this.formula };
      const pyRev = revenueOf(py);
      if (pyRev == null) return missingDataResult(this.id, 'Prior-year revenue missing');
      const yoy = momPct(r, pyRev);
      return computedResult(this.id, { numeric: yoy ?? 0, unit: 'pct', text: `${yoy?.toFixed(1)}% YoY` }, { formula: this.formula });
    },
  },
];

// ── DOMAIN 2: Cash flow  (10 metrics) ────────────────────────────────────

const D2_METRICS: MetricDef[] = [
  {
    id: 'CF1', domainId: 'D2', label: 'Opening vs closing bank + cash balance',
    defaultStatus: 'auto', source: 'TrialBal + BSheet + DayBook', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'Closing = BS bank + cash;  Opening = TB cash/bank opening balances (or Closing − net movement)',
    compute(ctx) {
      const closing = num(ctx.current.parsedData.bsCashBankTotal);
      if (closing == null) return missingDataResult(this.id, 'BSheet not uploaded');
      // Prefer an actual prior-period upload; else derive opening from the
      // current period's own TB opening balances / net movement.
      const opening = ctx.prior
        ? (num(ctx.prior.parsedData.bsCashBankTotal) ?? openingCashBankOf(ctx.current))
        : openingCashBankOf(ctx.current);
      if (opening == null) {
        return computedResult(this.id, {
          numeric: closing, unit: 'INR',
          text: `Close ₹${closing.toFixed(0)}`,
        }, {
          formula: this.formula, source: 'BSheet.xml', partial: true,
          reason: 'Opening balance unavailable — TB export lacks opening balances and no prior period uploaded',
        });
      }
      const change = closing - opening;
      const arrow = change >= 0 ? '▲' : '▼';
      return computedResult(this.id, {
        numeric: closing, unit: 'INR',
        // Headline = closing.  Secondary line (after the "·") shows the
        // opening balance and the net change for the period.
        text: `${fmtCompactINR(closing)} · Opening ${fmtCompactINR(opening)}  ${arrow} ${fmtCompactINR(Math.abs(change))}`,
        breakdown: [
          { label: 'Opening balance', value: opening, unit: 'INR' },
          { label: 'Closing balance', value: closing, unit: 'INR' },
          { label: 'Net change', value: change, unit: 'INR' },
        ],
      }, { formula: this.formula, source: 'TrialBal.xml + BSheet.xml' });
    },
  },
  {
    id: 'CF2', domainId: 'D2', label: 'Net cash movement for the month',
    defaultStatus: 'auto', source: 'DayBook', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(Receipt vouchers) − sum(Payment vouchers) over cash/bank ledgers',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');

      // Use the sign-aware helper so refund-style payments / reversed
      // receipts net out properly — matches Tally's net Debit/Credit on
      // the daybook voucher lists, NOT the (misnamed) gross
      // `chunkedStats.cashBankNetMovement`.
      const flow = computeCashBankFlow(ctx.current);
      const { receipts, payments, contras, rCount, pCount, cCount, net } = flow;

      // Display each gross total as POSITIVE — matches Tally's "Debit
      // Amount" / "Credit Amount" columns.  The formula label already
      // states `Receipts − Payments`, so we don't double-negate.
      const breakdown: MetricBreakdownItem[] = [
        { label: `Receipts  (${rCount} voucher${rCount === 1 ? '' : 's'}, net of reversals)`,
          value: receipts, unit: 'INR' },
        { label: `Payments  (${pCount} voucher${pCount === 1 ? '' : 's'}, net of refunds)`,
          value: payments, unit: 'INR' },
      ];
      if (cCount > 0) {
        breakdown.push({
          label: `Contras  (${cCount} voucher${cCount === 1 ? '' : 's'}, ${fmtCompactINR(contras)} — internal transfer, net zero)`,
          value: 0, unit: 'INR',
        });
      }
      breakdown.push({ label: 'Net cash + bank movement (DayBook)', value: net, unit: 'INR', badge: 'NET' });

      // Per-bank movement from the TB (opening → closing) when opening
      // balances were exported.  Lets the user reconcile DayBook flow
      // against each bank ledger's own period activity.
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      const perBank: MetricBreakdownItem[] = [];
      for (const l of tb) {
        if (!isCashBankLedgerName(l.name)) continue;
        if (l.opening === undefined) continue;
        const mov = l.closing - l.opening;
        if (mov === 0 && l.closing === 0 && l.opening === 0) continue;
        perBank.push({
          label: `${l.name}  (₹${l.opening.toFixed(0)} → ₹${l.closing.toFixed(0)})`,
          value: mov, unit: 'INR',
        });
      }
      if (perBank.length > 0) {
        breakdown.push({ label: '— Per-bank Δ (TB opening → closing) —', value: 0, unit: 'INR' });
        breakdown.push(...perBank);
        const tbNet = perBank.reduce((s, r) => s + r.value, 0);
        breakdown.push({ label: 'Net cash + bank movement (TB)', value: tbNet, unit: 'INR', badge: 'NET' });
      }

      return computedResult(this.id, { numeric: net, unit: 'INR', breakdown },
        { formula: this.formula, source: perBank.length > 0 ? 'DayBook.xml + TrialBal.xml' : 'DayBook.xml' });
    },
  },
  {
    id: 'CF3', domainId: 'D2', label: 'Bank-wise balance breakup',
    defaultStatus: 'auto', source: 'TB / BSheet', unit: 'INR',
    caveat: 'Each bank must be a separate ledger in Tally; overdraft balances render as negative',
    remediation: 'Create separate ledgers per bank in Tally',
    formula: 'sum(TB ledgers under Bank Accounts) — signed: Dr balance = +, Cr / OD balance = −',
    compute(ctx) {
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      const banks = tb.filter(l => isCashBankLedgerName(l.name));
      if (banks.length === 0) return missingDataResult(this.id, 'No bank ledgers detected in TB');
      // Preserve sign — Dr balance (asset) is positive, Cr balance
      // (overdraft / running liability) is negative.  The old `Math.abs`
      // collapsed both into one column and inflated the total.
      const breakdown: MetricBreakdownItem[] = banks.map(b => ({
        label: b.name,
        value: b.closing,
        unit: 'INR' as const,
        badge: b.closing < 0 ? 'OD' : undefined,
      })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      // Headline = NET bank position (positive bank balances minus
      // overdrafts) so it agrees with Tally's signed Grand Total.
      const total = breakdown.reduce((s, b) => s + b.value, 0);
      const dr = breakdown.filter(b => b.value > 0).reduce((s, b) => s + b.value, 0);
      const cr = -breakdown.filter(b => b.value < 0).reduce((s, b) => s + b.value, 0);
      return computedResult(this.id, {
        numeric: total, unit: 'INR',
        text: `Net ${fmtCompactINR(total)} · Dr ${fmtCompactINR(dr)} / OD ${fmtCompactINR(cr)}`,
        breakdown,
      }, { formula: this.formula, source: 'TrialBal.xml', ledgers: banks.map(b => b.name) });
    },
  },
  {
    id: 'CF4', domainId: 'D2', label: 'Operating cash flow (OCF)',
    defaultStatus: 'auto', source: 'P&L + BSheet', unit: 'INR', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'PAT + Depreciation + WC changes (Δ Debtors, Δ Creditors, Δ Inventory)',
    compute(ctx) {
      const pat = netProfitOf(ctx.current);
      if (pat == null) return missingDataResult(this.id, 'PAT missing');
      const dep = depreciationOf(ctx.current);
      // WC deltas: only when prior period present.
      let wcChange = 0;
      let partial = !ctx.prior;
      if (ctx.prior) {
        const dDeb = abs(ctx.current.parsedData.debtorBal) - abs(ctx.prior.parsedData.debtorBal);
        const dCred = abs(ctx.current.parsedData.creditorBal) - abs(ctx.prior.parsedData.creditorBal);
        const dInv = abs(ctx.current.parsedData.closingStock) - abs(ctx.prior.parsedData.closingStock);
        wcChange = -dDeb + dCred - dInv;
      }
      // Use existing operatingCF if engine already produced it (Cash Flow XML upload).
      const engineOCF = num(ctx.current.parsedData.operatingCF);
      const ocf = engineOCF != null && engineOCF !== 0 ? engineOCF : pat + dep + wcChange;
      return computedResult(this.id, {
        numeric: ocf, unit: 'INR',
        breakdown: [
          { label: 'PAT', value: pat, unit: 'INR' },
          { label: '+ Depreciation', value: dep, unit: 'INR' },
          { label: '± WC changes', value: wcChange, unit: 'INR' },
        ],
      }, { formula: this.formula, source: 'P&L.xml + BSheet.xml', partial, reason: partial ? 'WC changes need a prior period; using 0 for now' : undefined });
    },
  },
  {
    id: 'CF5', domainId: 'D2', label: 'Investing cash flow',
    defaultStatus: 'partial', source: 'BSheet + DayBook', unit: 'INR',
    caveat: 'Capex must be tagged to fixed asset ledgers',
    remediation: 'Tag all capital purchases to fixed asset ledger groups',
    formula: 'Δ Fixed Assets between periods',
    compute(ctx) {
      const engine = num(ctx.current.parsedData.investingCF);
      if (engine != null && engine !== 0) {
        return computedResult(this.id, { numeric: engine, unit: 'INR' }, { formula: this.formula, source: 'CashFlow.xml' });
      }
      if (!ctx.prior) return { id: this.id, status: 'partial', value: { text: 'Need prior period BS', unit: 'INR' }, reason: 'Investing CF derived from Δ Fixed Assets; prior period required', formula: this.formula };
      const dFA = abs(ctx.current.parsedData.fixedAssets) - abs(ctx.prior.parsedData.fixedAssets);
      return computedResult(this.id, { numeric: -dFA, unit: 'INR' }, { formula: this.formula, source: 'BSheet.xml (multi)', partial: true });
    },
  },
  {
    id: 'CF6', domainId: 'D2', label: 'Financing cash flow',
    defaultStatus: 'partial', source: 'BSheet + DayBook', unit: 'INR',
    caveat: 'Loan accounts must be separate ledgers',
    remediation: 'Create separate ledgers per loan in Tally',
    formula: 'Δ Loans + Δ Equity − Dividends',
    compute(ctx) {
      const engine = num(ctx.current.parsedData.financingCF);
      if (engine != null && engine !== 0) {
        return computedResult(this.id, { numeric: engine, unit: 'INR' }, { formula: this.formula, source: 'CashFlow.xml' });
      }
      return { id: this.id, status: 'partial', value: { text: 'Loan ledger movement', unit: 'INR' }, reason: 'CashFlow XML not uploaded; partial estimate', formula: this.formula };
    },
  },
  {
    id: 'CF7', domainId: 'D2', label: 'Free cash flow (FCF)',
    defaultStatus: 'auto', source: 'P&L + BSheet', unit: 'INR', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'FCF = OCF − |Capex|',
    compute(ctx) {
      const ocfResult = D2_METRICS.find(m => m.id === 'CF4')!.compute(ctx);
      const icfResult = D2_METRICS.find(m => m.id === 'CF5')!.compute(ctx);
      const ocf = ocfResult.value?.numeric;
      const icf = icfResult.value?.numeric;
      if (ocf == null) return missingDataResult(this.id, 'OCF unavailable');
      const capex = icf != null ? Math.abs(icf) : 0;
      return computedResult(this.id, { numeric: ocf - capex, unit: 'INR' }, { formula: this.formula });
    },
  },
  {
    id: 'CF8', domainId: 'D2', label: '13-week cash flow forecast baseline',
    defaultStatus: 'partial', source: 'DayBook + Bills', unit: 'INR',
    caveat: 'Auto-baseline from past patterns; new orders need manual input',
    remediation: 'Upload Bills.xml and enter upcoming orders in Setup',
    formula: 'Avg weekly net flow over last N periods × 13',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      const weeklyNet = cs.cashBankNetMovement / Math.max(4, Object.keys(cs.monthCounts).length * 4);
      return { id: this.id, status: 'partial', value: { numeric: weeklyNet * 13, unit: 'INR' }, reason: 'Baseline only — Bills.xml + manual order book needed for full 13-week view', formula: this.formula };
    },
  },
  {
    id: 'CF9', domainId: 'D2', label: 'Cash burn rate (fixed cost base / month)',
    defaultStatus: 'auto', source: 'P&L + TB', unit: 'INR', direction: 'lower-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(fixed-cost ledgers under Indirect/Direct Expenses) / period months',
    compute(ctx) {
      const { total: periodFixed, ledgers } = fixedCostsOf(ctx.current);
      if (periodFixed === 0) return missingDataResult(this.id, 'No fixed-cost expense ledgers detected (need Indirect / Direct Expenses with names like Salary, Rent, Utility…)');
      const months = periodMonths(ctx.current);
      const perMonth = periodFixed / months;
      return computedResult(this.id, {
        numeric: perMonth, unit: 'INR',
        text: `${fmtCompactINR(perMonth)} / month  ·  ${fmtCompactINR(periodFixed)} over ${months} month${months === 1 ? '' : 's'}`,
        breakdown: [
          { label: `Fixed costs (period total — ${ledgers.length} ledger${ledgers.length === 1 ? '' : 's'})`, value: periodFixed, unit: 'INR' },
          { label: `÷ Period months`, value: months, unit: 'count' },
          { label: 'Monthly burn rate', value: perMonth, unit: 'INR', badge: 'NET' },
        ],
      }, { formula: this.formula, source: 'TrialBal.xml + Master.xml', ledgers });
    },
  },
  {
    id: 'CF10', domainId: 'D2', label: 'Upcoming committed outflows (30/60/90d)',
    defaultStatus: 'auto', source: 'Bills + P&L + TB', unit: 'INR', direction: 'lower-better',
    caveat: 'Bills.xml drives bucket placement by due date; recurring monthly base + creditor outstanding layered on top',
    remediation: 'Upload Payables.xml for per-bill aging; otherwise total creditor balance estimates overdue',
    formula: 'bucket = payable bills due in window + 1× monthly recurring base  (+ total creditor balance when payables not uploaded)',
    compute(ctx) {
      // Recurring monthly base — same fixed-cost methodology as CF9.
      const { total: periodFixed } = fixedCostsOf(ctx.current);
      const months = periodMonths(ctx.current);
      const monthly = periodFixed / months;

      // Bucket payable bills (when Payables.xml is uploaded) by days-until-due.
      const payables = (ctx.bills ?? []).filter(b => b.type === 'payable');
      const asOf = periodAsOfDate(ctx.current);
      let bills30 = 0, bills60 = 0, bills90 = 0, billsOver90 = 0;
      let n30 = 0, n60 = 0, n90 = 0, nOver90 = 0;
      for (const b of payables) {
        const days = billDaysOverdue(b, asOf);
        if (days == null) continue;
        // days > 0 = already overdue → bucket into next 30 (must clear).
        // days ≤ 0 → daysUntilDue = -days.
        const untilDue = -days;
        if (untilDue <= 30)       { bills30 += b.amount; n30++; }
        else if (untilDue <= 60)  { bills60 += b.amount; n60++; }
        else if (untilDue <= 90)  { bills90 += b.amount; n90++; }
        else                      { billsOver90 += b.amount; nOver90++; }
      }
      const haveBills = payables.length > 0;

      // Fallback: when no per-bill aging is available but the BS shows
      // creditor balances, surface the entire creditor outstanding as a
      // 30-day "must clear" estimate.  Real-world this is what
      // accountants treat as "payments due" when bill-level aging hasn't
      // been maintained.  Marks the result as `partial` with a clear
      // reason so the user knows it's an aggregate, not per-bill.
      const creditorBal = Math.abs(ctx.current.parsedData.creditorBal ?? 0);
      const usedCreditorFallback = !haveBills && creditorBal > 0;
      if (usedCreditorFallback) {
        bills30 += creditorBal;
        n30 += 1; // one aggregate "line" for the breakdown
      }

      if (monthly === 0 && !haveBills && !usedCreditorFallback) {
        return missingDataResult(this.id, 'No fixed-cost ledgers in TB, no payable bills in Payables.xml, and no creditor balance on the BS');
      }

      const bucket30 = bills30 + monthly;
      const bucket60 = bills60 + monthly;
      const bucket90 = bills90 + monthly;
      const total90 = bucket30 + bucket60 + bucket90;

      // ── Breakdown order matters ──────────────────────────────────────
      // The 3-tile dashboard reads `breakdown.slice(0, 3)` to render the
      // Next 30 / 31–60 / 61–90 cards.  Put the bucket TOTALS first so
      // each card shows a meaningful 30/60/90 split, then the per-bucket
      // detail rows follow for the Backup Working view.
      const breakdown: MetricBreakdownItem[] = [
        { label: 'Next 30 days', value: bucket30, unit: 'INR', badge: 'NET' },
        { label: '31–60 days',   value: bucket60, unit: 'INR', badge: 'NET' },
        { label: '61–90 days',   value: bucket90, unit: 'INR', badge: 'NET' },

        // ── Working detail, 30-day bucket ──
        { label: usedCreditorFallback
            ? '  Next 30 days · creditor balance (no per-bill aging available)'
            : `  Next 30 days · bills due (${n30} bill${n30 === 1 ? '' : 's'})`,
          value: bills30, unit: 'INR' },
        { label: '  Next 30 days · recurring monthly base', value: monthly, unit: 'INR' },

        // ── Working detail, 60-day bucket ──
        { label: `  31–60 days · bills due (${n60} bill${n60 === 1 ? '' : 's'})`, value: bills60, unit: 'INR' },
        { label: '  31–60 days · recurring monthly base', value: monthly, unit: 'INR' },

        // ── Working detail, 90-day bucket ──
        { label: `  61–90 days · bills due (${n90} bill${n90 === 1 ? '' : 's'})`, value: bills90, unit: 'INR' },
        { label: '  61–90 days · recurring monthly base', value: monthly, unit: 'INR' },
      ];
      if (billsOver90 > 0) {
        breakdown.push({
          label: `  Beyond 90 days · bills due (${nOver90} bill${nOver90 === 1 ? '' : 's'}, outside 90-day window)`,
          value: billsOver90, unit: 'INR',
        });
      }
      breakdown.push({ label: 'TOTAL — 90-day committed outflows', value: total90, unit: 'INR', badge: 'NET' });

      const status = haveBills ? 'computed' : 'partial';
      const reason = haveBills
        ? undefined
        : usedCreditorFallback
          ? `Payables.xml not uploaded — used total creditor balance ₹${creditorBal.toFixed(0)} as a 30-day estimate; upload Payables.xml for per-bill aging`
          : 'No payable bills uploaded and no creditor balance on BS — buckets show recurring monthly base only';

      return {
        id: this.id, status,
        value: {
          numeric: total90, unit: 'INR',
          text: `90-day total ${fmtCompactINR(total90)}  ·  ${haveBills ? `${payables.length} bill${payables.length === 1 ? '' : 's'} + recurring` : (usedCreditorFallback ? 'creditor balance + recurring' : 'recurring estimate only')}`,
          breakdown,
        },
        reason, formula: this.formula,
      };
    },
  },
];

// ── DOMAIN 3: Working capital  (12 metrics) ──────────────────────────────

const D3_METRICS: MetricDef[] = [
  {
    id: 'WC1', domainId: 'D3', label: 'Debtor aging: 0–30 / 31–60 / 61–90 / 90+ days',
    defaultStatus: 'auto', source: 'Bills.xml', unit: 'INR',
    remediation: 'Export Bills.xml from Tally: Outstanding → Bills Outstanding → Alt+E',
    formula: 'sum(outstanding receivable bills) bucketed by days past due',
    compute(ctx) {
      const bills = (ctx.bills ?? []).filter(b => b.type === 'receivable');
      if (bills.length === 0) {
        return missingDataResult(this.id, 'Bills.xml not uploaded — debtor aging needs per-bill due dates');
      }
      const asOf = periodAsOfDate(ctx.current);
      const { buckets, total } = agingBreakdown(bills, asOf);
      if (total === 0) return missingDataResult(this.id, 'No outstanding receivable bills');
      const overdue = buckets['0–30'] + buckets['31–60'] + buckets['61–90'] + buckets['90+'];
      return computedResult(this.id, {
        numeric: total, unit: 'INR',
        text: `${fmtCompactINR(total)} · ${fmtCompactINR(overdue)} overdue / ${fmtCompactINR(buckets['90+'])} in 90+`,
        breakdown: agingBreakdownItems(buckets),
      }, { formula: this.formula, source: 'Bills.xml' });
    },
  },
  {
    id: 'WC2', domainId: 'D3', label: 'Days Sales Outstanding (DSO)',
    defaultStatus: 'auto', source: 'BSheet + P&L', unit: 'days', direction: 'lower-better',
    remediation: 'Computable from uploaded XMLs',
    formula: '(Debtors / Revenue) × period days',
    compute(ctx) {
      const debtors = abs(ctx.current.parsedData.debtorBal);
      const rev = revenueOf(ctx.current);
      if (!debtors || rev == null || rev === 0) return missingDataResult(this.id, 'Debtors or revenue missing');
      const days = periodDays(ctx.current);
      const dso = (debtors / rev) * days;
      return computedResult(this.id, {
        numeric: dso, unit: 'days', text: `${dso.toFixed(0)} days`,
        breakdown: [
          { label: 'Sundry Debtors (BS closing)', value: debtors, unit: 'INR' },
          { label: '÷ Revenue (period)', value: rev, unit: 'INR' },
          { label: '× Period days', value: days, unit: 'days' },
          { label: 'DSO', value: dso, unit: 'days', badge: 'NET' },
        ],
      }, { formula: this.formula, source: 'BSheet.xml + P&L.xml' });
    },
  },
  {
    id: 'WC3', domainId: 'D3', label: 'Top 10 debtors by outstanding amount',
    defaultStatus: 'partial', source: 'Bills + BS + DayBook', unit: 'INR',
    caveat: 'Bills.xml gives exact per-bill outstanding; BS / DayBook give closing balances only',
    remediation: 'Upload Bills.xml for precise debtor outstanding',
    formula: 'top 10 customer parties by outstanding amount',
    compute(ctx) {
      const pd = ctx.current.parsedData;
      const debtorParentRe = /sundry\s*debtor|trade\s*receiv|debtor|account\s*receiv|receivable/i;
      const breakdown: MetricBreakdownItem[] = [];
      let source: 'bills' | 'bs' | 'tb' | 'daybook' | 'none' = 'none';

      // 1) Bills.xml: most accurate — Tally's own outstanding per bill,
      //    aggregated to party totals.
      const receivableBills = (ctx.bills ?? []).filter(b => b.type === 'receivable');
      if (receivableBills.length > 0) {
        const byParty = new Map<string, number>();
        for (const b of receivableBills) {
          if (!b.party) continue;
          byParty.set(b.party, (byParty.get(b.party) ?? 0) + b.amount);
        }
        for (const [label, value] of byParty.entries()) {
          if (value > 0) breakdown.push({ label, value, unit: 'INR' });
        }
        if (breakdown.length > 0) source = 'bills';
      }

      // 2) Parsed BS rows — leaf ledgers under the Sundry Debtors / Trade
      //    Receivables group.  Used when Bills.xml absent.  Skip group
      //    rollup rows (masterType === 'group') so we don't double-count
      //    the group total alongside its child ledgers.
      if (breakdown.length === 0) {
        const bsRows = pd.bsheetRows ?? [];
        for (const r of bsRows) {
          if (!r.amount) continue;
          if (r.masterType === 'group') continue;
          if (debtorParentRe.test(r.parentGroup) || debtorParentRe.test(r.masterParent ?? '')) {
            breakdown.push({ label: r.name, value: Math.abs(r.amount), unit: 'INR' });
          }
        }
        if (breakdown.length > 0) source = 'bs';
      }

      // 3) Fallback: TB ledgers on the Dr side whose name reads like a
      //    debtor.  Sign convention is Dr-positive (closing > 0 = Dr).
      if (breakdown.length === 0) {
        const tb = pd.tbLedgers ?? [];
        for (const l of tb) {
          if (l.closing <= 0) continue;
          if (!/debtor|receivable|customer|client/i.test(l.name)) continue;
          breakdown.push({ label: l.name, value: l.closing, unit: 'INR' });
        }
        if (breakdown.length > 0) source = 'tb';
      }

      // 4) Final fallback: party turnover from DayBook (sales-voucher
      //    aggregated amounts per party).  Approximates outstanding only.
      if (breakdown.length === 0) {
        const cs = ctx.current.chunkedStats;
        if (cs && cs.custMap) {
          for (const [label, value] of Object.entries(cs.custMap)) {
            if (value > 0) breakdown.push({ label, value, unit: 'INR' });
          }
        }
        if (breakdown.length > 0) source = 'daybook';
      }

      if (breakdown.length === 0) return missingDataResult(this.id, 'No debtor data detected in Bills.xml, BS, TB or DayBook');

      breakdown.sort((a, b) => b.value - a.value);
      const top = breakdown.slice(0, 10);
      const total = top.reduce((s, b) => s + b.value, 0);
      const reasonBySource: Record<typeof source, string> = {
        bills: 'Per-bill outstanding from Bills.xml — exact aging needs due dates per bill',
        bs: 'Closing balances from Balance Sheet — exact aging needs Bills.xml',
        tb: 'Closing balances from Trial Balance — exact aging needs Bills.xml',
        daybook: 'Sales-voucher turnover per party (DayBook) — closing balance unavailable; upload Bills.xml or include party ledgers in BS for accurate outstanding',
        none: '',
      };
      return { id: this.id, status: source === 'bills' ? 'computed' : 'partial',
        value: { numeric: total, unit: 'INR', breakdown: top },
        reason: reasonBySource[source], formula: this.formula };
    },
  },
  {
    id: 'WC4', domainId: 'D3', label: 'Overdue debtors > 90 days as % of total',
    defaultStatus: 'auto', source: 'Bills.xml', unit: 'pct', direction: 'lower-better',
    remediation: 'Export Bills.xml from Tally',
    formula: 'sum(receivable bills > 90 days overdue) / total receivables × 100',
    compute(ctx) {
      const bills = (ctx.bills ?? []).filter(b => b.type === 'receivable');
      if (bills.length === 0) return missingDataResult(this.id, 'Bills.xml not uploaded — needs per-bill due dates');
      const asOf = periodAsOfDate(ctx.current);
      const { buckets, total } = agingBreakdown(bills, asOf);
      if (total === 0) return missingDataResult(this.id, 'No outstanding receivable bills');
      const over90 = buckets['90+'];
      const pct = (over90 / total) * 100;
      return computedResult(this.id, {
        numeric: pct, unit: 'pct',
        text: `${pct.toFixed(1)}% · ${fmtCompactINR(over90)} of ${fmtCompactINR(total)} over 90 days`,
        breakdown: agingBreakdownItems(buckets),
      }, { formula: this.formula, source: 'Bills.xml' });
    },
  },
  {
    id: 'WC5', domainId: 'D3', label: 'Collection efficiency %',
    defaultStatus: 'auto', source: 'DayBook', unit: 'pct', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(Receipt vouchers) / sum(Sales vouchers + opening debtors) × 100',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      const billed = cs.salesVoucherTotal + abs(ctx.prior?.parsedData.debtorBal);
      const collected = cs.receiptTotal;
      if (billed === 0) return missingDataResult(this.id, 'No sales billed');
      const eff = (collected / billed) * 100;
      return computedResult(this.id, { numeric: eff, unit: 'pct' }, { formula: this.formula, source: 'DayBook.xml' });
    },
  },
  {
    id: 'WC6', domainId: 'D3', label: 'Creditor aging: 0–30 / 31–60 / 61–90 / 90+ days',
    defaultStatus: 'auto', source: 'Bills.xml', unit: 'INR',
    remediation: 'Export Bills.xml from Tally (Payables)',
    formula: 'sum(outstanding payable bills) bucketed by days past due',
    compute(ctx) {
      const bills = (ctx.bills ?? []).filter(b => b.type === 'payable');
      if (bills.length === 0) {
        return missingDataResult(this.id, 'Payables.xml not uploaded — creditor aging needs per-bill due dates');
      }
      const asOf = periodAsOfDate(ctx.current);
      const { buckets, total } = agingBreakdown(bills, asOf);
      if (total === 0) return missingDataResult(this.id, 'No outstanding payable bills');
      const overdue = buckets['0–30'] + buckets['31–60'] + buckets['61–90'] + buckets['90+'];
      return computedResult(this.id, {
        numeric: total, unit: 'INR',
        text: `${fmtCompactINR(total)} · ${fmtCompactINR(overdue)} overdue / ${fmtCompactINR(buckets['90+'])} in 90+`,
        breakdown: agingBreakdownItems(buckets),
      }, { formula: this.formula, source: 'Bills.xml' });
    },
  },
  {
    id: 'WC7', domainId: 'D3', label: 'Days Payable Outstanding (DPO)',
    defaultStatus: 'auto', source: 'BSheet + P&L', unit: 'days', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: '(Creditors / Purchases) × period days',
    compute(ctx) {
      const creditors = abs(ctx.current.parsedData.creditorBal);
      const purchases = abs(ctx.current.parsedData.costOfMaterials);
      if (!creditors || !purchases) return missingDataResult(this.id, 'Creditors or purchases missing');
      const days = periodDays(ctx.current);
      const dpo = (creditors / purchases) * days;
      return computedResult(this.id, {
        numeric: dpo, unit: 'days', text: `${dpo.toFixed(0)} days`,
        breakdown: [
          { label: 'Sundry Creditors (BS closing)', value: creditors, unit: 'INR' },
          { label: '÷ Purchases (period)', value: purchases, unit: 'INR' },
          { label: '× Period days', value: days, unit: 'days' },
          { label: 'DPO', value: dpo, unit: 'days', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'WC8', domainId: 'D3', label: 'MSME supplier payments > 45 days',
    defaultStatus: 'partial', source: 'Bills.xml', unit: 'INR', direction: 'lower-better',
    caveat: 'MSME vendors must be tagged in Tally for an exact MSMED Act figure',
    remediation: 'Tag MSME vendors in Tally (Ledger → Statutory → MSME); shown figure covers ALL payables > 45 days',
    formula: 'sum(payable bills > 45 days past due)  — proxy for MSME exposure',
    compute(ctx) {
      const bills = (ctx.bills ?? []).filter(b => b.type === 'payable');
      if (bills.length === 0) {
        return missingDataResult(this.id, 'Payables.xml not uploaded — MSME 45-day check needs per-bill due dates');
      }
      const asOf = periodAsOfDate(ctx.current);
      let over45 = 0, total = 0;
      const offenders: MetricBreakdownItem[] = [];
      for (const b of bills) {
        total += b.amount;
        const days = billDaysOverdue(b, asOf);
        if (days != null && days > 45) {
          over45 += b.amount;
          offenders.push({ label: `${b.party || b.billRef} · ${days}d`, value: b.amount, unit: 'INR' });
        }
      }
      if (total === 0) return missingDataResult(this.id, 'No outstanding payable bills');
      offenders.sort((a, b) => b.value - a.value);
      // MSME-specific isolation isn't possible without vendor MSME tags, so
      // this is a `partial` proxy covering ALL payables aged > 45 days.
      return {
        id: this.id, status: 'partial',
        value: {
          numeric: over45, unit: 'INR',
          text: `${fmtCompactINR(over45)} · ${offenders.length} bill(s) past 45 days`,
          breakdown: offenders.slice(0, 10),
        },
        reason: 'Covers ALL payables > 45 days — MSME-specific isolation needs MSME vendor tagging in Tally',
        formula: this.formula,
      };
    },
  },
  {
    id: 'WC9', domainId: 'D3', label: 'Top 10 creditors by outstanding',
    defaultStatus: 'partial', source: 'Bills + BS + DayBook', unit: 'INR',
    caveat: 'Payables.xml gives exact per-bill outstanding; BS / TB give closing balances only',
    remediation: 'Upload Payables.xml for precise creditor outstanding',
    formula: 'top 10 vendor parties by outstanding amount',
    compute(ctx) {
      const pd = ctx.current.parsedData;
      const creditorParentRe = /sundry\s*creditor|trade\s*payable|creditor|account\s*payable|payable/i;
      const breakdown: MetricBreakdownItem[] = [];
      let source: 'bills' | 'bs' | 'tb' | 'daybook' | 'none' = 'none';

      // 1) Payables.xml: most accurate.
      const payableBills = (ctx.bills ?? []).filter(b => b.type === 'payable');
      if (payableBills.length > 0) {
        const byParty = new Map<string, number>();
        for (const b of payableBills) {
          if (!b.party) continue;
          byParty.set(b.party, (byParty.get(b.party) ?? 0) + b.amount);
        }
        for (const [label, value] of byParty.entries()) {
          if (value > 0) breakdown.push({ label, value, unit: 'INR' });
        }
        if (breakdown.length > 0) source = 'bills';
      }

      // 2) BS rows under Sundry Creditors / Trade Payables.
      if (breakdown.length === 0) {
        for (const r of pd.bsheetRows ?? []) {
          if (!r.amount) continue;
          if (r.masterType === 'group') continue;
          if (creditorParentRe.test(r.parentGroup) || creditorParentRe.test(r.masterParent ?? '')) {
            breakdown.push({ label: r.name, value: Math.abs(r.amount), unit: 'INR' });
          }
        }
        if (breakdown.length > 0) source = 'bs';
      }

      // 3) TB ledgers on the Cr side whose name reads like a creditor.
      //    Sign convention: creditors are Cr-natured → NEGATIVE closing in
      //    the canonical Dr-positive TB.  (The old `closing > 0` filter
      //    matched nothing here, same root-cause bug as WC3 had.)
      if (breakdown.length === 0) {
        for (const l of pd.tbLedgers ?? []) {
          if (l.closing >= 0) continue;
          if (!/creditor|payable|supplier|vendor/i.test(l.name)) continue;
          breakdown.push({ label: l.name, value: -l.closing, unit: 'INR' });
        }
        if (breakdown.length > 0) source = 'tb';
      }

      // 4) DayBook vendor turnover.
      if (breakdown.length === 0) {
        const cs = ctx.current.chunkedStats;
        if (cs && cs.vendMap) {
          for (const [label, value] of Object.entries(cs.vendMap)) {
            if (value > 0) breakdown.push({ label, value, unit: 'INR' });
          }
        }
        if (breakdown.length > 0) source = 'daybook';
      }

      if (breakdown.length === 0) return missingDataResult(this.id, 'No creditor data detected in Payables.xml, BS, TB or DayBook');

      breakdown.sort((a, b) => b.value - a.value);
      const top = breakdown.slice(0, 10);
      const total = top.reduce((s, b) => s + b.value, 0);
      const reasonBySource: Record<typeof source, string> = {
        bills: 'Per-bill outstanding from Payables.xml',
        bs: 'Closing balances from Balance Sheet — exact aging needs Payables.xml',
        tb: 'Closing balances from Trial Balance — exact aging needs Payables.xml',
        daybook: 'Purchase-voucher turnover per party (DayBook) — closing balance unavailable; upload Payables.xml or include vendor ledgers in BS for accurate outstanding',
        none: '',
      };
      return { id: this.id, status: source === 'bills' ? 'computed' : 'partial',
        value: { numeric: total, unit: 'INR', breakdown: top },
        reason: reasonBySource[source], formula: this.formula };
    },
  },
  {
    id: 'WC10', domainId: 'D3', label: 'Inventory days (DIO)',
    defaultStatus: 'auto', source: 'BSheet + P&L', unit: 'days', direction: 'lower-better',
    caveat: 'Closing stock must be entered in Tally',
    remediation: 'Enter closing stock value in Tally stock ledgers',
    formula: '(Closing Stock / COGS) × period days',
    compute(ctx) {
      const stock = abs(ctx.current.parsedData.closingStock ?? ctx.current.parsedData.plClosingStock);
      const cogs = cogsOf(ctx.current);
      if (!stock || !cogs) return missingDataResult(this.id, 'Closing stock or COGS missing');
      const days = periodDays(ctx.current);
      const dio = (stock / cogs) * days;
      return computedResult(this.id, {
        numeric: dio, unit: 'days', text: `${dio.toFixed(0)} days`,
        breakdown: [
          { label: 'Closing stock (BS / P&L)', value: stock, unit: 'INR' },
          { label: '÷ COGS (Opening + Purchases − Closing + Direct Exp)', value: cogs, unit: 'INR' },
          { label: '× Period days', value: days, unit: 'days' },
          { label: 'DIO', value: dio, unit: 'days', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'WC11', domainId: 'D3', label: 'Slow / non-moving stock (60/90/180 days)',
    defaultStatus: 'partial', source: 'DayBook',
    remediation: 'Enable stock movement tracking in Tally via stock items',
    formula: 'stock items with no movement in N days',
    compute() {
      return { id: 'WC11', status: 'partial', value: { text: 'Stock movement needs stock item details — partial coverage', unit: 'INR' }, reason: 'Stock item movement tracking required', formula: 'stock items with no movement in N days' };
    },
  },
  {
    id: 'WC12', domainId: 'D3', label: 'Cash conversion cycle (DSO + DIO − DPO)',
    defaultStatus: 'auto', source: 'Computed', unit: 'days', direction: 'lower-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'DSO + DIO − DPO',
    compute(ctx) {
      const dsoRes = D3_METRICS.find(m => m.id === 'WC2')!.compute(ctx);
      const dioRes = D3_METRICS.find(m => m.id === 'WC10')!.compute(ctx);
      const dpoRes = D3_METRICS.find(m => m.id === 'WC7')!.compute(ctx);
      const dso = dsoRes.value?.numeric;
      const dio = dioRes.value?.numeric;
      const dpo = dpoRes.value?.numeric;
      if (dso == null || dio == null || dpo == null) return missingDataResult(this.id, 'DSO / DIO / DPO unavailable');
      const ccc = dso + dio - dpo;
      return computedResult(this.id, {
        numeric: ccc, unit: 'days', text: `${ccc.toFixed(0)} days`,
        breakdown: [
          { label: 'DSO (Days Sales Outstanding)', value: dso, unit: 'days' },
          { label: '+ DIO (Days Inventory Outstanding)', value: dio, unit: 'days' },
          { label: '− DPO (Days Payable Outstanding)', value: -dpo, unit: 'days' },
          { label: 'Cash conversion cycle', value: ccc, unit: 'days', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
];

// ── DOMAIN 4: Statutory & compliance  (8 metrics) ────────────────────────

const D4_METRICS: MetricDef[] = [
  {
    id: 'SC1', domainId: 'D4', label: 'Output GST liability (CGST / SGST / IGST)',
    defaultStatus: 'auto', source: 'TrialBal', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(Output CGST/SGST/IGST ledger closing balances)',
    compute(ctx) {
      const v = num(ctx.current.parsedData.outputGSTAmt);
      if (v == null || v === 0) return missingDataResult(this.id, 'Output GST ledgers not detected in TB');
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      const buckets = { CGST: 0, SGST: 0, IGST: 0 };
      const ledgers: string[] = [];
      for (const l of tb) {
        if (!/output|liab/i.test(l.name)) continue;
        if (/cgst/i.test(l.name)) { buckets.CGST += abs(l.closing); ledgers.push(l.name); }
        else if (/sgst/i.test(l.name)) { buckets.SGST += abs(l.closing); ledgers.push(l.name); }
        else if (/igst/i.test(l.name)) { buckets.IGST += abs(l.closing); ledgers.push(l.name); }
      }
      const breakdown = Object.entries(buckets).filter(([, x]) => x > 0).map(([label, value]) => ({ label, value, unit: 'INR' as const }));
      return computedResult(this.id, { numeric: v, unit: 'INR', breakdown }, { formula: this.formula, source: 'TrialBal.xml', ledgers });
    },
  },
  {
    id: 'SC2', domainId: 'D4', label: 'Input ITC available vs utilised',
    defaultStatus: 'auto', source: 'TrialBal', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(Input CGST/SGST/IGST ledger balances)',
    compute(ctx) {
      const v = num(ctx.current.parsedData.inputITCAmt);
      if (v == null || v === 0) return missingDataResult(this.id, 'Input ITC ledgers not detected in TB');
      return computedResult(this.id, { numeric: v, unit: 'INR' }, { formula: this.formula, source: 'TrialBal.xml' });
    },
  },
  {
    id: 'SC3', domainId: 'D4', label: 'Net GST payable (Output − ITC)',
    defaultStatus: 'auto', source: 'TrialBal', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'Output GST − Input ITC',
    compute(ctx) {
      const out = num(ctx.current.parsedData.outputGSTAmt);
      const inp = num(ctx.current.parsedData.inputITCAmt);
      if (out == null && inp == null) return missingDataResult(this.id, 'GST ledgers not detected');
      const net = (out ?? 0) - (inp ?? 0);
      return computedResult(this.id, { numeric: net, unit: 'INR' }, { formula: this.formula });
    },
  },
  {
    id: 'SC4', domainId: 'D4', label: 'TDS deducted section-wise (194C / 194J…)',
    defaultStatus: 'auto', source: 'DayBook + TrialBal', unit: 'INR',
    caveat: 'TDS ledgers must be named by section in Tally',
    remediation: 'Rename TDS ledgers to include section number (e.g. TDS 194C)',
    formula: 'group(TB TDS ledgers by section regex)',
    compute(ctx) {
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      const sections: Record<string, number> = {};
      const ledgers: string[] = [];
      for (const l of tb) {
        if (!/tds/i.test(l.name)) continue;
        const m = /19[0-9][a-z]/i.exec(l.name);
        const section = m ? m[0].toUpperCase() : 'Unspecified';
        sections[section] = (sections[section] ?? 0) + abs(l.closing);
        ledgers.push(l.name);
      }
      const entries = Object.entries(sections);
      if (entries.length === 0) return missingDataResult(this.id, 'No TDS ledgers detected in TB');
      const breakdown = entries.sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, unit: 'INR' as const }));
      const total = breakdown.reduce((s, b) => s + b.value, 0);
      return computedResult(this.id, { numeric: total, unit: 'INR', breakdown }, { formula: this.formula, ledgers });
    },
  },
  {
    id: 'SC5', domainId: 'D4', label: 'TDS deposited vs due (by 7th of month)',
    defaultStatus: 'partial', source: 'DayBook', unit: 'INR',
    caveat: 'Deposit vouchers must be tagged to challan ledger',
    remediation: 'Tag TDS deposit vouchers to a dedicated challan ledger',
    formula: 'sum(TDS payment vouchers) vs sum(TDS deducted)',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      let deposited = 0;
      for (const v of cs.vouchers) {
        if (!/payment/i.test(v.type)) continue;
        if (v.narration && /tds|challan/i.test(v.narration)) deposited += Math.abs(v.amount);
        else if (v.legs?.some(l => /tds/i.test(l.name))) deposited += Math.abs(v.amount);
      }
      const due = abs(ctx.current.parsedData.tdsPayableAmt);
      return { id: this.id, status: 'partial', value: {
        numeric: deposited, unit: 'INR',
        breakdown: [
          { label: 'Deposited', value: deposited, unit: 'INR' },
          { label: 'TDS Payable (due)', value: due, unit: 'INR' },
        ],
      }, reason: 'Detection by narration & ledger name — tag deposit vouchers for precise match', formula: this.formula };
    },
  },
  {
    id: 'SC6', domainId: 'D4', label: 'Advance tax paid vs liability estimate',
    defaultStatus: 'partial', source: 'DayBook', unit: 'INR',
    remediation: 'Enter advance tax payment vouchers in Tally',
    formula: 'Sum(advance tax vouchers) vs (PAT × 25% × 4 quarter rate)',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      let paid = 0;
      for (const v of cs.vouchers) {
        if (/payment/i.test(v.type) && /advance.*tax|income.*tax/i.test(v.narration ?? '')) {
          paid += Math.abs(v.amount);
        }
      }
      const pat = netProfitOf(ctx.current);
      const liability = pat ? Math.max(0, pat * 0.25) : 0;
      return { id: this.id, status: 'partial', value: {
        numeric: paid, unit: 'INR',
        breakdown: [
          { label: 'Paid', value: paid, unit: 'INR' },
          { label: 'Estimated liability', value: liability, unit: 'INR' },
        ],
      }, reason: 'Detection by narration; estimate uses 25% of PAT', formula: this.formula };
    },
  },
  {
    id: 'SC7', domainId: 'D4', label: 'PF / ESI deducted and deposited',
    defaultStatus: 'auto', source: 'DayBook + TB', unit: 'INR',
    caveat: 'PF/ESI ledgers must be correctly named',
    remediation: 'Name ledgers with "PF" or "ESI" keywords in Tally',
    formula: 'sum(PF/ESI ledgers in TB)',
    compute(ctx) {
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      let pf = 0, esi = 0;
      const ledgers: string[] = [];
      for (const l of tb) {
        if (/\bpf\b|provident.*fund/i.test(l.name)) { pf += abs(l.closing); ledgers.push(l.name); }
        if (/\besi\b|employees.*state/i.test(l.name)) { esi += abs(l.closing); ledgers.push(l.name); }
      }
      const total = pf + esi;
      if (total === 0) return missingDataResult(this.id, 'No PF/ESI ledgers detected');
      return computedResult(this.id, { numeric: total, unit: 'INR', breakdown: [
        { label: 'PF', value: pf, unit: 'INR' },
        { label: 'ESI', value: esi, unit: 'INR' },
      ] }, { formula: this.formula, ledgers });
    },
  },
  {
    id: 'SC8', domainId: 'D4', label: 'Professional Tax deducted & deposited',
    defaultStatus: 'partial', source: 'DayBook', unit: 'INR',
    remediation: 'Create consistent Professional Tax ledger naming',
    formula: 'sum(PT ledgers in TB)',
    compute(ctx) {
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      let pt = 0;
      const ledgers: string[] = [];
      for (const l of tb) {
        if (/professional.*tax|\bpt\b/i.test(l.name)) { pt += abs(l.closing); ledgers.push(l.name); }
      }
      if (pt === 0) return missingDataResult(this.id, 'No PT ledger detected');
      return { id: this.id, status: 'partial', value: { numeric: pt, unit: 'INR' }, reason: 'State-specific — naming convention needed', formula: this.formula, ledgers };
    },
  },
];

// ── DOMAIN 5: Balance sheet health  (10 metrics) ─────────────────────────

const D5_METRICS: MetricDef[] = [
  {
    id: 'BS1', domainId: 'D5', label: 'Current ratio',
    defaultStatus: 'auto', source: 'BSheet', unit: 'ratio', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'Current Assets / Current Liabilities',
    compute(ctx) {
      const ca = abs(ctx.current.parsedData.ca);
      const cl = abs(ctx.current.parsedData.cl);
      if (!ca || !cl) return missingDataResult(this.id, 'Current Assets / Liabilities not parsed');
      const cr = ca / cl;
      return computedResult(this.id, {
        numeric: cr, unit: 'ratio', text: `${cr.toFixed(2)}×`,
        breakdown: [
          { label: 'Current Assets', value: ca, unit: 'INR' },
          { label: '÷ Current Liabilities', value: cl, unit: 'INR' },
          { label: 'Current ratio', value: cr, unit: 'ratio', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'BS2', domainId: 'D5', label: 'Quick ratio (acid test)',
    defaultStatus: 'auto', source: 'BSheet', unit: 'ratio', direction: 'higher-better',
    caveat: 'Inventory must be a separate BS line',
    remediation: 'Ensure stock is a separate BS group in Tally',
    formula: '(Current Assets − Inventory) / Current Liabilities',
    compute(ctx) {
      const ca = abs(ctx.current.parsedData.ca);
      const cl = abs(ctx.current.parsedData.cl);
      const stock = abs(ctx.current.parsedData.closingStock);
      if (!ca || !cl) return missingDataResult(this.id, 'CA/CL missing');
      const quickAssets = ca - stock;
      const qr = quickAssets / cl;
      return computedResult(this.id, {
        numeric: qr, unit: 'ratio', text: `${qr.toFixed(2)}×`,
        breakdown: [
          { label: 'Current Assets', value: ca, unit: 'INR' },
          { label: '− Inventory (Closing Stock)', value: -stock, unit: 'INR' },
          { label: 'Quick assets', value: quickAssets, unit: 'INR' },
          { label: '÷ Current Liabilities', value: cl, unit: 'INR' },
          { label: 'Quick ratio', value: qr, unit: 'ratio', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'BS3', domainId: 'D5', label: 'Cash ratio',
    defaultStatus: 'auto', source: 'BSheet', unit: 'ratio', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: '(Cash + Bank) / Current Liabilities',
    compute(ctx) {
      const cash = abs(ctx.current.parsedData.bsCashBankTotal);
      const cl = abs(ctx.current.parsedData.cl);
      if (!cl) return missingDataResult(this.id, 'CL missing');
      const ratio = cash / cl;
      return computedResult(this.id, {
        numeric: ratio, unit: 'ratio', text: `${ratio.toFixed(2)}×`,
        breakdown: [
          { label: 'Cash + Bank (BS closing)', value: cash, unit: 'INR' },
          { label: '÷ Current Liabilities', value: cl, unit: 'INR' },
          { label: 'Cash ratio', value: ratio, unit: 'ratio', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'BS4', domainId: 'D5', label: 'Debt-equity ratio',
    defaultStatus: 'auto', source: 'BSheet', unit: 'ratio', direction: 'lower-better',
    caveat: 'All loan accounts must be under Loans & Liabilities',
    remediation: 'Ensure all loans are grouped under "Loans (Liabilities)" in Tally',
    formula: 'Total Debt / Net Worth',
    compute(ctx) {
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      // Loans / borrowings are Cr-natured liabilities → NEGATIVE closing in
      // the canonical Dr-positive convention.  `-l.closing` reads the
      // outstanding magnitude.  (The old `closing > 0` filter matched
      // nothing, so debt always came back 0.)
      let debt = 0;
      const debtLedgers: string[] = [];
      for (const l of tb) {
        if (/loan|borrowing|debenture|term\s*loan|cc\s*a\/c|cc\s*account|od\s*account|bank\s*od|overdraft/i.test(l.name)
            && l.closing < 0) {
          debt += -l.closing;
          debtLedgers.push(l.name);
        }
      }
      const equity = netWorthOf(ctx.current);
      if (equity == null || equity === 0) return missingDataResult(this.id, 'Equity / Capital ledgers not detected');
      const de = debt / equity;
      return computedResult(this.id, {
        numeric: de, unit: 'ratio',
        text: `${de.toFixed(2)}×  ·  Debt ${fmtCompactINR(debt)} / Equity ${fmtCompactINR(equity)}`,
        breakdown: [
          { label: `Total Debt (${debtLedgers.length} loan ledger${debtLedgers.length === 1 ? '' : 's'})`, value: debt, unit: 'INR' },
          { label: '÷ Net Worth (Capital + Reserves + Retained P&L − Drawings)', value: equity, unit: 'INR' },
          { label: 'Debt-Equity', value: de, unit: 'ratio', badge: 'NET' },
        ],
      }, { formula: this.formula, ledgers: debtLedgers.length ? debtLedgers : undefined });
    },
  },
  {
    id: 'BS5', domainId: 'D5', label: 'Interest coverage ratio',
    defaultStatus: 'auto', source: 'P&L + BSheet', unit: 'ratio', direction: 'higher-better',
    caveat: 'Interest expense must be separate P&L line',
    remediation: 'Create a dedicated Interest Expense ledger in Tally',
    formula: 'EBIT / Interest expense',
    compute(ctx) {
      const ebitda = ebitdaOf(ctx.current);
      const dep = depreciationOf(ctx.current);
      const interest = interestExpenseOf(ctx.current);
      if (ebitda == null) return missingDataResult(this.id, 'EBITDA unavailable');
      if (interest === 0) return missingDataResult(this.id, 'Interest expense ledger not detected');
      const ebit = ebitda - dep;
      const cover = ebit / interest;
      return computedResult(this.id, {
        numeric: cover, unit: 'ratio', text: `${cover.toFixed(2)}×`,
        breakdown: [
          { label: 'EBITDA (Net Profit + Interest + Depreciation)', value: ebitda, unit: 'INR' },
          { label: '− Depreciation', value: -dep, unit: 'INR' },
          { label: 'EBIT', value: ebit, unit: 'INR' },
          { label: '÷ Interest expense', value: interest, unit: 'INR' },
          { label: 'Interest coverage', value: cover, unit: 'ratio', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'BS6', domainId: 'D5', label: 'Net worth movement (period vs prior)',
    defaultStatus: 'auto', source: 'BSheet + P&L', unit: 'INR',
    remediation: 'Computable from uploaded XMLs (prior-period BS sharpens the opening figure)',
    formula: 'Closing NW = Opening NW + PAT − Drawings;  Opening = Closing − PAT + Drawings',
    compute(ctx) {
      const nw = netWorthOf(ctx.current);
      if (nw == null) return missingDataResult(this.id, 'Capital / reserves not detected');
      const pat = netProfitOf(ctx.current) ?? 0;
      const drawings = drawingsOf(ctx.current);
      const priorNW = ctx.prior ? netWorthOf(ctx.prior) : null;
      // Opening net worth: prior period's closing when available, else
      // unwound from the current period — Opening = Closing − PAT + Drawings.
      const openingNW = priorNW != null ? priorNW : (nw - pat + drawings);
      const movement = nw - openingNW;
      const breakdown: MetricBreakdownItem[] = [
        { label: 'Opening net worth', value: openingNW, unit: 'INR' },
        { label: 'PAT added', value: pat, unit: 'INR' },
        { label: 'Drawings / dividends', value: -drawings, unit: 'INR' },
        { label: 'Closing net worth', value: nw, unit: 'INR' },
      ];
      return {
        id: this.id,
        status: priorNW != null ? 'computed' : 'partial',
        value: {
          numeric: movement, unit: 'INR',
          text: `${fmtCompactINR(movement)} · Opening ${fmtCompactINR(openingNW)} → Closing ${fmtCompactINR(nw)}`,
          breakdown,
        },
        reason: priorNW != null
          ? undefined
          : 'Opening net worth derived from this period (Closing − PAT + Drawings) — upload a prior-period Balance Sheet for an exact opening figure',
        formula: this.formula,
      };
    },
  },
  {
    id: 'BS7', domainId: 'D5', label: 'Term loan drawing power vs limit',
    defaultStatus: 'manual', source: 'Manual', unit: 'pct',
    remediation: 'Enter loan sanction limit in Setup screen',
    formula: 'Outstanding / Sanctioned limit × 100',
    compute(ctx) {
      const limit = ctx.manual.drawingPowerLimit;
      if (!limit) return manualRequiredResult(this.id, 'Sanctioned limit not entered in Setup');
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      // Loan ledgers are Cr-natured liabilities → NEGATIVE closing.
      const outstanding = tb
        .filter(l => /term\s*loan|loan.*sanctioned|cc\s*a\/c|cc\s*account|od\s*account|bank\s*od/i.test(l.name) && l.closing < 0)
        .reduce((s, l) => s + (-l.closing), 0);
      if (!outstanding) return missingDataResult(this.id, 'No loan ledgers detected');
      return computedResult(this.id, { numeric: (outstanding / limit) * 100, unit: 'pct' }, { formula: this.formula });
    },
  },
  {
    id: 'BS8', domainId: 'D5', label: 'Fixed asset additions this month',
    defaultStatus: 'auto', source: 'BSheet + DayBook', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'Δ Fixed Assets between periods',
    compute(ctx) {
      if (!ctx.prior) return { id: this.id, status: 'partial', value: { text: 'Need prior period BS', unit: 'INR' }, reason: 'Additions need a prior period for Δ', formula: this.formula };
      const delta = abs(ctx.current.parsedData.fixedAssets) - abs(ctx.prior.parsedData.fixedAssets);
      const additions = delta + depreciationOf(ctx.current);
      return computedResult(this.id, { numeric: Math.max(0, additions), unit: 'INR' }, { formula: this.formula });
    },
  },
  {
    id: 'BS9', domainId: 'D5', label: 'Depreciation charged this month',
    defaultStatus: 'auto', source: 'P&L', unit: 'INR',
    caveat: 'Depreciation must be a separate P&L line',
    remediation: 'Create a dedicated Depreciation ledger in Tally',
    formula: 'sum(Depreciation ledger movement)',
    compute(ctx) {
      const dep = depreciationOf(ctx.current);
      if (!ctx.current.parsedData.depFound) return missingDataResult(this.id, 'Depreciation ledger not found');
      return computedResult(this.id, { numeric: dep, unit: 'INR' }, { formula: this.formula });
    },
  },
  {
    id: 'BS10', domainId: 'D5', label: 'Investments on BS (type + value)',
    defaultStatus: 'auto', source: 'BSheet', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(Investment / FD / Equity-holdings ledgers)',
    compute(ctx) {
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      const invs = tb.filter(l => /investment|fixed deposit|\bfd\b|mutual fund|shares|equity holding/i.test(l.name));
      if (invs.length === 0) return missingDataResult(this.id, 'No investment ledgers detected');
      const breakdown = invs.map(l => ({ label: l.name, value: abs(l.closing), unit: 'INR' as const })).sort((a, b) => b.value - a.value);
      const total = breakdown.reduce((s, b) => s + b.value, 0);
      return computedResult(this.id, { numeric: total, unit: 'INR', breakdown }, { formula: this.formula, source: 'BSheet.xml + TB.xml' });
    },
  },
];

// ── DOMAIN 6: Cost analysis  (10 metrics) ────────────────────────────────

const D6_METRICS: MetricDef[] = [
  {
    id: 'CA1', domainId: 'D6', label: 'Cost as % of revenue — every P&L line',
    defaultStatus: 'auto', source: 'P&L', unit: 'pct',
    remediation: 'Computable from uploaded XMLs',
    formula: 'cost line / revenue × 100',
    compute(ctx) {
      const r = revenueOf(ctx.current);
      if (r == null || r === 0) return missingDataResult(this.id, 'Revenue missing');
      const plSections = ctx.current.parsedData.plSections ?? [];
      const breakdown: MetricBreakdownItem[] = [];
      // Flatten section children for line-by-line %.  Only pick expense
      // sections (purchase, direct/indirect expenses, cost-of-sales).
      for (const s of plSections) {
        if (!/expense|cost|purchase|stock|outstanding/i.test(s.name)) continue;
        for (const c of s.children) {
          const amt = Math.abs(c.amount);
          if (amt < 1) continue;
          breakdown.push({ label: c.name, value: (amt / r) * 100, unit: 'pct' });
        }
        if (s.children.length === 0 && Math.abs(s.total) > 0) {
          breakdown.push({ label: s.name, value: (Math.abs(s.total) / r) * 100, unit: 'pct' });
        }
      }
      if (breakdown.length === 0) {
        // Fall back to TB expense ledgers — must be classified as a P&L
        // expense (master-driven), not just name-match.  In the canonical
        // Dr-positive TB convention, expenses are POSITIVE; the old
        // `closing < 0` filter was matching Cr-side liabilities instead
        // of Dr-side expenses.
        const tb = ctx.current.parsedData.tbLedgers ?? [];
        const exp = tb
          .filter(l => {
            const cat = categoryOf(ctx.current, l.name);
            return (cat === 'indirect-expense' || cat === 'direct-expense' || cat === 'purchase') && abs(l.closing) > 0;
          })
          .sort((a, b) => abs(b.closing) - abs(a.closing))
          .slice(0, 12);
        if (exp.length === 0) return missingDataResult(this.id, 'No P&L sections or expense ledgers found');
        breakdown.push(...exp.map(l => ({ label: l.name, value: (abs(l.closing) / r) * 100, unit: 'pct' as const })));
      }
      breakdown.sort((a, b) => b.value - a.value);
      return computedResult(this.id, { breakdown: breakdown.slice(0, 15), unit: 'pct' }, { formula: this.formula });
    },
  },
  {
    id: 'CA2', domainId: 'D6', label: 'Fixed vs variable cost split',
    defaultStatus: 'partial', source: 'P&L', unit: 'INR',
    caveat: 'Fixed/variable tagging needs cost centre config in Tally',
    remediation: 'Configure cost centres in Tally for fixed vs variable costs',
    formula: 'Heuristic: COGS + marketing = variable;  rest = fixed',
    compute(ctx) {
      const variable = cogsOf(ctx.current);
      const r = revenueOf(ctx.current) ?? 0;
      const exp = expensesOf(ctx.current) ?? 0;
      const fixed = Math.max(0, exp - variable);
      return { id: this.id, status: 'partial', value: {
        unit: 'INR',
        breakdown: [
          { label: 'Variable (COGS proxy)', value: variable, unit: 'INR', secondary: r ? (variable / r) * 100 : undefined },
          { label: 'Fixed (remaining)', value: fixed, unit: 'INR', secondary: r ? (fixed / r) * 100 : undefined },
        ],
      }, reason: 'Heuristic split — cost centre tagging needed for precise classification', formula: this.formula };
    },
  },
  {
    id: 'CA3', domainId: 'D6', label: 'Break-even revenue',
    defaultStatus: 'partial', source: 'P&L', unit: 'INR', direction: 'lower-better',
    remediation: 'Requires fixed/variable cost split (see CA2)',
    formula: 'Fixed costs / Contribution margin %',
    compute(ctx) {
      const r = revenueOf(ctx.current);
      const variable = cogsOf(ctx.current);
      const exp = expensesOf(ctx.current) ?? 0;
      const fixed = Math.max(0, exp - variable);
      if (r == null || r === 0) return missingDataResult(this.id, 'Revenue missing');
      const contribMarginPct = (r - variable) / r;
      if (contribMarginPct <= 0) return missingDataResult(this.id, 'Negative contribution margin');
      return { id: this.id, status: 'partial', value: { numeric: fixed / contribMarginPct, unit: 'INR' }, reason: 'Fixed/variable split is heuristic', formula: this.formula };
    },
  },
  {
    id: 'CA4', domainId: 'D6', label: 'Operating leverage',
    defaultStatus: 'partial', source: 'P&L (multi)', unit: 'ratio',
    remediation: 'Upload 2+ months of P&L XMLs',
    formula: '% Δ EBITDA / % Δ Revenue',
    compute(ctx) {
      // Resolve current/prior — prefer real prior, else last two monthly slices.
      let cur: Period | undefined = ctx.current;
      let prev: Period | undefined = ctx.prior;
      if (!prev && ctx.monthlyPeriods && ctx.monthlyPeriods.length >= 2) {
        cur = ctx.monthlyPeriods[ctx.monthlyPeriods.length - 1];
        prev = ctx.monthlyPeriods[ctx.monthlyPeriods.length - 2];
      }
      if (!prev) return { id: this.id, status: 'partial', value: { text: 'Need 2+ periods', unit: 'ratio' }, reason: 'Operating leverage requires MoM data', formula: this.formula };
      const rNow = revenueOf(cur!), rPrev = revenueOf(prev);
      const eNow = ebitdaOf(cur!), ePrev = ebitdaOf(prev);
      if (rNow == null || rPrev == null || eNow == null || ePrev == null || rPrev === 0 || ePrev === 0) return missingDataResult(this.id, 'Period data incomplete');
      const dRev = (rNow - rPrev) / rPrev;
      const dEbi = (eNow - ePrev) / Math.abs(ePrev);
      if (dRev === 0) return missingDataResult(this.id, 'Zero revenue change');
      return computedResult(this.id, { numeric: dEbi / dRev, unit: 'ratio' }, { formula: this.formula });
    },
  },
  {
    id: 'CA5', domainId: 'D6', label: 'Departmental cost breakdowns',
    defaultStatus: 'partial', source: 'DayBook', unit: 'INR',
    caveat: 'Cost centres must be configured in Tally',
    remediation: 'Enable cost centres in Tally and tag expenses to departments',
    formula: 'group(expenses by cost centre)',
    compute() {
      return { id: 'CA5', status: 'partial', value: { text: 'Cost centre data not parsed', unit: 'INR' }, reason: 'Cost centre parser not wired yet', formula: 'group(expenses by cost centre)' };
    },
  },
  {
    id: 'CA6', domainId: 'D6', label: 'Employee cost per head',
    defaultStatus: 'partial', source: 'TB + Manual', unit: 'INR', direction: 'neutral',
    remediation: 'Enter headcount in Setup; cost extracted from P&L salary ledger',
    formula: 'salary expense (period) ÷ headcount ÷ period months',
    compute(ctx) {
      const tb = ctx.current.parsedData.tbLedgers ?? [];
      // Two-stage filter — master classification first (ledger must sit
      // under Indirect / Direct Expenses), THEN name-pattern.  The old
      // implementation summed every ledger whose name matched the regex
      // — which silently included "Salary Payable" / "Wages Outstanding"
      // (Cr liabilities) alongside the actual P&L salary line, doubling
      // the cost.
      let salary = 0;
      const ledgers: string[] = [];
      for (const l of tb) {
        const cat = categoryOf(ctx.current, l.name);
        if (cat !== 'indirect-expense' && cat !== 'direct-expense') continue;
        if (!/salary|wages|payroll|staff\s*welfare|bonus\s*paid/i.test(l.name)) continue;
        if (/payable|outstanding|provision|due/i.test(l.name)) continue;
        salary += abs(l.closing);
        ledgers.push(l.name);
      }
      if (!salary) return missingDataResult(this.id, 'No P&L salary expense ledger detected (need a ledger under Indirect / Direct Expenses with "Salary" / "Wages" in the name)');

      const months = periodMonths(ctx.current);
      const hc = ctx.manual.headcount;
      // Build a full working breakdown so the Backup view shows the math.
      const baseBreakdown: MetricBreakdownItem[] = [
        { label: `Salary / wages expense (period total — ${ledgers.length} ledger${ledgers.length === 1 ? '' : 's'})`,
          value: salary, unit: 'INR' },
        { label: '÷ Period months', value: months, unit: 'count' },
        { label: 'Salary expense per month', value: salary / months, unit: 'INR' },
      ];
      if (!hc) {
        return {
          id: this.id, status: 'partial',
          value: {
            numeric: salary / months,
            unit: 'INR',
            text: `${fmtCompactINR(salary / months)} / month total · headcount needed for per-head`,
            breakdown: baseBreakdown,
          },
          reason: 'Headcount not entered in Setup — enter the team size to compute per-head cost',
          formula: this.formula,
          ledgers,
        };
      }
      const perHeadPeriod = salary / hc;
      const perHeadMonth = perHeadPeriod / months;
      const breakdown: MetricBreakdownItem[] = [
        ...baseBreakdown,
        { label: `÷ Headcount`, value: hc, unit: 'count' },
        { label: 'Per head, per period', value: perHeadPeriod, unit: 'INR' },
        { label: 'Per head, per month', value: perHeadMonth, unit: 'INR', badge: 'NET' },
      ];
      return computedResult(this.id, {
        numeric: perHeadMonth, unit: 'INR',
        text: `${fmtCompactINR(perHeadMonth)} / head / month · ${fmtCompactINR(perHeadPeriod)} / head / period`,
        breakdown,
      }, { formula: this.formula, source: 'TrialBal.xml + Master.xml + Setup', ledgers });
    },
  },
  {
    id: 'CA7', domainId: 'D6', label: 'Cost per unit produced / delivered',
    defaultStatus: 'manual', source: 'Manual', unit: 'INR',
    remediation: 'Enter production quantity in Setup screen',
    formula: 'Total cost / units produced',
    compute(ctx) {
      const qty = ctx.manual.productionQty;
      if (!qty) return manualRequiredResult(this.id, 'Production qty not entered');
      const exp = expensesOf(ctx.current);
      const cogs = cogsOf(ctx.current);
      const totalCost = (exp ?? 0) + cogs;
      return computedResult(this.id, { numeric: totalCost / qty, unit: 'INR' }, { formula: this.formula });
    },
  },
  {
    id: 'CA8', domainId: 'D6', label: 'Budget vs actual for every cost head',
    defaultStatus: 'manual', source: 'Budget upload', unit: 'pct',
    remediation: 'Upload budget Excel file in Setup',
    formula: '(actual − budget) / budget × 100',
    compute(ctx) {
      if (!ctx.budget) return manualRequiredResult(this.id, 'Budget not uploaded');
      const out: MetricBreakdownItem[] = [];
      const pairs: Array<[string, number | undefined, number]> = [
        ['Revenue', ctx.budget.revenue, revenueOf(ctx.current) ?? 0],
        ['COGS', ctx.budget.cogs, cogsOf(ctx.current)],
        ['Employee Cost', ctx.budget.employeeCost, 0],
        ['Marketing', ctx.budget.marketing, 0],
        ['Admin', ctx.budget.admin, 0],
        ['Depreciation', ctx.budget.depreciation, depreciationOf(ctx.current)],
        ['Interest', ctx.budget.interest, interestExpenseOf(ctx.current)],
        ['PAT', ctx.budget.pat, netProfitOf(ctx.current) ?? 0],
      ];
      for (const [label, b, a] of pairs) {
        if (b == null || b === 0) continue;
        out.push({ label, value: ((a - b) / b) * 100, unit: 'pct' });
      }
      if (out.length === 0) return manualRequiredResult(this.id, 'No budget line items provided');
      return computedResult(this.id, { breakdown: out, unit: 'pct' }, { formula: this.formula });
    },
  },
  {
    id: 'CA9', domainId: 'D6', label: 'MoM cost movement by line',
    defaultStatus: 'partial', source: 'P&L (multi)', unit: 'pct',
    remediation: 'Upload 2+ months of P&L XMLs',
    formula: '(curr line − prior line) / prior line × 100',
    compute(ctx) {
      if (!ctx.prior) return { id: this.id, status: 'partial', value: { text: 'Need 2+ periods', unit: 'pct' }, reason: 'MoM movement needs prior period', formula: this.formula };
      const curr = ctx.current.parsedData.plSections ?? [];
      const prev = ctx.prior.parsedData.plSections ?? [];
      // Flatten children across all sections so we compare leaf-line amounts.
      const flat = (secs: typeof curr) => {
        const m = new Map<string, number>();
        for (const s of secs) {
          for (const c of s.children) m.set(c.name, (m.get(c.name) ?? 0) + Math.abs(c.amount));
          if (s.children.length === 0) m.set(s.name, Math.abs(s.total));
        }
        return m;
      };
      const prevMap = flat(prev);
      const out: MetricBreakdownItem[] = [];
      for (const [name, a] of flat(curr).entries()) {
        const p = prevMap.get(name);
        if (!p) continue;
        out.push({ label: name, value: ((a - p) / p) * 100, unit: 'pct' });
      }
      if (out.length === 0) return missingDataResult(this.id, 'No matching P&L sections across periods');
      return computedResult(this.id, { breakdown: out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)), unit: 'pct' }, { formula: this.formula });
    },
  },
  {
    id: 'CA10', domainId: 'D6', label: 'One-time / non-recurring items isolated',
    defaultStatus: 'partial', source: 'DayBook', unit: 'INR',
    remediation: 'Flag non-recurring vouchers in the Setup screen',
    formula: 'sum(vouchers user flagged as non-recurring)',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      const flagged = new Set(ctx.manual.nonRecurringVoucherIds ?? []);
      if (flagged.size === 0) return manualRequiredResult(this.id, 'No vouchers flagged as non-recurring in Setup');
      let total = 0;
      for (const v of cs.vouchers) {
        if (flagged.has(v.vno)) total += Math.abs(v.amount);
      }
      return computedResult(this.id, { numeric: total, unit: 'INR' }, { formula: this.formula });
    },
  },
];

// ── DOMAIN 7: Business performance indicators  (13 metrics) ──────────────

const D7_METRICS: MetricDef[] = [
  {
    id: 'BPI1', domainId: 'D7', label: 'Sales by customer — top 10 & concentration %',
    defaultStatus: 'auto', source: 'DayBook', unit: 'INR',
    remediation: 'Computable from uploaded XMLs',
    formula: 'top 10 customers by sales voucher PARTYLEDGERNAME',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      const entries = [...Object.entries(cs.custMap)].sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) return missingDataResult(this.id, 'No customer party data');
      const total = entries.reduce((s, [, v]) => s + v, 0);
      const top10 = entries.slice(0, 10);
      const top3 = top10.slice(0, 3).reduce((s, [, v]) => s + v, 0);
      const breakdown = top10.map(([label, value]) => ({ label, value, secondary: total ? (value / total) * 100 : 0, unit: 'INR' as const }));
      const concentrationPct = total ? (top3 / total) * 100 : 0;
      return computedResult(this.id, {
        numeric: concentrationPct, unit: 'pct',
        text: `Top 3: ${concentrationPct.toFixed(1)}%`,
        breakdown,
      }, { formula: this.formula });
    },
  },
  {
    id: 'BPI2', domainId: 'D7', label: 'Sales by product / SKU',
    defaultStatus: 'partial', source: 'P&L Sales group children', unit: 'INR',
    caveat: 'True SKU-level split needs Tally stock items; this falls back to revenue-ledger split',
    remediation: 'Use stock items in Tally sales vouchers for per-SKU detail; otherwise create separate revenue ledgers per product',
    formula: 'children of "Sales Accounts" P&L group (ledger-level proxy when stock items unavailable)',
    compute(ctx) {
      // Stock-item parsing isn't wired into chunkedStats — but the P&L
      // "Sales Accounts" section's children give a ledger-level breakdown
      // which approximates per-SKU split when the user has separate
      // revenue ledgers per product line (e.g. "Sales - Mobile",
      // "Sales - Accessories").  Better than the previous blank stub.
      const plSections = ctx.current.parsedData.plSections ?? [];
      const breakdown: MetricBreakdownItem[] = [];
      for (const sec of plSections) {
        const nl = sec.name.toLowerCase();
        if (!/sale|revenue|turnover/.test(nl) || /cost of sales/.test(nl) || nl.trim().endsWith(':')) continue;
        for (const ch of sec.children) {
          const amt = Math.abs(ch.amount);
          if (amt > 0) breakdown.push({ label: ch.name, value: amt, unit: 'INR' });
        }
      }
      if (breakdown.length === 0) return missingDataResult(this.id, 'No Sales-group children found in P&L — upload P&L with separate revenue ledgers, or enable stock items in Tally');
      breakdown.sort((a, b) => b.value - a.value);
      const total = breakdown.reduce((s, b) => s + b.value, 0);
      return {
        id: this.id, status: 'partial',
        value: {
          numeric: total, unit: 'INR',
          text: `${breakdown.length} revenue ledger${breakdown.length === 1 ? '' : 's'} (ledger-level proxy)`,
          breakdown,
        },
        reason: 'Ledger-level proxy — stock-item-level split needs Tally inventory entries (not yet wired). Showing the children of the "Sales Accounts" group from P&L.',
        formula: this.formula,
      };
    },
  },
  {
    id: 'BPI3', domainId: 'D7', label: 'New vs repeat customer revenue split',
    defaultStatus: 'auto', source: 'DayBook', unit: 'pct',
    caveat: 'DayBook must span ≥ 2 calendar months with sale vouchers',
    remediation: 'Sale vouchers in 2+ months let us identify customers new vs returning',
    formula: 'Customers in latest month NOT seen in any prior month  ÷  total revenue × 100',
    compute(ctx) {
      // Walk the DayBook directly — group sale vouchers by YYYYMM and find
      // customers in the LATEST month who weren't seen in any earlier
      // month.  Operates on the aggregate Period's vouchers so it works
      // regardless of whether ctx.monthlyPeriods is plumbed through.
      const vouchers = ctx.current.chunkedStats?.vouchers ?? [];
      if (vouchers.length === 0) return missingDataResult(this.id, 'DayBook not uploaded');

      const byMonth = new Map<string, Map<string, number>>();
      for (const v of vouchers) {
        if (!v.party || !v.date || !/^\d{8}$/.test(v.date)) continue;
        const t = v.type.toLowerCase();
        if (!/sale/.test(t) || /return|credit\s*note/.test(t)) continue;
        const yymm = v.date.slice(0, 6);
        let cust = byMonth.get(yymm);
        if (!cust) { cust = new Map(); byMonth.set(yymm, cust); }
        cust.set(v.party, (cust.get(v.party) ?? 0) + Math.abs(v.amount));
      }
      const months = [...byMonth.keys()].sort();
      if (months.length < 2) {
        return {
          id: this.id, status: 'partial',
          value: { text: `Sales found in ${months.length || 0} month${months.length === 1 ? '' : 's'} — needs ≥ 2 for new/repeat`, unit: 'pct' },
          reason: 'DayBook contains sale vouchers in fewer than 2 distinct months — cannot identify "new" customers without prior-month history',
          formula: this.formula,
        };
      }
      const currMonth = months[months.length - 1];
      const currCust = byMonth.get(currMonth)!;
      const priorCust = new Set<string>();
      for (let i = 0; i < months.length - 1; i++) {
        for (const k of byMonth.get(months[i])!.keys()) priorCust.add(k);
      }
      let newRev = 0, repeatRev = 0;
      let newCnt = 0, repeatCnt = 0;
      for (const [k, v] of currCust.entries()) {
        if (priorCust.has(k)) { repeatRev += v; repeatCnt++; }
        else                  { newRev += v;   newCnt++; }
      }
      const total = newRev + repeatRev;
      if (total === 0) return missingDataResult(this.id, `Latest month (${currMonth.slice(0,4)}-${currMonth.slice(4,6)}) has no customer revenue — need sales in the latest month to compute`);
      const newPct = (newRev / total) * 100;
      return computedResult(this.id, {
        numeric: newPct, unit: 'pct',
        text: `New ${newPct.toFixed(0)}% / Repeat ${(100 - newPct).toFixed(0)}%  ·  latest month ${currMonth.slice(0,4)}-${currMonth.slice(4,6)}`,
        breakdown: [
          { label: `New customers (${newCnt}) revenue`, value: newRev, unit: 'INR' },
          { label: `Repeat customers (${repeatCnt}) revenue`, value: repeatRev, unit: 'INR' },
          { label: 'Total latest-month revenue', value: total, unit: 'INR' },
          { label: 'New customer share', value: newPct, unit: 'pct', badge: 'NET' },
        ],
      }, { formula: this.formula, source: 'DayBook.xml' });
    },
  },
  {
    id: 'BPI4', domainId: 'D7', label: 'Sales by channel / geography',
    defaultStatus: 'partial', source: 'DayBook', unit: 'INR',
    caveat: 'Channel tagging needs cost centre / godown in Tally',
    remediation: 'Configure godowns or cost centres per channel in Tally',
    formula: 'group(Sales vouchers by godown / cost centre)',
    compute() {
      return { id: 'BPI4', status: 'partial', value: { text: 'Channel data needs godown/cost centre config', unit: 'INR' }, reason: 'Cost centre data not parsed', formula: 'group(Sales vouchers by godown / cost centre)' };
    },
  },
  {
    id: 'BPI5', domainId: 'D7', label: 'Average transaction value (ATV) trend',
    defaultStatus: 'auto', source: 'DayBook', unit: 'INR', direction: 'higher-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'Revenue / count(Sales vouchers)',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      const r = revenueOf(ctx.current);
      if (!cs || r == null) return missingDataResult(this.id, 'DayBook or P&L missing');
      let salesCount = 0;
      for (const v of cs.vouchers) {
        if (/sale/i.test(v.type) && !/return|credit/i.test(v.type)) salesCount++;
      }
      if (!salesCount) return missingDataResult(this.id, 'No sales vouchers');
      const atv = r / salesCount;
      return computedResult(this.id, {
        numeric: atv, unit: 'INR',
        text: `₹${atv.toFixed(0)} per voucher · ${salesCount} sales`,
        trend: buildTrendFrom(trendPeriods(ctx), p => {
          const pr = revenueOf(p);
          const pn = (p.chunkedStats?.vouchers ?? []).filter(v => /sale/i.test(v.type) && !/return|credit/i.test(v.type)).length;
          return pr != null && pn > 0 ? pr / pn : null;
        }),
        breakdown: [
          { label: 'Revenue (period)', value: r, unit: 'INR' },
          { label: '÷ Sales voucher count', value: salesCount, unit: 'count' },
          { label: 'Average transaction value', value: atv, unit: 'INR', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'BPI6', domainId: 'D7', label: 'Order book / pipeline value',
    defaultStatus: 'manual', source: 'Manual', unit: 'INR',
    remediation: 'Enter order book value in Setup screen',
    formula: 'User-entered confirmed pipeline value',
    compute(ctx) {
      const ob = ctx.manual.orderBook;
      if (ob == null) return manualRequiredResult(this.id, 'Order book not entered in Setup');
      return computedResult(this.id, { numeric: ob, unit: 'INR' }, { formula: this.formula });
    },
  },
  {
    id: 'BPI7', domainId: 'D7', label: 'Sales return / rejection rate',
    defaultStatus: 'auto', source: 'DayBook', unit: 'pct', direction: 'lower-better',
    remediation: 'Computable from uploaded XMLs (credit note vouchers)',
    formula: 'sum(Credit Note amt) / sum(Sales amt) × 100',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      let cn = 0, sales = 0, cnCount = 0, salesCount = 0;
      for (const v of cs.vouchers) {
        const t = v.type.toLowerCase();
        if (t.includes('sale') && !t.includes('return') && !t.includes('credit')) {
          sales += Math.abs(v.amount); salesCount++;
        }
        if (t.includes('credit note') || t.includes('sales return')) {
          cn += Math.abs(v.amount); cnCount++;
        }
      }
      if (!sales) return missingDataResult(this.id, 'No sales vouchers');
      const rate = (cn / sales) * 100;
      return computedResult(this.id, {
        numeric: rate, unit: 'pct',
        text: `${rate.toFixed(2)}%  ·  ${fmtCompactINR(cn)} returns / ${fmtCompactINR(sales)} sales`,
        breakdown: [
          { label: `Sales (${salesCount} voucher${salesCount === 1 ? '' : 's'})`, value: sales, unit: 'INR' },
          { label: `Credit Notes / Sales Returns (${cnCount} voucher${cnCount === 1 ? '' : 's'})`, value: cn, unit: 'INR' },
          { label: 'Return rate', value: rate, unit: 'pct', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'BPI8', domainId: 'D7', label: 'Vendor concentration — top 3 as %',
    defaultStatus: 'auto', source: 'DayBook', unit: 'pct', direction: 'lower-better',
    remediation: 'Computable from uploaded XMLs',
    formula: 'sum(top 3 vendor purchases) / total purchases × 100',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      const entries = [...Object.entries(cs.vendMap)].sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((s, [, v]) => s + v, 0);
      if (!total) return missingDataResult(this.id, 'No vendor data');
      const top3 = entries.slice(0, 3).reduce((s, [, v]) => s + v, 0);
      const breakdown = entries.slice(0, 10).map(([label, value]) => ({ label, value, secondary: (value / total) * 100, unit: 'INR' as const }));
      return computedResult(this.id, { numeric: (top3 / total) * 100, unit: 'pct', breakdown }, { formula: this.formula });
    },
  },
  {
    id: 'BPI9', domainId: 'D7', label: 'On-time payment receipt rate',
    defaultStatus: 'partial', source: 'Bills.xml', unit: 'pct', direction: 'higher-better',
    caveat: 'Bills.xml shows OUTSTANDING bills only; a true receipt-timing rate needs paid-bill history too',
    remediation: 'Upload Bills.xml; for the exact receipt-rate metric tag credit terms in Tally',
    formula: 'value of receivable bills NOT overdue / total receivable bills × 100',
    compute(ctx) {
      const recv = (ctx.bills ?? []).filter(b => b.type === 'receivable');
      if (recv.length === 0) return missingDataResult(this.id, 'Bills.xml not uploaded — needs receivable bills with due dates');
      const asOf = periodAsOfDate(ctx.current);
      let notOverdue = 0, overdue = 0;
      for (const b of recv) {
        const days = billDaysOverdue(b, asOf);
        // Treat "due date couldn't be parsed" as overdue (conservative).
        if (days != null && days <= 0) notOverdue += b.amount;
        else overdue += b.amount;
      }
      const total = notOverdue + overdue;
      if (total === 0) return missingDataResult(this.id, 'No outstanding receivable bills');
      const pct = (notOverdue / total) * 100;
      return {
        id: this.id, status: 'partial',
        value: {
          numeric: pct, unit: 'pct',
          text: `${pct.toFixed(1)}% within terms · ${fmtCompactINR(overdue)} overdue of ${fmtCompactINR(total)}`,
          breakdown: [
            { label: 'Receivable bills WITHIN terms (not yet due)', value: notOverdue, unit: 'INR' },
            { label: 'Receivable bills OVERDUE', value: overdue, unit: 'INR' },
            { label: 'Total outstanding receivables', value: total, unit: 'INR' },
            { label: 'On-time receipt rate', value: pct, unit: 'pct', badge: 'NET' },
          ],
        },
        reason: 'Proxy from outstanding-bill aging — measures the share of receivables still within terms (not the fraction of past receipts that arrived on time, which needs paid-bill history)',
        formula: this.formula,
      };
    },
  },
  {
    id: 'BPI10', domainId: 'D7', label: 'DSCR — debt service coverage ratio',
    defaultStatus: 'auto', source: 'P&L + BSheet', unit: 'ratio', direction: 'higher-better',
    caveat: 'Loan repayment schedule must be in DayBook',
    remediation: 'Enter loan repayment as a recurring entry in DayBook',
    formula: 'Net Operating Income / Debt Service (Principal + Interest)',
    compute(ctx) {
      const ebitda = ebitdaOf(ctx.current);
      const interest = interestExpenseOf(ctx.current);
      const cs = ctx.current.chunkedStats;
      let principal = 0, principalCount = 0;
      if (cs) {
        for (const v of cs.vouchers) {
          if (!/payment/i.test(v.type)) continue;
          if (v.legs?.some(l => /loan|term loan|borrowing/i.test(l.name))) {
            principal += Math.abs(v.amount);
            principalCount++;
          }
        }
      }
      const service = interest + principal;
      if (ebitda == null) return missingDataResult(this.id, 'EBITDA unavailable');
      if (service === 0) return missingDataResult(this.id, 'No loan service detected (no interest ledger or loan-repayment Payment vouchers)');
      const dscr = ebitda / service;
      return computedResult(this.id, {
        numeric: dscr, unit: 'ratio', text: `${dscr.toFixed(2)}×`,
        breakdown: [
          { label: 'EBITDA (Net Operating Income proxy)', value: ebitda, unit: 'INR' },
          { label: 'Interest expense (period)', value: interest, unit: 'INR' },
          { label: `Principal repayments (${principalCount} payment voucher${principalCount === 1 ? '' : 's'} touching loan ledgers)`, value: principal, unit: 'INR' },
          { label: 'Total debt service', value: service, unit: 'INR' },
          { label: 'DSCR (EBITDA / Debt Service)', value: dscr, unit: 'ratio', badge: 'NET' },
        ],
      }, { formula: this.formula });
    },
  },
  {
    id: 'BPI11', domainId: 'D7', label: 'Revenue & EBITDA vs loan covenants',
    defaultStatus: 'manual', source: 'Manual + BSheet', unit: 'text',
    remediation: 'Enter covenant thresholds from loan agreement in Setup',
    formula: 'Compare DSCR / D/E / Current ratio against covenant thresholds',
    compute(ctx) {
      const c = ctx.manual.covenants;
      if (!c || (!c.dscrMin && !c.deRatioMax && !c.currentRatioMin)) return manualRequiredResult(this.id, 'Covenant thresholds not entered in Setup');
      const breakdown: MetricBreakdownItem[] = [];
      let breaches = 0, checks = 0;

      // Current ratio covenant
      if (c.currentRatioMin != null) {
        const ca = abs(ctx.current.parsedData.ca);
        const cl = abs(ctx.current.parsedData.cl);
        const cr = cl ? ca / cl : null;
        if (cr != null) {
          checks++;
          const breach = cr < c.currentRatioMin;
          if (breach) breaches++;
          breakdown.push({
            label: `Current ratio ≥ ${c.currentRatioMin}  ·  actual ${cr.toFixed(2)}×`,
            value: cr, badge: breach ? 'Breach' : 'OK', unit: 'ratio',
          });
        }
      }

      // Debt-Equity covenant
      if (c.deRatioMax != null) {
        const be4Result = D5_METRICS.find(m => m.id === 'BS4')!.compute(ctx);
        const de = be4Result.value?.numeric;
        if (de != null) {
          checks++;
          const breach = de > c.deRatioMax;
          if (breach) breaches++;
          breakdown.push({
            label: `Debt/Equity ≤ ${c.deRatioMax}  ·  actual ${de.toFixed(2)}×`,
            value: de, badge: breach ? 'Breach' : 'OK', unit: 'ratio',
          });
        }
      }

      // DSCR covenant
      if (c.dscrMin != null) {
        const dscrRes = D7_METRICS.find(m => m.id === 'BPI10')!.compute(ctx);
        const dscr = dscrRes.value?.numeric;
        if (dscr != null) {
          checks++;
          const breach = dscr < c.dscrMin;
          if (breach) breaches++;
          breakdown.push({
            label: `DSCR ≥ ${c.dscrMin}  ·  actual ${dscr.toFixed(2)}×`,
            value: dscr, badge: breach ? 'Breach' : 'OK', unit: 'ratio',
          });
        }
      }

      if (checks === 0) {
        return manualRequiredResult(this.id, 'Covenant thresholds entered but required ratios (CR / D/E / DSCR) couldn\'t be computed from current data');
      }
      return {
        id: this.id, status: breaches > 0 ? 'partial' : 'computed',
        value: {
          unit: 'text',
          text: breaches > 0 ? `${breaches} of ${checks} covenant${checks === 1 ? '' : 's'} BREACHED` : `All ${checks} covenant${checks === 1 ? '' : 's'} satisfied`,
          breakdown,
        },
        reason: breaches > 0 ? `${breaches} covenant breach(es) — review loan-agreement compliance` : undefined,
        formula: this.formula,
      };
    },
  },
  {
    id: 'BPI12', domainId: 'D7', label: 'Promoter / related-party transactions',
    defaultStatus: 'partial', source: 'DayBook', unit: 'INR',
    caveat: 'Related party ledgers must be tagged in Tally',
    remediation: 'Create a "Related Party" group in Tally and move those ledgers',
    formula: 'sum(vouchers touching related-party ledgers)',
    compute(ctx) {
      const cs = ctx.current.chunkedStats;
      if (!cs) return missingDataResult(this.id, 'DayBook not uploaded');
      let total = 0;
      const matched: string[] = [];
      for (const v of cs.vouchers) {
        for (const leg of v.legs ?? []) {
          if (/related|director|promoter|partner|associate/i.test(leg.name)) {
            total += Math.abs(leg.amt);
            matched.push(leg.name);
            break;
          }
        }
      }
      if (total === 0) return { id: this.id, status: 'partial', value: { text: 'No related-party tags detected', unit: 'INR' }, reason: 'No ledger names matched related-party patterns', formula: this.formula };
      return { id: this.id, status: 'partial', value: { numeric: total, unit: 'INR' }, reason: 'Pattern-based detection — tag a dedicated group in Tally for precision', formula: this.formula, ledgers: [...new Set(matched)] };
    },
  },
  {
    id: 'BPI13', domainId: 'D7', label: 'Contingent liabilities',
    defaultStatus: 'manual', source: 'Manual', unit: 'INR',
    remediation: 'Disclose in Setup screen — no XML source',
    formula: 'User-entered disclosure',
    compute(ctx) {
      const v = ctx.manual.contingentLiabilities;
      if (v == null) return manualRequiredResult(this.id, 'Not disclosed in Setup');
      return computedResult(this.id, { numeric: v, unit: 'INR' }, { formula: this.formula });
    },
  },
];

// ── Period-days helper ───────────────────────────────────────────────────

/**
 * Number of days the current period covers.  Derived from DayBook dateSet
 * range when present; falls back to 30 (month) for safety.  Used by
 * DSO/DPO/DIO calculations so a short period (e.g. half-month) doesn't
 * report inflated days.
 */
function periodDays(p: Period): number {
  if (p.startDate && p.endDate) {
    const s = new Date(p.startDate).getTime();
    const e = new Date(p.endDate).getTime();
    if (isFinite(s) && isFinite(e) && e >= s) {
      return Math.max(1, Math.ceil((e - s) / 86_400_000) + 1);
    }
  }
  return 30;
}

/** Reference date for bill aging — the period end when known, else today.
 *  Matches what Tally's "Bills Outstanding" report would show if run on
 *  the period close date. */
function periodAsOfDate(p: Period): Date {
  if (p.endDate) {
    const d = new Date(p.endDate);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Bucket a bill list into 0–30 / 31–60 / 61–90 / 90+ / Not-due totals. */
function agingBreakdown(
  bills: Bill[],
  asOf: Date,
): { buckets: Record<AgingBucket, number>; total: number } {
  const buckets: Record<AgingBucket, number> = {
    '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0, 'Not due': 0,
  };
  let total = 0;
  for (const b of bills) {
    const days = billDaysOverdue(b, asOf);
    buckets[agingBucketOf(days)] += b.amount;
    total += b.amount;
  }
  return { buckets, total };
}

/** Render the standard aging buckets as a metric breakdown (drops empty buckets). */
function agingBreakdownItems(buckets: Record<AgingBucket, number>): MetricBreakdownItem[] {
  const order: AgingBucket[] = ['Not due', '0–30', '31–60', '61–90', '90+'];
  return order
    .filter(k => buckets[k] > 0)
    .map(k => ({ label: k === 'Not due' ? 'Not yet due' : `${k} days`, value: buckets[k], unit: 'INR' as const }));
}

/**
 * Net worth (shareholders' equity) for a period.
 *
 *  Equity ledgers — Capital, Reserves, Surplus, Retained earnings, Partner
 *  capital, P&L A/c — are Cr-natured, so in the canonical Dr-positive TB
 *  convention their closing balance is NEGATIVE.  The earlier `closing > 0`
 *  filter therefore matched nothing → net worth always came back null.
 *
 *  `-l.closing` makes a Cr balance contribute positively and a Dr balance
 *  (Drawings, accumulated losses) contribute negatively — exactly the net
 *  worth sign behaviour we want.  The current-period retained profit
 *  usually shows on the BS as a "Profit & Loss A/c" line rather than a TB
 *  ledger, so `bsNetProfit` is folded in when the TB carries no P&L ledger.
 */
function netWorthOf(p: Period): number | null {
  const tb = p.parsedData.tbLedgers ?? [];
  let eq = 0;
  let found = false;
  let sawPLLedger = false;
  for (const l of tb) {
    if (/capital|reserve|surplus|retained|partner|drawings|profit\s*&?\s*loss|p\s*&\s*l\s*a\/c/i.test(l.name)) {
      eq += -l.closing;
      found = true;
      if (/profit\s*&?\s*loss|p\s*&\s*l\s*a\/c/i.test(l.name)) sawPLLedger = true;
    }
  }
  // Fold in the BS "Profit & Loss A/c" retained-profit line when the TB
  // didn't already carry it as a ledger.
  const bsRetained = num(p.parsedData.bsNetProfit);
  if (bsRetained != null && !sawPLLedger) {
    eq += bsRetained;
    found = true;
  }
  return found && eq !== 0 ? eq : null;
}

/** Drawings / dividends drawn during the period — Dr-natured contra-equity
 *  ledgers (positive closing in Dr-positive convention). */
function drawingsOf(p: Period): number {
  const tb = p.parsedData.tbLedgers ?? [];
  let total = 0;
  for (const l of tb) {
    if (/\bdrawings?\b|dividend\s*paid|drawing\s*a\/c/i.test(l.name)) {
      total += Math.abs(l.closing);
    }
  }
  return total;
}

// ── Public exports ───────────────────────────────────────────────────────

export const MIS_DOMAINS: Array<{ id: string; label: string; metrics: MetricDef[] }> = [
  { id: 'D1', label: 'Profitability & P&L', metrics: D1_METRICS },
  { id: 'D2', label: 'Cash Flow', metrics: D2_METRICS },
  { id: 'D3', label: 'Working Capital', metrics: D3_METRICS },
  { id: 'D4', label: 'Statutory & Compliance', metrics: D4_METRICS },
  { id: 'D5', label: 'Balance Sheet Health', metrics: D5_METRICS },
  { id: 'D6', label: 'Cost Analysis', metrics: D6_METRICS },
  { id: 'D7', label: 'Business Performance Indicators', metrics: D7_METRICS },
];

export const ALL_MIS_METRICS: MetricDef[] = MIS_DOMAINS.flatMap(d => d.metrics);

export function findMetric(id: string): MetricDef | undefined {
  return ALL_MIS_METRICS.find(m => m.id === id);
}
