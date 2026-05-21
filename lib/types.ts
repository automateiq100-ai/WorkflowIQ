// All TypeScript interfaces for AccountingIQ
import type { PLSection, CashFlowSection } from './parser';
export type { PLSection, CashFlowSection };

export type FileKey =
  | 'daybook' | 'trialbal' | 'pandl' | 'bsheet' | 'grpsum'   // required
  | 'sales' | 'purchase' | 'bills' | 'payables' | 'cashflow'   // conditional
  | 'faregister' | 'stock' | 'bankrecon'                        // optional
  | 'master';                                                    // Chart of Accounts (All Masters export)

// ── Master Map types (Phase 1) ────────────────────────────────────────────

/** Whether a Tally master entry originated from a GROUP or LEDGER tag. */
export type MasterItemType = 'group' | 'ledger';

/**
 * One entry from the Master.xml Chart of Accounts.
 * Groups are account containers; Ledgers are leaf accounts.
 */
export interface MasterEntry {
  name: string;
  /** Parent group name. "Primary" when the item has no parent (top-level Tally group). */
  parent: string;
  type: MasterItemType;
  /** GST rate (percent) configured on this ledger in Tally master.
   *  Populated from RATEOFTAX / GSTDETAILS.LIST.RATE / GSTTAXRATE fields
   *  in the "All Masters" XML export.  Only meaningful for sales /
   *  purchase / Duties & Taxes ledgers; undefined for everything else
   *  AND for sales ledgers where the user never set a rate.  E2a uses
   *  this to verify per-ledger GST rate configuration. */
  gstRate?: number;
  /** Whether GST applicability is set on the ledger ("Applicable" /
   *  "Not Applicable" / "Use Default").  Parsed from GSTAPPLICABILITY. */
  gstApplicable?: 'applicable' | 'not-applicable' | 'use-default';
}

// ── Structured Financial Statement types (Phase 2-4) ─────────────────────

/** Classification of a node inside a parsed P&L or Balance Sheet. */
export type FinancialNodeType = 'main' | 'sub';

/**
 * One account node in the hierarchical output of parsePandLStatement /
 * parseBSheetStatement.
 *
 * - `nodeType === 'main'`  →  Group (parent container, value from BSMAINAMT)
 * - `nodeType === 'sub'`   →  Ledger (child account, value from BSSUBAMT / PLSUBAMT)
 *
 * Sign convention mirrors Tally display reports:
 *   positive = Credit balance (income / liabilities)
 *   negative = Debit balance  (expenses / assets)
 */
export interface FinancialNode {
  /** Unique slug suitable for React keys and Excel row IDs. */
  id: string;
  name: string;
  /** Signed amount: positive = Cr, negative = Dr (Tally convention). */
  amount: number;
  nodeType: FinancialNodeType;
  /** true when the name was found in the Master Map from Phase 1. */
  inMaster: boolean;
  /** GROUP or LEDGER per Master Map, null when not in master. */
  masterType: MasterItemType | null;
  /**
   * Parent group from Master Map.
   * "Computed / Not in Master" for Tally-generated structural lines
   * (e.g. "Cost of Sales :", "Opening Stock") that have no master entry.
   */
  masterParent: string;
  /** true when this visible header was created from Master.xml and not emitted as a statement row. */
  synthetic?: boolean;
  /** The Master.xml parent that caused this node to be grouped under a header. */
  sourceParent?: string;
  /** Sum of immediate child amounts, using signed Tally values. */
  childrenTotal?: number;
  /** Header amount minus immediate child sum. */
  childrenVariance?: number;
  /** true when header amount matches immediate child sum within parser tolerance. */
  childrenBalanced?: boolean;
  children: FinancialNode[];
}

/** Aggregated totals for a parsed statement. */
export interface StatementTotals {
  /** Sum of nodes with positive amounts (Credit side). */
  credit: number;
  /** Sum of absolute values of nodes with negative amounts (Debit side). */
  debit: number;
  /** credit − debit (positive = net income / surplus). */
  net: number;
}

/** Complete parsed output of a P&L or Balance Sheet statement. */
export interface ParsedStatement {
  statement: 'pandl' | 'bsheet';
  companyName: string;
  /** Top-level main-account nodes; each carries `.children` for sub-accounts. */
  nodes: FinancialNode[];
  totals: StatementTotals;
}

