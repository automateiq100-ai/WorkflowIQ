// Shared H4 (Cash + Bank reconciliation) computation.  Both the engine's
// pass/fail message and the H4Breakdown modal read from the same source so
// the numbers stay aligned — no more "engine says −3.09L, modal says −3.05L".
//
// Two design choices baked in here (see comments at each usage):
//   1. RECEIPTS are direction-agnostic: every receipt-type voucher
//      contributes its full magnitude.  Mirrors Tally's "List of Receipt
//      Vouchers" Credit-column total.
//   2. PAYMENTS follow the cash/bank leg's Dr/Cr direction.  Normal
//      payments (Cr Bank, money out) add; refund-style payments (Dr Bank)
//      subtract.  Matches Tally's "Debit Amount − Credit Amount" total.
//   3. TB SIGN CONVENTION is auto-detected by voting across ledgers whose
//      natural Dr/Cr side we know (capital → Cr, debtor → Dr, etc.).
//      Cr-positive exports get sign-flipped so the natural reading
//      (Dr bank = positive, OD = negative) holds downstream.

import type { Voucher, ChunkedStats, TBLedger, MasterEntry, ParsedStatement } from './types';
import { classifyLedger, buildBSHierarchyMap, type LedgerCategory, type BSHierarchyMap } from './tally-groups';
import { classifyVoucherType } from './tally-voucher-types';
import type { OverrideMap } from './ledger-overrides';

const CASH_BANK_CATEGORIES: ReadonlySet<LedgerCategory> = new Set<LedgerCategory>(['cash', 'bank', 'bank-od']);

const PAYMENT_EXCLUDED_NAMES = new Set([
  'bank charges entry',
  'salary payment',
  'salary voucher',
  'payroll',
  'expense entry',
]);

const CONTRA_TYPE_NAMES = new Set([
  'contra', 'cash to bank', 'bank to cash', 'inter bank transfer',
]);

export interface H4Context {
  masterMap: Map<string, MasterEntry>;
  bsHierarchy: BSHierarchyMap;
  ledgerOverrides: OverrideMap | undefined;
}

export function buildH4Context(
  masterEntries: MasterEntry[] | undefined,
  bsStatement: ParsedStatement | null | undefined,
  ledgerOverrides: OverrideMap | undefined,
): H4Context {
  const masterMap = new Map<string, MasterEntry>();
  for (const e of masterEntries ?? []) masterMap.set(e.name.toLowerCase().trim(), e);
  return {
    masterMap,
    bsHierarchy: buildBSHierarchyMap(bsStatement ?? null),
    ledgerOverrides,
  };
}

export function isCashBank(name: string, ctx: H4Context): boolean {
  return CASH_BANK_CATEGORIES.has(
    classifyLedger(name, ctx.masterMap, ctx.ledgerOverrides, ctx.bsHierarchy).category,
  );
}

function cashLegDirection(
  legs: Voucher['legs'],
  ctx: H4Context,
): 'dr' | 'cr' | null {
  if (!legs?.length) return null;
  for (const leg of legs) {
    if (isCashBank(leg.name, ctx)) return leg.dr ? 'dr' : 'cr';
  }
  return null;
}

export interface DBCashBankFlow {
  receipts: number;
  payments: number;
  contras: number;
  rCount: number;
  pCount: number;
  cCount: number;
  receiptVouchers: Voucher[];
  paymentVouchers: Voucher[];
  contraVouchers: Voucher[];
  /** receipts − payments — the figure compared against the TB net. */
  net: number;
}

