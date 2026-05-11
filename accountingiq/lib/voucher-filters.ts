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
  // Data-flag ids (see lib/flags.ts).
  'flag-missing-vno':   'missingVno',
  'flag-missing-party': 'missingParty',
  'flag-zero-amt':      'zeroAmt',
  'flag-cash-limit':    'cashOver10k',
  'flag-out-of-fy':     'outOfFY',
  'flag-wrong-type':    'wrongType',
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
  'B1',           // engine check id
  'flag-suspense', // data flag id
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
  }
  if (!dbStats?.vouchers?.length) return false;
  if (flagId === 'C2' || flagId === 'flag-dup-vno') return true;
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

  const vouchers = dbStats?.vouchers;
  if (!vouchers?.length) return null;

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
