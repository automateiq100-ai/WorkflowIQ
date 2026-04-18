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
  required:    ['daybook', 'trialbal', 'pandl', 'bsheet', 'grpsum'] as FileKey[],
  conditional: ['sales', 'purchase', 'bills', 'payables', 'cashflow'] as FileKey[],
  optional:    ['faregister', 'stock', 'bankrecon'] as FileKey[],
};

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
};

export const VIEWS: { id: ViewId; label: string; icon: string; }[] = [
  { id: 'upload',        label: 'Upload Files',     icon: '⬆' },
  { id: 'profile',       label: 'Company Profile',  icon: '◎' },
  { id: 'dashboard',     label: 'Dashboard',        icon: '⬡' },
  { id: 'checklist',     label: 'Checklist',        icon: '✓' },
  { id: 'insights',      label: 'Key Insights',     icon: '◈' },
  { id: 'aiAnalysis',    label: 'AI Analysis',      icon: '⚡' },
  { id: 'health',        label: 'Financial Health', icon: '⬟' },
  { id: 'flags',         label: 'Anomaly Flags',    icon: '⚑' },
  { id: 'reports',       label: 'Reports',          icon: '▤' },
  { id: 'rules',         label: 'Rules Engine',     icon: '⚙' },
  { id: 'mis-setup',     label: 'MIS Setup',        icon: '⊞' },
  { id: 'mis-report',    label: 'MIS Report',       icon: '▦' },
  { id: 'reconciliation',label: 'Reconciliation',   icon: '⇌' },
];


export const MODULE_VIEWS: Record<ModuleId, ViewId[]> = {
  accounting: ['upload', 'profile', 'dashboard', 'checklist', 'insights', 'aiAnalysis', 'health', 'flags', 'reports', 'rules'],
  mis: ['mis-setup', 'mis-report'],
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
