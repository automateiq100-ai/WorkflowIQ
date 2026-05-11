'use client';

import { XMLParser } from 'fast-xml-parser';
import type {
  TBLedger, TBFullRow, ParsedData, ChunkedStats,
  MasterEntry, MasterItemType, FinancialNode, FinancialNodeType,
  ParsedStatement, FlatFinancialRow,
} from './types';
import { classifyLedger, type BSHierarchyMap } from './tally-groups';
import { classifyVoucherType, type SemanticVoucherType } from './tally-voucher-types';
import type { OverrideMap } from './ledger-overrides';

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

/** Read a closing balance from a TB DSPACCINFO block, supporting both shapes:
 *
 *   • Ledger/Account Display export (GUI File→Export from a single ledger):
 *       <DSPCLAMTA>-100000.00</DSPCLAMTA>  ← single signed value
 *
 *   • Trial Balance report export (TDL gateway / Multi-Account Display):
 *       <DSPCLDRAMT><DSPCLDRAMTA>-100000.00</DSPCLDRAMTA></DSPCLDRAMT>  ← Dr column
 *       <DSPCLCRAMT><DSPCLCRAMTA>10000.00</DSPCLCRAMTA></DSPCLCRAMT>     ← Cr column
 *
 * Tally signs Dr-column values negative (internal Cr-positive convention) and
 * Cr-column values positive, so summing yields the unified signed closing
 * (positive=Cr, negative=Dr — matches TBFullRow.closing's documented sign).
 * Empty tags parse to 0, so the sum still works for one-sided rows.
 */
export function readTBClosing(infoBlock: string): number {
  const single = xmlText(infoBlock, 'DSPCLAMTA');
  if (single) return parseAmt(single);
  const dr = xmlText(infoBlock, 'DSPCLDRAMTA');
  const cr = xmlText(infoBlock, 'DSPCLCRAMTA');
  return parseAmt(dr) + parseAmt(cr);
}

/** Same dual-shape logic as readTBClosing for Opening Balance.  Returns 0
 *  when neither column is present (older TB exports). */
export function readTBOpening(infoBlock: string): number {
  const single = xmlText(infoBlock, 'DSPOPAMTA');
  if (single) return parseAmt(single);
  const dr = xmlText(infoBlock, 'DSPOPDRAMTA');
  const cr = xmlText(infoBlock, 'DSPOPCRAMTA');
  return parseAmt(dr) + parseAmt(cr);
}

/** Period Dr / Cr movement totals.  Tally's TB-with-transactions report wraps
 *  each side as <DSPDRAMT><DSPDRAMTA>...</DSPDRAMTA></DSPDRAMT>; the inner
 *  tag's value is already a positive magnitude. */
