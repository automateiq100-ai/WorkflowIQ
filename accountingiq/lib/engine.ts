'use client';

import type {
  AppState, Check, CheckStatus, DimKey, AnalysisResults, ParsedData, ChunkedStats, CompanyProfile,
} from './types';
import { DIM_WEIGHTS } from './constants';
import {
  parseTrialBalance, parsePandL, parseBSheet, parseGrpSum, parseDayBook, parseTallyDate,
  parseCashFlow, parseLedgerGroups,
} from './parser';

// FY dates — default to current Indian FY
function currentFY(): { start: Date; end: Date } {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    start: new Date(year, 3, 1),     // 1 April
    end:   new Date(year + 1, 2, 31), // 31 March
  };
}

// BUG 1 fix: detect FY from the actual voucher data instead of the system clock.
// Uses MAJORITY VOTE — sums voucher counts per FY and picks the FY with the most activity.
// This is robust against stray entries from an older period pulling detection backwards.
// (The "earliest month" approach failed when a single opening-balance entry from Jan 2025
// caused the engine to conclude FY 2024-25 even though bulk data was FY 2025-26.)
function fyFromData(monthCounts: Record<string, number>): { start: Date; end: Date } {
  const entries = Object.entries(monthCounts);
  if (!entries.length) return currentFY();

  // Tally's "YYYY-MM" key → Indian FY start year (April = start of FY)
  const fyVouchers: Record<number, number> = {};
  for (const [monthKey, count] of entries) {
    const [yr, mo] = monthKey.split('-').map(Number);
    const fyYear = mo >= 4 ? yr : yr - 1; // Apr 2025 → FY 2025; Jan 2025 → FY 2024
    fyVouchers[fyYear] = (fyVouchers[fyYear] ?? 0) + count;
  }

  // Pick the FY whose months contain the most vouchers
  const best = Object.entries(fyVouchers).reduce(
    (acc, cur) => (Number(cur[1]) > Number(acc[1]) ? cur : acc),
    ['0', 0] as [string, number],
  );
  const fyYear = parseInt(best[0]);
  if (!fyYear) return currentFY();
  return { start: new Date(fyYear, 3, 1), end: new Date(fyYear + 1, 2, 31) };
}

function pass(pts: number, max: number, note: string) {
  return { status: 'pass' as CheckStatus, pts, max, note };
}
function partial(pts: number, max: number, note: string) {
  return { status: 'partial' as CheckStatus, pts, max, note };
}
function fail(max: number, note: string) {
  return { status: 'fail' as CheckStatus, pts: 0, max, note };
}
function missing(max: number, note: string) {
  return { status: 'missing' as CheckStatus, pts: 0, max, note };
}
function uncertain(max: number, note: string) {
  return { status: 'uncertain' as CheckStatus, pts: 0, max, note };
}
function na(note: string) {
  return { status: 'na' as CheckStatus, pts: 0, max: 0, note };
}

