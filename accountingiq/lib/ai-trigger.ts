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
  const dbStats = files.daybook?.chunkedStats;
  const monthCounts = dbStats?.monthCounts ?? {};
  const totalVouchers = dbStats?.totalVouchers ?? 0;

  const revenue = (pd.revenue as number) ?? 0;
  const netProfit = (pd.netProfit as number) ?? 0;
  const ca = (pd.ca as number) ?? 0;
  const cl = (pd.cl as number) ?? 0;
  const creditorBal = (pd.creditorBal as number) ?? 0;
  const closingStock = (pd.closingStock as number) ?? 0;
  const tbPurch = (pd.tbPurch as number) ?? 0;
  const outputGST = (pd.outputGSTAmt as number) ?? 0;

  // ── Aggregate fingerprints — let AI spot patterns the rules can't ────
  //
  // All numeric, all derived from already-parsed aggregates.  No PII —
  // we never send party names or per-voucher amounts.
  //
  // Top-party concentration: sum |amount| across vouchers, then ratio of
  // top-1/3/10 partyMap entries to total.  Detects vendor/customer
  // concentration risk that wouldn't surface in dimension scores.
  let topPartyConcentration: { top1Pct: number; top3Pct: number; top10Pct: number } | undefined;
  if (dbStats?.vouchers && dbStats.vouchers.length > 0) {
    const byParty = new Map<string, number>();
    let total = 0;
    for (const v of dbStats.vouchers) {
      if (!v.party) continue;
      const amt = Math.abs(v.amount);
      total += amt;
      byParty.set(v.party, (byParty.get(v.party) ?? 0) + amt);
    }
    if (total > 0 && byParty.size > 0) {
      const sorted = [...byParty.values()].sort((a, b) => b - a);
      const sum = (n: number) => sorted.slice(0, n).reduce((s, v) => s + v, 0);
      topPartyConcentration = {
        top1Pct:  sum(1)  / total,
        top3Pct:  sum(3)  / total,
        top10Pct: sum(10) / total,
      };
    }
  }

  // Voucher pattern fingerprints — all percentages of totalVouchers.
  const voucherPatterns = dbStats && totalVouchers > 0 ? {
    roundNumberPct:      dbStats.roundCount      / totalVouchers,
    zeroAmountPct:       dbStats.zeroAmt         / totalVouchers,
    missingNarrationPct: 1 - (dbStats.narrated / totalVouchers),
    cashOver10kCount:    dbStats.cashOver10k,
    wrongTypeCount:      dbStats.wrongType,
    journalPct:          dbStats.totalJournals   / totalVouchers,
  } : undefined;

  // Monthly volume spike — max month / mean month.
  const monthVals = Object.values(monthCounts);
  const monthMean = monthVals.length > 0 ? monthVals.reduce((a, b) => a + b, 0) / monthVals.length : 0;
  const monthMax  = monthVals.length > 0 ? Math.max(...monthVals) : 0;
  const monthlyVolumeSpike = monthMean > 0 ? monthMax / monthMean : 0;

  // Key ratios — AI reasons over these to spot outliers.
  const ratios = {
    currentRatio:    cl > 0      ? ca / cl                : undefined,
    debtToEquity:    undefined,                                              // skip until we expose capital total
    gstAsPctOfSales: revenue > 0 ? outputGST / revenue    : undefined,
    stockTurnover:   closingStock > 0 ? tbPurch / closingStock : undefined,
    netProfitMargin: revenue > 0 ? netProfit / revenue    : undefined,
  };

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
      revenue,
      netProfit,
      currentAssets:       ca,
      currentLiabilities:  cl,
      bankBalance:         (pd.bankBal as number)      ?? 0,
      debtorBalance:       (pd.debtorBal as number)    ?? 0,
      creditorBalance:     creditorBal,
      suspenseBalance:     (pd.tbTotal as number)      ?? 0,
      fixedAssets:         (pd.fixedAssets as number)  ?? 0,
      closingStock,
    },
    aggregates: {
      topPartyConcentration,
      voucherPatterns,
      monthlyVolumeSpike,
      activeMonths: monthVals.length,
      ratios,
    },
    profile: filters as unknown as CompanyProfile,
    dataNotes: {
      filesUploaded:          Object.values(files).filter(f => f.hasContent).length,
      dayBookVoucherCount:    totalVouchers,
      distinctMonthsInData:   Object.keys(monthCounts).length,
      scoreCapped:            results.scoreCapped,
    },
  };
}

/** Compute the cache hash for a given app state.
 *
 *  Includes enough signal that the cache busts when ANYTHING the AI was
 *  fed has changed:
 *    - currentCompany.id  → defence-in-depth across company switches
 *    - dimScores + overall → ties to the engine output
 *    - per-check id+status → busts when a check flips fail↔pass etc.
 *      even if the dimension score stays the same (the previous narrow
 *      hash kept old AI explanations alongside new check statuses).
 *    - filesUploaded count → so adding/removing a file slot busts cache
 *
 *  Financials and aggregates aren't hashed because they only matter to
 *  the AI when they change *materially* (small rounding shifts don't
 *  warrant a re-run — the user can still Regenerate manually).
 */
export function computeAIHash(state: AppState): string {
  if (!state.results) return '';
  const checkFingerprint = state.results.checks
    .map(c => `${c.id}:${c.status}`)
    .join('|');
  const filesLoaded = Object.values(state.files).filter(f => f.hasContent).length;
  return hashInput(JSON.stringify({
    company:    state.currentCompany?.id ?? null,
    dimScores:  state.results.dimScores,
    overall:    state.results.overall,
    checks:     checkFingerprint,
    files:      filesLoaded,
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
