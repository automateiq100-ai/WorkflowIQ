'use client';

/**
 * MIS Analysis — readiness score + gap list with remediation actions.
 * Extracted from the old MISReportView "MIS Score" tab.
 */

import { useApp } from '@/lib/state';
import { runMIS } from '@/lib/layer2/mis/runner';
import { ALL_MIS_METRICS, MIS_DOMAINS } from '@/lib/layer2/mis/metrics';
import { STATUS_WEIGHT } from '@/lib/layer2/types';
import { CHART_COLORS } from './atoms';

const STATUS_TINT: Record<string, { bg: string; fg: string; label: string }> = {
  auto:      { bg: 'rgba(76,175,121,0.12)',  fg: CHART_COLORS.green,  label: '✓ Auto' },
  partial:   { bg: 'rgba(245,166,35,0.12)',  fg: CHART_COLORS.amber,  label: '◐ Partial' },
  manual:    { bg: 'rgba(242,107,91,0.12)',  fg: CHART_COLORS.coral,  label: '✎ Manual' },
  'new-xml': { bg: 'rgba(240,72,72,0.12)',   fg: CHART_COLORS.red,    label: '📎 New XML' },
};

export default function MISAnalysisView() {
  const { state } = useApp();
  const { results, misSetup } = state;
  const out = runMIS({ state, manual: state.misManualInputs ?? {}, budget: state.misBudget });

  const selectedIds = misSetup.selectedMetricIds.length > 0
    ? misSetup.selectedMetricIds
    : ALL_MIS_METRICS.map(m => m.id);
  const selectedMetrics = ALL_MIS_METRICS.filter(m => selectedIds.includes(m.id));

  const { l1Score, readinessPct, misScore, potentialScore, gaps } = out.readiness;

  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          MIS Analysis
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
          Readiness score, domain-wise breakdown, and gaps that block the most metrics.
        </p>
      </div>

      {!results && (
        <div className="rounded-xl border p-5 text-center text-sm" style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)' }}>
          Complete accounting analysis first. Go to <strong style={{ color: 'var(--text2)' }}>Account Health → Upload Files</strong>.
        </div>
      )}

      {results && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <ScoreCard value={misScore} label="MIS Score" sub={`Books: ${l1Score} · Readiness: ${Math.round(readinessPct * 100)}%`} color={CHART_COLORS.teal} highlight />
            <ScoreCard value={potentialScore} label="Potential Score" sub="If all missing data is provided" color={CHART_COLORS.blue} />
            <ScoreCard value={gaps.length} label="Gaps to Fill" sub="Manual or missing XML metrics" color={CHART_COLORS.amber} />
          </div>

          {l1Score < 50 && (
            <div className="rounded-lg border px-4 py-3 text-sm" style={{ background: 'rgba(240,72,72,0.08)', borderColor: 'rgba(240,72,72,0.3)', color: CHART_COLORS.red }}>
              ⚠ Accounting health score is below 50. MIS can still be generated but reliability may be limited. Fix critical issues first.
            </div>
          )}

          <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            <div className="px-5 py-3 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
              Domain-wise Readiness
            </div>
            {MIS_DOMAINS.map(domain => {
              const domainSelected = domain.metrics.filter(m => selectedIds.includes(m.id));
              const domainComputable = domainSelected.reduce((s, m) => s + STATUS_WEIGHT[m.defaultStatus], 0);
              const domainReadiness = domainSelected.length > 0 ? domainComputable / domainSelected.length : 0;
              const autoCount = domainSelected.filter(m => m.defaultStatus === 'auto').length;
              const partialCount = domainSelected.filter(m => m.defaultStatus === 'partial').length;
              const gapCount = domainSelected.filter(m => m.defaultStatus === 'manual' || m.defaultStatus === 'new-xml').length;
              return (
                <div key={domain.id} className="flex items-center gap-4 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="w-44 shrink-0">
                    <div className="text-xs font-medium" style={{ color: 'var(--text1)' }}>{domain.label}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      {autoCount} auto · {partialCount} partial · {gapCount} gap
                    </div>
                  </div>
                  <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--bg4)' }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${domainReadiness * 100}%`,
                      background: domainReadiness > 0.8 ? CHART_COLORS.green : domainReadiness > 0.5 ? CHART_COLORS.amber : CHART_COLORS.red,
                    }} />
                  </div>
                  <div className="w-10 text-right text-sm font-medium shrink-0 tabular-nums" style={{ color: 'var(--text1)' }}>
                    {Math.round(domainReadiness * 100)}%
                  </div>
                </div>
              );
            })}
          </div>

          {gaps.length > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="px-5 py-3 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
                Gap Analysis — Actions to Improve Score
              </div>
              {gaps.map(g => {
                const tint = STATUS_TINT[g.status];
                return (
                  <div key={g.id} className="flex items-start gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded mt-0.5 font-medium" style={{ background: tint.bg, color: tint.fg }}>
                      {tint.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium" style={{ color: 'var(--text1)' }}>{g.label}</div>
                      <div className="text-xs mt-1" style={{ color: CHART_COLORS.teal }}>→ {g.remediation}</div>
                    </div>
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: CHART_COLORS.teal }}>+{g.scoreImpact} pts</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ScoreCard({ value, label, sub, color, highlight }: { value: number; label: string; sub: string; color: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border-2 p-5 text-center" style={{
      background: highlight ? `${color}15` : 'var(--bg2)',
      borderColor: highlight ? color : 'var(--border)',
    }}>
      <div className="text-4xl font-bold mb-1 tabular-nums" style={{ color }}>{value}</div>
      <div className="text-xs font-medium" style={{ color: 'var(--text2)' }}>{label}</div>
      <div className="text-[10px] mt-2" style={{ color: 'var(--text3)' }}>{sub}</div>
    </div>
  );
}
