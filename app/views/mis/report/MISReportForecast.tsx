'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip as ReTip, XAxis, YAxis,
} from 'recharts';
import ReportLayout, { useMIS } from '../ReportLayout';
import {
  type ReportUnit, fmtINR, fmtPct, fmtDays, CHART_COLORS, CHART_GRID, CHART_AXIS,
  tooltipStyle, SectionPanel, ChartCard, EmptyChart, AIObservationsPlaceholder,
} from '../atoms';
import { forecastMIS, type ForecastAssumptions, type ScenarioForecast } from '@/lib/layer2/mis/forecast';
import { useApp } from '@/lib/state';

// ── AI Fix Plan types ─────────────────────────────────────────────────────

type AssumptionKey = keyof ForecastAssumptions;

interface PlanStep {
  title: string;
  rationale: string;
  lever: null | { assumption: AssumptionKey; from: number; to: number };
  impact: string;
  effort: 'S' | 'M' | 'L';
  tallySteps?: string[];
}

interface ForecastPlanResponse {
  executiveSummary: string;
  steps: PlanStep[];
  projectedScoreLift: number;
  risks: string[];
}

export default function MISReportForecast() {
  return <ReportLayout><ForecastContent /></ReportLayout>;
}

// ── What-if presets ───────────────────────────────────────────────────────

type PresetKey = 'aggressive' | 'cost-cut' | 'team-up' | 'cash-sprint';

const PRESETS: Record<PresetKey, { label: string; emoji: string; apply: (base: ForecastAssumptions) => Partial<ForecastAssumptions> }> = {
  'aggressive':  { label: 'Aggressive growth',  emoji: '🚀', apply: (b) => ({ revenueGrowthMoM: (b.revenueGrowthMoM ?? 0) + 0.05, grossMarginPct: (b.grossMarginPct ?? 0.28) + 0.02 }) },
  'cost-cut':    { label: 'Cost cut −10%',      emoji: '✂',  apply: (b) => ({ fixedOpsCostMonth: (b.fixedOpsCostMonth ?? 0) * 0.90 }) },
  'team-up':     { label: 'Hire team (+20% ops)', emoji: '👥', apply: (b) => ({ fixedOpsCostMonth: (b.fixedOpsCostMonth ?? 0) * 1.20 }) },
  'cash-sprint': { label: 'Collect faster (DSO −15d)', emoji: '⚡', apply: (b) => ({ targetDSO: Math.max(15, (b.targetDSO ?? 45) - 15) }) },
};

