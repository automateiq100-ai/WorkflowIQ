'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { DIM_LABELS, DIM_COLORS, DIM_WEIGHTS } from '@/lib/constants';
import StatusBadge from '@/app/components/StatusBadge';
import type { DimKey, FilterMode, Check, AnomalyFlag } from '@/lib/types';
import { getRemediation } from '@/lib/remediation';
import { generateFlags, deriveSeverity } from '@/lib/flags';
import { getDrillDown, hasDrillDown } from '@/lib/voucher-filters';
import PushToTallyButton from '@/app/components/PushToTallyButton';
import VoucherDrillDown from '@/app/components/VoucherDrillDown';

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
    const dimLabel = `"${DIM_LABELS[dim].replace(/"/g, '""')}"`;
    const name = `"${c.name.replace(/"/g, '""')}"`;
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
    const dimLabel = `"${DIM_LABELS[c.dim].replace(/"/g, '""')}"`;
    const name = `"${c.name.replace(/"/g, '""')}"`;
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

      {/* Flags view — only when filter === 'flags' */}
      {filter === 'flags' && (() => {
        const dbStats = files.daybook?.chunkedStats ?? null;
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
      {drillFlag && (() => {
        const dbStats = files.daybook?.chunkedStats ?? null;
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
                  {dimChecks.map(check => (
                    <CheckRow key={check.id} check={check} />
                  ))}
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

function CheckRow({ check }: { check: Check }) {
  const { state, dispatch } = useApp();
  const [showFix, setShowFix] = useState(false);
  const isFailing = check.status === 'fail' || check.status === 'partial';
  const displayName = isFailing ? (check.failLabel ?? check.name) : check.name;
  const remediation = getRemediation(check, state.parsedData ?? {});

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
          {isFailing && (
            <div className="flex items-center gap-3 mt-1.5">
              {remediation && (
                <button
                  onClick={() => setShowFix(v => !v)}
                  className="text-xs font-medium transition-colors"
                  style={{ color: showFix ? 'var(--amber)' : 'var(--teal)' }}
                >
                  {showFix ? '↑ Hide fix' : '🔧 How to fix'}
                </button>
              )}
              <button
                onClick={() => dispatch({ type: 'SET_VIEW', view: 'aiAnalysis' })}
                className="text-xs transition-colors"
                style={{ color: 'var(--purple)' }}
              >
                Get AI explanation →
              </button>
              <PushToTallyButton check={check} parsedData={state.parsedData ?? {}} />
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
    </div>
  );
}
