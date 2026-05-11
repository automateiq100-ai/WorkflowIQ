'use client';

/**
 * ── Tally Standard Group Catalog ─────────────────────────────────────────
 *
 * A single source of truth for classifying Tally ledgers by their semantic
 * category (capital / bank / cash / debtor / creditor / sales / purchase /
 * duties / etc.).  Tally Prime ships with 28 primary groups; every ledger
 * a user creates eventually traces back to one of them through its parent
 * chain.
 *
 * WHY THIS EXISTS — the historical pattern in this codebase was to do
 * substring matching on ledger names ("if name.includes('sales')...").
 * That works for tutorial datasets but fails at scale because:
 *
 *   • Proprietor capital ledgers are usually named after the person
 *     ("Kunal Budhwar"), not "Capital".
 *   • Bank ledgers are named "HDFC 0049 A/c" or "ICICI - Vasant Vihar" —
 *     sometimes containing no recognizable bank keyword.
 *   • Debtors are business names ("ABC Traders"), never "Debtor X".
 *   • Tally allows renaming primary groups ("Revenue" instead of
 *     "Sales Accounts").
 *   • Industry verticals invent new groups (e.g. NBFCs use "Borrowings"
 *     where retail uses "Loans (Liability)").
 *
 * Use the master-map parent-chain walk as the primary classifier.  Only
 * fall back to substring matching when the master file is absent.
 */

import type { MasterEntry, FinancialNode, ParsedStatement } from './types';
import type { OverrideMap } from './ledger-overrides';
import { getOverride } from './ledger-overrides';

/**
 * Per-ledger map derived from a parsed Balance Sheet hierarchy:
 * `lowercased ledger name → name of the BS top-level section it appears under`.
 *
 * Used as a MEDIUM-confidence classification source — when a Tally master
 * file isn't loaded, the BS's own section structure ("Capital Account",
 * "Current Assets", "Sundry Debtors", …) is the next-best authority for
 * which Tally primary group a ledger belongs to.
 */
export type BSHierarchyMap = Map<string, string>;

/**
 * Walks a parsed BS hierarchy and produces a leaf-name → top-level-section
 * lookup map.  Skips any group nodes themselves (those are headers, not
 * leaves), and skips synthetic Tally-generated lines that don't represent
 * real ledgers.  Safe to call with an empty / null statement — returns
 * empty map.
 */
export function buildBSHierarchyMap(bsStatement: ParsedStatement | null | undefined): BSHierarchyMap {
  const out: BSHierarchyMap = new Map();
  if (!bsStatement || !Array.isArray(bsStatement.nodes)) return out;

  function visit(node: FinancialNode, topSection: string) {
    // Group / main / sub-account nodes that have children are headers —
    // their descendants are the actual leaves we want to map.  But also
    // record the leaf-style nodes (no children) under the top section.
    if (!node.children || node.children.length === 0) {
      const key = node.name.toLowerCase().trim();
      if (key && key !== 'undefined' && !out.has(key)) {
        out.set(key, topSection);
      }
      return;
    }
    for (const child of node.children) visit(child, topSection);
  }

  for (const root of bsStatement.nodes) {
    visit(root, root.name);
  }
  return out;
}

/** Primary semantic category of a ledger.  These map onto the 28 Tally
 *  primary groups but compress them into the buckets the analysis engine
 *  actually reasons about.  Adding a new bucket is the way to extend this
 *  taxonomy — never re-purpose an existing one. */
