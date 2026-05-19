/**
 * MIS Report — Excel export (ExcelJS-based, with embedded charts).
 *
 * Produces an .xlsx that mirrors the in-app HTML report panel-by-panel:
 *
 *   Cover · Dashboard · P&L · Cash Flow · Balance Sheet · Working Capital ·
 *   Cost Analysis · BPI · Statutory · Forecast · Backup Working
 *
 * Each sheet uses:
 *   - section-coloured headers (teal/blue/amber/red/purple/coral matching the UI)
 *   - INR / % / × / days number formats
 *   - RAG conditional formatting on ratios (Balance Sheet)
 *   - in-cell data bars for breakdown lists (Top 10 customers/vendors, aging)
 *   - frozen header rows
 *   - chart images rendered via Chart.js → PNG at export time
 *
 * The exporter is async because chart rendering touches the DOM and
 * uses requestAnimationFrame to wait for paint.
 */

import ExcelJS from 'exceljs';
import type { Workbook, Worksheet, Row, Cell, FillPattern } from 'exceljs';
import type { MISRunOutput } from './runner';
import type { MISForecast } from './forecast';
import type { MetricResult, MetricBreakdownItem } from '../types';
import { ALL_MIS_METRICS } from './metrics';
import { DASHBOARD_KPI_METRICS } from './sections';
import { renderChartToPNG } from './chart-renderer';
import type { RuleViolation } from '../rules';
import type { SectionInsights } from './ai-insights';

/** Standard opts each `build*Sheet` receives — carries the company name,
 *  the period label, the rule violations to mention in the insights block,
 *  and any pre-fetched AI insights for this report. */
interface SheetOpts {
  company: string;
  period: string;
  violations: RuleViolation[];
  aiInsightsBySection?: Record<string, SectionInsights>;
}

// ── Units & number formats ──────────────────────────────────────────────

export type ReportUnit = 'absolute' | 'lakhs' | 'crores';

const UNIT_DIVISOR: Record<ReportUnit, number> = {
  absolute: 1, lakhs: 100_000, crores: 10_000_000,
};
const UNIT_LABEL: Record<ReportUnit, string> = {
  absolute: '', lakhs: ' L', crores: ' Cr',
};
function inrFormat(unit: ReportUnit): string {
  const suffix = UNIT_LABEL[unit] ? `" ${UNIT_LABEL[unit].trim()}"` : '';
  if (unit === 'absolute') {
    return `_("₹"* #,##0_);[Red]_("₹"* (#,##0);_("₹"* "—"_)`;
  }
  return `_("₹"* #,##0.00${suffix}_);[Red]_("₹"* (#,##0.00)${suffix};_("₹"* "—"_)`;
}
const PCT_FMT = '0.0%';
const RATIO_FMT = '0.00"×"';
const DAYS_FMT = '0" d"';

// ── Colour palette (hex, no #) — matches the in-app dashboard ───────────

const C = {
  teal:   '0FD4A0',
  tealBg: 'E1F5EE',
  blue:   '4A9EFF',
  blueBg: 'E6F1FB',
  amber:  'F5A623',
  amberBg:'FFFBEB',
  red:    'F04848',
  redBg:  'FEF2F2',
  green:  '4CAF79',
  greenBg:'F0FDF4',
  purple: '9B7FE8',
  purpleBg:'EEEDFE',
  coral:  'F26B5B',
  coralBg:'FAECE7',
  grey:   '6B7280',
  greyBg: 'F8FAFC',
  text:   '1F2937',
  border: 'E5E7EB',
};

const SECTION_COLORS: Record<string, { c: string; bg: string }> = {
  cover:     { c: C.teal,   bg: C.tealBg },
  dashboard: { c: C.teal,   bg: C.tealBg },
  pl:        { c: C.teal,   bg: C.tealBg },
  cf:        { c: C.blue,   bg: C.blueBg },
  bs:        { c: C.amber,  bg: C.amberBg },
  wc:        { c: C.coral,  bg: C.coralBg },
  cost:      { c: C.purple, bg: C.purpleBg },
  bpi:       { c: C.green,  bg: C.greenBg },
  statutory: { c: C.red,    bg: C.redBg },
  forecast:  { c: C.blue,   bg: C.blueBg },
  backup:    { c: C.grey,   bg: C.greyBg },
};

// ── Style helpers ───────────────────────────────────────────────────────

/**
 * Lighten a 6-char hex toward white by `t` (0 = unchanged, 1 = white).
 * Used to produce safe tint backgrounds — the previous approach of
 * concatenating `'15'` / `'20'` onto an already-formed colour produced
 * 10-character aRGB codes that Excel tolerated but other readers (and
 * openpyxl) rejected.
 */
function lighten(hex: string, t: number): string {
  const clean = hex.replace(/^#/, '').padStart(6, '0').slice(0, 6);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const tt = Math.max(0, Math.min(1, t));
  const lr = Math.round(r + (255 - r) * tt);
  const lg = Math.round(g + (255 - g) * tt);
  const lb = Math.round(b + (255 - b) * tt);
  return [lr, lg, lb].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function fillSolid(hex: string): FillPattern {
  // Defensive: callers historically concatenated alpha suffixes onto the
  // colour ('FF' + 'F5A623' + '20' = 'FFF5A62320', 10 chars).  Strip any
  // extra characters so the argb always lands as the canonical 8-char
  // 'FF' + 6-hex form Excel expects.
  const clean = hex.replace(/^#/, '').slice(0, 6).padStart(6, '0');
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + clean.toUpperCase() } };
}

/** Safe wrap-text alignment for long copy (notes, descriptions). */
function wrap(cell: Cell, align: 'left' | 'right' | 'center' = 'left'): void {
  cell.alignment = { vertical: 'top', horizontal: align, wrapText: true };
}

/** Set the coloured tab strip at the bottom of Excel sheets. */
function setTabColor(ws: Worksheet, hex: string): void {
  ws.properties.tabColor = { argb: 'FF' + hex.replace(/^#/, '').slice(0, 6).padStart(6, '0').toUpperCase() };
}

/** Standard print setup — landscape, fit to 1 page wide, with header / footer. */
function applyPrintSetup(ws: Worksheet, company: string, period: string): void {
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,                          // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = {
    oddHeader: `&L&"Calibri,Bold"&12 ${company}&C&"Calibri,Regular"&10 MIS Report — ${period}&R&"Calibri,Regular"&10 &P / &N`,
    oddFooter: `&L&"Calibri,Italic"&9 Generated by AccountingIQ · DPDPA 2023 compliant&R&"Calibri,Italic"&9 &D`,
  };
}

function applyBorder(cell: Cell): void {
  cell.border = {
    top:    { style: 'thin', color: { argb: 'FF' + C.border } },
    left:   { style: 'thin', color: { argb: 'FF' + C.border } },
    bottom: { style: 'thin', color: { argb: 'FF' + C.border } },
    right:  { style: 'thin', color: { argb: 'FF' + C.border } },
  };
}

/** Section title band — coloured fill, white text, large. */
function addSectionTitle(ws: Worksheet, rowIdx: number, title: string, section: string, colSpan: number): void {
  const palette = SECTION_COLORS[section];
  ws.mergeCells(rowIdx, 1, rowIdx, colSpan);
  const row = ws.getRow(rowIdx);
  row.height = 28;
  const cell = ws.getCell(rowIdx, 1);
  cell.value = title;
  cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  cell.fill = fillSolid(palette.c);
}

/** Table-header band — light fill, dark text. */
function applyTableHeader(row: Row, section: string): void {
  const palette = SECTION_COLORS[section];
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + C.text } };
    cell.fill = fillSolid(palette.bg);
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FF' + palette.c } },
      bottom: { style: 'thin', color: { argb: 'FF' + palette.c } },
    };
  });
}

function applyDataRow(row: Row, opts: { bold?: boolean; tint?: string; wrap?: boolean } = {}): void {
  row.height = opts.wrap ? 32 : 18;
  row.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: !!opts.bold, color: { argb: 'FF' + C.text } };
    cell.alignment = opts.wrap
      ? { vertical: 'top',    horizontal: 'left', wrapText: true }
      : { vertical: 'middle', horizontal: 'left' };
    if (opts.tint) cell.fill = fillSolid(opts.tint);
    applyBorder(cell);
  });
}

// ── Observations & Fix Plan block ───────────────────────────────────────

/**
 * Append an "Observations" block + a "Fix Plan" block to the bottom of a
 * sheet.  Built purely from deterministic data (rule violations, metric
 * statuses, missing-data reasons, breakdown signals) — no AI call from
 * the Excel exporter, so generation works fully offline.
 *
 * Each observation is tagged Positive / Risk / Note with a coloured pill;
 * each fix-plan step shows category, effort (S/M/L), and target.
 */
interface InsightItem {
  type: 'positive' | 'risk' | 'note';
  text: string;
}
interface FixStep {
  title: string;
  category: string;
  rationale: string;
  effort: 'S' | 'M' | 'L';
  resolves?: string;  // metric IDs comma-joined
}