export function computeDBCashBankFlow(
  vouchers: ChunkedStats['vouchers'] | undefined,
  ctx: H4Context,
): DBCashBankFlow {
  const receiptVouchers: Voucher[] = [];
  const paymentVouchers: Voucher[] = [];
  const contraVouchers: Voucher[] = [];
  let receipts = 0, payments = 0, contras = 0;

  for (const v of vouchers ?? []) {
    const type = v.type.toLowerCase().trim();
    const semantic = classifyVoucherType(v.type).semantic;
    const amt = Math.abs(v.amount);

    if (semantic === 'receipt') {
      // Direction-agnostic: Tally's Receipt Vouchers list counts every
      // entry positively regardless of which side the bank leg sits on.
      receipts += amt;
      receiptVouchers.push(v);
    } else if (semantic === 'payment' && !PAYMENT_EXCLUDED_NAMES.has(type)) {
      // Excludes Bank Charges Entry / Salary Payment / Payroll — Tally
      // lists those as separate voucher types under the Payment parent.
      // Normal payment → +amt; refund (Dr cash/bank) → −amt.
      const dir = cashLegDirection(v.legs, ctx);
      payments += dir === 'dr' ? -amt : amt;
      paymentVouchers.push(v);
    } else if (CONTRA_TYPE_NAMES.has(type)) {
      // Sum the Dr-side cash/bank leg amount (each contra moves money
      // once between cash and bank).
      let drCashBank = 0;
      for (const leg of v.legs ?? []) {
        if (!leg.dr) continue;
        if (isCashBank(leg.name, ctx)) drCashBank += leg.amt;
      }
      contras += drCashBank > 0 ? drCashBank : amt;
      contraVouchers.push(v);
    }
  }

  return {
    receipts, payments, contras,
    rCount: receiptVouchers.length, pCount: paymentVouchers.length, cCount: contraVouchers.length,
    receiptVouchers, paymentVouchers, contraVouchers,
    net: receipts - payments,
  };
}

/**
 * Detect Tally TB sign convention by polling ledgers whose natural Dr/Cr
 * side we know.  Returns the multiplier to apply to closing/opening values
 * (1 = preserve, −1 = flip).  Falls back to "no flip" when the TB doesn't
 * contain enough classifiable ledgers to vote conclusively.
 *
 * NOTE: as of the parser-side sign normalization in `parseTrialBalance`,
 * all TBLedger values arrive in canonical **Dr-positive** form (positive
 * closing = Dr balance, negative = Cr balance), so this function returns
 * 1 in steady state.  Kept exported for tests / future debugging /
 * parity with any legacy parsing path that hasn't yet adopted the
 * upstream normalization.
 */
export function detectTBSignFlip(tbLedgers: TBLedger[], ctx: H4Context): 1 | -1 {
  const expectedSignDrPos: Partial<Record<LedgerCategory, 1 | -1>> = {
    capital:   -1,
    creditor:  -1,
    'bank-od': -1,
    debtor:     1,
    sales:     -1,
    purchase:   1,
  };
  let crPosVotes = 0;
  let drPosVotes = 0;
  for (const l of tbLedgers) {
    const cat = classifyLedger(l.name, ctx.masterMap, ctx.ledgerOverrides, ctx.bsHierarchy).category;
    const expected = expectedSignDrPos[cat];
    if (!expected || l.closing === 0) continue;
    const actual: 1 | -1 = l.closing > 0 ? 1 : -1;
    if (actual === expected) drPosVotes++; else crPosVotes++;
  }
  return crPosVotes > drPosVotes ? -1 : 1;
}

/**
 * TB-side cash/bank net movement (closing − opening).  Tally TB exports
 * can use either Dr-positive or Cr-positive sign convention; sign-flip
 * normalisation happens upstream in parseTrialBalance, so every
 * TBLedger arrives here in canonical **Dr-positive** form (positive=Dr,
 * negative=Cr).  Cash/bank assets sit on the Dr side, so their closing
 * is stored as POSITIVE — `closing − opening` reads directly as net
 * movement (positive = balance grew, negative = balance shrank).
 *
 * Returns null when no cash/bank ledger has opening data available.
 */
export function computeTBCashBankNet(tbLedgers: TBLedger[], ctx: H4Context): number | null {
  let net = 0;
  let any = false;
  for (const l of tbLedgers) {
    if (!isCashBank(l.name, ctx)) continue;
    if (l.opening === undefined) continue;
    any = true;
    net += l.closing - l.opening;
  }
  return any ? net : null;
}
