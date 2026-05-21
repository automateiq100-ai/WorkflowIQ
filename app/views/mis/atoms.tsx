'use client';

/**
 * Shared atoms for the MIS report panels — formatters, colour palette,
 * KPI card, status pill, ratio gauge, aging bar, info / observations box.
 *
 * Every visual primitive that more than one panel uses lives here so the
 * panels themselves stay focused on layout + data.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/lib/state';
import {
  type SectionObservation, type SectionFixStep,
  readCachedSectionInsights, fetchSectionInsights, clearSectionCache,
} from '@/lib/layer2/mis/ai-insights';
import type { MetricResult, MetricUnit } from '@/lib/layer2/types';
import type { RuleViolation, RuleSeverity } from '@/lib/layer2/rules';

// ── Units & formatting ──────────────────────────────────────────────────

export type ReportUnit = 'absolute' | 'lakhs' | 'crores';

const UNIT_DIVISOR: Record<ReportUnit, number> = {
  absolute: 1, lakhs: 100_000, crores: 10_000_000,
};
const UNIT_SUFFIX: Record<ReportUnit, string> = {
  absolute: '', lakhs: 'L', crores: 'Cr',
};

export function fmtINR(n: number | null | undefined, unit: ReportUnit, withSymbol = true): string {
  if (n == null || !isFinite(n)) return '—';
  const v = n / UNIT_DIVISOR[unit];
  const txt = unit === 'absolute'
    ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v)
    : v.toFixed(2);
  return `${withSymbol ? '₹' : ''}${txt}${UNIT_SUFFIX[unit] ? ' ' + UNIT_SUFFIX[unit] : ''}`;
}

export function fmtPct(n: number | null | undefined, fractionDigits = 1): string {
  if (n == null || !isFinite(n)) return '—';
  return `${n.toFixed(fractionDigits)}%`;
}

export function fmtRatio(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return `${n.toFixed(2)}×`;
}

export function fmtDays(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return `${Math.round(n)} d`;
}

export function fmtCount(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN').format(Math.round(n));
}

/** Render the headline value of a metric result, unit-aware. */
export function fmtResult(r: MetricResult | undefined, unit: ReportUnit): string {
  if (!r) return '—';
  if (r.status === 'missing-data') return '—';
  if (r.status === 'manual-required') return 'Manual';
  if (r.value?.numeric != null) {
    const u = r.value.unit;
    return formatByUnit(r.value.numeric, u, unit);
  }
  return r.value?.text ?? '—';
}

export function formatByUnit(n: number, u: MetricUnit | undefined, unit: ReportUnit): string {
  if (u === 'pct') return fmtPct(n);
  if (u === 'days') return fmtDays(n);
  if (u === 'ratio') return fmtRatio(n);
  if (u === 'count') return fmtCount(n);
  return fmtINR(n, unit);
}

/** Secondary text line under the headline (e.g. "GM 73.4%"). */
export function fmtSecondary(r: MetricResult | undefined): string | null {
  if (!r?.value) return null;
  if (r.value.numeric == null) return null;
  if (!r.value.text) return null;
  const t = r.value.text;
  const m = /·\s*(.+)$/.exec(t);
  return m ? m[1].trim() : null;
}

// ── Colour palette (matches the HTML preview) ────────────────────────────

export const CHART_COLORS = {
  teal:    '#0fd4a0',
  blue:    '#4a9eff',
  amber:   '#f5a623',
  red:     '#f04848',
  green:   '#4caf79',
  purple:  '#9b7fe8',
  coral:   '#f26b5b',
  grey:    '#9ca3af',
  greyDark:'#6b7280',
} as const;

export const SECTION_ACCENT: Record<string, { c: string; bg: string }> = {
  cover:     { c: CHART_COLORS.teal,   bg: 'rgba(15,212,160,0.10)' },
  dashboard: { c: CHART_COLORS.teal,   bg: 'rgba(15,212,160,0.10)' },
  pl:        { c: CHART_COLORS.teal,   bg: 'rgba(15,212,160,0.10)' },
  cf:        { c: CHART_COLORS.blue,   bg: 'rgba(74,158,255,0.10)' },
  bs:        { c: CHART_COLORS.amber,  bg: 'rgba(245,166,35,0.10)' },
  wc:        { c: CHART_COLORS.coral,  bg: 'rgba(242,107,91,0.10)' },
  cost:      { c: CHART_COLORS.purple, bg: 'rgba(155,127,232,0.10)' },
  bpi:       { c: CHART_COLORS.green,  bg: 'rgba(76,175,121,0.10)' },
  statutory: { c: CHART_COLORS.red,    bg: 'rgba(240,72,72,0.10)' },
  forecast:  { c: CHART_COLORS.blue,   bg: 'rgba(74,158,255,0.10)' },
  backup:    { c: CHART_COLORS.grey,   bg: 'rgba(156,163,175,0.10)' },
};