export type LedgerCategory =
  // Equity / liability side
  | 'capital'             // Capital Account, Reserves & Surplus, Drawings
  | 'loan-secured'        // Secured Loans
  | 'loan-unsecured'      // Unsecured Loans
  | 'bank-od'             // Bank OD A/c — overdrafts (current-liability)
  | 'creditor'            // Sundry Creditors / Trade Payables
  | 'duties-output'       // GST output / TDS payable / PF / ESI / Provisions
  | 'duties-input'        // GST input / ITC receivable
  | 'current-liability'   // Other Current Liabilities

  // Asset side
  | 'fixed-asset'         // Fixed Assets, Plant & Machinery, Building
  | 'investment'          // Investments
  | 'bank'                // Bank Accounts (operating)
  | 'cash'                // Cash-in-Hand
  | 'debtor'              // Sundry Debtors / Trade Receivables
  | 'stock'               // Stock-in-Hand / closing inventory
  | 'loan-given'          // Loans & Advances (Asset)
  | 'deposit'             // Deposits (Asset)
  | 'misc-asset'          // Misc. Expenses (Asset) — preliminary, deferred
  | 'current-asset'       // Other Current Assets

  // P&L side
  | 'sales'               // Sales Accounts
  | 'direct-income'       // Direct Incomes
  | 'indirect-income'     // Indirect Incomes
  | 'purchase'            // Purchase Accounts
  | 'direct-expense'      // Direct Expenses
  | 'indirect-expense'    // Indirect Expenses

  // Special
  | 'suspense'            // Suspense A/c
  | 'branch'              // Branch / Divisions
  | 'unknown';            // Couldn't classify

/** Confidence level of a classification.  Reported back to callers so
 *  downstream rules can decide whether to trust a result.
 *
 *  - `overridden` — the company's master config explicitly set this.
 *                   Always trusted; never auto-changed.
 *  - `high`       — reached via master-map walk to a known Tally group.
 *  - `medium`     — derived from BS/PL section context (Phase 3, future).
 *  - `low`        — fallback name-regex matched.
 *  - `none`       — nothing matched; ledger is unclassified. */
export type ClassificationConfidence = 'overridden' | 'high' | 'medium' | 'low' | 'none';

export interface LedgerClassification {
  category: LedgerCategory;
  /** The primary group this ledger ultimately belongs to (e.g. "Sales
   *  Accounts").  Empty string when unknown. */
  primaryGroup: string;
  /** "high" when reached via master-map walk, "low" when via name
   *  substring fallback, "none" when neither matched. */
  confidence: ClassificationConfidence;
}

/**
 * Catalog of Tally standard primary groups (and sub-groups that have
 * distinct semantic meaning).  Each entry maps a CANONICAL name plus its
 * common spelling/punctuation variants to a single LedgerCategory.
 *
 * Maintained as a flat array (rather than a Map) so the same data can
 * drive both forward classification (group → category) and the variant
 * tolerance check (does this user-supplied name match any known variant).
 */