export function readTBMovements(infoBlock: string): { debit: number; credit: number } {
  return {
    debit:  Math.abs(parseAmt(xmlText(infoBlock, 'DSPDRAMTA'))),
    credit: Math.abs(parseAmt(xmlText(infoBlock, 'DSPCRAMTA'))),
  };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

// ── Ordered XML helpers for Tally display reports ────────────────────────

type OrderedXmlNode = Record<string, unknown>;

const ORDERED_XML = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function parseOrderedXml(xml: string): OrderedXmlNode[] {
  try {
    const parsed = ORDERED_XML.parse(xml);
    return Array.isArray(parsed) ? parsed as OrderedXmlNode[] : [];
  } catch {
    return [];
  }
}

function orderedElementName(node: OrderedXmlNode): string | null {
  return Object.keys(node).find(k => k !== ':@' && k !== '#text') ?? null;
}

function orderedChildren(node: OrderedXmlNode, name?: string): OrderedXmlNode[] {
  const elementName = name ?? orderedElementName(node);
  if (!elementName) return [];
  const value = node[elementName];
  return Array.isArray(value) ? value as OrderedXmlNode[] : [];
}

function orderedAttrs(node: OrderedXmlNode): Record<string, string> {
  const attrs = node[':@'];
  return attrs && typeof attrs === 'object' && !Array.isArray(attrs)
    ? attrs as Record<string, string>
    : {};
}

function orderedText(nodes: OrderedXmlNode[] | unknown): string {
  if (nodes == null) return '';
  if (typeof nodes === 'string' || typeof nodes === 'number' || typeof nodes === 'boolean') {
    return String(nodes);
  }
  if (Array.isArray(nodes)) {
    return nodes.map(orderedText).join('');
  }
  if (typeof nodes === 'object') {
    const node = nodes as OrderedXmlNode;
    const text = node['#text'];
    const childText = Object.entries(node)
      .filter(([key]) => key !== ':@' && key !== '#text')
      .map(([, value]) => orderedText(value))
      .join('');
    return `${typeof text === 'string' || typeof text === 'number' ? text : ''}${childText}`;
  }
  return '';
}

function findOrderedText(nodes: OrderedXmlNode[], tag: string): string {
  const wanted = tag.toUpperCase();
  for (const node of nodes) {
    const name = orderedElementName(node);
    if (!name) continue;
    const children = orderedChildren(node, name);
    if (name.toUpperCase() === wanted) {
      return decodeEntities(orderedText(children).trim());
    }
    const nested = findOrderedText(children, tag);
    if (nested) return nested;
  }
  return '';
}

function collectOrderedElements(nodes: OrderedXmlNode[], tag: string, out: OrderedXmlNode[] = []): OrderedXmlNode[] {
  const wanted = tag.toUpperCase();
  for (const node of nodes) {
    const name = orderedElementName(node);
    if (!name) continue;
    if (name.toUpperCase() === wanted) out.push(node);
    collectOrderedElements(orderedChildren(node, name), tag, out);
  }
  return out;
}

function normalizeMasterKey(name: string): string {
  return decodeEntities(name).trim().toLowerCase();
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

export function parseTrialBalance(
  xml: string,
  masterMap: Map<string, MasterEntry> = new Map(),
  overrides?: OverrideMap,
  bsHierarchy?: BSHierarchyMap,
): {
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
  /** Sum of |closing| over all TDS Payable / TDS-on-X / Tax-Deducted-at-Source
   *  ledgers in the Trial Balance.  Drives E6 (TDS reasonableness) — we
   *  compare this against total payment voucher volume from the DayBook. */
  tdsPayableAmt: number;
  /** Sum of |closing| over all ledgers classified as 'stock' in the TB.
   *  Used as a fallback for BS-derived closingStock when the BS parser's
   *  literal patterns ("closing stock", "stock-in-trade") miss the
   *  user's specific naming (e.g. "Inventory", "Raw Material Stock"). */
  tbStock: number;
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
    if (!name || name === 'undefined') continue;
    // Skip GROUP-type entries — they are rollup rows; including them double-counts children in D1/H2/H3
    if (masterMap.get(normalizeMasterKey(name))?.type === 'group') continue;
    const closing = readTBClosing(infoBlock);
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
      if (!name || name === 'undefined') continue;
      if (masterMap.get(normalizeMasterKey(name))?.type === 'group') continue;
      const closing = parseAmt(amounts[i]);
      tbLedgers.push({ name, nl: name.toLowerCase(), closing, dr: closing >= 0 });
    }
  }

  // Fallback for Tally TB-report shape with no DSPCLAMTA at all — flat zip on
  // DSPDISPNAME + DSPCLDRAMTA + DSPCLCRAMTA columns.  When the block-pair
  // regex above didn't match (e.g. DSPACCNAME and DSPACCINFO weren't adjacent
  // because of unexpected whitespace), this rebuilds rows from the column
  // arrays.  Each ledger has exactly one non-empty column, so per-index sum
  // recovers the signed closing.
  if (tbLedgers.length === 0) {
    const names   = xmlAll(xml, 'DSPDISPNAME');
    const drCol   = xmlAll(xml, 'DSPCLDRAMTA');
    const crCol   = xmlAll(xml, 'DSPCLCRAMTA');
    const minLen  = Math.min(names.length, drCol.length, crCol.length);
    for (let i = 0; i < minLen; i++) {
      const name = names[i];
      if (!name || name === 'undefined') continue;
      if (masterMap.get(normalizeMasterKey(name))?.type === 'group') continue;
      const closing = parseAmt(drCol[i]) + parseAmt(crCol[i]);
      tbLedgers.push({ name, nl: name.toLowerCase(), closing, dr: closing >= 0 });
    }
  }

  // Classic import-format fallback (LEDGER blocks)
  if (tbLedgers.length === 0) {
    const ledgerRe = /<LEDGER\b[^>]*>([\s\S]*?)<\/LEDGER>/gi;
    while ((m = ledgerRe.exec(xml)) !== null) {
      const block = m[1];
      const name = xmlText(block, 'NAME') || xmlText(block, 'LEDGERNAME');
      if (!name || name === 'undefined') continue;
      if (masterMap.get(normalizeMasterKey(name))?.type === 'group') continue;
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
  let tdsPayableAmt = 0;
  let tbStock = 0;
  let pfLedgerFound = false;
  let tbSales = 0;
  let tbPurch = 0;

  // Single classification pass over every TB ledger.  The catalog in
  // tally-groups.ts walks the master parent chain (high confidence) and
  // falls back to name-pattern matching (low confidence) — so this loop
  // works the same whether the master file was loaded or not, and
  // correctly classifies ledgers with non-obvious names (proprietor
  // capital "Kunal Budhwar", numeric bank accounts "HDFC 0049", debtor
  // business names "ABC Traders", custom-named revenue groups, etc.).
  //
  // Sub-detections inside Duties & Taxes (Output GST / Input ITC / TDS /
  // PF & ESI) still rely on naming conventions because Tally groups them
  // all under the same parent "Duties & Taxes"; the standard regulatory
  // ledger names are stable enough across companies that regex remains
  // the right tool there.
  for (const l of tbLedgers) {
    const n = l.nl;
    const cls = classifyLedger(l.name, masterMap, overrides, bsHierarchy);

    // Suspense / miscellaneous balances — surface every one for the
    // critical-flag panel (engine reports them by name).
    if (cls.category === 'suspense' || /\bsuspense\b|\bmiscellaneous\b|\bmisc\b/.test(n)) {
      suspenseCount++;
      suspenseLedgers.push({ name: l.name, amount: l.closing });
    }

    // Presence flags — driven entirely by the catalog's category.
    // bank-od counts toward bankFound (an OD account is still a bank
    // relationship, just on the liability side).
    if (cls.category === 'capital')                              capFound = true;
    if (cls.category === 'bank' || cls.category === 'bank-od')   bankFound = true;
    if (cls.category === 'cash')                                 cashFound = true;
    if (cls.category === 'debtor')                               debtorFound = true;
    if (cls.category === 'creditor')                             creditorFound = true;

    // Aggregations for cross-statement reconciliation.
    if (cls.category === 'sales')    tbSales += Math.abs(l.closing);
    if (cls.category === 'purchase') tbPurch += Math.abs(l.closing);
    // Stock — used as fallback for BS-derived closingStock when the BS
    // parser's narrow regex ("closing stock", "stock-in-trade") misses
    // the user's custom stock-ledger names ("Inventory", "Stock-in-Hand").
    if (cls.category === 'stock')    tbStock += Math.abs(l.closing);

    // Sub-classifiers within Duties & Taxes (regex on regulatory naming
    // conventions — these stay stable across Tally setups because GSTN /
    // CBDT prescribe the ledger labels).
    if (/output\s*[cs]?gst|gst\s*payable|[cs]gst\s*payable|igst\s*payable/.test(n)) {
      outputGSTAmt += Math.abs(l.closing);
    }
    if (/input\s*[cs]?gst|input\s*igst|\bitc\b|gst\s*receivable/.test(n)) {
      inputITCAmt += Math.abs(l.closing);
    }
    if (/tds\s*payable|tds\s+on\b|tax\s*deducted.*source/.test(n)) {
      tdsLedgerFound = true;
      tdsPayableAmt += Math.abs(l.closing);
    }
    if (/pf\s*payable|esi\s*payable|provident\s*fund|employees\s*state/.test(n)) {
      pfLedgerFound = true;
    }
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

  const hasOpeningBal = xml.toLowerCase().includes('dspopamta') || xml.toLowerCase().includes('openingbalance') || xml.toLowerCase().includes('opening stock');
  const tbTotal = tbLedgers.reduce((s, l) => s + Math.abs(l.closing), 0);

  return {
    tbLedgers, suspenseCount, dupPairs, capFound, bankFound, cashFound,
    debtorFound, creditorFound, hasOpeningBal, tbTotal, tbSales, tbPurch,
    outputGSTAmt, inputITCAmt, tdsLedgerFound, tdsPayableAmt, tbStock, pfLedgerFound,
    salesLedgersNoRate: 0,
    gstDiffPct: 0,
    suspenseLedgers,
    dupPairDetails,
  };
}

/**
 * Parse the full Trial Balance XML into ALL rows — both group rollup rows and
 * individual ledger rows — preserving Tally's document order (parents before
 * children).  Intended for the hierarchical Data View display only; does NOT
 * filter groups (use parseTrialBalance for analysis checks).
 *
 * Sign convention: positive closing = Cr balance, negative = Dr balance.
 */
export function parseTBFull(
  xml: string,
  masterMap: Map<string, MasterEntry> = new Map(),
): TBFullRow[] {
  const rows: TBFullRow[] = [];

  // Primary: rich Tally GUI export — paired DSPACCNAME + DSPACCINFO blocks
  // contain opening / Dr / Cr / closing movement amounts.
  const blockRe = /<DSPACCNAME\b[^>]*>([\s\S]*?)<\/DSPACCNAME>\s*<DSPACCINFO\b[^>]*>([\s\S]*?)<\/DSPACCINFO>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const nameBlock = m[1];
    const infoBlock = m[2];
    const name = xmlText(nameBlock, 'DSPDISPNAME');
    if (!name || name === 'undefined') continue;
    const masterEntry = masterMap.get(normalizeMasterKey(name));
    const mov = readTBMovements(infoBlock);
    rows.push({
      name,
      opening:   readTBOpening(infoBlock),
      debitMov:  mov.debit,
      creditMov: mov.credit,
      closing:   readTBClosing(infoBlock),
      isGroup:   masterEntry?.type === 'group',
    });
  }
  if (rows.length > 0) return rows;

  // Fallback 1: flat DSPDISPNAME + DSPCLAMTA arrays (some Tally TDL responses
  // emit a lean shape without DSPACCINFO wrappers — keeps Data view populated
  // for live-bridge syncs).  Movement totals aren't available here.
  const names = xmlAll(xml, 'DSPDISPNAME');
  const amounts = xmlAll(xml, 'DSPCLAMTA');
  const minLen = Math.min(names.length, amounts.length);
  for (let i = 0; i < minLen; i++) {
    const name = names[i];
    if (!name || name === 'undefined') continue;
    const masterEntry = masterMap.get(normalizeMasterKey(name));
    rows.push({
      name,
      opening:   0,
      debitMov:  0,
      creditMov: 0,
      closing:   parseAmt(amounts[i]),
      isGroup:   masterEntry?.type === 'group',
    });
  }
  if (rows.length > 0) return rows;

  // Fallback 1b: Tally TB-report column shape — DSPCLDRAMTA / DSPCLCRAMTA
  // arrays.  Only fires when the primary block-pair regex didn't match.
  const drCol  = xmlAll(xml, 'DSPCLDRAMTA');
  const crCol  = xmlAll(xml, 'DSPCLCRAMTA');
  const colLen = Math.min(names.length, drCol.length, crCol.length);
  for (let i = 0; i < colLen; i++) {
    const name = names[i];
    if (!name || name === 'undefined') continue;
    const masterEntry = masterMap.get(normalizeMasterKey(name));
    rows.push({
      name,
      opening:   0,
      debitMov:  0,
      creditMov: 0,
      closing:   parseAmt(drCol[i]) + parseAmt(crCol[i]),
      isGroup:   masterEntry?.type === 'group',
    });
  }
  if (rows.length > 0) return rows;

  // Fallback 2: classic Tally import format — <LEDGER>…<NAME>…<CLOSINGBALANCE>
  // (used by some bridge / programmatic Tally setups).
  const ledgerRe = /<LEDGER\b[^>]*>([\s\S]*?)<\/LEDGER>/gi;
  while ((m = ledgerRe.exec(xml)) !== null) {
    const block = m[1];
    const name = xmlText(block, 'NAME') || xmlText(block, 'LEDGERNAME');
    if (!name || name === 'undefined') continue;
    const masterEntry = masterMap.get(normalizeMasterKey(name));
    const opening = parseAmt(xmlText(block, 'OPENINGBALANCE') || xmlText(block, 'OPENINGBAL'));
    const closing = parseAmt(xmlText(block, 'CLOSINGBALANCE') || xmlText(block, 'CLOSINGBAL'));
    rows.push({
      name,
      opening,
      debitMov:  0,
      creditMov: 0,
      closing,
      isGroup:   masterEntry?.type === 'group',
    });
  }

  return rows;
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

/** Trailing-token sibling exception pattern.
 * BUG 7 fix: restrict numeric token to 1-2 digits only.
 * "ABC Traders 123" has a 3-digit suffix → NOT a sibling variant → dup detection applies. */
const SIBLING_TOKEN_RE = /^(a|b|c|d|e|\d{1,2}%?|cgst|sgst|igst|cr|dr|v\d+|9%|18%|12%|5%)$/i;

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

export interface PLSection {
  name: string;
  total: number;
  children: Array<{ name: string; amount: number }>;
}

/**
 * Group-aware P&L parser. Returns structured PLSection[] for the UI to render
 * as expandable dropdowns, plus numeric totals for engine checks.
 *
 * - "Sales Accounts" → Revenue from operations
 * - "Purchase Accounts" → Cost of materials consumed
 * - "Indirect Incomes" → Other Income
 * - "Indirect Expenses" / "Cost of Sales" → Other expenses
 */
export function parsePandL(xml: string): {
  revenue: number;
  directRevenue: number;
  otherIncome: number;
  costOfMaterials: number;
  expenses: number;
  netProfit: number;
  depFound: boolean;
  depAmt: number;
  openingStock: number;
  plSections: PLSection[];
} {
  const xmlLower = xml.toLowerCase();

  // ── Group-aware tokeniser ──
  // Pattern: group header = <DSPACCNAME>...<DSPDISPNAME>...</DSPDISPNAME>...</DSPACCNAME> followed by <PLAMT>
  // Child ledger = <BSNAME>...</BSNAME> followed by <BSAMT>...</BSAMT>
  const tokenRe = /<DSPACCNAME>\s*<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>\s*<\/DSPACCNAME>\s*<PLAMT[^>]*>([\s\S]*?)<\/PLAMT>|<BSNAME>([\s\S]*?)<\/BSNAME>\s*<BSAMT[^>]*>([\s\S]*?)<\/BSAMT>/gi;
  const plSections: PLSection[] = [];
  let current: PLSection | null = null;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(xml)) !== null) {
    if (m[1] !== undefined) {
      // Group header
      const name = decodeEntities(m[1].trim());
      const plBlock = m[2];
      const mainAmt = xmlText(plBlock, 'BSMAINAMT');
      const subAmt  = xmlText(plBlock, 'PLSUBAMT');
      const total   = parseAmt(mainAmt || subAmt);
      current = { name, total, children: [] };
      plSections.push(current);
    } else if (m[3] !== undefined && current) {
      // Child ledger under most recent group
      const childName = (m[3].match(/<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>/) || [])[1]?.trim() ?? '';
      const subAmtStr = xmlText(m[4], 'BSSUBAMT');
      if (childName && subAmtStr) {
        current.children.push({ name: decodeEntities(childName), amount: parseAmt(subAmtStr) });
      }
    }
  }

  // ── Compute schedule line items from sections ──
  let directRevenue = 0;
  let otherIncome = 0;
  let costOfMaterials = 0;
  let expenses = 0;
  let depAmt = 0;
  let openingStock = 0;

  for (const sec of plSections) {
    const nl = sec.name.toLowerCase();
    const absTotal = Math.abs(sec.total);
    if (nl.includes('sales') && !nl.includes('cost of sales')) {
      directRevenue += absTotal;
    } else if (nl.includes('purchase') || nl.includes('cost of sales') || nl.includes('direct expense') || nl.includes('manufacturing')) {
      costOfMaterials += absTotal;
    } else if (nl.includes('indirect income') || nl.includes('direct income') || (nl.includes('income') && !nl.includes('expense'))) {
      otherIncome += absTotal;
    } else if (nl.includes('expense') || nl.includes('indirect expense')) {
      expenses += absTotal;
      // Pick depreciation from children
      for (const ch of sec.children) {
        if (ch.name.toLowerCase().includes('depreciation')) depAmt += Math.abs(ch.amount);
      }
    } else if (sec.total !== 0) {
      // Sign-based fallback for non-standard group names (e.g. "COMMISSION", "Brokerage Paid")
      // Negative BSMAINAMT = debit side = cost/expense; Positive = credit side = income
      if (sec.total < 0) {
        expenses += Math.abs(sec.total);
      } else {
        otherIncome += sec.total;
      }
    }
    // Opening stock from children
    for (const ch of sec.children) {
      if (ch.name.toLowerCase().includes('opening stock')) openingStock += Math.abs(ch.amount);
    }
  }

  // Fallback to old regex approach if section parse yielded nothing
  if (plSections.length === 0) {
    const GST_EXCLUSION = /(cgst|sgst|igst|output\s*tax|duties\s*(and|&)\s*taxes|tds)/i;
    const STOP = '(?:(?!<DSPDISPNAME>)[\\s\\S])';
    const groupRe = new RegExp(
      `<DSPDISPNAME>([^<]+)<\\/DSPDISPNAME>${STOP}*?<PLAMT\\b[^>]*>${STOP}*?<BSMAINAMT>([\\-\\d.,]*)<\\/BSMAINAMT>${STOP}*?<\\/PLAMT>`,
      'gi',
    );
    let mg: RegExpExecArray | null;
    while ((mg = groupRe.exec(xml)) !== null) {
      const name = decodeEntities(mg[1].trim());
      const nameLower = name.toLowerCase();
      const amt = parseAmt(mg[2].trim());
      if (!amt || GST_EXCLUSION.test(name)) continue;
      if (nameLower.includes('sales') && !nameLower.includes('cost of sales')) directRevenue += Math.abs(amt);
      else if (nameLower.includes('purchase') || nameLower.includes('cost of sales') || nameLower.includes('direct expense') || nameLower.includes('manufacturing')) costOfMaterials += Math.abs(amt);
      else if (nameLower.includes('income')) otherIncome += Math.abs(amt);
      else if (nameLower.includes('expense') || nameLower.includes('depreciation')) expenses += Math.abs(amt);
    }
    if (directRevenue === 0 && otherIncome === 0) {
      directRevenue = Math.abs(parseAmt(xmlText(xml, 'REVENUE') || xmlText(xml, 'NETSALES') || xmlText(xml, 'TOTALSALES')));
      expenses = Math.abs(parseAmt(xmlText(xml, 'TOTALEXPENSES') || xmlText(xml, 'TOTALEXPENSE')));
      openingStock = Math.abs(parseAmt(xmlText(xml, 'OPENINGSTOCK')));
    }
  }

  const revenue = directRevenue + otherIncome;
  const totalExpenses = costOfMaterials + expenses;
  const netProfit = parseAmt(xmlText(xml, 'NETPROFIT') || xmlText(xml, 'PROFITLOSS') || xmlText(xml, 'NETLOSS')) || (revenue - totalExpenses);

  const depFound = xmlLower.includes('depreciation') || xmlLower.includes('dep exp');
  if (depFound && depAmt === 0) {
    const idx = xmlLower.indexOf('depreciation');
    const slice = xml.slice(Math.max(0, idx - 200), idx + 300);
    depAmt = Math.abs(parseAmt(xmlText(slice, 'BSSUBAMT') || xmlText(slice, 'AMOUNT')));
  }

  return { revenue, directRevenue, otherIncome, costOfMaterials, expenses: totalExpenses, netProfit, depFound, depAmt, openingStock, plSections };
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
  otherCurrentAssets: Array<{ name: string; amount: number }>;
} {
  let ca = 0, cl = 0, bankBal = 0, debtorBal = 0, creditorBal = 0;
  let closingStock = 0, fixedAssets = 0, cashBal = 0;
  let bsNetProfit: number | null = null;
  const otherCurrentAssets: Array<{ name: string; amount: number }> = [];
  let inCurrentAssets = false;

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
      if (mainAmt) { bsNetProfit = parseAmt(mainAmt); }
      inCurrentAssets = false;
    } else if (name.includes('current assets')) {
      ca = amt;
      inCurrentAssets = true;
    } else if (name.includes('current liabilities')) {
      cl = amt;
      inCurrentAssets = false;
    } else if (name.includes('fixed asset')) {
      fixedAssets = amt;
      inCurrentAssets = false;
    } else if (name.includes('bank')) {
      bankBal += amt;
    } else if (name.includes('sundry debtor') || name.includes('trade receiv') || name.includes('debtor')) {
      debtorBal += Math.abs(amt);
    } else if (name.includes('sundry creditor') || name.includes('trade payable') || name.includes('creditor')) {
      creditorBal += amt;
    } else if (
      name.includes('closing stock') ||
      name.includes('stock-in-trade') || name.includes('stock in trade') ||
      name.includes('stock-in-hand')  || name.includes('stock in hand') ||
      name === 'stock' || name === 'inventory' || name.includes('inventories')
    ) {
      // Capture the largest non-zero match so a leaf-level "Stock" doesn't
      // overwrite a group-level rollup like "Stock-in-Hand" with a more
      // complete total.
      if (Math.abs(amt) > Math.abs(closingStock)) closingStock = amt;
    } else if (name === 'cash' || name.includes('cash in hand') || name.includes('cash-in-hand')) {
      cashBal += amt;
    } else if (inCurrentAssets && subAmt && Math.abs(parseAmt(subAmt)) > 0) {
      // Uncategorized sub-item under Current Assets (e.g. Input GST, Advance Tax, Prepaid)
      otherCurrentAssets.push({ name: rawName, amount: Math.abs(parseAmt(subAmt)) });
    }
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
  return { ca, cl, bankBal, debtorBal, creditorBal, closingStock, fixedAssets, bsCashBankTotal, bsNetProfit, otherCurrentAssets };
}

