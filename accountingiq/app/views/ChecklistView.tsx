'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { DIM_LABELS, DIM_COLORS, DIM_WEIGHTS } from '@/lib/constants';
import StatusBadge from '@/app/components/StatusBadge';
import type { DimKey, FilterMode, Check, AnomalyFlag, Insight } from '@/lib/types';
import { getRemediation } from '@/lib/remediation';
import { generateFlags, deriveSeverity } from '@/lib/flags';
import { getDrillDown, hasDrillDown, isDrillableCheck } from '@/lib/voucher-filters';
import PushToTallyButton from '@/app/components/PushToTallyButton';
import VoucherDrillDown from '@/app/components/VoucherDrillDown';
import H4Breakdown from '@/app/components/H4Breakdown';
import LedgerPairDrillDown from '@/app/components/LedgerPairDrillDown';
import InsightBackup from '@/app/components/InsightBackup';

// Checks whose "backup working" is a structured calculation table (not a
// voucher list).  InsightBackup keys on its synthetic insight.id; map each
// such check id to the matching InsightBackup tab so the drill-down opens
// the right panel.  Extending this map is how we add more backup workings
// — add the check id and pick the InsightBackup section that renders the
// computation.  Currently:
//   pos-arith → ArithmeticBackup (TB Dr/Cr movements, BS net profit, BS equation)
//   pos-gst   → GSTBackup        (Output GST vs sales × slab, ITC checks)
//   pos-recon → ReconBackup      (H2/H3/H5/H6/H7/H8 cross-statement legs)
const BACKUP_CHECK_TO_INSIGHT: Record<string, { backupId: 'pos-arith' | 'pos-gst' | 'pos-recon'; cat: string }> = {
  D1: { backupId: 'pos-arith', cat: 'Arithmetical Accuracy' },
  D2: { backupId: 'pos-arith', cat: 'Arithmetical Accuracy' },
  D3: { backupId: 'pos-arith', cat: 'Arithmetical Accuracy' },
  E1: { backupId: 'pos-gst',   cat: 'Statutory Compliance'  },
  E2b:{ backupId: 'pos-gst',   cat: 'Statutory Compliance'  },
  E11:{ backupId: 'pos-recon', cat: 'Statutory Compliance'  },
  H2: { backupId: 'pos-recon', cat: 'Cross-Statement Reconciliation' },
  H3: { backupId: 'pos-recon', cat: 'Cross-Statement Reconciliation' },
  H5: { backupId: 'pos-recon', cat: 'Cross-Statement Reconciliation' },
  H6: { backupId: 'pos-recon', cat: 'Cross-Statement Reconciliation' },
  H7: { backupId: 'pos-recon', cat: 'Cross-Statement Reconciliation' },
  H8: { backupId: 'pos-recon', cat: 'Cross-Statement Reconciliation' },
};

function makeBackupInsight(check: Check): Insight | null {
  const cfg = BACKUP_CHECK_TO_INSIGHT[check.id];
  if (!cfg) return null;
  return {
    id: cfg.backupId,
    urgency: check.status === 'pass' ? 'positive' : 'high',
    cat: cfg.cat,
    finding: check.failLabel ?? check.name,
    implication: check.note ?? '',
    action: '',
    copyText: '',
    checkId: check.id,
  };
}

function hasBackupWorking(checkId: string): boolean {
  return checkId in BACKUP_CHECK_TO_INSIGHT;
}

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const FILTER_LABELS: { mode: FilterMode; label: string }[] = [
  { mode: 'all',     label: 'All' },
  { mode: 'fails',   label: 'Fails' },
  { mode: 'missing', label: 'Missing' },
  { mode: 'passed',  label: 'Passed' },
  { mode: 'flags',   label: 'Flags' },
];

function matchesFilter(check: Check, mode: FilterMode): boolean {
  switch (mode) {
    case 'fails':   return check.status === 'fail' || check.status === 'partial';
    case 'missing': return check.status === 'missing';
    case 'passed':  return check.status === 'pass';
    default:        return true;
  }
}