function addInsightsBlock(
  ws: Worksheet,
  startRow: number,
  section: string,
  observations: InsightItem[],
  fixSteps: FixStep[],
): number {
  if (observations.length === 0 && fixSteps.length === 0) return startRow;
  const palette = SECTION_COLORS[section] ?? SECTION_COLORS.dashboard;
  const colSpan = Math.max(5, Math.min(8, ws.columnCount || 6));
  let row = startRow + 1;

  // Section header band
  ws.mergeCells(row, 1, row, colSpan);
  const head = ws.getCell(row, 1);
  head.value = 'Observations & Fix Plan';
  head.font  = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF' + palette.c } };
  head.fill  = fillSolid(lighten(palette.c, 0.88));
  head.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 24;
  row++;

  // Observations subsection
  if (observations.length > 0) {
    ws.mergeCells(row, 1, row, colSpan);
    const sub = ws.getCell(row, 1);
    sub.value = 'Observations';
    sub.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + C.text } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    sub.fill = fillSolid(C.greyBg);
    ws.getRow(row).height = 18;
    row++;

    for (const obs of observations) {
      const tagCell = ws.getCell(row, 1);
      const tagColor = obs.type === 'positive' ? C.green
                     : obs.type === 'risk'    ? C.red
                     : C.grey;
      const tagLabel = obs.type === 'positive' ? '✓ POSITIVE'
                     : obs.type === 'risk'    ? '⚠ RISK'
                     : '• NOTE';
      tagCell.value = tagLabel;
      tagCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      tagCell.alignment = { vertical: 'top', horizontal: 'center' };
      tagCell.fill = fillSolid(tagColor);

      ws.mergeCells(row, 2, row, colSpan);
      const txt = ws.getCell(row, 2);
      txt.value = obs.text;
      txt.font = { name: 'Calibri', size: 10, color: { argb: 'FF' + C.text } };
      wrap(txt);
      applyBorder(tagCell);
      applyBorder(txt);
      ws.getRow(row).height = Math.max(28, Math.ceil(obs.text.length / 80) * 16);
      row++;
    }
    row++;
  }

  // Fix-plan subsection
  if (fixSteps.length > 0) {
    ws.mergeCells(row, 1, row, colSpan);
    const sub = ws.getCell(row, 1);
    sub.value = 'Fix Plan — ranked by leverage';
    sub.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + C.text } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    sub.fill = fillSolid(C.greyBg);
    ws.getRow(row).height = 18;
    row++;

    // Table header for fix plan
    const hdr = ws.getRow(row);
    hdr.values = ['#', 'Action', 'Category', 'Why this helps', 'Effort'];
    if (colSpan > 5) for (let c = 6; c <= colSpan; c++) ws.getCell(row, c).value = '';
    hdr.height = 20;
    hdr.eachCell((cell, col) => {
      if (col > 5) return;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = fillSolid(palette.c);
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      applyBorder(cell);
    });
    row++;

    fixSteps.forEach((s, i) => {
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = s.title;
      ws.getCell(row, 3).value = s.category;
      ws.getCell(row, 4).value = s.rationale;
      const eCell = ws.getCell(row, 5);
      eCell.value = s.effort === 'S' ? 'S · Quick win'
                  : s.effort === 'M' ? 'M · Few weeks'
                  :                     'L · Long haul';
      const eColor = s.effort === 'S' ? C.green : s.effort === 'M' ? C.amber : C.coral;
      eCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + eColor } };
      eCell.alignment = { vertical: 'top', horizontal: 'center' };
      // Body cells
      for (let c = 1; c <= 4; c++) {
        const cell = ws.getCell(row, c);
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF' + C.text } };
        wrap(cell, c === 1 ? 'center' : 'left');
        applyBorder(cell);
      }
      applyBorder(eCell);
      ws.getRow(row).height = Math.max(32, Math.ceil((s.title.length + s.rationale.length) / 70) * 16);
      row++;
    });
  }

  return row;
}

/**
 * Resolve observations + fix steps for a section.  When AI insights are
 * provided (pre-fetched by the caller before building the workbook), use
 * those — they're richer, contextual, and section-specific.  Otherwise
 * fall back to the deterministic rule-derived helpers so the export
 * works offline.
 */
function resolveInsights(
  ai: SectionInsights | undefined,
  metrics: Array<{ id: string; result: MetricResult | undefined; label?: string }>,
  violations: RuleViolation[],
): { observations: InsightItem[]; fixSteps: FixStep[] } {
  if (ai && (ai.observations.length > 0 || ai.fixSteps.length > 0)) {
    return {
      observations: ai.observations.map(o => ({ type: o.type, text: o.text })),
      fixSteps: ai.fixSteps.map(s => ({
        title: s.title,
        category: ({
          'data-setup': 'Data setup',
          'operations': 'Operations',
          'financial':  'Financial',
          'compliance': 'Compliance',
          'reporting':  'Reporting',
        } as Record<string, string>)[s.category] ?? s.category,
        rationale: s.rationale + (s.impact ? `  ·  ${s.impact}` : '') + (s.tallySteps?.length
          ? `\nTally: ${s.tallySteps.join('  →  ')}`
          : ''),
        effort: s.effort,
      })),
    };
  }
  return {
    observations: deriveObservations(metrics, violations),
    fixSteps: deriveFixSteps(metrics),
  };
}

/** Build observations from rule violations + metric statuses for one section. */
function deriveObservations(
  metrics: Array<{ id: string; result: MetricResult | undefined; label?: string }>,
  violations: RuleViolation[],
): InsightItem[] {
  const items: InsightItem[] = [];
  // Risks: critical / warning violations
  const ids = new Set(metrics.map(m => m.id));
  for (const v of violations) {
    if (v.metricId && !ids.has(v.metricId)) continue;
    if (v.severity === 'critical' || v.severity === 'warning') {
      items.push({ type: 'risk', text: `${v.metricLabel ?? v.metricId}: ${v.message}` });
    } else if (v.severity === 'info') {
      items.push({ type: 'note', text: `${v.metricLabel ?? v.metricId}: ${v.message}` });
    }
  }
  // Notes: partial / missing data — flag the coverage gap
  let partialCount = 0, missingCount = 0;
  for (const m of metrics) {
    if (!m.result) continue;
    if (m.result.status === 'partial') partialCount++;
    else if (m.result.status === 'missing-data') missingCount++;
  }
  if (missingCount > 0) {
    items.push({ type: 'note', text: `${missingCount} of ${metrics.length} metric${metrics.length === 1 ? '' : 's'} couldn't be computed — see Status column for the specific data gap.` });
  }
  if (partialCount > 0) {
    items.push({ type: 'note', text: `${partialCount} metric${partialCount === 1 ? '' : 's'} computed with caveats (e.g. derived from voucher-level data or single period only). Treat the figure as directional until the underlying file is uploaded.` });
  }
  return items.slice(0, 6);
}

/** Build a deterministic fix plan from missing-data + partial metrics for one section. */
function deriveFixSteps(
  metrics: Array<{ id: string; result: MetricResult | undefined; label?: string }>,
): FixStep[] {
  const steps: FixStep[] = [];
  // 1. Missing-data → upload / configure
  for (const m of metrics) {
    if (!m.result || m.result.status !== 'missing-data') continue;
    const reason = m.result.reason ?? '';
    let category = 'Data setup', effort: 'S' | 'M' | 'L' = 'S';
    if (/payable|bills?|aging/i.test(reason)) {
      steps.push({
        title: `Export Bills / Payables.xml from Tally`,
        category,
        rationale: `${m.label ?? m.id}: ${reason}`,
        effort,
        resolves: m.id,
      });
    } else if (/budget/i.test(reason)) {
      steps.push({
        title: 'Upload budget Excel in Setup',
        category: 'Data setup', effort: 'S',
        rationale: `${m.label ?? m.id}: ${reason}`,
        resolves: m.id,
      });
    } else if (/master|classify|category|group/i.test(reason)) {
      steps.push({
        title: 'Tag the relevant ledgers in Master Setup',
        category: 'Reporting', effort: 'M',
        rationale: `${m.label ?? m.id}: ${reason}`,
        resolves: m.id,
      });
    } else if (/headcount|production|drawing power|order book|sanction/i.test(reason)) {
      steps.push({
        title: 'Enter the missing manual input in Setup',
        category: 'Data setup', effort: 'S',
        rationale: `${m.label ?? m.id}: ${reason}`,
        resolves: m.id,
      });
    } else if (/period|2\+ periods|monthly/i.test(reason)) {
      steps.push({
        title: 'Upload an additional period (prior month / FY)',
        category: 'Data setup', effort: 'M',
        rationale: `${m.label ?? m.id}: ${reason}`,
        resolves: m.id,
      });
    }
  }
  // 2. Partial → tighten / upload
  for (const m of metrics) {
    if (!m.result || m.result.status !== 'partial') continue;
    if (/coarse|estimate|proxy|heuristic/i.test(m.result.reason ?? '')) {
      steps.push({
        title: `Sharpen ${m.label ?? m.id} with explicit Tally tagging`,
        category: 'Reporting', effort: 'M',
        rationale: m.result.reason ?? 'Currently a heuristic estimate — explicit tagging yields a precise figure.',
        resolves: m.id,
      });
    }
  }
  // Dedup by title, cap to 6
  const seen = new Set<string>();
  return steps
    .filter(s => { if (seen.has(s.title)) return false; seen.add(s.title); return true; })
    .slice(0, 6);
}