// ── Status colour mapping ────────────────────────────────────────────────

export const STATUS_COLOR: Record<MetricResult['status'], string> = {
  computed:          CHART_COLORS.green,
  partial:           CHART_COLORS.amber,
  'missing-data':    'var(--text3)',
  'manual-required': CHART_COLORS.coral,
  na:                'var(--text3)',
};

export const STATUS_LABEL: Record<MetricResult['status'], string> = {
  computed: 'Auto',
  partial: 'Partial',
  'missing-data': 'Missing data',
  'manual-required': 'Manual',
  na: 'N/A',
};

// ── Atoms ────────────────────────────────────────────────────────────────

export function SectionPanel({
  title, blurb, accent, children, action,
}: {
  title: string;
  blurb?: string;
  accent: keyof typeof SECTION_ACCENT;
  children: ReactNode;
  action?: ReactNode;
}) {
  const a = SECTION_ACCENT[accent];
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 rounded-full" style={{ background: a.c }} />
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text1)' }}>{title}</h2>
          </div>
          {blurb && <p className="text-xs mt-1 ml-4" style={{ color: 'var(--text3)' }}>{blurb}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatusPill({ status }: { status: MetricResult['status'] }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap" style={{
      background: `${STATUS_COLOR[status]}22`,
      color: STATUS_COLOR[status],
    }}>{STATUS_LABEL[status]}</span>
  );
}

/**
 * KPI card with strong typographic hierarchy and an optional accent stripe.
 * Used in the Dashboard headline rail and across panels for single-value
 * metrics.
 */
export const SEVERITY_COLOR: Record<RuleSeverity, string> = {
  critical: CHART_COLORS.red,
  warning: CHART_COLORS.amber,
  info: CHART_COLORS.blue,
};

export function ViolationChip({ violation }: { violation: RuleViolation }) {
  const c = SEVERITY_COLOR[violation.severity];
  const label = violation.severity === 'critical' ? '⚠ Critical' : violation.severity === 'warning' ? '⚐ Warning' : 'ⓘ Info';
  return (
    <span title={violation.message}
      className="text-[9px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap"
      style={{ background: `${c}22`, color: c }}>
      {label}
    </span>
  );
}

export function MetricCard({
  label, result, unit, accent = 'teal', icon, violations, metricId, onTrace,
}: {
  label: string;
  result: MetricResult | undefined;
  unit: ReportUnit;
  accent?: keyof typeof CHART_COLORS;
  icon?: string;
  /** Firing rules for this metric, sorted by severity (worst first). */
  violations?: RuleViolation[];
  /** Metric id (used for backup-working hyperlink target). */
  metricId?: string;
  /** Click handler — when present, the card becomes a hyperlink to the
   *  Backup Working view scrolled to this metric.  Wired in ReportLayout. */
  onTrace?: (metricId: string) => void;
}) {
  const c = CHART_COLORS[accent];
  const secondary = fmtSecondary(result);
  const topViolation = violations?.[0];
  // Border accent shifts to the worst severity colour when a rule fires.
  const stripe = topViolation ? SEVERITY_COLOR[topViolation.severity] : c;
  const clickable = metricId && onTrace && result?.value?.numeric != null;
  return (
    <div
      className="rounded-xl border overflow-hidden relative group"
      style={{
        background: 'var(--bg2)',
        borderColor: 'var(--border)',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={() => clickable && onTrace!(metricId!)}
      title={clickable ? 'View working / formula in Backup' : undefined}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: stripe }} />
      <div className="p-4 pl-5">
        <div className="flex items-center gap-2 mb-2">
          {icon && <span className="text-[14px]" style={{ color: c }}>{icon}</span>}
          <div className="text-[10px] uppercase tracking-wide font-semibold flex-1" style={{ color: 'var(--text3)' }}>{label}</div>
          {topViolation && <ViolationChip violation={topViolation} />}
        </div>
        <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text1)' }}>{fmtResult(result, unit)}</div>
        {secondary && (
          <div className="text-[11px] mt-1" style={{ color: 'var(--text2)' }}>{secondary}</div>
        )}
        {result?.value?.mom != null && (
          <div className="text-[11px] mt-1 inline-flex items-center gap-1" style={{ color: result.value.mom >= 0 ? CHART_COLORS.green : CHART_COLORS.red }}>
            <span>{result.value.mom >= 0 ? '▲' : '▼'}</span>
            <span>{result.value.momIsPct ? fmtPct(Math.abs(result.value.mom)) : fmtINR(Math.abs(result.value.mom), unit)} vs prior</span>
          </div>
        )}
        {topViolation && (
          <div className="text-[11px] mt-1 leading-tight" style={{ color: SEVERITY_COLOR[topViolation.severity] }}>
            {topViolation.message}
          </div>
        )}
        {result?.reason && result.status !== 'computed' && !result.value?.numeric && (
          <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{result.reason}</div>
        )}
        {clickable && (
          <div className="text-[10px] mt-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: CHART_COLORS.teal }}>
            View working →
          </div>
        )}
      </div>
    </div>
  );
}