/** Flat row produced by flattenStatement() — suitable for Excel export or table UIs. */
export interface FlatFinancialRow {
  id: string;
  name: string;
  amount: number;
  nodeType: FinancialNodeType;
  /** Indentation depth: 0 = top-level group, 1 = direct child, etc. */
  depth: number;
  /** Name of the immediate parent group in the financial statement tree. */
  parentGroup: string;
  inMaster: boolean;
  masterType: MasterItemType | null;
  masterParent: string;
}

export type ModuleId = 'accounting' | 'mis' | 'reconciliation';

export type ViewId =
  | 'company-select' | 'company-dashboard'
  | 'dashboard' | 'checklist' | 'insights' | 'health'
  | 'flags' | 'upload' | 'profile' | 'reports' | 'rules'
  | 'mis-upload' | 'mis-profile' | 'mis-rules'
  | 'mis-dashboard' | 'mis-checklist' | 'mis-analysis'
  | 'mis-metrics-checklist'
  | 'mis-report-cover' | 'mis-report-pl' | 'mis-report-cf'
  | 'mis-report-bs' | 'mis-report-wc' | 'mis-report-cost'
  | 'mis-report-bpi' | 'mis-report-statutory' | 'mis-report-forecast'
  | 'mis-report-backup' | 'mis-fix' | 'mis-ai-plan'
  | 'reconciliation' | 'aiAnalysis'
  | 'data-view' | 'agent-fix'
  | 'tally-connection'
  | 'master-setup';

export type Theme = 'dark' | 'light';

export type CheckStatus = 'pass' | 'partial' | 'fail' | 'missing' | 'uncertain' | 'na';
export type Urgency = 'critical' | 'high' | 'medium' | 'positive';
export type DimKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type FilterMode = 'all' | 'fails' | 'missing' | 'passed' | 'flags';

export interface FileEntry {
  name: string;
  size: number;
  content: string | null;
  hasContent: boolean;
  chunkedStats: ChunkedStats | null;
  sessionExpired: boolean;
  /** Where this file came from. Drives the "Live from Tally" badge in the UI. */
  source?: 'upload' | 'tally';
}

export interface ChunkedStats {
  totalVouchers: number;
  missingVno: number;
  narrated: number;
  totalJournals: number;
  highValueCount: number;
  highValueNarrated: number;
  zeroAmt: number;
  wrongType: number;
  missingParty: number;
  cashOver10k: number;
  /** Sec 269ST: count of vouchers in single-party single-day cash receipts ≥ ₹2 lakh. */
  cashReceiptOver2L: number;
  roundCount: number;
  /** Count of vouchers per `${type}${vno}` key.  Tally allows the
   *  same voucher number across different voucher types (Sales/001 and
   *  Receipt/001 are independent series), so keying on type+vno avoids
   *  flagging legitimate cross-series collisions as duplicates.  Use
   *  splitDupKey() to render keys back as { type, vno }. */
  dupVnoMap: Record<string, number>;
  monthCounts: Record<string, number>;
  dateSet: string[];        // serialised for session (Set not serialisable)
  custMap: Record<string, number>;
  vendMap: Record<string, number>;
  // H-dimension aggregates
  totalDebit: number;
  totalCredit: number;
  salesVoucherTotal: number;
  purchVoucherTotal: number;
  /** Sales voucher Debit-column total (sum of |amt| where the first leg
   *  is on Dr side).  Used by H2 backup to show Tally-style Debit /
   *  Credit / Net breakdown — net is salesVoucherDr − salesVoucherCr. */
  salesVoucherDr?: number;
  salesVoucherCr?: number;
  purchVoucherDr?: number;
  purchVoucherCr?: number;
  /** Per-voucher contributions for the H2/H3 net (vno, amount, direction
   *  Dr/Cr).  Populated up to 1,000 entries — enough for the user to
   *  drill into the breakdown and spot which voucher is being summed in
   *  which column.  Helps debug Tally-vs-engine mismatches (e.g. the
   *  "(-)5,000" reversal entry that triggers a different column choice
   *  in Tally vs in the engine). */
  purchVoucherBreakdown?: Array<{ vno: string; amt: number; dr: boolean }>;
  salesVoucherBreakdown?: Array<{ vno: string; amt: number; dr: boolean }>;
  cashBankNetMovement: number;
  /** Sum of |amt| over Receipt-semantic vouchers only.  Paired with
   *  paymentTotal below — together they let H4 derive the net change
   *  in cash/bank from the DayBook (receipts − payments) to compare
   *  against the TB's net period movement (closing − opening). */
  receiptTotal: number;
  /** Sum of |amt| over Payment-semantic vouchers only (excludes Receipts /
   *  Contras / Journals).  Drives E6 (TDS reasonableness) — TDS is a
   *  fraction of money paid out, not money received. */
  paymentTotal: number;
  /** Sum of |amt| over Contra-semantic vouchers only (cash↔bank or
   *  bank↔bank transfers).  Each contra touches TWO cash/bank ledgers,
   *  so it lands twice in the TB's cash/bank Dr+Cr turnover but only
   *  once in cashBankNetMovement above; H4 adds contraTotal back to the
   *  DB side to match the TB's double-count. */
  contraTotal: number;
  taxVoucherTotal: number;
  journalNetAmt: number;
  outOfFY: number;
  vouchers: Voucher[];
}