function ForecastContent() {
  const { out, forecast: baseForecast, unit, traceToBackup } = useMIS();
  const { state, dispatch } = useApp();
  const baseAssumptions = baseForecast.base.assumptions;

  const [overrides, setOverrides] = useState<Partial<ForecastAssumptions>>({});
  const [scenario, setScenario] = useState<'base' | 'upside' | 'downside' | 'custom'>('base');

  // AI Fix Plan state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPlan, setAiPlan] = useState<ForecastPlanResponse | null>(null);
  const aiFetchedRef = useRef(false);

  // ── Resolve effective assumptions (auto-derived ⨯ user overrides) ──
  const effective: ForecastAssumptions = {
    revenueGrowthMoM:  overrides.revenueGrowthMoM  ?? baseAssumptions.revenueGrowthMoM  ?? 0,
    grossMarginPct:    overrides.grossMarginPct    ?? baseAssumptions.grossMarginPct    ?? 0.28,
    fixedOpsCostMonth: overrides.fixedOpsCostMonth ?? baseAssumptions.fixedOpsCostMonth ?? 0,
    interestMonth:     overrides.interestMonth     ?? baseAssumptions.interestMonth     ?? 0,
    capexMonth:        overrides.capexMonth        ?? baseAssumptions.capexMonth        ?? 0,
    targetDSO:         overrides.targetDSO         ?? baseAssumptions.targetDSO         ?? 45,
  };

  // ── Custom scenario — recomputed live as overrides change ──
  const customForecast = useMemo(
    () => forecastMIS(out.context, overrides),
    [out.context, overrides],
  );
  const customScenario: ScenarioForecast = customForecast.base; // base case with overrides

  const sc = scenario === 'custom' ? customScenario : baseForecast[scenario];
  const chartData = sc.rows.map(r => ({
    label: r.periodLabel.replace(' (F)', ''),
    revenue: r.revenue, pat: r.pat, isActual: r.isActual,
  }));

  const hasOverride = Object.keys(overrides).length > 0;
  const setOverride = <K extends keyof ForecastAssumptions>(key: K, value: ForecastAssumptions[K] | undefined) => {
    setScenario('custom');
    setOverrides(prev => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  const resetAll = () => { setOverrides({}); setScenario('base'); };
  const applyPreset = (k: PresetKey) => {
    setScenario('custom');
    setOverrides(prev => ({ ...prev, ...PRESETS[k].apply(baseAssumptions) }));
  };

  // ── Plan Health Score (0-100) — fun, glanceable indicator ──
  const health = computeHealthScore(sc, baseAssumptions);

  // ── AI Fix Plan fetch ──
  const requestAIPlan = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const currentPeriod = out.context.current;
      const pd = currentPeriod.parsedData;
      const projectionRows = sc.rows.filter(r => !r.isActual).map(r => ({
        label: r.periodLabel.replace(' (F)', ''),
        revenue: r.revenue,
        pat: r.pat,
        cashPosition: r.cashPosition,
        grossProfitPct: r.grossProfitPct,
      }));
      const currentRevenue = Math.abs(pd.revenue ?? 0);
      const currentPat = pd.bsNetProfit ?? pd.netProfit ?? 0;
      const body = {
        current: {
          revenue: currentRevenue,
          grossProfitPct: sc.rows[0]?.grossProfitPct ?? 0,
          ebitda: sc.rows[0]?.ebitda ?? 0,
          pat: currentPat,
          patMarginPct: currentRevenue ? currentPat / currentRevenue : 0,
          cashPosition: Math.abs(pd.bsCashBankTotal ?? 0),
          debtors: Math.abs(pd.debtorBal ?? 0),
          creditors: Math.abs(pd.creditorBal ?? 0),
          closingStock: Math.abs(pd.closingStock ?? 0),
        },
        assumptions: {
          revenueGrowthMoM:  effective.revenueGrowthMoM  ?? 0,
          grossMarginPct:    effective.grossMarginPct    ?? 0.28,
          fixedOpsCostMonth: effective.fixedOpsCostMonth ?? 0,
          interestMonth:     effective.interestMonth     ?? 0,
          capexMonth:        effective.capexMonth        ?? 0,
          targetDSO:         effective.targetDSO         ?? 45,
        },
        projection: projectionRows,
        health: {
          score: health.score,
          label: health.label,
          cashPositiveMonths: projectionRows.filter(r => r.cashPosition > 0).length,
          avgPatMarginPct: projectionRows.length > 0
            ? projectionRows.reduce((s, r) => s + (r.revenue ? r.pat / r.revenue : 0), 0) / projectionRows.length
            : 0,
          growthDeltaPct: (effective.revenueGrowthMoM ?? 0) - (baseAssumptions.revenueGrowthMoM ?? 0),
          patTrendingUp: projectionRows.length >= 2 && projectionRows[projectionRows.length - 1].pat > projectionRows[0].pat,
        },
        sector: state.misSetup?.sector ?? null,
        history: {
          avgMoMGrowthPct: baseAssumptions.revenueGrowthMoM ?? 0,
          avgGrossMarginPct: baseAssumptions.grossMarginPct ?? 0,
          monthsTracked: out.context.history.length,
        },
      };
      const resp = await fetch('/api/ai/forecast-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `AI request failed: HTTP ${resp.status}`);
      }
      const plan: ForecastPlanResponse = await resp.json();
      setAiPlan(plan);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  };

  const applyLever = (lever: NonNullable<PlanStep['lever']>) => {
    setOverride(lever.assumption, lever.to);
  };

  const applyAllLevers = () => {
    if (!aiPlan) return;
    const next: Partial<ForecastAssumptions> = { ...overrides };
    for (const step of aiPlan.steps) {
      if (step.lever) next[step.lever.assumption] = step.lever.to;
    }
    setScenario('custom');
    setOverrides(next);
  };

  const aiConsent = state.aiConsentGiven;

  // Auto-fire the AI plan once on consent + analysis-loaded.  Tab switches
  // don't refetch because aiFetchedRef stays true until the user clicks
  // Regenerate (which resets it inside requestAIPlan via setAiPlan(null)).
  useEffect(() => {
    if (!aiConsent || !state.results || aiFetchedRef.current) return;
    aiFetchedRef.current = true;
    void requestAIPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConsent, state.results?.runAt]);

  const regenerateAIPlan = () => {
    aiFetchedRef.current = false;
    setAiPlan(null);
    void requestAIPlan();
  };

  return (
    <SectionPanel title="Forecast" accent="forecast" blurb="3-month projection. Edit assumptions to see Revenue & PAT respond in real time.">

      {/* Scenario chips + Plan Health Score */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {(['base', 'upside', 'downside'] as const).map(s => (
            <button key={s} onClick={() => { setScenario(s); setOverrides({}); }}
              className="px-4 py-2 text-xs rounded-full border font-medium transition-colors"
              style={{
                borderColor: scenario === s ? CHART_COLORS.blue : 'var(--border)',
                background: scenario === s ? CHART_COLORS.blue : 'transparent',
                color: scenario === s ? '#fff' : 'var(--text2)',
              }}>
              {s === 'base' ? 'Base case' : s === 'upside' ? 'Upside (+15%)' : 'Downside (−10%)'}
            </button>
          ))}
          <button
            onClick={() => setScenario('custom')}
            className="px-4 py-2 text-xs rounded-full border font-medium transition-colors"
            style={{
              borderColor: scenario === 'custom' ? CHART_COLORS.purple : 'var(--border)',
              background: scenario === 'custom' ? CHART_COLORS.purple : 'transparent',
              color: scenario === 'custom' ? '#fff' : 'var(--text2)',
            }}>
            🎛 Your plan
          </button>
        </div>
        <HealthBadge score={health.score} label={health.label} achievements={health.achievements} />
      </div>

      {/* What-if preset buttons */}
      <div className="rounded-xl border p-3" style={{
        background: 'rgba(155,127,232,0.04)',
        borderColor: 'rgba(155,127,232,0.20)',
      }}>
        <div className="text-[10px] uppercase tracking-wide font-semibold mb-2 flex items-center justify-between" style={{ color: CHART_COLORS.purple }}>
          <span>What-if scenarios — click to apply</span>
          {hasOverride && (
            <button onClick={resetAll} className="text-[10px] hover:underline normal-case" style={{ color: CHART_COLORS.purple }}>
              ↺ Reset all overrides
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(PRESETS) as PresetKey[]).map(k => (
            <button key={k} onClick={() => applyPreset(k)}
              className="px-3 py-1.5 text-[11px] rounded-md border transition-colors hover:bg-[var(--bg3)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}>
              {PRESETS[k].emoji} {PRESETS[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* Revenue & PAT chart */}
      <ChartCard title={`Revenue & PAT projection · ${scenario === 'custom' ? 'Your plan' : sc.label ?? scenario}`} height={260}>
        {chartData.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
              <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text2)' }} iconType="circle" />
              <Line type="monotone" dataKey="revenue" name="Revenue" stroke={CHART_COLORS.teal} strokeWidth={2} dot={{ fill: CHART_COLORS.teal, r: 4 }} />
              <Line type="monotone" dataKey="pat"     name="PAT"     stroke={CHART_COLORS.green} strokeWidth={2} dot={{ fill: CHART_COLORS.green, r: 4 }} strokeDasharray="6 3" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <EmptyChart message="Forecast needs at least one analysed period" />}
      </ChartCard>

      {/* Forecast table with deltas */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--bg3)' }}>
            <tr>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Period</th>
              <ColHeader label="Revenue" metricId="P1" onTrace={traceToBackup} />
              <ColHeader label="GP %"    metricId="P5" onTrace={traceToBackup} />
              <ColHeader label="EBITDA"  metricId="P6" onTrace={traceToBackup} />
              <ColHeader label="PAT"     metricId="P7" onTrace={traceToBackup} />
              <ColHeader label="Cash"    metricId="CF1" onTrace={traceToBackup} />
              <ColHeader label="DSO"     metricId="WC2" onTrace={traceToBackup} />
            </tr>
          </thead>
          <tbody>
            {sc.rows.map((r, i) => {
              const baseRow = baseForecast.base.rows[i];
              const showDelta = scenario === 'custom' && baseRow && !r.isActual;
              return (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-3 py-2" style={{ color: r.isActual ? 'var(--text1)' : CHART_COLORS.blue, fontWeight: r.isActual ? 600 : 400 }}>{r.periodLabel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtINR(r.revenue, unit)}{showDelta && <DeltaBadge curr={r.revenue} base={baseRow.revenue} />}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.grossProfitPct * 100)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtINR(r.ebitda, unit)}{showDelta && <DeltaBadge curr={r.ebitda} base={baseRow.ebitda} />}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtINR(r.pat, unit)}{showDelta && <DeltaBadge curr={r.pat} base={baseRow.pat} />}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtINR(r.cashPosition, unit)}{showDelta && <DeltaBadge curr={r.cashPosition} base={baseRow.cashPosition} />}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtDays(r.dso)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Editable assumptions */}
      <div className="rounded-xl border p-4" style={{
        background: 'rgba(245,166,35,0.04)',
        borderColor: 'rgba(245,166,35,0.20)',
      }}>
        <div className="text-[10px] uppercase tracking-wide font-semibold mb-3 flex items-center justify-between" style={{ color: CHART_COLORS.amber }}>
          <span>Assumptions — drag the sliders, watch the chart respond</span>
          <span className="text-[9px] normal-case" style={{ color: 'var(--text3)' }}>
            Defaults auto-derived from history · {scenario === 'custom' ? '🎛 your plan active' : '↺ click to override'}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <SliderRow
            label="Revenue growth MoM"
            value={effective.revenueGrowthMoM ?? 0}
            base={baseAssumptions.revenueGrowthMoM ?? 0}
            min={-0.30} max={0.50} step={0.005}
            format={(v) => fmtPct(v * 100)}
            override={overrides.revenueGrowthMoM != null}
            onChange={(v) => setOverride('revenueGrowthMoM', v)}
            onReset={() => setOverride('revenueGrowthMoM', undefined)}
          />
          <SliderRow
            label="Gross margin %"
            value={effective.grossMarginPct ?? 0.28}
            base={baseAssumptions.grossMarginPct ?? 0.28}
            min={0.05} max={0.80} step={0.005}
            format={(v) => fmtPct(v * 100)}
            override={overrides.grossMarginPct != null}
            onChange={(v) => setOverride('grossMarginPct', v)}
            onReset={() => setOverride('grossMarginPct', undefined)}
          />
          <NumberRow
            label="Fixed ops / month"
            value={effective.fixedOpsCostMonth ?? 0}
            base={baseAssumptions.fixedOpsCostMonth ?? 0}
            unit={unit}
            override={overrides.fixedOpsCostMonth != null}
            onChange={(v) => setOverride('fixedOpsCostMonth', v)}
            onReset={() => setOverride('fixedOpsCostMonth', undefined)}
          />
          <NumberRow
            label="Interest / month"
            value={effective.interestMonth ?? 0}
            base={baseAssumptions.interestMonth ?? 0}
            unit={unit}
            override={overrides.interestMonth != null}
            onChange={(v) => setOverride('interestMonth', v)}
            onReset={() => setOverride('interestMonth', undefined)}
          />
          <NumberRow
            label="Capex / month"
            value={effective.capexMonth ?? 0}
            base={baseAssumptions.capexMonth ?? 0}
            unit={unit}
            override={overrides.capexMonth != null}
            onChange={(v) => setOverride('capexMonth', v)}
            onReset={() => setOverride('capexMonth', undefined)}
          />
          <SliderRow
            label="Target DSO"
            value={effective.targetDSO ?? 45}
            base={baseAssumptions.targetDSO ?? 45}
            min={0} max={180} step={1}
            format={(v) => fmtDays(v)}
            override={overrides.targetDSO != null}
            onChange={(v) => setOverride('targetDSO', v)}
            onReset={() => setOverride('targetDSO', undefined)}
          />
        </div>
      </div>

      {/* AI Fix Plan panel */}
      <AIFixPlanPanel
        aiConsent={aiConsent}
        onEnableConsent={() => dispatch({ type: 'AI_CONSENT_GIVEN' })}
        loading={aiLoading}
        error={aiError}
        plan={aiPlan}
        currentScore={health.score}
        unit={unit}
        onRequest={regenerateAIPlan}
        onApplyLever={applyLever}
        onApplyAll={applyAllLevers}
      />

      <AIObservationsPlaceholder section="Forecast" />
    </SectionPanel>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function SliderRow({ label, value, base, min, max, step, format, override, onChange, onReset }: {
  label: string;
  value: number;
  base: number;
  min: number; max: number; step: number;
  format: (v: number) => string;
  override: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span style={{ color: 'var(--text2)' }}>{label}</span>
        <div className="flex items-center gap-2">
          <strong className="tabular-nums" style={{ color: override ? CHART_COLORS.purple : 'var(--text1)' }}>{format(value)}</strong>
          {override && (
            <span className="text-[9px] tabular-nums" style={{ color: 'var(--text3)' }}>(was {format(base)})</span>
          )}
          {override && (
            <button onClick={onReset} className="text-[9px] hover:underline" style={{ color: CHART_COLORS.purple }}>↺</button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer accent-[var(--teal,#0fd4a0)]"
        style={{ background: 'var(--bg3)' }}
      />
    </div>
  );
}

function NumberRow({ label, value, base, unit, override, onChange, onReset }: {
  label: string;
  value: number;
  base: number;
  unit: ReportUnit;
  override: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between text-[11px] py-1">
      <span style={{ color: 'var(--text2)' }}>{label}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(0, value * 0.9))}
          className="w-5 h-5 rounded text-[11px] border hover:bg-[var(--bg3)]" style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>−</button>
        <strong className="tabular-nums text-right w-20" style={{ color: override ? CHART_COLORS.purple : 'var(--text1)' }}>{fmtINR(value, unit)}</strong>
        <button onClick={() => onChange(value * 1.1)}
          className="w-5 h-5 rounded text-[11px] border hover:bg-[var(--bg3)]" style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>+</button>
        {override && (
          <span className="text-[9px] tabular-nums w-14" style={{ color: 'var(--text3)' }}>was {fmtINR(base, unit)}</span>
        )}
        {override && (
          <button onClick={onReset} className="text-[9px] hover:underline" style={{ color: CHART_COLORS.purple }}>↺</button>
        )}
      </div>
    </div>
  );
}

function ColHeader({ label, metricId, onTrace }: { label: string; metricId: string; onTrace: (id: string) => void }) {
  return (
    <th
      className="text-right px-3 py-2 font-medium cursor-pointer hover:underline"
      style={{ color: 'var(--text3)' }}
      onClick={() => onTrace(metricId)}
      title={`View ${label} working (metric ${metricId})`}
    >
      {label}
    </th>
  );
}

function AIFixPlanPanel({
  aiConsent, onEnableConsent, loading, error, plan, currentScore, unit, onRequest, onApplyLever, onApplyAll,
}: {
  aiConsent: boolean;
  onEnableConsent: () => void;
  loading: boolean;
  error: string | null;
  plan: ForecastPlanResponse | null;
  currentScore: number;
  unit: ReportUnit;
  onRequest: () => void;
  onApplyLever: (lever: NonNullable<PlanStep['lever']>) => void;
  onApplyAll: () => void;
}) {
  const purple = CHART_COLORS.purple;
  const containerStyle = { background: `${purple}08`, borderColor: `${purple}55` } as const;

  // AI consent gate — let user opt in inline rather than bouncing to ConsentModal.
  if (!aiConsent) {
    return (
      <div className="rounded-xl border p-4" style={containerStyle}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-semibold flex items-center gap-2 mb-1" style={{ color: purple }}>
              ✨ Fix Plan — Get a CFO-style action plan
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text2)', maxWidth: 720 }}>
              Send your current MIS snapshot (numbers only — no party names or voucher details) to the configured provider for a concrete, ranked action plan to lift your Plan Health Score. Each suggestion includes the exact assumption it moves so you can apply it with one click.
            </div>
          </div>
          <button onClick={onEnableConsent}
            className="px-3 py-2 text-[11px] rounded-md font-semibold transition-colors"
            style={{ background: purple, color: '#fff' }}>
            Enable smart suggestions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4" style={containerStyle}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-xs font-semibold flex items-center gap-2" style={{ color: purple }}>
            ✨ Fix Plan {plan ? `· projected lift to ${plan.projectedScoreLift}` : `· current score ${currentScore}`}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>
            CFO-grade plan ranked by leverage. Each step shows the exact lever it pulls so you can apply it instantly.
          </div>
        </div>
        <div className="flex gap-2">
          {plan && plan.steps.some(s => s.lever) && (
            <button onClick={onApplyAll}
              className="px-3 py-1.5 text-[11px] rounded-md border font-medium transition-colors hover:bg-[var(--bg3)]"
              style={{ borderColor: purple, color: purple }}>
              Apply all levers
            </button>
          )}
          <button onClick={onRequest} disabled={loading}
            className="px-3 py-1.5 text-[11px] rounded-md font-semibold transition-colors disabled:opacity-60"
            style={{ background: purple, color: '#fff' }}>
            {loading ? 'Thinking…' : plan ? '↻ Regenerate' : '✨ Generate plan'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[11px] mb-2 px-3 py-2 rounded-md" style={{
          background: `${CHART_COLORS.red}10`, color: CHART_COLORS.red,
          border: `1px solid ${CHART_COLORS.red}55`,
        }}>
          {error}
        </div>
      )}

      {!plan && !loading && !error && (
        <div className="text-[11px] py-4 text-center" style={{ color: 'var(--text3)' }}>
          Click <strong style={{ color: purple }}>Generate plan</strong> to get suggested fixes for your current scenario.
        </div>
      )}

      {plan && (
        <div className="space-y-3">
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text2)' }}>
            {plan.executiveSummary}
          </div>

          <div className="space-y-2">
            {plan.steps.map((step, i) => (
              <PlanStepRow key={i} step={step} unit={unit} onApply={onApplyLever} index={i + 1} />
            ))}
          </div>

          {plan.risks.length > 0 && (
            <div className="rounded-md border p-3" style={{
              borderColor: `${CHART_COLORS.amber}55`, background: `${CHART_COLORS.amber}08`,
            }}>
              <div className="text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: CHART_COLORS.amber }}>
                ⚠ Risks to manage
              </div>
              <ul className="text-[11px] space-y-1" style={{ color: 'var(--text2)' }}>
                {plan.risks.map((r, i) => <li key={i}>• {r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanStepRow({ step, unit, onApply, index }: {
  step: PlanStep;
  unit: ReportUnit;
  onApply: (lever: NonNullable<PlanStep['lever']>) => void;
  index: number;
}) {
  const effortColor = step.effort === 'S' ? CHART_COLORS.green : step.effort === 'M' ? CHART_COLORS.amber : CHART_COLORS.coral;
  const effortLabel = step.effort === 'S' ? 'Quick win' : step.effort === 'M' ? 'Few weeks' : 'Long haul';
  return (
    <div className="rounded-md border p-3" style={{
      background: 'var(--bg2)', borderColor: 'var(--border)',
    }}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="text-[12px] font-semibold flex items-center gap-2" style={{ color: 'var(--text1)' }}>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold tabular-nums"
            style={{ background: `${CHART_COLORS.purple}22`, color: CHART_COLORS.purple }}>{index}</span>
          {step.title}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase"
            style={{ background: `${effortColor}22`, color: effortColor }}>{step.effort} · {effortLabel}</span>
          {step.lever && (
            <button onClick={() => onApply(step.lever!)}
              className="text-[10px] px-2 py-1 rounded font-semibold transition-colors hover:opacity-90"
              style={{ background: CHART_COLORS.purple, color: '#fff' }}>
              Apply →
            </button>
          )}
        </div>
      </div>
      <div className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--text2)' }}>
        {step.rationale}
      </div>
      {step.lever && (
        <div className="text-[10px] tabular-nums mb-1" style={{ color: 'var(--text3)' }}>
          Lever: <span style={{ color: 'var(--text2)' }}>{labelForAssumption(step.lever.assumption)}</span>
          {' '}<span style={{ color: CHART_COLORS.red }}>{formatAssumption(step.lever.assumption, step.lever.from, unit)}</span>
          {' → '}<span style={{ color: CHART_COLORS.green, fontWeight: 600 }}>{formatAssumption(step.lever.assumption, step.lever.to, unit)}</span>
        </div>
      )}
      <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
        Impact: {step.impact}
      </div>
      {step.tallySteps && step.tallySteps.length > 0 && (
        <div className="mt-2 text-[10px]" style={{ color: 'var(--text3)' }}>
          <div className="font-semibold mb-0.5">Tally setup:</div>
          <ul className="list-disc list-inside space-y-0.5">
            {step.tallySteps.map((s, i) => <li key={i} style={{ color: 'var(--text2)' }}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
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

function formatAssumption(k: AssumptionKey, v: number, unit: ReportUnit): string {
  if (k === 'revenueGrowthMoM' || k === 'grossMarginPct') return fmtPct(v * 100);
  if (k === 'targetDSO') return fmtDays(v);
  return fmtINR(v, unit);
}

function DeltaBadge({ curr, base }: { curr: number; base: number }) {
  if (!isFinite(base) || base === 0) return null;
  const delta = (curr - base) / Math.abs(base);
  if (Math.abs(delta) < 0.005) return null;
  const positive = delta >= 0;
  const color = positive ? CHART_COLORS.green : CHART_COLORS.red;
  return (
    <span className="ml-1 text-[9px] px-1 py-0.5 rounded font-semibold tabular-nums"
      style={{ background: `${color}22`, color }}>
      {positive ? '▲' : '▼'} {(Math.abs(delta) * 100).toFixed(1)}%
    </span>
  );
}

function HealthBadge({ score, label, achievements }: { score: number; label: string; achievements: string[] }) {
  const color = score >= 75 ? CHART_COLORS.green : score >= 50 ? CHART_COLORS.amber : CHART_COLORS.red;
  return (
    <div className="rounded-xl border px-4 py-2 flex items-center gap-3" style={{
      background: `${color}10`, borderColor: `${color}55`,
    }}>
      <div className="text-center">
        <div className="text-[8px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Plan Health</div>
        <div className="text-2xl font-bold tabular-nums" style={{ color }}>{score}</div>
        <div className="text-[9px]" style={{ color: 'var(--text2)' }}>{label}</div>
      </div>
      {achievements.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {achievements.slice(0, 3).map((a, i) => (
            <div key={i} className="text-[10px] flex items-center gap-1" style={{ color }}>
              <span>🏆</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Plan Health Score ─────────────────────────────────────────────────────

/**
 * Composite score 0-100 reflecting how healthy the projected plan is.
 *
 *  Buckets (each contributes up to 25 points):
 *   - Cash runway      → ≥ 6 forecast months without going negative
 *   - PAT margin       → average forecast PAT / Revenue ≥ 10%
 *   - Growth realism   → revenue growth within ±50% of historical average
 *   - PAT trajectory   → forecast PAT trending upward (not declining)
 */
function computeHealthScore(sc: ScenarioForecast, base: ForecastAssumptions): {
  score: number; label: string; achievements: string[];
} {
  const forecastRows = sc.rows.filter(r => !r.isActual);
  if (forecastRows.length === 0) return { score: 0, label: 'No forecast', achievements: [] };

  const achievements: string[] = [];

  // 1. Cash runway — % of forecast months with positive cash
  const positiveCashMonths = forecastRows.filter(r => r.cashPosition > 0).length;
  const cashScore = Math.min(25, (positiveCashMonths / forecastRows.length) * 25);
  if (positiveCashMonths === forecastRows.length) achievements.push(`Cash positive for ${positiveCashMonths} mo`);

  // 2. PAT margin — average PAT/Revenue across forecast rows
  let totalPat = 0, totalRev = 0;
  for (const r of forecastRows) { totalPat += r.pat; totalRev += r.revenue; }
  const patMargin = totalRev ? totalPat / totalRev : 0;
  const marginScore = Math.max(0, Math.min(25, (patMargin / 0.20) * 25));
  if (patMargin >= 0.20) achievements.push(`PAT margin ${(patMargin * 100).toFixed(0)}%`);

  // 3. Growth realism — penalise if growth far above historical base
  const histGrowth = base.revenueGrowthMoM ?? 0.06;
  const planGrowth = sc.assumptions.revenueGrowthMoM ?? histGrowth;
  const growthDelta = Math.abs(planGrowth - histGrowth);
  const realismScore = Math.max(0, 25 - (growthDelta / 0.05) * 5);

  // 4. PAT trajectory — last forecast PAT vs first
  const firstPat = forecastRows[0]?.pat ?? 0;
  const lastPat = forecastRows[forecastRows.length - 1]?.pat ?? 0;
  const patTrendUp = lastPat > firstPat;
  const trajectoryScore = patTrendUp ? 25 : Math.max(0, 25 - Math.min(25, ((firstPat - lastPat) / Math.max(1, Math.abs(firstPat))) * 25));
  if (patTrendUp && firstPat > 0) achievements.push('PAT trending up');

  const score = Math.round(cashScore + marginScore + realismScore + trajectoryScore);
  const label = score >= 75 ? '🌟 Strong plan' : score >= 50 ? '⚖ Workable' : score >= 25 ? '⚠ Stretched' : '🚨 Risky';
  return { score, label, achievements };
}