// ── Cash Flow Statement parser ────────────────────────────────────────────

export interface CashFlowSection {
  name: string;
  total: number;
  children: Array<{ name: string; amount: number }>;
}

const OPERATING_GROUPS = ['current assets', 'current liabilities', 'indirect income', 'indirect expense', 'sundry debtor', 'sundry creditor', 'direct income', 'direct expense', 'suspense'];
const INVESTING_GROUPS = ['fixed asset', 'investment', 'capital work'];
const FINANCING_GROUPS = ['capital account', 'loans', 'secured loan', 'unsecured loan', 'bank od', 'bank overdraft', 'reserves'];

export function parseCashFlow(xml: string): {
  cashFlowSections: CashFlowSection[];
  operatingCF: number;
  investingCF: number;
  financingCF: number;
  netCashFlow: number;
} {
  const cashFlowSections: CashFlowSection[] = [];
  let current: CashFlowSection | null = null;

  // Same display-report structure as BSheet but uses CFBAMT/CFBSUBAMT/CFBMAINAMT
  const pairRe = /<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>[\s\S]*?<CFBAMT\b[^>]*>([\s\S]*?)<\/CFBAMT>/gi;
  let m: RegExpExecArray | null;

  while ((m = pairRe.exec(xml)) !== null) {
    const rawName = decodeEntities(m[1].trim());
    if (!rawName || rawName === 'undefined') continue;
    const amtBlock = m[2];
    const mainAmt = xmlText(amtBlock, 'CFBMAINAMT');
    const subAmt  = xmlText(amtBlock, 'CFBSUBAMT');

    if (mainAmt) {
      // Group header (CFBMAINAMT set, CFBSUBAMT empty)
      const total = parseAmt(mainAmt);
      current = { name: rawName, total, children: [] };
      cashFlowSections.push(current);
    } else if (subAmt && current) {
      // Child ledger
      current.children.push({ name: rawName, amount: parseAmt(subAmt) });
    } else if (subAmt) {
      // Child with no parent yet — create implicit section
      current = { name: rawName, total: parseAmt(subAmt), children: [] };
      cashFlowSections.push(current);
    }
  }

  let operatingCF = 0, investingCF = 0, financingCF = 0;

  for (const sec of cashFlowSections) {
    const nl = sec.name.toLowerCase();
    const contribution = sec.total !== 0 ? sec.total : sec.children.reduce((s, c) => s + c.amount, 0);
    if (OPERATING_GROUPS.some(g => nl.includes(g))) {
      operatingCF += contribution;
    } else if (INVESTING_GROUPS.some(g => nl.includes(g))) {
      investingCF += contribution;
    } else if (FINANCING_GROUPS.some(g => nl.includes(g))) {
      financingCF += contribution;
    } else {
      operatingCF += contribution; // default to operating
    }
  }

  const netCashFlow = operatingCF + investingCF + financingCF;
  return { cashFlowSections, operatingCF, investingCF, financingCF, netCashFlow };
}