const PRIMARY_GROUPS: Array<{ canonical: string; variants: string[]; category: LedgerCategory }> = [
  // ── Capital / Equity ───────────────────────────────────────────────────
  { canonical: 'Capital Account',          variants: ['capital a/c', 'capital ac', 'capital'],                                            category: 'capital' },
  { canonical: 'Reserves & Surplus',       variants: ['reserves and surplus', 'reserves', 'reserve and surplus', 'general reserve'],     category: 'capital' },
  { canonical: 'Drawings',                 variants: [],                                                                                  category: 'capital' },

  // ── Borrowings (long-term liabilities) ─────────────────────────────────
  { canonical: 'Loans (Liability)',        variants: ['loans liability', 'loan liability', 'borrowings'],                                category: 'loan-unsecured' },
  { canonical: 'Secured Loans',            variants: ['secured loan'],                                                                    category: 'loan-secured' },
  { canonical: 'Unsecured Loans',          variants: ['unsecured loan'],                                                                  category: 'loan-unsecured' },

  // ── Current Liabilities ────────────────────────────────────────────────
  { canonical: 'Current Liabilities',      variants: ['current liability'],                                                               category: 'current-liability' },
  { canonical: 'Sundry Creditors',         variants: ['sundry creditor', 'trade payables', 'trade payable', 'creditors'],                category: 'creditor' },
  { canonical: 'Duties & Taxes',           variants: ['duties and taxes', 'duties tax', 'gst payable', 'taxes payable'],                 category: 'duties-output' },
  { canonical: 'Provisions',               variants: ['provision'],                                                                       category: 'duties-output' },
  { canonical: 'Bank OD A/c',              variants: ['bank od', 'bank overdraft', 'bank ocl a/c', 'bank ocl', 'bank ocs a/c', 'bank ocs', 'bank occ a/c', 'bank occ', 'cash credit'], category: 'bank-od' },

  // ── Fixed Assets / Investments ─────────────────────────────────────────
  { canonical: 'Fixed Assets',             variants: ['fixed asset', 'tangible assets', 'plant and machinery', 'property plant equipment'], category: 'fixed-asset' },
  { canonical: 'Investments',              variants: ['investment'],                                                                      category: 'investment' },

  // ── Current Assets ─────────────────────────────────────────────────────
  { canonical: 'Current Assets',           variants: ['current asset'],                                                                   category: 'current-asset' },
  { canonical: 'Bank Accounts',            variants: ['bank account', 'bank a/c', 'banks'],                                              category: 'bank' },
  { canonical: 'Cash-in-Hand',             variants: ['cash in hand', 'cash a/c', 'cash account', 'petty cash', 'cash'],                category: 'cash' },
  { canonical: 'Sundry Debtors',           variants: ['sundry debtor', 'trade receivables', 'trade receivable', 'debtors'],              category: 'debtor' },
  { canonical: 'Stock-in-Hand',            variants: ['stock in hand', 'closing stock', 'inventory', 'stock'],                          category: 'stock' },
  { canonical: 'Deposits (Asset)',         variants: ['deposits asset', 'deposits', 'deposit'],                                          category: 'deposit' },
  { canonical: 'Loans & Advances (Asset)', variants: ['loans and advances asset', 'loans and advances', 'loans advances', 'advances'], category: 'loan-given' },
  { canonical: 'Misc. Expenses (Asset)',   variants: ['misc expenses asset', 'miscellaneous expenses asset', 'preliminary expenses', 'deferred revenue expenditure'], category: 'misc-asset' },

  // ── Income (P&L) ───────────────────────────────────────────────────────
  { canonical: 'Sales Accounts',           variants: ['sales account', 'revenue', 'revenue accounts', 'revenue from operations', 'sales'], category: 'sales' },
  { canonical: 'Direct Incomes',           variants: ['direct income'],                                                                   category: 'direct-income' },
  { canonical: 'Indirect Incomes',         variants: ['indirect income', 'other income', 'misc income', 'miscellaneous income'],         category: 'indirect-income' },

  // ── Expense (P&L) ──────────────────────────────────────────────────────
  { canonical: 'Purchase Accounts',        variants: ['purchase account', 'purchases', 'cost of materials', 'cost of goods sold'],       category: 'purchase' },
  { canonical: 'Direct Expenses',          variants: ['direct expense'],                                                                  category: 'direct-expense' },
  { canonical: 'Indirect Expenses',        variants: ['indirect expense', 'operating expense', 'administrative expense'],                category: 'indirect-expense' },

  // ── Special ────────────────────────────────────────────────────────────
  { canonical: 'Suspense A/c',             variants: ['suspense', 'suspense ac', 'suspense account', 'misc'],                            category: 'suspense' },
  { canonical: 'Branch / Divisions',       variants: ['branch divisions', 'branch / division', 'branch'],                                category: 'branch' },
];

/**
 * Substring patterns used as the LAST-RESORT classifier when no master
 * file is loaded.  Order matters — first match wins, so put the most
 * specific patterns ahead of the most general ones.
 */
