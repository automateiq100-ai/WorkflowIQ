'use client';

/**
 * ── Tally Voucher Type Catalog ───────────────────────────────────────────
 *
 * The accounting-meaningful classification of a voucher.  Tally Prime ships
 * with ~20 default voucher types and lets users define their own ("Bank
 * Charges Entry", "Salary Voucher", "Customer Refund", etc.) — the
 * engine's analysis (Day Book stats, sales/purchase totals, wrong-type
 * detection, GST cross-statement reconciliation) doesn't care about the
 * literal Tally name; it cares about the SEMANTIC type.
 *
 * Two layers, mirroring the ledger-classification architecture:
 *
 *   1. SYSTEM CATALOG (this file) — defaults + variant aliases.
 *   2. PER-COMPANY OVERRIDES (lib/voucher-type-overrides.ts) — user-
 *      confirmed mappings for non-standard types, persisted per company.
 *
 * The engine (parser.ts processVoucher) consumes the *semantic* type so
 * adding a new user-defined voucher to the company's master immediately
 * makes every check work correctly.
 */

/** Semantic voucher type — what the analysis engine reasons about. */
export type SemanticVoucherType =
  | 'sales'              // Cr Sales / Dr Debtor — adds to revenue
  | 'sales-return'       // Reverses a Sales — Credit Note typically
  | 'purchase'           // Dr Purchase / Cr Creditor — adds to COGS
  | 'purchase-return'    // Reverses a Purchase — Debit Note typically
  | 'receipt'            // Money in: Dr Cash/Bank Cr Debtor (or other)
  | 'payment'            // Money out: Cr Cash/Bank Dr Creditor (or other)
  | 'contra'             // Cash ↔ Bank or Bank ↔ Bank, no GL impact
  | 'journal'            // Non-cash GL adjustment
  | 'memorandum'         // Non-financial — for tracking only
  | 'stock'              // Stock movement — no financial impact (Stock Journal, Phys Stock, etc.)
  | 'order'              // Order book — Sales/Purchase Order, Delivery Note, Receipt Note
  | 'stat-adjustment'    // Statutory adjustment — typically for GST/TDS reclass
  | 'unknown';

/** All known semantic types in display order. */
export const SEMANTIC_VOUCHER_OPTIONS: Array<{ value: SemanticVoucherType; label: string; description: string }> = [
  { value: 'sales',           label: 'Sales',                description: 'Adds to revenue (Cr Sales)' },
  { value: 'sales-return',    label: 'Sales Return',         description: 'Reverses a sale (Credit Note typically)' },
  { value: 'purchase',        label: 'Purchase',             description: 'Adds to COGS (Dr Purchase)' },
  { value: 'purchase-return', label: 'Purchase Return',      description: 'Reverses a purchase (Debit Note typically)' },
  { value: 'receipt',         label: 'Receipt',              description: 'Money in (Dr Cash/Bank)' },
  { value: 'payment',         label: 'Payment',              description: 'Money out (Cr Cash/Bank)' },
  { value: 'contra',          label: 'Contra',               description: 'Cash ↔ Bank movement' },
  { value: 'journal',         label: 'Journal',              description: 'Non-cash GL adjustment' },
  { value: 'memorandum',      label: 'Memorandum',           description: 'Non-financial entry — tracking only' },
  { value: 'stock',           label: 'Stock / Inventory',    description: 'Stock movement, no GL impact' },
  { value: 'order',           label: 'Order / Note',         description: 'Order book — no GL impact' },
  { value: 'stat-adjustment', label: 'Statutory Adjustment', description: 'GST/TDS reclass entries' },
  { value: 'unknown',         label: 'Unknown',              description: 'Could not classify' },
];

/**
 * Catalog of Tally's default voucher type names mapped to their semantic
 * type.  Variants tolerate common spelling/punctuation differences.
 */
const VOUCHER_TYPE_CATALOG: Array<{ canonical: string; aliases: string[]; semantic: SemanticVoucherType }> = [
  { canonical: 'Sales',              aliases: ['sales invoice', 'tax invoice'],         semantic: 'sales' },
  { canonical: 'Credit Note',        aliases: ['sales return', 'customer return'],      semantic: 'sales-return' },
  { canonical: 'Sales Return',       aliases: [],                                       semantic: 'sales-return' },
  { canonical: 'Purchase',           aliases: [],                                       semantic: 'purchase' },
  { canonical: 'Debit Note',         aliases: ['purchase return', 'supplier return'],   semantic: 'purchase-return' },
  { canonical: 'Purchase Return',    aliases: [],                                       semantic: 'purchase-return' },
  { canonical: 'Receipt',            aliases: ['cash receipt', 'bank receipt', 'collection receipt'], semantic: 'receipt' },
  { canonical: 'Payment',            aliases: ['cash payment', 'bank payment', 'expense payment', 'bank charges entry', 'salary payment', 'salary voucher'], semantic: 'payment' },
  { canonical: 'Contra',             aliases: ['cash to bank', 'bank to cash', 'inter bank transfer'], semantic: 'contra' },
  { canonical: 'Journal',            aliases: [],                                       semantic: 'journal' },
  { canonical: 'Reversing Journal',  aliases: [],                                       semantic: 'journal' },
  { canonical: 'Memorandum',         aliases: ['memo'],                                 semantic: 'memorandum' },
  { canonical: 'Stock Journal',      aliases: ['stock transfer'],                       semantic: 'stock' },
  { canonical: 'Physical Stock',     aliases: [],                                       semantic: 'stock' },
  { canonical: 'Manufacturing Journal', aliases: ['production journal'],                semantic: 'stock' },
  { canonical: 'Material In',        aliases: ['material out'],                         semantic: 'stock' },
  { canonical: 'Sales Order',        aliases: [],                                       semantic: 'order' },
  { canonical: 'Purchase Order',     aliases: [],                                       semantic: 'order' },
  { canonical: 'Delivery Note',      aliases: ['delivery challan'],                     semantic: 'order' },
  { canonical: 'Receipt Note',       aliases: [],                                       semantic: 'order' },
  { canonical: 'Rejection In',       aliases: ['rejection out'],                        semantic: 'order' },
  { canonical: 'Quotation',          aliases: [],                                       semantic: 'order' },
  { canonical: 'Stat Adjustment',    aliases: ['statutory adjustment', 'gst adjustment', 'tds adjustment'], semantic: 'stat-adjustment' },
  { canonical: 'Attendance',         aliases: ['payroll attendance'],                   semantic: 'memorandum' },
  { canonical: 'Payroll',            aliases: [],                                       semantic: 'payment' },
];