/** Apply the right number format based on the metric's unit. */
function applyNumberFormat(cell: Cell, unit: 'INR' | 'pct' | 'days' | 'ratio' | 'count' | 'text' | undefined, reportUnit: ReportUnit): void {
  if (unit === 'pct') cell.numFmt = PCT_FMT;
  else if (unit === 'ratio') cell.numFmt = RATIO_FMT;
  else if (unit === 'days') cell.numFmt = DAYS_FMT;
  else if (unit === 'count') cell.numFmt = '#,##0';
  else if (unit === 'text') cell.numFmt = '@';
  else cell.numFmt = inrFormat(reportUnit);
}

/** Convert a numeric value to its workbook-display value (divides by unit). */
function valueFor(n: number | null | undefined, unit: 'INR' | 'pct' | 'days' | 'ratio' | 'count' | 'text' | undefined, reportUnit: ReportUnit): number | string {
  if (n == null || !isFinite(n)) return '—';
  if (unit === 'pct') return n / 100;
  if (unit === 'days' || unit === 'ratio' || unit === 'count' || unit === 'text') return n;
  // INR — divide by selected display unit so the ₹ L / Cr suffix in
  // the number-format matches the displayed value.
  return n / UNIT_DIVISOR[reportUnit];
}

function resultText(r: MetricResult | undefined): string {
  if (!r) return '—';
  if (r.status === 'missing-data') return '—';
  if (r.status === 'manual-required') return 'Manual';
  return r.value?.text ?? '—';
}

// ── Cover sheet ─────────────────────────────────────────────────────────

function buildCoverSheet(wb: Workbook, out: MISRunOutput, opts: { company: string; period: string; sector: string | null; unit: ReportUnit }): void {
  const ws = wb.addWorksheet('Cover', {
    properties: { defaultColWidth: 14 },
    views: [{ showGridLines: false }],
  });
  setTabColor(ws, C.teal);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [
    { width: 4 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 4 },
  ];

  ws.getRow(2).height = 8;
  ws.mergeCells('B3:E3');
  const co = ws.getCell('B3');
  co.value = opts.company;
  co.font = { name: 'Calibri', size: 28, bold: true, color: { argb: 'FF' + C.teal } };
  co.alignment = { horizontal: 'center' };

  ws.mergeCells('B4:E4');
  const sub = ws.getCell('B4');
  sub.value = 'Management Information System Report';
  sub.font = { name: 'Calibri', size: 14, color: { argb: 'FF' + C.text } };
  sub.alignment = { horizontal: 'center' };

  ws.mergeCells('B5:E5');
  const per = ws.getCell('B5');
  per.value = `${opts.period}  ·  ${opts.sector ?? 'No sector selected'}`;
  per.font = { name: 'Calibri', size: 11, color: { argb: 'FF' + C.grey } };
  per.alignment = { horizontal: 'center' };

  ws.getRow(7).height = 8;

  // Score boxes — three coloured tiles
  const scoreRow = 8;
  const scoreSpec = [
    { col: 'B', label: 'Books Health (L1)', value: out.readiness.l1Score, color: C.blue },
    { col: 'C', label: 'MIS Readiness',     value: `${Math.round(out.readiness.readinessPct * 100)}%`, color: C.amber },
    { col: 'D', label: 'MIS Score',         value: out.readiness.misScore, color: C.teal },
  ];

  for (const s of scoreSpec) {
    const labelCell = ws.getCell(`${s.col}${scoreRow}`);
    labelCell.value = s.label;
    labelCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF' + s.color } };
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    labelCell.fill = fillSolid(SECTION_COLORS.cover.bg);
    labelCell.border = {
      top:    { style: 'medium', color: { argb: 'FF' + s.color } },
      left:   { style: 'medium', color: { argb: 'FF' + s.color } },
      right:  { style: 'medium', color: { argb: 'FF' + s.color } },
    };

    const valueCell = ws.getCell(`${s.col}${scoreRow + 1}`);
    valueCell.value = s.value;
    valueCell.font = { name: 'Calibri', size: 28, bold: true, color: { argb: 'FF' + s.color } };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    valueCell.fill = fillSolid(SECTION_COLORS.cover.bg);
    valueCell.border = {
      left:   { style: 'medium', color: { argb: 'FF' + s.color } },
      right:  { style: 'medium', color: { argb: 'FF' + s.color } },
      bottom: { style: 'medium', color: { argb: 'FF' + s.color } },
    };
    ws.getRow(scoreRow + 1).height = 40;
  }

  // Status tags row
  const tagRow = scoreRow + 3;
  const counts = { auto: 0, partial: 0, manual: 0, 'new-xml': 0 } as Record<string, number>;
  for (const m of ALL_MIS_METRICS) counts[m.defaultStatus]++;
  const tagSpec = [
    { col: 'B', label: `Auto: ${counts.auto}`,    color: C.green },
    { col: 'C', label: `Partial: ${counts.partial}`, color: C.amber },
    { col: 'D', label: `Manual: ${counts.manual}`,   color: C.coral },
    { col: 'E', label: `New XML: ${counts['new-xml']}`, color: C.red },
  ];
  for (const t of tagSpec) {
    const cell = ws.getCell(`${t.col}${tagRow}`);
    cell.value = t.label;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + t.color } };
    cell.alignment = { horizontal: 'center' };
    cell.fill = fillSolid(lighten(t.color, 0.85));
  }

  // Footer
  ws.mergeCells(`B${tagRow + 3}:E${tagRow + 3}`);
  const foot = ws.getCell(`B${tagRow + 3}`);
  foot.value = 'Generated by AccountingIQ · DPDPA 2023 compliant · Every figure is deterministic and traceable in the Backup Working tab.';
  foot.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF' + C.grey } };
  foot.alignment = { horizontal: 'center', wrapText: true };
  ws.getRow(tagRow + 3).height = 30;
}

// ── KPI block helper (used by Dashboard / panels) ───────────────────────

function addKpiBlock(ws: Worksheet, startRow: number, kpis: Array<{ label: string; result: MetricResult | undefined }>, section: string, reportUnit: ReportUnit, colsPerBlock = 2): number {
  const palette = SECTION_COLORS[section];
  let row = startRow;
  const perRow = 3; // 3 KPIs per row
  for (let i = 0; i < kpis.length; i += perRow) {
    const slice = kpis.slice(i, i + perRow);
    slice.forEach((kpi, idx) => {
      const startCol = idx * colsPerBlock + 1;
      // Label
      const labelCell = ws.getCell(row, startCol);
      labelCell.value = kpi.label.toUpperCase();
      labelCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF' + palette.c } };
      labelCell.fill = fillSolid(palette.bg);
      labelCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.mergeCells(row, startCol, row, startCol + colsPerBlock - 1);

      // Value
      const valueCell = ws.getCell(row + 1, startCol);
      const r = kpi.result;
      const u = r?.value?.unit;
      if (r?.status === 'computed' || r?.status === 'partial') {
        if (r.value?.numeric != null) {
          valueCell.value = valueFor(r.value.numeric, u, reportUnit);
          applyNumberFormat(valueCell, u, reportUnit);
        } else {
          valueCell.value = r.value?.text ?? '—';
        }
      } else {
        valueCell.value = resultText(r);
      }
      valueCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF' + C.text } };
      valueCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      valueCell.fill = fillSolid(palette.bg);
      ws.mergeCells(row + 1, startCol, row + 1, startCol + colsPerBlock - 1);

      // Status pill / secondary line
      const subCell = ws.getCell(row + 2, startCol);
      const secondary = r?.value?.text?.includes('·') ? r.value.text.split('·')[1].trim() : null;
      subCell.value = secondary ?? (r?.value?.mom != null ? `${r.value.mom >= 0 ? '▲' : '▼'} ${Math.abs(r.value.mom).toFixed(1)}${r.value.momIsPct ? '%' : ''} vs prior` : (r?.reason ?? ''));
      subCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF' + C.grey } };
      subCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      subCell.fill = fillSolid(palette.bg);
      ws.mergeCells(row + 2, startCol, row + 2, startCol + colsPerBlock - 1);

      ws.getRow(row).height = 16;
      ws.getRow(row + 1).height = 26;
      ws.getRow(row + 2).height = 16;
    });
    row += 4; // 3 row block + 1 gap
  }
  return row;
}

// ── Dashboard sheet ─────────────────────────────────────────────────────

