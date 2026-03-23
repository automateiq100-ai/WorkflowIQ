// All TypeScript interfaces for AccountingIQ

export type FileKey =
  | 'daybook' | 'trialbal' | 'pandl' | 'bsheet' | 'grpsum'   // required
  | 'sales' | 'purchase' | 'bills' | 'payables' | 'cashflow'   // conditional
  | 'faregister' | 'stock' | 'bankrecon';                       // optional

export type ViewId =
  | 'dashboard' | 'checklist' | 'insights' | 'health'
  | 'flags' | 'upload' | 'profile' | 'reports';

export type CheckStatus = 'pass' | 'partial' | 'fail' | 'missing' | 'uncertain' | 'na';
export type Urgency = 'critical' | 'high' | 'medium' | 'positive';
export type DimKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type FilterMode = 'all' | 'fails' | 'missing' | 'passed';

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

  // P&L
  revenue: number;
  expenses: number;
  netProfit: number;
  depFound: boolean;
  depAmt: number;
  openingStock: number;

  // Balance Sheet
  ca: number;
  cl: number;
  bankBal: number;
  debtorBal: number;
  creditorBal: number;
  closingStock: number;
  fixedAssets: number;
  bsCashBankTotal: number;

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

export interface AppState {
  files: Record<FileKey, FileEntry>;
  parsedData: Partial<ParsedData>;
  results: AnalysisResults | null;
  filters: CompanyProfile;
  analysed: boolean;
  currentView: ViewId;
  consentGiven: boolean;
  uploadProgress: string | null;   // chunked parse progress message
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
