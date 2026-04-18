'use client';

import type { TBLedger, ParsedData, ChunkedStats } from './types';

// ── XML helpers ──────────────────────────────────────────────────────────

/** Extract first text content of a tag */
export function xmlText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : '';
}

/** Extract all text contents of a tag */
export function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(decodeEntities(m[1].trim()));
  }
  return results;
}

/** Parse amount string — handles commas, negatives, Tally's minus prefix */
export function parseAmt(s: string): number {
  if (!s) return 0;
  const clean = s.replace(/,/g, '').trim();
  return parseFloat(clean) || 0;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Extract amount — tries multiple tags in fallback order.
 *  NOTE: Uses Math.abs() because voucher amounts are always positive quantities.
 *  For BS/PL amounts where sign matters, use parseAmt() directly. */
export function extractAmt(voucherXml: string): number {
  for (const tag of ['AMOUNT', 'DSPAMT', 'BSSUBAMT']) {
    const v = xmlText(voucherXml, tag);
    if (v) return Math.abs(parseAmt(v));
  }
  // Try inside ALLLEDGERENTRIES.LIST
  const entries = xmlAll(voucherXml, 'AMOUNT');
  if (entries.length > 0) return Math.abs(parseAmt(entries[0]));
  return 0;
}

/** Parse DayBook YYYYMMDD date format */
export function parseTallyDate(s: string): Date | null {
  if (!s || s.length < 8) return null;
  const y = parseInt(s.slice(0, 4));
  const mo = parseInt(s.slice(4, 6)) - 1;
  const d = parseInt(s.slice(6, 8));
  const dt = new Date(y, mo, d);
  return isNaN(dt.getTime()) ? null : dt;
}

// ── Trial Balance parser ─────────────────────────────────────────────────

export function parseTrialBalance(xml: string): {
  tbLedgers: TBLedger[];
  suspenseCount: number;
  dupPairs: number;
  capFound: boolean;
  bankFound: boolean;
  cashFound: boolean;
  debtorFound: boolean;
  creditorFound: boolean;
  hasOpeningBal: boolean;
  tbTotal: number;
  tbSales: number;
  tbPurch: number;
  outputGSTAmt: number;
  inputITCAmt: number;
  tdsLedgerFound: boolean;
  pfLedgerFound: boolean;
  salesLedgersNoRate: number;
  gstDiffPct: number;
  suspenseLedgers: Array<{ name: string; amount: number }>;
  dupPairDetails: Array<[string, string]>;
} {
  const tbLedgers: TBLedger[] = [];

  // Tally display-report format: DSPDISPNAME + DSPCLAMTA pairs
  // Try pairing by scanning for DSPACCNAME blocks first
  const blockRe = /<DSPACCNAME\b[^>]*>([\s\S]*?)<\/DSPACCNAME>\s*<DSPACCINFO\b[^>]*>([\s\S]*?)<\/DSPACCINFO>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const nameBlock = m[1];
    const infoBlock = m[2];
    const name = xmlText(nameBlock, 'DSPDISPNAME');
    if (!name) continue;
    const closingStr = xmlText(infoBlock, 'DSPCLAMTA');
    const closing = parseAmt(closingStr);
    // Bug 1 fix: preserve sign. Dr = positive, Cr = negative in Tally TB convention
    tbLedgers.push({ name, nl: name.toLowerCase(), closing, dr: closing >= 0 });
  }

  // Fallback: flat DSPDISPNAME + DSPCLAMTA zip (used when blocks aren't paired above)
  if (tbLedgers.length === 0) {
    const names = xmlAll(xml, 'DSPDISPNAME');
    const amounts = xmlAll(xml, 'DSPCLAMTA');
    const minLen = Math.min(names.length, amounts.length);
    for (let i = 0; i < minLen; i++) {
      const name = names[i];
      const closing = parseAmt(amounts[i]);
      tbLedgers.push({ name, nl: name.toLowerCase(), closing, dr: closing >= 0 });
    }
  }

  // Classic import-format fallback (LEDGER blocks)
  if (tbLedgers.length === 0) {
    const ledgerRe = /<LEDGER\b[^>]*>([\s\S]*?)<\/LEDGER>/gi;
    while ((m = ledgerRe.exec(xml)) !== null) {
      const block = m[1];
      const name = xmlText(block, 'NAME') || xmlText(block, 'LEDGERNAME');
      if (!name) continue;
      const closingStr = xmlText(block, 'CLOSINGBALANCE') || xmlText(block, 'CLOSINGBAL');
      const closing = parseAmt(closingStr);
      tbLedgers.push({ name, nl: name.toLowerCase(), closing, dr: closing >= 0 });
    }
  }

  // Flags
  let suspenseCount = 0;
  const suspenseLedgers: Array<{ name: string; amount: number }> = [];
  let capFound = false;
  let bankFound = false;
  let cashFound = false;
  let debtorFound = false;
  let creditorFound = false;
  let outputGSTAmt = 0;
  let inputITCAmt = 0;
  let tdsLedgerFound = false;
  let pfLedgerFound = false;
  let tbSales = 0;
  let tbPurch = 0;

  for (const l of tbLedgers) {
    const n = l.nl;
    if (n.includes('suspense') || n.includes('miscellaneous') || n.includes('misc')) {
      suspenseCount++;
      suspenseLedgers.push({ name: l.name, amount: l.closing });
    }
    if (n.includes('capital') || n.includes('owner') || n.includes('proprietor') || n.includes('partner')) capFound = true;
    if (n.includes('bank') || /hdfc|icici|sbi|axis|kotak|yes bank/.test(n)) bankFound = true;
    if (n === 'cash' || n.includes('cash in hand') || n.includes('petty cash')) cashFound = true;
    if (n.includes('sundry debtor') || n.includes('trade receiv')) debtorFound = true;
    if (n.includes('sundry creditor') || n.includes('trade payable')) creditorFound = true;
    if (n.includes('output gst') || n.includes('output cgst') || n.includes('output sgst') || n.includes('output igst') || n.includes('gst payable') || n.includes('cgst payable') || n.includes('sgst payable') || n.includes('igst payable')) outputGSTAmt += Math.abs(l.closing);
    if (n.includes('input gst') || n.includes('input cgst') || n.includes('input sgst') || n.includes('input igst') || n.includes('itc') || n.includes('gst receivable')) inputITCAmt += Math.abs(l.closing);
    if (n.includes('tds payable') || n.includes('tds on') || (n.includes('tax deducted') && n.includes('source'))) tdsLedgerFound = true;
    if (n.includes('pf payable') || n.includes('esi payable') || n.includes('provident fund') || n.includes('employees state')) pfLedgerFound = true;
    if (n.includes('sales') || n.includes('revenue from')) tbSales += Math.abs(l.closing);
    if (n.includes('purchase') || n.includes('cost of goods')) tbPurch += Math.abs(l.closing);
  }

  // Duplicate detection — Bug 3 fix: three-stage algorithm per spec §4 B2
  // Stage 1: cleaned-identical (after stemming)
  // Stage 2: sibling-exception (trailing token is A/B/C/CGST/SGST/IGST/etc.)
  // Stage 3: Levenshtein similarity ≥ 0.92
  const nlNames = tbLedgers.map(l => l.nl);
  let dupPairs = 0;
  const dupPairDetails: Array<[string, string]> = [];
  for (let i = 0; i < nlNames.length; i++) {
    for (let j = i + 1; j < nlNames.length; j++) {
      if (isDuplicate(nlNames[i], nlNames[j])) {
        dupPairs++;
        dupPairDetails.push([tbLedgers[i].name, tbLedgers[j].name]);
      }
    }
  }

  const hasOpeningBal = xml.toLowerCase().includes('dspopaamt') || xml.toLowerCase().includes('openingbalance') || xml.toLowerCase().includes('opening stock');
  const tbTotal = tbLedgers.reduce((s, l) => s + Math.abs(l.closing), 0);

  return {
    tbLedgers, suspenseCount, dupPairs, capFound, bankFound, cashFound,
    debtorFound, creditorFound, hasOpeningBal, tbTotal, tbSales, tbPurch,
    outputGSTAmt, inputITCAmt, tdsLedgerFound, pfLedgerFound,
    salesLedgersNoRate: 0,
    gstDiffPct: 0,
    suspenseLedgers,
    dupPairDetails,
  };
}