async function buildDashboardSheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): Promise<void> {
  const ws = wb.addWorksheet('Dashboard', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.teal);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  addSectionTitle(ws, 1, 'Executive Dashboard', 'dashboard', 6);

  const kpis = DASHBOARD_KPI_METRICS.map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { label: def?.label ?? id, result: out.byId[id] };
  });

  let nextRow = 3;
  nextRow = addKpiBlock(ws, nextRow, kpis, 'dashboard', reportUnit);

  // Revenue trend chart
  const revTrend = out.byId['P1']?.value?.trend ?? [];
  if (revTrend.length >= 2) {
    try {
      const png = await renderChartToPNG({
        type: 'line',
        data: {
          labels: revTrend.map(p => p.periodLabel),
          datasets: [{
            label: 'Revenue',
            data: revTrend.map(p => p.value / UNIT_DIVISOR[reportUnit]),
            borderColor: '#' + C.teal,
            backgroundColor: '#' + C.teal + '33',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#' + C.teal,
            pointRadius: 4,
          }],
        },
        options: {
          plugins: { title: { display: true, text: `Revenue trend (₹${UNIT_LABEL[reportUnit].trim() || ''})`, padding: 8 } },
          scales: { y: { beginAtZero: false }, x: {} },
        },
      });
      const imgId = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: nextRow + 1 }, ext: { width: 720, height: 280 } });
      nextRow += 16;
    } catch { /* chart embed failed — skip silently */ }
  }

  // ── Observations & Fix Plan ─────────────────────────────────────────
  const allMetrics = DASHBOARD_KPI_METRICS.map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  const resolved = resolveInsights(
    opts.aiInsightsBySection?.['Executive Summary'],
    allMetrics, opts.violations,
  );
  addInsightsBlock(ws, nextRow + 1, 'dashboard', resolved.observations, resolved.fixSteps);
}

// ── P&L sheet ───────────────────────────────────────────────────────────

async function buildPLSheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): Promise<void> {
  const ws = wb.addWorksheet('P&L', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.teal);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 38 }, { width: 18 }, { width: 14 }, { width: 18 }, { width: 48 }];
  addSectionTitle(ws, 1, 'Profit & Loss Statement', 'pl', 5);

  // Table header
  const headerRow = ws.getRow(3);
  headerRow.values = ['Particulars', 'Value', '% of Revenue', 'Status', 'Notes'];
  applyTableHeader(headerRow, 'pl');

  const revenue = out.byId['P1']?.value?.numeric ?? 0;
  const order = ['P1', 'P5', 'P6', 'P7', 'P2', 'P9', 'P10', 'P3', 'P8'];
  let row = 4;
  for (const id of order) {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    const r = out.byId[id];
    if (!def || !r) continue;
    const u = r.value?.unit;
    const valueCell = ws.getCell(row, 2);
    if (r.value?.numeric != null) {
      valueCell.value = valueFor(r.value.numeric, u, reportUnit);
      applyNumberFormat(valueCell, u, reportUnit);
    } else {
      valueCell.value = resultText(r);
    }
    const pctCell = ws.getCell(row, 3);
    const v = r.value?.numeric;
    if (revenue > 0 && v != null && u !== 'pct') {
      pctCell.value = v / revenue;
      pctCell.numFmt = PCT_FMT;
    } else {
      pctCell.value = '—';
    }
    ws.getCell(row, 1).value = def.label;
    ws.getCell(row, 4).value = statusLabel(r);
    ws.getCell(row, 5).value = r.reason ?? '';

    const isHeadline = ['P1', 'P5', 'P6', 'P7'].includes(id);
    const longNote = (r.reason ?? '').length > 40;
    applyDataRow(ws.getRow(row), { bold: isHeadline, tint: isHeadline ? SECTION_COLORS.pl.bg : undefined, wrap: longNote });
    if (longNote) wrap(ws.getCell(row, 5));
    row++;
  }

  // Waterfall chart
  const gp = out.byId['P5']?.value?.numeric ?? 0;
  const cogs = Math.max(0, revenue - gp);
  const ebitda = out.byId['P6']?.value?.numeric ?? 0;
  const opex = Math.max(0, gp - ebitda);
  const pat = out.byId['P7']?.value?.numeric ?? 0;
  const dInt = Math.max(0, ebitda - pat);
  const waterfall = [
    { name: 'Revenue', value: revenue, color: '#' + C.teal },
    { name: 'COGS', value: cogs, color: '#' + C.red },
    { name: 'Gross Profit', value: gp, color: '#' + C.teal },
    { name: 'OpEx', value: opex, color: '#' + C.red },
    { name: 'EBITDA', value: ebitda, color: '#' + C.teal },
    { name: 'D&A+Int', value: dInt, color: '#' + C.red },
    { name: 'PAT', value: pat, color: '#' + C.green },
  ].filter(b => b.value > 0);

  if (waterfall.length >= 2) {
    try {
      const png = await renderChartToPNG({
        type: 'bar',
        data: {
          labels: waterfall.map(w => w.name),
          datasets: [{
            label: `₹${UNIT_LABEL[reportUnit].trim() || ''}`,
            data: waterfall.map(w => w.value / UNIT_DIVISOR[reportUnit]),
            backgroundColor: waterfall.map(w => w.color),
            borderRadius: 4,
          }],
        },
        options: {
          plugins: { title: { display: true, text: `P&L Waterfall (₹${UNIT_LABEL[reportUnit].trim() || ''})`, padding: 8 }, legend: { display: false } },
        },
      });
      const imgId = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: row + 1 }, ext: { width: 720, height: 280 } });
      row += 16;
    } catch { /* skip */ }
  }

  // ── Observations & Fix Plan ──
  const sectionMetrics = order.map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  {
    const ai = opts.aiInsightsBySection?.['P&L'];
    const r = resolveInsights(ai, sectionMetrics, opts.violations);
    addInsightsBlock(ws, row + 1, 'pl', r.observations, r.fixSteps);
  }
}

// ── Cash Flow sheet ────────────────────────────────────────────────────

function buildCFSheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): void {
  const ws = wb.addWorksheet('Cash Flow', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.blue);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 38 }, { width: 20 }, { width: 14 }, { width: 48 }];
  addSectionTitle(ws, 1, 'Cash Flow Statement', 'cf', 4);

  const headerRow = ws.getRow(3);
  headerRow.values = ['Component', 'Value', 'Status', 'Notes'];
  applyTableHeader(headerRow, 'cf');

  let row = 4;
  for (const id of ['CF4', 'CF5', 'CF6', 'CF7', 'CF2', 'CF1', 'CF9'] as const) {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    const r = out.byId[id];
    if (!def || !r) continue;
    ws.getCell(row, 1).value = def.label;
    const u = r.value?.unit;
    const valueCell = ws.getCell(row, 2);
    if (r.value?.numeric != null) {
      valueCell.value = valueFor(r.value.numeric, u, reportUnit);
      applyNumberFormat(valueCell, u, reportUnit);
    } else {
      valueCell.value = resultText(r);
    }
    ws.getCell(row, 3).value = statusLabel(r);
    ws.getCell(row, 4).value = r.reason ?? '';
    const longNote = (r.reason ?? '').length > 40;
    applyDataRow(ws.getRow(row), {
      bold: ['CF1', 'CF4', 'CF7'].includes(id),
      tint: ['CF1', 'CF4', 'CF7'].includes(id) ? SECTION_COLORS.cf.bg : undefined,
      wrap: longNote,
    });
    if (longNote) wrap(ws.getCell(row, 4));
    row++;
  }

  // Outflow buckets
  row += 1;
  const outflows = out.byId['CF10']?.value?.breakdown ?? [];
  if (outflows.length >= 3) {
    ws.mergeCells(row, 1, row, 4);
    const t = ws.getCell(row, 1);
    t.value = 'Committed outflows — next 90 days';
    t.font = { bold: true, size: 11, color: { argb: 'FF' + C.text } };
    t.alignment = { horizontal: 'left', vertical: 'middle' };
    row++;
    const tints = [C.red, C.amber, C.green];
    outflows.slice(0, 3).forEach((b, i) => {
      ws.getCell(row, 1).value = b.label;
      ws.getCell(row, 2).value = valueFor(b.value, 'INR', reportUnit);
      applyNumberFormat(ws.getCell(row, 2), 'INR', reportUnit);
      applyDataRow(ws.getRow(row), { bold: true, tint: lighten(tints[i], 0.88) });
      row++;
    });
  }

  // Bank-wise breakdown
  const banks = out.byId['CF3']?.value?.breakdown ?? [];
  if (banks.length > 0) {
    row += 1;
    ws.mergeCells(row, 1, row, 4);
    const t = ws.getCell(row, 1);
    t.value = 'Bank-wise closing balance';
    t.font = { bold: true, size: 11, color: { argb: 'FF' + C.text } };
    row++;
    banks.forEach(b => {
      ws.getCell(row, 1).value = b.label;
      const overdraft = b.value < 0;
      ws.getCell(row, 2).value = valueFor(b.value, 'INR', reportUnit);
      applyNumberFormat(ws.getCell(row, 2), 'INR', reportUnit);
      if (overdraft) {
        ws.getCell(row, 2).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + C.red } };
      }
      applyDataRow(ws.getRow(row));
      if (overdraft) {
        // Re-apply the red font after applyDataRow normalises it
        ws.getCell(row, 2).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + C.red } };
      }
      row++;
    });
  }

  // ── Observations & Fix Plan ──
  const sectionMetrics = (['CF4', 'CF5', 'CF6', 'CF7', 'CF2', 'CF1', 'CF9', 'CF10', 'CF3'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  {
    const ai = opts.aiInsightsBySection?.['Cash Flow'];
    const r = resolveInsights(ai, sectionMetrics, opts.violations);
    addInsightsBlock(ws, row + 1, 'cf', r.observations, r.fixSteps);
  }
}

// ── Balance Sheet sheet with RAG conditional formatting ──────────────────

function buildBSSheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): void {
  const ws = wb.addWorksheet('Balance Sheet', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.amber);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 32 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 48 }];
  addSectionTitle(ws, 1, 'Balance Sheet — Ratios & Health', 'bs', 5);

  const headerRow = ws.getRow(3);
  headerRow.values = ['Ratio', 'Value', 'Benchmark', 'Status', 'Notes'];
  applyTableHeader(headerRow, 'bs');

  const ratios = [
    { id: 'BS1', bench: 1.5, dir: 'higher', label: 'Current ratio' },
    { id: 'BS2', bench: 1.0, dir: 'higher', label: 'Quick ratio' },
    { id: 'BS3', bench: 0.2, dir: 'higher', label: 'Cash ratio' },
    { id: 'BS4', bench: 2.0, dir: 'lower',  label: 'Debt / Equity' },
    { id: 'BS5', bench: 1.5, dir: 'higher', label: 'Interest cover' },
    { id: 'BPI10', bench: 1.25, dir: 'higher', label: 'DSCR' },
  ] as const;

  let row = 4;
  for (const ratio of ratios) {
    const r = out.byId[ratio.id];
    if (!r) continue;
    const v = r.value?.numeric;
    ws.getCell(row, 1).value = ratio.label;
    const valueCell = ws.getCell(row, 2);
    if (v != null) {
      valueCell.value = v;
      valueCell.numFmt = RATIO_FMT;
      const ok = ratio.dir === 'higher' ? v >= ratio.bench : v <= ratio.bench;
      const warn = ratio.dir === 'higher' ? v >= ratio.bench * 0.85 : v <= ratio.bench * 1.15;
      const colour = ok ? C.green : warn ? C.amber : C.red;
      valueCell.font = { bold: true, color: { argb: 'FF' + colour }, size: 11 };
      valueCell.fill = fillSolid(lighten(colour, 0.85));
    } else {
      valueCell.value = '—';
    }
    ws.getCell(row, 3).value = `${ratio.dir === 'higher' ? '>' : '<'} ${ratio.bench.toFixed(2)}×`;
    ws.getCell(row, 4).value = statusLabel(r);
    ws.getCell(row, 5).value = r.reason ?? '';
    const longNote = (r.reason ?? '').length > 40;
    applyDataRow(ws.getRow(row), { wrap: longNote });
    if (longNote) wrap(ws.getCell(row, 5));
    row++;
  }

  // DSO / Cash Cycle as days
  for (const { id, bench, dir, label } of [
    { id: 'WC2', bench: 45, dir: 'lower', label: 'DSO' },
    { id: 'WC12', bench: 50, dir: 'lower', label: 'Cash Conversion Cycle' },
  ] as const) {
    const r = out.byId[id];
    if (!r) continue;
    const v = r.value?.numeric;
    ws.getCell(row, 1).value = label;
    const valueCell = ws.getCell(row, 2);
    if (v != null) {
      valueCell.value = v;
      valueCell.numFmt = DAYS_FMT;
      const ok = dir === 'lower' ? v <= bench : v >= bench;
      const warn = dir === 'lower' ? v <= bench * 1.15 : v >= bench * 0.85;
      const colour = ok ? C.green : warn ? C.amber : C.red;
      valueCell.font = { bold: true, color: { argb: 'FF' + colour }, size: 11 };
      valueCell.fill = fillSolid(lighten(colour, 0.85));
    } else {
      valueCell.value = '—';
    }
    ws.getCell(row, 3).value = `${dir === 'lower' ? '<' : '>'} ${bench} days`;
    ws.getCell(row, 4).value = statusLabel(r);
    ws.getCell(row, 5).value = r.reason ?? '';
    const longNote = (r.reason ?? '').length > 40;
    applyDataRow(ws.getRow(row), { wrap: longNote });
    if (longNote) wrap(ws.getCell(row, 5));
    row++;
  }

  // ── Observations & Fix Plan ──
  const sectionMetrics = ([...ratios.map(r => r.id), 'WC2', 'WC12', 'BS6', 'BS8', 'BS9'] as string[]).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  {
    const ai = opts.aiInsightsBySection?.['Balance Sheet'];
    const r = resolveInsights(ai, sectionMetrics, opts.violations);
    addInsightsBlock(ws, row + 1, 'bs', r.observations, r.fixSteps);
  }
}

// ── Working Capital sheet — aging with data bars ───────────────────────

function buildWCSheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): void {
  const ws = wb.addWorksheet('Working Capital', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.purple);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 6 }, { width: 38 }, { width: 18 }, { width: 14 }, { width: 18 }];
  addSectionTitle(ws, 1, 'Working Capital', 'wc', 5);

  // KPIs
  const kpis = (['WC2', 'WC7', 'WC10', 'WC12'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { label: def?.label ?? id, result: out.byId[id] };
  });
  let row = 3;
  row = addKpiBlock(ws, row, kpis, 'wc', reportUnit);

  // Top 10 debtors
  const debtors = out.byId['WC3']?.value?.breakdown ?? [];
  if (debtors.length > 0) {
    row += 1;
    ws.mergeCells(row, 1, row, 5);
    const t = ws.getCell(row, 1);
    t.value = `Top 10 Debtors — ${out.byId['WC3']?.value?.text ?? ''}`;
    t.font = { bold: true, size: 11, color: { argb: 'FF' + C.text } };
    row++;
    const h = ws.getRow(row);
    h.values = ['#', 'Customer', 'Outstanding', '% of Total', ''];
    applyTableHeader(h, 'wc');
    row++;
    const total = debtors.reduce((s, b) => s + b.value, 0);
    debtors.slice(0, 10).forEach((b, i) => {
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = b.label;
      ws.getCell(row, 3).value = valueFor(b.value, 'INR', reportUnit);
      applyNumberFormat(ws.getCell(row, 3), 'INR', reportUnit);
      ws.getCell(row, 4).value = total > 0 ? b.value / total : 0;
      ws.getCell(row, 4).numFmt = PCT_FMT;
      applyDataRow(ws.getRow(row));
      row++;
    });
    // Data bar conditional formatting on the % column
    ws.addConditionalFormatting({
      ref: `D${row - debtors.slice(0, 10).length}:D${row - 1}`,
      rules: [{
        type: 'dataBar',
        priority: 1,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF' + C.coral },
        gradient: true,
      } as ExcelJS.DataBarRuleType],
    });
  }

  // Top 10 creditors
  const creds = out.byId['WC9']?.value?.breakdown ?? [];
  if (creds.length > 0) {
    row += 1;
    ws.mergeCells(row, 1, row, 5);
    const t = ws.getCell(row, 1);
    t.value = `Top 10 Creditors — ${out.byId['WC9']?.value?.text ?? ''}`;
    t.font = { bold: true, size: 11, color: { argb: 'FF' + C.text } };
    row++;
    const h = ws.getRow(row);
    h.values = ['#', 'Supplier', 'Outstanding', '% of Total', ''];
    applyTableHeader(h, 'wc');
    row++;
    const total = creds.reduce((s, b) => s + b.value, 0);
    const start = row;
    creds.slice(0, 10).forEach((b, i) => {
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = b.label;
      ws.getCell(row, 3).value = valueFor(b.value, 'INR', reportUnit);
      applyNumberFormat(ws.getCell(row, 3), 'INR', reportUnit);
      ws.getCell(row, 4).value = total > 0 ? b.value / total : 0;
      ws.getCell(row, 4).numFmt = PCT_FMT;
      applyDataRow(ws.getRow(row));
      row++;
    });
    ws.addConditionalFormatting({
      ref: `D${start}:D${row - 1}`,
      rules: [{
        type: 'dataBar',
        priority: 2,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF' + C.green },
        gradient: true,
      } as ExcelJS.DataBarRuleType],
    });
  }

  // ── Observations & Fix Plan ──
  const sectionMetrics = (['WC1', 'WC2', 'WC3', 'WC4', 'WC5', 'WC6', 'WC7', 'WC8', 'WC9', 'WC10', 'WC11', 'WC12'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  {
    const ai = opts.aiInsightsBySection?.['Working Capital'];
    const r = resolveInsights(ai, sectionMetrics, opts.violations);
    addInsightsBlock(ws, row + 1, 'wc', r.observations, r.fixSteps);
  }
}

// ── Cost sheet ─────────────────────────────────────────────────────────

async function buildCostSheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): Promise<void> {
  const ws = wb.addWorksheet('Cost Analysis', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.coral);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 36 }];
  addSectionTitle(ws, 1, 'Cost Analysis', 'cost', 5);

  // KPIs
  const kpis = (['CA3', 'CA4', 'CA6'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { label: def?.label ?? id, result: out.byId[id] };
  });
  let row = 3;
  row = addKpiBlock(ws, row, kpis, 'cost', reportUnit);

  // Cost as % of revenue table
  const costLines = out.byId['CA1']?.value?.breakdown ?? [];
  if (costLines.length > 0) {
    row += 1;
    ws.mergeCells(row, 1, row, 5);
    const t = ws.getCell(row, 1);
    t.value = 'Cost lines as % of revenue';
    t.font = { bold: true, size: 11, color: { argb: 'FF' + C.text } };
    row++;
    const h = ws.getRow(row);
    h.values = ['Cost head', '% of Revenue', 'Bar', '', ''];
    applyTableHeader(h, 'cost');
    row++;
    const start = row;
    costLines.slice(0, 12).forEach((b: MetricBreakdownItem) => {
      ws.getCell(row, 1).value = b.label;
      ws.getCell(row, 2).value = b.value / 100;
      ws.getCell(row, 2).numFmt = PCT_FMT;
      // Mirror the % in column C so the data bar lives next to the number
      ws.getCell(row, 3).value = b.value / 100;
      ws.getCell(row, 3).numFmt = ';;;';   // hide text, show bar only
      applyDataRow(ws.getRow(row));
      row++;
    });
    ws.addConditionalFormatting({
      ref: `C${start}:C${row - 1}`,
      rules: [{
        type: 'dataBar',
        priority: 3,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF' + C.purple },
        gradient: true,
        showValue: false,
      } as ExcelJS.DataBarRuleType],
    });
  }

  // Fixed vs Variable pie chart image
  const fixedVar = out.byId['CA2']?.value?.breakdown ?? [];
  if (fixedVar.length === 2) {
    try {
      const png = await renderChartToPNG({
        type: 'doughnut',
        data: {
          labels: fixedVar.map(b => b.label),
          datasets: [{
            data: fixedVar.map(b => b.value / UNIT_DIVISOR[reportUnit]),
            backgroundColor: ['#' + C.coral, '#' + C.blue],
            borderWidth: 0,
          }],
        },
        options: { plugins: { title: { display: true, text: 'Fixed vs Variable Costs', padding: 8 } } },
      }, { width: 500, height: 280 });
      const imgId = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: row + 1 }, ext: { width: 500, height: 280 } });
      row += 16;
    } catch { /* skip */ }
  }

  // ── Observations & Fix Plan ──
  const sectionMetrics = (['CA1', 'CA2', 'CA3', 'CA4', 'CA5', 'CA6', 'CA7', 'CA8', 'CA9', 'CA10'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  {
    const ai = opts.aiInsightsBySection?.['Cost Analysis'];
    const r = resolveInsights(ai, sectionMetrics, opts.violations);
    addInsightsBlock(ws, row + 1, 'cost', r.observations, r.fixSteps);
  }
}

// ── BPI sheet ──────────────────────────────────────────────────────────

async function buildBPISheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): Promise<void> {
  const ws = wb.addWorksheet('BPI', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.green);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 6 }, { width: 34 }, { width: 18 }, { width: 14 }, { width: 14 }];
  addSectionTitle(ws, 1, 'Business Performance Indicators', 'bpi', 5);

  let row = 3;
  const kpis = (['BPI1', 'BPI8', 'BPI5', 'BPI7', 'BPI3', 'BPI10'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { label: def?.label ?? id, result: out.byId[id] };
  });
  row = addKpiBlock(ws, row, kpis, 'bpi', reportUnit);

  // Top 10 customers
  const customers = out.byId['BPI1']?.value?.breakdown ?? [];
  if (customers.length > 0) {
    row += 1;
    ws.mergeCells(row, 1, row, 5);
    ws.getCell(row, 1).value = 'Top 10 Customers';
    ws.getCell(row, 1).font = { bold: true, size: 11, color: { argb: 'FF' + C.text } };
    row++;
    const h = ws.getRow(row);
    h.values = ['#', 'Customer', 'Sales', '% of Rev', 'Bar'];
    applyTableHeader(h, 'bpi');
    row++;
    const start = row;
    const total = customers.reduce((s, b) => s + b.value, 0);
    customers.slice(0, 10).forEach((b, i) => {
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = b.label;
      ws.getCell(row, 3).value = valueFor(b.value, 'INR', reportUnit);
      applyNumberFormat(ws.getCell(row, 3), 'INR', reportUnit);
      ws.getCell(row, 4).value = total > 0 ? b.value / total : 0;
      ws.getCell(row, 4).numFmt = PCT_FMT;
      ws.getCell(row, 5).value = total > 0 ? b.value / total : 0;
      ws.getCell(row, 5).numFmt = ';;;';
      applyDataRow(ws.getRow(row));
      row++;
    });
    ws.addConditionalFormatting({
      ref: `E${start}:E${row - 1}`,
      rules: [{
        type: 'dataBar', priority: 4,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF' + C.green }, gradient: true, showValue: false,
      } as ExcelJS.DataBarRuleType],
    });

    // Bar chart image
    try {
      const png = await renderChartToPNG({
        type: 'bar',
        data: {
          labels: customers.slice(0, 10).map(c => c.label),
          datasets: [{
            data: customers.slice(0, 10).map(c => c.value / UNIT_DIVISOR[reportUnit]),
            backgroundColor: '#' + C.green,
            borderRadius: 4,
          }],
        },
        options: {
          indexAxis: 'y',
          plugins: { title: { display: true, text: `Top 10 Customers (₹${UNIT_LABEL[reportUnit].trim() || ''})`, padding: 8 }, legend: { display: false } },
        },
      }, { width: 720, height: 360 });
      const imgId = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: row + 1 }, ext: { width: 720, height: 360 } });
      row += 20;
    } catch { /* skip */ }
  }

  // ── Observations & Fix Plan ──
  const sectionMetrics = (['BPI1', 'BPI2', 'BPI3', 'BPI4', 'BPI5', 'BPI6', 'BPI7', 'BPI8', 'BPI9', 'BPI10', 'BPI11', 'BPI12', 'BPI13'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  {
    const ai = opts.aiInsightsBySection?.['Business Performance'];
    const r = resolveInsights(ai, sectionMetrics, opts.violations);
    addInsightsBlock(ws, row + 1, 'bpi', r.observations, r.fixSteps);
  }
}

// ── Statutory sheet ────────────────────────────────────────────────────

function buildStatutorySheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: SheetOpts): void {
  const ws = wb.addWorksheet('Statutory', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.red);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 38 }, { width: 18 }, { width: 14 }, { width: 48 }];
  addSectionTitle(ws, 1, 'Statutory & Compliance', 'statutory', 4);

  const headerRow = ws.getRow(3);
  headerRow.values = ['Metric', 'Value', 'Status', 'Notes'];
  applyTableHeader(headerRow, 'statutory');

  let row = 4;
  for (const id of ['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6', 'SC7', 'SC8'] as const) {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    const r = out.byId[id];
    if (!def || !r) continue;
    ws.getCell(row, 1).value = def.label;
    const u = r.value?.unit;
    const valueCell = ws.getCell(row, 2);
    if (r.value?.numeric != null) {
      valueCell.value = valueFor(r.value.numeric, u, reportUnit);
      applyNumberFormat(valueCell, u, reportUnit);
    } else {
      valueCell.value = resultText(r);
    }
    ws.getCell(row, 3).value = statusLabel(r);
    ws.getCell(row, 4).value = r.reason ?? '';
    const longNote = (r.reason ?? '').length > 40;
    applyDataRow(ws.getRow(row), { bold: ['SC1', 'SC2', 'SC3'].includes(id), wrap: longNote });
    if (longNote) wrap(ws.getCell(row, 4));
    row++;
    if (r.value?.breakdown) {
      for (const b of r.value.breakdown) {
        ws.getCell(row, 1).value = `  ↳ ${b.label}`;
        ws.getCell(row, 2).value = valueFor(b.value, 'INR', reportUnit);
        applyNumberFormat(ws.getCell(row, 2), 'INR', reportUnit);
        applyDataRow(ws.getRow(row), { tint: SECTION_COLORS.statutory.bg });
        row++;
      }
    }
  }

  // ── Observations & Fix Plan ──
  const sectionMetrics = (['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6', 'SC7', 'SC8'] as const).map(id => {
    const def = ALL_MIS_METRICS.find(m => m.id === id);
    return { id, label: def?.label, result: out.byId[id] };
  });
  {
    const ai = opts.aiInsightsBySection?.['Statutory'];
    const r = resolveInsights(ai, sectionMetrics, opts.violations);
    addInsightsBlock(ws, row + 1, 'statutory', r.observations, r.fixSteps);
  }
}

// ── Forecast sheet ─────────────────────────────────────────────────────