// ── Ledger group map (from All Masters DayBook/Sales/Purchase XML) ─────────

/** Parse LEDGER PARENT assignments from an All Masters IMPORTDATA XML.
 *  Returns Map<ledgerNameLower, parentGroupLower> for group membership checks. */
export function parseLedgerGroups(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const ledgerRe = /<LEDGER\s+NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/gi;
  let m: RegExpExecArray | null;
  while ((m = ledgerRe.exec(xml)) !== null) {
    const ledgerName = decodeEntities(m[1].trim()).toLowerCase();
    const parent = xmlText(m[2], 'PARENT').toLowerCase();
    if (ledgerName && parent) map.set(ledgerName, parent);
  }
  return map;
}

// ── Group Summary parser ──────────────────────────────────────────────────

export function parseGrpSum(_xml: string, ledgerGroups?: Map<string, string>): {
  salesWrongGroup: boolean;
  purchaseWrongGroup: boolean;
  dutiesUnderExpense: boolean;
} {
  if (!ledgerGroups || ledgerGroups.size === 0) {
    return { salesWrongGroup: false, purchaseWrongGroup: false, dutiesUnderExpense: false };
  }

  let salesWrongGroup = false;
  let purchaseWrongGroup = false;
  let dutiesUnderExpense = false;

  for (const [ledger, parent] of ledgerGroups) {
    if (ledger.includes('sales') || ledger.includes('revenue from')) {
      if (!parent.includes('sales account') && !parent.includes('direct income') && !parent.includes('income')) {
        salesWrongGroup = true;
      }
    }
    if (ledger.includes('purchase') || ledger.includes('cost of goods')) {
      if (!parent.includes('purchase account') && !parent.includes('direct expense') && !parent.includes('cost of sales')) {
        purchaseWrongGroup = true;
      }
    }
    if (ledger.includes('cgst') || ledger.includes('sgst') || ledger.includes('igst') || ledger.includes('output gst') || ledger.includes('tds payable')) {
      if (parent.includes('indirect expense') || parent.includes('direct expense')) {
        dutiesUnderExpense = true;
      }
    }
  }

  return { salesWrongGroup, purchaseWrongGroup, dutiesUnderExpense };
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
    purchVoucherTotal: 0, cashBankNetMovement: 0, paymentTotal: 0,
    taxVoucherTotal: 0, journalNetAmt: 0, outOfFY: 0,
    vouchers: [],
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
  voucherTypeOverrides?: Map<string, SemanticVoucherType>,
) {
  stats.totalVouchers++;

  const vno = xmlText(block, 'VOUCHERNUMBER');
  const narration = xmlText(block, 'NARRATION');
  const vtypeRaw = xmlText(block, 'VOUCHERTYPENAME') || '';
  const vtype = vtypeRaw.toLowerCase();
  const party = xmlText(block, 'PARTYLEDGERNAME');
  const dateStr = xmlText(block, 'DATE');
  const amt = extractAmt(block);

  // Phase 4: classify the voucher type to its semantic role.  This is the
  // single source of truth for every downstream rule that asks "is this a
  // sales / purchase / receipt / payment / journal / contra voucher" —
  // user-defined types like "Bank Charges Entry" map to `payment`,
  // "Customer Return" maps to `sales-return`, etc.
  const semantic = classifyVoucherType(vtypeRaw, voucherTypeOverrides).semantic;
  const isSales         = semantic === 'sales';
  const isSalesReturn   = semantic === 'sales-return';
  const isPurchase      = semantic === 'purchase';
  const isPurchaseReturn = semantic === 'purchase-return';
  const isReceipt       = semantic === 'receipt';
  const isPayment       = semantic === 'payment';
  const isJournal       = semantic === 'journal';
  const isContra        = semantic === 'contra';

  if (!vno) stats.missingVno++;
  if (narration) stats.narrated++;

  if (vno) {
    stats.dupVnoMap[vno] = (stats.dupVnoMap[vno] || 0) + 1;
  }

  // A party (debtor/creditor/cash/bank) is expected for sales, purchase,
  // receipt, payment, and their returns.  Memorandum / Stock / Order
  // vouchers don't need one.
  if (!party && (isSales || isSalesReturn || isPurchase || isPurchaseReturn || isReceipt || isPayment)) {
    stats.missingParty++;
  }

  if (amt === 0) stats.zeroAmt++;

  if (amt > 100_000 && narration) stats.highValueNarrated++;
  if (amt > 100_000) stats.highValueCount++;

  if (isJournal) {
    stats.totalJournals++;
    stats.journalNetAmt += amt;
  }

  // Cash >₹10k threshold (s.269ST compliance) — fires on any voucher whose
  // type *name* contains "cash" (Tally's "Cash Payment", "Cash Receipt").
  // Kept on raw substring because it's a heuristic about ledger choice,
  // not voucher semantics.
  if (vtype.includes('cash') && amt > 10_000) stats.cashOver10k++;

  // Wrong-type voucher detection (heuristic).  Gathers every ledger name in
  // this voucher (party + ALLLEDGERENTRIES.LIST > LEDGERNAME) and applies
  // two high-confidence rules:
  //   1. Journal vouchers must not touch cash or bank ledgers — those
  //      movements belong in Receipt/Payment vouchers (treating Journal as
  //      a real cash entry is a common book-keeping anti-pattern that
  //      breaks the bank-reconciliation trail).
  //   2. Receipt and Payment vouchers must involve a cash or bank ledger
  //      by definition; a Receipt with no cash/bank counterpart is a
  //      misclassified entry (often a Journal labelled as Receipt).
  // Substring matching ("cash" / "bank") catches the standard Tally
  // ledger names ("HDFC Bank", "Petty Cash", "Bank Accounts", "Cash in
  // Hand", "Cash-in-Hand") at the cost of rare false positives like a
  // customer named "Cashew Traders".
  const ledgerNames = [
    party,
    ...xmlAll(block, 'LEDGERNAME'),
  ].map(s => s.toLowerCase()).filter(Boolean);
  const touchesBankCash = ledgerNames.some(n => /(bank|cash)/.test(n));
  // Phase 4: use semantic type, not raw substring — so "Bank Charges Entry"
  // (semantic 'payment') correctly requires a bank/cash counterpart, and
  // "Reversing Journal" (semantic 'journal') correctly flags cash/bank
  // touches as wrong-type.  Previously these custom types slipped past
  // the substring `vtype.includes('journal')` test.
  if (isJournal && touchesBankCash) {
    stats.wrongType++;
  } else if ((isReceipt || isPayment) && !touchesBankCash && ledgerNames.length > 0) {
    stats.wrongType++;
  }

  if (amt > 0 && amt % 1000 === 0) stats.roundCount++;

  // Phase 4: sign-aware revenue/expense aggregation.  Sales Returns and
  // Purchase Returns reduce the net total instead of inflating it (the
  // pre-Phase-4 code added them as positive sales because vtype string
  // contained "sales").
  if (isSales)          stats.salesVoucherTotal += amt;
  if (isSalesReturn)    stats.salesVoucherTotal -= amt;
  if (isPurchase)       stats.purchVoucherTotal += amt;
  if (isPurchaseReturn) stats.purchVoucherTotal -= amt;
  if (isJournal)        stats.taxVoucherTotal   += amt;

  // Cash/Bank movement total — fired by Receipt, Payment, and Contra
  // vouchers (Contra moves between cash and bank), plus the legacy
  // substring fallback for vouchers whose type literally contains
  // "cash"/"bank" (covers user-defined types that haven't been classified
  // yet via the override store).
  if (isReceipt || isPayment || isContra || vtype.includes('cash') || vtype.includes('bank')) {
    stats.cashBankNetMovement += amt;
  }
  // Payment-only volume — used as the denominator in E6's TDS-as-%-of-
  // payments check.  Excludes Receipts (money in) and Contras (internal
  // bank↔cash) since neither attracts TDS.
  if (isPayment) stats.paymentTotal += amt;

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

  // Push the actual transaction detail (limit to 50000 to prevent crashing on massive DBs)
  if (!stats.vouchers) stats.vouchers = [];
  if (stats.vouchers.length < 50000) {
    stats.vouchers.push({
      date: dateStr || '',
      vno: vno || '',
      type: vtype || '',
      party: party || '',
      amount: amt,
      narration: narration || '',
    });
  }
}

