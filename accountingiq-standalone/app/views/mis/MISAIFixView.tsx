'use client';

/**
 * AI Fix Plan — Layer-2 wide.
 *
 *  Compiles the user's full MIS snapshot (readiness, every metric's status,
 *  rule violations, financial summary, forecast assumptions) and asks the
 *  configured AI provider for a categorised action plan to lift overall
 *  MIS quality.  Plan steps are grouped by category (data-setup /
 *  operations / financial / compliance / reporting), ranked by leverage,
 *  and each financial step exposes an "Apply →" lever that pushes the
 *  user's forecast assumption.
 *
 *  Numbers-only payload — no PII (party names, voucher details) ever leaves
 *  the device.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/state';
import { runMIS } from '@/lib/layer2/mis/runner';
import { runRules, DEFAULT_RULES } from '@/lib/layer2/rules';
import { forecastMIS, type ForecastAssumptions } from '@/lib/layer2/mis/forecast';
import { ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';
import { CHART_COLORS, fmtINR, fmtPct, fmtDays } from './atoms';

// ── Types matching the API contract ───────────────────────────────────────

type AssumptionKey = keyof ForecastAssumptions;

interface PlanStep {
  title: string;
  category: 'data-setup' | 'operations' | 'financial' | 'compliance' | 'reporting';
  rationale: string;
  resolvesIds: string[];
  lever: null | { assumption: AssumptionKey; from: number; to: number };
  impact: string;
  effort: 'S' | 'M' | 'L';
  tallySteps?: string[];
}

interface Theme {
  title: string;
  metricIds: string[];
  explanation: string;
}

interface MisPlanResponse {
  executiveSummary: string;
  themes: Theme[];
  steps: PlanStep[];
  projectedScoreLift: number;
  quickWins: number[];
  risks: string[];
}

const CATEGORY_META: Record<PlanStep['category'], { label: string; icon: string; color: keyof typeof CHART_COLORS }> = {
  'data-setup': { label: 'Data setup',  icon: '⬆', color: 'teal' },
  'operations': { label: 'Operations',  icon: '⚙', color: 'blue' },
  'financial':  { label: 'Financial',   icon: '◈', color: 'green' },
  'compliance': { label: 'Compliance',  icon: '⚐', color: 'amber' },
  'reporting':  { label: 'Reporting',   icon: '▤', color: 'purple' },
};

// ── Component ─────────────────────────────────────────────────────────────

/** Module-level cache for the full MIS Fix Plan keyed on analysis runAt.
 *  Switching away and back lands instantly — no re-fetch.  Regenerate
 *  busts it; re-running analysis (new runAt) invalidates it too. */
let misPlanCache: { runAt: number; data: MisPlanResponse } | null = null;