/** Substring fallback patterns for user-defined voucher types — applied
 *  after exact / variant catalog lookup misses.  Order matters; first
 *  match wins. */
const FALLBACK_PATTERNS: Array<{ semantic: SemanticVoucherType; patterns: RegExp[] }> = [
  { semantic: 'sales-return',    patterns: [/\bsales?\s*return/, /\bcredit\s*note/, /\bcustomer\s*refund/, /\bcredit\s*memo/] },
  { semantic: 'purchase-return', patterns: [/\bpurchase\s*return/, /\bdebit\s*note/, /\bsupplier\s*refund/, /\bdebit\s*memo/] },
  { semantic: 'sales',           patterns: [/\bsales?\b/, /\binvoice\b/, /\bbilling\b/] },
  { semantic: 'purchase',        patterns: [/\bpurchase/, /\bvendor\s*bill/, /\bsupplier\s*bill/] },
  { semantic: 'contra',          patterns: [/\bcontra\b/, /\bbank\s*to\s*bank/, /\bcash\s*to\s*bank/] },
  { semantic: 'receipt',         patterns: [/\breceipt\b/, /\bcollection\b/] },
  { semantic: 'payment',         patterns: [/\bpayment\b/, /\bsalary\b/, /\bbank\s*charge/, /\bexpense\s*entry/] },
  { semantic: 'journal',         patterns: [/\bjournal\b/, /\badjust(ment)?\b/] },
  { semantic: 'order',           patterns: [/\border\b/, /\bdelivery\s*(note|challan)/, /\breceipt\s*note/, /\bquotation/] },
  { semantic: 'stock',           patterns: [/\bstock\b/, /\bphysical\b/, /\bmanufactur/, /\bmaterial\s*(in|out)/] },
  { semantic: 'stat-adjustment', patterns: [/\bstat\b/, /\bgst\s*adj/, /\btds\s*adj/] },
  { semantic: 'memorandum',      patterns: [/\bmemo/, /\battendance\b/] },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/&.,]+/g, '');
}

const CANONICAL_LOOKUP = new Map<string, SemanticVoucherType>();
for (const e of VOUCHER_TYPE_CATALOG) {
  CANONICAL_LOOKUP.set(normalise(e.canonical), e.semantic);
  for (const a of e.aliases) CANONICAL_LOOKUP.set(normalise(a), e.semantic);
}

export interface VoucherTypeClassification {
  semantic: SemanticVoucherType;
  /** 'overridden' if user-confirmed; 'high' if exact catalog match;
   *  'low' if regex fallback; 'none' if unclassified. */
  confidence: 'overridden' | 'high' | 'low' | 'none';
}

/**
 * Classify a Tally voucher type name to its semantic meaning.  Order:
 *   1. User overrides (per-company) — always wins
 *   2. Catalog exact / variant match — HIGH confidence
 *   3. Regex pattern fallback — LOW confidence
 *   4. Otherwise — 'unknown' / NONE
 */
export function classifyVoucherType(
  typeName: string,
  overrides?: Map<string, SemanticVoucherType>,
): VoucherTypeClassification {
  if (!typeName) return { semantic: 'unknown', confidence: 'none' };

  const key = normalise(typeName);

  // 1. Override
  if (overrides) {
    const o = overrides.get(typeName.toLowerCase().trim()) ?? overrides.get(key);
    if (o) return { semantic: o, confidence: 'overridden' };
  }

  // 2. Catalog exact / alias
  const cat = CANONICAL_LOOKUP.get(key);
  if (cat) return { semantic: cat, confidence: 'high' };

  // 3. Regex fallback
  const lname = typeName.toLowerCase();
  for (const { semantic, patterns } of FALLBACK_PATTERNS) {
    for (const re of patterns) {
      if (re.test(lname)) return { semantic, confidence: 'low' };
    }
  }

  return { semantic: 'unknown', confidence: 'none' };
}