async function buildForecastSheet(wb: Workbook, forecast: MISForecast, reportUnit: ReportUnit, opts: { company: string; period: string }): Promise<void> {
  const ws = wb.addWorksheet('Forecast', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  setTabColor(ws, C.blue);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 22 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 12 }];
  addSectionTitle(ws, 1, 'Forecast — Base / Upside / Downside', 'forecast', 7);

  let row = 3;
  for (const sc of [forecast.base, forecast.upside, forecast.downside]) {
    ws.mergeCells(row, 1, row, 7);
    const t = ws.getCell(row, 1);
    t.value = sc.label;
    t.font = { bold: true, size: 12, color: { argb: 'FF' + C.blue } };
    t.fill = fillSolid(SECTION_COLORS.forecast.bg);
    row++;
    const h = ws.getRow(row);
    h.values = ['Period', 'Revenue', 'GP %', 'EBITDA', 'PAT', 'Cash', 'DSO'];
    applyTableHeader(h, 'forecast');
    row++;
    for (const r of sc.rows) {
      ws.getCell(row, 1).value = r.periodLabel;
      ws.getCell(row, 2).value = r.revenue / UNIT_DIVISOR[reportUnit];
      applyNumberFormat(ws.getCell(row, 2), 'INR', reportUnit);
      ws.getCell(row, 3).value = r.grossProfitPct;
      ws.getCell(row, 3).numFmt = PCT_FMT;
      ws.getCell(row, 4).value = r.ebitda / UNIT_DIVISOR[reportUnit];
      applyNumberFormat(ws.getCell(row, 4), 'INR', reportUnit);
      ws.getCell(row, 5).value = r.pat / UNIT_DIVISOR[reportUnit];
      applyNumberFormat(ws.getCell(row, 5), 'INR', reportUnit);
      ws.getCell(row, 6).value = r.cashPosition / UNIT_DIVISOR[reportUnit];
      applyNumberFormat(ws.getCell(row, 6), 'INR', reportUnit);
      ws.getCell(row, 7).value = r.dso;
      ws.getCell(row, 7).numFmt = DAYS_FMT;
      applyDataRow(ws.getRow(row), { bold: r.isActual, tint: r.isActual ? SECTION_COLORS.forecast.bg : undefined });
      row++;
    }
    // Assumptions
    row += 1;
    ws.mergeCells(row, 1, row, 7);
    const a = ws.getCell(row, 1);
    a.value = `Assumptions — ${sc.label}`;
    a.font = { bold: true, size: 10, color: { argb: 'FF' + C.amber } };
    row++;
    const items = [
      ['Revenue growth MoM', `${((sc.assumptions.revenueGrowthMoM ?? 0) * 100).toFixed(1)}%`],
      ['Gross margin %', `${((sc.assumptions.grossMarginPct ?? 0) * 100).toFixed(1)}%`],
      ['Fixed ops / month', `${((sc.assumptions.fixedOpsCostMonth ?? 0) / UNIT_DIVISOR[reportUnit]).toFixed(2)}${UNIT_LABEL[reportUnit]}`],
      ['Interest / month', `${((sc.assumptions.interestMonth ?? 0) / UNIT_DIVISOR[reportUnit]).toFixed(2)}${UNIT_LABEL[reportUnit]}`],
      ['Capex / month', `${((sc.assumptions.capexMonth ?? 0) / UNIT_DIVISOR[reportUnit]).toFixed(2)}${UNIT_LABEL[reportUnit]}`],
      ['Target DSO', `${Math.round(sc.assumptions.targetDSO ?? 0)} d`],
    ];
    for (const [k, v] of items) {
      ws.getCell(row, 1).value = k;
      ws.getCell(row, 2).value = v;
      applyDataRow(ws.getRow(row));
      row++;
    }
    row += 1;
  }

  // Forecast line chart
  const base = forecast.base.rows;
  if (base.length >= 2) {
    try {
      const png = await renderChartToPNG({
        type: 'line',
        data: {
          labels: base.map(r => r.periodLabel.replace(' (F)', '')),
          datasets: [
            {
              label: 'Revenue',
              data: base.map(r => r.revenue / UNIT_DIVISOR[reportUnit]),
              borderColor: '#' + C.teal, backgroundColor: '#' + C.teal + '30',
              fill: false, tension: 0.3, pointRadius: 4, borderWidth: 2,
            },
            {
              label: 'PAT',
              data: base.map(r => r.pat / UNIT_DIVISOR[reportUnit]),
              borderColor: '#' + C.green, backgroundColor: '#' + C.green + '30',
              fill: false, tension: 0.3, pointRadius: 4, borderWidth: 2, borderDash: [6, 3],
            },
          ],
        },
        options: { plugins: { title: { display: true, text: `Base case projection (₹${UNIT_LABEL[reportUnit].trim() || ''})`, padding: 8 } } },
      }, { width: 720, height: 320 });
      const imgId = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: row + 1 }, ext: { width: 720, height: 320 } });
    } catch { /* skip */ }
  }
}

// ── Backup Working sheet ───────────────────────────────────────────────

function buildBackupSheet(wb: Workbook, out: MISRunOutput, reportUnit: ReportUnit, opts: { company: string; period: string }): void {
  const ws = wb.addWorksheet('Backup Working', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
  setTabColor(ws, C.grey);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [
    { width: 8 }, { width: 34 }, { width: 48 }, { width: 22 }, { width: 18 }, { width: 14 },
  ];
  addSectionTitle(ws, 1, 'Backup Working — Audit Trail (full line-level math)', 'backup', 6);

  const headerRow = ws.getRow(3);
  headerRow.values = ['ID', 'Metric', 'Formula', 'Source', 'Value', 'Status'];
  applyTableHeader(headerRow, 'backup');

  const DOMAIN_TINT: Record<string, string> = {
    D1: SECTION_COLORS.pl.bg,
    D2: SECTION_COLORS.cf.bg,
    D3: SECTION_COLORS.wc.bg,
    D4: SECTION_COLORS.statutory.bg,
    D5: SECTION_COLORS.bs.bg,
    D6: SECTION_COLORS.cost.bg,
    D7: SECTION_COLORS.bpi.bg,
  };

  let row = 4;
  for (const m of ALL_MIS_METRICS) {
    const r = out.byId[m.id];
    // ── Headline row ─────────────────────────────────────────────────
    ws.getCell(row, 1).value = m.id;
    ws.getCell(row, 2).value = m.label;
    ws.getCell(row, 3).value = r?.formula ?? m.formula ?? '';
    ws.getCell(row, 4).value = r?.source ?? m.source;
    const u = r?.value?.unit;
    const vc = ws.getCell(row, 5);
    if (r?.value?.numeric != null) {
      vc.value = valueFor(r.value.numeric, u, reportUnit);
      applyNumberFormat(vc, u, reportUnit);
    } else {
      vc.value = resultText(r);
    }
    ws.getCell(row, 6).value = statusLabel(r);
    applyDataRow(ws.getRow(row), { tint: DOMAIN_TINT[m.domainId], bold: true });
    wrap(ws.getCell(row, 3));
    row++;

    // ── Breakdown rows — every line item from the metric's working ──
    const breakdown = r?.value?.breakdown ?? [];
    for (const b of breakdown) {
      const isNet = b.badge === 'NET';
      const labelCell = ws.getCell(row, 2);
      labelCell.value = `        ${b.label}`;   // indent
      labelCell.font = {
        name: 'Calibri', size: 10,
        italic: !isNet, bold: isNet,
        color: { argb: 'FF' + (isNet ? C.text : C.grey) },
      };
      const bdValueCell = ws.getCell(row, 5);
      const bdUnit = b.unit ?? 'INR';
      const negative = typeof b.value === 'number' && b.value < 0;
      bdValueCell.value = valueFor(b.value as number, bdUnit, reportUnit);
      applyNumberFormat(bdValueCell, bdUnit, reportUnit);
      bdValueCell.font = {
        name: 'Calibri', size: 10,
        bold: isNet,
        color: { argb: 'FF' + (negative ? C.red : isNet ? C.text : C.grey) },
      };
      if (b.badge && b.badge !== 'NET') {
        ws.getCell(row, 6).value = b.badge;
        ws.getCell(row, 6).font = {
          name: 'Calibri', size: 9, bold: true,
          color: { argb: 'FF' + (b.badge === 'OD' ? C.red : C.teal) },
        };
        ws.getCell(row, 6).alignment = { horizontal: 'center', vertical: 'middle' };
      }
      // Light tint for breakdown rows
      const breakdownTint = lighten(DOMAIN_TINT[m.domainId] ?? C.greyBg, 0.55);
      const cells = [ws.getCell(row, 1), labelCell, ws.getCell(row, 3), ws.getCell(row, 4), bdValueCell, ws.getCell(row, 6)];
      for (const c of cells) {
        if (!c.fill || !(c.fill as FillPattern).fgColor) c.fill = fillSolid(breakdownTint);
        applyBorder(c);
      }
      ws.getRow(row).height = 16;
      row++;
    }

    // ── Reason line if present ──
    if (r?.reason && r.status !== 'computed') {
      ws.mergeCells(row, 2, row, 6);
      const reasonCell = ws.getCell(row, 2);
      reasonCell.value = `        ⚠ ${r.reason}`;
      reasonCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF' + C.amber } };
      wrap(reasonCell);
      applyBorder(reasonCell);
      ws.getCell(row, 1).fill = fillSolid(DOMAIN_TINT[m.domainId] ?? C.greyBg);
      applyBorder(ws.getCell(row, 1));
      ws.getRow(row).height = Math.max(20, Math.ceil(r.reason.length / 80) * 14);
      row++;
    }
  }
}

// ── Public entry ───────────────────────────────────────────────────────

export interface MISExcelOptions {
  company: string;
  period: string;
  sector: string | null;
  unit?: ReportUnit;
  forecast?: MISForecast | null;
  violations?: RuleViolation[];
  /** Pre-fetched AI insights keyed by section label (matches the section
   *  names declared in the sheet specs / SECTION_DOMAINS).  When present
   *  for a given section, the Excel embeds the AI Observations and Fix
   *  Plan in place of the deterministic rule-derived fallback. */
  aiInsightsBySection?: Record<string, SectionInsights>;
}

function buildAlertsSheet(wb: Workbook, violations: RuleViolation[], opts: { company: string; period: string }): void {
  const ws = wb.addWorksheet('Alerts', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
  setTabColor(ws, C.red);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 14 }, { width: 28 }, { width: 14 }, { width: 56 }, { width: 36 }];
  addSectionTitle(ws, 1, `Alerts — ${violations.length} firing`, 'statutory', 5);

  const headerRow = ws.getRow(3);
  headerRow.values = ['Severity', 'Metric', 'Value', 'Message', 'Action'];
  applyTableHeader(headerRow, 'statutory');

  let row = 4;
  const severityFill: Record<string, string> = {
    critical: C.red, warning: C.amber, info: C.blue,
  };
  for (const v of violations) {
    const fillColor = severityFill[v.severity];
    ws.getCell(row, 1).value = v.severity.toUpperCase();
    ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF' + fillColor } };
    ws.getCell(row, 2).value = v.metricLabel;
    ws.getCell(row, 3).value = formatThresholdForSheet(v.value, v.metricId);
    ws.getCell(row, 4).value = v.message;
    ws.getCell(row, 5).value = v.rule.action ?? '';
    applyDataRow(ws.getRow(row), { tint: lighten(fillColor, 0.88), wrap: true });
    wrap(ws.getCell(row, 4));
    wrap(ws.getCell(row, 5));
    row++;
  }

  if (violations.length === 0) {
    ws.mergeCells(row, 1, row, 5);
    const cell = ws.getCell(row, 1);
    cell.value = 'No alerts firing — all rules clear for this period.';
    cell.font = { italic: true, color: { argb: 'FF' + C.green } };
    cell.alignment = { horizontal: 'center' };
  }
}

