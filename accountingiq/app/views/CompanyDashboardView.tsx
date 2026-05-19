'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/lib/state';
import { getGrade } from '@/lib/constants';
import { companyToFilters } from '@/lib/types';
import type { Company } from '@/lib/types';

interface AnalysisRun {
  id: string;
  run_at: string;
  overall_score: number;
  capped_score: number;
  score_capped: boolean;
  period_type: string | null;
  period_start: string | null;
  period_end: string | null;
}

const PREF_TAGS: { key: keyof Company; label: string }[] = [
  { key: 'gst_applicable', label: 'GST' },
  { key: 'gst_regular',    label: 'GST Reg.' },
  { key: 'tds_applicable', label: 'TDS' },
  { key: 'has_employees',  label: 'Employees' },
  { key: 'has_fa_filter',  label: 'Fixed Assets' },
  { key: 'is_goods',       label: 'Goods' },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PeriodLabel({ run }: { run: AnalysisRun }) {
  if (!run.period_type) return <span style={{ color: 'var(--text3)' }}>—</span>;
  if (run.period_type === 'custom' && run.period_start && run.period_end) {
    return <span>{fmtDate(run.period_start)} – {fmtDate(run.period_end)}</span>;
  }
  return <span className="capitalize">{run.period_type}</span>;
}

export default function CompanyDashboardView() {
  const { state, dispatch } = useApp();
  const { currentCompany, analysed } = state;

  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentCompany) return;
    let cancelled = false;
    setLoading(true);

    async function loadHistory(): Promise<unknown[]> {
      const r = await fetch(`/api/analysis/history?company_id=${currentCompany!.id}&limit=5`);
      const data = await r.json();
      return data.runs ?? [];
    }

    Promise.all([
      loadHistory(),
      fetch(`/api/companies/${currentCompany.id}`).then(r => r.json()),
    ]).then(async ([histRuns, compData]) => {
      if (cancelled) return;
      // Race-safety: the /api/analysis/save call from UploadView is
      // fire-and-forget (.catch() => {}), and routing to this view can
      // happen before the save's POST completes (~250-650ms per
      // server logs).  If history comes back empty BUT we have a
      // fresh local results.runAt, the save is likely still in flight.
      // Retry once after 1s — typically by then it's landed.
      const noServerRuns = !histRuns || (histRuns as unknown[]).length === 0;
      const hasLocalRun = !!state.results?.runAt;
      if (noServerRuns && hasLocalRun) {
        await new Promise(r => setTimeout(r, 1000));
        if (cancelled) return;
        try {
          const retried = await loadHistory();
          if (cancelled) return;
          setRuns(retried as AnalysisRun[]);
        } catch { /* keep empty */ }
      } else {
        setRuns(histRuns as AnalysisRun[]);
      }
      setCompany(compData.company ?? null);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
    // Re-fetch when `analysed` flips false → true so a fresh save shows
    // up on the "Last Analysis" panel without needing a manual refresh
    // or company-switch round-trip.  Also re-fetch when `results?.runAt`
    // changes — covers re-runs (analysed stays true so it alone wouldn't
    // trip a re-fetch).
  }, [currentCompany?.id, analysed, state.results?.runAt]);

  if (!currentCompany) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          No company selected.{' '}
          <button
            className="underline"
            style={{ color: 'var(--teal)' }}
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'company-select' })}
          >
            Go to Companies
          </button>
        </p>
      </div>
    );
  }

  // Prefer DB history (canonical source of truth across sessions/devices)
  // but fall back to in-memory state.results when DB is empty AND the
  // user has a fresh local analysis.  This covers three corner cases:
  //   1. The /api/analysis/save call (fire-and-forget from UploadView)
  //      hasn't completed yet — the 1s retry above handles most of this
  //      but a slow DB write can still beat us.
  //   2. The current user logged in as a different identity than the one
  //      that ran the save — owner_user_id filter excludes the saved runs.
  //   3. The company_id was null at save time (a known race when the user
  //      ran analysis before fully selecting a company).
  // In all three, the in-memory results are the only thing the user can
  // see for THIS session, so we synthesize an AnalysisRun-shaped object
  // from state.results to keep the panel useful.
  const latestRun: AnalysisRun | null = runs[0] ?? (state.results ? {
    id: 'local-' + state.results.runAt,
    run_at: new Date(state.results.runAt).toISOString(),
    overall_score: state.results.overall,
    capped_score:  state.results.cappedScore,
    score_capped:  state.results.scoreCapped,
    period_type:   null,
    period_start:  null,
    period_end:    null,
  } : null);
  const isLocalOnly = !runs[0] && !!latestRun;
  const grade = latestRun ? getGrade(latestRun.overall_score) : null;

  // Manual refresh handler — re-fetch history without needing to switch
  // companies.  Useful when the save POST completed slightly later than
  // the dashboard's auto-fetch (network jitter, slow Supabase write, etc.).
  function handleRefresh() {
    if (!currentCompany) return;
    setLoading(true);
    fetch(`/api/analysis/history?company_id=${currentCompany.id}&limit=5`)
      .then(r => r.json())
      .then(data => setRuns(data.runs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  const companyInitials = currentCompany.name
    .split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">

      {/* Company header */}
      <div
        className="rounded-2xl border p-6 mb-6 flex items-start gap-5"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          {companyInitials}
        </div>
        <div className="flex-1 min-w-0">
          <h1
            className="text-2xl mb-1 truncate"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            {currentCompany.name}
          </h1>
          <div className="flex flex-wrap gap-2 mt-2">
            {currentCompany.companyType && (
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: 'var(--bg4)', color: 'var(--text2)', border: '1px solid var(--border)' }}
              >
                {currentCompany.companyType}
              </span>
            )}
            {company && PREF_TAGS.filter(t => company[t.key]).map(t => (
              <span
                key={t.key}
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: 'rgba(82,196,169,0.1)', color: 'var(--teal)' }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'company-select' })}
          className="text-xs px-3 py-1.5 rounded-lg border transition-colors shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text1)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
        >
          Edit
        </button>
      </div>

      {/* Quick actions + last score row */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Last analysis score */}
        <div
          className="rounded-xl border p-5 flex flex-col gap-2"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Last Analysis
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="text-xs px-1.5 py-0.5 rounded transition-colors"
              style={{ color: loading ? 'var(--text3)' : 'var(--teal)', opacity: loading ? 0.5 : 1 }}
              title="Refresh from server"
              aria-label="Refresh last analysis"
            >
              ↻
            </button>
          </div>
          {loading ? (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>Loading…</div>
          ) : latestRun ? (
            <div className="flex items-end gap-3">
              <span
                className="text-4xl font-bold"
                style={{ color: grade?.color ?? 'var(--text1)', fontFamily: 'var(--font-dm-serif)' }}
              >
                {latestRun.overall_score}
              </span>
              <div className="mb-1">
                <div
                  className="text-xs font-bold px-2 py-0.5 rounded"
                  style={{ background: grade?.color, color: '#000', display: 'inline-block' }}
                >
                  {grade?.label}
                </div>
                {latestRun.score_capped && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--amber)' }}>⚠ capped</div>
                )}
                {isLocalOnly && (
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>
                    ⓘ in-memory · save still syncing
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm" style={{ color: 'var(--text3)' }}>No analysis yet</div>
          )}
          {latestRun && (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              {fmtDate(latestRun.run_at)}
              {latestRun.period_type && (
                <span className="ml-2 capitalize">· {latestRun.period_type}</span>
              )}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div
          className="rounded-xl border p-5 flex flex-col gap-2.5"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>
            Quick Actions
          </div>
          <button
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
            className="w-full py-2 px-3 rounded-lg text-sm font-semibold text-left transition-opacity"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            ⬆ Upload New Files
          </button>
          {analysed && (
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}
              className="w-full py-2 px-3 rounded-lg text-sm font-medium text-left transition-colors"
              style={{ background: 'var(--bg3)', color: 'var(--text1)', border: '1px solid var(--border)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--teal)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              ⬡ View Current Results
            </button>
          )}
          <button
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'profile' })}
            className="w-full py-2 px-3 rounded-lg text-sm font-medium text-left transition-colors"
            style={{ background: 'var(--bg3)', color: 'var(--text1)', border: '1px solid var(--border)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--teal)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            ◎ Company Profile
          </button>
        </div>
      </div>

      {/* Recent runs table */}
      {!loading && runs.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <div
            className="px-5 py-3 border-b text-xs font-semibold uppercase tracking-wider"
            style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
          >
            Recent Analysis Runs
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Score', 'Period', ''].map(h => (
                  <th
                    key={h}
                    className="px-5 py-2.5 text-left text-xs font-medium"
                    style={{ color: 'var(--text3)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => {
                const g = getGrade(run.overall_score);
                return (
                  <tr
                    key={run.id}
                    style={{
                      borderBottom: i < runs.length - 1 ? '1px solid var(--border)' : undefined,
                    }}
                  >
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text2)' }}>
                      {fmtDate(run.run_at)}
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-semibold" style={{ color: g.color }}>
                        {run.overall_score}
                      </span>
                      <span
                        className="ml-1.5 text-xs px-1.5 py-0.5 rounded font-bold"
                        style={{ background: g.color, color: '#000' }}
                      >
                        {g.label}
                      </span>
                      {run.score_capped && (
                        <span className="ml-1 text-xs" style={{ color: 'var(--amber)' }}>⚠</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text2)' }}>
                      <PeriodLabel run={run} />
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text3)' }}>
                      {i === 0 && (
                        <span
                          className="px-2 py-0.5 rounded-full text-xs"
                          style={{ background: 'rgba(82,196,169,0.1)', color: 'var(--teal)' }}
                        >
                          latest
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
