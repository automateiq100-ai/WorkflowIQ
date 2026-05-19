/**
 * MIS Rules Engine.
 *
 * A rule is a threshold on a metric's numeric value.  When fired (the
 * metric value satisfies the operator + threshold), it produces a
 * RuleViolation which the UI surfaces as chips on KPI tiles, an alerts
 * banner, and an "Alerts" sheet in the Excel export.
 *
 * Pure / deterministic: no AI involved.  The default rule pack
 * (DEFAULT_RULES) ships sensible thresholds; users override / extend per
 * company.  Per-sector defaults pre-loaded via DEFAULT_RULES.sector field.
 */

import type { MetricResult } from './types';
import { findMetric } from './mis/metrics';

// ── Types ────────────────────────────────────────────────────────────────

export type RuleOperator = '>' | '<' | '>=' | '<=' | '=' | 'between' | 'outside';

export type RuleSeverity = 'critical' | 'warning' | 'info';

export interface Rule {
  /** Stable id — generated when user adds a rule, fixed for built-ins. */
  id: string;
  /** Metric this rule applies to (must match a MetricDef.id). */
  metricId: string;
  operator: RuleOperator;
  threshold: number;
  /** Second threshold for 'between' / 'outside' operators (else undefined). */
  threshold2?: number;
  severity: RuleSeverity;
  /** Human message shown when fired — supports {value} and {threshold} tokens. */
  message: string;
  /** Optional action description ("Escalate to top-3 overdue debtors"). */
  action?: string;
  enabled: boolean;
  /** When set, only fires for this sector.  Undefined = applies to all. */
  sector?: string;
  /** Whether this is a built-in default (cannot be deleted, but can be disabled). */
  builtIn: boolean;
}

export interface RuleViolation {
  rule: Rule;
  metricId: string;
  metricLabel: string;
  /** Computed value that triggered the rule. */
  value: number;
  /** Rendered message after token substitution. */
  message: string;
  severity: RuleSeverity;
}

// ── Operator matching ───────────────────────────────────────────────────

function matches(v: number, rule: Rule): boolean {
  const t = rule.threshold;
  const t2 = rule.threshold2 ?? t;
  switch (rule.operator) {
    case '>':       return v > t;
    case '<':       return v < t;
    case '>=':      return v >= t;
    case '<=':      return v <= t;
    case '=':       return v === t;
    case 'between': return v >= Math.min(t, t2) && v <= Math.max(t, t2);
    case 'outside': return v < Math.min(t, t2) || v > Math.max(t, t2);
    default:        return false;
  }
}

export const SEVERITY_ORDER: Record<RuleSeverity, number> = {
  critical: 0, warning: 1, info: 2,
};

// ── Runner ──────────────────────────────────────────────────────────────

export function runRules(
  rules: Rule[],
  byId: Record<string, MetricResult>,
  sector?: string | null,
): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.sector && rule.sector !== sector) continue;
    const r = byId[rule.metricId];
    if (!r) continue;
    const v = r.value?.numeric;
    if (v == null || !isFinite(v)) continue;
    if (!matches(v, rule)) continue;
    const def = findMetric(rule.metricId);
    out.push({
      rule,
      metricId: rule.metricId,
      metricLabel: def?.label ?? rule.metricId,
      value: v,
      severity: rule.severity,
      message: rule.message
        .replace('{value}', formatThreshold(v, def?.unit))
        .replace('{threshold}', formatThreshold(rule.threshold, def?.unit)),
    });
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function formatThreshold(n: number, unit: string | undefined): string {
  if (unit === 'pct') return `${n.toFixed(1)}%`;
  if (unit === 'days') return `${Math.round(n)} d`;
  if (unit === 'ratio') return `${n.toFixed(2)}×`;
  if (unit === 'count') return Math.round(n).toString();
  return n.toLocaleString('en-IN');
}

/** Violations grouped by metricId — used by MetricCard to show chips. */
export function violationsByMetric(violations: RuleViolation[]): Record<string, RuleViolation[]> {
  const out: Record<string, RuleViolation[]> = {};
  for (const v of violations) {
    (out[v.metricId] ??= []).push(v);
  }
  return out;
}