/** Per-voucher findings — set by the DayBook parser at the moment a voucher
 *  is processed.  Mirrors the aggregate counters on ChunkedStats so the UI
 *  can drill from "10 of 198 vouchers missing numbers" back to the actual
 *  10 rows without re-running detection.  Kept as an array of string tokens
 *  (rather than per-flag booleans) so adding a new finding doesn't touch
 *  every Voucher write site. */
export type VoucherFlag =
  | 'missingVno'
  | 'missingParty'   // trade-type voucher (sales/sr/pur/pr/receipt/payment) with no party
  | 'zeroAmt'
  | 'cashOver10k'        // Sec 40A(3): cash expenditure > ₹10k to one person in a day
  | 'cashReceiptOver2L'  // Sec 269ST: cash receipts ≥ ₹2 lakh from one person in a day
  | 'outOfFY'
  | 'wrongType';     // Journal touching cash/bank, or Receipt/Payment with no cash/bank counterpart

export interface Voucher {
  date: string;
  vno: string;
  type: string;
  party: string;
  amount: number;
  narration: string;
  flags?: VoucherFlag[];
  /** Per-leg snapshot of ALLLEDGERENTRIES.LIST: lowercased ledger name,
   *  Dr/Cr direction (Dr = ISDEEMEDPOSITIVE=Yes), and absolute leg amount.
   *  Three downstream uses:
   *    • missingParty rescue scans names looking for a debtor/creditor leg
   *    • wrong-type classification uses both name (→ category) and direction
   *      (→ cash-flow direction) to detect e.g. a Payment voucher with the
   *      bank leg actually Dr (money in) — that's structurally a Receipt.
   *    • H4 cash/bank drill-down sums the amount of the cash/bank leg per
   *      voucher (not the sum of Dr+Cr — that double-counts the value). */
  legs?: Array<{ name: string; dr: boolean; amt: number }>;
  /** Set on wrong-type vouchers by the engine post-pass: a best-guess
   *  voucher type inferred from what categories the ledger entries fall
   *  under (e.g. Sales + Debtor → "sales"; Bank + Debtor → "receipt").
   *  Shown in the wrong-type drill-down so the user knows what to
   *  reclassify the voucher to. */
  suggestedType?: string;
}

export interface Check {
  id: string;
  dim: DimKey;
  name: string;
  status: CheckStatus;
  pts: number;
  max: number;
  note: string;
  /** Label shown when check passes (defaults to name) */
  passLabel?: string;
  /** Label shown when check fails/partial — describes the finding, not the rule */
  failLabel?: string;
}

export interface AnalysisResults {
  checks: Check[];
  dimScores: Record<DimKey, number>;
  overall: number;
  cappedScore: number;
  scoreCapped: boolean;
  runAt: number;       // Date.now()
}