/** Top-of-panel alerts banner — shows the top N firing rules. */
export function AlertsBanner({ violations, limit = 5 }: { violations: RuleViolation[]; limit?: number }) {
  if (violations.length === 0) {
    return (
      <div className="rounded-xl border p-3 flex items-center gap-3" style={{
        background: `${CHART_COLORS.green}11`,
        borderColor: `${CHART_COLORS.green}55`,
      }}>
        <span className="text-base" style={{ color: CHART_COLORS.green }}>✓</span>
        <span className="text-xs" style={{ color: 'var(--text2)' }}>
          All rules clear — no alerts firing for this period.
        </span>
      </div>
    );
  }
  const shown = violations.slice(0, limit);
  const more = violations.length - shown.length;
  return (
    <div className="rounded-xl border p-3" style={{
      background: `${CHART_COLORS.amber}08`,
      borderColor: `${CHART_COLORS.amber}55`,
    }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: CHART_COLORS.amber }}>
          ⚐ {violations.length} alert{violations.length === 1 ? '' : 's'} firing
        </div>
        {more > 0 && <span className="text-[10px]" style={{ color: 'var(--text3)' }}>+{more} more</span>}
      </div>
      <div className="space-y-1.5">
        {shown.map((v, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <ViolationChip violation={v} />
            <span style={{ color: 'var(--text1)' }}><strong>{v.metricLabel}:</strong></span>
            <span className="flex-1" style={{ color: 'var(--text2)' }}>{v.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Ratio tile — coloured green / amber / red based on whether the value
 * meets a benchmark.  Used in BS panel (current ratio, quick ratio, etc.).
 */
export function RatioGauge({
  label, value, benchmark, fmt = fmtRatio, direction = 'higher-better',
  metricId, onTrace,
}: {
  label: string;
  value: number | null | undefined;
  /** Threshold the metric is judged against. */
  benchmark: number;
  /** How to format the displayed number. */
  fmt?: (n: number | null | undefined) => string;
  /** higher-better: value < benchmark = red.  lower-better: value > benchmark = red. */
  direction?: 'higher-better' | 'lower-better';
  /** Metric id (used for backup-working hyperlink target). */
  metricId?: string;
  /** Click handler — when present and the value is computable, the gauge
   *  becomes a hyperlink to Backup Working scrolled to this metric. */
  onTrace?: (metricId: string) => void;
}) {
  let zone: 'green' | 'amber' | 'red' = 'amber';
  if (value != null && isFinite(value)) {
    if (direction === 'higher-better') {
      if (value >= benchmark) zone = 'green';
      else if (value >= benchmark * 0.85) zone = 'amber';
      else zone = 'red';
    } else {
      if (value <= benchmark) zone = 'green';
      else if (value <= benchmark * 1.15) zone = 'amber';
      else zone = 'red';
    }
  }
  const colors = {
    green: { fg: CHART_COLORS.green, bg: 'rgba(76,175,121,0.10)', border: 'rgba(76,175,121,0.35)' },
    amber: { fg: CHART_COLORS.amber, bg: 'rgba(245,166,35,0.10)', border: 'rgba(245,166,35,0.35)' },
    red:   { fg: CHART_COLORS.red,   bg: 'rgba(240,72,72,0.10)',   border: 'rgba(240,72,72,0.35)' },
  }[zone];
  const clickable = metricId != null && onTrace != null && value != null && isFinite(value);
  return (
    <div
      className={clickable ? 'rounded-xl border p-3 text-center group cursor-pointer transition-colors' : 'rounded-xl border p-3 text-center'}
      style={{ background: colors.bg, borderColor: colors.border }}
      onClick={() => clickable && onTrace!(metricId!)}
      title={clickable ? 'View working / formula in Backup' : undefined}
    >
      <div className="text-[9px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-xl font-bold tabular-nums" style={{ color: colors.fg }}>{fmt(value)}</div>
      <div className="text-[9px] mt-1" style={{ color: 'var(--text3)' }}>
        {direction === 'higher-better' ? `Benchmark > ${fmt(benchmark)}` : `Benchmark < ${fmt(benchmark)}`}
      </div>
      {clickable && (
        <div className="text-[9px] mt-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: CHART_COLORS.teal }}>
          View working →
        </div>
      )}
    </div>
  );
}

/**
 * Horizontal aging bar — bucket label, % progress, value.  Used in
 * Working Capital debtor/creditor aging panels.
 */
export function AgingBar({
  label, value, total, color, unit, badge, metricId, onTrace,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  unit: ReportUnit;
  badge?: string;
  /** When supplied, the row becomes a hyperlink to the metric's backup. */
  metricId?: string;
  onTrace?: (id: string) => void;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const clickable = !!(metricId && onTrace);
  return (
    <div
      className="flex items-center gap-3 mb-1.5 text-xs transition-colors"
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onClick={() => clickable && onTrace!(metricId!)}
      title={clickable ? 'View working' : undefined}
    >
      <div className="w-20 shrink-0" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="w-10 text-right tabular-nums shrink-0" style={{ color: 'var(--text3)' }}>{pct.toFixed(0)}%</div>
      <div className="flex-1 h-3 rounded-md overflow-hidden" style={{ background: 'var(--bg4)' }}>
        <div className="h-full rounded-md transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="w-24 text-right font-semibold tabular-nums shrink-0" style={{ color: 'var(--text1)' }}>{fmtINR(value, unit)}</div>
      {badge && (
        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: 'rgba(245,166,35,0.15)', color: CHART_COLORS.amber }}>{badge}</span>
      )}
    </div>
  );
}

/** Card containing a chart with a title strip. */
export function ChartCard({
  title, children, action, height = 200,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  height?: number;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold" style={{ color: 'var(--text2)' }}>{title}</div>
        {action}
      </div>
      <div style={{ height }}>
        {children}
      </div>
    </div>
  );
}

/** Empty-state shown inside a chart slot when there isn't enough data. */
export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-center px-6" style={{ color: 'var(--text3)' }}>
      {message}
    </div>
  );
}

/**
 * Coloured info box used for outflow buckets, break-even highlights, and
 * cover-page summary panels.  Accepts a numeric value, label, and tint.
 */
export function StatBox({
  label, value, tint, sub, metricId, onTrace,
}: {
  label: string;
  value: string;
  tint?: keyof typeof CHART_COLORS;
  sub?: string;
  /** When metricId + onTrace supplied, the box becomes a hyperlink to the
   *  Backup Working row for that metric. */
  metricId?: string;
  onTrace?: (metricId: string) => void;
}) {
  const c = tint ? CHART_COLORS[tint] : CHART_COLORS.teal;
  const bg = tint ? `${c}1c` : 'var(--bg2)';
  const border = tint ? `${c}55` : 'var(--border)';
  const clickable = metricId && onTrace;
  return (
    <div
      className="rounded-xl border p-4 group"
      style={{ background: bg, borderColor: border, cursor: clickable ? 'pointer' : 'default' }}
      onClick={() => clickable && onTrace!(metricId!)}
      title={clickable ? 'View working / formula in Backup' : undefined}
    >
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: c }}>{label}</div>
      <div className="text-xl font-bold tabular-nums" style={{ color: 'var(--text1)' }}>{value}</div>
      {sub && <div className="text-[11px] mt-1" style={{ color: 'var(--text3)' }}>{sub}</div>}
      {clickable && (
        <div className="text-[10px] mt-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: c }}>
          View working →
        </div>
      )}
    </div>
  );
}

