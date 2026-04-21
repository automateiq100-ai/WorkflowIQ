'use client';

import { useState, useEffect } from 'react';
import { useApp } from '@/lib/state';
import { getGrade, DIM_LABELS } from '@/lib/constants';
import { persistAIConsent } from '@/lib/session';
import { generateInsights } from '@/lib/insights';
import type { AIResponse, DimKey, CompanyProfile, AIRequest } from '@/lib/types';

const IMPACT_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--coral)',
  medium:   'var(--amber)',
  low:      'var(--text3)',
};

const EFFORT_LABELS: Record<string, string> = {
  S: '~15 min',
  M: '~1 hr',
  L: '~half day',
};

/** Simple hash for caching — JSON.stringify + basic hash */
function hashInput(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

const URGENCY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--coral)',
  medium:   'var(--amber)',
  positive: 'var(--teal)',
};

export default function AIAnalysisView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, files, filters, aiConsentGiven, aiAnalysis, aiAnalysisHash } = state;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<'insights' | 'ai'>('insights');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Run analysis first.{' '}
          <button className="underline" style={{ color: 'var(--teal)' }} onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}>
            Upload files
          </button>
        </p>
      </div>
    );
  }

  // Build input hash for caching
  const inputForHash = JSON.stringify({ dimScores: results.dimScores, overall: results.overall, checks: results.checks.length });
  const currentHash = hashInput(inputForHash);

  async function generate() {
    if (!results) return;
    setLoading(true);
    setError(null);

    const pd = parsedData as Record<string, number | boolean | null | undefined>;
    const monthCounts = files.daybook?.chunkedStats?.monthCounts ?? {};

    const payload: AIRequest = {
      score: results.cappedScore,
      grade: getGrade(results.cappedScore).label,
      dimScores: results.dimScores,
      findings: results.checks
        .filter(c => c.status === 'fail' || c.status === 'partial')
        .map(c => ({
          id: c.id,
          dim: c.dim,
          name: c.failLabel ?? c.name,
          status: c.status,
          note: c.note,
          max: c.max,
        })),
      financials: {
        revenue: (pd.revenue as number) ?? 0,
        netProfit: (pd.netProfit as number) ?? 0,
        currentAssets: (pd.ca as number) ?? 0,
        currentLiabilities: (pd.cl as number) ?? 0,
        bankBalance: (pd.bankBal as number) ?? 0,
        debtorBalance: (pd.debtorBal as number) ?? 0,
        creditorBalance: (pd.creditorBal as number) ?? 0,
        suspenseBalance: (pd.tbTotal as number) ?? 0,
        fixedAssets: (pd.fixedAssets as number) ?? 0,
        closingStock: (pd.closingStock as number) ?? 0,
      },
      profile: filters as unknown as CompanyProfile,
      dataNotes: {
        filesUploaded: Object.values(files).filter(f => f.hasContent).length,
        dayBookVoucherCount: files.daybook?.chunkedStats?.totalVouchers ?? 0,
        distinctMonthsInData: Object.keys(monthCounts).length,
        scoreCapped: results.scoreCapped,
      },
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000); // 3 min for local models

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data: AIResponse = await res.json();
      dispatch({ type: 'AI_ANALYSIS_DONE', analysis: data, hash: currentHash });
      setGeneratedAt(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function handleRegenerate() {
    dispatch({ type: 'AI_ANALYSIS_CLEAR' });
    generate();
  }

  // Check if cached analysis matches current data
  const hasCachedAnalysis = aiAnalysis && aiAnalysisHash === currentHash;

  const insights = generateInsights(results, parsedData, filters);
  const insightGroups = ['critical', 'high', 'medium', 'positive'] as const;

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Analysis
          </h1>
        </div>
        {tab === 'ai' && (
          <div className="flex items-center gap-2">
            {!hasCachedAnalysis && !loading && aiConsentGiven && (
              <button
                onClick={generate}
                className="text-xs px-4 py-2 rounded-lg font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'var(--purple)', color: '#fff' }}
              >
                Generate AI Report
              </button>
            )}
            {hasCachedAnalysis && (
              <button
                onClick={handleRegenerate}
                className="text-xs px-3 py-1.5 rounded border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
              >
                Regenerate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div
        className="flex rounded-lg border overflow-hidden mb-6"
        style={{ borderColor: 'var(--border)', width: 'fit-content' }}
      >
        {([
          { id: 'insights', label: 'Insights' },
          { id: 'ai',       label: aiConsentGiven ? 'AI Report' : 'AI Report 🔒' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 text-xs font-medium transition-colors"
            style={{
              background: tab === t.id ? 'var(--bg4)' : 'var(--bg2)',
              color: tab === t.id ? 'var(--text1)' : 'var(--text3)',
              borderRight: '1px solid var(--border)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Insights tab ── */}
      {tab === 'insights' && (
        <div className="space-y-4">
          {insights.length === 0 ? (
            <div className="rounded-xl border p-8 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--teal)' }}>✓ No issues found — all checks passing.</p>
            </div>
          ) : (
            insightGroups.map(urg => {
              const group = insights.filter(i => i.urgency === urg);
              if (group.length === 0) return null;
              return (
                <div key={urg}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-2 px-1"
                    style={{ color: URGENCY_COLORS[urg] ?? 'var(--text3)' }}>
                    {urg} — {group.length}
                  </div>
                  <div className="space-y-2">
                    {group.map(ins => (
                      <div
                        key={ins.id}
                        className="rounded-xl border p-4"
                        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5"
                            style={{ color: URGENCY_COLORS[ins.urgency], background: `${URGENCY_COLORS[ins.urgency]}18` }}
                          >
                            {ins.cat}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium mb-1" style={{ color: 'var(--text1)' }}>{ins.finding}</div>
                            {ins.implication && (
                              <div className="text-xs mb-1 leading-relaxed" style={{ color: 'var(--text3)' }}>
                                {ins.implication}
                              </div>
                            )}
                            <div className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                              <span style={{ color: 'var(--text3)' }}>Action: </span>{ins.action}
                            </div>
                          </div>
                          {ins.copyText && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(ins.copyText!).catch(() => {});
                                setCopiedId(ins.id);
                                setTimeout(() => setCopiedId(null), 1500);
                              }}
                              className="shrink-0 text-[10px] px-2 py-1 rounded transition-colors"
                              style={{ background: 'var(--bg4)', color: copiedId === ins.id ? 'var(--teal)' : 'var(--text3)' }}
                              title="Copy finding"
                            >
                              {copiedId === ins.id ? '✓' : '⎘'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── AI Report tab ── */}
      {tab === 'ai' && (
        !aiConsentGiven ? <AIConsentGate /> : (
        <div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-4">
          {[85, 65, 75, 55, 70].map((w, i) => (
            <div key={i} className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="h-3 rounded animate-pulse mb-3" style={{ width: `${w}%`, background: 'var(--bg4)' }} />
              <div className="h-2 rounded animate-pulse" style={{ width: `${w - 20}%`, background: 'var(--bg4)' }} />
            </div>
          ))}
          <p className="text-xs text-center" style={{ color: 'var(--text3)' }}>Analysing with GPT-4o…</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl border p-5 mb-4" style={{ background: 'rgba(240,72,72,0.08)', borderColor: 'rgba(240,72,72,0.2)' }}>
          <p className="text-sm" style={{ color: 'var(--red)' }}>Error: {error}</p>
          <button onClick={generate} className="text-xs mt-2 underline" style={{ color: 'var(--text2)' }}>Retry</button>
        </div>
      )}

      {/* Idle state */}
      {!hasCachedAnalysis && !loading && !error && (
        <div className="rounded-xl border p-8 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-3xl mb-3">⚡</div>
          <p className="text-sm mb-2" style={{ color: 'var(--text1)' }}>Generate AI-powered analysis</p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Sends aggregated scores and metrics to OpenAI. No raw XML, no voucher details, no party names.
          </p>
        </div>
      )}

      {/* Analysis results */}
      {hasCachedAnalysis && aiAnalysis && (
        <div className="space-y-5">
          {/* 1. Executive Summary */}
          <section className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              Executive Summary
            </div>
            <blockquote
              className="text-sm leading-relaxed pl-4 border-l-2"
              style={{ color: 'var(--text1)', borderColor: 'var(--purple)', fontFamily: 'var(--font-dm-serif)' }}
            >
              {aiAnalysis.executiveSummary}
            </blockquote>
          </section>

          {/* 2. Root Causes */}
          {aiAnalysis.rootCauses.length > 0 && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
                Root Cause Analysis
              </div>
              <div className="space-y-3">
                {aiAnalysis.rootCauses.map((rc, i) => (
                  <div
                    key={i}
                    className="rounded-xl border p-4"
                    style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
                    data-root-cause={i}
                  >
                    <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
                      {rc.theme}
                    </div>
                    <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text2)' }}>
                      {rc.explanation}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {rc.findingIds.map(id => (
                        <span
                          key={id}
                          data-check-id={id}
                          className="text-xs font-mono px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                          style={{ background: 'var(--bg4)', color: 'var(--purple)' }}
                          onClick={() => dispatch({ type: 'SET_VIEW', view: 'checklist' })}
                        >
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 3. Prioritised Actions */}
          {aiAnalysis.actions.length > 0 && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
                Prioritised Action Plan
              </div>
              <div className="rounded-xl border overflow-hidden divide-y" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                {aiAnalysis.actions.map((action, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                    <span
                      className="shrink-0 w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold mt-0.5"
                      style={{ background: 'rgba(15,212,160,0.15)', color: 'var(--teal)' }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm" style={{ color: 'var(--text1)' }}>{action.task}</div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase"
                          style={{ color: IMPACT_COLORS[action.impact] ?? 'var(--text3)', background: `${IMPACT_COLORS[action.impact] ?? '#888'}18` }}
                        >
                          {action.impact}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg4)', color: 'var(--text2)' }}>
                          {action.effort} · {EFFORT_LABELS[action.effort] ?? action.effort}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg4)', color: 'var(--text3)' }}>
                          {action.category}
                        </span>
                        {action.resolvesCheckIds.length > 0 && (
                          <span className="text-[10px]" style={{ color: 'var(--text3)' }}>
                            resolves {action.resolvesCheckIds.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. Financial Commentary */}
          {aiAnalysis.financialCommentary && (
            <section className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
                Financial Health Commentary
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>
                {aiAnalysis.financialCommentary}
              </p>
            </section>
          )}

          {/* 5. Preflight */}
          {aiAnalysis.preflight.length > 0 && (
            <section className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
                Fix in Tally Before Re-running
              </div>
              <ol className="space-y-2">
                {aiAnalysis.preflight.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="shrink-0 text-xs font-mono mt-0.5" style={{ color: 'var(--teal)' }}>{i + 1}.</span>
                    <span style={{ color: 'var(--text2)' }}>{item}</span>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
                className="mt-4 text-xs px-4 py-2 rounded-lg font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'var(--teal)', color: '#000' }}
              >
                Re-upload after fixing →
              </button>
            </section>
          )}

          {/* Disclaimer */}
          <p className="text-[10px] text-center leading-relaxed" style={{ color: 'var(--text3)' }}>
            AI-generated analysis based on scoring output only. No raw XML or voucher data was sent.
            Verify findings against source data before acting. Not a substitute for professional accounting advice.
          </p>
        </div>
      )}
        </div>
        )
      )}
    </div>
  );
}

// ── AI Consent Gate (shown when user hasn't consented to AI) ──────────────

function AIConsentGate() {
  const { dispatch } = useApp();

  function handleConsent() {
    dispatch({ type: 'AI_CONSENT_GIVEN' });
    persistAIConsent(true);
  }

  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          AI Analysis requires consent
        </h2>
        <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text2)' }}>
          AI Analysis sends aggregated scoring results (no raw XML, no voucher details, no party names)
          to OpenAI for narrative generation.
        </p>
        <button
          onClick={handleConsent}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          I consent — enable AI Analysis
        </button>
      </div>
    </div>
  );
}
