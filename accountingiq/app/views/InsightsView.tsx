'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { generateInsights } from '@/lib/insights';
import { DIM_LABELS } from '@/lib/constants';
import type { Urgency, Insight, DimKey } from '@/lib/types';

const URGENCY_ORDER: Urgency[] = ['critical', 'high', 'medium', 'positive'];

const URGENCY_LABELS: Record<Urgency, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  positive: 'Positive',
};

export default function InsightsView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, filters } = state;

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

      {/* BUG 18: AI Analysis lives on the AI Report tab — link there instead of broken legacy panel */}
      <div
        className="rounded-xl border mb-8 px-4 py-4 flex items-center justify-between"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--purple)' }}>◈</span>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            Full AI analysis — executive summary, root causes, action plan, and risk matrix — is on the
            <strong style={{ color: 'var(--text1)' }}> AI Report</strong> tab.
          </span>
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'aiAnalysis' })}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0 ml-4 transition-opacity hover:opacity-80"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          Go to AI Report →
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
                  {group.map(insight => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Rule-based insight card ───────────────────────────────────────────────

function InsightCard({ insight }: { insight: Insight }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(insight.copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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
