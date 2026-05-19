import type { DimKey, FileKey, ViewId, ModuleId } from './types';

export const DIM_WEIGHTS: Record<DimKey, number> = {
  A: 5, B: 18, C: 18, D: 22, E: 18, F: 7, G: 2, H: 10,
};

export const DIM_LABELS: Record<DimKey, string> = {
  A: 'Data Completeness',
  B: 'Ledger Structure',
  C: 'Voucher Integrity',
  D: 'Arithmetical Accuracy',
  E: 'Statutory Accuracy',
  F: 'Recording Discipline',
  G: 'Consistency',
  H: 'Cross-Statement Reconciliation',
};

export const DIM_COLORS: Record<DimKey, string> = {
  A: 'var(--blue)',
  B: 'var(--purple)',
  C: 'var(--amber)',
  D: 'var(--red)',
  E: 'var(--teal)',
  F: 'var(--green)',
  G: 'var(--text2)',
  H: 'var(--coral)',
};

export const FILE_TIERS = {
  required:    ['daybook', 'trialbal', 'pandl', 'bsheet', 'grpsum', 'master'] as FileKey[],
  conditional: ['sales', 'purchase', 'bills', 'payables', 'cashflow'] as FileKey[],
  optional:    ['faregister', 'stock', 'bankrecon'] as FileKey[],
};

/** Total number of file slots the app supports.  Derived from FILE_TIERS so
 *  it stays in sync when slots are added/removed (used in 'X of N' counters
 *  in DashboardView and ReportsView — previously hardcoded to 13, which
 *  fell out of date when the 'master' slot was introduced). */
export const TOTAL_FILE_COUNT =
  FILE_TIERS.required.length + FILE_TIERS.conditional.length + FILE_TIERS.optional.length;

export const FILE_LABELS: Record<FileKey, string> = {
  daybook: 'DayBook',
  trialbal: 'Trial Balance',
  pandl: 'P&L Statement',
  bsheet: 'Balance Sheet',
  grpsum: 'Group Summary',
  sales: 'Sales Register',
  purchase: 'Purchase Register',
  bills: 'Bills Receivable',
  payables: 'Bills Payable',
  cashflow: 'Cash Flow',
  faregister: 'Fixed Asset Register',
  stock: 'Stock Summary',
  bankrecon: 'Bank Reconciliation',
  master: 'Chart of Accounts',
};

export const FILE_DESCRIPTIONS: Record<FileKey, string> = {
  daybook: 'All vouchers — used for 40+ checks',
  trialbal: 'Ledger closing balances',
  pandl: 'Profit & Loss statement',
  bsheet: 'Balance Sheet',
  grpsum: 'Group-wise ledger summary',
  sales: 'Sales vouchers register',
  purchase: 'Purchase vouchers register',
  bills: 'Bills receivable details',
  payables: 'Bills payable details',
  cashflow: 'Cash flow statement',
  faregister: 'Fixed asset schedule',
  stock: 'Stock summary / closing stock',
  bankrecon: 'Bank reconciliation statement',
  master: 'Chart of Accounts (All Masters export)',
};

/** Manual-export step-by-step for each Tally report.  Every entry follows
 *  the same shape so the UI can render it uniformly:
 *
 *    { path: 'Gateway of Tally → ... → <Report>',
 *      hotkey: '<keyboard accelerator at the report screen>',
 *      tip: '<optional configuration note, e.g. F12 toggles>' }
 *
 *  Once the user is on the report screen, the export action is always the
 *  same: press Alt+E (Export), pick "Soft Copy" → format "XML" → choose
 *  the destination folder.  The `hotkey` field lets us call out reports
 *  with a single-key gateway shortcut (e.g. Day Book is "D" from the
 *  Gateway), and `tip` surfaces report-specific options that affect
 *  parser-side checks (Trial Balance opening balances for H4, etc.).
 *
 *  Used in two places:
 *    • UploadView file-slot rows (ⓘ hover tooltip — "How to export")
 *    • RequestClientModal email template
 */