const NAME_PATTERNS: Array<{ category: LedgerCategory; patterns: RegExp[] }> = [
  // GST / TDS / PF — very specific, must come before generic "duties"/"tax"
  { category: 'duties-output', patterns: [
    /\boutput\s*[cs]?gst/, /\bgst\s*payable\b/, /\b[cs]gst\s*payable\b/,
    /\bigst\s*payable\b/, /\btds\s*payable\b/, /\btds\s+on\b/,
    /\btax\s*deducted\s*at\s*source\b/, /\bpf\s*payable\b/, /\besi\s*payable\b/,
    /\bprovident\s*fund\b/, /\bemployees\s*state\b/, /\bprovision\b/,
  ]},
  { category: 'duties-input', patterns: [
    /\binput\s*[cs]?gst/, /\binput\s*igst/, /\bitc\b/, /\bgst\s*receivable\b/,
  ]},

  // Banking — bank/cash/loans
  { category: 'bank-od', patterns: [
    /\bbank\s*o[dcs]/, /\boverdraft\b/, /\bcash\s*credit\b/,
  ]},
  { category: 'bank', patterns: [
    /\bbank\b/, /\bhdfc\b/, /\bicici\b/, /\bsbi\b/, /\baxis\b/, /\bkotak\b/,
    /\byes\s*bank\b/, /\bidbi\b/, /\bidfc\b/, /\bpnb\b/, /\bbob\b/,
    /\bcanara\b/, /\bunion\s*bank\b/, /\bandhra\s*bank\b/, /\bindusind\b/,
  ]},
  { category: 'cash', patterns: [
    /^cash$/, /\bcash\s*[-]?\s*in\s*[-]?\s*hand\b/, /\bpetty\s*cash\b/,
    /\bcash\s*a\/c\b/, /\bcash\s*account\b/,
  ]},

  // Trade
  { category: 'debtor',     patterns: [/\bdebtors?\b/, /\btrade\s*receivable\b/, /\breceivables?\b/] },
  { category: 'creditor',   patterns: [/\bcreditors?\b/, /\btrade\s*payable\b/, /\bpayables?\b/] },

  // Inventory & assets
  { category: 'stock',      patterns: [/\bclosing\s*stock\b/, /\bopening\s*stock\b/, /\bstock\s*in\s*hand\b/, /\binventory\b/] },
  { category: 'fixed-asset', patterns: [/\bfixed\s*asset\b/, /\bplant\s*(and|&)?\s*machinery\b/, /\bbuilding\b/, /\bvehicle\b/, /\bfurniture\b/] },
  { category: 'investment', patterns: [/\binvestment\b/] },

  // Capital
  { category: 'capital',    patterns: [/\bcapital\b/, /\bowner'?s?\b/, /\bproprietor\b/, /\bpartner\b/, /\bdrawings?\b/, /\breserves?\s*(and|&)?\s*surplus/] },

  // Loans
  { category: 'loan-secured',   patterns: [/\bsecured\s*loan/, /\bterm\s*loan/, /\bworking\s*capital\s*loan/] },
  { category: 'loan-unsecured', patterns: [/\bunsecured\s*loan/, /\bborrowing/] },
  { category: 'loan-given',     patterns: [/\bloans?\s*(and|&)?\s*advances?/] },
  { category: 'deposit',        patterns: [/\bsecurity\s*deposit/, /\b(rent|tender|earnest)\s*deposit/] },

  // P&L
  { category: 'sales',           patterns: [/\bsales\b/, /\brevenue\s*from\b/] },
  { category: 'purchase',        patterns: [/\bpurchases?\b/, /\bcost\s*of\s*goods\s*sold/, /\bcogs\b/] },
  { category: 'direct-income',   patterns: [/\bdirect\s*income/] },
  { category: 'indirect-income', patterns: [/\bindirect\s*income/, /\bother\s*income/, /\bmisc(?:ellaneous)?\s*income/] },
  { category: 'direct-expense',  patterns: [/\bdirect\s*expense/, /\bcarriage\s*inward/, /\bfreight\s*inward/, /\bwages\b/] },
  { category: 'indirect-expense', patterns: [/\bindirect\s*expense/, /\bsalary\b/, /\bsalaries\b/, /\brent\b/, /\boffice\s*expense/, /\binternet\b/, /\btravel/] },

  // Suspense
  { category: 'suspense',   patterns: [/\bsuspense\b/, /\bmiscellaneous\b(?!\s*income)/, /^misc$/] },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Whitespace/punctuation-insensitive normalisation used for matching
 *  group names across different Tally spellings ("Cash-in-Hand" ≡
 *  "Cash in Hand" ≡ "Cash In Hand"). */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/&.,]+/g, '');
}

