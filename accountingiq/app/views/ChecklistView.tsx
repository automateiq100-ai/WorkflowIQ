'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { DIM_LABELS, DIM_COLORS } from '@/lib/constants';
import StatusBadge from '@/app/components/StatusBadge';
import type { DimKey, FilterMode, Check } from '@/lib/types';

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const FILTER_LABELS: { mode: FilterMode; label: string }[] = [
  { mode: 'all',     label: 'All' },
  { mode: 'fails',   label: 'Fails' },
  { mode: 'missing', label: 'Missing' },
  { mode: 'passed',  label: 'Passed' },
];

function matchesFilter(check: Check, mode: FilterMode): boolean {
  switch (mode) {
    case 'fails':   return check.status === 'fail' || check.status === 'partial';
    case 'missing': return check.status === 'missing';
    case 'passed':  return check.status === 'pass';
    default:        return true;
  }
}

export default function ChecklistView() {
  const { state, dispatch } = useApp();
  const { results } = state;
  const [filter, setFilter] = useState<FilterMode>('all');
  const [collapsed, setCollapsed] = useState<Set<DimKey>>(new Set());

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
            {totalCount} check{totalCount !== 1 ? 's' : ''} · 59 total
          </p>
        </div>

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

      {/* Dimensions */}
      <div className="space-y-3">
        {DIMS.map(dim => {
          const dimChecks = filteredChecks.filter(c => c.dim === dim);
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
              <button
                className="w-full flex items-center gap-3 px-5 py-3 text-left"
                onClick={() => toggleCollapse(dim)}
              >
                <span
                  className="w-6 text-xs font-bold font-mono text-center shrink-0"
                  style={{ color }}
                >
                  {dim}
                </span>
                <span className="text-sm font-medium flex-1" style={{ color: 'var(--text1)' }}>
                  {DIM_LABELS[dim]}
                </span>
                <span className="text-xs" style={{ color: 'var(--text3)' }}>
                  {dimChecks.length} check{dimChecks.length !== 1 ? 's' : ''}
                </span>
                <span className="text-xs ml-1" style={{ color: 'var(--text3)' }}>
                  {isCollapsed ? '▶' : '▼'}
                </span>
              </button>

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
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <StatusBadge status={check.status} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-mono"
            style={{ color: 'var(--text3)' }}
          >
            {check.id}
          </span>
          <span className="text-sm" style={{ color: 'var(--text1)' }}>
            {check.name}
          </span>
        </div>
        {check.note && (
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text2)' }}>
            {check.note}
          </p>
        )}
      </div>

      {/* Score */}
      {check.max > 0 && (
        <div className="text-xs shrink-0 text-right" style={{ color: 'var(--text3)' }}>
          <span style={{ color: 'var(--text1)' }}>{check.pts}</span>/{check.max}
        </div>
      )}
    </div>
  );
}