/** Highest-severity violation for a given metric (used by KPI tile chip). */
export function topViolation(violations: RuleViolation[] | undefined): RuleViolation | undefined {
  if (!violations || violations.length === 0) return undefined;
  return [...violations].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0];
}

// ── Default rule pack ───────────────────────────────────────────────────

let _id = 0;
const id = (slug: string) => `default-${slug}-${++_id}`;

/**
 * Built-in defaults applied across all sectors.  Sourced from industry
 * benchmarks (DSCR 1.25 = standard lender covenant, current ratio 1.5 =
 * healthy, MSME 45 days = MSMED Act).  Users can disable or override.
 */
export const DEFAULT_RULES: Rule[] = [
  // ── Profitability ─────────────────────────────────────────────────
  { id: id('P1-negative'), metricId: 'P1', operator: '<', threshold: 0,
    severity: 'critical', message: 'Revenue is negative — likely data quality issue',
    action: 'Check Sales ledger sign convention in Tally',
    enabled: true, builtIn: true },
  { id: id('P2-decline'), metricId: 'P2', operator: '<', threshold: -10,
    severity: 'warning', message: 'Revenue declined more than 10% MoM',
    action: 'Investigate lost customers and price impact',
    enabled: true, builtIn: true },
  { id: id('P3-below-budget'), metricId: 'P3', operator: '<', threshold: -10,
    severity: 'warning', message: 'Revenue is more than 10% below budget',
    action: 'Review pipeline and conversion',
    enabled: true, builtIn: true },
  { id: id('P5-negative'), metricId: 'P5', operator: '<', threshold: 0,
    severity: 'critical', message: 'Gross profit is negative — selling below cost',
    action: 'Immediate pricing and supplier review',
    enabled: true, builtIn: true },
  { id: id('P6-low'), metricId: 'P6', operator: '<', threshold: 0,
    severity: 'critical', message: 'EBITDA is negative',
    action: 'Immediate cost review',
    enabled: true, builtIn: true },
  { id: id('P7-thin'), metricId: 'P7', operator: '<', threshold: 0,
    severity: 'critical', message: 'PAT is negative',
    enabled: true, builtIn: true },
  { id: id('P8-thin-cm'), metricId: 'P8', operator: '<', threshold: 20,
    severity: 'warning', message: 'Contribution margin below 20% — limited pricing power',
    enabled: true, builtIn: true },
  { id: id('P10-yoy-decline'), metricId: 'P10', operator: '<', threshold: -10,
    severity: 'warning', message: 'Revenue down more than 10% year-on-year',
    enabled: true, builtIn: true },

  // ── Cash Flow ─────────────────────────────────────────────────────
  { id: id('CF1-negative'), metricId: 'CF1', operator: '<', threshold: 0,
    severity: 'critical', message: 'Negative cash balance — overdraft or data error',
    action: 'Check bank ledger sign convention; arrange short-term credit',
    enabled: true, builtIn: true },
  { id: id('CF1-low-buffer'), metricId: 'CF1', operator: '<', threshold: 100_000,
    severity: 'warning', message: 'Cash buffer below ₹1 lakh',
    action: 'Tighten collections and defer non-essential outflows',
    enabled: true, builtIn: true },
  { id: id('CF2-burn'), metricId: 'CF2', operator: '<', threshold: 0,
    severity: 'info', message: 'Net cash burn this period — outflows exceeded inflows',
    enabled: true, builtIn: true },
  { id: id('CF4-negative'), metricId: 'CF4', operator: '<', threshold: 0,
    severity: 'critical', message: 'Operating cash flow is negative',
    action: 'Working capital squeeze — escalate collections',
    enabled: true, builtIn: true },
  { id: id('CF7-negative'), metricId: 'CF7', operator: '<', threshold: 0,
    severity: 'warning', message: 'Free cash flow is negative',
    enabled: true, builtIn: true },
  { id: id('CF8-burn-forecast'), metricId: 'CF8', operator: '<', threshold: 0,
    severity: 'warning', message: '13-week forecast shows net cash burn',
    enabled: true, builtIn: true },

  // ── Working Capital ───────────────────────────────────────────────
  { id: id('WC2-warning'), metricId: 'WC2', operator: '>', threshold: 45,
    severity: 'warning', message: 'DSO above 45-day benchmark',
    enabled: true, builtIn: true },
  { id: id('WC2-critical'), metricId: 'WC2', operator: '>', threshold: 60,
    severity: 'critical', message: 'DSO above 60 days — collection cycle is poor',
    action: 'Escalate aged debtors, tighten credit terms',
    enabled: true, builtIn: true },
  { id: id('WC7-low'), metricId: 'WC7', operator: '<', threshold: 30,
    severity: 'warning', message: 'DPO below 30 — paying suppliers too fast vs collection',
    enabled: true, builtIn: true },
  { id: id('WC10-high'), metricId: 'WC10', operator: '>', threshold: 90,
    severity: 'warning', message: 'Inventory days above 90 — possible slow-moving stock',
    enabled: true, builtIn: true },
  { id: id('WC12-high'), metricId: 'WC12', operator: '>', threshold: 90,
    severity: 'warning', message: 'Cash conversion cycle above 90 days',
    enabled: true, builtIn: true },
  { id: id('WC5-low'), metricId: 'WC5', operator: '<', threshold: 70,
    severity: 'warning', message: 'Collection efficiency below 70%',
    action: 'Review collection process / aged invoices',
    enabled: true, builtIn: true },
  { id: id('WC4-overdue'), metricId: 'WC4', operator: '>', threshold: 10,
    severity: 'warning', message: 'More than 10% of debtors overdue beyond 90 days',
    action: 'Escalate or write off aged invoices',
    enabled: true, builtIn: true },
  { id: id('WC8-msme'), metricId: 'WC8', operator: '>', threshold: 0,
    severity: 'critical', message: 'MSME suppliers unpaid beyond 45 days — Section 16 MSMED Act interest liability',
    action: 'Settle MSME dues immediately',
    enabled: true, builtIn: true },

  // ── Statutory ─────────────────────────────────────────────────────
  { id: id('SC1-negative'), metricId: 'SC1', operator: '<', threshold: 0,
    severity: 'warning', message: 'Output GST is negative — refund situation or data quality issue',
    action: 'Verify GST ledger configuration',
    enabled: true, builtIn: true },
  { id: id('SC3-high'), metricId: 'SC3', operator: '>', threshold: 1_000_000,
    severity: 'info', message: 'Net GST payable exceeds ₹10 lakh — plan cash for due date',
    enabled: true, builtIn: true },
  { id: id('SC7-missing'), metricId: 'SC7', operator: '=', threshold: 0,
    severity: 'info', message: 'No PF/ESI ledgers detected — verify if you have employees on payroll',
    enabled: true, builtIn: true },

  // ── Balance Sheet ─────────────────────────────────────────────────
  { id: id('BS1-warning'), metricId: 'BS1', operator: '<', threshold: 1.5,
    severity: 'warning', message: 'Current ratio below 1.5 — liquidity tightening',
    enabled: true, builtIn: true },
  { id: id('BS1-critical'), metricId: 'BS1', operator: '<', threshold: 1.0,
    severity: 'critical', message: 'Current ratio below 1.0 — short-term solvency risk',
    enabled: true, builtIn: true },
  { id: id('BS2-low'), metricId: 'BS2', operator: '<', threshold: 0.8,
    severity: 'warning', message: 'Quick ratio below 0.8 — heavily inventory-dependent',
    enabled: true, builtIn: true },
  { id: id('BS3-low'), metricId: 'BS3', operator: '<', threshold: 0.1,
    severity: 'warning', message: 'Cash ratio below 0.1 — minimal cash buffer',
    enabled: true, builtIn: true },
  { id: id('BS4-warning'), metricId: 'BS4', operator: '>', threshold: 2.0,
    severity: 'warning', message: 'Debt/Equity above 2.0 — elevated leverage',
    enabled: true, builtIn: true },
  { id: id('BS4-critical'), metricId: 'BS4', operator: '>', threshold: 3.0,
    severity: 'critical', message: 'Debt/Equity above 3.0 — very high leverage',
    enabled: true, builtIn: true },
  { id: id('BS5-warning'), metricId: 'BS5', operator: '<', threshold: 1.5,
    severity: 'warning', message: 'Interest cover below 1.5 — earnings barely cover interest',
    enabled: true, builtIn: true },
  { id: id('BS5-critical'), metricId: 'BS5', operator: '<', threshold: 1.0,
    severity: 'critical', message: 'Interest cover below 1.0 — earnings do not cover interest',
    enabled: true, builtIn: true },
  { id: id('BS6-erosion'), metricId: 'BS6', operator: '<', threshold: 0,
    severity: 'warning', message: 'Net worth eroded vs prior period',
    action: 'Investigate losses or drawings',
    enabled: true, builtIn: true },
  { id: id('BS7-high-util'), metricId: 'BS7', operator: '>', threshold: 90,
    severity: 'warning', message: 'Drawing power utilisation above 90%',
    enabled: true, builtIn: true },
  { id: id('BS7-breach'), metricId: 'BS7', operator: '>', threshold: 100,
    severity: 'critical', message: 'Drawing power exceeded sanctioned limit — lender covenant breach',
    action: 'Restructure with bank or repay excess',
    enabled: true, builtIn: true },
  { id: id('BS9-missing-dep'), metricId: 'BS9', operator: '=', threshold: 0,
    severity: 'warning', message: 'No depreciation charged — books may not be closed for the period',
    action: 'Pass monthly depreciation journal',
    enabled: true, builtIn: true },

  // ── Cost Analysis ────────────────────────────────────────────────
  { id: id('CA4-high-lev'), metricId: 'CA4', operator: '>', threshold: 5,
    severity: 'warning', message: 'Operating leverage very high — small revenue moves create big PAT swings',
    enabled: true, builtIn: true },
  { id: id('CA4-trap'), metricId: 'CA4', operator: '<', threshold: -5,
    severity: 'critical', message: 'Operating leverage extremely negative — fixed cost trap',
    enabled: true, builtIn: true },

  // ── BPI ───────────────────────────────────────────────────────────
  { id: id('BPI1-warning'), metricId: 'BPI1', operator: '>', threshold: 40,
    severity: 'warning', message: 'Top-3 customer concentration above 40%',
    enabled: true, builtIn: true },
  { id: id('BPI1-critical'), metricId: 'BPI1', operator: '>', threshold: 50,
    severity: 'critical', message: 'Top-3 customer concentration above 50% — single-point-of-failure risk',
    action: 'Diversify customer base',
    enabled: true, builtIn: true },
  { id: id('BPI8-warning'), metricId: 'BPI8', operator: '>', threshold: 50,
    severity: 'warning', message: 'Top-3 vendor concentration above 50%',
    enabled: true, builtIn: true },
  { id: id('BPI7-high'), metricId: 'BPI7', operator: '>', threshold: 5,
    severity: 'warning', message: 'Sales return rate above 5% — quality issue likely',
    enabled: true, builtIn: true },
  { id: id('BPI10-warning'), metricId: 'BPI10', operator: '<', threshold: 1.25,
    severity: 'warning', message: 'DSCR below 1.25 — typical lender covenant threshold',
    enabled: true, builtIn: true },
  { id: id('BPI10-critical'), metricId: 'BPI10', operator: '<', threshold: 1.0,
    severity: 'critical', message: 'DSCR below 1.0 — debt service exceeds operating income',
    action: 'Lender breach — restructure or refinance',
    enabled: true, builtIn: true },
  { id: id('BPI3-flat'), metricId: 'BPI3', operator: '<', threshold: 5,
    severity: 'info', message: 'New customer revenue below 5% — growth is flat',
    enabled: true, builtIn: true },
  { id: id('BPI9-on-time'), metricId: 'BPI9', operator: '<', threshold: 70,
    severity: 'warning', message: 'On-time collection rate below 70%',
    enabled: true, builtIn: true },
  { id: id('BPI12-rp'), metricId: 'BPI12', operator: '>', threshold: 0,
    severity: 'info', message: 'Related-party transactions present — ensure disclosure in CA / lender reports',
    enabled: true, builtIn: true },
  { id: id('BPI13-cl'), metricId: 'BPI13', operator: '>', threshold: 0,
    severity: 'info', message: 'Contingent liabilities disclosed — ensure reporting in financial statements',
    enabled: true, builtIn: true },
];