function exportDimCSV(checks: Check[], dim: DimKey) {
  const rows = checks.filter(c => c.dim === dim);
  const header = ['ID', 'Dimension', 'Check Name', 'Status', 'Points', 'Max', 'Note'];
  const lines = rows.map(c => {
    // Use failLabel for fail/partial rows to match what the user sees
    // on screen — otherwise the CSV's "Check Name" column shows the
    // generic check title (e.g. "Trial Balance: Dr movement = Cr movement")
    // while the screen shows the failure label (e.g. "Trial Balance does
    // not tally"), and the two would disagree in user-facing reports.
    const isFailing = c.status === 'fail' || c.status === 'partial';
    const displayName = isFailing ? (c.failLabel ?? c.name) : c.name;
    const dimLabel = `"${DIM_LABELS[dim].replace(/"/g, '""')}"`;
    const name = `"${displayName.replace(/"/g, '""')}"`;
    const note = `"${(c.note ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    return [c.id, dimLabel, name, c.status, c.pts, c.max, note].join(',');
  });
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AccountingIQ_${dim}_${DIM_LABELS[dim].replace(/\s+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAllCSV(checks: Check[]) {
  const header = ['ID', 'Dimension', 'Check Name', 'Status', 'Points', 'Max', 'Note'];
  const lines = checks.map(c => {
    const isFailing = c.status === 'fail' || c.status === 'partial';
    const displayName = isFailing ? (c.failLabel ?? c.name) : c.name;
    const dimLabel = `"${DIM_LABELS[c.dim].replace(/"/g, '""')}"`;
    const name = `"${displayName.replace(/"/g, '""')}"`;
    const note = `"${(c.note ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    return [c.id, dimLabel, name, c.status, c.pts, c.max, note].join(',');
  });
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AccountingIQ_Full_Checklist.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChecklistView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, files } = state;
  const [filter, setFilter] = useState<FilterMode>('all');
  const [collapsed, setCollapsed] = useState<Set<DimKey>>(new Set());
  const [drillFlag, setDrillFlag] = useState<AnomalyFlag | null>(null);
  // Per-check drill-down state — independent of the Flags-tab drillFlag so
  // both can coexist (Flags tab passes an AnomalyFlag, dimension rows pass
  // a Check).  Backup state is for InsightBackup-style structured workings
  // on arithmetic / GST checks that don't have a voucher list to render.
  const [drillCheck,  setDrillCheck]  = useState<Check | null>(null);
  const [backupCheck, setBackupCheck] = useState<Check | null>(null);
  const dbStats = files.daybook?.chunkedStats ?? null;

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Run analysis first.{' '}
          <button
            className="underline"
            style={{ color: 'var(--teal)' }}
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
          >
            Upload files
          </button>
        </p>
      </div>
    );
  }

  const { checks } = results;

  function toggleCollapse(dim: DimKey) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(dim)) next.delete(dim);
      else next.add(dim);
      return next;
    });
  }

  const filteredChecks = checks.filter(c => matchesFilter(c, filter));
  const totalCount = filteredChecks.length;

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1
            className="text-2xl"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            Checklist
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
            {filter === 'flags'
              ? `Anomaly flags from failing checks`
              : `${totalCount} check${totalCount !== 1 ? 's' : ''} · 59 total`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Export all CSV */}
          <button
            onClick={() => exportAllCSV(checks)}
            className="text-xs px-3 py-1.5 rounded border transition-colors flex items-center gap-1.5"
            style={{ borderColor: 'var(--border)', color: 'var(--text2)', background: 'var(--bg3)' }}
            title="Export all checks as CSV"
          >
            ↓ Export CSV
          </button>

          {/* Filter tabs */}
          <div
            className="flex rounded-lg border overflow-hidden"
            style={{ borderColor: 'var(--border)' }}
          >
            {FILTER_LABELS.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setFilter(mode)}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: filter === mode ? 'var(--bg4)' : 'var(--bg2)',
                  color: filter === mode ? 'var(--text1)' : 'var(--text3)',
                  borderRight: '1px solid var(--border)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Flags view — only when filter === 'flags'.  Uses the outer
          `dbStats` declared at the top of the component (no shadow). */}
      {filter === 'flags' && (() => {
        const allFlags = generateFlags(results, parsedData, dbStats);
        const severities = ['critical', 'high', 'medium', 'low'] as const;
        const SEV_COLORS: Record<string, string> = { critical: 'var(--red)', high: 'var(--coral)', medium: 'var(--amber)', low: 'var(--text3)' };
        const SEV_BG: Record<string, string> = { critical: 'rgba(240,72,72,0.1)', high: 'rgba(242,107,91,0.1)', medium: 'rgba(245,166,35,0.1)', low: 'rgba(92,99,112,0.08)' };
        if (allFlags.length === 0) {
          return (
            <div className="rounded-xl border p-8 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--teal)' }}>✓ No anomaly flags found.</p>
            </div>
          );
        }
        return (
          <div className="space-y-4">
            {severities.map(sev => {
              const group = allFlags.filter(f => f.severity === sev);
              if (group.length === 0) return null;
              return (
                <div key={sev}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{ color: SEV_COLORS[sev], background: SEV_BG[sev] }}>
                      {sev}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>{group.length} flag{group.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="rounded-xl border overflow-hidden divide-y" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                    {group.map(flag => {
                      const drillable = hasDrillDown(flag.id, dbStats, parsedData);
                      const RowTag: 'button' | 'div' = drillable ? 'button' : 'div';
                      return (
                        <RowTag
                          key={flag.id}
                          className={`w-full text-left flex items-start gap-3 px-4 py-3 ${drillable ? 'transition-colors hover:bg-[var(--bg3)] cursor-pointer' : ''}`}
                          style={{ borderColor: 'var(--border)' }}
                          {...(drillable ? { onClick: () => setDrillFlag(flag) } : {})}
                        >
                          <span className="text-xs font-mono shrink-0 mt-0.5" style={{ color: 'var(--text3)' }}>{flag.id}</span>
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
              );
            })}
          </div>
        );
      })()}

      {/* Drill-down modal for clicking a flag in the Flags tab */}
      {drillFlag && drillFlag.id === 'H4' && (
        <H4Breakdown
          tbLedgers={parsedData.tbLedgers ?? []}
          masterEntries={parsedData.masterEntries ?? []}
          bsStatement={parsedData.bsheetStatement}
          ledgerOverrides={state.ledgerOverrides}
          dbStats={files.daybook?.chunkedStats ?? null}
          onClose={() => setDrillFlag(null)}
        />
      )}
      {drillFlag && drillFlag.id === 'B2' && (
        <LedgerPairDrillDown
          title="Near-duplicate ledger pairs"
          pairs={parsedData.dupPairDetails ?? []}
          onClose={() => setDrillFlag(null)}
        />
      )}
      {drillFlag && drillFlag.id !== 'H4' && drillFlag.id !== 'B2' && (() => {
        const drill = getDrillDown(drillFlag.id, drillFlag.title, dbStats, parsedData);
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

      {/* Drill-down modals for check rows (dimension view) — mirrors the
          flag-drill chain above but keyed on a Check rather than an
          AnomalyFlag, so we don't have to manufacture a fake flag just to
          reuse the existing modal triggers. */}
      {drillCheck && drillCheck.id === 'H4' && (() => {
        const haveData = (parsedData.tbLedgers?.length ?? 0) > 0 || (dbStats?.vouchers?.length ?? 0) > 0;
        if (!haveData) {
          return (
            <ReuploadHintModal
              title={drillCheck.failLabel ?? drillCheck.name}
              checkId={drillCheck.id}
              onClose={() => setDrillCheck(null)}
              dispatch={dispatch}
            />
          );
        }
        return (
          <H4Breakdown
            tbLedgers={parsedData.tbLedgers ?? []}
            masterEntries={parsedData.masterEntries ?? []}
            bsStatement={parsedData.bsheetStatement}
            ledgerOverrides={state.ledgerOverrides}
            dbStats={dbStats}
            onClose={() => setDrillCheck(null)}
          />
        );
      })()}
      {drillCheck && (drillCheck.id === 'B2' || drillCheck.id === 'G1' || drillCheck.id === 'G2') && (() => {
        // Each ledger-pair check pulls from a different parsedData field
        // but shares the same modal shape.
        //   B2 → dupPairDetails       (near-duplicate ledger NAMES)
        //   G1 → partySplitPairs      (debtor ↔ creditor split)
        //   G2 → expenseSplitPairs    (same-name expense across P&L groups)
        const pairs =
          drillCheck.id === 'G1' ? (parsedData.partySplitPairs   ?? [])
          : drillCheck.id === 'G2' ? (parsedData.expenseSplitPairs ?? [])
                                   : (parsedData.dupPairDetails    ?? []);
        if (pairs.length === 0) {
          return (
            <ReuploadHintModal
              title={drillCheck.failLabel ?? drillCheck.name}
              checkId={drillCheck.id}
              onClose={() => setDrillCheck(null)}
              dispatch={dispatch}
            />
          );
        }
        return (
          <LedgerPairDrillDown
            title={drillCheck.failLabel ?? drillCheck.name}
            pairs={pairs}
            onClose={() => setDrillCheck(null)}
          />
        );
      })()}
      {drillCheck && drillCheck.id !== 'H4' && drillCheck.id !== 'B2' && drillCheck.id !== 'G1' && drillCheck.id !== 'G2' && (() => {
        const drill = getDrillDown(
          drillCheck.id,
          drillCheck.failLabel ?? drillCheck.name,
          dbStats,
          parsedData,
        );
        // No raw voucher data — saved analysis from history.  Surface a
        // friendly empty-state instead of silently doing nothing, so the
        // user understands the link works but the data isn't loaded yet.
        if (!drill) {
          return (
            <ReuploadHintModal
              title={drillCheck.failLabel ?? drillCheck.name}
              checkId={drillCheck.id}
              onClose={() => setDrillCheck(null)}
              dispatch={dispatch}
            />
          );
        }
        return (
          <VoucherDrillDown
            title={drill.title}
            vouchers={drill.vouchers}
            extraColumns={drill.extraColumns}
            onClose={() => setDrillCheck(null)}
          />
        );
      })()}

      {/* Structured "View working" backup for checks where the audit
          finding is a computation, not a voucher list — D1/D2/D3
          arithmetic, E1/E2b GST, H2/H3/H5/H6/H7/H8 cross-statement
          reconciliation.  Renders the same panel the AI Analysis view
          uses for positive insights so both surfaces stay in lockstep. */}
      {backupCheck && (() => {
        const insight = makeBackupInsight(backupCheck);
        if (!insight) return null;
        return (
          <InsightBackup
            insight={insight}
            parsedData={parsedData}
            dbStats={dbStats}
            onClose={() => setBackupCheck(null)}
          />
        );
      })()}

      {/* Dimensions — hidden when showing Flags */}
      {filter !== 'flags' && (
        <div className="space-y-3">
        {DIMS.map(dim => {
          const dimChecks = filteredChecks.filter(c => c.dim === dim);
          const allDimChecks = checks.filter(c => c.dim === dim);
          if (dimChecks.length === 0) return null;
          const isCollapsed = collapsed.has(dim);
          const color = DIM_COLORS[dim];

          return (
            <div
              key={dim}
              className="rounded-xl border overflow-hidden"
              style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            >
              {/* Dim header */}
              <div className="flex items-center pr-2" style={{ borderBottom: isCollapsed ? 'none' : `1px solid var(--border)` }}>
                <button
                  className="flex-1 flex items-center gap-3 px-5 py-3 text-left"
                  onClick={() => toggleCollapse(dim)}
                >
                  <span className="w-6 text-xs font-bold font-mono text-center shrink-0" style={{ color }}>
                    {dim}
                  </span>
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--text1)' }}>
                    {DIM_LABELS[dim]}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    {DIM_WEIGHTS[dim]}% weight
                  </span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text3)' }}>
                    {dimChecks.length} check{dimChecks.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs ml-1" style={{ color: 'var(--text3)' }}>
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                </button>

                {/* Per-dimension CSV export */}
                <button
                  onClick={(e) => { e.stopPropagation(); exportDimCSV(allDimChecks, dim); }}
                  className="text-xs px-2 py-1 rounded border transition-colors shrink-0"
                  style={{ borderColor: 'var(--border)', color: 'var(--text3)', background: 'var(--bg3)' }}
                  title={`Export ${dim} checks as CSV`}
                >
                  ↓ CSV
                </button>
              </div>

              {/* Checks */}
              {!isCollapsed && (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {dimChecks.map(check => {
                    // Show the drill-down link whenever the check has a
                    // drill-down handler (isDrillableCheck), even if the
                    // raw voucher data isn't currently loaded.  The click
                    // handler / modal surfaces a re-upload prompt in that
                    // case — better UX than silently hiding the link, which
                    // leaves the user wondering why some checks have a
                    // drill-down and others don't.
                    const canDrillVouchers = isDrillableCheck(check.id);
                    const canShowBackup    = hasBackupWorking(check.id);
                    return (
                      <CheckRow
                        key={check.id}
                        check={check}
                        canDrillVouchers={canDrillVouchers}
                        canShowBackup={canShowBackup}
                        onDrillVouchers={canDrillVouchers ? () => setDrillCheck(check) : undefined}
                        onShowBackup={canShowBackup    ? () => setBackupCheck(check) : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function CheckRow({
  check,
  canDrillVouchers,
  canShowBackup,
  onDrillVouchers,
  onShowBackup,
}: {
  check: Check;
  canDrillVouchers: boolean;
  canShowBackup: boolean;
  onDrillVouchers?: () => void;
  onShowBackup?: () => void;
}) {
  const { state, dispatch } = useApp();
  const [showFix, setShowFix] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const isFailing = check.status === 'fail' || check.status === 'partial';
  const displayName = isFailing ? (check.failLabel ?? check.name) : check.name;
  const remediation = getRemediation(check, state.parsedData ?? {});
  // AI per-check explanation — sourced from the cached AI analysis run.
  // Falls back to the "Get AI explanation →" link that navigates to the
  // AI Report tab when AI hasn't been run yet for this analysis.
  const aiExplanation = state.aiAnalysis?.checkExplanations?.[check.id];
  const aiAvailable = !!aiExplanation;
  // Drill-downs are useful on passes too (e.g. user wants to see the
  // computation that earned a green check), so we expose them regardless
  // of status.  Only the remediation / AI explanation buttons stay
  // gated to failures.
  const hasAnyDrill = canDrillVouchers || canShowBackup;

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 px-5 py-3">
        <StatusBadge status={check.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono" style={{ color: 'var(--text3)' }}>
              {check.id}
            </span>
            <span className="text-sm" style={{ color: 'var(--text1)' }}>
              {displayName}
            </span>
          </div>
          {check.note && (
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text2)' }}>
              {check.note}
            </p>
          )}
          {(isFailing || hasAnyDrill) && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {canDrillVouchers && onDrillVouchers && (
                <button
                  onClick={onDrillVouchers}
                  className="text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ color: 'var(--teal)' }}
                >
                  View affected vouchers →
                </button>
              )}
              {canShowBackup && onShowBackup && (
                <button
                  onClick={onShowBackup}
                  className="text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ color: 'var(--teal)' }}
                >
                  View working →
                </button>
              )}
              {isFailing && remediation && (
                <button
                  onClick={() => setShowFix(v => !v)}
                  className="text-xs font-medium transition-colors"
                  style={{ color: showFix ? 'var(--amber)' : 'var(--teal)' }}
                >
                  {showFix ? '↑ Hide fix' : '🔧 How to fix'}
                </button>
              )}
              {/* AI explanation CTA — three visually distinct states so
                  the user always knows what clicking will do:
                    1. cached  → filled purple "AI explanation" pill that toggles inline
                    2. uncached + consent given → outlined dashed "Generate AI explanation →" (clicks AI Report tab to run it)
                    3. no consent → muted "Enable AI explanations" (clicks AI Report tab to consent gate)
              */}
              {isFailing && aiAvailable && (
                <button
                  onClick={() => setShowAI(v => !v)}
                  className="text-xs font-medium transition-colors flex items-center gap-1"
                  style={{ color: showAI ? 'var(--amber)' : 'var(--purple)' }}
                >
                  <span
                    className="text-[9px] font-bold px-1 py-0.5 rounded"
                    style={{ background: showAI ? 'var(--amber)' : 'var(--purple)', color: '#fff' }}
                  >✨</span>
                  {showAI ? '↑ Hide explanation' : 'Explanation'}
                </button>
              )}
              {isFailing && !aiAvailable && state.aiConsentGiven && (
                <button
                  onClick={() => dispatch({ type: 'SET_VIEW', view: 'aiAnalysis' })}
                  className="text-xs flex items-center gap-1 transition-opacity hover:opacity-80"
                  style={{ color: 'var(--purple)', border: '1px dashed var(--purple)', borderRadius: 4, padding: '1px 6px' }}
                >
                  <span
                    className="text-[9px] font-bold px-1 py-0.5 rounded"
                    style={{ background: 'transparent', color: 'var(--purple)', border: '1px solid var(--purple)' }}
                  >✨</span>
                  Generate explanation →
                </button>
              )}
              {isFailing && !aiAvailable && !state.aiConsentGiven && (
                <button
                  onClick={() => dispatch({ type: 'SET_VIEW', view: 'aiAnalysis' })}
                  className="text-xs transition-colors"
                  style={{ color: 'var(--text3)' }}
                  title="Opt in on the Insights Report tab to enable per-check explanations"
                >
                  🔒 Enable explanations
                </button>
              )}
              {isFailing && <PushToTallyButton check={check} parsedData={state.parsedData ?? {}} />}
            </div>
          )}
        </div>

        {/* Score */}
        {check.max > 0 && (
          <div className="text-xs shrink-0 text-right" style={{ color: 'var(--text3)' }}>
            <span style={{ color: 'var(--text1)' }}>{check.pts}</span>/{check.max}
          </div>
        )}
      </div>

      {/* Remediation panel */}
      {showFix && remediation && (
        <div
          className="mx-5 mb-3 px-4 py-3 rounded-lg text-xs leading-relaxed"
          style={{
            background: 'rgba(82,196,169,0.07)',
            border: '1px solid rgba(82,196,169,0.2)',
            color: 'var(--text2)',
          }}
        >
          <div className="font-semibold mb-1" style={{ color: 'var(--teal)' }}>
            How to fix — {check.id}
          </div>
          {remediation}
        </div>
      )}

      {/* AI explanation panel — opens inline so the user doesn't lose
          context by navigating to the AI Report tab.  Surfaces:
            - rationale: why this check failed for THIS company (cites
              numbers from check.note)
            - impact: downstream effects on other checks / metrics
            - fixSteps: ordered concrete actions
          Sourced from AIResponse.checkExplanations populated by /api/ai. */}
      {showAI && aiExplanation && (
        <div
          className="mx-5 mb-3 px-4 py-3 rounded-lg text-xs leading-relaxed space-y-3"
          style={{
            background: 'rgba(155,89,182,0.07)',
            border: '1px solid rgba(155,89,182,0.2)',
            color: 'var(--text2)',
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'var(--purple)', color: '#fff' }}
            >✨</span>
            <span className="font-semibold" style={{ color: 'var(--purple)' }}>
              Why this failed — {check.id}
            </span>
          </div>
          <div>{aiExplanation.rationale}</div>
          {aiExplanation.impact && (
            <div>
              <span className="font-semibold" style={{ color: 'var(--text1)' }}>Impact: </span>
              {aiExplanation.impact}
            </div>
          )}
          {aiExplanation.fixSteps.length > 0 && (
            <div>
              <div className="font-semibold mb-1" style={{ color: 'var(--text1)' }}>Fix steps:</div>
              <ol className="space-y-1 ml-1">
                {aiExplanation.fixSteps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono shrink-0" style={{ color: 'var(--purple)' }}>{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Modal shown when a check is drillable but the raw voucher data hasn't
// been loaded (e.g. user is viewing a saved analysis from history — per
// data-state notes, /api/analysis/save only persists checks + scores, not
// the raw dbStats / parsedData).  Tells the user to re-upload to unlock
// the drill-down, with a one-click jump to the Upload view.
function ReuploadHintModal({
  title, checkId, onClose, dispatch,
}: {
  title: string;
  checkId: string;
  onClose: () => void;
  dispatch: (a: { type: 'SET_VIEW'; view: 'upload' }) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border w-full max-w-md"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold mb-0.5 truncate" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              {checkId} — {title}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>Voucher details unavailable</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none px-2 py-0.5 rounded shrink-0" style={{ color: 'var(--text3)' }} aria-label="Close">×</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>
            This check has voucher-level backup, but the raw DayBook data isn&apos;t loaded in this session.
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text3)' }}>
            Saved analyses persist the score and findings, but not the underlying voucher rows. Re-upload your Tally export to view the affected vouchers.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { dispatch({ type: 'SET_VIEW', view: 'upload' }); onClose(); }}
              className="text-xs px-4 py-2 rounded-lg font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--teal)', color: '#000' }}
            >
              Go to Upload →
            </button>
            <button
              onClick={onClose}
              className="text-xs px-4 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
