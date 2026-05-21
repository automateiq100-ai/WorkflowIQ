'use client';

/**
 * ── Classification telemetry — fire-and-forget client helper ─────────────
 *
 * Called once at the end of analyseFiles() with an aggregate summary of
 * how the classifier did on this company.  Two purposes:
 *
 *   1. Per-customer reporting — "X of your Y ledgers are unclassified"
 *      can drive an in-app nudge to fill the master.
 *   2. Catalog evolution — when a ledger or voucher-type name shows up
 *      at LOW confidence across many tenants, that's evidence to add it
 *      to the central catalog (lib/tally-groups.ts /
 *      lib/tally-voucher-types.ts).
 *
 * Privacy: we only send NAMES (which the user typed in Tally's UI) plus
 * confidence-level counts.  No balances, no narration, no transaction
 * data leaves the client through this channel.
 *
 * Failure mode: silent.  Telemetry must never block analysis or surface
 * an error to the user.
 */

export interface ClassificationSummary {
  company_id: string;
  total_ledgers: number;
  ledger_overridden: number;
  ledger_high: number;
  ledger_medium: number;
  ledger_low: number;
  ledger_none: number;
  /** Names of ledgers the classifier couldn't place — these are the
   *  highest-priority candidates for catalog additions. */
  unclassified_ledgers: string[];
  /** Names that hit LOW (regex fallback) — likely catalog extensions. */
  low_conf_ledgers: string[];
  /** Voucher type names that didn't classify (Phase 4 catalog). */
  unknown_voucher_types: string[];
  industry?: string;
  files_loaded: number;
}

/** POST a summary to the server.  Returns void so callers can `void`-call
 *  without awaiting — by design no caller should care if this succeeds. */
export async function recordClassificationSummary(summary: ClassificationSummary): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/telemetry/classification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
      keepalive: true,
    });
  } catch {
    /* swallow — see header comment */
  }
}
