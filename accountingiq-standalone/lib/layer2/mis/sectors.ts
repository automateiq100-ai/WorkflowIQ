/**
 * Sector-specific add-on metrics.  Activated only when the user selects
 * the matching sector in Step 2 Setup.  These additions are appended to the
 * 73 core metrics and counted in the readiness score when selected.
 *
 * Most sector metrics require additional Tally configuration (stock items,
 * cost centres, godowns) or manual input.  We default to 'partial' status
 * with a compute() that surfaces what we can derive and explains the gap
 * otherwise — keeps the readiness score honest without auto-passing.
 */

import type { MetricContext, MetricDef, MetricResult, SectorAddOn } from '../types';
import { missingDataResult } from '../types';

/**
 * Standard "partial — requires sector setup" stub.  We surface the metric
 * with a status so it lands in the gap list and Setup screen, but the
 * compute is intentionally a placeholder until each sector's data
 * extraction is wired (next milestone after Layer 2 plumbing is stable).
 */
function sectorStub(
  id: string, label: string, source: string, caveat: string, remediation: string,
  compute?: (ctx: MetricContext) => MetricResult,
): MetricDef {
  return {
    id, domainId: 'SECTOR', label,
    defaultStatus: 'partial', source, caveat, remediation,
    formula: 'Sector-specific — see Tally setup guide',
    compute: compute ?? ((ctx) => missingDataResult(id, caveat)),
  };
}

// ── Manufacturing ────────────────────────────────────────────────────────

const MFG: MetricDef[] = [
  sectorStub('MFG1', 'Production volume vs capacity', 'Manual + stock items',
    'Production qty + capacity must be entered',
    'Enter monthly production qty + plant capacity in Setup'),
  sectorStub('MFG2', 'Machine utilisation %', 'Manual',
    'No XML source — manual time-log input',
    'Track machine hours separately and enter in Setup'),
  sectorStub('MFG3', 'Raw material consumption ratio', 'Stock items + DayBook',
    'Stock items must be tagged with consumption type',
    'Configure stock item ledgers for RM vs FG in Tally'),
  sectorStub('MFG4', 'WIP / finished goods inventory', 'BSheet + stock items',
    'WIP must be a separate Tally stock group',
    'Create separate stock groups for WIP and Finished Goods'),
  sectorStub('MFG5', 'Rejection / scrap rate', 'DayBook + manual',
    'Scrap vouchers must use dedicated ledger',
    'Create Scrap / Rejection ledger and post rejection vouchers'),
  sectorStub('MFG6', 'Cost per unit produced', 'Manual + DayBook',
    'Needs production qty entered in Setup',
    'Enter production qty in Setup; cost auto-derived from P&L'),
  sectorStub('MFG7', 'Overhead absorption rate', 'DayBook + cost centres',
    'Cost centres must be configured',
    'Tag overheads to cost centres in Tally'),
];

// ── Trading / distribution ──────────────────────────────────────────────

const TRADING: MetricDef[] = [
  sectorStub('TRD1', 'Gross margin per SKU / category', 'DayBook + stock items',
    'Stock items must be used in sales vouchers',
    'Use stock items consistently in sales/purchase vouchers'),
  sectorStub('TRD2', 'Inventory turnover by SKU', 'DayBook + stock items',
    'Stock movement vouchers needed',
    'Track stock movement via stock items in Tally'),
  sectorStub('TRD3', 'Slow / dead stock value', 'DayBook + stock items',
    'Last-movement date per stock item needed',
    'Enable stock movement tracking in Tally'),
  sectorStub('TRD4', 'Purchase price variance', 'DayBook (multi)',
    'Needs 2+ periods for variance',
    'Upload multiple purchase periods'),
  sectorStub('TRD5', 'Customer-wise profitability', 'DayBook + cost allocation',
    'Customer-level costing not in Tally',
    'Use customer-specific ledgers + cost allocation'),
  sectorStub('TRD6', 'Fill rate / stockout frequency', 'Manual',
    'Order book + stockout log needed',
    'Maintain order register separately'),
];

// ── Services / consulting ───────────────────────────────────────────────

