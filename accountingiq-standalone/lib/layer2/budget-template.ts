/**
 * Budget Excel template — generation + parsing.
 *
 * The template ships with monthly columns (Apr–Mar, Indian FY) and the
 * standard P&L line items.  Users fill in numbers and re-upload.  The
 * parser reads any uploaded budget xlsx and produces a BudgetData object
 * representing the *current* (most recent) period's budget, plus a
 * future-friendly Record<string, BudgetData> keyed by period id for when
 * multi-period budgets are needed.
 */

import * as XLSX from 'xlsx';
import type { BudgetData } from './types';

const FY_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** Standard line items shown in the template.  Order is meaningful. */
export const BUDGET_LINES: Array<{ key: keyof Omit<BudgetData, 'customLines'>; label: string }> = [
  { key: 'revenue',      label: 'Revenue (net of GST)' },
  { key: 'cogs',         label: 'Cost of Goods Sold' },
  { key: 'employeeCost', label: 'Employee Cost' },
  { key: 'rent',         label: 'Rent & Utilities' },
  { key: 'marketing',    label: 'Marketing & Selling' },
  { key: 'admin',        label: 'Admin & Other Expenses' },
  { key: 'depreciation', label: 'Depreciation' },
  { key: 'interest',     label: 'Interest & Finance Costs' },
  { key: 'pat',          label: 'Net Profit (PAT)' },
];

// ── Template generation ─────────────────────────────────────────────────

/**
 * Build the budget Excel template as an XLSX Workbook.  The user downloads
 * it, fills in numbers per month per line, and re-uploads.  We accept the
 * same sheet structure on re-upload (see parseBudgetExcel below).
 */
export function buildBudgetTemplate(financialYear: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const header = ['Line Item', ...FY_MONTHS, 'Total'];
  const rows: (string | number | null)[][] = [
    [`Budget Template — FY ${financialYear}`, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Fill numbers in INR (absolute, not lakhs).  Leave blank for unknown lines.', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [],
    header,
  ];
  for (const line of BUDGET_LINES) {
    rows.push([line.label, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '']);
  }
  rows.push([]);
  rows.push(['How to use:', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['1. Enter your monthly budget per line.', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['2. Save the file and upload it back into AccountingIQ → MIS → Data Intake → Spreadsheets.', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['3. Add a row at the bottom for any custom line — use the same Line Item / month columns.', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 30 }, ...FY_MONTHS.map(() => ({ wch: 12 })), { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Budget');
  return wb;
}

/** Trigger a browser download for the template. */
export function downloadBudgetTemplate(financialYear: string = currentFY()): void {
  const wb = buildBudgetTemplate(financialYear);
  XLSX.writeFile(wb, `AccountingIQ_Budget_Template_FY${financialYear}.xlsx`);
}

// ── Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse an uploaded budget xlsx into BudgetData.  Tolerant of layout
 * variations — we look for label rows by case-insensitive matching against
 * BUDGET_LINES.  Anything we can't match goes into customLines so the
 * user can still drive budget-vs-actual on bespoke lines.
 */
export async function parseBudgetExcel(file: File): Promise<BudgetData> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('No sheets found in workbook');
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1 });

  const result: BudgetData = { customLines: {} };
  const labelToKey: Record<string, keyof BudgetData> = {};
  for (const line of BUDGET_LINES) labelToKey[line.label.toLowerCase()] = line.key;

  // Heuristic: each row's first cell is the line name; remaining cells are
  // monthly values.  We sum monthly values into a single annual figure
  // (the spec uses "Annual budget" as the comparison basis).
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const labelCell = row[0];
    if (typeof labelCell !== 'string') continue;
    const label = labelCell.trim();
    if (!label || label.startsWith('Budget Template') || label.startsWith('Line Item') || label.startsWith('How to use') || label.startsWith('Fill numbers') || label.startsWith('1.') || label.startsWith('2.') || label.startsWith('3.')) continue;

    // Sum the monthly numeric cells (columns 1..12).
    let total = 0;
    for (let i = 1; i <= 12; i++) {
      const v = row[i];
      if (typeof v === 'number' && isFinite(v)) total += v;
    }
    if (total === 0) continue;

    const matched = labelToKey[label.toLowerCase()];
    if (matched && matched !== 'customLines') {
      (result as Record<string, unknown>)[matched as string] = total;
    } else {
      result.customLines![label] = total;
    }
  }

  return result;
}

// ── FY helper ───────────────────────────────────────────────────────────

/** Current Indian FY (e.g. "2025-26" if today is April 2025 onward). */
export function currentFY(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1..12
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${(startYear + 1).toString().slice(2)}`;
}
