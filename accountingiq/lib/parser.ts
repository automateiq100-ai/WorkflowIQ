'use client';

import type { TBLedger, ParsedData, ChunkedStats } from './types';

// ── XML helpers ──────────────────────────────────────────────────────────

/** Extract first text content of a tag */
export function xmlText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : '';
}

/** Extract all text contents of a tag */
export function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'gi');
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

/** Extract amount — tries multiple tags in fallback order */
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
    tbLedgers.push({ name, nl: name.toLowerCase(), closing: Math.abs(closing), dr: closing >= 0 });
  }

  // Fallback: flat DSPDISPNAME + DSPCLAMTA zip (used when blocks aren't paired above)
  if (tbLedgers.length === 0) {
    const names = xmlAll(xml, 'DSPDISPNAME');
    const amounts = xmlAll(xml, 'DSPCLAMTA');
    const minLen = Math.min(names.length, amounts.length);
    for (let i = 0; i < minLen; i++) {
      const name = names[i];
      const closing = Math.abs(parseAmt(amounts[i]));
      tbLedgers.push({ name, nl: name.toLowerCase(), closing, dr: false });
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
      tbLedgers.push({ name, nl: name.toLowerCase(), closing: Math.abs(closing), dr: false });
    }
  }

  // Flags
  let suspenseCount = 0;
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
    if (n.includes('suspense') || n.includes('miscellaneous') || n.includes('misc')) suspenseCount++;
    if (n.includes('capital') || n.includes('owner') || n.includes('proprietor') || n.includes('partner')) capFound = true;
    if (n.includes('bank') || /hdfc|icici|sbi|axis|kotak|yes bank/.test(n)) bankFound = true;
    if (n === 'cash' || n.includes('cash in hand') || n.includes('petty cash')) cashFound = true;
    if (n.includes('sundry debtor') || n.includes('trade receiv')) debtorFound = true;
    if (n.includes('sundry creditor') || n.includes('trade payable')) creditorFound = true;
    if (n.includes('output gst') || n.includes('output cgst') || n.includes('output sgst') || n.includes('output igst') || n.includes('gst payable') || n.includes('cgst payable') || n.includes('sgst payable') || n.includes('igst payable')) outputGSTAmt += l.closing;
    if (n.includes('input gst') || n.includes('input cgst') || n.includes('input sgst') || n.includes('input igst') || n.includes('itc') || n.includes('gst receivable')) inputITCAmt += l.closing;
    if (n.includes('tds payable') || n.includes('tds on') || (n.includes('tax deducted') && n.includes('source'))) tdsLedgerFound = true;
    if (n.includes('pf payable') || n.includes('esi payable') || n.includes('provident fund') || n.includes('employees state')) pfLedgerFound = true;
    if (n.includes('sales') || n.includes('revenue from')) tbSales += l.closing;
    if (n.includes('purchase') || n.includes('cost of goods')) tbPurch += l.closing;
  }

  // Duplicate detection — Levenshtein-like heuristic (same first 6 chars)
  const nlNames = tbLedgers.map(l => l.nl);
  let dupPairs = 0;
  for (let i = 0; i < nlNames.length; i++) {
    for (let j = i + 1; j < nlNames.length; j++) {
      if (isSimilar(nlNames[i], nlNames[j])) dupPairs++;
    }
  }

  const hasOpeningBal = xml.toLowerCase().includes('dspopaamt') || xml.toLowerCase().includes('openingbalance') || xml.toLowerCase().includes('opening stock');
  const tbTotal = tbLedgers.reduce((s, l) => s + l.closing, 0);

  return {
    tbLedgers, suspenseCount, dupPairs, capFound, bankFound, cashFound,
    debtorFound, creditorFound, hasOpeningBal, tbTotal, tbSales, tbPurch,
    outputGSTAmt, inputITCAmt, tdsLedgerFound, pfLedgerFound,
    salesLedgersNoRate: 0,
    gstDiffPct: 0,
  };
}

function isSimilar(a: string, b: string): boolean {
  if (a === b) return false;  // same name, not "duplicate pair" in the strict sense
  if (Math.abs(a.length - b.length) > 4) return false;
  // Same first 6 significant chars
  const sig = (s: string) => s.replace(/\s+/g, '').slice(0, 6);
  if (sig(a) === sig(b) && a.length > 5) return true;
  return false;
}

// ── P&L parser ────────────────────────────────────────────────────────────