/** Build the runtime lookup once.  Maps every variant + canonical name
 *  to its category. */
const VARIANT_TO_CATEGORY = new Map<string, { category: LedgerCategory; primaryGroup: string }>();
for (const g of PRIMARY_GROUPS) {
  VARIANT_TO_CATEGORY.set(normalise(g.canonical), { category: g.category, primaryGroup: g.canonical });
  for (const v of g.variants) {
    VARIANT_TO_CATEGORY.set(normalise(v), { category: g.category, primaryGroup: g.canonical });
  }
}

/** Returns the category for a group name (canonical or variant), or
 *  undefined if the name doesn't match any known group. */
export function categoryForGroupName(groupName: string): { category: LedgerCategory; primaryGroup: string } | undefined {
  return VARIANT_TO_CATEGORY.get(normalise(groupName));
}

/**
 * Classify a ledger by walking its master-map parent chain until reaching
 * a known group, then falling back to name pattern matching.  Returns
 * `{ category, primaryGroup, confidence }` so callers can reason about
 * trust as well as the bucket.
 *
 * Walking is bounded to 20 hops; circular master files (which shouldn't
 * exist but have been observed in corrupted exports) are detected via a
 * `seen` set.
 */
export function classifyLedger(
  ledgerName: string,
  masterMap: Map<string, MasterEntry>,
  overrides?: OverrideMap,
  bsHierarchy?: BSHierarchyMap,
): LedgerClassification {
  // ─ OVERRIDDEN: company master config wins over everything ─
  // The user (or their accountant) has already reviewed this ledger and
  // told us the right category — never second-guess that.  Used to lock
  // industry-specific or ambiguous classifications in place.
  const override = getOverride(overrides, ledgerName);
  if (override) {
    return {
      category: override.category,
      primaryGroup: override.primaryGroup ?? '',
      confidence: 'overridden',
    };
  }

  // ─ HIGH confidence: master-map walk ─
  if (masterMap.size > 0) {
    let current = ledgerName;
    const seen = new Set<string>();
    for (let hop = 0; hop < 20; hop++) {
      if (seen.has(current)) break;
      seen.add(current);
      const hit = VARIANT_TO_CATEGORY.get(normalise(current));
      if (hit) return { category: hit.category, primaryGroup: hit.primaryGroup, confidence: 'high' };
      const entry = masterMap.get(current.toLowerCase().trim()) ?? masterMap.get(normalise(current));
      if (!entry || !entry.parent || entry.parent.toLowerCase() === 'primary') break;
      current = entry.parent;
    }
  }

  // ─ MEDIUM confidence: BS-hierarchy fallback (Phase 6) ─
  // When the master file isn't loaded but the Balance Sheet was parsed,
  // the BS's own section markers ("Capital Account", "Current Liabilities",
  // "Sundry Debtors", …) are an authoritative-enough source for the
  // primary group.  Unlike the master walk this only sees leaves, but
  // every leaf in the BS DOES have a section, so coverage is excellent
  // for any company that uploaded a Balance Sheet.
  if (bsHierarchy && bsHierarchy.size > 0) {
    const section = bsHierarchy.get(ledgerName.toLowerCase().trim());
    if (section) {
      const hit = VARIANT_TO_CATEGORY.get(normalise(section));
      if (hit) return { category: hit.category, primaryGroup: hit.primaryGroup, confidence: 'medium' };
    }
  }

  // ─ LOW confidence: name pattern fallback ─
  const lname = ledgerName.toLowerCase();
  for (const { category, patterns } of NAME_PATTERNS) {
    for (const re of patterns) {
      if (re.test(lname)) return { category, primaryGroup: '', confidence: 'low' };
    }
  }

  return { category: 'unknown', primaryGroup: '', confidence: 'none' };
}

