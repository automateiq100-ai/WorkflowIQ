'use client';

/**
 * ── Ledger Classification Overrides — per-company master config ─────────
 *
 * Auto-classification (tally-groups.ts) is correct for the vast majority
 * of ledgers, but at scale we will always encounter:
 *
 *   • Custom group names that aren't in our catalog
 *   • Industry-specific ledgers we couldn't predict
 *   • Master files that didn't get pulled / are partial
 *   • Genuinely ambiguous names ("Misc Receipts" → income or refund?)
 *
 * Rather than ship a code change every time a customer hits a mis-class,
 * the right answer is a **per-company master config** the user can review
 * and amend.  Once a user confirms or overrides a classification it
 * becomes ground truth for that company forever (until they change it).
 *
 * Architecture:
 *
 *   COMPANY OVERRIDES  ─►  classifyLedger() consults this first
 *         │                 confidence === 'overridden' ⇒ trust user
 *         ▼
 *   SYSTEM CATALOG     ─►  master-map walk (tally-groups.ts)
 *         │                 confidence === 'high'
 *         ▼
 *   NAME REGEX         ─►  fallback when nothing else hits
 *                          confidence === 'low'
 *
 * Storage (Phase 2): hybrid — localStorage for instant sync read on
 * company select (avoids waterfall before first render), Supabase for
 * the source of truth across devices and users.  loadOverrides() reads
 * the cache synchronously; hydrateOverridesFromServer() refreshes from
 * the API in the background; saveOverrides() writes to both.
 */

import type { LedgerCategory } from './tally-groups';

export interface LedgerOverride {
  /** Tally ledger name as it appears in TB / Master XML — case preserved
   *  for display, lookup is case-insensitive. */
  ledgerName: string;
  /** User's chosen category (or 'auto-confirmed' to lock the system
   *  suggestion in place so we never bug them about it again). */
  category: LedgerCategory;
  /** Primary group name when known — purely informational. */
  primaryGroup?: string;
  /** How this override entered the store.  'user-edited' is a manual pick;
   *  'auto-confirmed' is the user clicking "Confirm" on the system's
   *  HIGH-confidence suggestion (so it doesn't show as "needs review"). */
  source: 'user-edited' | 'auto-confirmed';
  /** ISO timestamp — useful for audit trail and conflict resolution
   *  when we move to Supabase. */
  updatedAt: string;
}

/** Map keyed by lowercased ledger name → override. */
export type OverrideMap = Map<string, LedgerOverride>;

const STORAGE_KEY_PREFIX = 'aiq.ledgerOverrides.';

function storageKey(companyId: string): string {
  return STORAGE_KEY_PREFIX + companyId;
}

/** Load all overrides for a company.  Returns an empty map when storage
 *  is unavailable, the company is unknown, or the JSON is malformed. */
export function loadOverrides(companyId: string): OverrideMap {
  const out: OverrideMap = new Map();
  if (!companyId || typeof window === 'undefined') return out;
  try {
    const raw = window.localStorage.getItem(storageKey(companyId));
    if (!raw) return out;
    const parsed = JSON.parse(raw) as LedgerOverride[];
    if (!Array.isArray(parsed)) return out;
    for (const o of parsed) {
      if (!o || typeof o.ledgerName !== 'string' || !o.ledgerName) continue;
      out.set(o.ledgerName.toLowerCase().trim(), o);
    }
  } catch {
    // Corrupt store — drop it silently rather than crash analysis.
    try { window.localStorage.removeItem(storageKey(companyId)); } catch { /* ignore */ }
  }
  return out;
}

/** Persist all overrides for a company.  Writes to localStorage
 *  synchronously (so the next render hits the cache) and fires a
 *  best-effort Supabase upsert in the background.  Server failures are
 *  swallowed — the cache is the truth for the current session, and the
 *  next save will retry the sync.
 */
export function saveOverrides(companyId: string, overrides: OverrideMap): void {
  if (!companyId || typeof window === 'undefined') return;
  try {
    const arr = Array.from(overrides.values());
    window.localStorage.setItem(storageKey(companyId), JSON.stringify(arr));
  } catch {
    /* quota exceeded or storage disabled — ignore, classifier will still
       work off the in-memory map for the current session. */
  }
  // Fire-and-forget server sync.  We don't await — the UI must stay
  // instant.  If the sync fails, the next save will pick up the same
  // batch (we always send the full set, not a delta).
  void syncOverridesToServer(companyId, overrides);
}

/**
 * Push the full override set for a company to Supabase.  Idempotent —
 * uses upsert on (company_id, ledger_name).  No-op when there are zero
 * overrides (a delete-all would need a separate DELETE call; we choose
 * not to, so the server retains history of what was previously saved).
 */
async function syncOverridesToServer(companyId: string, overrides: OverrideMap): Promise<void> {
  if (overrides.size === 0) return;
  try {
    await fetch('/api/master/ledger-overrides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId,
        overrides: Array.from(overrides.values()),
      }),
    });
  } catch {
    /* Network failure — cache stays correct, next save retries.  We
       deliberately don't surface a toast; this is background sync. */
  }
}

/**
 * Refresh the override cache for a company from Supabase.  Returns the
 * server-sourced map (or null on failure so the caller can keep using
 * what it already has).  Call once on company-select to overwrite stale
 * localStorage from another device.
 */
export async function hydrateOverridesFromServer(companyId: string): Promise<OverrideMap | null> {
  if (!companyId) return null;
  try {
    const r = await fetch(`/api/master/ledger-overrides?company_id=${encodeURIComponent(companyId)}`);
    if (!r.ok) return null;
    const data = await r.json() as { overrides?: LedgerOverride[] };
    const next: OverrideMap = new Map();
    for (const o of data.overrides ?? []) {
      if (!o?.ledgerName) continue;
      next.set(o.ledgerName.toLowerCase().trim(), o);
    }
    // Update the localStorage cache so subsequent reloads start hydrated.
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(storageKey(companyId), JSON.stringify(Array.from(next.values())));
      } catch { /* ignore */ }
    }
    return next;
  } catch {
    return null;
  }
}

/** Delete a single override on the server.  Mirror of removeOverride()
 *  for the local map — call from useEffect after dispatching the local
 *  state change so the UI never blocks on the server round-trip. */
export async function deleteOverrideOnServer(companyId: string, ledgerName: string): Promise<void> {
  if (!companyId || !ledgerName) return;
  try {
    await fetch(
      `/api/master/ledger-overrides?company_id=${encodeURIComponent(companyId)}&ledger=${encodeURIComponent(ledgerName)}`,
      { method: 'DELETE' },
    );
  } catch { /* ignore */ }
}

/** Convenience for callers that want to set or remove a single entry
 *  without juggling the whole map.  Returns the new map (caller can also
 *  hand it to React state). */
export function upsertOverride(
  current: OverrideMap,
  override: LedgerOverride,
): OverrideMap {
  const next = new Map(current);
  next.set(override.ledgerName.toLowerCase().trim(), override);
  return next;
}

export function removeOverride(
  current: OverrideMap,
  ledgerName: string,
): OverrideMap {
  const next = new Map(current);
  next.delete(ledgerName.toLowerCase().trim());
  return next;
}

/** Look up an override case-insensitively. */
export function getOverride(
  overrides: OverrideMap | undefined,
  ledgerName: string,
): LedgerOverride | undefined {
  if (!overrides) return undefined;
  return overrides.get(ledgerName.toLowerCase().trim());
}
