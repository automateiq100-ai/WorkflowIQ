/**
 * Registry of every input source MIS (and future Layer 2 modules) can
 * consume.  Each entry pairs a stable id with display metadata + how to
 * obtain the data + which metrics it unlocks.
 *
 * Drives:
 *   • the MIS Data Intake view (what slots to show)
 *   • the availability resolver (do we have this input?)
 *   • per-metric gap remediation ("upload Bills.xml")
 *
 * NOTE: ids are namespaced by kind:
 *   - tally   → matches FileKey ('daybook', 'bills', etc.)
 *   - excel   → template name ('budget', 'production', etc.)
 *   - pdf     → doc category ('loan-sanction', 'lease', etc.)
 *   - manual  → field name on ManualInputs ('headcount', 'orderBook', …)
 */

import type { FileKey } from '../types';

export type DataSourceKind = 'tally' | 'excel' | 'pdf' | 'manual';

export interface DataSourceDef {
  id: string;
  kind: DataSourceKind;
  label: string;
  /** Short description shown under the label in the intake view. */
  description: string;
  /** Step-by-step instructions on how to obtain this input. */
  howToGet: string;
  /** When true, treat as a "first-class" required input (red dot when missing). */
  required: boolean;
  /** Metric ids that benefit when this input is present. */
  unlocks: string[];
  /** Optional file-extension hint for upload widgets. */
  accept?: string;
}

// ── Tally XML sources ────────────────────────────────────────────────────

