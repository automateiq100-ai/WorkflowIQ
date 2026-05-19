'use client';

/**
 * ── MIS profile persistence — per-company localStorage ──────────────────
 *
 * The MIS module collects a lot of user input that should survive page
 * refresh and re-uploads:
 *   • misSetup        — sector, budget toggle, selected metric ids
 *   • misManualInputs — headcount, order book, drawing power, covenants…
 *   • misBudget       — parsed budget Excel data
 *   • misRules        — user-customised threshold rules
 *   • misDocuments    — uploaded document references (metadata only)
 *
 * None of this is huge, all of it is JSON-serialisable, and none of it
 * leaks sensitive data (no XML, no voucher rows, just user-entered
 * numbers and rule overrides).  Per-company localStorage is the right
 * scope — load on COMPANY_SELECTED, save on every MIS_* reducer action.
 *
 * Pattern mirrors lib/ledger-overrides.ts.  Storage key prefix is namespaced
 * so multiple companies coexist without collision.
 */

import type {
  MISSetup, MISDocumentRef,
} from './types';
import type { ManualInputs, BudgetData } from './layer2/types';
import type { Rule } from './layer2/rules';

const STORAGE_KEY_PREFIX = 'aiq.misProfile.';

function key(companyId: string): string {
  return STORAGE_KEY_PREFIX + companyId;
}

/** Serialised shape — exactly what we write to localStorage. */
export interface MISProfileSnapshot {
  misSetup?: MISSetup;
  misManualInputs?: ManualInputs;
  misBudget?: BudgetData;
  misRules?: Rule[];
  misDocuments?: Record<string, MISDocumentRef>;
  /** Schema version — bumped if we change the snapshot shape later so a
   *  stale entry can be discarded gracefully instead of crashing. */
  version: 1;
}

const CURRENT_VERSION = 1 as const;

/**
 * Load the MIS profile snapshot for a company from localStorage.  Returns
 * an empty snapshot if storage is unavailable, the company has no entry,
 * the JSON is malformed, or the schema version doesn't match.
 *
 * Safe to call during SSR — no-ops when window is undefined.
 */
export function loadMISProfile(companyId: string): MISProfileSnapshot {
  const empty: MISProfileSnapshot = { version: CURRENT_VERSION };
  if (!companyId || typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(key(companyId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<MISProfileSnapshot>;
    if (!parsed || typeof parsed !== 'object') return empty;
    if (parsed.version !== CURRENT_VERSION) {
      // Schema mismatch — drop the stale entry rather than risk runtime
      // errors from outdated shapes.
      try { window.localStorage.removeItem(key(companyId)); } catch { /* ignore */ }
      return empty;
    }
    return { ...empty, ...parsed };
  } catch {
    try { window.localStorage.removeItem(key(companyId)); } catch { /* ignore */ }
    return empty;
  }
}

/**
 * Persist the MIS profile snapshot for a company.  Writes synchronously
 * so the next render is immediately consistent.  Silently swallows quota
 * errors — the worst-case fallback is "user re-enters profile next
 * session", same as before persistence was added.
 */
export function saveMISProfile(companyId: string, snapshot: Omit<MISProfileSnapshot, 'version'>): void {
  if (!companyId || typeof window === 'undefined') return;
  try {
    const payload: MISProfileSnapshot = { ...snapshot, version: CURRENT_VERSION };
    window.localStorage.setItem(key(companyId), JSON.stringify(payload));
  } catch {
    /* quota / disabled — ignore */
  }
}

/** Convenience: clear the profile for a company (e.g. on "reset profile"). */
export function clearMISProfile(companyId: string): void {
  if (!companyId || typeof window === 'undefined') return;
  try { window.localStorage.removeItem(key(companyId)); } catch { /* ignore */ }
}
