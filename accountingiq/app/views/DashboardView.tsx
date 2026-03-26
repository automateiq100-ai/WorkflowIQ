'use client';

import { useApp } from '@/lib/state';
import { getGrade, DIM_LABELS, DIM_WEIGHTS, DIM_COLORS } from '@/lib/constants';
import { generateHealthSignals } from '@/lib/health';
import { generateFlags } from '@/lib/flags';
import { generateInsights } from '@/lib/insights';
import ScoreRing from '@/app/components/ScoreRing';
import type { DimKey } from '@/lib/types';

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function fmtINR(n: number): string {
  if (!n || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

const SEV_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--coral)',
  medium:   'var(--amber)',
  low:      'var(--text3)',
};
const SEV_BG: Record<string, string> = {
  critical: 'rgba(240,72,72,0.1)',
  high:     'rgba(242,107,91,0.1)',
  medium:   'rgba(245,166,35,0.1)',
  low:      'rgba(92,99,112,0.08)',
};
const URGENCY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--coral)',
  medium:   'var(--amber)',
  positive: 'var(--teal)',
};

export default function DashboardView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, files, filters } = state;

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <div className="text-center">
          <div className="text-4xl mb-4" style={{ color: 'var(--text3)' }}>⬡</div>
          <p className="text-sm" style={{ color: 'var(--text3)' }}>
            No analysis yet.{' '}
            <button
              className="underline"
              style={{ color: 'var(--teal)' }}
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
            >
              Upload files
            </button>{' '}
            to begin.
          </p>
        </div>
      </div>
    );
  }

  const { cappedScore, scoreCapped, checks, dimScores, runAt } = results;
  const grade = getGrade(cappedScore);
  const filesLoaded = Object.values(files).filter(f => f.hasContent).length;
  const passed  = checks.filter(c => c.status === 'pass').length;
  const failed  = checks.filter(c => c.status === 'fail').length;
  const partial = checks.filter(c => c.status === 'partial').length;
  const runDate = new Date(runAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  // Get real parsed financial data
  const pd = parsedData as Record<string, number | boolean | undefined>;
  const revenue    = (pd.revenue    as number) ?? 0;
  const netProfit  = (pd.netProfit  as number) ?? 0;
  const ca         = (pd.ca         as number) ?? 0;
  const cl         = (pd.cl         as number) ?? 0;
  const debtorBal  = (pd.debtorBal  as number) ?? 0;
  const creditorBal= (pd.creditorBal as number) ?? 0;
  const currentRatio = ca > 0 && cl > 0 ? ca / cl : null;

  // Determine DayBook stats for flags
  const dbStatsRef = files.daybook?.chunkedStats ?? null;

  // Generate flags and insights
  const allFlags   = generateFlags(results, parsedData, dbStatsRef);
  const allInsights = generateInsights(results, parsedData, filters);
  const topFlags   = allFlags.slice(0, 4);
  const topInsights = allInsights.filter(i => i.urgency !== 'positive').slice(0, 3);

  // Build KPI tiles
  const kpis = [
    { label: 'Revenue',       value: revenue > 0    ? fmtINR(revenue)    : '—', sub: 'From P&L',           color: 'var(--teal)' },
    { label: 'Net Profit',    value: netProfit !== 0 ? fmtINR(netProfit)  : '—', sub: netProfit < 0 ? 'Loss year' : 'Bottom line', color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' },
    { label: 'Current Ratio', value: currentRatio !== null ? currentRatio.toFixed(2) : '—', sub: currentRatio !== null ? (currentRatio >= 1.5 ? 'Good liquidity' : currentRatio >= 1 ? 'Adequate' : 'Risk') : 'Needs BS', color: currentRatio !== null ? (currentRatio >= 1.5 ? 'var(--green)' : currentRatio >= 1 ? 'var(--amber)' : 'var(--red)') : 'var(--text3)' },
    { label: 'Debtors',       value: debtorBal > 0  ? fmtINR(debtorBal)  : '—', sub: 'Trade receivables',  color: 'var(--blue)' },
    { label: 'Creditors',     value: creditorBal > 0 ? fmtINR(creditorBal): '—', sub: 'Trade payables',    color: 'var(--purple)' },
    { label: 'Files',         value: `${filesLoaded}`, sub: 'of 13 uploaded',   color: 'var(--text1)' },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            Accounting Health Score
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
            Analysed {runDate}
          </p>
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
          className="text-xs px-3 py-1.5 rounded border transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          Re-upload
        </button>
      </div>

      {/* Score capped warning */}
      {scoreCapped && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm border"
          style={{
            background: 'rgba(245,166,35,0.1)',
            borderColor: 'rgba(245,166,35,0.3)',
            color: 'var(--amber)',
          }}
        >
          ⚠ Score capped at 60 — DayBook was not uploaded. Upload DayBook for full analysis.
        </div>
      )}

      {/* Top row: ring + stats */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: '160px 1fr' }}>
        <div
          className="flex items-center justify-center rounded-xl p-4 border"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <ScoreRing score={cappedScore} color={grade.color} grade={grade.label} />
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Checks Passed" value={passed}  unit={`/ ${checks.length}`} color="var(--green)" />
          <StatCard label="Checks Failed" value={failed}  unit=""                      color="var(--red)" />
          <StatCard label="Partial"        value={partial} unit=""                      color="var(--amber)" />
          <StatCard label="Missing"        value={checks.filter(c => c.status === 'missing').length} unit="" color="var(--text2)" />
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
          Key Financial Metrics
        </div>
        <div className="grid grid-cols-3 gap-3">
          {kpis.map(kpi => (
            <div
              key={kpi.label}
              className="rounded-xl border px-4 py-3"
              style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            >
              <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{kpi.label}</div>
              <div className="text-xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{kpi.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Critical Flags panel */}
      {topFlags.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Critical Flags
            </div>
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'flags' })}
              className="text-xs"
              style={{ color: 'var(--teal)' }}
            >
              View all {allFlags.length} →
            </button>
          </div>
          <div className="rounded-xl border overflow-hidden divide-y" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            {topFlags.map(flag => (
              <div key={flag.id} className="flex items-start gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5"
                  style={{ background: SEV_BG[flag.severity] ?? 'var(--bg4)', color: SEV_COLORS[flag.severity] ?? 'var(--text2)' }}
                >
                  {flag.severity.toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{flag.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>{flag.detail}</div>
                </div>
                {flag.count !== undefined && (
                  <div className="text-xs font-mono shrink-0" style={{ color: 'var(--text3)' }}>×{flag.count}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Insights panel */}
      {topInsights.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Key Insights
            </div>
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'insights' })}
              className="text-xs"
              style={{ color: 'var(--teal)' }}
            >
              View all {allInsights.length} →
            </button>
          </div>
          <div className="space-y-2">
            {topInsights.map(insight => (
              <div
                key={insight.id}
                className="rounded-xl border px-4 py-3"
                style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5"
                    style={{ color: URGENCY_COLORS[insight.urgency] ?? 'var(--text2)', background: `${URGENCY_COLORS[insight.urgency] ?? '#888'}18` }}
                  >
                    {insight.urgency.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{insight.finding}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
                      <span style={{ color: 'var(--text3)' }}>Action: </span>{insight.action}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dimension bars */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-3 border-b text-xs font-semibold uppercase tracking-wider"
          style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
        >
          Dimension Scores
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {DIMS.map(dim => {
            const score = dimScores[dim] ?? 0;
            const color = DIM_COLORS[dim];
            const weight = DIM_WEIGHTS[dim];
            return (
              <div key={dim} className="flex items-center gap-4 px-5 py-3">
                <div className="w-6 text-xs font-bold font-mono shrink-0 text-center" style={{ color }}>
                  {dim}
                </div>
                <div className="w-48 shrink-0">
                  <div className="text-sm" style={{ color: 'var(--text1)' }}>{DIM_LABELS[dim]}</div>
                  <div className="text-xs" style={{ color: 'var(--text3)' }}>{weight}% weight</div>
                </div>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--bg4)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${score}%`, background: color }}
                  />
                </div>
                <div className="w-10 text-right text-sm font-medium shrink-0" style={{ color: 'var(--text1)' }}>
                  {score}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit, color }: { label: string; value: number; unit: string; color?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}>
      <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: color ?? 'var(--text1)' }}>
        {value}
        {unit && <span className="text-sm font-normal ml-1" style={{ color: 'var(--text3)' }}>{unit}</span>}
      </div>
    </div>
  );
}