// ── Assemble ParsedData from parsed pieces ────────────────────────────────

export function assembleParsedData(
  tbResult: ReturnType<typeof parseTrialBalance> | null,
  plResult: ReturnType<typeof parsePandL> | null,
  bsResult: ReturnType<typeof parseBSheet> | null,
  grpResult: ReturnType<typeof parseGrpSum> | null,
  cfResult: ReturnType<typeof parseCashFlow> | null,
): Partial<ParsedData> {
  return {
    ...(tbResult ?? {}),
    ...(plResult ?? {}),
    ...(bsResult ?? {}),
    ...(grpResult ?? {}),
    ...(cfResult ?? {}),
  };
}

// ── Phase 1: Master Map (Chart of Accounts) ──────────────────────────────
//
// Parses a Tally "All Masters" XML export (Master.xml / DayBook.xml) and
// builds a canonical name→entry map that downstream statement parsers use
// to resolve zero-balance hierarchy tie-breakers.
//
// Rules:
//  • GROUP blocks  → type = 'group'
//  • LEDGER blocks → type = 'ledger' (overrides same-keyed group if duplicate)
//  • Empty <PARENT> → defaults to "Primary"

export function parseMasterMap(xml: string): Map<string, MasterEntry> {
  const map = new Map<string, MasterEntry>();
  const ordered = parseOrderedXml(xml);

  function readEntries(tag: 'GROUP' | 'LEDGER', type: MasterItemType) {
    for (const node of collectOrderedElements(ordered, tag)) {
      const attrs = orderedAttrs(node);
      const rawName = attrs.NAME ?? attrs['@_NAME'] ?? attrs.name ?? '';
      const name = decodeEntities(String(rawName).trim());
      if (!name || name === 'undefined') continue;
      const parent = findOrderedText(orderedChildren(node), 'PARENT').trim() || 'Primary';
      map.set(normalizeMasterKey(name), { name, parent, type });
    }
  }

  readEntries('GROUP', 'group');
  readEntries('LEDGER', 'ledger');

  if (map.size > 0) return map;

  const groupRe = /<GROUP\s+NAME="([^"]+)"[^>]*>([\s\S]*?)<\/GROUP>/gi;
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(xml)) !== null) {
    const name = decodeEntities(m[1].trim());
    if (!name || name === 'undefined') continue;
    const parent = xmlText(m[2], 'PARENT').trim() || 'Primary';
    map.set(normalizeMasterKey(name), { name, parent, type: 'group' });
  }

  const ledgerRe = /<LEDGER\s+NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/gi;
  while ((m = ledgerRe.exec(xml)) !== null) {
    const name = decodeEntities(m[1].trim());
    if (!name || name === 'undefined') continue;
    const parent = xmlText(m[2], 'PARENT').trim() || 'Primary';
    map.set(normalizeMasterKey(name), { name, parent, type: 'ledger' });
  }

  return map;
}

