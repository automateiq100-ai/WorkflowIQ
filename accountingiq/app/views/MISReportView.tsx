'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import type { MISSector } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────
type MetricStatus = 'auto' | 'partial' | 'manual' | 'new-xml';

interface MISMetric {
  id: string;
  label: string;
  status: MetricStatus;
  source: string;
  caveat?: string;
  remediation: string;
}

interface MISDomain {
  id: string;
  label: string;
  metrics: MISMetric[];
}

// ── MIS Domains & Metrics (from Layer 2 spec) ───────────────────────────
const MIS_DOMAINS: MISDomain[] = [
  {
    id: 'D1', label: 'Profitability & P&L',
    metrics: [
      { id: 'P1', label: 'Total revenue (net of GST)', status: 'auto', source: 'P&L', remediation: 'Computable from uploaded XMLs' },
      { id: 'P2', label: 'Revenue MoM growth rate', status: 'partial', source: 'P&L (2+ periods)', caveat: 'Needs 2+ months of P&L XMLs', remediation: 'Upload P&L XMLs for at least 2 months' },
      { id: 'P3', label: 'Revenue vs budget variance', status: 'manual', source: 'Budget upload', remediation: 'Upload budget Excel or enter figures in Setup' },
      { id: 'P4', label: 'Revenue by segment / product', status: 'auto', source: 'DayBook', remediation: 'Computable from uploaded XMLs' },
      { id: 'P5', label: 'Gross profit & gross margin %', status: 'auto', source: 'P&L', remediation: 'Computable from uploaded XMLs' },
      { id: 'P6', label: 'EBITDA & EBITDA margin %', status: 'auto', source: 'P&L', caveat: 'Interest & depreciation must be separate P&L lines', remediation: 'Ensure depreciation & interest are separate ledgers in Tally' },
      { id: 'P7', label: 'Net profit (PAT) & PAT margin %', status: 'auto', source: 'P&L', remediation: 'Computable from uploaded XMLs' },
      { id: 'P8', label: 'Contribution margin per product', status: 'partial', source: 'P&L + DayBook', caveat: 'Variable cost split not always explicit in Tally', remediation: 'Configure cost centres for variable vs fixed cost in Tally' },
      { id: 'P9', label: '12-month P&L trend (rolling)', status: 'partial', source: 'P&L (multi)', caveat: 'Needs up to 12 months of P&L XMLs', remediation: 'Upload P&L XMLs for each month in the period grid' },
      { id: 'P10', label: 'Prior year same period comparison', status: 'partial', source: 'P&L (multi)', caveat: 'Upload last year\'s P&L XML as prior period', remediation: 'Upload last year\'s P&L XML in the period upload grid' },
    ]
  },
  {
    id: 'D2', label: 'Cash Flow',
    metrics: [
      { id: 'CF1', label: 'Opening vs closing bank + cash balance', status: 'auto', source: 'DayBook + BSheet', remediation: 'Computable from uploaded XMLs' },
      { id: 'CF2', label: 'Net cash movement for the month', status: 'auto', source: 'DayBook', remediation: 'Computable from uploaded XMLs' },
      { id: 'CF3', label: 'Bank-wise balance breakup', status: 'auto', source: 'DayBook', caveat: 'Each bank must be a separate ledger in Tally', remediation: 'Create separate ledgers per bank in Tally' },
      { id: 'CF4', label: 'Operating cash flow (OCF)', status: 'auto', source: 'P&L + BSheet', remediation: 'Computable from uploaded XMLs' },
      { id: 'CF5', label: 'Investing cash flow', status: 'partial', source: 'BSheet + DayBook', caveat: 'Capex must be tagged to fixed asset ledgers', remediation: 'Tag all capital purchases to fixed asset ledger groups' },
      { id: 'CF6', label: 'Financing cash flow', status: 'partial', source: 'BSheet + DayBook', caveat: 'Loan accounts must be separate ledgers', remediation: 'Create separate ledgers per loan in Tally' },
      { id: 'CF7', label: 'Free cash flow (FCF = OCF − Capex)', status: 'auto', source: 'P&L + BSheet', remediation: 'Computable from uploaded XMLs' },
      { id: 'CF8', label: '13-week cash flow forecast baseline', status: 'partial', source: 'DayBook + Bills', caveat: 'Auto-baseline from past patterns; new orders need manual input', remediation: 'Upload Bills.xml and enter upcoming orders in Setup' },
      { id: 'CF9', label: 'Cash burn rate (fixed cost base / month)', status: 'auto', source: 'P&L', remediation: 'Computable from uploaded XMLs' },
      { id: 'CF10', label: 'Upcoming committed outflows (30/60/90d)', status: 'partial', source: 'DayBook + Bills', caveat: 'Recurring entries auto-detected; ad hoc needs Bills.xml', remediation: 'Upload Bills.xml for payables schedule' },
    ]
  },
  {
    id: 'D3', label: 'Working Capital',
    metrics: [
      { id: 'WC1', label: 'Debtor aging: 0–30 / 31–60 / 61–90 / 90+ days', status: 'new-xml', source: 'Bills.xml', remediation: 'Export Bills.xml from Tally: Outstanding → Bills Outstanding → Alt+E' },
      { id: 'WC2', label: 'Days Sales Outstanding (DSO)', status: 'auto', source: 'BSheet + P&L', remediation: 'Computable from uploaded XMLs' },
      { id: 'WC3', label: 'Top 10 debtors by outstanding amount', status: 'partial', source: 'DayBook + Bills', caveat: 'Bills.xml gives exact aging; DayBook gives balances only', remediation: 'Upload Bills.xml for precise debtor aging' },
      { id: 'WC4', label: 'Overdue debtors > 90 days as % of total', status: 'new-xml', source: 'Bills.xml', remediation: 'Export Bills.xml from Tally' },
      { id: 'WC5', label: 'Collection efficiency %', status: 'auto', source: 'DayBook', remediation: 'Computable from uploaded XMLs' },
      { id: 'WC6', label: 'Creditor aging: 0–30 / 31–60 / 61–90 / 90+ days', status: 'new-xml', source: 'Bills.xml', remediation: 'Export Bills.xml from Tally' },
      { id: 'WC7', label: 'Days Payable Outstanding (DPO)', status: 'auto', source: 'BSheet + P&L', remediation: 'Computable from uploaded XMLs' },
      { id: 'WC8', label: 'MSME supplier payments > 45 days', status: 'new-xml', source: 'Bills.xml', remediation: 'Upload Bills.xml and tag MSME vendors in Tally' },
      { id: 'WC9', label: 'Top 10 creditors by outstanding', status: 'partial', source: 'DayBook + Bills', remediation: 'Upload Bills.xml for precise creditor aging' },
      { id: 'WC10', label: 'Inventory days (DIO)', status: 'auto', source: 'BSheet + P&L', caveat: 'Closing stock must be entered in Tally', remediation: 'Enter closing stock value in Tally stock ledgers' },
      { id: 'WC11', label: 'Slow / non-moving stock (60/90/180 days)', status: 'partial', source: 'DayBook', remediation: 'Enable stock movement tracking in Tally via stock items' },
      { id: 'WC12', label: 'Cash conversion cycle (DSO + DIO − DPO)', status: 'auto', source: 'Computed', remediation: 'Computable from uploaded XMLs' },
    ]
  },
  {
    id: 'D4', label: 'Statutory & Compliance',
    metrics: [
      { id: 'SC1', label: 'Output GST liability (CGST / SGST / IGST)', status: 'auto', source: 'TrialBal', remediation: 'Computable from uploaded XMLs' },
      { id: 'SC2', label: 'Input ITC available vs utilised', status: 'auto', source: 'TrialBal', remediation: 'Computable from uploaded XMLs' },
      { id: 'SC3', label: 'Net GST payable (Output − ITC)', status: 'auto', source: 'TrialBal', remediation: 'Computable from uploaded XMLs' },
      { id: 'SC4', label: 'TDS deducted section-wise (194C / 194J…)', status: 'auto', source: 'DayBook + TrialBal', caveat: 'TDS ledgers must be named by section in Tally', remediation: 'Rename TDS ledgers to include section number (e.g. TDS 194C)' },
      { id: 'SC5', label: 'TDS deposited vs due (by 7th of month)', status: 'partial', source: 'DayBook', caveat: 'Deposit vouchers must be tagged to challan ledger', remediation: 'Tag TDS deposit vouchers to a dedicated challan ledger' },
      { id: 'SC6', label: 'Advance tax paid vs liability estimate', status: 'partial', source: 'DayBook', remediation: 'Enter advance tax payment vouchers in Tally' },
      { id: 'SC7', label: 'PF / ESI deducted and deposited', status: 'auto', source: 'DayBook', caveat: 'PF/ESI ledgers must be correctly named', remediation: 'Name ledgers with "PF" or "ESI" keywords in Tally' },
      { id: 'SC8', label: 'Professional Tax deducted & deposited', status: 'partial', source: 'DayBook', remediation: 'Create consistent Professional Tax ledger naming' },
    ]
  },
  {
    id: 'D5', label: 'Balance Sheet Health',
    metrics: [
      { id: 'BS1', label: 'Current ratio', status: 'auto', source: 'BSheet', remediation: 'Computable from uploaded XMLs' },
      { id: 'BS2', label: 'Quick ratio (acid test)', status: 'auto', source: 'BSheet', caveat: 'Inventory must be a separate BS line', remediation: 'Ensure stock is a separate BS group in Tally' },
      { id: 'BS3', label: 'Cash ratio', status: 'auto', source: 'BSheet', remediation: 'Computable from uploaded XMLs' },
      { id: 'BS4', label: 'Debt-equity ratio', status: 'auto', source: 'BSheet', caveat: 'All loan accounts must be under Loans & Liabilities', remediation: 'Ensure all loans are grouped under "Loans (Liabilities)" in Tally' },
      { id: 'BS5', label: 'Interest coverage ratio', status: 'auto', source: 'P&L + BSheet', caveat: 'Interest expense must be separate P&L line', remediation: 'Create a dedicated Interest Expense ledger in Tally' },
      { id: 'BS6', label: 'Net worth movement (period vs prior)', status: 'partial', source: 'BSheet (multi)', remediation: 'Upload prior period Balance Sheet XML' },
      { id: 'BS7', label: 'Term loan drawing power vs limit', status: 'manual', source: 'Manual', remediation: 'Enter loan sanction limit in Setup screen' },
      { id: 'BS8', label: 'Fixed asset additions this month', status: 'auto', source: 'BSheet + DayBook', remediation: 'Computable from uploaded XMLs' },
      { id: 'BS9', label: 'Depreciation charged this month', status: 'auto', source: 'P&L', caveat: 'Depreciation must be a separate P&L line', remediation: 'Create a dedicated Depreciation ledger in Tally' },
      { id: 'BS10', label: 'Investments on BS (type + value)', status: 'auto', source: 'BSheet', remediation: 'Computable from uploaded XMLs' },
    ]
  },
  {
    id: 'D6', label: 'Cost Analysis',
    metrics: [
      { id: 'CA1', label: 'Cost as % of revenue — every P&L line', status: 'auto', source: 'P&L', remediation: 'Computable from uploaded XMLs' },
      { id: 'CA2', label: 'Fixed vs variable cost split', status: 'partial', source: 'P&L', caveat: 'Fixed/variable tagging needs cost centre config in Tally', remediation: 'Configure cost centres in Tally for fixed vs variable costs' },
      { id: 'CA3', label: 'Break-even revenue', status: 'partial', source: 'P&L', remediation: 'Requires fixed/variable cost split (see CA2)' },
      { id: 'CA4', label: 'Operating leverage', status: 'partial', source: 'P&L (multi)', remediation: 'Upload 2+ months of P&L XMLs' },
      { id: 'CA5', label: 'Departmental cost breakdowns', status: 'partial', source: 'DayBook', caveat: 'Cost centres must be configured in Tally', remediation: 'Enable cost centres in Tally and tag expenses to departments' },
      { id: 'CA6', label: 'Employee cost per head', status: 'partial', source: 'DayBook', remediation: 'Enter headcount in Setup; cost extracted from DayBook salary ledger' },
      { id: 'CA7', label: 'Cost per unit produced / delivered', status: 'manual', source: 'Manual', remediation: 'Enter production quantity in Setup screen' },
      { id: 'CA8', label: 'Budget vs actual for every cost head', status: 'manual', source: 'Budget upload', remediation: 'Upload budget Excel file in Setup' },
      { id: 'CA9', label: 'MoM cost movement by line', status: 'partial', source: 'P&L (multi)', remediation: 'Upload 2+ months of P&L XMLs' },
      { id: 'CA10', label: 'One-time / non-recurring items isolated', status: 'partial', source: 'DayBook', remediation: 'Flag non-recurring vouchers in the Setup screen' },
    ]
  },
  {
    id: 'D7', label: 'Business Performance Indicators',
    metrics: [
      { id: 'BPI1', label: 'Sales by customer — top 10 & concentration %', status: 'auto', source: 'DayBook', remediation: 'Computable from uploaded XMLs' },
      { id: 'BPI2', label: 'Sales by product / SKU', status: 'auto', source: 'DayBook', caveat: 'Stock items must be used in sales vouchers', remediation: 'Use stock items in Tally sales vouchers' },
      { id: 'BPI3', label: 'New vs repeat customer revenue split', status: 'partial', source: 'DayBook (multi)', remediation: 'Upload multiple periods; first-time customer detection based on history' },
      { id: 'BPI4', label: 'Sales by channel / geography', status: 'partial', source: 'DayBook', caveat: 'Channel tagging needs cost centre / godown in Tally', remediation: 'Configure godowns or cost centres per channel in Tally' },
      { id: 'BPI5', label: 'Average transaction value (ATV) trend', status: 'auto', source: 'DayBook', remediation: 'Computable from uploaded XMLs' },
      { id: 'BPI6', label: 'Order book / pipeline value', status: 'manual', source: 'Manual', remediation: 'Enter order book value in Setup screen' },
      { id: 'BPI7', label: 'Sales return / rejection rate', status: 'auto', source: 'DayBook', remediation: 'Computable from uploaded XMLs (credit note vouchers)' },
      { id: 'BPI8', label: 'Vendor concentration — top 3 as %', status: 'auto', source: 'DayBook', remediation: 'Computable from uploaded XMLs' },
      { id: 'BPI9', label: 'On-time payment receipt rate', status: 'partial', source: 'Bills + DayBook', remediation: 'Upload Bills.xml for credit terms vs actual receipt dates' },
      { id: 'BPI10', label: 'DSCR — debt service coverage ratio', status: 'auto', source: 'P&L + BSheet', caveat: 'Loan repayment schedule must be in DayBook', remediation: 'Enter loan repayment as a recurring entry in DayBook' },
      { id: 'BPI11', label: 'Revenue & EBITDA vs loan covenants', status: 'manual', source: 'Manual', remediation: 'Enter covenant thresholds from loan agreement in Setup' },
      { id: 'BPI12', label: 'Promoter / related-party transactions', status: 'partial', source: 'DayBook', caveat: 'Related party ledgers must be tagged in Tally', remediation: 'Create a "Related Party" group in Tally and move those ledgers' },
      { id: 'BPI13', label: 'Contingent liabilities', status: 'manual', source: 'Manual', remediation: 'Disclose in Setup screen — no XML source' },
    ]
  },
];