export const FILE_EXPORT_PATHS: Record<FileKey, { path: string; hotkey?: string; tip?: string }> = {
  daybook:    { path: 'Gateway → Display More Reports → Day Book',
                hotkey: 'Alt+G → type "Day Book"',
                tip: 'Set Period (F2) to cover the full FY before exporting' },
  trialbal:   { path: 'Gateway → Display More Reports → Trial Balance',
                hotkey: 'Alt+G → type "Trial Balance"',
                tip: 'F12 → set "Show Opening Balance" = Yes  (enables H4 cash/bank reconciliation)' },
  pandl:      { path: 'Gateway → Profit & Loss A/c',
                hotkey: 'P (from Gateway)',
                tip: 'F12 → "Show Vertical Profit & Loss" = No  (horizontal layout parses more reliably)' },
  bsheet:     { path: 'Gateway → Balance Sheet',
                hotkey: 'B (from Gateway)',
                tip: 'F12 → "Show Vertical Balance Sheet" = No' },
  grpsum:     { path: 'Gateway → Display More Reports → Account Books → Group Summary',
                tip: 'When prompted, pick "Primary" to export every primary group' },
  master:     { path: 'Gateway → Alt+E → Masters → All Masters',
                hotkey: 'Alt+E from Gateway → choose Masters → All Masters',
                tip: 'Single XML containing every ledger + group definition' },
  sales:      { path: 'Gateway → Display More Reports → Account Books → Sales Register' },
  purchase:   { path: 'Gateway → Display More Reports → Account Books → Purchase Register' },
  bills:      { path: 'Gateway → Display More Reports → Statements of Accounts → Outstandings → Receivables' },
  payables:   { path: 'Gateway → Display More Reports → Statements of Accounts → Outstandings → Payables' },
  cashflow:   { path: 'Gateway → Display More Reports → Cash/Funds Flow → Cash Flow' },
  faregister: { path: 'Gateway → Display More Reports → Account Books → Group Summary → Fixed Assets',
                tip: 'Drill into the Fixed Assets primary group then export' },
  stock:      { path: 'Gateway → Stock Summary',
                hotkey: 'S (from Gateway)' },
  bankrecon:  { path: 'Gateway → Display More Reports → Account Books → Cash/Bank Books → <Bank Ledger>',
                tip: 'Open the bank ledger, press F5 (Reconcile), then Alt+E to export' },
};

/** Universal export-action footer — appended after every report-specific
 *  path so the UI can show "Path → action".  Kept separate so we can
 *  reword it once without touching all 14 entries. */
export const FILE_EXPORT_ACTION = 'Alt+E (Export) → Soft Copy → Format: XML';

