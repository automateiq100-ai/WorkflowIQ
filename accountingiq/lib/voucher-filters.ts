// Per-flag drill-down: given a flag id (either an engine check id like
// "C1" or a data-flag id like "flag-missing-vno"), return the actual
// vouchers that triggered it.  Single source of truth used by both the
// dashboard Critical Flags panel and the full FlagsView.
//
// Each predicate runs over Voucher.flags (set by parser.ts at the
// moment a voucher is processed) — except dup-vno, which has no
// per-voucher marker because duplicate detection needs the whole map.

import type { ChunkedStats, ParsedData, Voucher, VoucherFlag } from './types';

// ── dupVnoMap key helpers ──────────────────────────────────────────────────
// Duplicate detection keys on `${type}${vno}` (delimiter is U+0001, a
// control char that can't appear in a Tally voucher number or type name).
// This matches Tally's series semantics — Sales/001 and Receipt/001 are
// independent voucher numbers, not duplicates.

const DUP_KEY_DELIM = '';

export function makeDupKey(type: string, vno: string): string {
  return `${type}${DUP_KEY_DELIM}${vno}`;
}

export function splitDupKey(key: string): { type: string; vno: string } {
  const i = key.indexOf(DUP_KEY_DELIM);
  if (i < 0) return { type: '', vno: key };       // legacy bare-vno keys
  return { type: key.slice(0, i), vno: key.slice(i + 1) };
}

/** Voucher fields to surface as extra columns beyond the standard
 *  date/vno/type/party/amount/narration set.  Kept as string tokens so the
 *  lib stays free of React types; VoucherDrillDown knows how to render each. */
export type DrillDownExtraColumn = 'suggestedType';

export interface DrillDown {
  /** Heading shown at the top of the modal — usually the flag title. */
  title: string;
  /** Vouchers that triggered the flag, in DayBook order.  Empty array means
   *  the flag isn't a per-voucher finding (drill-down not offered). */
  vouchers: Voucher[];
  /** Additional per-voucher columns specific to this flag (e.g. wrongType
   *  surfaces the engine's suggestedType so users see what to reclassify to). */
  extraColumns?: DrillDownExtraColumn[];
}

/** Map a flag id → the VoucherFlag tag the parser sets, if any. */
const FLAG_ID_TO_TAG: Record<string, VoucherFlag> = {
  // Engine check ids (see lib/engine.ts) — only the ones backed by a
  // per-voucher counter, not aggregate-metric checks like balance
  // variances or GST ratios.
  C1: 'missingVno',
  C3: 'missingParty',
  C4: 'outOfFY',
  C5: 'wrongType',
  C6: 'zeroAmt',
  G3: 'cashOver10k',
  // Data-flag ids (see lib/flags.ts).
  'flag-missing-vno':   'missingVno',
  'flag-missing-party': 'missingParty',
  'flag-zero-amt':      'zeroAmt',
  'flag-cash-limit':    'cashOver10k',
  'flag-out-of-fy':     'outOfFY',
  'flag-wrong-type':    'wrongType',
};

/** Checks whose drill-down is computed on-the-fly from voucher attributes
 *  rather than from a parser-set tag.  Each predicate runs over the full
 *  voucher list to surface the rows that triggered the finding. */
const VOUCHER_PREDICATE_DRILLDOWNS: Record<string, (v: Voucher) => boolean> = {
  // F4 — high-value entries (> ₹1,00,000) without narration.
  F4: v => Math.abs(v.amount) > 100_000 && !v.narration?.trim(),
  // G4 — round-number entries (multiple of 1,000).  Mirrors the parser's
  // counter (`amt > 0 && amt % 1000 === 0`) so the drill-down rows agree
  // with the count surfaced on the check note.
  G4: v => {
    const amt = Math.abs(v.amount);
    return amt > 0 && amt % 1000 === 0;
  },
};

// ── Ledger-level drill-downs ───────────────────────────────────────────────
// Some flags (suspense balances, "wrong group" classifications, etc.) refer
// to specific LEDGERS rather than vouchers.  We surface them by adapting
// each ledger row into a synthetic Voucher so the existing drill-down modal
// renders them — the "Party" column shows the ledger name and "Amount"
// shows the balance.  The other voucher fields stay empty.

function ledgersAsVouchers(rows: Array<{ name: string; amount: number }>): Voucher[] {
  return rows.map(r => ({
    date: '',
    vno: '',
    type: 'Ledger',
    party: r.name,
    amount: Math.abs(r.amount),
    narration: '',
  }));
}

const LEDGER_FLAG_IDS = new Set([
  'B1',           // suspense / miscellaneous balances
  'B2',           // near-duplicate ledger pairs (uses dupPairDetails)
  'G1',           // party split across debtor + creditor (uses partySplitPairs)
  'G2',           // same expense split across ledger groups (uses dupPairDetails)
  'flag-suspense', // legacy data-flag id, kept for backward compat
]);

/** Cross-statement reconciliations that get a custom (non-voucher-list)
 *  breakdown panel instead of the VoucherDrillDown modal. */
const CUSTOM_BREAKDOWN_FLAG_IDS = new Set([
  'H4',           // Cash + Bank reconciliation (DB voucher flow ↔ TB balances)
]);

