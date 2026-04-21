// All TypeScript interfaces for AccountingIQ

export type FileKey =
  | 'daybook' | 'trialbal' | 'pandl' | 'bsheet' | 'grpsum'   // required
  | 'sales' | 'purchase' | 'bills' | 'payables' | 'cashflow'   // conditional
  | 'faregister' | 'stock' | 'bankrecon';                       // optional

export type ModuleId = 'accounting' | 'mis' | 'reconciliation';

export type ViewId =
  | 'company-select' | 'company-dashboard'
  | 'dashboard' | 'checklist' | 'insights' | 'health'
  | 'flags' | 'upload' | 'profile' | 'reports' | 'rules'
  | 'mis-setup' | 'mis-report'
  | 'reconciliation' | 'aiAnalysis'
  | 'data-view' | 'agent-fix';

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
  roundCount: number;
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
  cashBankNetMovement: number;
  taxVoucherTotal: number;
  journalNetAmt: number;
  outOfFY: number;
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
  pfLedgerFound: boolean;
  salesLedgersNoRate: number;
  gstDiffPct: number;
  /** Names and amounts of suspense/misc ledgers for richer notes (Bug 4) */
  suspenseLedgers: Array<{ name: string; amount: number }>;
  /** Near-duplicate ledger pair names for fail labels */
  dupPairDetails: Array<[string, string]>;

  // P&L
  revenue: number;
  expenses: number;
  netProfit: number;
  depFound: boolean;
  depAmt: number;
  openingStock: number;

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

  // Group Summary
  salesWrongGroup: boolean;
  purchaseWrongGroup: boolean;
  dutiesUnderExpense: boolean;
}

export interface TBLedger {
  name: string;
  nl: string;   // lowercased
  closing: number;
  dr: boolean;
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
  company_name: string | null;
  company_type: string | null;
  selected_tools: string[];
  gst_applicable: boolean;
  gst_regular: boolean;
  tds_applicable: boolean;
  has_employees: boolean;
  has_fa_filter: boolean;
  is_goods: boolean;
  full_fy: boolean;
  theme: 'dark' | 'light';
  onboarding_done: boolean;
}

export function dbProfileToFilters(p: Partial<UserProfile>): CompanyProfile {
  return {
    gstApplicable: p.gst_applicable ?? false,
    gstRegular:    p.gst_regular ?? false,
    tdsApplicable: p.tds_applicable ?? false,
    hasEmployees:  p.has_employees ?? false,
    hasFAfilter:   p.has_fa_filter ?? false,
    isGoods:       p.is_goods ?? false,
    fullFY:        p.full_fy ?? true,
  };
}

export interface MISSetup {
  sector: MISSector | null;
  hasBudget: boolean;
  selectedMetricIds: string[];  // IDs of metrics user has selected
}

export interface Company {
  id: string;
  user_id: string;
  name: string;
  company_type: string | null;
  gst_applicable: boolean;
  gst_regular: boolean;
  tds_applicable: boolean;
  has_employees: boolean;
  has_fa_filter: boolean;
  is_goods: boolean;
  full_fy: boolean;
  created_at: string;
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