export const VIEWS: { id: ViewId; label: string; icon: string; }[] = [
  { id: 'company-select',   label: 'Companies',        icon: '⊙' },
  { id: 'company-dashboard',label: 'Overview',         icon: '⬡' },
  { id: 'upload',           label: 'Upload Files',     icon: '⬆' },
  { id: 'profile',        label: 'Company Profile',  icon: '◎' },
  { id: 'dashboard',     label: 'Dashboard',        icon: '⬡' },
  { id: 'checklist',     label: 'Checklist',        icon: '✓' },
  { id: 'insights',      label: 'Key Insights',     icon: '◈' },
  { id: 'aiAnalysis',    label: 'Analysis',         icon: '◈' },
  { id: 'health',        label: 'Financial Health', icon: '⬟' },
  { id: 'flags',         label: 'Anomaly Flags',    icon: '⚑' },
  { id: 'reports',       label: 'Reports',          icon: '▤' },
  { id: 'rules',         label: 'Rules Engine',     icon: '⚙' },
  { id: 'data-view',     label: 'Data & Fix',       icon: '⊟' },
  { id: 'agent-fix',     label: 'Fix Planner',      icon: '⚑' },
  { id: 'tally-connection', label: 'Tally Connection', icon: '⇌' },
  { id: 'master-setup',  label: 'Master Setup',     icon: '⚙' },
  { id: 'mis-profile',          label: 'Company Profile',    icon: '◎' },
  { id: 'mis-upload',           label: 'Upload Files',       icon: '⬆' },
  { id: 'mis-fix',              label: 'Missing Details',    icon: '⚑' },
  { id: 'mis-rules',            label: 'Rules Engine',       icon: '⚙' },
  { id: 'mis-dashboard',          label: 'Dashboard',         icon: '⬡' },
  { id: 'mis-metrics-checklist',  label: 'Metrics Checklist', icon: '✓' },
  { id: 'mis-checklist',          label: 'Book Closure',      icon: '☑' },
  { id: 'mis-analysis',           label: 'Analysis',          icon: '◈' },
  { id: 'mis-ai-plan',          label: 'Fix Plan',           icon: '✨' },
  { id: 'mis-report-cover',     label: 'Cover',              icon: '◐' },
  { id: 'mis-report-pl',        label: 'P&L',                icon: '◈' },
  { id: 'mis-report-cf',        label: 'Cash Flow',          icon: '⇌' },
  { id: 'mis-report-bs',        label: 'Balance Sheet',      icon: '▤' },
  { id: 'mis-report-wc',        label: 'Working Capital',    icon: '◆' },
  { id: 'mis-report-cost',      label: 'Cost Analysis',      icon: '◇' },
  { id: 'mis-report-bpi',       label: 'Business Performance', icon: '▦' },
  { id: 'mis-report-statutory', label: 'Statutory',          icon: '⚐' },
  { id: 'mis-report-forecast',  label: 'Forecast',           icon: '↗' },
  { id: 'mis-report-backup',    label: 'Backup Working',     icon: '⊟' },
  { id: 'reconciliation',label: 'Reconciliation',   icon: '⇌' },
];


export const MODULE_VIEWS: Record<ModuleId, ViewId[]> = {
  accounting: ['company-select', 'company-dashboard', 'upload', 'profile', 'dashboard', 'checklist', 'insights', 'aiAnalysis', 'health', 'flags', 'data-view', 'agent-fix', 'reports', 'rules', 'tally-connection', 'master-setup'],
  mis: [
    // Setup group — user journey starts here, in order
    'mis-profile',      // 1. company details + metric selection
    'mis-fix',          // 2. what's missing — diagnose first
    'mis-upload',       // 3. then upload to fix the gaps
    'mis-rules',        // 4. formulas + thresholds (the logic)
    'master-setup',     // 5. chart-of-accounts hygiene (shared)
    // Post-setup
    'mis-dashboard', 'mis-metrics-checklist', 'mis-checklist', 'mis-analysis',
    'mis-ai-plan',
    // Report group
    'mis-report-cover', 'mis-report-pl', 'mis-report-cf',
    'mis-report-bs', 'mis-report-wc', 'mis-report-cost',
    'mis-report-bpi', 'mis-report-statutory', 'mis-report-forecast',
    'mis-report-backup',
  ],
  reconciliation: ['reconciliation'],
};

export const MODULES: { id: ModuleId; label: string; icon: string }[] = [
  { id: 'accounting',    label: 'Account Health',  icon: '⬡' },
  { id: 'mis',           label: 'MIS Report',      icon: '▦' },
  { id: 'reconciliation',label: 'Reconciliation',  icon: '⇌' },
];


export const GRADE_THRESHOLDS = [
  { min: 90, label: 'A+', color: 'var(--teal)' },
  { min: 75, label: 'B',  color: 'var(--green)' },
  { min: 60, label: 'C',  color: 'var(--blue)' },
  { min: 40, label: 'D',  color: 'var(--amber)' },
  { min: 0,  label: 'F',  color: 'var(--red)' },
];

export function getGrade(score: number) {
  return GRADE_THRESHOLDS.find(g => score >= g.min) ?? GRADE_THRESHOLDS[4];
}

export const HIGH_VALUE_THRESHOLD = 100_000;  // ₹1 lakh
export const CASH_LIMIT = 10_000;             // Section 269ST
export const CHUNK_SIZE = 32 * 1024 * 1024;  // 32 MB