const TALLY_SOURCES: DataSourceDef[] = [
  {
    id: 'daybook', kind: 'tally',
    label: 'DayBook',
    description: 'All vouchers for the period',
    howToGet: 'Tally → Display → DayBook → Alt+E → Soft Copy → XML',
    required: true,
    unlocks: ['P4', 'CF2', 'CF8', 'CF10', 'WC5', 'BPI1', 'BPI3', 'BPI5', 'BPI7', 'BPI8', 'BPI12', 'CA5'],
    accept: '.xml',
  },
  {
    id: 'trialbal', kind: 'tally',
    label: 'Trial Balance',
    description: 'Ledger closing balances + period movement',
    howToGet: 'Tally → Display → Trial Balance → Alt+E → XML',
    required: true,
    unlocks: ['SC1', 'SC2', 'SC3', 'SC4', 'SC7', 'SC8', 'CF3', 'CF9', 'BS4', 'BS10'],
    accept: '.xml',
  },
  {
    id: 'pandl', kind: 'tally',
    label: 'P&L Statement',
    description: 'Revenue, expenses, profit by line',
    howToGet: 'Tally → Display → P&L → Alt+E → XML',
    required: true,
    unlocks: ['P1', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'BS5', 'BS9', 'CA1', 'CA2', 'CA3', 'CA9'],
    accept: '.xml',
  },
  {
    id: 'bsheet', kind: 'tally',
    label: 'Balance Sheet',
    description: 'Assets, liabilities, equity',
    howToGet: 'Tally → Display → Balance Sheet → Alt+E → XML',
    required: true,
    unlocks: ['CF1', 'WC2', 'WC7', 'WC10', 'WC12', 'BS1', 'BS2', 'BS3', 'BS6', 'BS8'],
    accept: '.xml',
  },
  {
    id: 'grpsum', kind: 'tally',
    label: 'Group Summary',
    description: 'Group-wise ledger rollups',
    howToGet: 'Tally → Display → Account Books → Group Summary → Alt+E → XML',
    required: true,
    unlocks: [],
    accept: '.xml',
  },
  {
    id: 'master', kind: 'tally',
    label: 'Chart of Accounts',
    description: 'Ledger names, groups, GST rates',
    howToGet: 'Tally → Display → List of Accounts → Alt+E → All Masters → XML',
    required: true,
    unlocks: [],
    accept: '.xml',
  },
  {
    id: 'bills', kind: 'tally',
    label: 'Bills Outstanding',
    description: 'Open bills with due dates — debtor/creditor aging',
    howToGet: 'Tally → Display → Statements of Accounts → Outstandings → Bills Outstanding → Alt+E → XML',
    required: false,
    unlocks: ['WC1', 'WC3', 'WC4', 'WC6', 'WC8', 'WC9', 'BPI9'],
    accept: '.xml',
  },
  {
    id: 'sales', kind: 'tally',
    label: 'Sales Register',
    description: 'Voucher-level sales detail (optional)',
    howToGet: 'Tally → Display → Account Books → Sales Register → Alt+E → XML',
    required: false,
    unlocks: ['BPI2'],
    accept: '.xml',
  },
  {
    id: 'purchase', kind: 'tally',
    label: 'Purchase Register',
    description: 'Voucher-level purchase detail (optional)',
    howToGet: 'Tally → Display → Account Books → Purchase Register → Alt+E → XML',
    required: false,
    unlocks: [],
    accept: '.xml',
  },
  {
    id: 'payables', kind: 'tally',
    label: 'Bills Payable',
    description: 'Open payables (optional — partially covered by Bills.xml)',
    howToGet: 'Tally → Outstanding → Bills Payable → Alt+E → XML',
    required: false,
    unlocks: [],
    accept: '.xml',
  },
  {
    id: 'stock', kind: 'tally',
    label: 'Stock Summary',
    description: 'Closing stock by item (unlocks SKU-level metrics)',
    howToGet: 'Tally → Inventory → Stock Summary → Alt+E → XML',
    required: false,
    unlocks: ['BPI2', 'WC11'],
    accept: '.xml',
  },
  {
    id: 'faregister', kind: 'tally',
    label: 'Fixed Asset Register',
    description: 'Asset additions, disposals, depreciation schedule',
    howToGet: 'Tally → Display → Statements of Accounts → Fixed Assets → Alt+E → XML',
    required: false,
    unlocks: [],
    accept: '.xml',
  },
  {
    id: 'cashflow', kind: 'tally',
    label: 'Cash Flow Statement',
    description: 'Tally-computed OCF / ICF / FCF',
    howToGet: 'Tally → Display → Cash Flow → Alt+E → XML',
    required: false,
    unlocks: ['CF4', 'CF5', 'CF6'],
    accept: '.xml',
  },
  {
    id: 'bankrecon', kind: 'tally',
    label: 'Bank Reconciliation',
    description: 'Bank statement reconciliation status',
    howToGet: 'Tally → Banking → Bank Reconciliation → Alt+E → XML',
    required: false,
    unlocks: [],
    accept: '.xml',
  },
];

// ── Excel / spreadsheet uploads ──────────────────────────────────────────

const EXCEL_SOURCES: DataSourceDef[] = [
  {
    id: 'budget', kind: 'excel',
    label: 'Annual Budget',
    description: 'Monthly P&L budget — drives "budget vs actual" variance metrics',
    howToGet: 'Download the template, fill in your monthly budget per P&L line, re-upload',
    required: false,
    unlocks: ['P3', 'CA8'],
    accept: '.xlsx,.xls,.csv',
  },
  {
    id: 'production', kind: 'excel',
    label: 'Production Quantity Log',
    description: 'Manufacturing only — units produced per month',
    howToGet: 'Download template; one row per month with units produced',
    required: false,
    unlocks: ['CA7'],
    accept: '.xlsx,.xls,.csv',
  },
  {
    id: 'headcount-log', kind: 'excel',
    label: 'Monthly Headcount Log',
    description: 'Headcount per month (for cost-per-head trend)',
    howToGet: 'Download template; one row per month with employee count',
    required: false,
    unlocks: ['CA6'],
    accept: '.xlsx,.xls,.csv',
  },
];

// ── PDF uploads (manual key-value extraction) ────────────────────────────