// ── Book Closure Checklist ─────────────────────────────────────────────
const BOOK_CLOSURE = [
  {
    phase: 'Phase 1: Revenue & Sales Entries',
    deadline: 'Deadline: 3rd of next month',
    items: [
      { id: 'BC1_1', text: 'All sales invoices for the month entered in Tally', critical: true, type: 'Manual' },
      { id: 'BC1_2', text: 'All credit notes / sales returns entered', critical: false, type: 'Manual' },
      { id: 'BC1_3', text: 'Advance receipts correctly classified (not booked as revenue)', critical: true, type: 'Manual' },
      { id: 'BC1_4', text: 'Deferred / unbilled revenue accrued (subscriptions, AMC, projects)', critical: false, type: 'Manual' },
    ]
  },
  {
    phase: 'Phase 2: Purchase & Expense Entries',
    deadline: 'Deadline: 5th of next month',
    items: [
      { id: 'BC2_1', text: 'All purchase invoices for the month entered', critical: false, type: 'Manual' },
      { id: 'BC2_2', text: 'All expense vouchers / petty cash entered', critical: false, type: 'Manual' },
      { id: 'BC2_3', text: 'Prepaid expenses correctly split (only current month portion expensed)', critical: true, type: 'Manual' },
      { id: 'BC2_4', text: 'Accrued expenses / provisions entered via journal (salary payable, electricity etc.)', critical: false, type: 'Manual' },
      { id: 'BC2_5', text: 'Purchase returns / debit notes entered', critical: false, type: 'Manual' },
    ]
  },
  {
    phase: 'Phase 3: Bank & Cash Reconciliation',
    deadline: 'Deadline: 5th of next month',
    items: [
      { id: 'BC3_1', text: 'Bank statement downloaded and reconciled with Tally', critical: true, type: 'Critical' },
      { id: 'BC3_2', text: 'Bank charges / interest entered from bank statement', critical: false, type: 'Manual' },
      { id: 'BC3_3', text: 'Cheques issued but not yet presented identified (timing difference)', critical: false, type: 'Auto-verify' },
      { id: 'BC3_4', text: 'Cash in hand physically counted and matched with Tally balance', critical: false, type: 'Manual' },
      { id: 'BC3_5', text: 'Inter-bank transfers correctly entered (not double-counted)', critical: false, type: 'Auto-verify' },
    ]
  },
  {
    phase: 'Phase 4: Statutory Entries',
    deadline: 'Deadline: 7th of next month',
    items: [
      { id: 'BC4_1', text: 'GST liability journal entries passed (output GST, ITC reversal if applicable)', critical: true, type: 'Critical' },
      { id: 'BC4_2', text: 'TDS deducted and TDS payable ledger updated (by section)', critical: false, type: 'Manual' },
      { id: 'BC4_3', text: 'PF / ESI payable entry passed (employee + employer contribution)', critical: false, type: 'Manual' },
      { id: 'BC4_4', text: 'Advance tax liability estimated and provided for', critical: false, type: 'Manual' },
    ]
  },
  {
    phase: 'Phase 5: Period-end Adjustments',
    deadline: 'Deadline: 7th of next month',
    items: [
      { id: 'BC5_1', text: 'Depreciation for the month charged (from fixed assets register)', critical: true, type: 'Critical' },
      { id: 'BC5_2', text: 'Closing stock value updated (physical / system count, valued at cost)', critical: true, type: 'Critical' },
      { id: 'BC5_3', text: 'Salary payable journal passed if salary not yet paid', critical: false, type: 'Manual' },
      { id: 'BC5_4', text: 'Interest accrued on loans (if not auto-debited)', critical: false, type: 'Manual' },
      { id: 'BC5_5', text: 'Foreign exchange revaluation (if forex debtors / creditors exist)', critical: false, type: 'Manual' },
      { id: 'BC5_6', text: 'Related party transactions verified and documented', critical: false, type: 'Manual' },
    ]
  },
  {
    phase: 'Phase 6: AccountingIQ Validation Gates',
    deadline: 'Auto-checked on upload',
    items: [
      { id: 'BC6_2', text: 'No Suspense ledger balances outstanding → Check B1', critical: true, type: 'Auto-verify' },
      { id: 'BC6_3', text: 'P&L net profit = Balance Sheet retained earnings → Check D2', critical: true, type: 'Auto-verify' },
      { id: 'BC6_5', text: 'AccountingIQ Step 1 score ≥ 50 (below 50 = books too unreliable for MIS)', critical: true, type: 'Auto-verify' },
    ]
  },
];

