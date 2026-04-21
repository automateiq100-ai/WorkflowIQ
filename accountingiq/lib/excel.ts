/**
 * Excel export for AccountingIQ analysis results.
 * Uses SheetJS (xlsx) for browser-compatible workbook generation.
 */

import * as XLSX from 'xlsx';
import type { AnalysisResults, ParsedData, ChunkedStats, Check, TBLedger } from './types';
import { DIM_LABELS, DIM_WEIGHTS, getGrade } from './constants';

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtAmt(n: number | undefined | null): number {
  return n ?? 0;
}

function fmtStatus(s: string): string {
  const map: Record<string, string> = {
    pass: '✓ Pass', partial: '~ Partial', fail: '✗ Fail',
    missing: '— Missing', uncertain: '? Uncertain', na: 'N/A',
  };
  return map[s] ?? s;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ── Column width helper ───────────────────────────────────────────────────

function colWidths(cols: number[]): { wch: number }[] {
  return cols.map(w => ({ wch: w }));
}

// ── Build sheets ─────────────────────────────────────────────────────────

function buildSummarySheet(
  results: AnalysisResults,
  companyName: string,
  periodLabel: string,
): XLSX.WorkSheet {
  const grade = getGrade(results.overall);
  const runDate = new Date(results.runAt).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const rows: (string | number)[][] = [
    ['AccountingIQ — Analysis Report'],
    [],
    ['Company',     companyName],
    ['Period',      periodLabel],
    ['Run date',    runDate],
    ['Overall score', results.overall],
    ['Grade',       grade.label],
    ['Score capped', results.scoreCapped ? 'Yes (DayBook missing)' : 'No'],
    [],
    ['DIMENSION SCORES'],
    ['Dimension', 'Name', 'Weight', 'Score (0–100)'],
  ];

  const dims = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
  for (const d of dims) {
    rows.push([d, DIM_LABELS[d], fmtPct(DIM_WEIGHTS[d]), results.dimScores[d]]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = colWidths([18, 32, 10, 16]);
  return ws;
}

function buildTrialBalanceSheet(tbLedgers: TBLedger[]): XLSX.WorkSheet {
  const sorted = [...tbLedgers].sort((a, b) => a.name.localeCompare(b.name));
  const rows: (string | number)[][] = [
    ['Trial Balance'],
    [],
    ['Ledger Name', 'Closing Balance (₹)', 'Dr / Cr'],
  ];

  const drTotal = sorted.filter(l => l.dr).reduce((s, l) => s + l.closing, 0);
  const crTotal = sorted.filter(l => !l.dr).reduce((s, l) => s + Math.abs(l.closing), 0);

  for (const l of sorted) {
    rows.push([l.name, fmtAmt(l.closing), l.dr ? 'Dr' : 'Cr']);
  }

  rows.push([]);
  rows.push(['Total Debit', drTotal, '']);
  rows.push(['Total Credit', crTotal, '']);
  rows.push(['Difference (TB Balance)', drTotal - crTotal, '']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = colWidths([45, 22, 10]);
  return ws;
}

function buildFinancialSheet(pd: Partial<ParsedData>): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [
    ['Financial Summary'],
    [],
    ['PROFIT & LOSS'],
    ['Item', 'Amount (₹)'],
    ['Revenue / Turnover', fmtAmt(pd.revenue)],
    ['Total Expenses', fmtAmt(pd.expenses)],
    ['Net Profit (P&L)', fmtAmt(pd.netProfit)],
    ['Net Profit (Balance Sheet)', pd.bsNetProfit ?? 'N/A'],
    ['Depreciation', fmtAmt(pd.depAmt)],
    ['Opening Stock', fmtAmt(pd.openingStock)],
    ['Closing Stock', fmtAmt(pd.closingStock)],
    [],
    ['BALANCE SHEET'],
    ['Item', 'Amount (₹)'],
    ['Fixed Assets', fmtAmt(pd.fixedAssets)],
    ['Current Assets', fmtAmt(pd.ca)],
    ['Debtors / Receivables', fmtAmt(pd.debtorBal)],
    ['Bank & Cash Balance', fmtAmt(pd.bankBal)],
    ['Current Liabilities', fmtAmt(pd.cl)],
    ['Creditors / Payables', fmtAmt(pd.creditorBal)],
    [],
    ['RATIOS'],
    ['Ratio', 'Value'],
    ['Current Ratio', (pd.ca && pd.cl) ? +(pd.ca / pd.cl).toFixed(2) : 'N/A'],
    ['Gross Profit Margin', (pd.revenue && pd.revenue > 0)
      ? fmtPct(((pd.netProfit ?? 0) / pd.revenue) * 100)
      : 'N/A'],
    [],
    ['STATUTORY FLAGS'],
    ['Item', 'Value'],
    ['GST Output Tax', fmtAmt(pd.outputGSTAmt)],
    ['GST Input ITC', fmtAmt(pd.inputITCAmt)],
    ['GST Difference %', pd.gstDiffPct != null ? fmtPct(pd.gstDiffPct) : 'N/A'],
    ['Suspense Ledgers', pd.suspenseCount ?? 0],
    ['Duplicate Ledger Pairs', pd.dupPairs ?? 0],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = colWidths([36, 22]);
  return ws;
}

function buildChecksSheet(checks: Check[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ['Analysis Checks — All 60 Checks'],
    [],
    ['Check ID', 'Dimension', 'Check Name', 'Status', 'Points Earned', 'Max Points', 'Score %', 'Notes'],
  ];

  for (const c of checks) {
    const pct = c.max > 0 ? fmtPct((c.pts / c.max) * 100) : 'N/A';
    const note = (c.status === 'fail' || c.status === 'partial') && c.failLabel
      ? c.failLabel
      : c.note;
    rows.push([c.id, c.dim, c.name, fmtStatus(c.status), c.pts, c.max, pct, note]);
  }

  // Summary row
  const totalPts = checks.reduce((s, c) => s + c.pts, 0);
  const totalMax = checks.reduce((s, c) => s + c.max, 0);
  rows.push([]);
  rows.push(['', '', 'TOTAL', '', totalPts, totalMax, fmtPct((totalPts / totalMax) * 100), '']);

  // Status counts
  const counts: Record<string, number> = {};
  for (const c of checks) counts[c.status] = (counts[c.status] ?? 0) + 1;
  rows.push([]);
  rows.push(['STATUS SUMMARY']);
  rows.push(['Status', 'Count']);
  for (const [status, count] of Object.entries(counts)) {
    rows.push([fmtStatus(status), count]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = colWidths([12, 12, 42, 14, 16, 14, 10, 60]);
  return ws;
}

function buildDayBookSheet(dbStats: ChunkedStats): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ['DayBook Statistics'],
    [],
    ['OVERVIEW'],
    ['Metric', 'Value'],
    ['Total Vouchers', dbStats.totalVouchers],
    ['Missing Voucher Numbers', dbStats.missingVno],
    ['Vouchers with Narration', dbStats.narrated],
    ['Narration %', dbStats.totalVouchers > 0
      ? fmtPct((dbStats.narrated / dbStats.totalVouchers) * 100) : 'N/A'],
    ['High Value Entries (>₹1L)', dbStats.highValueCount],
    ['High Value with Narration', dbStats.highValueNarrated],
    ['Zero Amount Vouchers', dbStats.zeroAmt],
    ['Journal Vouchers', dbStats.totalJournals],
    ['Cash Transactions >₹10k', dbStats.cashOver10k],
    ['Round Amount Vouchers', dbStats.roundCount],
    ['Vouchers Outside FY', dbStats.outOfFY],
  ];

  // Monthly breakdown
  if (dbStats.monthCounts && Object.keys(dbStats.monthCounts).length > 0) {
    rows.push([]);
    rows.push(['MONTHLY VOUCHER COUNTS']);
    rows.push(['Month', 'Voucher Count']);
    const months = Object.entries(dbStats.monthCounts).sort(([a], [b]) => a.localeCompare(b));
    for (const [month, count] of months) {
      rows.push([month, count]);
    }
  }

  // Duplicate voucher numbers
  const dupVnos = Object.entries(dbStats.dupVnoMap).filter(([, c]) => c > 1);
  if (dupVnos.length > 0) {
    rows.push([]);
    rows.push(['DUPLICATE VOUCHER NUMBERS']);
    rows.push(['Voucher Number', 'Count']);
    for (const [vno, count] of dupVnos.slice(0, 50)) {
      rows.push([vno, count]);
    }
    if (dupVnos.length > 50) rows.push([`… and ${dupVnos.length - 50} more`, '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = colWidths([36, 18]);
  return ws;
}

// ── Main export function ──────────────────────────────────────────────────

export function exportToExcel(params: {
  results: AnalysisResults;
  parsedData: Partial<ParsedData>;
  dbStats: ChunkedStats | null;
  companyName: string;
  periodLabel: string;
}): void {
  const { results, parsedData, dbStats, companyName, periodLabel } = params;
  const pd = parsedData as Partial<ParsedData>;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(results, companyName, periodLabel), 'Summary');

  // Sheet 2: Trial Balance (if available)
  if (pd.tbLedgers && pd.tbLedgers.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildTrialBalanceSheet(pd.tbLedgers), 'Trial Balance');
  }

  // Sheet 3: Financial Summary
  XLSX.utils.book_append_sheet(wb, buildFinancialSheet(pd), 'Financial Summary');

  // Sheet 4: Analysis Checks
  if (results.checks && results.checks.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildChecksSheet(results.checks), 'Analysis Checks');
  }

  // Sheet 5: DayBook Stats (if available)
  if (dbStats) {
    XLSX.utils.book_append_sheet(wb, buildDayBookSheet(dbStats), 'DayBook Stats');
  }

  // Generate filename
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 40);
  const fileName = `${safe(companyName)}_${safe(periodLabel)}_Analysis.xlsx`.replace(/\s+/g, '_');

  XLSX.writeFile(wb, fileName);
}