export interface ParsedData {
  // Trial Balance
  tbLedgers: TBLedger[];
  suspenseCount: number;
  dupPairs: number;
  capFound: boolean;
  bankFound: boolean;
  cashFound: boolean;
  debtorFound: boolean;
  creditorFound: boolean;
  hasOpeningBal: boolean;
  tbTotal: number;
  tbSales: number;
  tbPurch: number;
  outputGSTAmt: number;
  inputITCAmt: number;
  tdsLedgerFound: boolean;
  /** Sum of |closing| over all TDS Payable / TDS-on-X ledgers in the TB. */
  tdsPayableAmt: number;
  /** Sum of |closing| over all Stock-classified ledgers in the TB.  Used
   *  as a fallback for closingStock when the BS parser's narrow patterns
   *  miss user-named stock ledgers. */
  tbStock: number;
  /** Gross period turnover (Dr + Cr movement) over every cash / bank /
   *  bank-OD ledger in the Trial Balance.  Compared against DayBook
   *  cash+bank voucher turnover by H4.  Only populated when the TB
   *  export includes period movement columns (DSPDRAMTA / DSPCRAMTA);
   *  a closing-balance-only TB leaves this at 0 and H4 falls back to
   *  the net-movement comparison below. */
  tbCashBankMovement: number;
  /** Signed net movement (closing − opening) across cash/bank/bank-od
   *  ledgers — always derivable from the bridge's custom TB collection,
   *  which fetches OpeningBalance regardless of any F12 toggle. */
  tbCashBankNetMovement: number;
  /** Sign-convention vote outcome from parseTrialBalance.  +1/−1 =
   *  confidently detected; 0 = ambiguous (too few classifiable ledgers).
   *  D1 / D5 surface as uncertain when this is 0 so a thin TB-only
   *  upload with cryptic ledger names doesn't get a confidently-wrong
   *  Dr/Cr answer. */
  tbSignFlip?: 1 | -1 | 0;
  pfLedgerFound: boolean;
  salesLedgersNoRate: number;
  gstDiffPct: number;
  /** Output-GST reconciliation working — populated by the E2b check; drives
   *  the E2b "View working" drill-down (GSTBreakdown). */
  gstWorking?: {
    sales: number;          // taxable sales (GST-exclusive)
    effectiveRate: number;  // recorded GST ÷ sales
    headlineRate: number;   // nearest Indian slab (5/12/18/28%)
    expectedGST: number;    // sales × headlineRate
    recordedGST: number;    // Output GST actually charged this period
    variance: number;       // |recorded − expected| ÷ expected
    /** Where recordedGST came from: 'vouchers' = GST charged on sales-voucher
     *  tax legs (period-correct); 'tb-closing' = accumulated TB payable balance
     *  (fallback when no sales-voucher tax legs were found). */
    source: 'vouchers' | 'tb-closing';
  };
  /** Names and amounts of suspense/misc ledgers for richer notes (Bug 4) */
  suspenseLedgers: Array<{ name: string; amount: number }>;
  /** Near-duplicate ledger pair names for fail labels */
  dupPairDetails: Array<[string, string]>;
  /** Sales ledgers with no GST rate configured in the master — populated by
   *  the E2a check; surfaces in the E2a drill-down so the user sees exactly
   *  which ledgers to fix in Tally. */
  salesLedgersWithoutGst?: string[];
  /** Party ledgers whose name appears in BOTH debtor AND creditor categories
   *  — populated by the G1 check in engine.ts.  Surfaces in the G1 drill-down
   *  via LedgerPairDrillDown so the user can see exactly which parties are
   *  split across receivable / payable buckets. */
  partySplitPairs?: Array<[string, string]>;
  /** Same-name expense ledgers classified into DIFFERENT P&L categories
   *  (e.g. one under 'direct-expense' and one under 'indirect-expense').
   *  Populated by the G2 check in engine.ts.  Surfaces in the G2 drill-down
   *  via LedgerPairDrillDown — distinct from B2's name-only near-duplicates. */
  expenseSplitPairs?: Array<[string, string]>;
  /** Journal vouchers that close P&L Net Profit into Capital / Reserves at
   *  year-end — typically one entry per period: Dr P&L A/c, Cr Capital A/c.
   *  Populated by the H6 engine pass.  Used by the H6 backup modal to show
   *  whether the books are finalised (profit transferred to equity).  Empty
   *  array means no such entry was found in the DayBook. */
  profitClosingEntries?: Array<{
    date: string;
    vno: string;
    type: string;
    plLedger: string;
    capitalLedger: string;
    amount: number;
  }>;