// ── Near-duplicate detection (Bug 3 fix) ──────────────────────────────────

/** Stem a word: strip trailing 'es', 's', 'ing' for comparison */
function stem(word: string): string {
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return word;
}

/** Clean name: lowercase, strip whitespace and punctuation */
function cleanName(s: string): string {
  return s.replace(/[\s\-_\/\\.,;:!?'"()%]+/g, '').toLowerCase();
}

/** Stem-clean: clean + stem each word */
function stemClean(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').trim().split(/\s+/).map(stem).join('');
}

/** Trailing-token sibling exception pattern */
const SIBLING_TOKEN_RE = /^(a|b|c|d|e|[0-9]+%?|cgst|sgst|igst|cr|dr|v[0-9]+|9%|18%|12%|5%)$/i;

/** Check if two names differ only by a trailing sibling token */
function isSiblingVariant(a: string, b: string): boolean {
  const tokensA = a.toLowerCase().replace(/[^\w\s%]/g, '').trim().split(/\s+/);
  const tokensB = b.toLowerCase().replace(/[^\w\s%]/g, '').trim().split(/\s+/);

  // Try: a has one more trailing token than b, and that token is a sibling marker
  if (tokensA.length === tokensB.length + 1) {
    const prefix = tokensA.slice(0, -1).join(' ');
    const bJoined = tokensB.join(' ');
    if (prefix === bJoined && SIBLING_TOKEN_RE.test(tokensA[tokensA.length - 1])) return true;
  }
  if (tokensB.length === tokensA.length + 1) {
    const prefix = tokensB.slice(0, -1).join(' ');
    const aJoined = tokensA.join(' ');
    if (prefix === aJoined && SIBLING_TOKEN_RE.test(tokensB[tokensB.length - 1])) return true;
  }

  // Both same length — last tokens differ and both are sibling markers, or one is
  if (tokensA.length === tokensB.length && tokensA.length > 1) {
    const prefixA = tokensA.slice(0, -1).join(' ');
    const prefixB = tokensB.slice(0, -1).join(' ');
    if (prefixA === prefixB) {
      const lastA = tokensA[tokensA.length - 1];
      const lastB = tokensB[tokensB.length - 1];
      if (lastA !== lastB && (SIBLING_TOKEN_RE.test(lastA) || SIBLING_TOKEN_RE.test(lastB))) {
        return true;
      }
    }
  }

  return false;
}

/** Levenshtein distance */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Levenshtein similarity ratio (0–1) */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Three-stage near-duplicate detection (Bug 3 fix)
 * Returns true if two ledger names are likely duplicates.
 */
function isDuplicate(a: string, b: string): boolean {
  if (a === b) return false; // identical names are not "near-duplicate pairs"

  // Stage 2 first (sibling exception): if they're just sibling variants, NOT duplicates
  if (isSiblingVariant(a, b)) return false;

  // Stage 1: cleaned-identical match (with stemming)
  const stemA = stemClean(a);
  const stemB = stemClean(b);
  if (stemA === stemB) return true;

  // Also check cleaned (no stemming) for exact match
  const cleanA = cleanName(a);
  const cleanB = cleanName(b);
  if (cleanA === cleanB) return true;

  // Stage 3: Levenshtein-based, threshold ≥ 0.92
  if (Math.abs(a.length - b.length) > 6) return false; // quick reject
  const sim = similarity(cleanA, cleanB);
  if (sim >= 0.92) return true;

  return false;
}

// Export for testing
export { isDuplicate, isSiblingVariant, stemClean, similarity };

// ── P&L parser ────────────────────────────────────────────────────────────

/**
 * Bug 2 fix: Only sum group-level totals (BSMAINAMT inside <PLAMT>) for revenue/expense.
 * Exclude GST/TDS ledgers from revenue even if they appear under Income groups.
 * Revenue = sum of group-level lines matching Sales Accounts / Direct Incomes / Indirect Incomes.
 * Ledgers matching /(cgst|sgst|igst|output tax|duties and taxes|tds)/i are excluded.
 *
 * Revenue includes Other Income (per Indirect Incomes group) = ₹224.
 * Reference dataset: Revenue = 2390224 (Sales Accounts 2390000 + Indirect Incomes 224).
 */
export function parsePandL(xml: string): {
  revenue: number;
  expenses: number;
  netProfit: number;
  depFound: boolean;
  depAmt: number;
  openingStock: number;
} {
  const xmlLower = xml.toLowerCase();

  // GST exclusion pattern — never include these in revenue even if under Income groups
  const GST_EXCLUSION = /(cgst|sgst|igst|output\s*tax|duties\s*(and|&)\s*taxes|tds)/i;

  let revenue = 0;
  let expenses = 0;
  let openingStock = 0;

  // Strategy: walk through the P&L XML and identify group-level lines.
  // Group lines are DSPDISPNAME entries that have a non-empty BSMAINAMT inside <PLAMT>.
  // Sub-ledger lines have BSSUBAMT inside <BSAMT> (or empty BSMAINAMT with a BSSUBAMT).
  // We ONLY sum group-level BSMAINAMT values to avoid double-counting.

  // Find all DSPDISPNAME + PLAMT pairs (group-level lines)
  const groupRe = /<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>[\s\S]*?<PLAMT\b[^>]*>[\s\S]*?<BSMAINAMT>([\-\d.,]*)<\/BSMAINAMT>[\s\S]*?<\/PLAMT>/gi;
  let mg: RegExpExecArray | null;
  while ((mg = groupRe.exec(xml)) !== null) {
    const name = decodeEntities(mg[1].trim());
    const nameLower = name.toLowerCase();
    const amtStr = mg[2].trim();
    const amt = parseAmt(amtStr);
    if (!amtStr || amt === 0) continue; // skip empty BSMAINAMT (sub-ledger containers)

    // Exclude GST/TDS from revenue
    if (GST_EXCLUSION.test(name)) continue;

    if (nameLower.includes('sales') || nameLower.includes('revenue') || nameLower.includes('income')) {
      revenue += Math.abs(amt);
    } else if (nameLower.includes('expense') || nameLower.includes('cost of') || nameLower.includes('purchase') || nameLower.includes('depreciation')) {
      expenses += Math.abs(amt);
    }
  }

  // Sub-ledger lines: DSPDISPNAME + BSSUBAMT (for individual line items like Opening Stock)
  const subRe = /<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>[\s\S]*?<BSSUBAMT>([\-\d.,]+)<\/BSSUBAMT>/gi;
  while ((mg = subRe.exec(xml)) !== null) {
    const name = decodeEntities(mg[1].trim()).toLowerCase();
    const amt = Math.abs(parseAmt(mg[2]));
    if (!amt) continue;
    if (name.includes('opening stock')) {
      openingStock = amt;
    }
  }

  // Classic import-format fallback
  if (revenue === 0) {
    revenue = Math.abs(parseAmt(xmlText(xml, 'REVENUE') || xmlText(xml, 'NETSALES') || xmlText(xml, 'TOTALSALES')));
    expenses = Math.abs(parseAmt(xmlText(xml, 'TOTALEXPENSES') || xmlText(xml, 'TOTALEXPENSE')));
    openingStock = Math.abs(parseAmt(xmlText(xml, 'OPENINGSTOCK')));
  }

  // Net Profit: try dedicated tags first, fall back to revenue - expenses.
  // Bug 2: prefer BS-sourced net profit (handled in engine.ts via bsNetProfit).
  // This P&L-derived figure is a fallback only.
  const netProfit = parseAmt(xmlText(xml, 'NETPROFIT') || xmlText(xml, 'PROFITLOSS') || xmlText(xml, 'NETLOSS')) || (revenue - expenses);

  // Depreciation
  const depFound = xmlLower.includes('depreciation') || xmlLower.includes('dep exp');
  let depAmt = 0;
  if (depFound) {
    const idx = xmlLower.indexOf('depreciation');
    const slice = xml.slice(Math.max(0, idx - 200), idx + 300);
    depAmt = Math.abs(parseAmt(xmlText(slice, 'BSSUBAMT') || xmlText(slice, 'AMOUNT')));
  }

  return { revenue, expenses, netProfit, depFound, depAmt, openingStock };
}

// ── Balance Sheet parser ──────────────────────────────────────────────────

/**
 * Bug 1 fix: Preserve signs on all BS amounts.
 * Bug 2 fix: Extract Profit & Loss A/c BSMAINAMT as bsNetProfit.
 *
 * Tally convention: negative = Cr, positive = Dr.
 * Debtors should be Dr (positive), Creditors should be Cr (negative).
 * Current Assets should be Dr (positive).
 */
export function parseBSheet(xml: string): {
  ca: number;
  cl: number;
  bankBal: number;
  debtorBal: number;
  creditorBal: number;
  closingStock: number;
  fixedAssets: number;
  bsCashBankTotal: number;
  bsNetProfit: number | null;
} {
  let ca = 0, cl = 0, bankBal = 0, debtorBal = 0, creditorBal = 0;
  let closingStock = 0, fixedAssets = 0, cashBal = 0;
  let bsNetProfit: number | null = null;

  // Tally display-report format: BSNAME blocks with DSPDISPNAME + BSAMT(BSSUBAMT/BSMAINAMT)
  // Walk through DSPDISPNAME+amount pairs — use BSMAINAMT when non-empty, else BSSUBAMT
  // Bug 1 fix: do NOT call Math.abs() — preserve sign
  const pairRe = /<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>[\s\S]*?<BSAMT\b[^>]*>([\s\S]*?)<\/BSAMT>/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(xml)) !== null) {
    const rawName = decodeEntities(m[1].trim());
    const name = rawName.toLowerCase();
    const amtBlock = m[2];
    const mainAmt = xmlText(amtBlock, 'BSMAINAMT');
    const subAmt  = xmlText(amtBlock, 'BSSUBAMT');
    const amt = parseAmt(mainAmt || subAmt); // Bug 1: signed value preserved
    if (amt === 0 && !mainAmt && !subAmt) continue;

    // Bug 2: capture "Profit & Loss A/c" BSMAINAMT for net profit
    if ((name.includes('profit') && name.includes('loss')) || name.includes('profit & loss')) {
      if (mainAmt) {
        bsNetProfit = parseAmt(mainAmt);
      }
    }

    if (name.includes('current assets')) ca = amt;
    else if (name.includes('current liabilities')) cl = amt;
    else if (name.includes('fixed asset')) fixedAssets = amt;
    else if (name.includes('bank')) bankBal += amt;
    else if (name.includes('sundry debtor') || name.includes('trade receiv')) debtorBal += amt;
    else if (name.includes('sundry creditor') || name.includes('trade payable')) creditorBal += amt;
    else if (name.includes('closing stock') || name.includes('stock-in-trade') || name.includes('stock in trade')) closingStock = amt;
    else if (name === 'cash' || name.includes('cash in hand') || name.includes('cash-in-hand')) cashBal += amt;
  }

  // Classic import-format fallback — also retain signs
  if (ca === 0 && cl === 0) {
    ca         = parseAmt(xmlText(xml, 'CURRENTASSETS') || xmlText(xml, 'CURRENTASSET'));
    cl         = parseAmt(xmlText(xml, 'CURRENTLIABILITIES') || xmlText(xml, 'CURRENTLIABILITY'));
    bankBal    = parseAmt(xmlText(xml, 'BANKBALANCES') || xmlText(xml, 'BANKBAL'));
    debtorBal  = parseAmt(xmlText(xml, 'DEBTORS') || xmlText(xml, 'SUNDRYDEBTORS'));
    creditorBal = parseAmt(xmlText(xml, 'CREDITORS') || xmlText(xml, 'SUNDRYCREDITORS'));
    closingStock = parseAmt(xmlText(xml, 'CLOSINGSTOCK') || xmlText(xml, 'STOCKINTRADE'));
    fixedAssets  = parseAmt(xmlText(xml, 'FIXEDASSETS') || xmlText(xml, 'FIXEDASSET'));
    cashBal     = parseAmt(xmlText(xml, 'CASHINHAND') || xmlText(xml, 'CASH'));
  }

  const bsCashBankTotal = bankBal + cashBal;
  return { ca, cl, bankBal, debtorBal, creditorBal, closingStock, fixedAssets, bsCashBankTotal, bsNetProfit };
}