const SERVICES: MetricDef[] = [
  sectorStub('SVC1', 'Revenue per billable employee', 'Manual + P&L',
    'Headcount must be entered in Setup',
    'Enter billable headcount in Setup'),
  sectorStub('SVC2', 'Billable utilisation %', 'Manual',
    'No XML source — time-tracking system needed',
    'Use a time-tracking tool and enter monthly utilisation'),
  sectorStub('SVC3', 'Realisable vs billed revenue', 'DayBook + Bills',
    'Bills.xml gives realised collection',
    'Upload Bills.xml for realisation tracking'),
  sectorStub('SVC4', 'Project-wise profitability', 'DayBook + cost centres',
    'Project-level cost centres in Tally needed',
    'Configure project as cost centre per engagement'),
  sectorStub('SVC5', 'Unbilled revenue (WIP)', 'Manual + journal entries',
    'WIP must be posted via journal',
    'Pass monthly WIP accrual journal'),
  sectorStub('SVC6', 'Client retention rate', 'DayBook (multi)',
    'Needs multi-period customer history',
    'Upload 12+ months of DayBook for retention calc'),
  sectorStub('SVC7', 'Employee cost as % of revenue', 'P&L + Manual',
    'Headcount input recommended',
    'Enter headcount and ensure salary ledger separate'),
];

// ── Retail ──────────────────────────────────────────────────────────────

const RETAIL: MetricDef[] = [
  sectorStub('RTL1', 'Same-store sales growth (SSSG)', 'DayBook + godowns (multi)',
    'Per-store godowns in Tally',
    'Configure each store as a separate godown'),
  sectorStub('RTL2', 'Revenue per sq ft', 'Manual + P&L',
    'Sq ft per store entered in Setup',
    'Enter store area in Setup'),
  sectorStub('RTL3', 'Footfall conversion rate', 'Manual',
    'POS system data needed',
    'Track footfall and txn count externally'),
  sectorStub('RTL4', 'Average basket size (ATV)', 'DayBook',
    'Sales voucher count per day',
    'Computable — same as BPI5'),
  sectorStub('RTL5', 'Shrinkage / pilferage %', 'Stock items + audit',
    'Physical stock audit needed',
    'Compare physical vs Tally closing stock'),
  sectorStub('RTL6', 'Category-wise margin', 'DayBook + stock categories',
    'Stock categories must be configured',
    'Tag stock items with categories in Tally'),
  sectorStub('RTL7', 'Return rate by channel', 'DayBook + godowns',
    'Channel = godown / cost centre tagging',
    'Configure channel as godown in Tally'),
];

// ── Construction / real estate ──────────────────────────────────────────

const CONSTRUCTION: MetricDef[] = [
  sectorStub('CON1', 'Project-wise revenue recognition %', 'DayBook + cost centres',
    'Project as cost centre',
    'Configure each project as cost centre in Tally'),
  sectorStub('CON2', 'Cost to complete vs budget', 'Manual + DayBook',
    'Project budget needed in Setup',
    'Upload project budget'),
  sectorStub('CON3', 'Retention money outstanding', 'Bills.xml + manual',
    'Retention bills tagged separately',
    'Use separate retention bill numbers in Tally'),
  sectorStub('CON4', 'Mobilisation advances given', 'DayBook',
    'Advance vouchers with party tag',
    'Tag mobilisation advance party in voucher narration'),
  sectorStub('CON5', 'WIP (% completion method)', 'Manual',
    '% completion entered per project',
    'Update % completion monthly in Setup'),
  sectorStub('CON6', 'Subcontractor payables aging', 'Bills.xml',
    'Bills.xml required',
    'Upload Bills.xml for subcontractor aging'),
];

// ── Financial services / NBFC ────────────────────────────────────────────