/** Tally standard primary group names on the Liabilities side of the BS. */
export const TALLY_LIABILITY_PRIMARIES = new Set([
  'capital account', 'loans (liability)', 'current liabilities',
  'reserves & surplus', 'provisions', 'branch / divisions',
]);

/** Tally standard primary group names on the Assets side of the BS. */
export const TALLY_ASSET_PRIMARIES = new Set([
  'fixed assets', 'current assets', 'misc. expenses (asset)',
  'investments', 'loans & advances (asset)', 'suspense a/c',
]);

/**
 * Returns true if `ledgerName` lives anywhere in the parent chain of one of
 * the target group names (case-insensitive, normalized).  Used to decide
 * whether a ledger belongs under "Sales Accounts" / "Purchase Accounts" /
 * "Duties & Taxes" / etc. without relying on the ledger's literal name.
 *
 * This is more robust than substring-matching the ledger name because real
 * Tally setups have revenue ledgers like "GST Services", "Service Charges",
 * or "Annual Maintenance" that all sit under the Sales Accounts group but
 * don't contain the word "sales".
 */
export function isUnderTallyGroup(
  ledgerName: string,
  targetGroups: string[],
  masterMap: Map<string, MasterEntry>,
): boolean {
  if (masterMap.size === 0) return false;
  // Compare names with whitespace/punctuation collapsed so that "Cash-in-Hand",
  // "Cash in Hand", and "cash in hand" all match against the same target.
  const stripPunct = (s: string) => s.toLowerCase().replace(/[\s\-_/&.,]+/g, '');
  const targets = new Set(targetGroups.map(stripPunct));
  let current = ledgerName;
  const seen = new Set<string>();
  for (let hop = 0; hop < 20; hop++) {
    if (seen.has(current)) break;
    seen.add(current);
    if (targets.has(stripPunct(current))) return true;
    const entry = masterMap.get(normalizeMasterKey(current));
    if (!entry || !entry.parent || entry.parent.toLowerCase() === 'primary') break;
    current = entry.parent;
  }
  return false;
}

/**
 * Walk the master parent chain from `name` until a known Tally primary group.
 * Returns 'liability', 'asset', or 'unknown' (caller falls back to sign).
 */
export function classifyBSSide(
  name: string,
  masterMap: Map<string, MasterEntry>,
): 'liability' | 'asset' | 'unknown' {
  let current = name;
  const seen = new Set<string>();
  for (let hop = 0; hop < 20; hop++) {
    if (seen.has(current)) break;
    seen.add(current);
    const lname = current.toLowerCase().trim();
    if (TALLY_LIABILITY_PRIMARIES.has(lname)) return 'liability';
    if (TALLY_ASSET_PRIMARIES.has(lname)) return 'asset';
    const entry = masterMap.get(normalizeMasterKey(current));
    if (!entry || !entry.parent || entry.parent.toLowerCase() === 'primary') break;
    current = entry.parent;
  }
  return 'unknown';
}

// ── Phase 2-4 internal helpers ────────────────────────────────────────────

/**
 * Determines whether an account name is a MAIN (group) or SUB (ledger) node
 * and resolves its master-map metadata, following the four-phase rules exactly.
 *
 * Priority order:
 *  1. BSMAINAMT set (and sub empty)  → 'main'
 *  2. BSSUBAMT / PLSUBAMT set        → 'sub'
 *  3. Both empty (zero-balance)      → master map tie-breaker:
 *       GROUP entry  → 'main'
 *       LEDGER entry → 'sub'
 *       Not in map   → 'main' (default per spec)
 *
 * masterParent is "Computed / Not in Master" for any name absent from the map.
 */
