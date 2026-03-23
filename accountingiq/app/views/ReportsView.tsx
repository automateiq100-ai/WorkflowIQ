'use client';

import { useApp } from '@/lib/state';
import { getGrade, DIM_LABELS, DIM_WEIGHTS, DIM_COLORS } from '@/lib/constants';
import type { DimKey } from '@/lib/types';

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const PROFILE_LABELS: Record<string, string> = {
  gstApplicable: 'GST Applicable',
  gstRegular:    'GST Regular Scheme',
  tdsApplicable: 'TDS Applicable',
  hasEmployees:  'Has Employees',
  hasFAfilter:   'Has Fixed Assets',
  isGoods:       'Goods Business',
  fullFY:        'Full Financial Year',
};

export default function ReportsView() {
  const { state, dispatch } = useApp();
  const { results, filters, files } = state;

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

  const { cappedScore, scoreCapped, checks, dimScores, runAt } = results;
  const grade = getGrade(cappedScore);
  const runDate = new Date(runAt).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });

  const topFails = checks
    .filter(c => c.status === 'fail' || c.status === 'partial')
    .slice(0, 5);

  const filesLoaded = Object.entries(files)
    .filter(([, f]) => f.hasContent)
    .map(([, f]) => f.name);

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Print button */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1
            className="text-2xl"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            Analysis Report
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
            {runDate}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          ⬡ Print / Save PDF
        </button>
      </div>

      {/* Score summary */}
      <div
        className="rounded-xl border p-6 mb-5"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <div>
            <div
              className="text-5xl font-bold"
              style={{ color: grade.color, fontFamily: 'var(--font-dm-serif)' }}
            >
              {grade.label}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>Grade</div>
          </div>
          <div
            className="w-px h-12 shrink-0"
            style={{ background: 'var(--border)' }}
          />
          <div>
            <div className="text-4xl font-bold" style={{ color: 'var(--text1)' }}>
              {cappedScore}
              <span className="text-base font-normal ml-1" style={{ color: 'var(--text3)' }}>/ 100</span>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
              {scoreCapped ? 'Score capped (DayBook missing)' : 'Overall score'}
            </div>
          </div>
        </div>
      </div>

      {/* Dimension scores */}
      <section className="mb-5">
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          Dimension Scores
        </h2>
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>Dimension</th>
                <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>Weight</th>
                <th className="text-right px-5 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>Score</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {DIMS.map(dim => (
                <tr key={dim}>
                  <td className="px-5 py-2.5">
                    <span className="font-mono text-xs mr-2" style={{ color: DIM_COLORS[dim] }}>{dim}</span>
                    <span style={{ color: 'var(--text1)' }}>{DIM_LABELS[dim]}</span>
                  </td>
                  <td className="px-5 py-2.5" style={{ color: 'var(--text3)' }}>{DIM_WEIGHTS[dim]}%</td>
                  <td className="px-5 py-2.5 text-right font-medium" style={{ color: 'var(--text1)' }}>
                    {dimScores[dim] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top failures */}
      {topFails.length > 0 && (
        <section className="mb-5">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--text3)' }}
          >
            Top Issues
          </h2>
          <div
            className="rounded-xl border overflow-hidden divide-y"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            {topFails.map(check => (
              <div key={check.id} className="px-5 py-3" style={{ borderColor: 'var(--border)' }}>
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
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
                    {check.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Company profile */}
      <section className="mb-5">
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          Company Profile Applied
        </h2>
        <div
          className="rounded-xl border px-5 py-4 flex flex-wrap gap-2"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {Object.entries(filters).map(([key, val]) => (
            <span
              key={key}
              className="text-xs px-2 py-1 rounded"
              style={{
                background: val ? 'rgba(15,212,160,0.1)' : 'var(--bg4)',
                color: val ? 'var(--teal)' : 'var(--text3)',
              }}
            >
              {val ? '✓' : '✕'} {PROFILE_LABELS[key] ?? key}
            </span>
          ))}
        </div>
      </section>

      {/* Files */}
      <section>
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          Files Analysed
        </h2>
        <div
          className="rounded-xl border px-5 py-4"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {filesLoaded.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text3)' }}>None</p>
          ) : (
            <ul className="space-y-1">
              {filesLoaded.map((name, i) => (
                <li key={i} className="text-xs" style={{ color: 'var(--text2)' }}>
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