const SECTORS: MISSector[] = ['Manufacturing', 'Trading', 'Services', 'Retail', 'Construction', 'Financial Services', 'Hospitality', 'IT/SaaS'];
const STATUS_WEIGHT: Record<MetricStatus, number> = { auto: 1.0, partial: 0.6, manual: 0, 'new-xml': 0 };
const STATUS_COLORS: Record<MetricStatus, string> = {
  auto: 'var(--green)',
  partial: 'var(--amber)',
  manual: 'var(--coral)',
  'new-xml': 'var(--red)',
};
const STATUS_BG: Record<MetricStatus, string> = {
  auto:      'rgba(76,175,121,0.12)',
  partial:   'rgba(245,166,35,0.12)',
  manual:    'rgba(242,107,91,0.12)',
  'new-xml': 'rgba(240,72,72,0.12)',
};
const STATUS_LABELS: Record<MetricStatus, string> = {
  auto:      '✅ Auto',
  partial:   '🟡 Partial',
  manual:    '✏  Manual',
  'new-xml': '📎 New XML',
};

import MISDashboardTab from './MISDashboardTab';

type MISTab = 'dashboard' | 'setup' | 'score' | 'checklist';

export default function MISReportView() {
  const { state, dispatch } = useApp();
  const { results, misSetup } = state;

  const [activeTab, setActiveTab] = useState<MISTab>('dashboard');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  const allMetricIds = MIS_DOMAINS.flatMap(d => d.metrics.map(m => m.id));

  // Initialize selected metrics if empty
  const selectedIds = misSetup.selectedMetricIds.length > 0
    ? misSetup.selectedMetricIds
    : allMetricIds;

  const l1Score = results?.cappedScore ?? 0;

  // MIS Score calculation
  const selectedMetrics = MIS_DOMAINS.flatMap(d =>
    d.metrics.filter(m => selectedIds.includes(m.id))
  );

  const computable = selectedMetrics.reduce((s, m) => s + STATUS_WEIGHT[m.status], 0);
  const readinessPct = selectedMetrics.length > 0 ? computable / selectedMetrics.length : 0;
  const misScore = Math.round(l1Score * readinessPct);
  const potentialScore = l1Score;

  const gapMetrics = selectedMetrics
    .filter(m => m.status !== 'auto')
    .sort((a, b) => STATUS_WEIGHT[b.status] - STATUS_WEIGHT[a.status]);

  const toggleMetric = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { selectedMetricIds: next } });
  };

  const toggleCheck = (id: string) => {
    setCheckedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const totalChecks = BOOK_CLOSURE.flatMap(p => p.items).length;
  const completedChecks = Object.values(checkedItems).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div
        className="flex items-center border-b px-6 shrink-0"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        {([['dashboard', 'Dashboard'], ['score', 'MIS Score'], ['setup', 'Setup'], ['checklist', 'Book Closure Checklist']] as [MISTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
            style={{
              borderColor: activeTab === id ? 'var(--teal)' : 'transparent',
              color: activeTab === id ? 'var(--teal)' : 'var(--text2)',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* ── Dashboard Tab ── */}
        {activeTab === 'dashboard' && <MISDashboardTab />}

        {/* ── Setup Tab ── */}
        {activeTab === 'setup' && (
          <div className="max-w-3xl mx-auto animate-fade-in">
            <div className="mb-6">
              <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
                MIS Setup
              </h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                Configure your business sector and select the metrics relevant to your organization.
              </p>
            </div>

            {!results && (
              <div
                className="mb-6 px-4 py-3 rounded-lg border text-sm"
                style={{ background: 'rgba(74,158,255,0.08)', borderColor: 'rgba(74,158,255,0.25)', color: 'var(--blue)' }}
              >
                ℹ Upload and analyse your Tally files in the <strong>Account Health</strong> module first to enable MIS scoring.
              </div>
            )}

            {/* Sector */}
            <div className="rounded-xl border p-5 mb-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text1)' }}>Primary Business Sector</div>
              <div className="grid grid-cols-4 gap-2">
                {SECTORS.map(s => (
                  <button
                    key={s}
                    onClick={() => dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { sector: s } })}
                    className="px-3 py-2 rounded-lg text-xs text-center border transition-all"
                    style={{
                      background: misSetup.sector === s ? 'rgba(15,212,160,0.12)' : 'var(--bg3)',
                      borderColor: misSetup.sector === s ? 'var(--teal)' : 'var(--border)',
                      color: misSetup.sector === s ? 'var(--teal)' : 'var(--text2)',
                      fontWeight: misSetup.sector === s ? 600 : 400,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Budget */}
            <div className="rounded-xl border p-5 mb-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>Budget Figures Available?</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>Enables budget vs actual variance metrics</div>
                </div>
                <button
                  onClick={() => dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { hasBudget: !misSetup.hasBudget } })}
                  className="w-12 h-6 rounded-full relative transition-all"
                  style={{ background: misSetup.hasBudget ? 'var(--teal)' : 'var(--bg4)', border: `2px solid ${misSetup.hasBudget ? 'var(--teal)' : 'var(--border)'}` }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                    style={{ left: misSetup.hasBudget ? 'calc(100% - 18px)' : '2px' }}
                  />
                </button>
              </div>
            </div>

            {/* Metric selection */}
            <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
              <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>
                  Select Relevant Metrics
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text3)' }}>
                    {selectedIds.length} / {allMetricIds.length} selected
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { selectedMetricIds: allMetricIds } })}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--border)', color: 'var(--teal)' }}
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { selectedMetricIds: [] } })}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {MIS_DOMAINS.map(domain => (
                <div key={domain.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="px-5 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--bg3)', color: 'var(--text3)' }}>
                    {domain.label}
                  </div>
                  {domain.metrics.map(m => (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-2.5 border-b" style={{ borderColor: 'var(--bg3)' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(m.id)}
                        onChange={() => toggleMetric(m.id)}
                        className="shrink-0"
                        style={{ accentColor: 'var(--teal)' }}
                      />
                      <div className="flex-1 text-xs" style={{ color: 'var(--text1)' }}>{m.label}</div>
                      <span
                        className="shrink-0 text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: STATUS_BG[m.status], color: STATUS_COLORS[m.status] }}
                      >
                        {STATUS_LABELS[m.status]}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MIS Score Tab ── */}
        {activeTab === 'score' && (
          <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
              <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
                MIS Readiness Score
              </h1>
            </div>

            {!results && (
              <div
                className="px-4 py-4 rounded-xl border text-sm text-center"
                style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text3)' }}
              >
                Complete your accounting analysis first. Go to <strong style={{ color: 'var(--text2)' }}>Account Health → Upload Files</strong>.
              </div>
            )}

            {results && (
              <>
                {/* Score cards */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="rounded-xl border p-5 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                    <div className="text-4xl font-bold mb-1" style={{ color: 'var(--teal)' }}>{misScore}</div>
                    <div className="text-xs" style={{ color: 'var(--text3)' }}>MIS Score</div>
                    <div className="text-xs mt-2" style={{ color: 'var(--text2)' }}>Books: {l1Score} · Readiness: {Math.round(readinessPct * 100)}%</div>
                  </div>
                  <div className="rounded-xl border p-5 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                    <div className="text-4xl font-bold mb-1" style={{ color: 'var(--blue)' }}>{potentialScore}</div>
                    <div className="text-xs" style={{ color: 'var(--text3)' }}>Potential Score</div>
                    <div className="text-xs mt-2" style={{ color: 'var(--text2)' }}>If all missing data is provided</div>
                  </div>
                  <div className="rounded-xl border p-5 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                    <div className="text-4xl font-bold mb-1" style={{ color: 'var(--amber)' }}>{gapMetrics.length}</div>
                    <div className="text-xs" style={{ color: 'var(--text3)' }}>Gaps to Fill</div>
                    <div className="text-xs mt-2" style={{ color: 'var(--text2)' }}>Manual or missing XML metrics</div>
                  </div>
                </div>

                {l1Score < 50 && (
                  <div
                    className="mb-5 px-4 py-3 rounded-lg border text-sm"
                    style={{ background: 'rgba(240,72,72,0.08)', borderColor: 'rgba(240,72,72,0.3)', color: 'var(--red)' }}
                  >
                    ⚠ Accounting health score is below 50. MIS can still be generated but reliability may be limited. Fix critical issues first.
                  </div>
                )}

                {/* Domain breakdown */}
                <div className="rounded-xl border overflow-hidden mb-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                  <div className="px-5 py-3 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
                    Domain–wise Readiness
                  </div>
                  {MIS_DOMAINS.map(domain => {
                    const domainSelected = domain.metrics.filter(m => selectedIds.includes(m.id));
                    const domainComputable = domainSelected.reduce((s, m) => s + STATUS_WEIGHT[m.status], 0);
                    const domainReadiness = domainSelected.length > 0 ? domainComputable / domainSelected.length : 0;
                    const autoCount = domainSelected.filter(m => m.status === 'auto').length;
                    const partialCount = domainSelected.filter(m => m.status === 'partial').length;
                    const gapCount = domainSelected.filter(m => m.status === 'manual' || m.status === 'new-xml').length;
                    return (
                      <div key={domain.id} className="flex items-center gap-4 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                        <div className="w-40 shrink-0">
                          <div className="text-xs font-medium" style={{ color: 'var(--text1)' }}>{domain.label}</div>
                          <div className="text-xs" style={{ color: 'var(--text3)' }}>
                            {autoCount} auto · {partialCount} partial · {gapCount} gap
                          </div>
                        </div>
                        <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--bg4)' }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${domainReadiness * 100}%`,
                              background: domainReadiness > 0.8 ? 'var(--green)' : domainReadiness > 0.5 ? 'var(--amber)' : 'var(--red)',
                            }}
                          />
                        </div>
                        <div className="w-10 text-right text-sm font-medium shrink-0" style={{ color: 'var(--text1)' }}>
                          {Math.round(domainReadiness * 100)}%
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Gap list */}
                {gapMetrics.length > 0 && (
                  <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                    <div className="px-5 py-3 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
                      Gap Analysis — Actions to Improve Score
                    </div>
                    {gapMetrics.map(m => (
                      <div key={m.id} className="flex items-start gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                        <span
                          className="shrink-0 text-xs px-1.5 py-0.5 rounded mt-0.5 font-medium"
                          style={{ background: STATUS_BG[m.status], color: STATUS_COLORS[m.status] }}
                        >
                          {STATUS_LABELS[m.status]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium" style={{ color: 'var(--text1)' }}>{m.label}</div>
                          {m.caveat && <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{m.caveat}</div>}
                          <div className="text-xs mt-1" style={{ color: 'var(--teal)' }}>→ {m.remediation}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Book Closure Checklist Tab ── */}
        {activeTab === 'checklist' && (
          <div className="max-w-3xl mx-auto animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
                  Book Closure Checklist
                </h1>
                <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                  {completedChecks} / {totalChecks} completed
                </p>
              </div>
              <button
                onClick={() => window.print()}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
              >
                🖨 Print
              </button>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 rounded-full mb-6" style={{ background: 'var(--bg4)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(completedChecks / totalChecks) * 100}%`, background: 'var(--teal)' }}
              />
            </div>

            <div className="space-y-4">
              {BOOK_CLOSURE.map(phase => (
                <div key={phase.phase} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
                  <div
                    className="px-5 py-3 border-b flex items-center justify-between"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}
                  >
                    <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{phase.phase}</div>
                    <div className="text-xs" style={{ color: 'var(--text3)' }}>{phase.deadline}</div>
                  </div>
                  {phase.items.map(item => (
                    <label
                      key={item.id}
                      className="flex items-start gap-3 px-5 py-3 border-b cursor-pointer transition-colors"
                      style={{
                        borderColor: 'var(--border)',
                        background: checkedItems[item.id] ? 'rgba(76,175,121,0.05)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!checkedItems[item.id]}
                        onChange={() => toggleCheck(item.id)}
                        className="mt-0.5 shrink-0"
                        style={{ accentColor: 'var(--teal)' }}
                      />
                      <div className="flex-1">
                        <span
                          className="text-xs"
                          style={{
                            color: checkedItems[item.id] ? 'var(--text3)' : 'var(--text1)',
                            textDecoration: checkedItems[item.id] ? 'line-through' : 'none',
                          }}
                        >
                          {item.text}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: item.type === 'Auto-verify' ? 'rgba(76,175,121,0.12)' : item.critical ? 'rgba(240,72,72,0.12)' : 'var(--bg4)',
                              color: item.type === 'Auto-verify' ? 'var(--green)' : item.critical ? 'var(--red)' : 'var(--text3)',
                            }}
                          >
                            {item.type}
                          </span>
                          {item.critical && (
                            <span className="text-xs" style={{ color: 'var(--red)' }}>Critical</span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
