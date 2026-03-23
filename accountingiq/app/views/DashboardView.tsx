'use client';

import { useApp } from '@/lib/state';
import { getGrade, DIM_LABELS, DIM_WEIGHTS, DIM_COLORS } from '@/lib/constants';
import ScoreRing from '@/app/components/ScoreRing';
import type { DimKey } from '@/lib/types';

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export default function DashboardView() {
  const { state, dispatch } = useApp();
  const { results, files } = state;

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

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
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
      <div
        className="grid gap-4 mb-6"
        style={{ gridTemplateColumns: '160px 1fr' }}
      >
        {/* Score ring */}
        <div
          className="flex items-center justify-center rounded-xl p-4 border"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <ScoreRing score={cappedScore} color={grade.color} grade={grade.label} />
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Files Uploaded" value={filesLoaded} unit="/ 13" />
          <StatCard label="Checks Passed" value={passed} unit="" color="var(--green)" />
          <StatCard label="Checks Failed" value={failed} unit="" color="var(--red)" />
          <StatCard label="Partial" value={partial} unit="" color="var(--amber)" />
        </div>
      </div>

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
              <div
                key={dim}
                className="flex items-center gap-4 px-5 py-3"
              >
                {/* Dim key */}
                <div
                  className="w-6 text-xs font-bold font-mono shrink-0 text-center"
                  style={{ color }}
                >
                  {dim}
                </div>

                {/* Label + weight */}
                <div className="w-48 shrink-0">
                  <div className="text-sm" style={{ color: 'var(--text1)' }}>
                    {DIM_LABELS[dim]}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text3)' }}>
                    {weight}% weight
                  </div>
                </div>

                {/* Bar */}
                <div
                  className="flex-1 h-1.5 rounded-full"
                  style={{ background: 'var(--bg4)' }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${score}%`, background: color }}
                  />
                </div>

                {/* Score */}
                <div
                  className="w-10 text-right text-sm font-medium shrink-0"
                  style={{ color: 'var(--text1)' }}
                >
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

function StatCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}
    >
      <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: color ?? 'var(--text1)' }}>
        {value}
        {unit && <span className="text-sm font-normal ml-1" style={{ color: 'var(--text3)' }}>{unit}</span>}
      </div>
    </div>
  );
}