export function parsePandL(xml: string): {
  revenue: number;
  expenses: number;
  netProfit: number;
  depFound: boolean;
  depAmt: number;
  openingStock: number;
} {
  const xmlLower = xml.toLowerCase();

  // Tally display-report format: scan all DSPDISPNAME+amount pairs
  // Income section amounts are in PLAMT/BSMAINAMT; expense lines in BSAMT/BSSUBAMT
  // Strategy: find all top-level group amounts (BSMAINAMT inside PLAMT) and classify by name

  let revenue = 0;
  let expenses = 0;
  let openingStock = 0;

  // Extract DSPDISPNAME + BSMAINAMT pairs (top-level group lines in P&L)
  const groupRe = /<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>[\s\S]*?<BSMAINAMT>([\-\d.,]*)<\/BSMAINAMT>/gi;
  let mg: RegExpExecArray | null;
  while ((mg = groupRe.exec(xml)) !== null) {
    const name = decodeEntities(mg[1].trim()).toLowerCase();
    const amt = parseAmt(mg[2]);
    if (!amt) continue;
    if (name.includes('sales') || name.includes('revenue') || name.includes('income')) {
      revenue += Math.abs(amt);
    } else if (name.includes('expense') || name.includes('cost of') || name.includes('purchase') || name.includes('depreciation')) {
      expenses += Math.abs(amt);
    }
  }

  // Sub-ledger lines: DSPDISPNAME + BSSUBAMT (for individual expense/income accounts)
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

export function parseBSheet(xml: string): {
  ca: number;
  cl: number;
  bankBal: number;
  debtorBal: number;
  creditorBal: number;
  closingStock: number;
  fixedAssets: number;
  bsCashBankTotal: number;
} {
  let ca = 0, cl = 0, bankBal = 0, debtorBal = 0, creditorBal = 0;
  let closingStock = 0, fixedAssets = 0, cashBal = 0;

  // Tally display-report format: BSNAME blocks with DSPDISPNAME + BSAMT(BSSUBAMT/BSMAINAMT)
  // Walk through DSPDISPNAME+amount pairs — use BSMAINAMT when non-empty, else BSSUBAMT
  const pairRe = /<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>[\s\S]*?<BSAMT\b[^>]*>([\s\S]*?)<\/BSAMT>/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(xml)) !== null) {
    const name = decodeEntities(m[1].trim()).toLowerCase();
    const amtBlock = m[2];
    const mainAmt = xmlText(amtBlock, 'BSMAINAMT');
    const subAmt  = xmlText(amtBlock, 'BSSUBAMT');
    const amt = Math.abs(parseAmt(mainAmt || subAmt));
    if (!amt) continue;

    if (name.includes('current assets')) ca = amt;
    else if (name.includes('current liabilities')) cl = amt;
    else if (name.includes('fixed asset')) fixedAssets = amt;
    else if (name.includes('bank')) bankBal += amt;
    else if (name.includes('sundry debtor') || name.includes('trade receiv')) debtorBal += amt;
    else if (name.includes('sundry creditor') || name.includes('trade payable')) creditorBal += amt;
    else if (name.includes('closing stock') || name.includes('stock-in-trade') || name.includes('stock in trade')) closingStock = amt;
    else if (name === 'cash' || name.includes('cash in hand')) cashBal += amt;
  }

  // Classic import-format fallback
  if (ca === 0 && cl === 0) {
    ca         = Math.abs(parseAmt(xmlText(xml, 'CURRENTASSETS') || xmlText(xml, 'CURRENTASSET')));
    cl         = Math.abs(parseAmt(xmlText(xml, 'CURRENTLIABILITIES') || xmlText(xml, 'CURRENTLIABILITY')));
    bankBal    = Math.abs(parseAmt(xmlText(xml, 'BANKBALANCES') || xmlText(xml, 'BANKBAL')));
    debtorBal  = Math.abs(parseAmt(xmlText(xml, 'DEBTORS') || xmlText(xml, 'SUNDRYDEBTORS')));
    creditorBal = Math.abs(parseAmt(xmlText(xml, 'CREDITORS') || xmlText(xml, 'SUNDRYCREDITORS')));
    closingStock = Math.abs(parseAmt(xmlText(xml, 'CLOSINGSTOCK') || xmlText(xml, 'STOCKINTRADE')));
    fixedAssets  = Math.abs(parseAmt(xmlText(xml, 'FIXEDASSETS') || xmlText(xml, 'FIXEDASSET')));
    cashBal     = Math.abs(parseAmt(xmlText(xml, 'CASHINHAND') || xmlText(xml, 'CASH')));
  }

  const bsCashBankTotal = bankBal + cashBal;
  return { ca, cl, bankBal, debtorBal, creditorBal, closingStock, fixedAssets, bsCashBankTotal };
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