/** True if the ledger classifies into any of the supplied categories.
 *  Convenience for callers that only need yes/no presence checks. */
export function ledgerInCategory(
  ledgerName: string,
  categories: LedgerCategory[],
  masterMap: Map<string, MasterEntry>,
  overrides?: OverrideMap,
  bsHierarchy?: BSHierarchyMap,
): boolean {
  const c = classifyLedger(ledgerName, masterMap, overrides, bsHierarchy);
  return categories.includes(c.category);
}

/** All known LedgerCategory values, in display order, with human-readable
 *  labels.  Used by the Master Setup view to render the override dropdown
 *  and by the API that validates user input. */
export const LEDGER_CATEGORY_OPTIONS: Array<{ value: LedgerCategory; label: string; group: string }> = [
  // Equity / liability side
  { value: 'capital',           label: 'Capital / Owner Equity',         group: 'Liabilities & Equity' },
  { value: 'loan-secured',      label: 'Secured Loan',                   group: 'Liabilities & Equity' },
  { value: 'loan-unsecured',    label: 'Unsecured Loan',                 group: 'Liabilities & Equity' },
  { value: 'bank-od',           label: 'Bank OD / Cash Credit',          group: 'Liabilities & Equity' },
  { value: 'creditor',          label: 'Sundry Creditor / Trade Payable', group: 'Liabilities & Equity' },
  { value: 'duties-output',     label: 'Duties & Taxes (Output GST / TDS / PF)', group: 'Liabilities & Equity' },
  { value: 'current-liability', label: 'Other Current Liability',        group: 'Liabilities & Equity' },
  // Asset side
  { value: 'fixed-asset',       label: 'Fixed Asset',                    group: 'Assets' },
  { value: 'investment',        label: 'Investment',                     group: 'Assets' },
  { value: 'bank',              label: 'Bank Account',                   group: 'Assets' },
  { value: 'cash',              label: 'Cash-in-Hand',                   group: 'Assets' },
  { value: 'debtor',            label: 'Sundry Debtor / Trade Receivable', group: 'Assets' },
  { value: 'stock',             label: 'Stock / Inventory',              group: 'Assets' },
  { value: 'loan-given',        label: 'Loan Given / Advance',           group: 'Assets' },
  { value: 'deposit',           label: 'Deposit (Asset)',                group: 'Assets' },
  { value: 'duties-input',      label: 'Input GST / ITC Receivable',     group: 'Assets' },
  { value: 'misc-asset',        label: 'Misc. Expenses (Asset)',         group: 'Assets' },
  { value: 'current-asset',     label: 'Other Current Asset',            group: 'Assets' },
  // P&L side
  { value: 'sales',             label: 'Sales / Revenue',                group: 'Income' },
  { value: 'direct-income',     label: 'Direct Income',                  group: 'Income' },
  { value: 'indirect-income',   label: 'Indirect Income / Other Income', group: 'Income' },
  { value: 'purchase',          label: 'Purchase / COGS',                group: 'Expenses' },
  { value: 'direct-expense',    label: 'Direct Expense',                 group: 'Expenses' },
  { value: 'indirect-expense',  label: 'Indirect Expense / Operating',   group: 'Expenses' },
  // Special
  { value: 'suspense',          label: 'Suspense / Misc',                group: 'Special' },
  { value: 'branch',            label: 'Branch / Division',              group: 'Special' },
  { value: 'unknown',           label: 'Unknown / Unclassified',         group: 'Special' },
];
