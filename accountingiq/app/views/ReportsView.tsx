'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { getGrade, DIM_LABELS, DIM_WEIGHTS, DIM_COLORS, TOTAL_FILE_COUNT } from '@/lib/constants';
import { generateFlags } from '@/lib/flags';
import { generateInsights } from '@/lib/insights';
import { generateHealthSignals } from '@/lib/health';
import { splitDupKey } from '@/lib/voucher-filters';
import type { DimKey, AnalysisResults, ParsedData, CompanyProfile, ChunkedStats } from '@/lib/types';

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const PROFILE_LABELS: Record<string, string> = {
  gstApplicable: 'GST Applicable',
  gstRegular:    'GST Regular Scheme',
  tdsApplicable: 'TDS Applicable',
  hasEmployees:  'Has Employees',
  hasFAfilter:   'Has Fixed Assets',
  isGoods:       'Goods Business',
  fullFY:        'Full Financial Year',
};

// ── Shared report helpers ─────────────────────────────────────────────────

function fmtINR(n: number | undefined): string {
  if (n === undefined || n === null || n === 0) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

function reportHTML(title: string, body: string): string {
  const ts = new Date().toLocaleString('en-IN');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AccountingIQ — ${title}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0e1117; color: #e8eaf0; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; padding: 32px 24px; }
.container { max-width: 900px; margin: 0 auto; }
.page-header { margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid #1e2530; }
.page-header h1 { font-size: 22px; font-weight: 700; color: #f5f7fa; margin-bottom: 4px; }
.page-header p { font-size: 12px; color: #6b7280; }
h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 28px 0 10px; }
.card { background: #161c26; border: 1px solid #1e2530; border-radius: 10px; overflow: hidden; margin-bottom: 4px; }
table { width: 100%; border-collapse: collapse; }
thead th { text-align: left; padding: 9px 14px; font-size: 11px; color: #6b7280; background: #161c26; border-bottom: 1px solid #1e2530; font-weight: 500; }
tbody td { padding: 9px 14px; border-bottom: 1px solid #1e2530; color: #b8bfcc; font-size: 13px; }
tbody tr:last-child td { border-bottom: none; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-critical { background: rgba(240,72,72,.15); color: #f04848; }
.badge-high     { background: rgba(245,166,35,.15); color: #f5a623; }
.badge-medium   { background: rgba(59,130,246,.15);  color: #60a5fa; }
.badge-low      { background: rgba(107,114,128,.15); color: #9ca3af; }
.badge-pass     { background: rgba(34,197,94,.15);   color: #22c55e; }
.badge-fail     { background: rgba(240,72,72,.15);   color: #f04848; }
.badge-partial  { background: rgba(245,166,35,.15);  color: #f5a623; }
.badge-missing, .badge-uncertain, .badge-na { background: rgba(107,114,128,.15); color: #9ca3af; }
.badge-positive { background: rgba(15,212,160,.15);  color: #0fd4a0; }
.kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
.kpi-card { background: #161c26; border: 1px solid #1e2530; border-radius: 10px; padding: 14px 18px; }
.kpi-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
.kpi-value { font-size: 18px; font-weight: 700; color: #f5f7fa; }
.kpi-negative { color: #f04848; }
.score-hero { display: flex; align-items: center; gap: 24px; background: #161c26; border: 1px solid #1e2530; border-radius: 10px; padding: 20px 24px; margin-bottom: 4px; }
.grade { font-size: 48px; font-weight: 800; }
.divider { width: 1px; height: 56px; background: #1e2530; }
.score-num { font-size: 36px; font-weight: 700; color: #f5f7fa; }
.score-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
.row-item { padding: 10px 14px; border-bottom: 1px solid #1e2530; }
.row-item:last-child { border-bottom: none; }
.row-title { font-weight: 500; color: #e8eaf0; margin-bottom: 2px; }
.row-detail { font-size: 12px; color: #6b7280; }
</style>
</head>
<body>
<div class="container">
<div class="page-header">
  <h1>AccountingIQ — ${title}</h1>
  <p>Generated ${ts}</p>
</div>
${body}
</div>
</body>
</html>`;
}

function downloadReport(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Report builders ───────────────────────────────────────────────────────

function buildFullAnalysis(results: AnalysisResults, filters: CompanyProfile, filesLoaded: string[]): string {
  const grade = getGrade(results.cappedScore);
  const ts = new Date(results.runAt).toLocaleString('en-IN');

  const dimRows = DIMS.map(dim => `
    <tr>
      <td><span class="mono" style="color:${DIM_COLORS[dim]}">${dim}</span>&ensp;${DIM_LABELS[dim]}</td>
      <td>${DIM_WEIGHTS[dim]}%</td>
      <td style="text-align:right;font-weight:600;color:#f5f7fa">${results.dimScores[dim] ?? 0}</td>
    </tr>`).join('');

  const checkRows = results.checks.map(c => `
    <tr>
      <td class="mono">${c.id}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td>${c.name}</td>
      <td style="text-align:right">${c.pts}/${c.max}</td>
      <td style="color:#6b7280;font-size:12px">${c.note ?? ''}</td>
    </tr>`).join('');

  const profileBadges = Object.entries(filters).map(([k, v]) =>
    `<span class="badge" style="background:${v ? 'rgba(15,212,160,.1)' : 'rgba(107,114,128,.1)'};color:${v ? '#0fd4a0' : '#6b7280'}">${v ? '✓' : '✕'} ${PROFILE_LABELS[k] ?? k}</span>`
  ).join(' ');

  return reportHTML('Full Analysis', `
    <p style="color:#6b7280;font-size:12px;margin-bottom:20px">Analysed ${ts}</p>
    <div class="score-hero">
      <div class="grade" style="color:${grade.color}">${grade.label}</div>
      <div class="divider"></div>
      <div>
        <div class="score-num">${results.cappedScore}<span style="font-size:16px;color:#6b7280;font-weight:400"> / 100</span></div>
        <div class="score-sub">${results.scoreCapped ? 'Score capped — DayBook missing' : 'Overall Score'}</div>
      </div>
    </div>

    <h2>Dimension Scores</h2>
    <div class="card"><table>
      <thead><tr><th>Dimension</th><th>Weight</th><th style="text-align:right">Score</th></tr></thead>
      <tbody>${dimRows}</tbody>
    </table></div>

    <h2>All 59 Checks</h2>
    <div class="card"><table>
      <thead><tr><th>ID</th><th>Status</th><th>Check Name</th><th style="text-align:right">Pts</th><th>Note</th></tr></thead>
      <tbody>${checkRows}</tbody>
    </table></div>

    <h2>Company Profile Applied</h2>
    <div class="card" style="padding:12px 14px;display:flex;flex-wrap:wrap;gap:6px">${profileBadges}</div>

    <h2>Files Analysed</h2>
    <div class="card" style="padding:12px 14px">
      ${filesLoaded.map(f => `<div style="padding:3px 0;color:#b8bfcc;font-size:13px">• ${f}</div>`).join('')}
    </div>
  `);
}

function buildExecutiveSummary(results: AnalysisResults, parsedData: Partial<ParsedData>, filters: CompanyProfile): string {
  const grade = getGrade(results.cappedScore);
  const ts = new Date(results.runAt).toLocaleString('en-IN');
  const topFails = results.checks.filter(c => c.status === 'fail' || c.status === 'partial').slice(0, 5);
  const insights = generateInsights(results, parsedData, filters).slice(0, 3);

  const dimRows = DIMS.map(dim => `
    <tr>
      <td><span class="mono" style="color:${DIM_COLORS[dim]}">${dim}</span>&ensp;${DIM_LABELS[dim]}</td>
      <td>${DIM_WEIGHTS[dim]}%</td>
      <td style="text-align:right;font-weight:600;color:#f5f7fa">${results.dimScores[dim] ?? 0}</td>
    </tr>`).join('');

  const issueRows = topFails.map(c => `
    <div class="row-item">
      <div class="row-title"><span class="mono" style="margin-right:8px">${c.id}</span>${c.name} <span class="badge badge-${c.status}" style="margin-left:6px">${c.status}</span></div>
      ${c.note ? `<div class="row-detail">${c.note}</div>` : ''}
    </div>`).join('');

  const insightRows = insights.map(ins => `
    <div class="row-item">
      <div class="row-title"><span class="badge badge-${ins.urgency}" style="margin-right:8px">${ins.urgency}</span>${ins.cat}</div>
      <div class="row-detail">${ins.finding}</div>
    </div>`).join('');

  return reportHTML('Executive Summary', `
    <p style="color:#6b7280;font-size:12px;margin-bottom:20px">Analysed ${ts}</p>
    <div class="score-hero">
      <div class="grade" style="color:${grade.color}">${grade.label}</div>
      <div class="divider"></div>
      <div>
        <div class="score-num">${results.cappedScore}<span style="font-size:16px;color:#6b7280;font-weight:400"> / 100</span></div>
        <div class="score-sub">${results.scoreCapped ? 'Score capped — DayBook missing' : 'Overall Score'}</div>
      </div>
    </div>

    <h2>Dimension Summary</h2>
    <div class="card"><table>
      <thead><tr><th>Dimension</th><th>Weight</th><th style="text-align:right">Score</th></tr></thead>
      <tbody>${dimRows}</tbody>
    </table></div>

    ${topFails.length > 0 ? `<h2>Top Issues</h2><div class="card">${issueRows}</div>` : ''}
    ${insights.length > 0 ? `<h2>Top Insights</h2><div class="card">${insightRows}</div>` : ''}
  `);
}

function buildComplianceChecklist(results: AnalysisResults, filters: CompanyProfile): string {
  const eDimChecks = results.checks.filter(c => c.dim === 'E');

  const checkRows = eDimChecks.map(c => `
    <tr>
      <td class="mono">${c.id}</td>
      <td>${c.name}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td style="text-align:right">${c.pts}/${c.max}</td>
      <td style="color:#6b7280;font-size:12px">${c.note ?? ''}</td>
    </tr>`).join('');

  const allDimChecks = results.checks.filter(c => ['B', 'D', 'F'].includes(c.dim));
  const additionalRows = allDimChecks.map(c => `
    <tr>
      <td class="mono">${c.id}</td>
      <td>${c.name}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td style="text-align:right">${c.pts}/${c.max}</td>
      <td style="color:#6b7280;font-size:12px">${c.note ?? ''}</td>
    </tr>`).join('');

  const profileBadges = Object.entries(filters).map(([k, v]) =>
    `<span class="badge" style="background:${v ? 'rgba(15,212,160,.1)' : 'rgba(107,114,128,.1)'};color:${v ? '#0fd4a0' : '#6b7280'}">${v ? '✓' : '✕'} ${PROFILE_LABELS[k] ?? k}</span>`
  ).join(' ');

  return reportHTML('Compliance Checklist', `
    <h2>Company Profile</h2>
    <div class="card" style="padding:12px 14px;display:flex;flex-wrap:wrap;gap:6px">${profileBadges}</div>

    <h2>E — Statutory Accuracy (18% weight)</h2>
    <div class="card"><table>
      <thead><tr><th>ID</th><th>Check</th><th>Status</th><th style="text-align:right">Pts</th><th>Note</th></tr></thead>
      <tbody>${checkRows}</tbody>
    </table></div>

    <h2>Ledger, Voucher &amp; Recording Checks (B, D, F)</h2>
    <div class="card"><table>
      <thead><tr><th>ID</th><th>Check</th><th>Status</th><th style="text-align:right">Pts</th><th>Note</th></tr></thead>
      <tbody>${additionalRows}</tbody>
    </table></div>
  `);
}

function buildFinancialHealth(parsedData: Partial<ParsedData>, dbStats: ChunkedStats | null): string {
  const signals = generateHealthSignals(parsedData, dbStats);

  const ca  = parsedData.ca  ?? 0;
  const cl  = parsedData.cl  ?? 0;
  const currentRatio = cl > 0 ? (ca / cl).toFixed(2) : '—';
  const netMargin = parsedData.revenue && parsedData.revenue > 0
    ? `${((parsedData.netProfit ?? 0) / parsedData.revenue * 100).toFixed(1)}%`
    : '—';

  const kpiGrid = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Revenue</div><div class="kpi-value">${fmtINR(parsedData.revenue)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Expenses</div><div class="kpi-value">${fmtINR(parsedData.expenses)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Net Profit</div><div class="kpi-value ${(parsedData.netProfit ?? 0) < 0 ? 'kpi-negative' : ''}">${fmtINR(parsedData.netProfit)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Current Ratio</div><div class="kpi-value">${currentRatio}</div></div>
      <div class="kpi-card"><div class="kpi-label">Debtors</div><div class="kpi-value">${fmtINR(parsedData.debtorBal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Creditors</div><div class="kpi-value">${fmtINR(parsedData.creditorBal)}</div></div>
    </div>`;

  const extraKpis = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Bank Balance</div><div class="kpi-value">${fmtINR(parsedData.bankBal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Net Profit Margin</div><div class="kpi-value">${netMargin}</div></div>
      <div class="kpi-card"><div class="kpi-label">Working Capital</div><div class="kpi-value ${(ca - cl) < 0 ? 'kpi-negative' : ''}">${fmtINR(ca - cl)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Fixed Assets</div><div class="kpi-value">${fmtINR(parsedData.fixedAssets)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Closing Stock</div><div class="kpi-value">${fmtINR(parsedData.closingStock)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Opening Stock</div><div class="kpi-value">${fmtINR(parsedData.openingStock)}</div></div>
    </div>`;

  const signalRows = signals.map(s => `
    <tr>
      <td style="color:#9ca3af;font-size:12px">${s.category}</td>
      <td>${s.signal}</td>
      <td style="text-align:right;font-weight:600;color:#f5f7fa">${s.value}</td>
      <td style="color:#6b7280;font-size:12px">${s.note}</td>
    </tr>`).join('');

  return reportHTML('Financial Health', `
    <h2>Key Financial Indicators</h2>
    ${kpiGrid}

    <h2>Balance Sheet &amp; P&amp;L Highlights</h2>
    ${extraKpis}

    ${signals.length > 0 ? `
    <h2>Health Signals</h2>
    <div class="card"><table>
      <thead><tr><th>Category</th><th>Signal</th><th style="text-align:right">Value</th><th>Note</th></tr></thead>
      <tbody>${signalRows}</tbody>
    </table></div>` : ''}
  `);
}

function buildAnomalyReport(results: AnalysisResults, parsedData: Partial<ParsedData>, dbStats: ChunkedStats | null): string {
  const flags = generateFlags(results, parsedData, dbStats)
    .sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    });

  const rows = flags.map(f => `
    <div class="row-item">
      <div class="row-title">
        <span class="badge badge-${f.severity}" style="margin-right:8px">${f.severity}</span>
        ${f.title}
        ${f.count !== undefined ? `<span style="color:#6b7280;font-size:12px;margin-left:6px">(${f.count})</span>` : ''}
      </div>
      <div class="row-detail">${f.detail}</div>
    </div>`).join('');

  const critCount = flags.filter(f => f.severity === 'critical').length;
  const highCount = flags.filter(f => f.severity === 'high').length;
  const medCount  = flags.filter(f => f.severity === 'medium').length;
  const lowCount  = flags.filter(f => f.severity === 'low').length;

  return reportHTML('Anomaly Report', `
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-card"><div class="kpi-label">Critical</div><div class="kpi-value" style="color:#f04848">${critCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">High</div><div class="kpi-value" style="color:#f5a623">${highCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Medium</div><div class="kpi-value" style="color:#60a5fa">${medCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Low</div><div class="kpi-value" style="color:#9ca3af">${lowCount}</div></div>
    </div>

    <h2>All Anomaly Flags (${flags.length})</h2>
    ${flags.length > 0 ? `<div class="card">${rows}</div>` : '<div class="card" style="padding:12px 14px;color:#6b7280">No anomalies detected.</div>'}
  `);
}

function buildVoucherAnalysis(dbStats: ChunkedStats | null): string {
  if (!dbStats) {
    return reportHTML('Voucher Analysis', `
      <div class="card" style="padding:16px 14px;color:#6b7280">
        DayBook was not uploaded. Upload the DayBook file to generate voucher analysis.
      </div>`);
  }

  const narrationPct = dbStats.totalVouchers > 0
    ? ((dbStats.narrated / dbStats.totalVouchers) * 100).toFixed(1)
    : '0';
  const highValueNarPct = dbStats.highValueCount > 0
    ? ((dbStats.highValueNarrated / dbStats.highValueCount) * 100).toFixed(1)
    : '0';

  const dupEntries = Object.entries(dbStats.dupVnoMap ?? {})
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ ...splitDupKey(key), count }));

  const monthEntries = Object.entries(dbStats.monthCounts ?? {}).sort((a, b) => a[0].localeCompare(b[0]));

  return reportHTML('Voucher Analysis', `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Vouchers</div><div class="kpi-value">${dbStats.totalVouchers.toLocaleString('en-IN')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Narration Coverage</div><div class="kpi-value">${narrationPct}%</div></div>
      <div class="kpi-card"><div class="kpi-label">High-Value (&gt;₹1L)</div><div class="kpi-value">${dbStats.highValueCount.toLocaleString('en-IN')}</div></div>
      <div class="kpi-card"><div class="kpi-label">HV Narrated</div><div class="kpi-value">${highValueNarPct}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Missing Vno</div><div class="kpi-value ${dbStats.missingVno > 0 ? 'kpi-negative' : ''}">${dbStats.missingVno}</div></div>
      <div class="kpi-card"><div class="kpi-label">Zero-Amt Entries</div><div class="kpi-value ${dbStats.zeroAmt > 0 ? 'kpi-negative' : ''}">${dbStats.zeroAmt}</div></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Missing Party</div><div class="kpi-value ${dbStats.missingParty > 0 ? 'kpi-negative' : ''}">${dbStats.missingParty}</div></div>
      <div class="kpi-card"><div class="kpi-label">Cash &gt;₹10k (269ST)</div><div class="kpi-value ${dbStats.cashOver10k > 0 ? 'kpi-negative' : ''}">${dbStats.cashOver10k}</div></div>
      <div class="kpi-card"><div class="kpi-label">Round-Number Entries</div><div class="kpi-value">${dbStats.roundCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Wrong Voucher Types</div><div class="kpi-value ${dbStats.wrongType > 0 ? 'kpi-negative' : ''}">${dbStats.wrongType}</div></div>
      <div class="kpi-card"><div class="kpi-label">Out-of-FY Entries</div><div class="kpi-value ${dbStats.outOfFY > 0 ? 'kpi-negative' : ''}">${dbStats.outOfFY}</div></div>
      <div class="kpi-card"><div class="kpi-label">Journal Entries</div><div class="kpi-value">${dbStats.totalJournals}</div></div>
    </div>

    ${monthEntries.length > 0 ? `
    <h2>Vouchers by Month</h2>
    <div class="card"><table>
      <thead><tr><th>Month</th><th style="text-align:right">Count</th></tr></thead>
      <tbody>${monthEntries.map(([m, c]) => `<tr><td>${m}</td><td style="text-align:right">${c}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}

    ${dupEntries.length > 0 ? `
    <h2>Duplicate Voucher Numbers (Top 10)</h2>
    <div class="card"><table>
      <thead><tr><th>Voucher Type</th><th>Voucher No</th><th style="text-align:right">Count</th></tr></thead>
      <tbody>${dupEntries.map(({ type, vno, count }) => `<tr><td>${type || '(no type)'}</td><td class="mono">${vno}</td><td style="text-align:right;color:#f04848">${count}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
  `);
}

// ── MIS Report Group 1 builder (Cover + Dashboard + P&L) ─────────────────

function buildMISGroup1(results: AnalysisResults, parsedData: Partial<ParsedData>, filters: CompanyProfile, filesLoaded: string[]): string {
  const grade = getGrade(results.cappedScore);
  const ts = new Date(results.runAt).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });

  const revenue      = parsedData.revenue      ?? 0;
  const netProfit    = parsedData.netProfit     ?? 0;
  const expenses     = parsedData.expenses      ?? 0;
  const depAmt       = parsedData.depAmt        ?? 0;
  const openingStock = parsedData.openingStock  ?? 0;
  const closingStock = parsedData.closingStock  ?? 0;
  const tbPurch      = parsedData.tbPurch       ?? 0;
  const ca           = parsedData.ca            ?? 0;
  const cl           = parsedData.cl            ?? 0;
  const bankBal      = parsedData.bankBal       ?? 0;
  const debtorBal    = parsedData.debtorBal     ?? 0;
  const creditorBal  = parsedData.creditorBal   ?? 0;

  const cogs          = (openingStock > 0 || tbPurch > 0) ? openingStock + tbPurch - closingStock : 0;
  const grossProfit   = cogs > 0 ? revenue - cogs : 0;
  const grossMargin   = revenue > 0 && grossProfit > 0 ? ((grossProfit / revenue) * 100).toFixed(1) + '%' : '—';
  const opex          = cogs > 0 && expenses > 0 ? expenses - cogs : 0;
  const ebitda        = opex > 0 ? grossProfit - opex + depAmt : 0;
  const currentRatio  = ca > 0 && cl > 0 ? (ca / cl).toFixed(2) + '×' : '—';
  const workingCap    = ca - cl;
  const netMargin     = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) + '%' : '—';
  const misReadiness  = Math.round((filesLoaded.length / TOTAL_FILE_COUNT) * 100);
  const misScore      = Math.round(results.cappedScore * (misReadiness / 100));

  const profileTags = Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k]) => {
      const labels: Record<string, string> = {
        gstApplicable: 'GST', gstRegular: 'GST Regular', tdsApplicable: 'TDS',
        hasEmployees: 'Employees', hasFAfilter: 'Fixed Assets', isGoods: 'Goods Business', fullFY: 'Full FY',
      };
      return `<span style="display:inline-block;background:#E1F5EE;color:#0B7B6B;font-size:10px;font-weight:600;padding:2px 10px;border-radius:8px;margin:2px">${labels[k] ?? k}</span>`;
    }).join('');

  const kpiCard = (label: string, value: string, sub: string, color = '#374151') =>
    `<div style="background:#F9FAFB;border-radius:8px;padding:12px 14px;border:1px solid #E5E7EB">
       <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
       <div style="font-size:20px;font-weight:700;color:${color}">${value}</div>
       <div style="font-size:10px;margin-top:3px;color:#6B7280">${sub}</div>
     </div>`;

  const plRow = (label: string, value: string | number, indent = 0, bold = false, bg = 'transparent') => {
    const formatted = typeof value === 'number' ? (value === 0 ? '—' : fmtINR(value)) : value;
    return `<tr style="background:${bg}">
      <td style="padding:5px ${10 + indent * 18}px;font-weight:${bold ? 700 : 400};font-size:${bold ? '11' : '10.5'}px">${label}</td>
      <td style="text-align:right;padding:5px 10px;font-weight:${bold ? 700 : 400};font-size:${bold ? '11' : '10.5'}px">${formatted}</td>
    </tr>`;
  };

  const plRows = [
    plRow('Revenue from Operations', revenue, 0, true, '#EEF6F4'),
    revenue > 0 ? plRow('Net Sales / Turnover', revenue, 1) : '',
    plRow('Cost of Goods Sold', cogs > 0 ? -cogs : 0, 0, true, '#F9FAFB'),
    openingStock > 0 ? plRow('Opening Stock', openingStock, 1) : '',
    tbPurch > 0 ? plRow('Purchases (per Trial Balance)', tbPurch, 1) : '',
    closingStock > 0 ? plRow('Less: Closing Stock', -closingStock, 1) : '',
    cogs > 0 ? plRow('Gross Profit', grossProfit, 0, true, '#EEF6F4') : '',
    opex > 0 ? plRow('Operating Expenses', -opex, 0, true, '#F9FAFB') : '',
    ebitda > 0 ? plRow('EBITDA', ebitda, 0, true, '#EEF6F4') : '',
    depAmt > 0 ? plRow('Less: Depreciation', -depAmt, 1) : '',
    plRow('Net Profit / (Loss)', netProfit, 0, true, netProfit >= 0 ? '#EAF3DE' : '#FCEBEB'),
  ].filter(Boolean).join('');

  const tealHdr = '#0B7B6B';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AccountingIQ — MIS Report Group 1</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#374151;background:#F3F4F6}
.rpt{max-width:960px;margin:0 auto;background:#fff;box-shadow:0 0 24px rgba(0,0,0,.08)}
.rpt-hdr{background:${tealHdr};color:#fff;padding:14px 24px;display:grid;grid-template-columns:1fr auto auto;gap:16px;align-items:center}
.rh-co{font-size:17px;font-weight:700}
.rh-per{font-size:11px;opacity:.8;margin-top:2px}
.score-box{background:rgba(255,255,255,.15);border-radius:8px;padding:8px 16px;text-align:center}
.score-num{font-size:24px;font-weight:800}
.score-lbl{font-size:9px;opacity:.8;margin-top:1px}
.rh-meta{font-size:10px;opacity:.7;text-align:right;line-height:1.6}
.nav{display:flex;background:#fff;border-bottom:2px solid #E5E7EB;overflow-x:auto}
.nav-item{padding:9px 14px;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;color:#6B7280;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
.nav-item.on{color:${tealHdr};border-bottom-color:${tealHdr}}
.panel{display:none;padding:20px 24px}
.panel.on{display:block}
.h2{font-size:14px;font-weight:700;color:${tealHdr};border-left:4px solid ${tealHdr};padding-left:10px;margin:20px 0 12px}
.h2:first-child{margin-top:0}
.h3{font-size:12px;font-weight:600;color:#374151;margin:14px 0 8px}
.kpi-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:18px}
.t{width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:14px}
.t th{background:${tealHdr};color:#fff;padding:6px 10px;text-align:right;font-weight:600;font-size:10px}
.t th:first-child{text-align:left}
.t td{padding:5px 10px;border-bottom:1px solid #E5E7EB}
.t td:first-child{text-align:left}
.t tr:nth-child(even) td{background:#F9FAFB}
.cover{padding:32px 24px;border-bottom:3px solid ${tealHdr}}
.csb-row{display:flex;gap:16px;margin-bottom:20px}
.csb{border:2px solid ${tealHdr};border-radius:10px;padding:12px 20px;text-align:center;min-width:110px}
.csb-v{font-size:30px;font-weight:800;color:${tealHdr}}
.csb-l{font-size:9px;color:#6B7280;margin-top:2px}
.rpt-ft{background:#F8FAFC;border-top:1px solid #E5E7EB;padding:8px 24px;display:flex;justify-content:space-between;font-size:9px;color:#6B7280}
</style>
</head>
<body>
<div class="rpt">
<div class="rpt-hdr">
  <div>
    <div class="rh-co">AccountingIQ — MIS Report</div>
    <div class="rh-per">Group 1 · Cover · Dashboard · P&amp;L</div>
  </div>
  <div class="score-box">
    <div class="score-num">${misScore}</div>
    <div class="score-lbl">MIS Score</div>
  </div>
  <div class="rh-meta">Books Health: ${results.cappedScore}/100 (${grade.label})<br>MIS Readiness: ${misReadiness}%<br>Generated: ${ts}</div>
</div>
<div class="nav">
  <div class="nav-item on" onclick="show('cover',this)">Cover</div>
  <div class="nav-item" onclick="show('dash',this)">Dashboard</div>
  <div class="nav-item" onclick="show('pl',this)">P&amp;L</div>
</div>
<div id="p-cover" class="panel on">
  <div class="cover">
    <div class="h2" style="margin-top:0">Books Quality Report</div>
    <div class="csb-row">
      <div class="csb"><div class="csb-v">${results.cappedScore}</div><div class="csb-l">Books Health (L1)</div></div>
      <div class="csb"><div class="csb-v">${misReadiness}%</div><div class="csb-l">MIS Readiness</div></div>
      <div class="csb" style="border-color:#1D9E75;background:#E1F5EE"><div class="csb-v" style="color:#1D9E75">${misScore}</div><div class="csb-l">MIS Score</div></div>
    </div>
    <div style="margin-bottom:12px">${profileTags || '<span style="color:#9CA3AF;font-size:10px">No profile flags set</span>'}</div>
    <div style="font-size:10px;color:#6B7280;line-height:1.9">
      Files: ${filesLoaded.join(' · ')}<br>
      AccountingIQ · All data processed in-session only · Not stored · DPDPA 2023 compliant
    </div>
  </div>
</div>
<div id="p-dash" class="panel">
  <div class="h2">Executive Dashboard</div>
  <div class="kpi-g">
    ${kpiCard('Revenue', revenue > 0 ? fmtINR(revenue) : '—', 'From P&L', tealHdr)}
    ${kpiCard('Net Profit', netProfit !== 0 ? fmtINR(netProfit) : '—', netProfit < 0 ? 'Loss year' : 'Bottom line', netProfit >= 0 ? '#15803D' : '#B91C1C')}
    ${kpiCard('Gross Margin', grossMargin, 'Est. Revenue − COGS', '#185FA5')}
    ${kpiCard('Cash & Bank', bankBal > 0 ? fmtINR(bankBal) : '—', 'Balance Sheet closing', tealHdr)}
    ${kpiCard('Trade Debtors', debtorBal > 0 ? fmtINR(debtorBal) : '—', 'Trade receivables', '#BA7517')}
    ${kpiCard('Current Ratio', currentRatio, 'CA ÷ CL  ·  ≥1.5 healthy', ca > 0 && cl > 0 ? (ca/cl >= 1.5 ? '#15803D' : ca/cl >= 1 ? '#BA7517' : '#B91C1C') : '#374151')}
  </div>
  <div class="kpi-g">
    ${kpiCard('Trade Creditors', creditorBal > 0 ? fmtINR(creditorBal) : '—', 'Trade payables', '#534AB7')}
    ${kpiCard('Working Capital', workingCap !== 0 ? fmtINR(workingCap) : '—', workingCap >= 0 ? 'Positive — healthy' : 'Negative — watch', workingCap >= 0 ? '#15803D' : '#B91C1C')}
    ${kpiCard('Net Margin', netMargin, 'PAT ÷ Revenue', netProfit >= 0 ? '#15803D' : '#B91C1C')}
  </div>
</div>
<div id="p-pl" class="panel">
  <div class="h2">Profit & Loss Statement</div>
  <table class="t">
    <thead><tr><th style="width:60%;text-align:left">Particulars</th><th>Amount</th></tr></thead>
    <tbody>${plRows}</tbody>
  </table>
  <div style="font-size:9px;color:#6B7280;margin-top:8px">
    * COGS computed as: Opening Stock + Purchases (Trial Balance) − Closing Stock (Balance Sheet)<br>
    * Operating Expenses = Total Expenses − COGS. EBITDA adds back Depreciation only.
  </div>
</div>
<div class="rpt-ft">
  <span>AccountingIQ — MIS Report Group 1</span>
  <span>Generated ${ts}</span>
</div>
</div>
<script>
function show(id, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on'));
  document.getElementById('p-' + id).classList.add('on');
  el.classList.add('on');
}
</script>
</body>
</html>`;
}

// ── Main component ────────────────────────────────────────────────────────

export default function ReportsView() {
  const { state, dispatch } = useApp();
  const { results, filters, files, parsedData } = state;

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Run analysis first.{' '}
          <button
            className="underline"
            style={{ color: 'var(--teal)' }}
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
          >
            Upload files
          </button>
        </p>
      </div>
    );
  }

  const { cappedScore, scoreCapped, checks, dimScores, runAt } = results;
  const grade = getGrade(cappedScore);
  const runDate = new Date(runAt).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });

  const topFails = checks
    .filter(c => c.status === 'fail' || c.status === 'partial')
    .slice(0, 5);

  const filesLoaded = Object.entries(files)
    .filter(([, f]) => f.hasContent)
    .map(([, f]) => f.name);

  const dbStats = files.daybook.chunkedStats;

  const REPORT_BUTTONS = [
    {
      label: 'Full Analysis',
      desc: 'All 59 checks, dimension scores, company profile',
      fn: () => downloadReport(
        `AccountingIQ_Full_Analysis_${Date.now()}.html`,
        buildFullAnalysis(results, filters, filesLoaded),
      ),
    },
    {
      label: 'Executive Summary',
      desc: 'Score, grade, top issues & insights',
      fn: () => downloadReport(
        `AccountingIQ_Executive_Summary_${Date.now()}.html`,
        buildExecutiveSummary(results, parsedData, filters),
      ),
    },
    {
      label: 'Compliance Checklist',
      desc: 'Statutory (E-dim) and ledger/voucher checks',
      fn: () => downloadReport(
        `AccountingIQ_Compliance_Checklist_${Date.now()}.html`,
        buildComplianceChecklist(results, filters),
      ),
    },
    {
      label: 'Financial Health',
      desc: 'KPIs, ratios, BS/P&L highlights, health signals',
      fn: () => downloadReport(
        `AccountingIQ_Financial_Health_${Date.now()}.html`,
        buildFinancialHealth(parsedData, dbStats),
      ),
    },
    {
      label: 'Anomaly Report',
      desc: 'All flags sorted by severity',
      fn: () => downloadReport(
        `AccountingIQ_Anomaly_Report_${Date.now()}.html`,
        buildAnomalyReport(results, parsedData, dbStats),
      ),
    },
    {
      label: 'Voucher Analysis',
      desc: 'DayBook: narration %, high-value, duplicates, month distribution',
      fn: () => downloadReport(
        `AccountingIQ_Voucher_Analysis_${Date.now()}.html`,
        buildVoucherAnalysis(dbStats),
      ),
    },
    {
      label: 'MIS Report (Group 1)',
      desc: 'Cover · Dashboard · P&L — interactive tabbed HTML report',
      fn: () => downloadReport(
        `AccountingIQ_MIS_Group1_${Date.now()}.html`,
        buildMISGroup1(results, parsedData, filters, filesLoaded),
      ),
    },
  ];

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1
            className="text-2xl"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            Analysis Report
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
            {runDate}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          ⬡ Print / Save PDF
        </button>
      </div>

      {/* Download reports section */}
      <section className="mb-6 print:hidden">
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          Download Reports
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {REPORT_BUTTONS.map(btn => (
            <button
              key={btn.label}
              onClick={btn.fn}
              className="rounded-lg border px-4 py-3 text-left transition-colors"
              style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--teal)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
              }}
            >
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text1)' }}>
                ↓ {btn.label}
              </div>
              <div className="text-xs leading-snug" style={{ color: 'var(--text3)' }}>
                {btn.desc}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* MIS Report Group 1 in-app viewer */}
      <section className="mb-6">
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          MIS Report — Group 1
        </h2>
        <MISReportViewer results={results} parsedData={parsedData} filters={filters} files={files} />
      </section>

      {/* Score summary */}
      <div
        className="rounded-xl border p-6 mb-5"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <div>
            <div
              className="text-5xl font-bold"
              style={{ color: grade.color, fontFamily: 'var(--font-dm-serif)' }}
            >
              {grade.label}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>Grade</div>
          </div>
          <div
            className="w-px h-12 shrink-0"
            style={{ background: 'var(--border)' }}
          />
          <div>
            <div className="text-4xl font-bold" style={{ color: 'var(--text1)' }}>
              {cappedScore}
              <span className="text-base font-normal ml-1" style={{ color: 'var(--text3)' }}>/ 100</span>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
              {scoreCapped ? 'Score capped (DayBook missing)' : 'Overall score'}
            </div>
          </div>
        </div>
      </div>

      {/* Dimension scores */}
      <section className="mb-5">
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          Dimension Scores
        </h2>
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>Dimension</th>
                <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>Weight</th>
                <th className="text-right px-5 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>Score</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {DIMS.map(dim => (
                <tr key={dim}>
                  <td className="px-5 py-2.5">
                    <span className="font-mono text-xs mr-2" style={{ color: DIM_COLORS[dim] }}>{dim}</span>
                    <span style={{ color: 'var(--text1)' }}>{DIM_LABELS[dim]}</span>
                  </td>
                  <td className="px-5 py-2.5" style={{ color: 'var(--text3)' }}>{DIM_WEIGHTS[dim]}%</td>
                  <td className="px-5 py-2.5 text-right font-medium" style={{ color: 'var(--text1)' }}>
                    {dimScores[dim] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top failures */}
      {topFails.length > 0 && (
        <section className="mb-5">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--text3)' }}
          >
            Top Issues
          </h2>
          <div
            className="rounded-xl border overflow-hidden divide-y"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            {topFails.map(check => (
              <div key={check.id} className="px-5 py-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color: 'var(--text3)' }}>
                    {check.id}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--text1)' }}>
                    {check.name}
                  </span>
                </div>
                {check.note && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
                    {check.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Company profile */}
      <section className="mb-5">
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          Company Profile Applied
        </h2>
        <div
          className="rounded-xl border px-5 py-4 flex flex-wrap gap-2"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {Object.entries(filters).map(([key, val]) => (
            <span
              key={key}
              className="text-xs px-2 py-1 rounded"
              style={{
                background: val ? 'rgba(15,212,160,0.1)' : 'var(--bg4)',
                color: val ? 'var(--teal)' : 'var(--text3)',
              }}
            >
              {val ? '✓' : '✕'} {PROFILE_LABELS[key] ?? key}
            </span>
          ))}
        </div>
      </section>

      {/* Files */}
      <section>
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: 'var(--text3)' }}
        >
          Files Analysed
        </h2>
        <div
          className="rounded-xl border px-5 py-4"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {filesLoaded.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text3)' }}>None</p>
          ) : (
            <ul className="space-y-1">
              {filesLoaded.map((name, i) => (
                <li key={i} className="text-xs" style={{ color: 'var(--text2)' }}>
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// ── MIS Report Group 1 in-app viewer ─────────────────────────────────────

type MISTab = 'cover' | 'dashboard' | 'pl';

const MIS_TABS: { id: MISTab; label: string }[] = [
  { id: 'cover',     label: 'Cover' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pl',        label: 'P&L' },
];

function fmtPL(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '(' : '';
  const end  = n < 0 ? ')' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr${end}`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)} L${end}`;
  return `${sign}₹${abs.toLocaleString('en-IN')}${end}`;
}

function MISReportViewer({
  results,
  parsedData,
  filters,
  files,
}: {
  results: AnalysisResults;
  parsedData: Partial<ParsedData>;
  filters: CompanyProfile;
  files: Record<string, { hasContent: boolean; name: string }>;
}) {
  const [tab, setTab] = useState<MISTab>('cover');
  const grade = getGrade(results.cappedScore);

  const revenue      = parsedData.revenue      ?? 0;
  const netProfit    = parsedData.netProfit     ?? 0;
  const expenses     = parsedData.expenses      ?? 0;
  const depAmt       = parsedData.depAmt        ?? 0;
  const openingStock = parsedData.openingStock  ?? 0;
  const closingStock = parsedData.closingStock  ?? 0;
  const tbPurch      = parsedData.tbPurch       ?? 0;
  const ca           = parsedData.ca            ?? 0;
  const cl           = parsedData.cl            ?? 0;
  const bankBal      = parsedData.bankBal       ?? 0;
  const debtorBal    = parsedData.debtorBal     ?? 0;
  const creditorBal  = parsedData.creditorBal   ?? 0;

  const cogs        = (openingStock > 0 || tbPurch > 0) ? openingStock + tbPurch - closingStock : 0;
  const grossProfit = cogs > 0 ? revenue - cogs : 0;
  const opex        = cogs > 0 && expenses > 0 ? expenses - cogs : 0;
  const ebitda      = opex > 0 ? grossProfit - opex + depAmt : 0;
  const workingCap  = ca - cl;
  const currentRatio = ca > 0 && cl > 0 ? ca / cl : null;

  const filesLoaded = Object.values(files).filter(f => f.hasContent);
  const misReadiness = Math.round((filesLoaded.length / TOTAL_FILE_COUNT) * 100);
  const misScore     = Math.round(results.cappedScore * (misReadiness / 100));

  const PROFILE_LABELS_SHORT: Record<string, string> = {
    gstApplicable: 'GST',
    gstRegular:    'GST Regular',
    tdsApplicable: 'TDS',
    hasEmployees:  'Employees',
    hasFAfilter:   'Fixed Assets',
    isGoods:       'Goods Business',
    fullFY:        'Full FY',
  };

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      {/* Tab bar */}
      <div className="flex border-b items-center" style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}>
        <div className="px-4 py-2.5 text-xs font-bold shrink-0" style={{ color: 'var(--teal)', borderRight: '1px solid var(--border)' }}>
          MIS
        </div>
        {MIS_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-xs font-medium transition-colors shrink-0"
            style={{
              color:        tab === t.id ? 'var(--teal)' : 'var(--text3)',
              borderBottom: tab === t.id ? '2px solid var(--teal)' : '2px solid transparent',
              background:   'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="p-5" style={{ background: 'var(--bg2)' }}>

        {/* ── Cover ── */}
        {tab === 'cover' && (
          <div>
            {/* Score strip */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: 'Books Health (L1)', value: `${results.cappedScore}`, color: grade.color },
                { label: 'MIS Readiness',     value: `${misReadiness}%`,       color: 'var(--teal)' },
                { label: 'MIS Score',          value: `${misScore}`,            color: 'var(--teal)' },
              ].map(s => (
                <div
                  key={s.label}
                  className="rounded-xl border p-4 text-center"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}
                >
                  <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Profile tags */}
            <div className="mb-4">
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
                Company Profile
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(filters).map(([k, v]) => (
                  <span
                    key={k}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{
                      background: v ? 'rgba(15,212,160,0.12)' : 'var(--bg4)',
                      color:      v ? 'var(--teal)' : 'var(--text3)',
                    }}
                  >
                    {v ? '✓' : '✕'} {PROFILE_LABELS_SHORT[k] ?? k}
                  </span>
                ))}
              </div>
            </div>

            {/* Files */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
                Files Analysed ({filesLoaded.length} of {TOTAL_FILE_COUNT})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {filesLoaded.map(f => (
                  <span
                    key={f.name}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                  >
                    {f.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 text-xs" style={{ color: 'var(--text3)' }}>
              Analysed {new Date(results.runAt).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}
              &ensp;·&ensp;All data processed in-session only · Not stored · DPDPA 2023 compliant
            </div>
          </div>
        )}

        {/* ── Dashboard ── */}
        {tab === 'dashboard' && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Revenue',         value: revenue > 0    ? fmtPL(revenue)    : '—', sub: 'P&L turnover',              color: 'var(--teal)' },
                { label: 'Net Profit',      value: netProfit !== 0 ? fmtPL(netProfit)  : '—', sub: netProfit < 0 ? 'Loss year' : 'PAT', color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'Gross Margin',    value: cogs > 0 && revenue > 0 ? `${((grossProfit/revenue)*100).toFixed(1)}%` : '—', sub: 'Est. Revenue − COGS', color: 'var(--blue)' },
                { label: 'Cash & Bank',     value: bankBal > 0    ? fmtPL(bankBal)    : '—', sub: 'Balance Sheet closing',      color: 'var(--teal)' },
                { label: 'Trade Debtors',   value: debtorBal > 0  ? fmtPL(debtorBal)  : '—', sub: 'Receivables outstanding',    color: 'var(--amber)' },
                { label: 'Trade Creditors', value: creditorBal > 0 ? fmtPL(creditorBal): '—', sub: 'Payables outstanding',       color: 'var(--purple)' },
              ].map(kpi => (
                <div key={kpi.label} className="rounded-xl border px-4 py-3" style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{kpi.label}</div>
                  <div className="text-xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{kpi.sub}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Current Ratio',   value: currentRatio !== null ? `${currentRatio.toFixed(2)}×` : '—', sub: currentRatio !== null ? (currentRatio >= 1.5 ? 'Good liquidity' : currentRatio >= 1 ? 'Adequate' : 'Risk') : 'Needs BS', color: currentRatio !== null ? (currentRatio >= 1.5 ? 'var(--green)' : currentRatio >= 1 ? 'var(--amber)' : 'var(--red)') : 'var(--text3)' },
                { label: 'Working Capital', value: workingCap !== 0 ? fmtPL(workingCap) : '—', sub: workingCap >= 0 ? 'Positive' : 'Negative — monitor', color: workingCap >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'Net Margin',      value: revenue > 0 ? `${((netProfit/revenue)*100).toFixed(1)}%` : '—', sub: 'PAT ÷ Revenue', color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' },
              ].map(kpi => (
                <div key={kpi.label} className="rounded-xl border px-4 py-3" style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{kpi.label}</div>
                  <div className="text-xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{kpi.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── P&L ── */}
        {tab === 'pl' && (
          <div>
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ background: 'var(--bg4)' }}>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)', width: '60%' }}>Particulars</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Revenue from Operations', value: revenue,     bold: true,  bg: 'rgba(15,212,160,0.06)', indent: 0 },
                    revenue > 0 ? { label: 'Net Sales / Turnover', value: revenue,     bold: false, bg: 'transparent',            indent: 1 } : null,
                    cogs > 0    ? { label: 'Cost of Goods Sold',    value: -cogs,       bold: true,  bg: 'var(--bg3)',              indent: 0 } : null,
                    openingStock > 0 ? { label: 'Opening Stock',    value: openingStock, bold: false, bg: 'transparent',            indent: 2 } : null,
                    tbPurch > 0      ? { label: 'Purchases (Trial Balance)', value: tbPurch, bold: false, bg: 'transparent',        indent: 2 } : null,
                    closingStock > 0 ? { label: 'Less: Closing Stock', value: -closingStock, bold: false, bg: 'transparent',        indent: 2 } : null,
                    cogs > 0    ? { label: 'Gross Profit',          value: grossProfit, bold: true,  bg: 'rgba(15,212,160,0.06)', indent: 0 } : null,
                    opex > 0    ? { label: 'Operating Expenses',    value: -opex,       bold: true,  bg: 'var(--bg3)',              indent: 0 } : null,
                    ebitda > 0  ? { label: 'EBITDA',                value: ebitda,      bold: true,  bg: 'rgba(15,212,160,0.06)', indent: 0 } : null,
                    depAmt > 0  ? { label: 'Less: Depreciation',    value: -depAmt,     bold: false, bg: 'transparent',            indent: 1 } : null,
                    { label: 'Net Profit / (Loss)',     value: netProfit,   bold: true,  bg: netProfit >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(240,72,72,0.08)', indent: 0 },
                  ].filter(Boolean).map((row, i) => row && (
                    <tr key={i} style={{ background: row.bg, borderBottom: '1px solid var(--border)' }}>
                      <td
                        className={`py-2.5 text-xs ${row.bold ? 'font-semibold' : ''}`}
                        style={{ color: row.bold ? 'var(--text1)' : 'var(--text2)', paddingLeft: `${16 + row.indent * 20}px` }}
                      >
                        {row.label}
                      </td>
                      <td
                        className={`text-right px-4 py-2.5 text-xs font-mono ${row.bold ? 'font-semibold' : ''}`}
                        style={{ color: row.value < 0 ? 'var(--red)' : row.bold ? 'var(--text1)' : 'var(--text2)' }}
                      >
                        {row.value === 0 ? '—' : fmtPL(row.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text3)' }}>
              * COGS = Opening Stock + Purchases (Trial Balance) − Closing Stock (Balance Sheet).
              Operating Expenses = Total Expenses − COGS. EBITDA adds back Depreciation only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