  // Strict Master / financial statement trees for Data View
  masterEntries?: MasterEntry[];
  /** Full TB rows (groups + ledgers) for the hierarchical Data View display */
  tbRows?: TBFullRow[];
  pandlStatement?: ParsedStatement;
  pandlRows?: FlatFinancialRow[];
  bsheetStatement?: ParsedStatement;
  bsheetRows?: FlatFinancialRow[];

  // P&L
  revenue: number;
  directRevenue: number;
  otherIncome: number;
  costOfMaterials: number;
  /** Direct Expenses bucket (factory wages, freight inward, carriage,
   *  power for production, etc.).  Sits above the Gross Profit line in
   *  Indian P&L convention — included in the COGS deduction when
   *  computing GP, separate from the `expenses` indirect bucket. */
  directExpenses?: number;
  expenses: number;
  netProfit: number;
  /** Raw P&L-derived net profit, captured before the engine's BS-preferred
   *  overwrite of `netProfit`.  Used by the D2 check / modal to compare
   *  the two raw figures.  Null when the P&L parser couldn't extract it. */
  plNetProfit?: number | null;
  depFound: boolean;
  depAmt: number;
  plSections: PLSection[];
  openingStock: number;
  /** Closing stock amount as it appears on the P&L (typically as a
   *  "Less: Closing Stock" deduction inside Cost of Sales).  Captured
   *  alongside openingStock so the D5 check can distinguish "no closing
   *  stock anywhere" from "P&L has it but BS doesn't". */
  plClosingStock: number;

  // Balance Sheet (signed values — Bug 1)
  ca: number;
  cl: number;
  bankBal: number;
  debtorBal: number;
  creditorBal: number;
  closingStock: number;
  fixedAssets: number;
  bsCashBankTotal: number;
  /** Net Profit read directly from BS "Profit & Loss A/c" line (Bug 2) */
  bsNetProfit: number | null;
  /** Suspense / miscellaneous rows seen on the BS (non-zero only).
   *  Surfaces group rollups like "Suspense A/c" that parseTrialBalance
   *  skips because the master classifies them as TYPE=group, so the
   *  largest suspense balance in the books doesn't go unflagged. */
  bsSuspenseLedgers?: Array<{ name: string; amount: number }>;

  // Group Summary
  salesWrongGroup: boolean;
  purchaseWrongGroup: boolean;
  dutiesUnderExpense: boolean;

  // Cash Flow Statement
  cashFlowSections: CashFlowSection[];
  operatingCF: number;
  investingCF: number;
  financingCF: number;
  netCashFlow: number;
}

export interface TBLedger {
  name: string;
  nl: string;   // lowercased
  closing: number;
  dr: boolean;
  /** Period Dr / Cr turnover for this ledger.  Only present when the TB
   *  export is a "TB with transactions" report (DSPDRAMTA / DSPCRAMTA
   *  fields populated).  Used by H4 to reconcile DayBook cash/bank
   *  voucher turnover against TB cash/bank period activity. */
  movements?: { debit: number; credit: number };
  /** Period opening balance (signed).  Populated when the bridge pulls
   *  the TB via the WIQTrialBalance custom collection or when Tally's
   *  built-in TB had "Show Opening Balance" on.  Lets H4 derive net
   *  period movement (closing − opening) without needing gross Dr/Cr. */
  opening?: number;
}

/**
 * Full Trial Balance row as exported from Tally — includes both group and ledger entries.
 * Sign convention: positive closing = Cr balance, negative = Dr balance.
 */
export interface TBFullRow {
  name: string;
  opening:   number;  // DSPOPAMTA  (positive=Cr, negative=Dr)
  debitMov:  number;  // abs(DSPDRAMTA) — total Dr transactions in period
  creditMov: number;  // abs(DSPCRAMTA) — total Cr transactions in period
  closing:   number;  // DSPCLAMTA  (positive=Cr, negative=Dr)
  isGroup:   boolean; // true if master type='group'
}

