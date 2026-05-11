/**
 * Excel export for AccountingIQ analysis results.
 * Uses SheetJS (xlsx) for browser-compatible workbook generation.
 */

import * as XLSX from 'xlsx';
import type { AnalysisResults, ParsedData, ChunkedStats, Check, TBLedger, ParsedStatement, FinancialNode } from './types';
import { DIM_LABELS, DIM_WEIGHTS, getGrade } from './constants';
import { decodeEntities, parseAmt, xmlText } from './parser';
import { splitDupKey } from './voucher-filters';

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

const INR_NUM_FMT = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
type StatementSheetRow = [string, string | number | null, string | number | null];

function applyHeaderStyle(ws: XLSX.WorkSheet, range: XLSX.Range) {
  for (let col = range.s.c; col <= range.e.c; col++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = ws[addr];
    if (!cell) continue;
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F4E78' } },
      alignment: { horizontal: 'center' },
    };
  }
}

function setCurrencyFormat(ws: XLSX.WorkSheet, range: XLSX.Range, cols: number[]) {
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    for (const col of cols) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = INR_NUM_FMT;
    }
  }
}

function walkStatementRows(
  node: FinancialNode,
  depth: number,
  rows: StatementSheetRow[],
  rowMeta: Array<{ depth: number; isParent: boolean }>,
) {
  const isParent = node.children.length > 0 || node.nodeType === 'main';
  rows.push([
    `${depth > 0 ? '  '.repeat(depth) : ''}${node.name}`,
    isParent ? null : node.amount,
    isParent ? node.amount : null,
  ]);
  rowMeta.push({ depth, isParent });

  for (const child of node.children) {
    walkStatementRows(child, depth + 1, rows, rowMeta);
  }
}

interface ExpandedStatementRow {
  name: string;
  subAmount: number | null;
  mainAmount: number | null;
  depth: number;
  isParent: boolean;
}

function parseExpandedStatementRows(xml: string): ExpandedStatementRow[] {
  const rows: ExpandedStatementRow[] = [];
  let hasActiveParent = false;
  const tokenRe = /<DSPACCNAME\b[^>]*>([\s\S]*?)<\/DSPACCNAME>\s*<PLAMT\b[^>]*>([\s\S]*?)<\/PLAMT>|<BSNAME\b[^>]*>([\s\S]*?)<\/BSNAME>\s*<BSAMT\b[^>]*>([\s\S]*?)<\/BSAMT>/gi;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(xml)) !== null) {
    const nameBlock = m[1] ?? m[3] ?? '';
    const amountBlock = m[2] ?? m[4] ?? '';
    const name = decodeEntities(xmlText(nameBlock, 'DSPDISPNAME').trim());
    if (!name || name === 'undefined') continue;

    const subRaw = xmlText(amountBlock, m[2] ? 'PLSUBAMT' : 'BSSUBAMT');
    const mainRaw = xmlText(amountBlock, 'BSMAINAMT');
    const isChild = subRaw.trim() !== '';
    const isParent = !isChild;

    if (isParent) hasActiveParent = true;

    rows.push({
      name,
      subAmount: isChild ? parseAmt(subRaw) : null,
      mainAmount: isParent && mainRaw.trim() !== '' ? parseAmt(mainRaw) : null,
      depth: isChild && hasActiveParent ? 1 : 0,
      isParent,
    });
  }

  return rows;
}

function buildExpandedStatementSheet(xml: string, title: string): XLSX.WorkSheet {
  const parsedRows = parseExpandedStatementRows(xml);
  const rows: StatementSheetRow[] = [
    ['Particulars', 'Sub-Amount', 'Main Amount'],
    ...parsedRows.map(row => [
      `${row.depth > 0 ? '  '.repeat(row.depth) : ''}${row.name}`,
      row.subAmount,
      row.mainAmount,
    ] as [string, number | null, number | null]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:C1');
  ws['!cols'] = colWidths([46, 18, 18]);
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!outline'] = { above: false, left: false };
  ws['!rows'] = [{ level: 0 }, ...parsedRows.map(row => ({ level: row.depth }))];

  applyHeaderStyle(ws, range);
  setCurrencyFormat(ws, range, [1, 2]);

  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const meta = parsedRows[row - 1];
    const nameCell = ws[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (nameCell) {
      nameCell.s = {
        font: { bold: meta?.isParent ?? false },
        alignment: { indent: meta?.depth ?? 0 },
      };
    }
    if (meta?.isParent) {
      for (const col of [1, 2]) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell) cell.s = { ...(cell.s ?? {}), font: { bold: true } };
      }
    }
  }

  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!sheet'] = { name: title };
  return ws;
}