const PDF_SOURCES: DataSourceDef[] = [
  {
    id: 'loan-sanction', kind: 'pdf',
    label: 'Loan Sanction Letter',
    description: 'Key figures keyed manually after upload (drawing power, covenants)',
    howToGet: 'Upload bank sanction letter PDF, then fill in the structured fields below',
    required: false,
    unlocks: ['BS7', 'BPI11'],
    accept: '.pdf',
  },
  {
    id: 'lease', kind: 'pdf',
    label: 'Lease Agreement',
    description: 'For long-term commitments not captured in monthly rent',
    howToGet: 'Upload lease PDF; monthly rent already comes from Tally',
    required: false,
    unlocks: [],
    accept: '.pdf',
  },
  {
    id: 'insurance', kind: 'pdf',
    label: 'Insurance Policy',
    description: 'Contingent coverage / disclosure',
    howToGet: 'Upload insurance schedule PDF',
    required: false,
    unlocks: [],
    accept: '.pdf',
  },
];

// ── Manual inputs (no file, structured form fields) ──────────────────────

const MANUAL_SOURCES: DataSourceDef[] = [
  {
    id: 'headcount', kind: 'manual',
    label: 'Current Headcount',
    description: 'Total employees on payroll this period',
    howToGet: 'Enter the number — used for cost-per-head and revenue-per-employee',
    required: false,
    unlocks: ['CA6'],
  },
  {
    id: 'orderBook', kind: 'manual',
    label: 'Order Book Value',
    description: 'Confirmed pipeline / order book at period end (₹)',
    howToGet: 'Enter the confirmed pipeline value in rupees',
    required: false,
    unlocks: ['BPI6'],
  },
  {
    id: 'drawingPowerLimit', kind: 'manual',
    label: 'Drawing Power / Sanctioned Limit',
    description: 'From bank sanction letter (₹)',
    howToGet: 'Read from sanction letter — usually shown as "drawing power" or "sanctioned limit"',
    required: false,
    unlocks: ['BS7'],
  },
  {
    id: 'covenants', kind: 'manual',
    label: 'Loan Covenants',
    description: 'DSCR min, D/E max, Current Ratio min from sanction letter',
    howToGet: 'Read covenant thresholds from sanction letter financial-covenants section',
    required: false,
    unlocks: ['BPI11'],
  },
  {
    id: 'contingentLiabilities', kind: 'manual',
    label: 'Contingent Liabilities',
    description: 'Guarantees, disputes, litigation (₹)',
    howToGet: 'Disclose any unrecorded obligations (bank guarantees, lawsuits, etc.)',
    required: false,
    unlocks: ['BPI13'],
  },
  {
    id: 'productionQty', kind: 'manual',
    label: 'Production Quantity (this period)',
    description: 'Manufacturing only — total units produced',
    howToGet: 'Enter units produced this period',
    required: false,
    unlocks: ['CA7'],
  },
];

// ── Combined registry ───────────────────────────────────────────────────

export const ALL_DATA_SOURCES: DataSourceDef[] = [
  ...TALLY_SOURCES,
  ...EXCEL_SOURCES,
  ...PDF_SOURCES,
  ...MANUAL_SOURCES,
];

export function sourcesByKind(kind: DataSourceKind): DataSourceDef[] {
  return ALL_DATA_SOURCES.filter(s => s.kind === kind);
}

export function findSource(kind: DataSourceKind, id: string): DataSourceDef | undefined {
  return ALL_DATA_SOURCES.find(s => s.kind === kind && s.id === id);
}

/**
 * Convenience type guard — narrows a tally source id to a FileKey at
 * compile time so callers don't need redundant string casts.
 */
export function isTallyFileKey(id: string): id is FileKey {
  return ['daybook', 'trialbal', 'pandl', 'bsheet', 'grpsum', 'master',
    'sales', 'purchase', 'bills', 'payables', 'cashflow',
    'faregister', 'stock', 'bankrecon'].includes(id);
}