/** Friendly category labels for the in-card chips. */
const CATEGORY_LABEL: Record<SectionFixStep['category'], string> = {
  'data-setup': 'Data setup',
  'operations': 'Operations',
  'financial':  'Financial',
  'compliance': 'Compliance',
  'reporting':  'Reporting',
};

/**
 * Section insights panel — Observations + Fix Plan for one MIS tab.
 *
 *  Auto-generates on first mount per section per analysis run (when AI
 *  consent is given).  Results are cached at module scope so navigating
 *  back to a tab is instant — no re-fetch.  An explicit ↻ Regenerate
 *  button busts the cache.  Re-running analysis (new runAt) invalidates
 *  every cached section.
 *
 *  Export name kept as `AIObservationsPlaceholder` so the 9 existing call
 *  sites in the report panels don't have to change.
 */
export function AIObservationsPlaceholder({ section }: { section: string }) {
  const { state, dispatch } = useApp();
  const aiConsent = state.aiConsentGiven;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState<SectionObservation[] | null>(null);
  const [fixSteps, setFixSteps] = useState<SectionFixStep[] | null>(null);
  const fetchedRef = useRef(false);

  const generate = async (opts: { force?: boolean } = {}) => {
    if (loading) return;
    if (!state.results) {
      setError('Run accounting analysis first — Account Health → Upload Files → Run Analysis.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSectionInsights(state, section, opts);
      if (!data) throw new Error('Could not fetch insights — check AI provider configuration.');
      setObservations(data.observations);
      setFixSteps(data.fixSteps);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-trigger on mount + cache lookup.  Cache hit → instant hydrate, no API call.
  useEffect(() => {
    if (!aiConsent || !state.results || fetchedRef.current) return;
    const cached = readCachedSectionInsights(section, state.results.runAt);
    if (cached) {
      setObservations(cached.observations);
      setFixSteps(cached.fixSteps);
      fetchedRef.current = true;
      return;
    }
    fetchedRef.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConsent, section, state.results?.runAt]);

  /** Manual regenerate — busts the shared cache and re-fetches. */
  const regenerate = () => {
    clearSectionCache(section);
    setObservations(null);
    setFixSteps(null);
    void generate({ force: true });
  };

  // ── Render ──
  const teal = CHART_COLORS.teal;
  const containerStyle = { background: `${teal}07`, borderColor: `${teal}33` } as const;

  // Consent gate
  if (!aiConsent) {
    return (
      <div className="rounded-xl border p-4" style={containerStyle}>
        <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: teal }}>
          Observations & Fix Plan — {section}
        </div>
        <div className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text2)' }}>
          Enable smart commentary to get section-specific observations and a ranked fix plan from the numbers on this page. Numbers-only payload (no party names or voucher details leave your device).
        </div>
        <button onClick={() => dispatch({ type: 'AI_CONSENT_GIVEN' })}
          className="px-3 py-1.5 text-[11px] rounded-md font-semibold transition-colors"
          style={{ background: teal, color: '#fff' }}>
          Enable for this page
        </button>
      </div>
    );
  }

  const hasContent = observations !== null || fixSteps !== null;

  return (
    <div className="rounded-xl border p-4" style={containerStyle}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: teal }}>
          Observations & Fix Plan — {section}
        </div>
        <button onClick={regenerate} disabled={loading}
          className="text-[10px] px-2.5 py-1 rounded font-semibold transition-colors disabled:opacity-60"
          style={{ background: teal, color: '#0a0a0a' }}>
          {loading ? 'Thinking…' : '↻ Regenerate'}
        </button>
      </div>

      {error && (
        <div className="text-[11px] px-3 py-2 rounded-md mb-2" style={{
          background: `${CHART_COLORS.red}10`, color: CHART_COLORS.red, border: `1px solid ${CHART_COLORS.red}55`,
        }}>
          {error}
        </div>
      )}

      {loading && !hasContent && !error && (
        <div className="text-xs italic flex items-center gap-2" style={{ color: 'var(--text3)' }}>
          <span className="animate-pulse" style={{ color: teal }}>✨</span>
          Reading the {section.toLowerCase()} metrics and writing observations…
        </div>
      )}

      {observations && observations.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: 'var(--text3)' }}>
            Observations
          </div>
          <ul className="space-y-1.5">
            {observations.map((o, i) => {
              const icon = o.type === 'positive' ? '✓' : o.type === 'risk' ? '⚠' : '•';
              const color = o.type === 'positive' ? CHART_COLORS.green
                         : o.type === 'risk'    ? CHART_COLORS.red
                         : 'var(--text3)';
              return (
                <li key={i} className="text-xs leading-relaxed flex gap-2" style={{ color: 'var(--text2)' }}>
                  <span style={{ color, fontWeight: 600, fontSize: '12px', flexShrink: 0 }}>{icon}</span>
                  <span>{o.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {fixSteps && fixSteps.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: 'var(--text3)' }}>
            Fix Plan
          </div>
          <ol className="space-y-2">
            {fixSteps.map((s, i) => <SectionFixStepRow key={i} step={s} index={i + 1} />)}
          </ol>
        </div>
      )}

      {observations && observations.length === 0 && (!fixSteps || fixSteps.length === 0) && (
        <div className="text-[11px] italic" style={{ color: 'var(--text3)' }}>
          No commentary returned — try regenerating, or verify the {section.toLowerCase()} section has data.
        </div>
      )}
    </div>
  );
}