// ── Group Summary parser ──────────────────────────────────────────────────

export function parseGrpSum(xml: string): {
  salesWrongGroup: boolean;
  purchaseWrongGroup: boolean;
  dutiesUnderExpense: boolean;
} {
  // Extract all DSPDISPNAME account names from GrpSum display-report format
  const names = xmlAll(xml, 'DSPDISPNAME').map(n => n.toLowerCase());

  // "Duties & Taxes" or GST/TDS ledgers appearing under "Indirect Expenses" group
  const xmlLower = xml.toLowerCase();
  const dutiesUnderExpense =
    (xmlLower.includes('duties') || xmlLower.includes('gst') || xmlLower.includes('tds')) &&
    xmlLower.includes('indirect expense');

  // salesWrongGroup / purchaseWrongGroup require structural parent-child parsing;
  // kept as false stubs until Group Summary structure is fully parsed
  return { salesWrongGroup: false, purchaseWrongGroup: false, dutiesUnderExpense };
}

// ── DayBook standard (non-chunked) parsing ────────────────────────────────

export function parseDayBook(xml: string, fyStart: Date, fyEnd: Date): ChunkedStats {
  const stats: ChunkedStats = {
    totalVouchers: 0, missingVno: 0, narrated: 0,
    totalJournals: 0, highValueCount: 0, highValueNarrated: 0,
    zeroAmt: 0, wrongType: 0, missingParty: 0,
    cashOver10k: 0, roundCount: 0, dupVnoMap: {},
    monthCounts: {}, dateSet: [], custMap: {}, vendMap: {},
    totalDebit: 0, totalCredit: 0, salesVoucherTotal: 0,
    purchVoucherTotal: 0, cashBankNetMovement: 0,
    taxVoucherTotal: 0, journalNetAmt: 0, outOfFY: 0,
  };

  const dateSet = new Set<string>();
  const voucherRe = /<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/gi;
  let m: RegExpExecArray | null;

  while ((m = voucherRe.exec(xml)) !== null) {
    processVoucher(m[1], stats, dateSet, fyStart, fyEnd);
  }

  stats.dateSet = Array.from(dateSet);
  return stats;
}