function formatThresholdForSheet(n: number, metricId: string): string {
  const def = ALL_MIS_METRICS.find(m => m.id === metricId);
  const u = def?.unit;
  if (u === 'pct') return `${n.toFixed(1)}%`;
  if (u === 'days') return `${Math.round(n)} d`;
  if (u === 'ratio') return `${n.toFixed(2)}×`;
  return n.toLocaleString('en-IN');
}

function statusLabel(r: MetricResult | undefined): string {
  if (!r) return 'No data';
  return ({
    computed: 'Auto',
    partial: 'Partial',
    'missing-data': 'Missing',
    'manual-required': 'Manual',
    na: 'N/A',
  } as Record<string, string>)[r.status] ?? r.status;
}

/** Index / table-of-contents sheet — clickable hyperlinks to every tab. */
function buildIndexSheet(wb: Workbook, opts: { company: string; period: string; sector: string | null }, sheetSpecs: Array<{ name: string; section: string; description: string }>): void {
  const ws = wb.addWorksheet('Index', { views: [{ showGridLines: false }] });
  setTabColor(ws, C.teal);
  applyPrintSetup(ws, opts.company, opts.period);
  ws.columns = [{ width: 4 }, { width: 4 }, { width: 28 }, { width: 64 }, { width: 4 }];

  // Title banner
  ws.mergeCells('B2:D2');
  const title = ws.getCell('B2');
  title.value = opts.company;
  title.font = { name: 'Calibri', size: 22, bold: true, color: { argb: 'FF' + C.teal } };
  title.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(2).height = 30;

  ws.mergeCells('B3:D3');
  const sub = ws.getCell('B3');
  sub.value = `MIS Report  ·  ${opts.period}  ·  ${opts.sector ?? 'Sector not selected'}`;
  sub.font = { name: 'Calibri', size: 11, color: { argb: 'FF' + C.grey } };
  ws.getRow(3).height = 20;

  ws.mergeCells('B5:D5');
  const heading = ws.getCell('B5');
  heading.value = 'Contents';
  heading.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF' + C.text } };
  heading.fill = fillSolid(C.tealBg);
  heading.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(5).height = 22;

  let row = 6;
  sheetSpecs.forEach((s, i) => {
    const palette = SECTION_COLORS[s.section] ?? SECTION_COLORS.dashboard;
    const idxCell = ws.getCell(row, 2);
    idxCell.value = i + 1;
    idxCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + palette.c } };
    idxCell.alignment = { horizontal: 'right' };

    const nameCell = ws.getCell(row, 3);
    nameCell.value = { text: s.name, hyperlink: `#'${s.name}'!A1` };
    nameCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF' + palette.c }, underline: 'single' };
    nameCell.alignment = { vertical: 'middle' };

    const desc = ws.getCell(row, 4);
    desc.value = s.description;
    desc.font = { name: 'Calibri', size: 10, color: { argb: 'FF' + C.text } };
    desc.alignment = { vertical: 'middle', wrapText: true };

    [idxCell, nameCell, desc].forEach(c => {
      c.fill = fillSolid(lighten(palette.c, 0.93));
      applyBorder(c);
    });
    ws.getRow(row).height = 22;
    row++;
  });

  // Footer note
  ws.mergeCells(`B${row + 2}:D${row + 2}`);
  const foot = ws.getCell(`B${row + 2}`);
  foot.value = 'Click any tab name above to jump to that section. Every figure on every sheet traces back to its formula in the Backup Working tab.';
  foot.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF' + C.grey } };
  wrap(foot);
  ws.getRow(row + 2).height = 30;
}

export async function buildMISExcel(out: MISRunOutput, opts: MISExcelOptions): Promise<Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AccountingIQ';
  wb.created = new Date();
  wb.properties.date1904 = false;

  const unit: ReportUnit = opts.unit ?? 'lakhs';
  const violations = opts.violations ?? [];
  const sheetOpts: SheetOpts = {
    company: opts.company,
    period: opts.period,
    violations,
    aiInsightsBySection: opts.aiInsightsBySection,
  };

  // Plan which sheets will be emitted — used to build the Index.
  const sheetSpecs: Array<{ name: string; section: string; description: string }> = [
    { name: 'Cover',           section: 'cover',     description: 'Cover page — company, period, score summary, status tags.' },
    { name: 'Dashboard',       section: 'dashboard', description: 'Executive dashboard — headline KPIs, revenue trend, observations & fix plan.' },
  ];
  if (violations.length > 0) sheetSpecs.push({ name: 'Alerts', section: 'statutory', description: `${violations.length} rule violation${violations.length === 1 ? '' : 's'} firing right now — severity, metric, action.` });
  sheetSpecs.push(
    { name: 'P&L',             section: 'pl',        description: 'Profit & Loss — revenue → gross profit → EBITDA → PAT with % of revenue and waterfall.' },
    { name: 'Cash Flow',       section: 'cf',        description: 'Operating / investing / financing flows, committed outflows, bank-wise balance.' },
    { name: 'Balance Sheet',   section: 'bs',        description: 'Liquidity ratios (current, quick, cash) and leverage (D/E, interest cover, DSCR) with RAG.' },
    { name: 'Working Capital', section: 'wc',        description: 'DSO / DPO / DIO / cash cycle plus Top 10 debtor and creditor concentration.' },
    { name: 'Cost Analysis',   section: 'cost',      description: 'Cost as % of revenue, fixed vs variable split, break-even, employee cost.' },
    { name: 'BPI',             section: 'bpi',        description: 'Business Performance Indicators — customer / vendor concentration, ATV, returns, DSCR.' },
    { name: 'Statutory',       section: 'statutory', description: 'GST / TDS / MSME / statutory compliance signals.' },
  );
  if (opts.forecast) sheetSpecs.push({ name: 'Forecast', section: 'forecast', description: 'Base / Upside / Downside 3-month projection with assumptions.' });
  sheetSpecs.push({ name: 'Backup Working', section: 'backup', description: 'Audit trail — every metric, formula, source, full line-level breakdown, and reason text.' });

  buildIndexSheet(wb, { company: opts.company, period: opts.period, sector: opts.sector }, sheetSpecs);
  buildCoverSheet(wb, out, { ...opts, unit });
  await buildDashboardSheet(wb, out, unit, sheetOpts);
  if (violations.length > 0) buildAlertsSheet(wb, violations, sheetOpts);
  await buildPLSheet(wb, out, unit, sheetOpts);
  buildCFSheet(wb, out, unit, sheetOpts);
  buildBSSheet(wb, out, unit, sheetOpts);
  buildWCSheet(wb, out, unit, sheetOpts);
  await buildCostSheet(wb, out, unit, sheetOpts);
  await buildBPISheet(wb, out, unit, sheetOpts);
  buildStatutorySheet(wb, out, unit, sheetOpts);
  if (opts.forecast) await buildForecastSheet(wb, opts.forecast, unit, sheetOpts);
  buildBackupSheet(wb, out, unit, sheetOpts);

  return wb;
}

export async function downloadMISExcel(out: MISRunOutput, opts: MISExcelOptions): Promise<void> {
  const wb = await buildMISExcel(out, opts);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as unknown as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const safeCo = opts.company.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Company';
  const safePer = opts.period.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Period';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MIS_Report_${safeCo}_${safePer}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
