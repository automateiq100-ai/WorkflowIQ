/**
 * Shared AI-insights fetcher + cache.
 *
 *  Single source of truth for the per-section Observations + Fix Plan that
 *  the in-app panels render and the Excel exporter embeds.  Module-level
 *  cache survives React re-mounts and is invalidated by analysis runAt.
 *
 *  Callers:
 *    - `AIObservationsPlaceholder` in atoms.tsx → in-app panel
 *    - `downloadMISExcel` flow in ReportLayout.tsx → pre-fetches all
 *      sections before building the workbook
 */

import type { AppState } from '../../types';
import type { RuleViolation } from '../rules';
import { runMIS } from './runner';
import { runRules, DEFAULT_RULES } from '../rules';
import { ALL_MIS_METRICS } from './metrics';

// ── Types matching the API contract ──────────────────────────────────────

export interface SectionObservation {
  type: 'positive' | 'risk' | 'note';
  text: string;
}

export interface SectionFixStep {
  title: string;
  category: 'data-setup' | 'operations' | 'financial' | 'compliance' | 'reporting';
  rationale: string;
  impact: string;
  effort: 'S' | 'M' | 'L';
  tallySteps?: string[];
}

export interface SectionInsights {
  observations: SectionObservation[];
  fixSteps: SectionFixStep[];
}

interface CachedInsights {
  runAt: number;
  data: SectionInsights;
}

/** Section name → MIS domain IDs to filter metrics by.  Matches the
 *  mapping in atoms.tsx so both in-app and Excel pull the same scope. */
export const SECTION_DOMAINS: Record<string, string[]> = {
  'P&L':                  ['D1'],
  'Cash Flow':            ['D2'],
  'Working Capital':      ['D3'],
  'Statutory':            ['D4'],
  'Balance Sheet':        ['D5'],
  'Cost Analysis':        ['D6'],
  'Business Performance': ['D7'],
  'Forecast':             ['D1', 'D2', 'D5'],
  'Executive Summary':    ['D1', 'D2', 'D3', 'D5', 'D7'],
};

// ── Cache ────────────────────────────────────────────────────────────────

const cache = new Map<string, CachedInsights>();

export function readCachedSectionInsights(section: string, runAt: number): SectionInsights | null {
  const hit = cache.get(section);
  return hit && hit.runAt === runAt ? hit.data : null;
}

export function setCachedSectionInsights(section: string, runAt: number, data: SectionInsights): void {
  cache.set(section, { runAt, data });
}

export function clearSectionCache(section?: string): void {
  if (section) cache.delete(section);
  else cache.clear();
}

// ── Payload builder ──────────────────────────────────────────────────────

/**
 * Build the numbers-only payload for one section.  No PII — party names,
 * voucher details, raw ledger entries never leave the device.
 */
export function buildSectionPayload(state: AppState, section: string): Record<string, unknown> | null {
  if (!state.results) return null;
  const out = runMIS({ state, manual: state.misManualInputs ?? {}, budget: state.misBudget });
  const violations = runRules(state.misRules ?? DEFAULT_RULES, out.byId, state.misSetup?.sector ?? null);

  const domainIds = SECTION_DOMAINS[section] ?? [];
  const inScope = (mDomain: string) => domainIds.length === 0 || domainIds.includes(mDomain);
  const sectionMetricIds = new Set(
    ALL_MIS_METRICS.filter(m => inScope(m.domainId)).map(m => m.id),
  );

  const metrics = ALL_MIS_METRICS
    .filter(m => sectionMetricIds.has(m.id))
    .map(m => {
      const r = out.byId[m.id];
      return {
        id: m.id,
        label: m.label,
        status: r?.status ?? 'missing-data',
        value: r?.value?.numeric ?? r?.value?.text,
        unit: r?.value?.unit,
        reason: r?.reason,
      };
    });

  const sectionViolations = violations
    .filter(v => !v.metricId || sectionMetricIds.has(v.metricId))
    .map(v => ({ severity: v.severity, message: v.message, metricId: v.metricId }));

  const pd = state.parsedData;
  const revenue = Math.abs(pd?.revenue ?? 0);
  const pat = pd?.bsNetProfit ?? pd?.netProfit ?? 0;
  const financials = {
    revenue,
    pat,
    patMarginPct: revenue ? pat / revenue : 0,
    grossProfit: out.byId['P5']?.value?.numeric,
    cashBank: Math.abs(pd?.bsCashBankTotal ?? 0),
    debtors: Math.abs(pd?.debtorBal ?? 0),
    creditors: Math.abs(pd?.creditorBal ?? 0),
    closingStock: Math.abs(pd?.closingStock ?? 0),
    currentRatio: out.byId['BS1']?.value?.numeric,
    debtEquity: out.byId['BS4']?.value?.numeric,
    dso: out.byId['WC2']?.value?.numeric,
    dpo: out.byId['WC7']?.value?.numeric,
  };

  return {
    section,
    metrics,
    financials,
    violations: sectionViolations,
    sector: state.misSetup?.sector ?? null,
  };
}