function buildDetailedStatementSheet(stmt: ParsedStatement, title: string): XLSX.WorkSheet {
  const rows: StatementSheetRow[] = [
    ['Particulars', 'Sub-Amount', 'Main Amount'],
  ];
  const rowMeta: Array<{ depth: number; isParent: boolean }> = [{ depth: 0, isParent: true }];

  for (const node of stmt.nodes) {
    walkStatementRows(node, 0, rows, rowMeta);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:C1');
  ws['!cols'] = colWidths([46, 18, 18]);
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!outline'] = { above: false, left: false };
  ws['!rows'] = rowMeta.map((meta, idx) => ({
    level: idx === 0 ? 0 : meta.depth,
    hidden: false,
  }));

  applyHeaderStyle(ws, range);
  setCurrencyFormat(ws, range, [1, 2]);

  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const meta = rowMeta[row];
    const nameCell = ws[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (nameCell) {
      nameCell.s = {
        font: { bold: meta?.isParent ?? false },
        alignment: { indent: meta?.depth ?? 0 },
      };
    }
    if (meta?.isParent) {
      for (const col of [1, 2]) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell) cell.s = { ...(cell.s ?? {}), font: { bold: true } };
      }
    }
  }

  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!sheet'] = { name: title };
  return ws;
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

  // Duplicate voucher numbers — keyed on `${type}${vno}` so cross-series
  // collisions (Sales/001 vs Receipt/001) don't get reported as dupes.
  const dupVnos = Object.entries(dbStats.dupVnoMap)
    .filter(([, c]) => c > 1)
    .map(([key, count]) => ({ ...splitDupKey(key), count }));
  if (dupVnos.length > 0) {
    rows.push([]);
    rows.push(['DUPLICATE VOUCHER NUMBERS']);
    rows.push(['Voucher Type', 'Voucher Number', 'Count']);
    for (const { type, vno, count } of dupVnos.slice(0, 50)) {
      rows.push([type || '(no type)', vno, count]);
    }
    if (dupVnos.length > 50) rows.push([`… and ${dupVnos.length - 50} more`, '', '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = colWidths([24, 28, 12]);
  return ws;
}

// ── Main export function ──────────────────────────────────────────────────

export function exportToExcel(params: {
  results: AnalysisResults;
  parsedData: Partial<ParsedData>;
  dbStats: ChunkedStats | null;
  companyName: string;
  periodLabel: string;
  sourceXml?: {
    pandl?: string | null;
    bsheet?: string | null;
  };
}): void {
  const { results, parsedData, dbStats, companyName, periodLabel, sourceXml } = params;
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

  if (sourceXml?.pandl) {
    XLSX.utils.book_append_sheet(wb, buildExpandedStatementSheet(sourceXml.pandl, 'Detailed P&L'), 'Detailed P&L');
  } else if (pd.pandlStatement?.nodes?.length) {
    XLSX.utils.book_append_sheet(wb, buildDetailedStatementSheet(pd.pandlStatement, 'Detailed P&L'), 'Detailed P&L');
  }

  if (sourceXml?.bsheet) {
    XLSX.utils.book_append_sheet(wb, buildExpandedStatementSheet(sourceXml.bsheet, 'Detailed Balance Sheet'), 'Detailed BS');
  } else if (pd.bsheetStatement?.nodes?.length) {
    XLSX.utils.book_append_sheet(wb, buildDetailedStatementSheet(pd.bsheetStatement, 'Detailed Balance Sheet'), 'Detailed BS');
  }

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