export interface CompanyProfile {
  gstApplicable: boolean;
  gstRegular: boolean;
  tdsApplicable: boolean;
  hasEmployees: boolean;
  hasFAfilter: boolean;
  isGoods: boolean;
  fullFY: boolean;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  dimension: DimKey;
  severity: 'critical' | 'high' | 'medium' | 'info';
  enabled: boolean;
  builtIn: boolean;        // built-in rules cannot be deleted
  checkId?: string;       // links to an existing check in engine.ts
  condition?: string;     // human-readable condition description
  remediation: string;   // what to do to fix it
}

export type MISSector = 'Manufacturing' | 'Trading' | 'Services' | 'Retail' | 'Construction' | 'Financial Services' | 'Hospitality' | 'IT/SaaS';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  mobile: string | null;
  selected_tools: string[];
  theme: 'dark' | 'light';
  onboarding_done: boolean;
}

export interface MISSetup {
  sector: MISSector | null;
  hasBudget: boolean;
  selectedMetricIds: string[];  // IDs of metrics user has selected
}

export interface Company {
  id: string;
  owner_user_id: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  company_type: string | null;
  gst_applicable: boolean;
  gst_regular: boolean;
  tds_applicable: boolean;
  has_employees: boolean;
  has_fa_filter: boolean;
  is_goods: boolean;
  full_fy: boolean;
  tally_company_id: string | null;
  tally_company_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActiveCompany {
  id: string;
  name: string;
  companyType: string | null;
}

export function companyToFilters(c: Company): CompanyProfile {
  return {
    gstApplicable: c.gst_applicable,
    gstRegular:    c.gst_regular,
    tdsApplicable: c.tds_applicable,
    hasEmployees:  c.has_employees,
    hasFAfilter:   c.has_fa_filter,
    isGoods:       c.is_goods,
    fullFY:        c.full_fy,
  };
}

export interface AppState {
  files: Record<FileKey, FileEntry>;
  parsedData: Partial<ParsedData>;
  results: AnalysisResults | null;
  filters: CompanyProfile;
  analysed: boolean;
  currentView: ViewId;
  currentModule: ModuleId;
  theme: Theme;
  consentGiven: boolean;
  /** Separate consent for AI analysis — data sent to OpenAI (Workstream 2) */
  aiConsentGiven: boolean;
  uploadProgress: string | null;   // chunked parse progress message
  misSetup: MISSetup;
  /** Cached AI analysis response */
  aiAnalysis: AIResponse | null;
  /** Hash of input data used to generate cached AI analysis */
  aiAnalysisHash: string | null;
  currentCompany: ActiveCompany | null;
  /** Agentic fix tasks from /api/ai/agent */
  fixTasks: FixTask[] | null;
  fixTasksLoading: boolean;
  /** true while /api/ai fetch is in-flight (global — visible in sidebar) */
  aiAnalysisLoading: boolean;
  /** last error from /api/ai, null when clean */
  aiAnalysisError: string | null;
  /** Per-company ledger classification overrides — user-confirmed mappings
   *  that always win over auto-classification.  Keyed by lowercased ledger
   *  name.  Loaded from localStorage on company selection (and synced to
   *  Supabase later when we move overrides server-side). */
  ledgerOverrides?: Map<string, import('./ledger-overrides').LedgerOverride>;
  /** Period the user actually asked for (folder selector or Tally
   *  bridge sync).  Captured at analysis time so downstream rules can
   *  compare actual data coverage to user intent — e.g. "user requested
   *  12 months but only 2 had vouchers" is a sparse-books signal, not
   *  a partial-period one.  ISO date strings (YYYY-MM-DD). */
  requestedPeriod?: { start: string; end: string; type: 'monthly' | 'quarterly' | 'yearly' | 'custom' };
  /** Manual inputs collected from the MIS Data Intake form (Step 2 of
   *  the spec).  Drives metrics that have no Tally source — headcount,
   *  order book, drawing power, covenants, contingent liabilities,
   *  production qty.  See lib/layer2/types.ts ManualInputs. */
  misManualInputs?: import('./layer2/types').ManualInputs;
  /** Parsed budget data from uploaded budget Excel.  Drives budget-vs-
   *  actual variance metrics.  See lib/layer2/types.ts BudgetData. */
  misBudget?: import('./layer2/types').BudgetData;
  /** Uploaded documents (PDFs).  Stored as metadata only; structured
   *  values from each doc are keyed by the user into manualInputs. */
  misDocuments?: Record<string, MISDocumentRef>;
  /** MIS rule overrides — when present, used instead of DEFAULT_RULES.
   *  Stored as the *full* effective rule set rather than a diff so the
   *  resolver doesn't need to merge.  Undefined = use defaults. */
  misRules?: import('./layer2/rules').Rule[];
  /** Metric id to focus on when entering the Backup Working view.  Set by
   *  clicking "View working" on a metric card; cleared after Backup view
   *  scrolls + highlights the row.  Drives the report's hyperlink trace. */
  misBackupFocusMetricId?: string;
  /** Deep-link target for the MIS Upload Files view — set by Missing
   *  Details when the user clicks "Fix this →" on a specific input.
   *  Upload Files reads this on mount, switches to the matching tab,
   *  optionally scrolls/highlights the source row, then clears the flag. */
  misUploadDeepLink?: { tab: 'tally' | 'excel' | 'pdf' | 'manual'; sourceId?: string };
  /** Per-module memory of the last view visited.  Used by SET_MODULE so
   *  switching modules within a session returns the user to where they
   *  were rather than dumping them on each module's first view.  Not
   *  persisted across page refreshes — purely an in-session convenience. */
  lastViewByModule?: Partial<Record<ModuleId, ViewId>>;
}

/** Reference to an uploaded MIS document — kept lightweight (no blob in state). */
export interface MISDocumentRef {
  /** Logical doc id from data-sources.ts (e.g. 'loan-sanction'). */
  id: string;
  /** Original filename. */
  filename: string;
  /** Bytes size. */
  size: number;
  /** When uploaded (Unix ms). */
  uploadedAt: number;
  /** Notes the user added at upload time. */
  note?: string;
}

export interface Insight {
  id: string;
  urgency: Urgency;
  cat: string;
  finding: string;
  implication: string;
  action: string;
  copyText: string;
  checkId?: string;
}

export interface HealthSignal {
  category: string;
  signal: string;
  value: string;
  note: string;
}

export interface AnomalyFlag {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  count?: number;
}

// ── AI Analysis types (Workstream 2) ──

export interface AIRequest {
  score: number;
  grade: string;
  dimScores: Record<DimKey, number>;
  findings: Array<{
    id: string;
    dim: DimKey;
    name: string;
    status: CheckStatus;
    note: string;
    max: number;
  }>;
  financials: {
    revenue: number;
    netProfit: number;
    currentAssets: number;
    currentLiabilities: number;
    bankBalance: number;
    debtorBalance: number;
    creditorBalance: number;
    suspenseBalance: number;
    fixedAssets: number;
    closingStock: number;
  };
  /** Aggregate fingerprints the AI uses to spot patterns the rule
   *  engine doesn't catch.  All numeric (no PII), all percentages or
   *  ratios — so the AI can reason about concentration / anomalies
   *  without ever seeing names or amounts of individual entities. */
  aggregates?: {
    /** Top-N voucher-amount concentration: percentage of total voucher
     *  amount accounted for by the top 1 / top 3 / top 10 parties.
     *  Surfaces vendor / customer concentration risk. */
    topPartyConcentration?: { top1Pct: number; top3Pct: number; top10Pct: number };
    /** Voucher pattern fingerprints (all percentages of totalVouchers). */
    voucherPatterns?: {
      roundNumberPct: number;
      zeroAmountPct: number;
      missingNarrationPct: number;
      cashOver10kCount: number;
      wrongTypeCount: number;
      journalPct: number;
    };
    /** Period clustering — max month volume divided by mean month
     *  volume.  > 3× suggests back-dated bulk entry. */
    monthlyVolumeSpike?: number;
    /** Distinct active months in the period (3 minimum for spike detection). */
    activeMonths?: number;
    /** Key financial ratios (computed once, sent to AI for reasoning). */
    ratios?: {
      currentRatio?: number;       // CA / CL
      debtToEquity?: number;       // creditor / capital (approximate)
      gstAsPctOfSales?: number;
      stockTurnover?: number;      // pur / closing stock
      netProfitMargin?: number;    // netProfit / revenue
    };
  };
  profile: CompanyProfile;
  dataNotes: {
    filesUploaded: number;
    dayBookVoucherCount: number;
    distinctMonthsInData: number;
    scoreCapped: boolean;
  };
}

export interface AIResponse {
  executiveSummary: string;
  rootCauses: Array<{
    theme: string;
    findingIds: string[];
    explanation: string;
  }>;
  actions: Array<{
    task: string;
    impact: 'critical' | 'high' | 'medium' | 'low';
    effort: 'S' | 'M' | 'L';
    category: 'Chart of Accounts' | 'Statutory' | 'Data Integrity' | 'Reconciliation' | 'Reporting';
    resolvesCheckIds: string[];
  }>;
  financialCommentary: string;
  preflight: string[];
  /** Risk matrix: 3-5 key risks with likelihood, impact, mitigation */
  riskMatrix?: Array<{
    risk: string;
    likelihood: 'high' | 'medium' | 'low';
    impact: 'high' | 'medium' | 'low';
    mitigation: string;
  }>;
  /** 2-3 sentence narrative about data completeness and quality */
  dataQualityNarrative?: string;
  /** AI-detected findings the rule-based engine doesn't catch — patterns
   *  across check failures, anomalies in voucher fingerprints, ratio
   *  outliers.  Distinguished from rule insights by carrying explicit
   *  evidence (the data points the finding is based on) and being
   *  generated by reasoning over the aggregates payload rather than a
   *  hard-coded rule.  Rendered with an AI badge on the Insights view. */
  smartInsights?: AISmartInsight[];
  /** Per-failed-check explanation generated by AI, keyed by check id.
   *  Replaces the generic remediation text on Checklist / Flags rows
   *  with a contextual reasoning specific to THIS company's data
   *  (cited numbers from `note`, related dimension failures, etc.).
   *  Empty record means the AI didn't return per-check breakdowns. */
  checkExplanations?: Record<string, AICheckExplanation>;
}

/** A single AI-detected finding.  Distinguished from rule-based
 *  Insight by: (a) evidence array citing the data points behind the
 *  finding; (b) `confidence` reflecting AI uncertainty; (c) generated
 *  by pattern recognition rather than a hard-coded rule. */
export interface AISmartInsight {
  /** Short title — used as the row heading on the Insights panel. */
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'positive';
  /** Dimensions this insight spans (e.g. ['B', 'D'] when patterns
   *  cluster across multiple rule dimensions). */
  dimensions?: DimKey[];
  /** 2-3 sentences explaining what the AI noticed and why it matters. */
  finding: string;
  /** Concrete data points the AI is reasoning over — e.g.
   *  ["Top vendor = 80% of purchases", "Suspense balance ₹2.1L"].
   *  Lets the user verify the finding rather than trust blindly. */
  evidence: string[];
  /** Single concrete action the user should take. */
  recommendation: string;
  /** AI's self-reported confidence — low for speculative pattern
   *  matches, high for findings backed by multiple data points. */
  confidence?: 'high' | 'medium' | 'low';
}

/** Per-check AI explanation surfaced inline on Checklist / Flags rows. */
export interface AICheckExplanation {
  /** Why THIS check failed for THIS company, citing specific numbers
   *  from the check's `note`.  2-3 sentences max. */
  rationale: string;
  /** Downstream impact: which other checks / metrics this affects. */
  impact: string;
  /** Ordered concrete steps to fix in Tally.  3-5 items typical. */
  fixSteps: string[];
}

// ── Agentic Fix Loop types ──

export interface FixTask {
  id: string;                 // e.g. "fix-1"
  title: string;              // Short action title
  detail: string;             // 1-2 sentence explanation of the problem
  tallySteps: string[];       // Exact Tally Prime navigation steps
  checkIds: string[];         // Which checks this resolves
  effort: 'S' | 'M' | 'L';  // ~15 min / ~1 hr / ~half day
  estimatedScoreGain: number; // Rough points gain (computed server-side from check.max values)
  category: string;           // Chart of Accounts | Statutory | Data Integrity | etc.
  status: 'todo' | 'in-progress' | 'done';
}