// ── Fetcher ──────────────────────────────────────────────────────────────

const VALID_OBS_TYPES = new Set(['positive', 'risk', 'note']);
const VALID_FIX_CATS = new Set(['data-setup', 'operations', 'financial', 'compliance', 'reporting']);

function validateInsights(raw: unknown): SectionInsights {
  const r = (raw ?? {}) as Partial<SectionInsights>;
  const observations: SectionObservation[] = Array.isArray(r.observations)
    ? r.observations
        .filter((o): o is SectionObservation =>
          !!o && typeof o.text === 'string' && VALID_OBS_TYPES.has(o.type as string))
        .slice(0, 6)
    : [];
  const fixSteps: SectionFixStep[] = Array.isArray(r.fixSteps)
    ? r.fixSteps
        .filter((s): s is SectionFixStep => !!s && typeof s.title === 'string')
        .map(s => ({
          title: s.title.slice(0, 140),
          category: VALID_FIX_CATS.has(s.category as string) ? s.category : 'operations',
          rationale: typeof s.rationale === 'string' ? s.rationale.slice(0, 600) : '',
          impact: typeof s.impact === 'string' ? s.impact.slice(0, 300) : '',
          effort: s.effort === 'S' || s.effort === 'M' || s.effort === 'L' ? s.effort : 'M',
          tallySteps: Array.isArray(s.tallySteps)
            ? s.tallySteps.filter((x): x is string => typeof x === 'string').slice(0, 5)
            : undefined,
        }))
        .slice(0, 6)
    : [];
  return { observations, fixSteps };
}

/**
 * Fetch insights for one section.  Reads cache first (when `state.results.runAt`
 * matches), otherwise POSTs to /api/ai/section-observations and caches the
 * response.  Returns null when consent isn't given or analysis isn't loaded.
 */
export async function fetchSectionInsights(
  state: AppState,
  section: string,
  opts: { force?: boolean } = {},
): Promise<SectionInsights | null> {
  if (!state.aiConsentGiven || !state.results) return null;
  const runAt = state.results.runAt;
  if (!opts.force) {
    const cached = readCachedSectionInsights(section, runAt);
    if (cached) return cached;
  }
  const payload = buildSectionPayload(state, section);
  if (!payload) return null;
  try {
    const resp = await fetch('/api/ai/section-observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return null;
    const raw = await resp.json();
    const data = validateInsights(raw);
    setCachedSectionInsights(section, runAt, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Pre-fetch insights for every section in parallel — used by the Excel
 * exporter to populate the workbook with AI-generated commentary before
 * building the file.  Already-cached sections are skipped.
 */
export async function prefetchAllSectionInsights(
  state: AppState,
  sections: string[],
): Promise<Record<string, SectionInsights>> {
  if (!state.aiConsentGiven || !state.results) return {};
  const runAt = state.results.runAt;
  const result: Record<string, SectionInsights> = {};
  const pending: Array<Promise<void>> = [];
  for (const section of sections) {
    const cached = readCachedSectionInsights(section, runAt);
    if (cached) {
      result[section] = cached;
      continue;
    }
    pending.push(
      fetchSectionInsights(state, section).then(data => {
        if (data) result[section] = data;
      }),
    );
  }
  await Promise.all(pending);
  return result;
}

/** Pull all currently-cached sections at the given runAt (no fetch). */
export function readAllCachedInsights(runAt: number): Record<string, SectionInsights> {
  const out: Record<string, SectionInsights> = {};
  for (const [section, entry] of cache.entries()) {
    if (entry.runAt === runAt) out[section] = entry.data;
  }
  return out;
}

