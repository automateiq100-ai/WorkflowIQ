/**
 * ai-trigger.ts — Shared helper to build and fire the /api/ai request.
 * Used by AppProvider (auto-trigger) and AIAnalysisView (manual regenerate).
 */

import type { AppState, AIResponse, AIRequest, CompanyProfile } from './types';
import type { Action } from './state';
import type { Dispatch } from 'react';
import { getGrade } from './constants';

/** Simple hash for caching — JSON.stringify + basic djb2 */
export function hashInput(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Build the AI request payload from current app state */
export function buildAIPayload(state: AppState): AIRequest | null {
  const { results, parsedData, files, filters } = state;
  if (!results) return null;

  const pd = parsedData as Record<string, number | boolean | null | undefined>;
  const monthCounts = files.daybook?.chunkedStats?.monthCounts ?? {};

  return {
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
      revenue:             (pd.revenue as number)      ?? 0,
      netProfit:           (pd.netProfit as number)    ?? 0,
      currentAssets:       (pd.ca as number)           ?? 0,
      currentLiabilities:  (pd.cl as number)           ?? 0,
      bankBalance:         (pd.bankBal as number)      ?? 0,
      debtorBalance:       (pd.debtorBal as number)    ?? 0,
      creditorBalance:     (pd.creditorBal as number)  ?? 0,
      suspenseBalance:     (pd.tbTotal as number)      ?? 0,
      fixedAssets:         (pd.fixedAssets as number)  ?? 0,
      closingStock:        (pd.closingStock as number) ?? 0,
    },
    profile: filters as unknown as CompanyProfile,
    dataNotes: {
      filesUploaded:          Object.values(files).filter(f => f.hasContent).length,
      dayBookVoucherCount:    files.daybook?.chunkedStats?.totalVouchers ?? 0,
      distinctMonthsInData:   Object.keys(monthCounts).length,
      scoreCapped:            results.scoreCapped,
    },
  };
}

/** Compute the cache hash for a given app state */
export function computeAIHash(state: AppState): string {
  if (!state.results) return '';
  return hashInput(JSON.stringify({
    dimScores: state.results.dimScores,
    overall: state.results.overall,
    checks: state.results.checks.length,
  }));
}

/**
 * Fire the /api/ai fetch, dispatch loading → done/error.
 * Caller is responsible for dispatching AI_ANALYSIS_LOADING before calling this.
 */
export async function runAIAnalysis(
  state: AppState,
  dispatch: Dispatch<Action>,
  hash: string,
): Promise<void> {
  const payload = buildAIPayload(state);
  if (!payload) {
    dispatch({ type: 'AI_ANALYSIS_ERROR', error: 'No analysis results available.' });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000); // 3 min for local Gemma

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }

    const data: AIResponse = await res.json();
    dispatch({ type: 'AI_ANALYSIS_DONE', analysis: data, hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    dispatch({ type: 'AI_ANALYSIS_ERROR', error: message });
  }
}
