'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { getGrade, DIM_LABELS } from '@/lib/constants';
import { persistAIConsent } from '@/lib/session';
import { generateInsights } from '@/lib/insights';
import { runAIAnalysis, computeAIHash } from '@/lib/ai-trigger';
import type { DimKey } from '@/lib/types';

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

const URGENCY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high:     'var(--coral)',
  medium:   'var(--amber)',
  positive: 'var(--teal)',
};

const LIKELIHOOD_COLORS: Record<string, string> = {
  high:   'var(--red)',
  medium: 'var(--amber)',
  low:    'var(--teal)',
};

export default function AIAnalysisView() {
  const { state, dispatch } = useApp();
  const {
    results, parsedData, files, filters,
    aiConsentGiven, aiAnalysis, aiAnalysisHash,
    aiAnalysisLoading, aiAnalysisError,
  } = state;

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

  const currentHash = computeAIHash(state);
  const hasCachedAnalysis = aiAnalysis && aiAnalysisHash === currentHash;

  function handleRegenerate() {
    dispatch({ type: 'AI_ANALYSIS_CLEAR' });
    dispatch({ type: 'AI_ANALYSIS_LOADING' });
    runAIAnalysis(state, dispatch, currentHash);
  }

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
        {tab === 'ai' && aiConsentGiven && hasCachedAnalysis && !aiAnalysisLoading && (
          <button
            onClick={handleRegenerate}
            className="text-xs px-3 py-1.5 rounded border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
          >
            Regenerate
          </button>
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
            {/* Loading / progress state */}
            {aiAnalysisLoading && (
              <div className="rounded-xl border p-5 mb-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-base animate-spin inline-block">⟳</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
                    Analysing with Gemma 4 · 🇮🇳 India…
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg4)' }}>
                  <div
                    className="h-full rounded-full animate-pulse"
                    style={{ width: '60%', background: 'var(--purple)' }}
                  />
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
                  Local inference — usually 30–90 seconds
                </p>
              </div>
            )}

            {/* Error state */}
            {aiAnalysisError && !aiAnalysisLoading && (
              <div className="rounded-xl border p-5 mb-4" style={{ background: 'rgba(240,72,72,0.08)', borderColor: 'rgba(240,72,72,0.2)' }}>
                <p className="text-sm" style={{ color: 'var(--red)' }}>Error: {aiAnalysisError}</p>
                <button onClick={handleRegenerate} className="text-xs mt-2 underline" style={{ color: 'var(--text2)' }}>
                  Retry
                </button>
              </div>
            )}

            {/* Idle state — no analysis yet, not loading, no error */}
            {!hasCachedAnalysis && !aiAnalysisLoading && !aiAnalysisError && (
              <div className="rounded-xl border p-8 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                <div className="text-3xl mb-3">⚡</div>
                <p className="text-sm mb-2" style={{ color: 'var(--text1)' }}>AI analysis will start automatically</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text3)' }}>
                  Processed on India-resident server. No raw XML, no voucher details, no party names.
                </p>
                <button
                  onClick={handleRegenerate}
                  className="text-xs px-4 py-2 rounded-lg font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'var(--purple)', color: '#fff' }}
                >
                  Generate now
                </button>
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

                {/* 2. Data Quality Narrative (new) */}
                {aiAnalysis.dataQualityNarrative && (
                  <section className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
                      Data Quality Assessment
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>
                      {aiAnalysis.dataQualityNarrative}
                    </p>
                  </section>
                )}

                {/* 3. Root Causes */}
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

                {/* 4. Prioritised Actions */}
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
                              {(action.resolvesCheckIds ?? []).length > 0 && (
                                <span className="text-[10px]" style={{ color: 'var(--text3)' }}>
                                  resolves {(action.resolvesCheckIds ?? []).join(', ')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* 5. Risk Matrix (new) */}
                {aiAnalysis.riskMatrix && aiAnalysis.riskMatrix.length > 0 && (
                  <section>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
                      Risk Matrix
                    </div>
                    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                            <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--text3)' }}>Risk</th>
                            <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text3)' }}>Likelihood</th>
                            <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text3)' }}>Impact</th>
                            <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--text3)' }}>Mitigation</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                          {aiAnalysis.riskMatrix.map((row, i) => (
                            <tr key={i} style={{ borderColor: 'var(--border)' }}>
                              <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{row.risk}</td>
                              <td className="px-3 py-3">
                                <span
                                  className="px-1.5 py-0.5 rounded font-semibold uppercase"
                                  style={{ color: LIKELIHOOD_COLORS[row.likelihood] ?? 'var(--text3)', background: `${LIKELIHOOD_COLORS[row.likelihood] ?? '#888'}18` }}
                                >
                                  {row.likelihood}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className="px-1.5 py-0.5 rounded font-semibold uppercase"
                                  style={{ color: LIKELIHOOD_COLORS[row.impact] ?? 'var(--text3)', background: `${LIKELIHOOD_COLORS[row.impact] ?? '#888'}18` }}
                                >
                                  {row.impact}
                                </span>
                              </td>
                              <td className="px-4 py-3 leading-relaxed" style={{ color: 'var(--text2)' }}>{row.mitigation}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* 6. Financial Commentary */}
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

                {/* 7. Preflight */}
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
          to an India-resident server for narrative generation. No data leaves India.
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