export function processVoucher(
  block: string,
  stats: ChunkedStats,
  dateSet: Set<string>,
  fyStart: Date,
  fyEnd: Date,
) {
  stats.totalVouchers++;

  const vno = xmlText(block, 'VOUCHERNUMBER');
  const narration = xmlText(block, 'NARRATION');
  const vtype = (xmlText(block, 'VOUCHERTYPENAME') || '').toLowerCase();
  const party = xmlText(block, 'PARTYLEDGERNAME');
  const dateStr = xmlText(block, 'DATE');
  const amt = extractAmt(block);

  if (!vno) stats.missingVno++;
  if (narration) stats.narrated++;

  if (vno) {
    stats.dupVnoMap[vno] = (stats.dupVnoMap[vno] || 0) + 1;
  }

  if (!party && (vtype.includes('sales') || vtype.includes('purchase') || vtype.includes('receipt') || vtype.includes('payment'))) {
    stats.missingParty++;
  }

  if (amt === 0) stats.zeroAmt++;

  if (amt > 100_000 && narration) stats.highValueNarrated++;
  if (amt > 100_000) stats.highValueCount++;

  if (vtype.includes('journal')) {
    stats.totalJournals++;
    stats.journalNetAmt += amt;
  }

  if (vtype.includes('cash') && amt > 10_000) stats.cashOver10k++;

  if (amt > 0 && amt % 1000 === 0) stats.roundCount++;

  if (vtype.includes('sales')) stats.salesVoucherTotal += amt;
  if (vtype.includes('purchase')) stats.purchVoucherTotal += amt;
  if (vtype.includes('journal')) stats.taxVoucherTotal += amt;
  if (vtype.includes('cash') || vtype.includes('bank')) stats.cashBankNetMovement += amt;

  stats.totalDebit += amt;
  stats.totalCredit += amt;

  if (dateStr) {
    const dt = parseTallyDate(dateStr);
    if (dt) {
      if (dt < fyStart || dt > fyEnd) stats.outOfFY++;
      const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      stats.monthCounts[monthKey] = (stats.monthCounts[monthKey] || 0) + 1;
      dateSet.add(dateStr);
    }
  }
}

// ── Assemble ParsedData from parsed pieces ────────────────────────────────

export function assembleParsedData(
  tbResult: ReturnType<typeof parseTrialBalance> | null,
  plResult: ReturnType<typeof parsePandL> | null,
  bsResult: ReturnType<typeof parseBSheet> | null,
  grpResult: ReturnType<typeof parseGrpSum> | null,
): Partial<ParsedData> {
  return {
    ...(tbResult ?? {}),
    ...(plResult ?? {}),
    ...(bsResult ?? {}),
    ...(grpResult ?? {}),
  };
}