function resolveNode(
  name: string,
  mainAmt: string,
  subAmt: string,
  masterMap: Map<string, MasterEntry>,
): {
  nodeType: FinancialNodeType;
  inMaster: boolean;
  masterType: MasterItemType | null;
  masterParent: string;
} {
  const hasMain = mainAmt.trim() !== '';
  const hasSub  = subAmt.trim()  !== '';
  const entry   = masterMap.get(normalizeMasterKey(name));

  // Priority for nodeType:
  //   1. BSMAINAMT / PLAMT main → 'main'  (Tally's explicit top-level signal,
  //      e.g. "Profit & Loss A/c" appearing on the BS as a primary line)
  //   2. Master entry type → authoritative for nested rows
  //        GROUP  → 'main'  (sub-group header — nests Duties & Taxes under
  //                          Current Liabilities, Carriage Inward under Direct
  //                          Expenses, Cash-in-Hand under Current Assets, etc.)
  //        LEDGER → 'sub'   (always a leaf account)
  //   3. Amount-tag fallback for names not in the master file.
  const nodeType: FinancialNodeType =
    hasMain ? 'main' :
    entry?.type === 'group'  ? 'main' :
    entry?.type === 'ledger' ? 'sub'  :
    hasSub  ? 'sub'  :
    'sub';  // unknown + zero-balance → safer leaf default

  return {
    nodeType,
    inMaster: !!entry,
    masterType:   entry?.type   ?? null,
    masterParent: entry?.parent ?? 'Computed / Not in Master',
  };
}

interface StatementToken {
  name: string;
  mainAmt: string;
  subAmt: string;
}

function readDisplayName(node: OrderedXmlNode): string {
  const name = orderedElementName(node);
  if (!name) return '';
  if (name.toUpperCase() === 'DSPDISPNAME') {
    return decodeEntities(orderedText(orderedChildren(node, name)).trim());
  }
  return findOrderedText(orderedChildren(node, name), 'DSPDISPNAME');
}

function readAmountBlock(node: OrderedXmlNode, subTag: 'BSSUBAMT' | 'PLSUBAMT') {
  const children = orderedChildren(node);
  return {
    mainAmt: findOrderedText(children, 'BSMAINAMT'),
    subAmt: findOrderedText(children, subTag),
  };
}

function collectStatementTokens(
  nodes: OrderedXmlNode[],
  statement: 'pandl' | 'bsheet',
  out: StatementToken[] = [],
): StatementToken[] {
  function nextElementIndex(start: number): number {
    for (let j = start + 1; j < nodes.length; j++) {
      if (orderedElementName(nodes[j])) return j;
    }
    return -1;
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextIndex = nextElementIndex(i);
    const next = nextIndex >= 0 ? nodes[nextIndex] : undefined;
    const name = orderedElementName(node);
    const nextName = next ? orderedElementName(next) : null;
    const upperName = name?.toUpperCase();
    const upperNext = nextName?.toUpperCase();

    if (next && statement === 'pandl' && upperName === 'DSPACCNAME' && upperNext === 'PLAMT') {
      const displayName = readDisplayName(node);
      const amounts = readAmountBlock(next, 'PLSUBAMT');
      out.push({ name: displayName, ...amounts });
      i = nextIndex;
      continue;
    }

    if (next && upperName === 'BSNAME' && upperNext === 'BSAMT') {
      const displayName = readDisplayName(node);
      const amounts = readAmountBlock(next, 'BSSUBAMT');
      out.push({ name: displayName, ...amounts });
      i = nextIndex;
      continue;
    }

    // Lightweight fallback for compact test fixtures that omit BSNAME/DSPACCNAME wrappers.
    if (next && upperName === 'DSPDISPNAME' && upperNext === 'BSAMT') {
      const displayName = readDisplayName(node);
      const amounts = readAmountBlock(next, 'BSSUBAMT');
      out.push({ name: displayName, ...amounts });
      i = nextIndex;
      continue;
    }

    collectStatementTokens(orderedChildren(node, name ?? undefined), statement, out);
  }

  return out;
}

function buildStatement(
  statement: 'pandl' | 'bsheet',
  xml: string,
  masterMap: Map<string, MasterEntry>,
): ParsedStatement {
  _nodeSeq = 0;
  const ordered = parseOrderedXml(xml);
  const companyName = findOrderedText(ordered, 'SVCURRENTCOMPANY') || xmlText(xml, 'SVCURRENTCOMPANY');
  const tokens = collectStatementTokens(ordered, statement);
  const parsedNodes: FinancialNode[] = [];

  // Master-aware placement: maintain a stack of active group nodes (root → deepest).
  // For every node, look up its master-defined parent. If the parent is in the stack,
  // place the node under it (popping deeper levels for 'main' headers). Otherwise fall
  // back to the most recent root section. This mirrors Tally's true Chart of Accounts
  // hierarchy (e.g. Cash-in-Hand → Current Assets, Carriage Inward → Direct Expenses).
  const stack: FinancialNode[] = [];
  let lastRoot: FinancialNode | null = null;

  function findInStack(parentName: string): number {
    const norm = parentName.toLowerCase().trim();
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name.toLowerCase().trim() === norm) return i;
    }
    return -1;
  }

  for (const token of tokens) {
    const name = decodeEntities(token.name.trim());
    if (!name || name === 'undefined') continue;

    // Keep zero/blank-balance rows — display as ₹0 so nothing is silently hidden.
    const hasMain = token.mainAmt.trim() !== '';
    let amount = parseAmt(token.mainAmt || token.subAmt);
    const resolved = resolveNode(name, token.mainAmt, token.subAmt, masterMap);
    // "Less: Closing Stock" etc. — Tally emits these as Dr (negative) even though
    // they reduce a debit group total. Flip sign so children sum equals group total.
    if (/^less[\s:]/i.test(name)) amount = -amount;
    const node = makeNode(name, amount, resolved);

    const masterParent = resolved.masterParent;
    const hasRealMasterParent =
      !!masterParent &&
      masterParent !== 'Computed / Not in Master' &&
      masterParent.toLowerCase() !== 'primary';

    let placed = false;

    if (hasRealMasterParent) {
      const idx = findInStack(masterParent);
      if (idx >= 0) {
        stack[idx].children.push(node);
        node.sourceParent = stack[idx].name;
        if (resolved.nodeType === 'main') {
          // Group header — pop deeper levels and become the new top of stack
          stack.splice(idx + 1);
          stack.push(node);
        }
        placed = true;
      }
    }

    if (!placed) {
      if (resolved.nodeType === 'main') {
        // A header. Two cases:
        //   (a) hasMain (BSMAINAMT / PLAMT main set) → Tally's explicit top-level
        //       section start → push to root, reset stack.
        //   (b) Header with only hasSub — Tally rolled this group into the
        //       parent section's totals (e.g. P&L: Direct Expenses appears as a
        //       PLSUBAMT line inside the Cost of Sales block per the formula
        //       Cost of Sales = Opening + Purchases − Closing + Direct Expenses).
        //       Nest under current top of stack so the section total reconciles
        //       and so this group's own children (e.g. Carriage Inward → Direct
        //       Expenses) can still nest under it via the master lookup above.
        if (hasMain || stack.length === 0) {
          parsedNodes.push(node);
          stack.length = 0;
          stack.push(node);
          lastRoot = node;
        } else {
          const parent = stack[stack.length - 1];
          parent.children.push(node);
          node.sourceParent = parent.name;
          stack.push(node);
        }
      } else {
        // Sub item whose master parent isn't in stack — anchor to current section root.
        // This handles Tally display quirks (e.g. Input CGST/SGST appearing in the
        // Current Assets section even though their master parent is Duties & Taxes).
        const fallback = lastRoot;
        if (fallback) {
          fallback.children.push(node);
          node.sourceParent = fallback.name;
        } else {
          parsedNodes.push(node);
        }
      }
    }
  }

  annotateChildAmountChecks(parsedNodes);

  return {
    statement,
    companyName,
    nodes: parsedNodes,
    totals: statementTotals(parsedNodes),
  };
}

