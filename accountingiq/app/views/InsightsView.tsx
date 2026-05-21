'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { generateInsights } from '@/lib/insights';
import { DIM_LABELS } from '@/lib/constants';
import { getDrillDown, hasDrillDown } from '@/lib/voucher-filters';
import VoucherDrillDown from '@/app/components/VoucherDrillDown';
import H4Breakdown from '@/app/components/H4Breakdown';
import GSTBreakdown from '@/app/components/GSTBreakdown';
import LedgerPairDrillDown from '@/app/components/LedgerPairDrillDown';
import type { Urgency, Insight, DimKey, AnomalyFlag } from '@/lib/types';

const URGENCY_ORDER: Urgency[] = ['critical', 'high', 'medium', 'positive'];

const URGENCY_LABELS: Record<Urgency, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  positive: 'Positive',
};

export default function InsightsView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, filters, files } = state;
  const [drillFlag, setDrillFlag] = useState<AnomalyFlag | null>(null);
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

  const insights = generateInsights(results, parsedData, filters);

  const grouped = URGENCY_ORDER.reduce<Record<Urgency, Insight[]>>(
    (acc, u) => { acc[u] = insights.filter(i => i.urgency === u); return acc; },
    { critical: [], high: [], medium: [], positive: [] },
  );

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      <h1
        className="text-2xl mb-1"
        style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
      >
        Key Insights
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text3)' }}>
        {insights.length} insight{insights.length !== 1 ? 's' : ''} derived from analysis
      </p>

      {/* AI Smart Insights — pattern-detected findings the rule engine
          doesn't catch (vendor concentration, voucher anomalies, ratio
          outliers, cross-check patterns).  Surfaces only when the user
          has opted into AI consent AND a cached AI analysis is available.
          See lib/ai-trigger.ts for the aggregates pipeline. */}
      <SmartInsightsPanel />

      {/* BUG 18: AI Analysis lives on the AI Report tab — link there instead of broken legacy panel */}
      <div
        className="rounded-xl border mb-8 px-4 py-4 flex items-center justify-between"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--purple)' }}>◈</span>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            Full report — executive summary, root causes, action plan, and risk matrix — is on the
            <strong style={{ color: 'var(--text1)' }}> Insights Report</strong> tab.
          </span>
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'aiAnalysis' })}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0 ml-4 transition-opacity hover:opacity-80"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          Go to Insights Report →
        </button>
      </div>

      {/* Rule-based insights */}
      {insights.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>No rule-based insights generated.</p>
      ) : (
        <div className="space-y-6">
          {URGENCY_ORDER.map(urgency => {
            const group = grouped[urgency];
            if (group.length === 0) return null;
            return (
              <section key={urgency}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`badge-${urgency} text-xs px-2 py-0.5 rounded font-semibold`}>
                    {URGENCY_LABELS[urgency]}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    {group.length} item{group.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-3">
                  {group.map(insight => {
                    const drillable = !!insight.checkId
                      && hasDrillDown(insight.checkId, dbStats, parsedData);
                    return (
                      <InsightCard
                        key={insight.id}
                        insight={insight}
                        drillable={drillable}
                        onDrill={drillable && insight.checkId ? () => setDrillFlag({
                          id: insight.checkId!,
                          severity: insight.urgency === 'positive' ? 'low' : insight.urgency,
                          title: insight.finding,
                          detail: insight.action,
                        }) : undefined}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Drill-down modal — H4 gets its own breakdown panel; everything
          else routes through the standard VoucherDrillDown. */}
      {drillFlag && drillFlag.id === 'H4' && (
        <H4Breakdown
          tbLedgers={parsedData.tbLedgers ?? []}
          masterEntries={parsedData.masterEntries ?? []}
          bsStatement={parsedData.bsheetStatement}
          ledgerOverrides={state.ledgerOverrides}
          dbStats={dbStats}
          onClose={() => setDrillFlag(null)}
        />
      )}
      {drillFlag && drillFlag.id === 'E2b' && parsedData.gstWorking && (
        <GSTBreakdown working={parsedData.gstWorking} onClose={() => setDrillFlag(null)} />
      )}
      {drillFlag && (drillFlag.id === 'B2' || drillFlag.id === 'G1' || drillFlag.id === 'G2') && (() => {
        // All three render through LedgerPairDrillDown but pull from
        // different parsedData fields — keep the routing in lockstep
        // with ChecklistView's modal cascade.
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
    </div>
  );
}

// ── AI Smart Insights panel ───────────────────────────────────────────────
//
// Renders the `smartInsights` array from the cached AI analysis.  Hidden
// when the user hasn't opted into AI consent or no cached analysis is
// available — keeps the rule-based insights section uncluttered for
// users who don't use AI.  See lib/ai-trigger.ts for the aggregates
// pipeline that powers these findings.

const AI_SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--coral)',
  medium:   'var(--amber)',
  low:      'var(--text3)',
  positive: 'var(--teal)',
};

const AI_SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(240,72,72,0.10)',
  high:     'rgba(242,107,91,0.10)',
  medium:   'rgba(245,166,35,0.10)',
  low:      'rgba(92,99,112,0.08)',
  positive: 'rgba(82,196,169,0.10)',
};

function SmartInsightsPanel() {
  const { state, dispatch } = useApp();
  const { aiConsentGiven, aiAnalysis } = state;
  // Don't render the panel at all when AI is off — keeps the rule-based
  // section the primary surface for non-AI users.
  if (!aiConsentGiven) return null;
  const items = aiAnalysis?.smartInsights ?? [];
  if (items.length === 0) {
    // Cached AI exists but no smartInsights field (older run) — quiet hide.
    if (aiAnalysis) return null;
    // No AI run yet: surface a one-line CTA to generate AI insights.
    return (
      <div
        className="rounded-xl border mb-6 px-4 py-3 flex items-center justify-between gap-3"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: 'var(--purple)' }}>◈</span>
          <span className="text-xs" style={{ color: 'var(--text2)' }}>
            AI-detected patterns (vendor concentration, voucher anomalies, ratio outliers) appear here after the first AI run.
          </span>
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'aiAnalysis' })}
          className="text-xs px-3 py-1 rounded-lg font-semibold shrink-0 transition-opacity hover:opacity-80"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          Run AI
        </button>
      </div>
    );
  }

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          AI
        </span>
        <h2
          className="text-sm font-semibold"
          style={{ color: 'var(--text1)' }}
        >
          Pattern-detected findings
        </h2>
        <span className="text-xs" style={{ color: 'var(--text3)' }}>
          ({items.length})
        </span>
      </div>
      <div className="space-y-3">
        {items.map((si, i) => (
          <div
            key={i}
            className="rounded-xl border p-4"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start gap-2 mb-2">
              <span
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold shrink-0"
                style={{
                  color: AI_SEVERITY_COLORS[si.severity] ?? 'var(--text3)',
                  background: AI_SEVERITY_BG[si.severity] ?? 'transparent',
                }}
              >
                {si.severity}
              </span>
              <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text1)' }}>
                {si.title}
              </span>
              {si.confidence && (
                <span className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  confidence: {si.confidence}
                </span>
              )}
            </div>
            <p className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--text2)' }}>
              {si.finding}
            </p>
            {si.evidence.length > 0 && (
              <div className="mb-3 p-2 rounded text-xs" style={{ background: 'var(--bg3)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>
                  Evidence
                </div>
                <ul className="space-y-0.5">
                  {si.evidence.map((e, j) => (
                    <li key={j} className="font-mono" style={{ color: 'var(--text2)' }}>· {e}</li>
                  ))}
                </ul>
              </div>
            )}
            {si.recommendation && (
              <div className="text-xs" style={{ color: 'var(--text2)' }}>
                <span style={{ color: 'var(--text3)' }}>→ </span>
                {si.recommendation}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Rule-based insight card ───────────────────────────────────────────────

function InsightCard({
  insight, drillable, onDrill,
}: {
  insight: Insight;
  drillable: boolean;
  onDrill?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(insight.copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Card stays as a <div> — wrapping it in <button> nests the Copy button
  // inside, which triggers a React hydration error (button-in-button).
  // The drill affordance is its own inline <button> instead.
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs mb-1.5" style={{ color: 'var(--text3)' }}>
            {insight.cat}
            {insight.checkId && (
              <span className="ml-2 font-mono" style={{ color: 'var(--text3)' }}>
                [{insight.checkId}]
              </span>
            )}
          </div>
          <p className="text-sm font-medium mb-2" style={{ color: 'var(--text1)' }}>
            {insight.finding}
          </p>
          <p className="text-xs mb-1.5 leading-relaxed" style={{ color: 'var(--text2)' }}>
            <span style={{ color: 'var(--text3)' }}>Impact: </span>
            {insight.implication}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
            <span style={{ color: 'var(--text3)' }}>Action: </span>
            {insight.action}
          </p>
          {drillable && onDrill && (
            <button
              onClick={onDrill}
              className="text-xs mt-2 transition-opacity hover:opacity-80"
              style={{ color: 'var(--teal)' }}
            >
              View affected vouchers →
            </button>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="text-xs px-2 py-1 rounded border shrink-0 transition-colors"
          style={{ borderColor: 'var(--border)', color: copied ? 'var(--teal)' : 'var(--text3)' }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