/**
 * Reasons why a metric has no built-in rule.  Shown in the Rules editor
 * instead of a bare "No rule yet" — explains the metric's output shape
 * and points to the related metric you'd rule on instead.
 *
 * Empty / missing entry = sensible default exists; user can add a custom rule.
 */
export const NO_RULE_REASON: Record<string, string> = {
  P4:    'Per-segment breakdown output — set rules on total revenue (P1) or growth (P2) instead.',
  P9:    'Multi-period trend output — set rules on revenue (P1) or MoM growth (P2).',

  CF3:   'Per-bank breakdown — set rules on total cash (CF1) for the same number.',
  CF5:   'Investing flow is informational — meaningful only as capex vs plan (manual review).',
  CF6:   'Financing flow informational — track loan repayments via DSCR (BPI10).',
  CF9:   'Burn rate is best read as cash runway — rule on Cash ratio (BS3) or CF1 buffer.',
  CF10:  'Committed-outflow buckets — already covered by CF1 cash buffer rules.',

  WC1:   'Debtor aging buckets — use Overdue 90+ % (WC4) for a single threshold once Bills.xml is uploaded.',
  WC3:   'Top-10 debtor list output — use Customer concentration (BPI1) for a single number.',
  WC6:   'Creditor aging buckets — use DPO (WC7) or MSME (WC8).',
  WC9:   'Top-10 creditor list output — use Vendor concentration (BPI8).',
  WC11:  'Slow-moving stock list — use Inventory days (WC10) for a single threshold.',

  SC2:   'Input ITC informational — meaningful only as ratio to output GST; covered by Net GST (SC3).',
  SC4:   'TDS section-wise list — rule on totals after Tally section naming is in place.',
  SC5:   'TDS deposited vs due — needs cross-metric comparison; ensure DayBook tags challan vouchers.',
  SC6:   'Advance tax — meaningful as ratio to estimated liability; tracked separately.',
  SC8:   'Professional Tax — state-specific; add a custom threshold if applicable to your state.',

  BS8:   'Fixed asset additions — informational; spike-detection rules need historical baseline.',
  BS10:  'Investment list — rule on cash + investments together if relevant.',

  CA1:   'Per-line cost % breakdown — add custom rules for specific lines (e.g. Marketing > 8%).',
  CA2:   'Fixed vs variable heuristic split — use Operating leverage (CA4) for a thresholdable number.',
  CA3:   'Break-even revenue — meaningful as Margin of Safety = actual revenue / break-even; rule on Op leverage (CA4).',
  CA5:   'Departmental cost — needs cost-centre config in Tally; rule per department after setup.',
  CA6:   'Employee cost per head — sector-specific; set a custom threshold for your industry.',
  CA7:   'Cost per unit — sector-specific; set a custom threshold for your production economics.',
  CA8:   'Budget vs actual breakdown — already covered for revenue (P3); add custom per-line rules for cost heads.',
  CA9:   'MoM cost movement breakdown — rule on Operating leverage (CA4) for aggregate volatility.',
  CA10:  'Non-recurring items — disclosure only; flag in commentary, no threshold needed.',

  BPI2:  'SKU-level breakdown — rule on Customer concentration (BPI1) or revenue (P1) for aggregate.',
  BPI4:  'Channel/geography breakdown — rule on Customer concentration (BPI1) for aggregate.',
  BPI5:  'ATV is sector-specific — set a custom threshold for your business model.',
  BPI6:  'Order book is a manual input — its value itself is the forward target.',
  BPI11: 'Covenants are themselves the rules — thresholds entered in Company Profile fire as alerts when breached.',
};

/** Look up a rule by id. */
export function findRule(rules: Rule[], id: string): Rule | undefined {
  return rules.find(r => r.id === id);
}

/** Operator labels for the UI dropdown. */
export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  '>': 'greater than', '<': 'less than',
  '>=': 'greater than or equal', '<=': 'less than or equal',
  '=': 'equal to',
  'between': 'between', 'outside': 'outside range',
};

export const SEVERITY_LABELS: Record<RuleSeverity, string> = {
  critical: 'Critical', warning: 'Warning', info: 'Info',
};
