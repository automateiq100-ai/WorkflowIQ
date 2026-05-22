'use client';

import { useApp } from '@/lib/state';
import { getGrade, DIM_LABELS, DIM_WEIGHTS, DIM_COLORS, TOTAL_FILE_COUNT } from '@/lib/constants';
import { generateFlags } from '@/lib/flags';
import { generateInsights } from '@/lib/insights';
import { generateHealthSignals } from '@/lib/health';
import { getDrillDown, hasDrillDown } from '@/lib/voucher-filters';
import ScoreRing from '@/app/components/ScoreRing';
import VoucherDrillDown from '@/app/components/VoucherDrillDown';
import H4Breakdown from '@/app/components/H4Breakdown';
import GSTBreakdown from '@/app/components/GSTBreakdown';
import LedgerPairDrillDown from '@/app/components/LedgerPairDrillDown';
import type { DimKey, Check, ParsedData, ChunkedStats, AnomalyFlag } from '@/lib/types';
import { useEffect, useState } from 'react';

interface FirstRun {
  overall_score: number;
  capped_score: number;
  dim_scores: Record<DimKey, number>;
  checks: Check[];
  run_at: string;
}

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Bug 1: Format INR with unicode minus for negatives */
function fmtINR(n: number): string {
  if (!n || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
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

/**
 * Bug 1: Check if a BS-sourced metric has an anomalous sign.
 * Returns true if the value contradicts its accounting convention.
 */
function isAnomaly(label: string, value: number): boolean {
  if (value === 0) return false;
  const l = label.toLowerCase();
  // Debtors, Current Assets, Bank, Cash should be positive (Dr)
  if (l.includes('debtor') || l.includes('current asset') || l.includes('bank')) return value < 0;
  // Creditors, Capital should be negative (Cr) in Tally convention
  if (l.includes('creditor')) return value > 0;
  return false;
}

export default function DashboardView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, files, filters } = state;
  const [firstRun, setFirstRun] = useState<FirstRun | null>(null);
  const [runCount, setRunCount] = useState(0);

  useEffect(() => {
    if (!results) return;
    const url = state.currentCompany
      ? `/api/analysis/first?company_id=${state.currentCompany.id}`
      : '/api/analysis/first';
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.first) { setFirstRun(data.first); setRunCount(data.count ?? 1); }
      })
      .catch(() => {});
  }, [results?.runAt, state.currentCompany?.id]);

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

  // Inline disclosure for the "Not Applicable" / "Needs Data" tiles — clicking
  // a tile opens a list of the underlying checks with their reason note, so
  // users can see *which* checks were skipped and *why* without leaving the
  // dashboard.
  const [openTile, setOpenTile] = useState<null | 'na' | 'uncertain'>(null);
  const [drillFlag, setDrillFlag] = useState<AnomalyFlag | null>(null);
  const toggleTile = (which: 'na' | 'uncertain') =>
    setOpenTile(prev => (prev === which ? null : which));

  // Bug 6 fix: count all status categories including NA
  const passed    = checks.filter(c => c.status === 'pass').length;
  const failed    = checks.filter(c => c.status === 'fail').length;
  const partialCt = checks.filter(c => c.status === 'partial').length;
  const missingCt = checks.filter(c => c.status === 'missing').length;
  const naCt      = checks.filter(c => c.status === 'na').length;
  const uncertainCt = checks.filter(c => c.status === 'uncertain').length;
  const applicable = checks.length - naCt;

  const runDate = new Date(runAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  // Get real parsed financial data — Bug 1: use signed values directly
  const pd = parsedData as Record<string, number | boolean | undefined | null>;
  const revenue    = (pd.revenue    as number) ?? 0;
  const netProfit  = (pd.netProfit  as number) ?? 0;
  const ca         = (pd.ca         as number) ?? 0;
  const cl         = (pd.cl         as number) ?? 0;
  const debtorBal  = (pd.debtorBal  as number) ?? 0;
  const creditorBal= (pd.creditorBal as number) ?? 0;

  // Current Ratio — Tally stores assets with a negative sign in TB convention
  // (Cr-positive internally), so |CA| / |CL| recovers the standard accounting
  // ratio regardless of which side the parser captured. We only refuse to
  // compute when one of the two is exactly zero (no data).
  const currentRatio = ca !== 0 && cl !== 0 ? Math.abs(ca) / Math.abs(cl) : null;

  // Determine DayBook stats for flags
  const dbStatsRef = files.daybook?.chunkedStats ?? null;

  // Generate flags and insights
  const allFlags   = generateFlags(results, parsedData, dbStatsRef);
  const allInsights = generateInsights(results, parsedData, filters);
  // Sort flags by severity (critical → high → medium → low) so the
  // top-4 panel always surfaces the most important issues first instead
  // of whichever check happened to be added to the array earliest.
  const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const topFlags   = [...allFlags]
    .sort((a, b) => (SEV_RANK[a.severity] ?? 99) - (SEV_RANK[b.severity] ?? 99))
    .slice(0, 4);
  const topInsights = allInsights.filter(i => i.urgency !== 'positive').slice(0, 3);

  // Build KPI tiles — Bug 1: signed values, ANOMALY pills
  const kpis: Array<{
    label: string; value: string; sub: string; color: string; anomaly?: boolean; critical?: boolean
  }> = [
    { label: 'Revenue',       value: revenue > 0    ? fmtINR(revenue)    : '—', sub: 'From P&L',           color: 'var(--teal)' },
    { label: 'Net Profit',    value: netProfit !== 0 ? fmtINR(netProfit)  : '—', sub: netProfit < 0 ? 'Loss year' : 'Bottom line', color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' },
    {
      label: 'Current Ratio',
      value: currentRatio !== null ? currentRatio.toFixed(2) : '—',
      sub: currentRatio !== null ? (currentRatio >= 1.5 ? 'Good liquidity' : currentRatio >= 1 ? 'Adequate' : 'Risk') : 'Needs BS',
      color: currentRatio !== null ? (currentRatio >= 1.5 ? 'var(--green)' : currentRatio >= 1 ? 'var(--amber)' : 'var(--red)') : 'var(--text3)',
    },
    // parseBSheet returns debtorBal/creditorBal as unsigned magnitudes (see
    // its sign-convention note), so the old sign-based ANOMALY pills are
    // meaningless here — debtorBal<0 never fired and creditorBal>0 fired on
    // every company (creditors always shown red). Show plain magnitudes;
    // genuine Dr/Cr-flip anomalies are surfaced via generateFlags from the
    // signed Trial Balance, not from these tiles.
    { label: 'Debtors',       value: debtorBal !== 0 ? fmtINR(debtorBal) : '—', sub: 'Trade receivables',  color: 'var(--blue)' },
    { label: 'Creditors',     value: creditorBal !== 0 ? fmtINR(creditorBal): '—', sub: 'Trade payables',    color: 'var(--purple)' },
    { label: 'Files',         value: `${filesLoaded}`, sub: `of ${TOTAL_FILE_COUNT} uploaded`, color: 'var(--text1)' },
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

      {/* Improvement panel — shown when there's a prior run to compare against */}
      {firstRun && runCount > 1 && (() => {
        const scoreDelta = results.cappedScore - firstRun.capped_score;
        const firstMap = Object.fromEntries((firstRun.checks as Check[]).map(c => [c.id, c.status]));
        const improved  = results.checks.filter(c => {
          const prev = firstMap[c.id];
          return (prev === 'fail' || prev === 'partial') && c.status === 'pass';
        });
        const regressed = results.checks.filter(c => {
          const prev = firstMap[c.id];
          return prev === 'pass' && (c.status === 'fail' || c.status === 'partial');
        });
        const firstDate = new Date(firstRun.run_at).toLocaleDateString('en-IN', { dateStyle: 'medium' });
        return (
          <div
            className="mb-4 rounded-xl border p-4"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
                Progress since first analysis
              </div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>First run: {firstDate}</div>
            </div>
            <div className="flex items-center gap-6 flex-wrap">
              {/* Score delta */}
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-2xl font-bold"
                  style={{ color: scoreDelta >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-dm-serif)' }}
                >
                  {scoreDelta >= 0 ? '+' : ''}{scoreDelta.toFixed(0)}
                </span>
                <span className="text-xs" style={{ color: 'var(--text3)' }}>points ({firstRun.capped_score.toFixed(0)} → {results.cappedScore.toFixed(0)})</span>
              </div>
              {/* Improved checks */}
              {improved.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold" style={{ color: 'var(--green)' }}>✓ {improved.length}</span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    check{improved.length !== 1 ? 's' : ''} fixed
                    {improved.length <= 3 && ': ' + improved.map(c => c.id).join(', ')}
                  </span>
                </div>
              )}
              {/* Regressed checks */}
              {regressed.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold" style={{ color: 'var(--red)' }}>↓ {regressed.length}</span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    new issue{regressed.length !== 1 ? 's' : ''}
                    {regressed.length <= 3 && ': ' + regressed.map(c => c.id).join(', ')}
                  </span>
                </div>
              )}
              {improved.length === 0 && regressed.length === 0 && scoreDelta === 0 && (
                <span className="text-xs" style={{ color: 'var(--text3)' }}>No change in check statuses since first run.</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Top row: ring + stats */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: '160px 1fr' }}>
        <div
          className="flex items-center justify-center rounded-xl p-4 border"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <ScoreRing score={cappedScore} color={grade.color} grade={grade.label} />
        </div>

        {/* Bug 6 fix: responsive grid with NA + uncertain tiles. BUG 19: clickable to checklist. */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          <div className="cursor-pointer" onClick={() => dispatch({ type: 'SET_VIEW', view: 'checklist' })}>
            <StatCard label="Checks Passed" value={passed} unit={`/ ${applicable}`} color="var(--green)" tooltip={`${checks.length} total (${naCt} N/A)`} />
          </div>
          <div className="cursor-pointer" onClick={() => dispatch({ type: 'SET_VIEW', view: 'checklist' })}>
            <StatCard label="Checks Failed" value={failed} unit="" color="var(--red)" />
          </div>
          <div className="cursor-pointer" onClick={() => dispatch({ type: 'SET_VIEW', view: 'checklist' })}>
            <StatCard label="Partial" value={partialCt} unit="" color="var(--amber)" />
          </div>
          {naCt > 0 ? (
            <div
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => toggleTile('na')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTile('na'); } }}
              title="Click to see which checks are not applicable"
            >
              <StatCard
                label={openTile === 'na' ? 'Not Applicable ▾' : 'Not Applicable ▸'}
                value={naCt}
                unit=""
                color="var(--text3)"
              />
            </div>
          ) : (
            <StatCard label="Not Applicable" value={naCt} unit="" color="var(--text3)" />
          )}
          {uncertainCt > 0 && (
            <div
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => toggleTile('uncertain')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTile('uncertain'); } }}
              title="Click to see which checks need more data"
            >
              <StatCard
                label={openTile === 'uncertain' ? 'Needs Data ▾' : 'Needs Data ▸'}
                value={uncertainCt}
                unit=""
                color="var(--text2)"
              />
            </div>
          )}
        </div>
      </div>

      {/* Inline disclosure: which checks are NA / uncertain, and why */}
      {openTile && (() => {
        const list = checks.filter(c => c.status === (openTile === 'na' ? 'na' : 'uncertain'));
        const heading = openTile === 'na' ? 'Not Applicable' : 'Needs Data';
        const intro =
          openTile === 'na'
            ? 'These checks were skipped because they do not apply to your company profile (e.g. GST disabled, no TDS module).'
            : 'These checks could not run because a required input file or value was missing or unparseable.';
        return (
          <div
            className="mb-6 rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text2)' }}>
                  {heading} — {list.length} checks
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{intro}</div>
              </div>
              <button
                onClick={() => setOpenTile(null)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'var(--text3)', background: 'transparent', border: '1px solid var(--border)' }}
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className="divide-y max-h-80 overflow-auto" style={{ borderColor: 'var(--border)' }}>
              {list.map(c => (
                <div key={c.id} className="px-4 py-2.5 flex gap-3 items-start" style={{ borderColor: 'var(--border)' }}>
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                    style={{ background: 'var(--bg3)', color: 'var(--text3)' }}
                    title={DIM_LABELS[c.dim]}
                  >
                    {c.id}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: 'var(--text1)' }}>{c.name}</div>
                    {c.note && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{c.note}</div>
                    )}
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                      {DIM_LABELS[c.dim]}
                    </div>
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text3)' }}>
                  No checks in this category.
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs" style={{ color: 'var(--text3)' }}>{kpi.label}</span>
                {/* Bug 1: ANOMALY pill */}
                {kpi.anomaly && (
                  <span className="badge-critical text-[10px] px-1.5 py-0.5 rounded font-semibold">
                    ANOMALY
                  </span>
                )}
                {/* Bug 1: CRITICAL pill for negative CA Current Ratio */}
                {kpi.critical && (
                  <span className="badge-critical text-[10px] px-1.5 py-0.5 rounded font-semibold">
                    CRITICAL
                  </span>
                )}
              </div>
              <div className="text-xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{kpi.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Critical Flags panel — Bug 4: use failLabel, Bug 7: use deriveSeverity */}
      {topFlags.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Critical Flags
            </div>
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'checklist' })}
              className="text-xs"
              style={{ color: 'var(--teal)' }}
            >
              View all {allFlags.length} →
            </button>
          </div>
          <div className="rounded-xl border overflow-hidden divide-y" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            {topFlags.map(flag => {
              const drillable = hasDrillDown(flag.id, dbStatsRef, parsedData);
              const RowTag: 'button' | 'div' = drillable ? 'button' : 'div';
              return (
                <RowTag
                  key={flag.id}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3 ${drillable ? 'transition-colors hover:bg-[var(--bg3)] cursor-pointer' : ''}`}
                  style={{ borderColor: 'var(--border)' }}
                  {...(drillable ? { onClick: () => setDrillFlag(flag) } : {})}
                >
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5"
                    style={{ background: SEV_BG[flag.severity] ?? 'var(--bg4)', color: SEV_COLORS[flag.severity] ?? 'var(--text2)' }}
                  >
                    {flag.severity.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{flag.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>{flag.detail}</div>
                    {drillable && (
                      <div className="text-xs mt-1" style={{ color: 'var(--teal)' }}>
                        View affected vouchers →
                      </div>
                    )}
                  </div>
                  {flag.count !== undefined && (
                    <div className="text-xs font-mono shrink-0" style={{ color: 'var(--text3)' }}>×{flag.count}</div>
                  )}
                </RowTag>
              );
            })}
          </div>
        </div>
      )}

      {drillFlag && drillFlag.id === 'H4' && (
        <H4Breakdown
          tbLedgers={parsedData.tbLedgers ?? []}
          masterEntries={parsedData.masterEntries ?? []}
          bsStatement={parsedData.bsheetStatement}
          ledgerOverrides={state.ledgerOverrides}
          dbStats={dbStatsRef}
          onClose={() => setDrillFlag(null)}
        />
      )}
      {drillFlag && drillFlag.id === 'E2b' && parsedData.gstWorking && (
        <GSTBreakdown working={parsedData.gstWorking} onClose={() => setDrillFlag(null)} />
      )}
      {drillFlag && (drillFlag.id === 'B2' || drillFlag.id === 'G1' || drillFlag.id === 'G2') && (() => {
        // Ledger-pair drill-downs share one modal; pair source depends
        // on which check is being drilled (see ChecklistView for canonical
        // routing).
        const pairs =
          drillFlag.id === 'G1' ? (parsedData.partySplitPairs   ?? [])
          : drillFlag.id === 'G2' ? (parsedData.expenseSplitPairs ?? [])
                                  : (parsedData.dupPairDetails    ?? []);
        if (pairs.length === 0) return null;
        return (
          <LedgerPairDrillDown
            title={drillFlag.title}
            pairs={pairs}
            onClose={() => setDrillFlag(null)}
          />
        );
      })()}
      {drillFlag && drillFlag.id !== 'H4' && drillFlag.id !== 'E2b' && drillFlag.id !== 'B2' && drillFlag.id !== 'G1' && drillFlag.id !== 'G2' && (() => {
        const drill = getDrillDown(drillFlag.id, drillFlag.title, dbStatsRef, parsedData);
        if (!drill) return null;
        return (
          <VoucherDrillDown
            title={drill.title}
            vouchers={drill.vouchers}
            extraColumns={drill.extraColumns}
            onClose={() => setDrillFlag(null)}
          />
        );
      })()}

      {/* Top Insights panel */}
      {topInsights.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Key Insights
            </div>
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'aiAnalysis' })}
              className="text-xs"
              style={{ color: 'var(--teal)' }}
            >
              View all {allInsights.length} →
            </button>
          </div>
          <div className="space-y-2">
            {topInsights.map(insight => {
              // If the insight points at an engine check that has a
              // drill-down handler (per-voucher / per-ledger / H4 modal),
              // make the whole card clickable and route it through the
              // same setDrillFlag path the Critical Flags panel uses.
              const drillable = !!insight.checkId
                && hasDrillDown(insight.checkId, dbStatsRef, parsedData);
              const handleClick = drillable && insight.checkId
                ? () => setDrillFlag({
                    id: insight.checkId!,
                    severity: insight.urgency === 'high' ? 'high' : insight.urgency === 'medium' ? 'medium' : 'low',
                    title: insight.finding,
                    detail: insight.action,
                  })
                : undefined;
              const Wrapper: 'button' | 'div' = drillable ? 'button' : 'div';
              return (
                <Wrapper
                  key={insight.id}
                  className={`w-full text-left rounded-xl border px-4 py-3 ${drillable ? 'transition-colors hover:bg-[var(--bg3)] cursor-pointer' : ''}`}
                  style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
                  {...(handleClick ? { onClick: handleClick } : {})}
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
                      {drillable && (
                        <div className="text-xs mt-1" style={{ color: 'var(--teal)' }}>
                          View affected vouchers →
                        </div>
                      )}
                    </div>
                  </div>
                </Wrapper>
              );
            })}
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

      {/* Financial Health signals */}
      <HealthSection parsedData={parsedData} dbStats={dbStatsRef} />
    </div>
  );
}

function StatCard({ label, value, unit, color, tooltip }: { label: string; value: number; unit: string; color?: string; tooltip?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }} title={tooltip}>
      <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: color ?? 'var(--text1)' }}>
        {value}
        {unit && <span className="text-sm font-normal ml-1" style={{ color: 'var(--text3)' }}>{unit}</span>}
      </div>
    </div>
  );
}

// ── Financial Health collapsible section ──────────────────────────────────

function HealthSection({ parsedData, dbStats }: { parsedData: Partial<ParsedData>; dbStats: ChunkedStats | null }) {
  const [open, setOpen] = useState(true);
  const signals = generateHealthSignals(parsedData, dbStats);
  if (signals.length === 0) return null;

  const URGENCY: Record<string, string> = {
    critical: 'var(--red)',
    high:     'var(--coral)',
    medium:   'var(--amber)',
    positive: 'var(--teal)',
  };

  return (
    <div className="mt-6 rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 border-b text-left"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
          Financial Health
        </span>
        <span className="text-xs" style={{ color: 'var(--text3)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="grid gap-3 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {signals.map((s, i) => (
            <div key={i} className="rounded-lg border px-4 py-3" style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] px-1 py-0.5 rounded font-medium"
                  style={{
                    color: URGENCY[(s as { urgency?: string }).urgency ?? ''] ?? 'var(--text3)',
                    background: `${URGENCY[(s as { urgency?: string }).urgency ?? ''] ?? '#888'}18`,
                  }}>
                  {s.category}
                </span>
              </div>
              <div className="text-xs mb-0.5" style={{ color: 'var(--text3)' }}>{s.signal}</div>
              <div className="text-lg font-bold" style={{ color: 'var(--text1)' }}>{s.value}</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>{s.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
