'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { generateInsights } from '@/lib/insights';
import { getGrade, DIM_LABELS } from '@/lib/constants';
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

      {/* AI Summary panel */}
      <AISummaryPanel results={results} parsedData={parsedData} />

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

// ── AI Summary Panel ──────────────────────────────────────────────────────

type AIState = 'idle' | 'loading' | 'done' | 'error';

interface AISummaryResult {
  summary: string;
  priorities: string[];
  observation: string;
}

function AISummaryPanel({
  results,
  parsedData,
}: {
  results: NonNullable<ReturnType<typeof useApp>['state']['results']>;
  parsedData: ReturnType<typeof useApp>['state']['parsedData'];
}) {
  const [aiState, setAiState] = useState<AIState>('idle');
  const [aiResult, setAiResult] = useState<AISummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateAI() {
    setAiState('loading');
    setError(null);

    const topIssues = results.checks
      .filter(c => c.status === 'fail' || c.status === 'partial')
      .slice(0, 5)
      .map(c => ({ id: c.id, name: c.name, note: c.note }));

    const ca = (parsedData as Record<string, number>).ca ?? 0;
    const cl = (parsedData as Record<string, number>).cl ?? 0;

    const payload = {
      score: results.overall,
      grade: getGrade(results.overall).label,
      dimScores: results.dimScores,
      topIssues,
      financials: {
        revenue:          (parsedData as Record<string, number>).revenue ?? 0,
        netProfit:        (parsedData as Record<string, number>).netProfit ?? 0,
        suspenseBalance:  (parsedData as Record<string, number>).tbTotal ?? 0,
        currentRatio:     ca && cl ? +(ca / cl).toFixed(2) : null,
      },
    };

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: AISummaryResult = await res.json();
      setAiResult(data);
      setAiState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setAiState('error');
    }
  }

  return (
    <div
      className="rounded-xl border mb-8 overflow-hidden"
      style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--purple)' }}>◈</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>
            AI Summary
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded font-mono"
            style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
          >
            Gemma 4 🇮🇳
          </span>
        </div>
        {aiState === 'idle' || aiState === 'error' ? (
          <button
            onClick={generateAI}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'var(--purple)', color: '#fff' }}
          >
            Generate
          </button>
        ) : aiState === 'loading' ? (
          <span className="text-xs" style={{ color: 'var(--text3)' }}>Analysing…</span>
        ) : (
          <button
            onClick={() => { setAiState('idle'); setAiResult(null); }}
            className="text-xs"
            style={{ color: 'var(--text3)' }}
          >
            Regenerate
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-4">
        {aiState === 'idle' && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Click Generate to get an AI-written narrative summary of these books.
            <span className="block mt-1" style={{ color: 'var(--text3)', opacity: 0.7 }}>
              Analysis scores and key figures (no raw files) are processed on an India-resident server.
            </span>
          </p>
        )}

        {aiState === 'loading' && (
          <div className="space-y-2">
            {[80, 60, 70].map((w, i) => (
              <div
                key={i}
                className="h-3 rounded animate-pulse"
                style={{ width: `${w}%`, background: 'var(--bg4)' }}
              />
            ))}
          </div>
        )}

        {aiState === 'error' && (
          <p className="text-xs" style={{ color: 'var(--red)' }}>
            Error: {error}
          </p>
        )}

        {aiState === 'done' && aiResult && (
          <div className="space-y-4">
            {/* Summary */}
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text1)' }}>
              {aiResult.summary}
            </p>

            {/* Priorities */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text3)' }}>
                TOP PRIORITIES
              </div>
              <ol className="space-y-1.5">
                {aiResult.priorities.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span
                      className="shrink-0 w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold"
                      style={{ background: 'rgba(15,212,160,0.15)', color: 'var(--teal)' }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ color: 'var(--text2)' }}>{p}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Observation */}
            <div
              className="text-xs px-3 py-2.5 rounded-lg"
              style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
            >
              <span style={{ color: 'var(--amber)' }}>◉ </span>
              {aiResult.observation}
            </div>
          </div>
        )}
      </div>
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