const FINANCIAL: MetricDef[] = [
  sectorStub('FIN1', 'Loan book size & disbursements', 'BSheet + DayBook',
    'Loan portfolio ledgers separated',
    'Maintain loan-wise ledgers in Tally'),
  sectorStub('FIN2', 'NPA % (gross & net)', 'Manual',
    'NPA classification by ageing/manual review',
    'Tag NPA accounts in Tally and enter provision %'),
  sectorStub('FIN3', 'Net interest margin (NIM)', 'P&L',
    'Interest income vs interest expense',
    'Separate Interest Income and Interest Expense ledgers'),
  sectorStub('FIN4', 'Cost of funds', 'P&L + BSheet',
    'Interest expense / avg borrowings',
    'Ensure all borrowings under Loans group'),
  sectorStub('FIN5', 'Capital adequacy ratio', 'Manual + BSheet',
    'Risk-weighted assets needed (RBI formula)',
    'Compute RWA per RBI guidance, enter in Setup'),
  sectorStub('FIN6', 'Collection efficiency %', 'DayBook',
    'Computable — same as WC5',
    'Already covered by WC5'),
];

// ── Hospitality / F&B ────────────────────────────────────────────────────

const HOSPITALITY: MetricDef[] = [
  sectorStub('HSP1', 'RevPAR / RevPAB', 'Manual + P&L',
    'Room count entered in Setup',
    'Enter total rooms / bays in Setup'),
  sectorStub('HSP2', 'Occupancy rate %', 'Manual',
    'PMS data needed',
    'Track daily occupancy externally and enter monthly'),
  sectorStub('HSP3', 'Food cost % (target 28–35%)', 'P&L',
    'Food cost ledger separate from beverage',
    'Separate Food Cost and Beverage Cost ledgers in Tally'),
  sectorStub('HSP4', 'Covers per day / table turnover', 'DayBook',
    'Sales voucher count per day',
    'Sales voucher count = covers (approx)'),
  sectorStub('HSP5', 'Average spend per cover', 'DayBook',
    'Revenue / sales voucher count',
    'Same as BPI5'),
  sectorStub('HSP6', 'Beverage cost %', 'P&L',
    'Beverage cost separate ledger',
    'Separate Beverage Cost ledger in Tally'),
];

// ── IT / SaaS / startups ─────────────────────────────────────────────────

const SAAS: MetricDef[] = [
  sectorStub('SAS1', 'MRR / ARR', 'DayBook + recurring revenue tagging',
    'Subscription invoices need recurring tag',
    'Tag subscription sales with dedicated ledger or narration prefix'),
  sectorStub('SAS2', 'Churn rate (revenue & customer)', 'DayBook (multi)',
    'Multi-period customer revenue history',
    'Upload 6+ months of DayBook for churn calc'),
  sectorStub('SAS3', 'Customer acquisition cost (CAC)', 'P&L + manual',
    'Marketing spend / new customers acquired',
    'Enter # new customers in Setup; marketing cost auto-derived'),
  sectorStub('SAS4', 'LTV:CAC ratio', 'Manual + DayBook',
    'Avg customer lifetime needed',
    'Enter average customer lifetime in months in Setup'),
  sectorStub('SAS5', 'Burn rate & runway (months)', 'P&L + BSheet',
    'Cash / monthly burn',
    'Computable from CF9 and bsCashBankTotal'),
  sectorStub('SAS6', 'Deferred revenue movement', 'BSheet + journal',
    'Deferred revenue as separate BS line',
    'Maintain deferred revenue ledger; pass monthly recognition journal'),
  sectorStub('SAS7', 'Net Revenue Retention (NRR)', 'DayBook (multi)',
    'Multi-period customer revenue comparison',
    'Upload 6+ months of DayBook'),
];

export const MIS_SECTOR_ADDONS: SectorAddOn[] = [
  { sector: 'Manufacturing', metrics: MFG },
  { sector: 'Trading', metrics: TRADING },
  { sector: 'Services', metrics: SERVICES },
  { sector: 'Retail', metrics: RETAIL },
  { sector: 'Construction', metrics: CONSTRUCTION },
  { sector: 'Financial Services', metrics: FINANCIAL },
  { sector: 'Hospitality', metrics: HOSPITALITY },
  { sector: 'IT/SaaS', metrics: SAAS },
];

export function sectorMetricsFor(sector: string | null | undefined): MetricDef[] {
  if (!sector) return [];
  return MIS_SECTOR_ADDONS.find(s => s.sector === sector)?.metrics ?? [];
}