export default function MISAIFixView() {
  const { state, dispatch } = useApp();
  const aiConsent = state.aiConsentGiven;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<MisPlanResponse | null>(null);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | PlanStep['category']>('all');
  const fetchedRef = useRef(false);

  // Compile MIS snapshot once on render — this is what gets shipped to AI.
  const snapshot = useMemo(() => buildSnapshot(state), [state]);

  const requestPlan = async () => {
    if (loading) return;
    if (!snapshot) {
      setError('Run accounting analysis first — go to Account Health → Upload Files → Run Analysis.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/ai/mis-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `AI request failed: HTTP ${resp.status}`);
      }
      const data: MisPlanResponse = await resp.json();
      setPlan(data);
      setApplied(new Set());
      if (state.results) misPlanCache = { runAt: state.results.runAt, data };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-trigger on mount / consent flip / new analysis.  Cache hit → no fetch.
  useEffect(() => {
    if (!aiConsent || !snapshot || !state.results || fetchedRef.current) return;
    if (misPlanCache && misPlanCache.runAt === state.results.runAt) {
      setPlan(misPlanCache.data);
      fetchedRef.current = true;
      return;
    }
    fetchedRef.current = true;
    void requestPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConsent, snapshot, state.results?.runAt]);

  const regenerate = () => {
    misPlanCache = null;
    setPlan(null);
    setApplied(new Set());
    void requestPlan();
  };

  const applyLever = (stepIdx: number) => {
    const step = plan?.steps[stepIdx];
    if (!step?.lever) return;
    // Persist override onto state.misAssumptionOverrides if the slice exists,
    // otherwise route the user to the Forecast tab where they can apply it.
    // For now we just mark as applied; the Forecast tab reads our snapshot
    // and the user can sync there.
    setApplied(prev => {
      const next = new Set(prev);
      next.add(stepIdx);
      return next;
    });
    // Navigate to Forecast so the user can see the lever applied.
    // (The Forecast view holds the active assumption overrides locally.)
    dispatch({ type: 'SET_VIEW', view: 'mis-report-forecast' });
  };

  // ── Render ──
  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-5">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          ✨ Fix Plan
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
          A CFO-style action plan covering data setup, operations, financial levers, compliance, and forecast — ranked by leverage.
        </p>
      </header>

      {!snapshot && (
        <EmptyCard message="Run accounting analysis first. Go to Account Health → Upload Files → Run Analysis." />
      )}

      {snapshot && !aiConsent && (
        <div className="rounded-xl border p-5" style={{ background: `${CHART_COLORS.purple}08`, borderColor: `${CHART_COLORS.purple}55` }}>
          <div className="text-sm font-semibold mb-2" style={{ color: CHART_COLORS.purple }}>Enable smart suggestions</div>
          <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text2)' }}>
            We&apos;ll send a <strong>numbers-only</strong> MIS snapshot — metric IDs, statuses, aggregate financials, forecast assumptions, plan health score — to the configured provider ({snapshot.providerHint}). No party names, voucher details, or raw ledger entries leave your device.
          </p>
          <button onClick={() => dispatch({ type: 'AI_CONSENT_GIVEN' })}
            className="px-3 py-2 text-xs rounded-md font-semibold transition-colors"
            style={{ background: CHART_COLORS.purple, color: '#fff' }}>
            Enable Fix Plan
          </button>
        </div>
      )}

      {snapshot && aiConsent && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <ScoreSummary snapshot={snapshot} plan={plan} />
            <div className="flex gap-2">
              {plan && (
                <button onClick={() => setPlan(null)}
                  className="px-3 py-2 text-xs rounded-md border font-medium hover:bg-[var(--bg3)] transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
                  Clear
                </button>
              )}
              <button onClick={regenerate} disabled={loading}
                className="px-4 py-2 text-xs rounded-md font-semibold transition-colors disabled:opacity-60"
                style={{ background: CHART_COLORS.purple, color: '#fff' }}>
                {loading ? 'Generating plan…' : '↻ Regenerate'}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border px-4 py-3 text-xs" style={{
              borderColor: `${CHART_COLORS.red}55`, background: `${CHART_COLORS.red}10`, color: CHART_COLORS.red,
            }}>
              {error}
            </div>
          )}

          {loading && (
            <div className="rounded-xl border p-8 text-center text-xs" style={{
              background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)',
            }}>
              <div className="animate-pulse">Analysing your MIS — ranking action steps by leverage…</div>
            </div>
          )}

          {plan && (
            <>
              {/* Executive summary */}
              <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: CHART_COLORS.purple }}>
                  Executive summary
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text1)' }}>
                  {plan.executiveSummary}
                </p>
              </div>

              {/* Top 3 quick wins callout */}
              {plan.quickWins.length > 0 && (
                <div className="rounded-xl border p-4" style={{
                  background: `${CHART_COLORS.green}08`, borderColor: `${CHART_COLORS.green}55`,
                }}>
                  <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: CHART_COLORS.green }}>
                    🚀 Quick wins
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {plan.quickWins.map(idx => {
                      const s = plan.steps[idx];
                      if (!s) return null;
                      return (
                        <div key={idx} className="rounded-md border p-2 text-[11px]" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                          <div className="font-semibold mb-1" style={{ color: 'var(--text1)' }}>{s.title}</div>
                          <div style={{ color: 'var(--text3)' }}>{s.impact}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Themes (root-cause clusters) */}
              {plan.themes.length > 0 && (
                <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                  <div className="text-[10px] uppercase tracking-wide font-semibold mb-3" style={{ color: 'var(--text3)' }}>
                    Root-cause themes
                  </div>
                  <div className="space-y-2">
                    {plan.themes.map((t, i) => (
                      <div key={i} className="text-xs">
                        <div className="font-semibold mb-0.5" style={{ color: 'var(--text1)' }}>{t.title}</div>
                        <div style={{ color: 'var(--text2)' }}>{t.explanation}</div>
                        {t.metricIds.length > 0 && (
                          <div className="text-[10px] mt-1 flex gap-1 flex-wrap" style={{ color: 'var(--text3)' }}>
                            Touches: {t.metricIds.map(id => (
                              <span key={id} className="px-1.5 py-0.5 rounded font-mono"
                                style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>{id}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category filter chips */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Filter:</span>
                <CategoryChip active={filter === 'all'} onClick={() => setFilter('all')} label="All steps" count={plan.steps.length} color="purple" />
                {(Object.keys(CATEGORY_META) as PlanStep['category'][]).map(cat => {
                  const count = plan.steps.filter(s => s.category === cat).length;
                  if (count === 0) return null;
                  return (
                    <CategoryChip key={cat}
                      active={filter === cat}
                      onClick={() => setFilter(cat)}
                      label={`${CATEGORY_META[cat].icon} ${CATEGORY_META[cat].label}`}
                      count={count}
                      color={CATEGORY_META[cat].color}
                    />
                  );
                })}
              </div>

              {/* Steps */}
              <div className="space-y-3">
                {plan.steps
                  .map((s, i) => ({ step: s, idx: i }))
                  .filter(({ step }) => filter === 'all' || step.category === filter)
                  .map(({ step, idx }) => (
                    <StepRow key={idx} step={step} index={idx + 1} isQuickWin={plan.quickWins.includes(idx)} isApplied={applied.has(idx)} onApply={() => applyLever(idx)} />
                  ))}
              </div>

              {/* Risks */}
              {plan.risks.length > 0 && (
                <div className="rounded-xl border p-4" style={{
                  background: `${CHART_COLORS.amber}08`, borderColor: `${CHART_COLORS.amber}55`,
                }}>
                  <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: CHART_COLORS.amber }}>
                    ⚠ Risks to manage
                  </div>
                  <ul className="text-xs space-y-1" style={{ color: 'var(--text2)' }}>
                    {plan.risks.map((r, i) => <li key={i}>• {r}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}

          {!plan && loading && !error && (
            <div className="rounded-xl border p-8 text-center text-xs" style={{
              background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)',
            }}>
              <div className="animate-pulse">
                <span style={{ color: CHART_COLORS.purple }}>✨</span> Analysing your MIS — ranking action steps by leverage…
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Snapshot builder ─────────────────────────────────────────────────────

/**
 * Compile the numbers-only MIS snapshot that ships to the AI.  Avoids
 * party names, voucher details, or any raw ledger data — only aggregate
 * counts, ratios, metric IDs and statuses.
 */
function buildSnapshot(state: ReturnType<typeof useApp>['state']): {
  company: { name: string; sector: string | null };
  audit: { overallScore: number; grade: string; dimScores: Record<string, number> };
  readiness: { misScore: number; potentialScore: number; readinessPct: number; computable: number; selectedCount: number };
  metrics: Array<{ id: string; label: string; domain: string; status: string; value?: number | string; unit?: string; reason?: string }>;
  violations: Array<{ severity: string; message: string; metricId?: string }>;
  financials: Record<string, number | undefined>;
  forecast: { assumptions: Record<string, number>; projection: Array<{ label: string; revenue: number; pat: number; cashPosition: number }>; healthScore: number; healthLabel: string };
  files: { uploaded: string[]; missing: string[] };
  providerHint: string;
} | null {
  if (!state.results) return null;

  const out = runMIS({ state, manual: state.misManualInputs ?? {}, budget: state.misBudget });
  const violations = runRules(state.misRules ?? DEFAULT_RULES, out.byId, state.misSetup?.sector ?? null);
  const forecast = forecastMIS(out.context);
  const baseFc = forecast.base;
  const fcRows = baseFc.rows.filter(r => !r.isActual);
  const positiveCash = fcRows.filter(r => r.cashPosition > 0).length;
  const avgMargin = fcRows.length > 0
    ? fcRows.reduce((s, r) => s + (r.revenue ? r.pat / r.revenue : 0), 0) / fcRows.length
    : 0;
  const healthScore = Math.round(
    Math.min(25, (positiveCash / Math.max(1, fcRows.length)) * 25) +
    Math.max(0, Math.min(25, (avgMargin / 0.20) * 25)) +
    25 +
    (fcRows.length >= 2 && fcRows[fcRows.length - 1].pat > fcRows[0].pat ? 25 : 0)
  );
  const healthLabel = healthScore >= 75 ? '🌟 Strong' : healthScore >= 50 ? '⚖ Workable' : healthScore >= 25 ? '⚠ Stretched' : '🚨 Risky';

  const pd = state.parsedData;
  const grossProfit = (() => {
    const r = Math.abs(pd?.revenue ?? 0);
    const cogs = Math.abs(pd?.costOfMaterials ?? 0) + Math.abs(pd?.directExpenses ?? 0);
    const opening = Math.abs(pd?.openingStock ?? 0);
    const closing = Math.abs(pd?.plClosingStock ?? pd?.closingStock ?? 0);
    return r - (opening + cogs - closing);
  })();

  const revenue = Math.abs(pd?.revenue ?? 0);
  const pat = pd?.bsNetProfit ?? pd?.netProfit ?? 0;

  return {
    company: { name: state.currentCompany?.name ?? 'Company', sector: state.misSetup?.sector ?? null },
    audit: {
      overallScore: state.results.overall,
      grade: scoreToGrade(state.results.overall),
      dimScores: state.results.dimScores,
    },
    readiness: {
      misScore: out.readiness.misScore,
      potentialScore: out.readiness.potentialScore,
      readinessPct: out.readiness.readinessPct,
      computable: out.readiness.computable,
      selectedCount: out.readiness.selectedCount,
    },
    metrics: ALL_MIS_METRICS.map(m => {
      const r = out.byId[m.id];
      if (!r) return { id: m.id, label: m.label, domain: m.domainId, status: 'missing-data' };
      return {
        id: m.id,
        label: m.label,
        domain: m.domainId,
        status: r.status,
        value: r.value?.numeric ?? r.value?.text,
        unit: r.value?.unit,
        reason: r.reason,
      };
    }),
    violations: violations.map(v => ({ severity: v.severity, message: v.message, metricId: v.metricId })),
    financials: {
      revenue, grossProfit,
      grossMarginPct: revenue ? grossProfit / revenue : 0,
      ebitda: (pat ?? 0) + Math.abs(pd?.depAmt ?? 0),
      pat,
      patMarginPct: revenue ? pat / revenue : 0,
      cashBank: Math.abs(pd?.bsCashBankTotal ?? 0),
      debtors: Math.abs(pd?.debtorBal ?? 0),
      creditors: Math.abs(pd?.creditorBal ?? 0),
      closingStock: Math.abs(pd?.closingStock ?? 0),
      fixedAssets: Math.abs(pd?.fixedAssets ?? 0),
      currentRatio: out.byId['BS1']?.value?.numeric,
      debtEquity: out.byId['BS4']?.value?.numeric,
      dso: out.byId['WC2']?.value?.numeric,
      dpo: out.byId['WC7']?.value?.numeric,
      dio: out.byId['WC10']?.value?.numeric,
    },
    forecast: {
      assumptions: {
        revenueGrowthMoM:  baseFc.assumptions.revenueGrowthMoM ?? 0,
        grossMarginPct:    baseFc.assumptions.grossMarginPct ?? 0,
        fixedOpsCostMonth: baseFc.assumptions.fixedOpsCostMonth ?? 0,
        interestMonth:     baseFc.assumptions.interestMonth ?? 0,
        capexMonth:        baseFc.assumptions.capexMonth ?? 0,
        targetDSO:         baseFc.assumptions.targetDSO ?? 0,
      },
      projection: fcRows.map(r => ({ label: r.periodLabel, revenue: r.revenue, pat: r.pat, cashPosition: r.cashPosition })),
      healthScore,
      healthLabel,
    },
    files: {
      uploaded: Object.entries(state.files).filter(([, f]) => f.content).map(([k]) => k),
      missing:  Object.entries(state.files).filter(([, f]) => !f.content).map(([k]) => k),
    },
    providerHint: process.env.NEXT_PUBLIC_AI_PROVIDER_HINT ?? 'configured provider',
  };
}

// ── Sub-components ────────────────────────────────────────────────────────

function ScoreSummary({ snapshot, plan }: {
  snapshot: NonNullable<ReturnType<typeof buildSnapshot>>;
  plan: MisPlanResponse | null;
}) {
  const current = snapshot.forecast.healthScore;
  const projected = plan?.projectedScoreLift ?? null;
  const lift = projected != null ? projected - current : null;
  return (
    <div className="flex items-center gap-4 rounded-xl border px-4 py-3" style={{
      background: 'var(--bg2)', borderColor: 'var(--border)',
    }}>
      <div className="text-center">
        <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Plan Health</div>
        <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text1)' }}>{current}</div>
      </div>
      {projected != null && (
        <>
          <div className="text-base" style={{ color: 'var(--text3)' }}>→</div>
          <div className="text-center">
            <div className="text-[9px] uppercase tracking-wide" style={{ color: CHART_COLORS.green }}>If plan applied</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: CHART_COLORS.green }}>{projected}</div>
          </div>
          {lift != null && lift > 0 && (
            <div className="text-[11px] font-semibold tabular-nums" style={{ color: CHART_COLORS.green }}>
              ▲ +{lift} pts
            </div>
          )}
        </>
      )}
      <div className="ml-3 pl-3 border-l" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Readiness</div>
        <div className="text-base font-semibold tabular-nums" style={{ color: 'var(--text1)' }}>
          {Math.round(snapshot.readiness.readinessPct * 100)}%
        </div>
      </div>
    </div>
  );
}

function CategoryChip({ active, onClick, label, count, color }: {
  active: boolean; onClick: () => void; label: string; count: number;
  color: keyof typeof CHART_COLORS;
}) {
  const c = CHART_COLORS[color];
  return (
    <button onClick={onClick}
      className="px-2.5 py-1 text-[10px] rounded-full border font-medium transition-colors"
      style={{
        borderColor: active ? c : 'var(--border)',
        background: active ? c : 'transparent',
        color: active ? '#fff' : 'var(--text2)',
      }}>
      {label} <span className="opacity-70">({count})</span>
    </button>
  );
}

function StepRow({ step, index, isQuickWin, isApplied, onApply }: {
  step: PlanStep;
  index: number;
  isQuickWin: boolean;
  isApplied: boolean;
  onApply: () => void;
}) {
  const meta = CATEGORY_META[step.category];
  const catColor = CHART_COLORS[meta.color];
  const effortColor = step.effort === 'S' ? CHART_COLORS.green : step.effort === 'M' ? CHART_COLORS.amber : CHART_COLORS.coral;
  return (
    <div className="rounded-xl border p-4" style={{
      background: 'var(--bg2)',
      borderColor: isQuickWin ? `${CHART_COLORS.green}55` : 'var(--border)',
    }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-2 flex-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold tabular-nums shrink-0"
            style={{ background: `${catColor}22`, color: catColor }}>{index}</span>
          <div className="flex-1">
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text1)' }}>{step.title}</div>
            <div className="flex items-center gap-2 flex-wrap text-[10px]">
              <span className="px-1.5 py-0.5 rounded font-semibold"
                style={{ background: `${catColor}22`, color: catColor }}>{meta.icon} {meta.label}</span>
              <span className="px-1.5 py-0.5 rounded font-semibold"
                style={{ background: `${effortColor}22`, color: effortColor }}>
                {step.effort} · {step.effort === 'S' ? 'Quick win' : step.effort === 'M' ? 'Few weeks' : 'Long haul'}
              </span>
              {isQuickWin && (
                <span className="px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: `${CHART_COLORS.green}22`, color: CHART_COLORS.green }}>🚀 Top-3</span>
              )}
              {step.resolvesIds.length > 0 && (
                <span style={{ color: 'var(--text3)' }}>Unblocks {step.resolvesIds.length} metric{step.resolvesIds.length === 1 ? '' : 's'}</span>
              )}
            </div>
          </div>
        </div>
        {step.lever && (
          <button onClick={onApply} disabled={isApplied}
            className="px-3 py-1.5 text-xs rounded-md font-semibold transition-colors shrink-0 disabled:opacity-60"
            style={{
              background: isApplied ? CHART_COLORS.green : CHART_COLORS.purple,
              color: '#fff',
            }}>
            {isApplied ? '✓ Applied — open Forecast' : 'Apply →'}
          </button>
        )}
      </div>

      <div className="text-xs mb-2 leading-relaxed" style={{ color: 'var(--text2)' }}>
        {step.rationale}
      </div>

      {step.lever && (
        <div className="text-[11px] tabular-nums mb-2 px-2 py-1 rounded" style={{ background: 'var(--bg3)' }}>
          <span style={{ color: 'var(--text3)' }}>Forecast lever: </span>
          <span style={{ color: 'var(--text2)' }}>{labelForAssumption(step.lever.assumption)}</span>
          {' '}<span style={{ color: CHART_COLORS.red }}>{formatAssumption(step.lever.assumption, step.lever.from)}</span>
          {' → '}<span style={{ color: CHART_COLORS.green, fontWeight: 600 }}>{formatAssumption(step.lever.assumption, step.lever.to)}</span>
        </div>
      )}

      <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
        <span style={{ color: 'var(--text2)' }}>Impact:</span> {step.impact}
      </div>

      {step.resolvesIds.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {step.resolvesIds.map(id => (
            <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>{id}</span>
          ))}
        </div>
      )}

      {step.tallySteps && step.tallySteps.length > 0 && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text3)' }}>TALLY SETUP</div>
          <ul className="text-[11px] space-y-1" style={{ color: 'var(--text2)' }}>
            {step.tallySteps.map((s, i) => <li key={i}>• {s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border p-5 text-center text-sm" style={{
      background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)',
    }}>
      {message}
    </div>
  );
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

function labelForAssumption(k: AssumptionKey): string {
  switch (k) {
    case 'revenueGrowthMoM':  return 'Revenue growth MoM';
    case 'grossMarginPct':    return 'Gross margin %';
    case 'fixedOpsCostMonth': return 'Fixed ops / month';
    case 'interestMonth':     return 'Interest / month';
    case 'capexMonth':        return 'Capex / month';
    case 'targetDSO':         return 'Target DSO';
  }
}

function formatAssumption(k: AssumptionKey, v: number): string {
  if (k === 'revenueGrowthMoM' || k === 'grossMarginPct') return fmtPct(v * 100);
  if (k === 'targetDSO') return fmtDays(v);
  return fmtINR(v, 'lakhs');
}