let _nodeSeq = 0;

function makeNode(
  name: string,
  amount: number,
  resolved: ReturnType<typeof resolveNode>,
  extra: Partial<Pick<FinancialNode, 'synthetic' | 'sourceParent'>> = {},
): FinancialNode {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = `${slug}-${++_nodeSeq}`;
  return {
    id,
    name,
    amount,
    nodeType:    resolved.nodeType,
    inMaster:    resolved.inMaster,
    masterType:  resolved.masterType,
    masterParent: resolved.masterParent,
    ...extra,
    children: [],
  };
}

function makeSyntheticHeader(name: string, masterMap: Map<string, MasterEntry>): FinancialNode {
  const entry = masterMap.get(normalizeMasterKey(name));
  return makeNode(
    entry?.name ?? name,
    0,
    {
      nodeType: 'main',
      inMaster: !!entry,
      masterType: entry?.type ?? 'group',
      masterParent: entry?.parent ?? 'Computed / Not in Master',
    },
    { synthetic: true },
  );
}

function hasUsableMasterParent(node: FinancialNode): boolean {
  return node.inMaster && node.masterParent.trim() !== '' && normalizeMasterKey(node.masterParent) !== 'primary';
}

function groupStatementByMasterParent(
  parsedNodes: FinancialNode[],
  masterMap: Map<string, MasterEntry>,
): FinancialNode[] {
  const roots: FinancialNode[] = [];
  const nodeByName = new Map<string, FinancialNode>();
  const syntheticByName = new Map<string, FinancialNode>();
  const rooted = new Set<FinancialNode>();
  const attached = new Set<FinancialNode>();
  let currentComputedParent: FinancialNode | null = null;

  for (const node of parsedNodes) {
    const key = normalizeMasterKey(node.name);
    if (!nodeByName.has(key)) nodeByName.set(key, node);
  }

  function pushRoot(node: FinancialNode) {
    if (!rooted.has(node) && !attached.has(node)) {
      roots.push(node);
      rooted.add(node);
    }
  }

  function appendChild(parent: FinancialNode, child: FinancialNode) {
    if (parent === child || parent.children.includes(child)) return;
    parent.children.push(child);
    attached.add(child);
    const rootIndex = roots.indexOf(child);
    if (rootIndex >= 0) roots.splice(rootIndex, 1);
  }

  function getParentHeader(parentName: string): FinancialNode {
    const key = normalizeMasterKey(parentName);
    const existing = nodeByName.get(key);
    if (existing) return existing;

    let synthetic = syntheticByName.get(key);
    if (!synthetic) {
      synthetic = makeSyntheticHeader(parentName, masterMap);
      syntheticByName.set(key, synthetic);
      nodeByName.set(key, synthetic);
    }
    return synthetic;
  }

  function wouldCreateCycle(parent: FinancialNode, child: FinancialNode): boolean {
    if (parent === child) return true;
    const stack = [...child.children];
    while (stack.length) {
      const next = stack.pop()!;
      if (next === parent) return true;
      stack.push(...next.children);
    }
    return false;
  }

  function placeMasterNode(node: FinancialNode, visiting = new Set<string>()) {
    const key = normalizeMasterKey(node.name);
    if (visiting.has(key)) {
      pushRoot(node);
      return;
    }

    if (!hasUsableMasterParent(node)) {
      pushRoot(node);
      return;
    }

    const parent = getParentHeader(node.masterParent);
    if (wouldCreateCycle(parent, node)) {
      pushRoot(node);
      return;
    }

    visiting.add(key);
    if (hasUsableMasterParent(parent)) {
      placeMasterNode(parent, visiting);
    } else {
      pushRoot(parent);
    }
    visiting.delete(key);

    appendChild(parent, node);
    node.sourceParent = parent.name;
  }

  for (const node of parsedNodes) {
    if (!node.inMaster) {
      if (node.nodeType === 'main') {
        pushRoot(node);
        currentComputedParent = node;
      } else if (currentComputedParent) {
        appendChild(currentComputedParent, node);
        node.sourceParent = currentComputedParent.name;
      } else {
        pushRoot(node);
      }
      continue;
    }

    placeMasterNode(node);
  }

  return roots;
}

const CHILD_AMOUNT_TOLERANCE = 0.01;

function annotateChildAmountChecks(nodes: FinancialNode[]) {
  for (const node of nodes) {
    annotateChildAmountChecks(node.children);
    if (node.children.length === 0 || node.synthetic) continue;

    const childrenTotal = node.children.reduce((sum, child) => sum + child.amount, 0);
    const childrenVariance = node.amount - childrenTotal;
    node.childrenTotal = childrenTotal;
    node.childrenVariance = childrenVariance;
    node.childrenBalanced = Math.abs(childrenVariance) <= CHILD_AMOUNT_TOLERANCE;
  }
}

function statementTotals(nodes: FinancialNode[]) {
  let credit = 0, debit = 0;
  for (const n of nodes) {
    if (n.amount >= 0) credit += n.amount;
    else               debit  += Math.abs(n.amount);
  }
  return { credit, debit, net: credit - debit };
}

// ── Phase 2-4: P&L Statement parser ──────────────────────────────────────
//
// Two token types appear interleaved in PandL.xml (in document order):
//   A) <DSPACCNAME><DSPDISPNAME>…</DSPDISPNAME></DSPACCNAME> <PLAMT>…</PLAMT>
//      → Group header row. BSMAINAMT set = MAIN; PLSUBAMT set = SUB.
//   B) <BSNAME>…<DSPDISPNAME>…</DSPDISPNAME>…</BSNAME> <BSAMT>…</BSAMT>
//      → Ledger child row.  BSSUBAMT set = SUB; BSMAINAMT set = MAIN (rare).
//
// The "current group" pointer advances whenever a MAIN node is encountered.
// SUB nodes are appended to the current group's children[].

export function parsePandLStatement(
  xml: string,
  masterMap: Map<string, MasterEntry>,
): ParsedStatement {
  return buildStatement('pandl', xml, masterMap);
}

// ── Phase 2-4: Balance Sheet parser ──────────────────────────────────────
//
// BSheet.xml emits a flat stream of <DSPDISPNAME> + <BSAMT> pairs.
// Classification rules are identical to the P&L but use only BSMAINAMT /
// BSSUBAMT (no PLSUBAMT).  Zero-balance pairs (both tags empty) use the
// master map tie-breaker.

export function parseBSheetStatement(
  xml: string,
  masterMap: Map<string, MasterEntry>,
): ParsedStatement {
  return buildStatement('bsheet', xml, masterMap);
}

// ── Utility: flatten a ParsedStatement into a 2-D row array ──────────────
//
// Produces a flat array suitable for:
//   • Excel export via lib/excel.ts
//   • Table UI components with depth-based indentation
//
// Depth 0 = top-level MAIN account, 1 = direct child, etc.

export function flattenStatement(stmt: ParsedStatement): FlatFinancialRow[] {
  const rows: FlatFinancialRow[] = [];

  function walk(node: FinancialNode, parentGroup: string, depth: number) {
    rows.push({
      id:          node.id,
      name:        node.name,
      amount:      node.amount,
      nodeType:    node.nodeType,
      depth,
      parentGroup,
      inMaster:    node.inMaster,
      masterType:  node.masterType,
      masterParent: node.masterParent,
    });
    for (const child of node.children) {
      walk(child, node.name, depth + 1);
    }
  }

  for (const node of stmt.nodes) {
    walk(node, node.masterParent, 0);
  }

  return rows;
}