function SectionFixStepRow({ step, index }: { step: SectionFixStep; index: number }) {
  const teal = CHART_COLORS.teal;
  const effortColor = step.effort === 'S' ? CHART_COLORS.green : step.effort === 'M' ? CHART_COLORS.amber : CHART_COLORS.coral;
  const effortLabel = step.effort === 'S' ? 'Quick win' : step.effort === 'M' ? 'Few weeks' : 'Long haul';
  return (
    <li className="rounded-md border px-3 py-2" style={{
      background: 'var(--bg2)', borderColor: 'var(--border)',
    }}>
      <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
        <div className="text-xs font-semibold flex items-center gap-2" style={{ color: 'var(--text1)' }}>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold tabular-nums"
            style={{ background: `${teal}22`, color: teal }}>{index}</span>
          {step.title}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: `${teal}22`, color: teal }}>{CATEGORY_LABEL[step.category]}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: `${effortColor}22`, color: effortColor }}>{step.effort} · {effortLabel}</span>
        </div>
      </div>
      {step.rationale && (
        <div className="text-[11px] mb-1 leading-relaxed" style={{ color: 'var(--text2)' }}>{step.rationale}</div>
      )}
      {step.impact && (
        <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
          <span style={{ color: 'var(--text2)' }}>Impact:</span> {step.impact}
        </div>
      )}
      {step.tallySteps && step.tallySteps.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[9px] font-semibold mb-0.5" style={{ color: 'var(--text3)' }}>TALLY SETUP</div>
          <ul className="text-[10px] space-y-0.5" style={{ color: 'var(--text2)' }}>
            {step.tallySteps.map((t, i) => <li key={i}>• {t}</li>)}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * Three-box flow diagram — Opening ± Δ = Closing.  Used by Balance Sheet
 * (net worth movement) and Cash Flow (cash position movement).  Mirrors
 * the HTML preview's net-worth flow strip.
 */
export function FlowDiagram({
  opening, openingLabel, deltas, closing, closingLabel, unit,
}: {
  opening: number;
  openingLabel: string;
  deltas: Array<{ label: string; value: number; tint?: keyof typeof CHART_COLORS }>;
  closing: number;
  closingLabel: string;
  unit: ReportUnit;
}) {
  return (
    <div className="rounded-xl border p-5" style={{
      background: 'linear-gradient(135deg, rgba(15,212,160,0.06), rgba(74,158,255,0.04))',
      borderColor: 'var(--border)',
    }}>
      <div className="flex items-center gap-2 flex-wrap">
        <FlowBox label={openingLabel} value={fmtINR(opening, unit)} />
        {deltas.map((d, i) => {
          const sign = d.value >= 0 ? '+' : '−';
          const color = d.tint ? CHART_COLORS[d.tint] : (d.value >= 0 ? CHART_COLORS.green : CHART_COLORS.red);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xl font-semibold" style={{ color: 'var(--text3)' }}>{sign}</span>
              <FlowBox label={d.label} value={fmtINR(Math.abs(d.value), unit)} color={color} />
            </div>
          );
        })}
        <span className="text-xl font-semibold" style={{ color: 'var(--text3)' }}>=</span>
        <FlowBox label={closingLabel} value={fmtINR(closing, unit)} color={CHART_COLORS.teal} highlight />
      </div>
    </div>
  );
}

function FlowBox({ label, value, color, highlight }: {
  label: string;
  value: string;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border px-3 py-2 text-center min-w-[100px]" style={{
      borderColor: color ?? 'var(--border)',
      background: highlight ? `${color}15` : 'var(--bg2)',
    }}>
      <div className="text-base font-bold tabular-nums" style={{ color: color ?? 'var(--text1)' }}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'var(--text3)' }}>{label}</div>
    </div>
  );
}

// ── Recharts shared style ───────────────────────────────────────────────

export const CHART_GRID = '#2a2f3a';
export const CHART_AXIS = '#9ca3af';

export const tooltipStyle = {
  backgroundColor: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--text1)',
};