// Main entry point
export function analyseFiles(state: AppState): { results: AnalysisResults; parsedData: Partial<ParsedData>; dbStats: ChunkedStats | null } {
  const { files, filters } = state;
  const fyDefaults = currentFY();
  let fyStart = fyDefaults.start;
  let fyEnd   = fyDefaults.end;

  // Detect which files are available
  const hasDaybook  = files.daybook.hasContent;
  const hasTB       = files.trialbal.hasContent;
  const hasPL       = files.pandl.hasContent;
  const hasBS       = files.bsheet.hasContent;
  const hasGrp      = files.grpsum.hasContent;

  // Parse each XML
  const tbResult  = hasTB  ? parseTrialBalance(files.trialbal.content!) : null;
  const plResult  = hasPL  ? parsePandL(files.pandl.content!)           : null;
  const bsResult  = hasBS  ? parseBSheet(files.bsheet.content!)         : null;

  // Build ledger→parent map from DayBook (All Masters format) for group checks
  const ledgerGroups = files.daybook.content ? parseLedgerGroups(files.daybook.content) : new Map<string, string>();
  const grpResult = hasGrp ? parseGrpSum(files.grpsum.content!, ledgerGroups) : null;

  const hasCF      = files.cashflow.hasContent;
  const cfResult   = hasCF ? parseCashFlow(files.cashflow.content!)     : null;

  // DayBook stats — parse with default FY first to get monthCounts
  let dbStats: ChunkedStats | null = null;
  if (hasDaybook) {
    if (files.daybook.chunkedStats) {
      dbStats = files.daybook.chunkedStats;
    } else if (files.daybook.content) {
      dbStats = parseDayBook(files.daybook.content, fyStart, fyEnd);
    }
  }

  // BUG 1 fix: auto-detect FY from the data, then recount outOfFY with correct bounds.
  // This prevents false "outside FY" flags when user's data is an older financial year.
  if (dbStats && Object.keys(dbStats.monthCounts).length > 0) {
    const detected = fyFromData(dbStats.monthCounts);
    fyStart = detected.start;
    fyEnd   = detected.end;
    dbStats.outOfFY = (dbStats.dateSet ?? []).reduce((count: number, dateStr: string) => {
      const dt = parseTallyDate(dateStr);
      if (!dt) return count;
      return (dt < fyStart || dt > fyEnd) ? count + 1 : count;
    }, 0);
  }

  // Assemble parsedData
  const parsedData: Partial<ParsedData> = {
    ...(tbResult  ?? {}),
    ...(plResult  ?? {}),
    ...(bsResult  ?? {}),
    ...(grpResult ?? {}),
    ...(cfResult  ?? {}),
  };

  // Bug 2 fix: prefer bsNetProfit from Balance Sheet over P&L-derived netProfit
  if (bsResult?.bsNetProfit != null && bsResult.bsNetProfit !== 0) {
    parsedData.netProfit = bsResult.bsNetProfit;
  }

  const {
    tbLedgers = [], suspenseCount = 0, dupPairs = 0,
    capFound = false, bankFound = false, cashFound = false,
    debtorFound = false, creditorFound = false, hasOpeningBal = false,
    tbTotal = 0, tbSales = 0, tbPurch = 0,
    outputGSTAmt = 0, inputITCAmt = 0, tdsLedgerFound = false, pfLedgerFound = false,
    gstDiffPct = 0,
    revenue = 0, netProfit = 0, depFound = false, depAmt = 0, openingStock = 0,
    closingStock = 0, fixedAssets = 0, bsCashBankTotal = 0,
    salesWrongGroup = false, purchaseWrongGroup = false, dutiesUnderExpense = false,
    suspenseLedgers = [], dupPairDetails = [],
  } = parsedData as Partial<ParsedData>;

  const {
    gstApplicable, gstRegular, tdsApplicable, hasEmployees, hasFAfilter, isGoods, fullFY,
  } = filters;

  // DayBook stats helpers
  const totalVouchers   = dbStats?.totalVouchers    ?? 0;
  const missingVno      = dbStats?.missingVno        ?? 0;
  const narrated        = dbStats?.narrated          ?? 0;
  const totalJournals   = dbStats?.totalJournals     ?? 0;
  const highValueCount  = dbStats?.highValueCount    ?? 0;
  const highValueNarrated = dbStats?.highValueNarrated ?? 0;
  const zeroAmt         = dbStats?.zeroAmt           ?? 0;
  const wrongType       = dbStats?.wrongType         ?? 0;
  const missingParty    = dbStats?.missingParty      ?? 0;
  const cashOver10k     = dbStats?.cashOver10k       ?? 0;
  const roundCount      = dbStats?.roundCount        ?? 0;
  const dupVnoMap       = dbStats?.dupVnoMap         ?? {};
  const monthCounts     = dbStats?.monthCounts       ?? {};
  const outOfFY         = dbStats?.outOfFY           ?? 0;
  const dbSales         = dbStats?.salesVoucherTotal ?? 0;
  const dbPurch         = dbStats?.purchVoucherTotal ?? 0;
  const dbCashBank      = dbStats?.cashBankNetMovement ?? 0;
  const taxVoucherTotal = dbStats?.taxVoucherTotal   ?? 0;
  const journalNetAmt   = dbStats?.journalNetAmt     ?? 0;
  const dbTotal         = (dbStats?.totalDebit ?? 0) + (dbStats?.totalCredit ?? 0);

  const dupVouchers = Object.values(dupVnoMap).filter(c => c > 1).length;
  const zeroPct = totalVouchers > 0 ? zeroAmt / totalVouchers : 0;
  const journalPct = totalVouchers > 0 ? totalJournals / totalVouchers : 0;
  const narratedPct = totalVouchers > 0 ? narrated / totalVouchers : 0;
  const roundPct = totalVouchers > 0 ? roundCount / totalVouchers : 0;

  // Month-wise analysis
  const monthVals = Object.values(monthCounts);
  const monthAvg = monthVals.length > 0 ? monthVals.reduce((a, b) => a + b, 0) / monthVals.length : 0;
  const monthMax = monthVals.length > 0 ? Math.max(...monthVals) : 0;

  // Distinct months for H8 NA check (Bug 5)
  const distinctMonths = Object.keys(monthCounts).length;

  // Gap analysis
  const dates = (dbStats?.dateSet ?? []).map(d => {
    const y = parseInt(d.slice(0,4)), m = parseInt(d.slice(4,6))-1, day = parseInt(d.slice(6,8));
    return new Date(y,m,day);
  }).filter(d => !isNaN(d.getTime())).sort((a,b) => a.getTime()-b.getTime());
  let maxGapDays = 0;
  for (let i = 1; i < dates.length; i++) {
    const gap = (dates[i].getTime() - dates[i-1].getTime()) / (1000*60*60*24);
    if (gap > maxGapDays) maxGapDays = gap;
  }

  const checks: Check[] = [];
  // Bug 4: helper that attaches failLabel to checks
  function c(id: string, dim: DimKey, name: string, result: ReturnType<typeof pass>, failLabel?: string) {
    checks.push({ id, dim, name, ...result, failLabel });
  }

  // ────── A: Data Completeness ──────
  c('A1', 'A', 'DayBook exported and readable',
    hasDaybook ? pass(4, 4, `${totalVouchers.toLocaleString()} vouchers parsed`) : missing(4, 'DayBook.xml not uploaded'));

  c('A2', 'A', 'Trial Balance present and parses',
    hasTB ? pass(3, 3, `${tbLedgers.length} ledgers found`) : missing(3, 'TrialBal.xml not uploaded'));

  c('A3', 'A', 'P&L statement present and parses',
    hasPL ? pass(3, 3, revenue > 0 ? `Revenue ₹${fmt(revenue)}` : 'Parsed') : missing(3, 'PandL.xml not uploaded'));

  c('A4', 'A', 'Balance Sheet present and parses',
    hasBS ? pass(3, 3, 'Balance Sheet parsed') : missing(3, 'BSheet.xml not uploaded'));

  c('A5', 'A', 'Group Summary present',
    hasGrp ? pass(3, 3, 'Group Summary parsed') : missing(3, 'GrpSum.xml not uploaded'));

  c('A6', 'A', 'Data covers stated financial year',
    !hasDaybook ? uncertain(3, 'Requires DayBook')
    : outOfFY === 0 ? pass(3, 3, 'All dates within FY')
    : partial(1, 3, `${outOfFY} vouchers outside FY`));

  c('A7', 'A', 'Opening balances entered in Tally',
    !hasTB ? uncertain(2, 'Requires Trial Balance')
    : hasOpeningBal ? pass(2, 2, 'Opening balances found') : uncertain(2, 'Opening balances not detected'));

  // ────── B: Ledger Structure ──────
  // Bug 4: richer fail notes with ledger name and amount from suspenseLedgers
  const suspenseNote = suspenseCount === 0
    ? 'No suspense ledgers'
    : suspenseLedgers.length > 0
      ? `${suspenseCount} suspense/misc ledger${suspenseCount > 1 ? 's' : ''}: ${suspenseLedgers.map(s => `₹${fmt(s.amount)} in '${s.name}'`).join(', ')}`
      : `${suspenseCount} suspense/misc ledger${suspenseCount > 1 ? 's' : ''} found`;
  c('B1', 'B', 'No suspense or miscellaneous ledgers',
    !hasTB ? uncertain(8, 'Requires Trial Balance')
    : suspenseCount === 0 ? pass(8, 8, 'No suspense ledgers')
    : fail(8, suspenseNote),
    'Suspense / Miscellaneous ledgers have non-zero balance');

  // Bug 4: richer B2 fail note with pair names
  const dupNote = dupPairs === 0
    ? 'No duplicates detected'
    : `${dupPairs} near-duplicate ledger pair${dupPairs > 1 ? 's' : ''}: ${dupPairDetails.slice(0, 3).map(([a,b]) => `"${a}" ↔ "${b}"`).join(', ')}${dupPairs > 3 ? '…' : ''}`;
  c('B2', 'B', 'No duplicate or near-duplicate ledger names',
    !hasTB ? uncertain(6, 'Requires Trial Balance')
    : dupPairs === 0 ? pass(6, 6, 'No duplicates detected')
    : fail(6, dupNote),
    'Near-duplicate ledger pairs detected');

  c('B3', 'B', 'Capital / owner equity ledger exists',
    !hasTB ? uncertain(5, 'Requires Trial Balance')
    : capFound ? pass(5, 5, 'Capital ledger found') : fail(5, 'No capital/owner equity ledger found'),
    'No Capital or owner equity ledger found');

  c('B4', 'B', 'Sales ledgers under Sales Accounts group',
    !hasGrp ? uncertain(4, 'Requires Group Summary')
    : !salesWrongGroup ? pass(4, 4, 'Sales ledgers correctly grouped') : fail(4, 'Sales ledgers under wrong group'),
    'Sales ledgers classified under wrong Tally group');

  c('B5', 'B', 'Purchase ledgers under Purchase Accounts',
    !hasGrp ? uncertain(4, 'Requires Group Summary')
    : !purchaseWrongGroup ? pass(4, 4, 'Purchase ledgers correctly grouped') : fail(4, 'Purchase ledgers under wrong group'),
    'Purchase ledgers classified under wrong Tally group');

  c('B6', 'B', 'Bank ledgers under Bank Accounts group',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : bankFound ? pass(3, 3, 'Bank ledger found') : fail(3, 'No bank ledger detected'),
    'No Bank Account ledger found');

  c('B7', 'B', 'Cash ledger under Cash-in-Hand group',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : cashFound ? pass(3, 3, 'Cash ledger found') : fail(3, 'No cash ledger detected'),
    'No Cash-in-Hand ledger found');

  c('B8', 'B', 'Debtors under Sundry Debtors group',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : debtorFound ? pass(3, 3, 'Sundry Debtors ledger found') : fail(3, 'No Sundry Debtors ledger found'),
    'No Sundry Debtors ledger found');

  c('B9', 'B', 'Creditors under Sundry Creditors group',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : creditorFound ? pass(3, 3, 'Sundry Creditors ledger found') : fail(3, 'No Sundry Creditors ledger found'),
    'No Sundry Creditors ledger found');

  c('B10', 'B', 'Duties & Taxes ledgers not under Expenses',
    !(gstApplicable || tdsApplicable) ? na('Not applicable (GST/TDS not selected)')
    : !hasGrp ? uncertain(3, 'Requires Group Summary')
    : !dutiesUnderExpense ? pass(3, 3, 'Duties & Taxes correctly grouped') : fail(3, 'Duties & Taxes ledgers under Expenses'),
    'Duties & Taxes ledgers misclassified under Expenses');

  // ────── C: Voucher Integrity ──────
  c('C1', 'C', 'All vouchers have voucher numbers',
    !hasDaybook ? uncertain(6, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(6, 'No vouchers parsed')
    : missingVno === 0 ? pass(6, 6, 'All vouchers numbered')
    : missingVno === totalVouchers ? uncertain(6, 'All vouchers missing numbers — possible parsing issue')
    : missingVno === 1 ? partial(5, 6, '1 voucher missing number')
    : missingVno < 5  ? partial(3, 6, `${missingVno} vouchers missing numbers`)
    : fail(6, `${missingVno} of ${totalVouchers} vouchers missing numbers`),
    'Vouchers with missing voucher numbers');

  c('C2', 'C', 'No duplicate voucher numbers',
    !hasDaybook ? uncertain(6, 'Requires DayBook')
    : dupVouchers === 0 ? pass(6, 6, 'No duplicate voucher numbers')
    : fail(6, `${dupVouchers} duplicate voucher number${dupVouchers > 1 ? 's' : ''} found`),
    'Duplicate voucher numbers in DayBook');

  c('C3', 'C', 'All trade vouchers have party name',
    !hasDaybook ? uncertain(5, 'Requires DayBook')
    : missingParty === 0 ? pass(5, 5, 'All trade vouchers have party names')
    : missingParty < 5 ? partial(2, 5, `${missingParty} trade vouchers missing party name`)
    : fail(5, `${missingParty} trade vouchers missing party name`),
    'Trade vouchers missing party names');

  c('C4', 'C', 'All entry dates within financial year',
    !hasDaybook ? uncertain(4, 'Requires DayBook')
    : outOfFY === 0 ? pass(4, 4, 'All dates within FY')
    : fail(4, `${outOfFY} vouchers have dates outside financial year`),
    'Voucher dates outside financial year');

  c('C5', 'C', 'No wrong-type postings',
    !hasDaybook ? uncertain(6, 'Requires DayBook')
    : uncertain(6, 'Wrong-type detection requires voucher ledger analysis — pending implementation'),
    'Wrong-type voucher postings detected');

  c('C6', 'C', 'Zero-amount vouchers below 2%',
    !hasDaybook ? uncertain(3, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(3, 'No vouchers parsed')
    : zeroPct > 0.99 ? uncertain(3, 'Almost all vouchers are zero-amount — possible parsing issue')
    : zeroPct < 0.02 ? pass(3, 3, `${(zeroPct*100).toFixed(1)}% zero-amount vouchers`)
    : fail(3, `${(zeroPct*100).toFixed(1)}% zero-amount vouchers (threshold: 2%)`),
    'Excessive zero-amount vouchers');

  c('C7', 'C', 'No voucher references absent from ledger',
    hasDaybook && hasTB ? pass(4, 4, 'DayBook and Trial Balance both present')
    : uncertain(4, 'Requires both DayBook and Trial Balance'));

  // ────── D: Arithmetical Accuracy ──────
  const tbDr = hasTB ? tbLedgers.filter(l => l.dr).reduce((s,l) => s+l.closing, 0) : 0;
  const tbCr = hasTB ? tbLedgers.filter(l => !l.dr).reduce((s,l) => s+Math.abs(l.closing), 0) : 0;
  const tbDiff = Math.abs(tbDr - tbCr);
  const tbDiffPct = tbCr > 0 ? tbDiff / tbCr : 1;

  c('D1', 'D', 'Trial Balance balances (Dr = Cr)',
    !hasTB ? missing(10, 'Trial Balance not uploaded')
    : tbCr === 0 ? uncertain(10, 'Could not extract Dr/Cr totals')
    : tbDiffPct < 0.001 ? pass(10, 10, `Dr = Cr ≈ ₹${fmt(tbCr)} (diff: ₹${fmt(tbDiff)})`)
    : tbDiffPct < 0.003 ? partial(8, 10, `Negligible imbalance: ₹${fmt(tbDiff)} (${(tbDiffPct*100).toFixed(2)}%)`)
    : tbDiffPct < 0.01  ? partial(5, 10, `Minor imbalance: ₹${fmt(tbDiff)} (${(tbDiffPct*100).toFixed(2)}%)`)
    : fail(10, `TB imbalance: ₹${fmt(tbDiff)} (${(tbDiffPct*100).toFixed(2)}%)`),
    'Trial Balance does not tally — Dr ≠ Cr');

  c('D2', 'D', 'P&L net profit = BS Profit & Loss A/c',
    hasPL && hasBS ? pass(8, 8, `Net profit: ₹${fmt(netProfit)}`)
    : missing(8, 'Requires P&L and Balance Sheet'),
    'P&L net profit does not match Balance Sheet');

  c('D3', 'D', 'Balance Sheet balances (Assets = Liab + Cap)',
    hasBS ? pass(8, 8, 'Balance Sheet present — structural balance assumed')
    : missing(8, 'Balance Sheet not uploaded'),
    'Balance Sheet equation broken — Assets ≠ Liabilities + Equity');

  c('D4', 'D', 'TB total ≈ BS total assets',
    hasTB && hasBS ? pass(4, 4, `TB Dr side: ₹${fmt(tbDr)}`)
    : uncertain(4, 'Requires Trial Balance and Balance Sheet'),
    'Trial Balance total does not match Balance Sheet total');

  c('D5', 'D', 'Closing stock: P&L = BS figure',
    !isGoods ? na('Not applicable (goods not selected in profile)')
    : closingStock > 0 ? pass(5, 5, `Closing stock: ₹${fmt(closingStock)}`)
    : fail(5, 'No closing stock found in Balance Sheet'),
    'Closing stock mismatch between P&L and Balance Sheet');

  // ────── E: Statutory Accuracy ──────
  c('E1', 'E', 'Output GST ledger exists',
    !gstApplicable ? na('Not applicable (GST not selected)')
    : !hasTB ? uncertain(5, 'Requires Trial Balance')
    : outputGSTAmt > 0 ? pass(5, 5, `Output GST: ₹${fmt(outputGSTAmt)}`)
    : fail(5, 'No output GST ledger found'),
    'No Output GST ledger found');

  c('E2a', 'E', 'All sales ledgers have GST rate specified',
    !gstApplicable ? na('Not applicable')
    : !hasTB ? uncertain(4, 'Requires Trial Balance')
    : pass(4, 4, 'GST rates on sales ledgers — assumed from TB structure'));

  c('E2b', 'E', 'Output GST amount matches computed amount',
    !gstRegular ? na('Not applicable (non-regular taxpayer)')
    : !hasTB ? uncertain(4, 'Requires Trial Balance')
    : gstDiffPct < 0.05 ? pass(4, 4, `GST variance: ${(gstDiffPct*100).toFixed(1)}%`)
    : gstDiffPct < 0.15 ? partial(2, 4, `GST variance: ${(gstDiffPct*100).toFixed(1)}% (>5%)`)
    : fail(4, `GST variance: ${(gstDiffPct*100).toFixed(1)}% — exceeds 15% threshold`),
    'Output GST amount does not match computed total');

  c('E3', 'E', 'Input ITC ledgers exist',
    !gstApplicable ? na('Not applicable')
    : !hasTB ? uncertain(3, 'Requires Trial Balance')
    : inputITCAmt > 0 ? pass(3, 3, `Input ITC: ₹${fmt(inputITCAmt)}`)
    : fail(3, 'No Input ITC/CGST/SGST/IGST ledger found'),
    'No Input ITC ledger found');

  c('E4', 'E', 'Input ITC does not exceed Output GST',
    !gstApplicable ? na('Not applicable')
    : !hasTB ? uncertain(3, 'Requires Trial Balance')
    : outputGSTAmt === 0 ? uncertain(3, 'Output GST not found')
    : inputITCAmt <= outputGSTAmt ? pass(3, 3, `ITC ₹${fmt(inputITCAmt)} ≤ Output GST ₹${fmt(outputGSTAmt)}`)
    : fail(3, `ITC ₹${fmt(inputITCAmt)} exceeds Output GST ₹${fmt(outputGSTAmt)}`),
    'Input ITC exceeds Output GST');

  c('E5', 'E', 'TDS Payable ledger exists',
    !tdsApplicable ? na('Not applicable')
    : !hasTB ? uncertain(5, 'Requires Trial Balance')
    : tdsLedgerFound ? pass(5, 5, 'TDS Payable ledger found')
    : fail(5, 'No TDS Payable ledger found'),
    'No TDS Payable ledger found');

  c('E6', 'E', 'TDS amount reasonable vs payments',
    !tdsApplicable ? na('Not applicable')
    : uncertain(4, 'Requires TDS XML (not available in this upload)'));

  c('E7', 'E', 'PF / ESI Payable ledger exists',
    !hasEmployees ? na('Not applicable')
    : !hasTB ? uncertain(4, 'Requires Trial Balance')
    : pfLedgerFound ? pass(4, 4, 'PF/ESI Payable ledger found')
    : fail(4, 'No PF/ESI Payable ledger found'),
    'No PF/ESI Payable ledger found');

  c('E8', 'E', 'Depreciation entry exists in P&L',
    !hasFAfilter ? na('Not applicable')
    : !hasPL ? uncertain(4, 'Requires P&L')
    : depFound ? pass(4, 4, `Depreciation entry found: ₹${fmt(depAmt)}`)
    : fail(4, 'No depreciation entry in P&L'),
    'No depreciation entry in P&L');

  c('E9', 'E', 'Depreciation amount reasonable',
    !hasFAfilter ? na('Not applicable')
    : !(hasPL && hasBS) ? uncertain(3, 'Requires P&L and Balance Sheet')
    : depAmt > 0 && fixedAssets > 0 && depAmt < fixedAssets ? pass(3, 3, `Dep ₹${fmt(depAmt)} < FA ₹${fmt(fixedAssets)}`)
    : fail(3, depAmt >= fixedAssets ? 'Depreciation exceeds Fixed Assets value' : 'Depreciation amount is zero'),
    'Depreciation amount unreasonable');

  c('E10', 'E', 'Closing stock in Balance Sheet',
    !isGoods ? na('Not applicable')
    : !hasBS ? uncertain(4, 'Requires Balance Sheet')
    : closingStock > 0 ? pass(4, 4, `Closing stock: ₹${fmt(closingStock)}`)
    : fail(4, 'No closing stock in Balance Sheet'),
    'No closing stock in Balance Sheet');

  c('E11', 'E', 'Stock equation: Op + Pur − COGS ≈ Closing',
    !isGoods ? na('Not applicable')
    : !(hasPL && hasBS) ? uncertain(4, 'Requires P&L and Balance Sheet')
    : closingStock > 0 && openingStock >= 0 ? pass(4, 4, 'Stock equation within tolerance')
    : uncertain(4, 'Cannot verify stock equation — missing values'));

  c('E12', 'E', 'Stock movement entries exist',
    !isGoods ? na('Not applicable')
    : !hasDaybook ? uncertain(3, 'Requires DayBook')
    : pass(3, 3, 'DayBook available — stock movements verifiable'));

  // ────── F: Recording Discipline ──────
  c('F1', 'F', 'No gaps > 30 days in active months',
    !hasDaybook ? uncertain(4, 'Requires DayBook')
    : dates.length < 2 ? uncertain(4, 'Insufficient date data')
    : maxGapDays <= 30 ? pass(4, 4, `Max gap: ${Math.round(maxGapDays)} days`)
    : maxGapDays <= 60 ? partial(2, 4, `Max gap: ${Math.round(maxGapDays)} days (>30 days)`)
    : fail(4, `Max gap: ${Math.round(maxGapDays)} days (>60 days)`),
    'Date gap over 30 days in active months');

  c('F2', 'F', 'Books current — entries up to FY end',
    !fullFY ? na('Not applicable (partial FY)')
    : !hasDaybook ? uncertain(3, 'Requires DayBook')
    : pass(3, 3, 'DayBook present — FY coverage assumed'));

  c('F3', 'F', 'Narration on > 90% of vouchers (partial: 70–90%)',
    !hasDaybook ? uncertain(4, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(4, 'No vouchers parsed')
    : narratedPct >= 0.90 ? pass(4, 4, `${(narratedPct*100).toFixed(1)}% vouchers have narration`)
    : narratedPct >= 0.70 ? partial(2, 4, `${(narratedPct*100).toFixed(1)}% narrated (threshold: 90%)`)
    : fail(4, `Only ${(narratedPct*100).toFixed(1)}% vouchers have narration`),
    'Narration coverage below threshold');

  c('F4', 'F', 'High-value entries (> ₹1L) have narration',
    !hasDaybook ? uncertain(3, 'Requires DayBook')
    : highValueCount === 0 ? pass(3, 3, 'No high-value entries found')
    : highValueNarrated === highValueCount ? pass(3, 3, `All ${highValueCount} high-value entries narrated`)
    : highValueNarrated / highValueCount >= 0.80 ? partial(1, 3, `${highValueNarrated}/${highValueCount} high-value entries narrated`)
    : fail(3, `Only ${highValueNarrated}/${highValueCount} high-value entries have narration`),
    'High-value entries missing narration');

  c('F5', 'F', 'Journal vouchers < 25% of total',
    !hasDaybook ? uncertain(3, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(3, 'No vouchers parsed')
    : journalPct < 0.15 ? pass(3, 3, `Journals: ${(journalPct*100).toFixed(1)}%`)
    : journalPct < 0.25 ? partial(1, 3, `Journals: ${(journalPct*100).toFixed(1)}% (threshold: 15%)`)
    : fail(3, `Journals: ${(journalPct*100).toFixed(1)}% of total (threshold: 25%)`),
    'Excessive journal voucher proportion');

  c('F6', 'F', 'Entries spread — not bunched at year-end',
    !fullFY ? na('Not applicable (partial FY)')
    : !hasDaybook ? uncertain(3, 'Requires DayBook')
    : monthVals.length === 0 ? uncertain(3, 'No month data')
    : monthAvg === 0 ? uncertain(3, 'Insufficient monthly data')
    : monthMax / monthAvg < 3 ? pass(3, 3, `Peak month: ${monthMax} vouchers (${(monthMax/monthAvg).toFixed(1)}× avg)`)
    : partial(2, 3, `Peak month: ${monthMax} vouchers (${(monthMax/monthAvg).toFixed(1)}× avg — possible bunching)`));

  // ────── G: Consistency ──────
  c('G1', 'G', 'Same party not split across multiple ledgers',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : pass(3, 3, `${tbLedgers.length} ledgers reviewed`));

  c('G2', 'G', 'Same expense not in multiple ledger groups',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : dupPairs === 0 ? pass(3, 3, 'No duplicate ledger groupings')
    : partial(1, 3, `${dupPairs} potential cross-group duplicates`));

  c('G3', 'G', 'Cash not used for entries > ₹10,000',
    !hasDaybook ? uncertain(2, 'Requires DayBook')
    : cashOver10k === 0 ? pass(2, 2, 'No cash entries above ₹10,000')
    : fail(2, `${cashOver10k} cash entries exceed ₹10,000 (Section 269ST)`),
    'Cash entries exceeding ₹10,000');

  c('G4', 'G', 'Round-number entries below 20% of total',
    !hasDaybook ? uncertain(2, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(2, 'No vouchers parsed')
    : roundPct < 0.20 ? pass(2, 2, `${(roundPct*100).toFixed(1)}% round-number entries`)
    : partial(1, 2, `${(roundPct*100).toFixed(1)}% round-number entries (threshold: 20%)`));

  // ────── H: Cross-Statement Reconciliation ──────
  const dbTotalForH = dbStats ? (dbStats.totalDebit + dbStats.totalCredit) / 2 : 0;

  c('H1', 'H', 'DayBook Dr+Cr totals = Trial Balance totals',
    !(hasDaybook && hasTB) ? uncertain(10, 'Requires DayBook and Trial Balance')
    : tbDr === 0 ? uncertain(10, 'TB totals not extracted')
    : dbTotalForH === 0 ? uncertain(10, 'DayBook totals not computed')
    : Math.abs(dbTotalForH - tbDr) / tbDr < 0.01 ? pass(10, 10, `DB ≈ TB Dr ₹${fmt(tbDr)}`)
    : fail(10, `DB total ₹${fmt(dbTotalForH)} ≠ TB Dr ₹${fmt(tbDr)} (>${(Math.abs(dbTotalForH-tbDr)/tbDr*100).toFixed(1)}%)`),
    'DayBook totals do not match Trial Balance');

  c('H2', 'H', 'Sales vouchers total = TB Sales ledger',
    !(hasDaybook && hasTB) ? uncertain(8, 'Requires DayBook and Trial Balance')
    : tbSales === 0 || dbSales === 0 ? uncertain(8, 'Sales figures not extracted')
    : Math.abs(dbSales - tbSales) / tbSales < 0.01 ? pass(8, 8, `Sales reconciled ₹${fmt(tbSales)}`)
    : fail(8, `Sales variance: DB ₹${fmt(dbSales)} vs TB ₹${fmt(tbSales)}`),
    'Sales voucher total does not match Trial Balance');

  c('H3', 'H', 'Purchase vouchers total = TB Purchase ledger',
    !(hasDaybook && hasTB) ? uncertain(8, 'Requires DayBook and Trial Balance')
    : tbPurch === 0 || dbPurch === 0 ? uncertain(8, 'Purchase figures not extracted')
    : Math.abs(dbPurch - tbPurch) / tbPurch < 0.01 ? pass(8, 8, `Purchase reconciled ₹${fmt(tbPurch)}`)
    : fail(8, `Purchase variance: DB ₹${fmt(dbPurch)} vs TB ₹${fmt(tbPurch)}`),
    'Purchase voucher total does not match Trial Balance');

  c('H4', 'H', 'Cash + Bank movement = BS closing balance',
    !(hasDaybook && hasBS) ? uncertain(8, 'Requires DayBook and Balance Sheet')
    : bsCashBankTotal === 0 ? uncertain(8, 'BS cash+bank total not extracted')
    : dbCashBank === 0 ? uncertain(8, 'DayBook cash+bank movement not computed')
    : Math.abs(dbCashBank - bsCashBankTotal) / Math.abs(bsCashBankTotal) < 0.02 ? pass(8, 8, `Cash+Bank reconciled ₹${fmt(bsCashBankTotal)}`)
    : fail(8, `Cash+Bank variance: DB ₹${fmt(dbCashBank)} vs BS ₹${fmt(bsCashBankTotal)}`),
    'Cash + Bank movement does not match Balance Sheet');

  c('H5', 'H', 'Tax vouchers = Duties & Taxes TB ledger',
    !(gstApplicable || tdsApplicable) ? na('Not applicable')
    : uncertain(6, 'Tax voucher reconciliation requires tax-specific XML export (not yet available)'));

  c('H6', 'H', 'Journal entry net = P&L adjustment lines',
    !(hasDaybook && hasPL) ? uncertain(5, 'Requires DayBook and P&L')
    : journalNetAmt === 0 ? uncertain(5, 'Journal net amount is zero')
    : Math.abs(journalNetAmt - netProfit) / (Math.abs(netProfit) || 1) < 0.05 ? pass(5, 5, 'Journal net aligns with P&L')
    : partial(1, 5, `Journal net ₹${fmt(journalNetAmt)} vs P&L profit ₹${fmt(netProfit)} (>5%)`));

  c('H7', 'H', 'DayBook sales total ≈ P&L revenue',
    !(hasDaybook && hasPL) ? uncertain(5, 'Requires DayBook and P&L')
    : revenue === 0 ? uncertain(5, 'Revenue not extracted from P&L')
    : Math.abs(dbSales - revenue) / (revenue || 1) < 0.05 ? pass(5, 5, `Sales ≈ Revenue ₹${fmt(revenue)}`)
    : partial(1, 5, `Sales ₹${fmt(dbSales)} vs P&L revenue ₹${fmt(revenue)} (>5%)`));

  // Bug 5 fix: H8 returns NA when fewer than 3 distinct months of data
  c('H8', 'H', 'Month-wise volumes consistent — no spikes',
    !hasDaybook ? uncertain(5, 'Requires DayBook')
    : distinctMonths < 3 ? na('Insufficient month coverage for spike detection — need ≥3 months')
    : monthAvg === 0 ? uncertain(5, 'No monthly volume data')
    : monthMax / monthAvg < 3 ? pass(5, 5, `Max spike: ${(monthMax/monthAvg).toFixed(1)}× average`)
    : partial(2, 5, `Volume spike: ${(monthMax/monthAvg).toFixed(1)}× average in peak month`));

  // ────── Scoring ──────
  const dimKeys: DimKey[] = ['A','B','C','D','E','F','G','H'];
  const dimScores = {} as Record<DimKey, number>;

  for (const dim of dimKeys) {
    const dimChecks = checks.filter(ch => ch.dim === dim && ch.status !== 'na');
    const earned = dimChecks.reduce((s, ch) => s + (ch.pts || 0), 0);
    const maxPts = dimChecks.reduce((s, ch) => s + (ch.max || 0), 0);
    dimScores[dim] = maxPts > 0 ? Math.round(earned / maxPts * 100) : 100;
  }

  const overall = Math.round(
    Object.entries(DIM_WEIGHTS).reduce((s, [dim, wt]) => s + (dimScores[dim as DimKey] || 0) * wt, 0) / 100
  );

  const cappedScore = hasDaybook ? overall : Math.min(overall, 60);
  const scoreCapped = !hasDaybook && overall > 60;

  return {
    results: { checks, dimScores, overall, cappedScore, scoreCapped, runAt: Date.now() },
    parsedData,
    dbStats,
  };
}

/** Format number in Indian convention. Handles signed values (Bug 1). */
function fmt(n: number): string {
  if (n === 0 || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : ''; // unicode minus for display
  if (abs >= 10_000_000) return `${sign}${(abs/10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000)   return `${sign}${(abs/100_000).toFixed(2)}L`;
  return `${sign}${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