/** Returns true when a drill-down link should render for this flag id. */
export function hasDrillDown(
  flagId: string,
  dbStats: ChunkedStats | null,
  parsedData?: Partial<ParsedData>,
): boolean {
  // Ledger-level drill-downs don't need dbStats.vouchers.
  if (LEDGER_FLAG_IDS.has(flagId)) {
    if (flagId === 'B1' || flagId === 'flag-suspense') {
      return (parsedData?.suspenseLedgers?.length ?? 0) > 0;
    }
    if (flagId === 'B2') {
      return (parsedData?.dupPairDetails?.length ?? 0) > 0;
    }
    if (flagId === 'G1') {
      return (parsedData?.partySplitPairs?.length ?? 0) > 0;
    }
    if (flagId === 'G2') {
      // G2 surfaces same-name expenses classified into different P&L
      // categories (e.g. "Office Rent" appearing once under Direct
      // Expenses and once under Indirect Expenses).  Distinct from B2,
      // which catches name-only near-duplicates.
      return (parsedData?.expenseSplitPairs?.length ?? 0) > 0;
    }
  }
  // Custom breakdowns render their own panel — the click handler in the
  // view picks the right component based on flag id.  H4 surfaces TB
  // cash/bank ledgers + DayBook receipt/payment/contra totals, so we only
  // need one of them to be non-empty for the click to be useful.
  if (CUSTOM_BREAKDOWN_FLAG_IDS.has(flagId)) {
    const hasTBLedgers = (parsedData?.tbLedgers?.length ?? 0) > 0;
    const hasVouchers = (dbStats?.vouchers?.length ?? 0) > 0;
    return hasTBLedgers || hasVouchers;
  }
  if (!dbStats?.vouchers?.length) return false;
  if (flagId === 'C2' || flagId === 'flag-dup-vno') return true;
  if (flagId in VOUCHER_PREDICATE_DRILLDOWNS) return true;
  return flagId in FLAG_ID_TO_TAG;
}

/** Returns true when a check id is conceptually drillable — i.e. there's a
 *  drill-down handler for it — regardless of whether the underlying data
 *  is currently loaded.  Used to render the drill-down link even when
 *  the user is viewing a saved analysis from history (where dbStats and
 *  parsedData haven't been reconstructed): the modal click handler then
 *  surfaces a "re-upload files to load voucher details" message instead
 *  of the link silently disappearing. */
export function isDrillableCheck(flagId: string): boolean {
  if (LEDGER_FLAG_IDS.has(flagId)) return true;
  if (CUSTOM_BREAKDOWN_FLAG_IDS.has(flagId)) return true;
  if (flagId === 'C2' || flagId === 'flag-dup-vno') return true;
  if (flagId in VOUCHER_PREDICATE_DRILLDOWNS) return true;
  return flagId in FLAG_ID_TO_TAG;
}

/** Compute the drill-down for a given flag id.  Returns null when the flag
 *  isn't a per-voucher finding or dbStats has no vouchers. */
export function getDrillDown(
  flagId: string,
  title: string,
  dbStats: ChunkedStats | null,
  parsedData?: Partial<ParsedData>,
): DrillDown | null {
  // Suspense / miscellaneous ledgers — ledger-level finding.
  if (flagId === 'B1' || flagId === 'flag-suspense') {
    const rows = parsedData?.suspenseLedgers ?? [];
    if (rows.length === 0) return null;
    return { title, vouchers: ledgersAsVouchers(rows) };
  }

  // B2 near-duplicate ledger pairs are rendered by a dedicated
  // LedgerPairDrillDown component in each view (see view-level B2
  // special-case alongside H4).  G1 (party split across debtor+creditor)
  // and G2 (same expense in multiple ledger groups) reuse the same modal
  // shape — return null here so the default VoucherDrillDown doesn't try
  // to render the pairs as synthetic vouchers.
  if (flagId === 'B2' || flagId === 'G1' || flagId === 'G2') return null;

  const vouchers = dbStats?.vouchers;
  if (!vouchers?.length) return null;

  // Predicate-driven drill-downs (computed on the fly).  Currently F4
  // (high-value entries missing narration); extend the map above to add
  // more.
  const predicate = VOUCHER_PREDICATE_DRILLDOWNS[flagId];
  if (predicate) {
    return { title, vouchers: vouchers.filter(predicate) };
  }

  // Duplicate voucher numbers — no per-voucher marker; recompute from the
  // map.  Sorted so vouchers with the same number land next to each other.
  if (flagId === 'C2' || flagId === 'flag-dup-vno') {
    const dupMap = dbStats?.dupVnoMap ?? {};
    const dups = vouchers
      .filter(v => v.vno && (dupMap[makeDupKey(v.type, v.vno)] ?? 0) > 1)
      .slice()
      .sort((a, b) =>
        a.type.localeCompare(b.type) ||
        a.vno.localeCompare(b.vno) ||
        a.date.localeCompare(b.date),
      );
    return { title, vouchers: dups };
  }

  const tag = FLAG_ID_TO_TAG[flagId];
  if (!tag) return null;
  const filtered = vouchers.filter(v => v.flags?.includes(tag));
  // Wrong-type vouchers get a "Suggested Type" column populated by the
  // engine post-pass — surfaces what type the voucher *should* be so the
  // user knows what to reclassify it to in Tally.
  const extraColumns: DrillDownExtraColumn[] | undefined =
    tag === 'wrongType' ? ['suggestedType'] : undefined;
  return { title, vouchers: filtered, ...(extraColumns ? { extraColumns } : {}) };
}
