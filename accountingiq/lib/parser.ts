'use client';

import { XMLParser } from 'fast-xml-parser';
import type {
  TBLedger, TBFullRow, ParsedData, ChunkedStats, VoucherFlag,
  MasterEntry, MasterItemType, FinancialNode, FinancialNodeType,
  ParsedStatement, FlatFinancialRow,
} from './types';
import { classifyLedger, type BSHierarchyMap } from './tally-groups';
import { classifyVoucherType, type SemanticVoucherType } from './tally-voucher-types';
import type { OverrideMap } from './ledger-overrides';
import { makeDupKey } from './voucher-filters';

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

/** Same dual-shape logic as readTBClosing for Opening Balance.  Returns
 *  null when no opening tag is present in the block (closing-only TB
 *  exports) so callers can distinguish "absent" from "explicitly zero".
 *  H4 needs this distinction to avoid treating a missing-opening export
 *  as a real zero net movement. */
export function readTBOpening(infoBlock: string): number | null {
  const single = xmlText(infoBlock, 'DSPOPAMTA');
  if (single) return parseAmt(single);
  const dr = xmlText(infoBlock, 'DSPOPDRAMTA');
  const cr = xmlText(infoBlock, 'DSPOPCRAMTA');
  if (!dr && !cr) return null;
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

export function normalizeMasterKey(name: string): string {
  return decodeEntities(name).trim().toLowerCase();
}

/** True for Tally TB rows that are computed P&L carry-forwards rather
 *  than real ledgers — "Profit & Loss A/c" / "Net Profit" / etc.  Every
 *  income/expense ledger that built this row is already present in the
 *  TB, so including it would double-count in totals and surface as
 *  "Unknown" in the categorisation view (the classifier has no group
 *  to walk).  Centralised so every TB parser path applies the same
 *  filter. */
export function isPLDerivedRow(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (
    n === 'profit & loss a/c' || n === 'profit and loss a/c' ||
    n === 'profit & loss account' || n === 'profit and loss account' ||
    n === 'p&l a/c' || n === 'p & l a/c' ||
    n === 'net profit' || n === 'net loss' ||
    n === 'profit & loss' || n === 'profit and loss'
  );
}

/** Lenient line-amount finder.  Walks every <DSPDISPNAME> in the XML and
 *  pairs it with the nearest following <BSAMT>/<PLAMT> block (within ~600
 *  chars), returning the signed amount for the first line whose name
 *  matches one of the patterns.  Used as a fallback when the structured
 *  P&L / BS parsers miss a line because Tally emitted extra metadata
 *  between DSPACCNAME and BSAMT/PLAMT that the strict tokeniser rejects. */
export function findAmountByLineName(xml: string, namePatterns: RegExp[]): number {
  const re = /<DSPDISPNAME>\s*([^<]+?)\s*<\/DSPDISPNAME>[\s\S]{0,600}?<(?:BSAMT|PLAMT)\b[^>]*>([\s\S]*?)<\/(?:BSAMT|PLAMT)>/gi;
  let m: RegExpExecArray | null;
  let best = 0;
  while ((m = re.exec(xml)) !== null) {
    const name = decodeEntities(m[1].trim());
    if (!namePatterns.some(p => p.test(name))) continue;
    const block = m[2];
    const amt = parseAmt(
      xmlText(block, 'BSMAINAMT') ||
      xmlText(block, 'BSSUBAMT')  ||
      xmlText(block, 'PLSUBAMT'),
    );
    if (Math.abs(amt) > Math.abs(best)) best = amt;
  }
  return best;
}

/** Maximally-permissive fallback: search the raw XML for one of the given
 *  textual labels (case-insensitive) and grab the nearest numeric value
 *  inside a tag within ~500 chars after it.  Survives even unusual Tally
 *  Prime export shapes where the structured parsers can't pair name and
 *  amount via tag boundaries (e.g. derived rows like top-level "Closing
 *  Stock" on the P&L Cr side, which doesn't appear in the Trial Balance
 *  and may carry custom tag wrapping).
 *
 *  The "value pattern" looks for any tag whose content is a number, e.g.
 *  `<BSMAINAMT>26111</BSMAINAMT>` or `<PLSUBAMT>-26111</PLSUBAMT>`.  We
 *  scan the slice after the label and take the first non-zero hit. */
export function findAmountNearText(xml: string, labels: RegExp[]): number {
  for (const labelRe of labels) {
    const labelMatch = labelRe.exec(xml);
    if (!labelMatch) continue;
    const slice = xml.slice(labelMatch.index, labelMatch.index + 500);
    const valueRe = /<[A-Z][A-Z\d]*\b[^>]*>\s*(-?[\d,]+(?:\.\d+)?)\s*<\//g;
    let vm: RegExpExecArray | null;
    while ((vm = valueRe.exec(slice)) !== null) {
      const n = parseAmt(vm[1]);
      if (n !== 0) return n;
    }
  }
  return 0;
}

/** Extract amount — tries multiple tags in fallback order.
 *  NOTE: Uses Math.abs() because voucher amounts are always positive quantities.
 *  For BS/PL amounts where sign matters, use parseAmt() directly. */
/**
 * Extract the voucher master amount as an ABSOLUTE magnitude.  Used for
 * threshold checks and counters where sign doesn't matter:
 *   - per-voucher amount display
 *   - high-value flag (`> ₹1L`)
 *   - cash-over-₹10k flag (Sec 40A(3))
 *   - zero-amount flag
 *   - round-number detection (`% 1000 === 0`)
 *
 * For sign-aware logic (sales/purchase NET direction, Tally Day Book
 * columnar Dr/Cr placement), use {@link extractSignedAmt} instead — or
 * better, read the FIRST leg's `ISDEEMEDPOSITIVE` flag from
 * `ALLLEDGERENTRIES.LIST` / `LEDGERENTRIES.LIST` directly, which is the
 * authoritative direction signal in Tally invoice-mode exports.
 *
 * Tag fallback chain reflects Tally export variants — `AMOUNT` at voucher
 * level (most exports), `DSPAMT` for display reports, `BSSUBAMT` for
 * occasional invoice shapes, and finally the first per-leg `AMOUNT`
 * inside ALLLEDGERENTRIES.LIST when no voucher-level tag is present.
 */
/**
 * Effective Dr/Cr direction of a single voucher leg.  Shared by both the
 * first-leg sign-aware H2/H3 net calculator AND the per-voucher `legs[]`
 * array populator — keeping them in lockstep so H4 cash-leg direction,
 * wrong-type rescan, and net-sales/purchase totals all agree on what's
 * Dr vs Cr for the same leg, including reversal entries.
 *
 * Rules in priority order:
 *   1. ISDEEMEDPOSITIVE=Yes                → Dr  (regardless of AMOUNT sign)
 *   2. ISDEEMEDPOSITIVE=No, AMOUNT ≥ 0     → Cr  (standard Cr)
 *   3. ISDEEMEDPOSITIVE=No, AMOUNT < 0     → Dr  (reversal entry — Tally
 *                                                 displays as "(-)X" in
 *                                                 the Dr column)
 *   4. flag missing, AMOUNT ≥ 0            → Dr  (positive value = Dr)
 *   5. flag missing, AMOUNT < 0            → Cr  (negative value = Cr)
 *
 * Empirically verified against Tally Prime invoice-mode exports (which
 * counter-intuitively store Dr legs as flag=Yes + negative AMOUNT) and
 * voucher-mode exports (Dr = positive AMOUNT, flag often absent).
 */
export function legDirection(flag: string, amount: number): boolean {
  if (flag) return /yes/i.test(flag) ? true : amount < 0;
  return amount >= 0;
}

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

/** Signed variant of extractAmt — preserves the Tally Dr/Cr sign on the
 *  master voucher amount.  Used by sales/purchase totals so returns
 *  entered as Cr-side line items inside a regular "Purchase" voucher type
 *  (the common pattern) subtract from the net instead of inflating it.
 *
 *  Sign convention (mirrors how parseAmt + ISDEEMEDPOSITIVE align in
 *  ALLLEDGERENTRIES.LIST):
 *    • positive → party-leg is Dr (sale: customer owes you;
 *      purchase return: refund flowing back to you)
 *    • negative → party-leg is Cr (purchase: you owe vendor;
 *      sales return: refund flowing out)
 *
 *  Normal sale          → master AMOUNT positive → add as-is.
 *  Sales return         → master AMOUNT negative → still add → reduces total.
 *  Normal purchase      → master AMOUNT negative → negate → add positive.
 *  Purchase return      → master AMOUNT positive → negate → add negative → reduces.
 */
export function extractSignedAmt(voucherXml: string): number {
  for (const tag of ['AMOUNT', 'DSPAMT', 'BSSUBAMT']) {
    const v = xmlText(voucherXml, tag);
    if (v) return parseAmt(v);
  }
  const entries = xmlAll(voucherXml, 'AMOUNT');
  if (entries.length > 0) return parseAmt(entries[0]);
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

/**
 * Detect whether the TB XML uses Dr-positive or Cr-positive sign convention.
 * Returns the multiplier needed to normalize each ledger value to canonical
 * **Dr-positive** form (positive = Dr balance, negative = Cr balance).
 *
 *   +1 → source is Dr-positive (no flip needed)
 *   −1 → source is Cr-positive (apply ×−1 to closing/opening)
 *    0 → too few classifiable ledgers to vote conclusively; caller
 *        should treat the convention as uncertain.  Downstream code
 *        currently treats 0 as "no flip" (matches Dr-positive in the
 *        common case) but engine checks can opt to surface "uncertain"
 *        on D1/D5 when this happens, avoiding a confidently-wrong result
 *        on a thin TB-only upload with cryptic ledger names.
 *
 * Vote logic: for each ledger whose category we know the natural side of
 * (capital should be Cr, debtor should be Dr, etc.), check whether its
 * raw closing sign matches the Dr-positive expectation.  Majority wins.
 */
export function detectTBSignFlipVote(
  tbLedgers: TBLedger[],
  masterMap: Map<string, MasterEntry>,
  overrides?: OverrideMap,
  bsHierarchy?: BSHierarchyMap,
): 1 | -1 | 0 {
  const expectedSignDrPos: Partial<Record<string, 1 | -1>> = {
    capital:   -1,
    creditor:  -1,
    'bank-od': -1,
    debtor:     1,
    sales:     -1,
    purchase:   1,
  };
  let crPosVotes = 0;
  let drPosVotes = 0;
  for (const l of tbLedgers) {
    if (l.closing === 0) continue;
    const cat = classifyLedger(l.name, masterMap, overrides, bsHierarchy).category;
    const expected = expectedSignDrPos[cat];
    if (!expected) continue;
    const actual: 1 | -1 = l.closing > 0 ? 1 : -1;
    if (actual === expected) drPosVotes++; else crPosVotes++;
  }
  // Need ≥3 informative votes to make a confident call.  Below that, the
  // result is too noisy on thin uploads (e.g. TB-only with cryptic ledger
  // names) and would silently flip the convention the wrong way.
  if (crPosVotes + drPosVotes < 3) return 0;
  return crPosVotes > drPosVotes ? -1 : 1;
}

/** Apply a sign-flip multiplier to a TBLedger array IN-PLACE.  Always
 *  recomputes `dr` from the resulting closing sign so every downstream
 *  consumer sees consistent (positive=Dr, negative=Cr) values.  `0` is
 *  treated as "no flip" — caller decides whether to also raise an
 *  uncertain status on downstream checks.  Period movements come from
 *  `readTBMovements` as absolute magnitudes, so they don't need a flip. */
export function applyTBSignFlip(tbLedgers: TBLedger[], flip: 1 | -1 | 0): void {
  if (flip === -1) {
    for (const l of tbLedgers) {
      l.closing = -l.closing;
      if (l.opening !== undefined) l.opening = -l.opening;
    }
  }
  for (const l of tbLedgers) {
    l.dr = l.closing >= 0;
  }
}

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
  /** Gross cash/bank period turnover from the TB.  0 when the TB lacks
   *  period movement columns — H4 then falls back to net-movement
   *  comparison or returns uncertain. */
  tbCashBankMovement: number;
  /** Signed net change in cash/bank balances over the period — sum of
   *  (closing − opening) across every cash/bank/bank-od ledger.  The
   *  bridge's custom TB collection always supplies opening + closing,
   *  so this is populated even when the TB lacks gross Dr/Cr columns. */
  tbCashBankNetMovement: number;
  pfLedgerFound: boolean;
  salesLedgersNoRate: number;
  gstDiffPct: number;
  suspenseLedgers: Array<{ name: string; amount: number }>;
  dupPairDetails: Array<[string, string]>;
  /** Vote-based sign-convention detection result.  +1 / −1 = confidently
   *  detected; 0 = ambiguous (too few classifiable ledgers).  Engine
   *  surfaces D1/D5 as uncertain when this is 0 so thin uploads with
   *  cryptic ledger names don't get a confidently-wrong answer. */
  tbSignFlip: 1 | -1 | 0;
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
    if (isPLDerivedRow(name)) continue;
    const closing = readTBClosing(infoBlock);
    // Bug 1 fix: preserve sign. Dr = positive, Cr = negative in Tally TB convention
    const movements = readTBMovements(infoBlock);
    const hasMovements = movements.debit !== 0 || movements.credit !== 0;
    const opening = readTBOpening(infoBlock);
    tbLedgers.push({
      name, nl: name.toLowerCase(), closing, dr: closing >= 0,
      ...(hasMovements ? { movements } : {}),
      // Preserve opening when the XML actually had the tag, even if its
      // value is zero — H4's net-flow math needs that to distinguish a
      // genuine zero opening from a closing-only TB export.
      ...(opening !== null ? { opening } : {}),
    });
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
      if (isPLDerivedRow(name)) continue;
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
      if (isPLDerivedRow(name)) continue;
      const closing = parseAmt(drCol[i]) + parseAmt(crCol[i]);
      tbLedgers.push({ name, nl: name.toLowerCase(), closing, dr: closing >= 0 });
    }
  }

  // Classic import-format fallback (LEDGER blocks) — also the shape the
  // bridge's custom TDL TB collection emits.  The Ledger name is in the
  // opening tag's NAME attribute (Tally's collection convention),
  // PARENT / OPENINGBALANCE / CLOSINGBALANCE come as child tags.
  if (tbLedgers.length === 0) {
    const ledgerRe = /<LEDGER\b([^>]*)>([\s\S]*?)<\/LEDGER>/gi;
    while ((m = ledgerRe.exec(xml)) !== null) {
      const attrs = m[1];
      const block = m[2];
      const attrName = /\bNAME="([^"]+)"/i.exec(attrs)?.[1] ?? '';
      const name = decodeEntities(attrName) || xmlText(block, 'NAME') || xmlText(block, 'LEDGERNAME');
      if (!name || name === 'undefined') continue;
      if (masterMap.get(normalizeMasterKey(name))?.type === 'group') continue;
      if (isPLDerivedRow(name)) continue;
      const closing = parseAmt(xmlText(block, 'CLOSINGBALANCE') || xmlText(block, 'CLOSINGBAL'));
      const openingRaw = xmlText(block, 'OPENINGBALANCE') || xmlText(block, 'OPENINGBAL');
      const opening = openingRaw ? parseAmt(openingRaw) : null;
      tbLedgers.push({
        name, nl: name.toLowerCase(), closing, dr: closing >= 0,
        ...(opening !== null ? { opening } : {}),
      });
    }
  }

  // ── Sign-convention normalization ─────────────────────────────────────
  // After this block, every TBLedger field is normalized to canonical
  // Dr-positive convention regardless of which sign convention the source
  // used (positive=Dr, negative=Cr).  See `detectTBSignFlipVote` for the
  // shared vote-based detector — same flip is applied in parseTBFull.
  const signFlip = detectTBSignFlipVote(tbLedgers, masterMap, overrides, bsHierarchy);
  applyTBSignFlip(tbLedgers, signFlip);

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
  let tbCashBankMovement = 0;
  let tbCashBankNetMovement = 0;

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

    // Suspense / miscellaneous balances with NON-ZERO closing — surface
    // every one for the critical-flag panel (engine reports them by name).
    //
    // The regex deliberately matches only `\bsuspense\b` and
    // `\bmiscellaneous\b` — the previous `\bmisc\b` token over-matched
    // legitimate expense/income ledgers like "Misc Expense" / "Misc
    // Income" that aren't suspense accounts at all.  Zero-balance
    // ledgers are skipped because a Suspense A/c with no balance isn't
    // a problem — only ones still holding unallocated amounts are.
    if (
      l.closing !== 0 &&
      (cls.category === 'suspense' || /\bsuspense\b|\bmiscellaneous\b/.test(n))
    ) {
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

    // H4 reconciliation: sum gross period turnover (Dr + Cr) for every
    // cash / bank ledger.  l.movements is only present when the TB export
    // is a "TB with transactions" report; closing-balance-only exports
    // leave it undefined and H4 falls back to the net-movement check.
    if (cls.category === 'cash' || cls.category === 'bank' || cls.category === 'bank-od') {
      if (l.movements) {
        tbCashBankMovement += l.movements.debit + l.movements.credit;
      }
      // Net period movement = closing − opening (signed; +ve = balance
      // grew, −ve = balance shrank).  Always derivable when opening is
      // present, which the bridge's custom TB collection always supplies.
      if (l.opening !== undefined) {
        tbCashBankNetMovement += l.closing - l.opening;
      }
    }


    // Aggregations for cross-statement reconciliation.  Classifier-based
    // (high confidence) PLUS a name-pattern fallback so non-standard
    // ledger names with obvious sales/purchase semantics aren't missed.
    // The fallback only fires when the classifier returned a category
    // that isn't a Cr-side or Dr-side ledger that would conflict —
    // we don't want to misclassify a "Sales Return" Dr ledger as sales,
    // for instance.
    if (cls.category === 'sales') {
      tbSales += Math.abs(l.closing);
    } else if (
      // Name-pattern fallback for sales: matches "Sales Account",
      // "Revenue from Operations", "Service Revenue", etc., when the
      // classifier couldn't categorize confidently.
      (cls.category === 'unknown' || cls.category === undefined) &&
      (/\bsales\b/.test(n) || /\brevenue\b/.test(n) || /\bturnover\b/.test(n)) &&
      !/return|cost\s+of\s+sales/.test(n)
    ) {
      tbSales += Math.abs(l.closing);
    }
    if (cls.category === 'purchase') {
      tbPurch += Math.abs(l.closing);
    } else if (
      // Name-pattern fallback for purchase: matches "Purchases A/c",
      // "Goods Purchased", etc., when the classifier didn't catch them.
      (cls.category === 'unknown' || cls.category === undefined) &&
      /\bpurchas/.test(n) &&
      !/return/.test(n)
    ) {
      tbPurch += Math.abs(l.closing);
    }
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
    outputGSTAmt, inputITCAmt, tdsLedgerFound, tdsPayableAmt, tbStock, tbCashBankMovement, tbCashBankNetMovement, pfLedgerFound,
    salesLedgersNoRate: 0,
    gstDiffPct: 0,
    suspenseLedgers,
    dupPairDetails,
    tbSignFlip: signFlip,
  };
}

/**
 * Parse the full Trial Balance XML into ALL rows — both group rollup rows and
 * individual ledger rows — preserving Tally's document order (parents before
 * children).  Intended for the hierarchical Data View display only; does NOT
 * filter groups (use parseTrialBalance for analysis checks).
 *
 * Sign convention: normalized to **Dr-positive** form (positive closing = Dr
 * balance, negative = Cr balance) via the same vote-based detector used by
 * parseTrialBalance.  Pre-normalization, sources can be Dr-positive (Dummy
 * data) or Cr-positive (many real exports); after this function, callers see
 * a single canonical convention regardless of source.
 *
 * Note: TBFullRow doesn't carry a `dr` boolean, only `closing`/`opening`.
 * Consumers (DataView) should treat `closing > 0 → Dr`, `closing < 0 → Cr`.
 */
export function parseTBFull(
  xml: string,
  masterMap: Map<string, MasterEntry> = new Map(),
  overrides?: OverrideMap,
  bsHierarchy?: BSHierarchyMap,
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
    if (isPLDerivedRow(name)) continue;
    const masterEntry = masterMap.get(normalizeMasterKey(name));
    const mov = readTBMovements(infoBlock);
    rows.push({
      name,
      opening:   readTBOpening(infoBlock) ?? 0,
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
    if (isPLDerivedRow(name)) continue;
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
    if (isPLDerivedRow(name)) continue;
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
    if (isPLDerivedRow(name)) continue;
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

  // Sign-convention normalization — vote across ledger (non-group) rows
  // whose natural Dr/Cr side we know, then flip every row to canonical
  // Dr-positive form so DataView's `closing > 0 → Dr` bucketing reads
  // correctly regardless of which sign convention the source XML used.
  //
  // Only ledger rows vote (groups inherit their children's signs and
  // would skew the result on a pure-group TB header view).  Apply the
  // resulting flip to ALL rows (groups + ledgers) so parent/child
  // rollups stay consistent under the normalized convention.
  const voteLedgers: TBLedger[] = rows
    .filter(r => !r.isGroup)
    .map(r => ({ name: r.name, nl: r.name.toLowerCase(), closing: r.closing, dr: r.closing >= 0 }));
  const flip = detectTBSignFlipVote(voteLedgers, masterMap, overrides, bsHierarchy);
  if (flip === -1) {
    for (const r of rows) {
      r.closing = -r.closing;
      r.opening = -r.opening;
    }
  }

  return rows;
}

// ── Near-duplicate detection (Bug 3 fix) ──────────────────────────────────

/** Stem a word: strip trailing 'es', 's', 'ing' for comparison */
function stem(word: string): string {
  // -ing suffix.  Also handle the doubled-consonant English rule so
  // "travelling" → "travell" → "travel" and "selling" → "sell".  The
  // letter set covers the consonants that English actually doubles
  // before -ing (b, d, f, g, l, m, n, p, r, t).  We accept that this
  // can over-stem in rare cases (e.g. "filling" → "fil") because
  // accounting ledger names hardly ever use those words as standalone
  // tokens — the upside (catching Travel / Travelling) is bigger.
  if (word.endsWith('ing') && word.length > 5) {
    let s = word.slice(0, -3);
    if (s.length >= 2
      && s[s.length - 1] === s[s.length - 2]
      && /[bcdfglmnprt]/.test(s[s.length - 1])) {
      s = s.slice(0, -1);
    }
    return s;
  }
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  // Trailing -e mirrors the -es rule so "expense" and "expenses" both
  // stem to "expens"; without this, plurals where the singular ends in
  // -e (expense / charge / service / sale) fail to merge.
  if (word.endsWith('e') && word.length > 4) return word.slice(0, -1);
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

/** Common accounting abbreviations and their expansions.  Applied before
 *  tokenisation so "HDFC Bank A/c" tokenises the same as "HDFC Bank
 *  Account", and "ABC Pvt Ltd" the same as "ABC Private Limited". */
function expandAbbrev(s: string): string {
  return s
    .replace(/\ba\s*\/\s*c\b/gi, ' account ')
    .replace(/\bac\b/gi,         ' account ')
    .replace(/\bltd\b/gi,        ' limited ')
    .replace(/\bpvt\b/gi,        ' private ')
    .replace(/\bco\b/gi,         ' company ')
    .replace(/\binc\b/gi,        ' incorporated ')
    .replace(/\bcorp\b/gi,       ' corporation ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Tokenise a ledger name: lowercase, split on whitespace AND punctuation
 *  (so "Cash-in-hand" → ["cash","in","hand"], not ["cashinhand"]).
 *  Preserves % as part of tokens because GST rate labels use it. */
function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^\w\s%]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Stop-words / qualifier tokens — when present in the longer name but
 *  absent in the shorter, they don't materially distinguish the two
 *  ledgers.  Lets us treat "Cash" and "Cash in hand" as duplicates while
 *  still treating "Cash" and "Cash Sales" as distinct (Sales is NOT a
 *  qualifier — it shifts the meaning). */
const QUALIFIER_TOKENS = new Set([
  'in', 'on', 'of', 'the', 'and', 'to', 'for', 'by', 'with',
  'account', 'ledger', 'a',
  'hand', 'main', 'primary', 'sub',
]);

/**
 * Near-duplicate detection.  Returns true if two ledger names are likely
 * the same underlying account under slightly different labels.  Designed
 * to catch all of:
 *   1. "Rent Expense" / "Rent Expenses"                  — plural form
 *   2. "Travel Expenses" / "Travelling Expenses"         — verb form (-ing)
 *   3. "Cash" / "Cash-in-hand"                           — qualifier tokens
 *   4. "Axis Bank" / "Axis Bank 916010… A/c"             — formal/expanded
 *   5. "ABC Traders" / "ABC Traders 123"                 — long numeric suffix
 *   6. "HDFC Bank A/c" / "HDFC Bank Account"             — abbreviation
 *   7. "Purchase Account" / "Purchase Accounts (Bills to come)"
 *                                                          — plural + extras
 *   8. Same tokens in different order
 * …without false-positives on:
 *   • "Cash" / "Cash Sales"        — distinct (Sales is a real distinguisher)
 *   • "Cash" / "Petty Cash"        — distinct (Petty is a real qualifier in
 *                                    accounting, kept distinct intentionally)
 *   • "Input CGST" / "Input CGST 9%" — sibling variant (rate slabs)
 */
function isDuplicate(a: string, b: string): boolean {
  if (a === b) return false; // identical names are not "near-duplicate pairs"

  // Sibling-variant exception (rate slabs, A/B/C suffixes, single-digit
  // numbers) wins — these are deliberately separate ledgers in Tally.
  if (isSiblingVariant(a, b)) return false;

  const aExp = expandAbbrev(a);
  const bExp = expandAbbrev(b);
  const tokensA = tokenize(aExp);
  const tokensB = tokenize(bExp);
  const stemsA  = tokensA.map(stem);
  const stemsB  = tokensB.map(stem);

  // Stage 1: identical cleaned strings (kept for parity with the old
  // algorithm — same-after-strip-punctuation is the highest-confidence
  // signal).
  const cleanA = cleanName(aExp);
  const cleanB = cleanName(bExp);
  if (cleanA === cleanB) return true;

  // Stage 2: concatenated stems equal (handles "Rent Expense" / "Rent
  // Expenses", "Travel" / "Travelling", etc. — relies on the improved
  // stem() that handles plurals + verb forms).
  if (stemsA.join('') === stemsB.join('')) return true;

  // Stage 3: stemmed token-SET equality (handles word-order shuffles
  // like "Account Sales" / "Sales Account").  Requires same number of
  // distinct stems on both sides.
  if (stemsA.length === stemsB.length) {
    const setA = new Set(stemsA);
    const setB = new Set(stemsB);
    if (setA.size === setB.size) {
      let allMatch = true;
      for (const t of setA) if (!setB.has(t)) { allMatch = false; break; }
      if (allMatch) return true;
    }
  }

  // Stage 4: stemmed-token prefix containment.  Catches:
  //   • 2+ token prefix matches with arbitrary trailing tokens — e.g.
  //     "Axis Bank" / "Axis Bank 916010030858199 A/c"
  //   • Plural-tolerant prefix matches — e.g. "Purchase Account" /
  //     "Purchase Accounts (Bills to come)" (using stemmed tokens).
  // Plus a 1-token-prefix variant when the extra tokens are all
  // qualifiers (handles "Cash" / "Cash-in-hand" without flagging
  // "Cash" / "Cash Sales").
  if (stemsA.length !== stemsB.length) {
    const short = stemsA.length < stemsB.length ? stemsA : stemsB;
    const long  = stemsA.length < stemsB.length ? stemsB : stemsA;
    if (short.length >= 2 && long.slice(0, short.length).every((t, i) => t === short[i])) {
      return true;
    }
    if (short.length === 1 && long[0] === short[0]) {
      const extensions = long.slice(1);
      if (extensions.length > 0 && extensions.every(t => QUALIFIER_TOKENS.has(t))) {
        return true;
      }
    }
  }

  // Stage 5: Levenshtein similarity on cleaned strings (final safety
  // net for typos / single-character swaps).  Keep the length-diff
  // quick-reject — by this point the earlier prefix / set / stem
  // stages already handle most of what falls outside that window.
  if (Math.abs(a.length - b.length) > 6) return false;
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
  /** Direct Expenses bucket — Indian accounting treats these as part of Cost
   *  of Sales (deducted above the Gross Profit line).  Tracked separately
   *  from `expenses` (indirect) so GP = Revenue − (Stock movement + Purchases
   *  + Direct Expenses) reconciles with Tally's own "Cost of Sales :" rollup. */
  directExpenses: number;
  expenses: number;
  netProfit: number;
  depFound: boolean;
  depAmt: number;
  openingStock: number;
  plClosingStock: number;
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
  let directExpenses = 0;
  let expenses = 0;
  let depAmt = 0;
  let openingStock = 0;
  // Tally usually emits "Less: Closing Stock" as a Dr-side child (its
  // BSSUBAMT is positive in P&L XML even though it reduces Cost of
  // Sales).  We capture the absolute value so the engine can compare
  // against the BS-side stock balance — and detect the common error
  // where the user wrote the P&L adjustment but never created the BS
  // counterpart ledger.
  let plClosingStock = 0;

  for (const sec of plSections) {
    const nl = sec.name.toLowerCase();
    const absTotal = Math.abs(sec.total);
    // Tally Prime emits subtotal/rollup HEADERS whose display name ends
    // with a colon ("Cost of Sales :", "Trading Account :").  Their
    // constituent line items (Opening Stock, Add: Purchases, Less: Closing,
    // Direct Expenses, …) are emitted as SEPARATE sibling sections in the
    // same XML.  Summing both produced the classic double-count where
    // costOfMaterials came back at roughly 2× the true purchase total
    // (e.g. ₹13.11L instead of ₹6.46L on data with a ~₹665K rollup).
    // Skip rollup headers — their components are processed individually.
    if (nl.trim().endsWith(':')) continue;
    // Stock-equation items (Opening Stock / Closing Stock) are handled
    // separately below and must NOT be classified as revenue / cost /
    // income / expense — otherwise they double-skew the P&L derived
    // numbers (Opening Stock 10k would land in otherIncome, etc.).
    const isStockItem =
      nl.includes('opening stock') ||
      nl.includes('closing stock') ||
      nl.includes('stock-in-trade') ||
      nl.includes('stock in trade');
    // Classification by section name substring.  Strengthened matchers
    // catch the most common Tally group names so genuine revenue/expense
    // sections don't slip into the sign-based fallback below (which
    // can't tell a weirdly-named sales group from misc income).
    const isSalesGroup = (
      nl.includes('sales') ||
      nl.includes('revenue') ||
      nl.includes('turnover')
    ) && !nl.includes('cost of sales');
    const isCostGroup = (
      nl.includes('purchase') ||
      nl.includes('cost of sales') ||
      nl.includes('cost of materials') ||
      nl.includes('manufacturing') ||
      nl.includes('raw material')
    );
    const isIncomeGroup = (
      nl.includes('indirect income') ||
      nl.includes('direct income') ||
      (nl.includes('income') && !nl.includes('expense')) ||
      nl.includes('commission received') ||
      nl.includes('interest received') ||
      nl.includes('rent received') ||
      nl.includes('dividend') ||
      nl.includes('royalty')
    );
    // Direct Expenses are tracked separately because Indian accounting
    // treats them as a deduction from Revenue WHEN computing Gross Profit
    // (Tally's "Cost of Sales :" rollup includes Direct Expenses alongside
    // Opening / Purchases / Closing).  Keep them out of the generic
    // expense bucket so GP can subtract them cleanly.
    const isDirectExpenseGroup = (
      // Exact head: "Direct Expenses" group plus common direct-cost ledgers
      // typically nested under it (freight inward, carriage inward, fuel,
      // power & water for production, factory wages).
      nl === 'direct expenses' ||
      nl.startsWith('direct expense') ||
      nl.includes('freight inward') ||
      nl.includes('freight-in') ||
      nl.includes('carriage inward')
    );
    const isExpenseGroup = !isDirectExpenseGroup && (
      nl.includes('expense') ||
      nl.includes('indirect expense') ||
      nl.includes('salary') ||
      nl.includes('salaries') ||
      nl.includes('wages') ||
      nl.includes('depreciation') ||
      nl.includes('rent paid') ||
      nl.includes('freight') ||
      nl.includes('discount allowed')
    );

    if (isStockItem) {
      // Falls through to the openingStock / plClosingStock capture block.
    } else if (isSalesGroup) {
      directRevenue += absTotal;
    } else if (isCostGroup) {
      // Tightened: only purchase-style aggregates feed costOfMaterials.
      // Direct Expenses (factory wages, freight inward, etc.) go to
      // `directExpenses` below and are added back into the COGS deduction
      // at the metrics layer when GP is computed.
      costOfMaterials += absTotal;
    } else if (isDirectExpenseGroup) {
      directExpenses += absTotal;
      // Direct Expenses can still contain a depreciation child (e.g.
      // Depreciation on Plant) — capture it for EBITDA add-back.
      for (const ch of sec.children) {
        if (ch.name.toLowerCase().includes('depreciation')) depAmt += Math.abs(ch.amount);
      }
    } else if (isIncomeGroup) {
      otherIncome += absTotal;
    } else if (isExpenseGroup) {
      expenses += absTotal;
      // Pick depreciation from children
      for (const ch of sec.children) {
        if (ch.name.toLowerCase().includes('depreciation')) depAmt += Math.abs(ch.amount);
      }
    } else if (sec.total !== 0) {
      // Sign-based fallback for non-standard group names.  Sees only
      // sections that didn't match ANY of the keyword sets above, so
      // genuine revenue/expense almost never lands here.  If it does
      // (very custom naming), we still want a deterministic answer
      // rather than ignoring the section entirely.
      // Negative BSMAINAMT = debit side → expense; Positive → income.
      if (sec.total < 0) {
        expenses += Math.abs(sec.total);
      } else {
        otherIncome += sec.total;
      }
    }
    // Opening + Closing stock from children — both appear on the P&L
    // as adjustments to Cost of Sales / Purchases.
    for (const ch of sec.children) {
      const cn = ch.name.toLowerCase();
      if (cn.includes('opening stock')) openingStock += Math.abs(ch.amount);
      if (cn.includes('closing stock') || cn.includes('stock-in-trade') || cn.includes('stock in trade')) {
        plClosingStock += Math.abs(ch.amount);
      }
    }
    // Tally Prime EDU lays out the P&L with Opening Stock and Closing
    // Stock as top-level GROUP rows (siblings of Purchase Accounts,
    // Direct Expenses, Sales Accounts), NOT as children of a Cost-of-
    // Sales aggregate.  Catch them at the section level too, mirroring
    // the existing closing-stock fallback below.
    if (nl.includes('opening stock')) {
      openingStock += absTotal;
    }
    // Sometimes Tally emits "Closing Stock" as its own GROUP (not a
    // child) under Cost of Sales / Manufacturing — pick that up too.
    if (
      nl.includes('closing stock') ||
      nl.includes('stock-in-trade') || nl.includes('stock in trade')
    ) {
      plClosingStock += absTotal;
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

  // Last-resort closing-stock catch — if section/child walks above
  // missed it (Tally emits extra metadata between DSPACCNAME and PLAMT
  // on some configs, which the strict tokeniser skips), scan the whole
  // P&L XML for any line whose name reads as closing stock.
  if (plClosingStock === 0) {
    const found = findAmountByLineName(xml, [
      /\b(less[\s:]+)?closing\s+stock\b/i,
      /\bstock[-\s]?in[-\s]?trade\b/i,
    ]);
    if (found !== 0) plClosingStock = Math.abs(found);
  }
  // Even more permissive fallback — Tally Prime EDU exports derived
  // rows like "Closing Stock" on the P&L Cr side with non-standard tag
  // wrapping that the DSPDISPNAME→PLAMT pairing can miss.  Scan the
  // raw XML for the label and pick up the first numeric tag after it.
  if (plClosingStock === 0) {
    const direct = findAmountNearText(xml, [
      /Closing\s+Stock/i,
      /Stock[-\s]?in[-\s]?Trade/i,
    ]);
    if (direct !== 0) plClosingStock = Math.abs(direct);
  }
  // Final fallback: Tally-specific direct tags.
  if (plClosingStock === 0) {
    const direct = parseAmt(
      xmlText(xml, 'CLOSINGSTOCK') ||
      xmlText(xml, 'STOCKINTRADE') ||
      xmlText(xml, 'CLSTOCKVALUE') ||
      xmlText(xml, 'CLOSINGSTOCKVALUE'),
    );
    if (Math.abs(direct) > 0) plClosingStock = Math.abs(direct);
  }

  const revenue = directRevenue + otherIncome;
  const totalExpenses = costOfMaterials + directExpenses + expenses;
  const netProfit = parseAmt(xmlText(xml, 'NETPROFIT') || xmlText(xml, 'PROFITLOSS') || xmlText(xml, 'NETLOSS')) || (revenue - totalExpenses);

  const depFound = xmlLower.includes('depreciation') || xmlLower.includes('dep exp');
  if (depFound && depAmt === 0) {
    const idx = xmlLower.indexOf('depreciation');
    const slice = xml.slice(Math.max(0, idx - 200), idx + 300);
    depAmt = Math.abs(parseAmt(xmlText(slice, 'BSSUBAMT') || xmlText(slice, 'AMOUNT')));
  }

  return { revenue, directRevenue, otherIncome, costOfMaterials, directExpenses, expenses: totalExpenses, netProfit, depFound, depAmt, openingStock, plClosingStock, plSections };
}


// ── Balance Sheet parser ──────────────────────────────────────────────────

/** Substring/exact match for BS-line names that almost certainly represent
 *  closing stock.  Covers Tally's canonical groups ("Stock-in-Hand",
 *  "Stock-in-Trade", "Closing Stock") plus the common custom names
 *  ("Goods", "Finished Goods", "Raw Material", "Merchandise", "Inventory",
 *  "Work-in-Progress").  Used both at the section-header level and when
 *  scanning sub-items under Current Assets — anyone who named their stock
 *  ledger something unusual would otherwise slip past D5. */
function isStockLikeName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('closing stock') ||
    n.includes('stock-in-trade') || n.includes('stock in trade') ||
    n.includes('stock-in-hand')  || n.includes('stock in hand') ||
    n === 'stock' || n.endsWith(' stock') || n.startsWith('stock ') ||
    n === 'inventory' || n.includes('inventories') || n.includes('inventory') ||
    n === 'goods' || n.endsWith(' goods') ||
    n.includes('finished goods') || n.includes('raw material') ||
    n.includes('semi-finished') || n.includes('semi finished') ||
    n.includes('work-in-progress') || n.includes('work in progress') || n === 'wip' ||
    n.includes('merchandise')
  );
}

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
  /** Suspense / miscellaneous rows seen on the BS — group rollups
   *  like "Suspense A/c" that parseTrialBalance skips (because the
   *  master classifies them as TYPE=group) still surface here so the
   *  engine can flag them.  Zero balances are excluded. */
  bsSuspenseLedgers: Array<{ name: string; amount: number }>;
} {
  let ca = 0, cl = 0, bankBal = 0, debtorBal = 0, creditorBal = 0;
  let closingStock = 0, fixedAssets = 0, cashBal = 0;
  let bsNetProfit: number | null = null;
  const otherCurrentAssets: Array<{ name: string; amount: number }> = [];
  const bsSuspenseLedgers: Array<{ name: string; amount: number }> = [];
  let inCurrentAssets = false;

  // Tally display-report format: BSNAME blocks with DSPDISPNAME + BSAMT(BSSUBAMT/BSMAINAMT)
  // Walk through DSPDISPNAME+amount pairs — use BSMAINAMT when non-empty, else BSSUBAMT
  //
  // Sign convention note: Tally's BS XML stores asset Dr-balances as
  // NEGATIVE in BSMAINAMT (e.g. a bank balance of ₹10,000 shows as
  // "-10000.00") because the report layout reverses Dr/Cr direction
  // relative to the TB.  A negative BSMAINAMT on a bank/cash ledger is
  // NOT an overdraft — it's just a normal Dr asset rendered in BS
  // convention.  Asset items below are abs()'d so downstream code sees
  // the magnitude and doesn't mistakenly flag normal balances as
  // anomalies (overdrafts get classified as bank-od under liabilities,
  // not under bank assets).  Liabilities and equity (capital, creditors)
  // keep their natural BS sign — they're Cr balances stored positive.
  const pairRe = /<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>[\s\S]*?<BSAMT\b[^>]*>([\s\S]*?)<\/BSAMT>/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(xml)) !== null) {
    const rawName = decodeEntities(m[1].trim());
    const name = rawName.toLowerCase();
    const amtBlock = m[2];
    const mainAmt = xmlText(amtBlock, 'BSMAINAMT');
    const subAmt  = xmlText(amtBlock, 'BSSUBAMT');
    const amt = parseAmt(mainAmt || subAmt);
    if (amt === 0 && !mainAmt && !subAmt) continue;

    // Bug 2: capture "Profit & Loss A/c" BSMAINAMT for net profit
    if ((name.includes('profit') && name.includes('loss')) || name.includes('profit & loss')) {
      if (mainAmt) { bsNetProfit = parseAmt(mainAmt); }
      inCurrentAssets = false;
    } else if (name.includes('current assets')) {
      ca = Math.abs(amt);
      inCurrentAssets = true;
    } else if (name.includes('current liabilities')) {
      // Liabilities: always abs.  Different Tally builds emit "Current
      // Liabilities" with positive OR negative BSMAINAMT depending on
      // the company file's sign convention.  Downstream consumers
      // (current ratio = ca/cl, dashboard tiles) need a positive
      // magnitude — keeping it signed produced a negative current
      // ratio on some files and made "Creditors −₹2.06L" appear on the
      // Dashboard alongside a positive Debtors balance.
      cl = Math.abs(amt);
      inCurrentAssets = false;
    } else if (name.includes('fixed asset')) {
      fixedAssets = Math.abs(amt);
      inCurrentAssets = false;
    } else if (name.includes('bank')) {
      bankBal += Math.abs(amt);
    } else if (name.includes('sundry debtor') || name.includes('trade receiv') || name.includes('debtor')) {
      debtorBal += Math.abs(amt);
    } else if (name.includes('sundry creditor') || name.includes('trade payable') || name.includes('creditor')) {
      // Same abs treatment as assets — creditors is a magnitude (the
      // amount the company owes), not a signed value.  Previously this
      // kept Tally's BS sign and rendered as "−₹2.06L" on company files
      // whose BS export stored Sundry Creditors as a negative value.
      creditorBal += Math.abs(amt);
    } else if (isStockLikeName(name)) {
      // Capture the largest non-zero match so a leaf-level "Stock" doesn't
      // overwrite a group-level rollup like "Stock-in-Hand" with a more
      // complete total.
      if (Math.abs(amt) > Math.abs(closingStock)) closingStock = Math.abs(amt);
    } else if (name === 'cash' || name.includes('cash in hand') || name.includes('cash-in-hand')) {
      cashBal += Math.abs(amt);
    } else if (/\bsuspense\b|\bmiscellaneous\b/.test(name) && amt !== 0) {
      // BS-side suspense detection.  Catches the "Suspense A/c" group
      // rollup (and similar) which parseTrialBalance skips because the
      // master file classifies them as TYPE=group.  We exclude zero
      // balances — a Suspense A/c with no balance isn't a problem.
      bsSuspenseLedgers.push({ name: rawName, amount: amt });
    } else if (inCurrentAssets && subAmt && Math.abs(parseAmt(subAmt)) > 0) {
      const subAmtVal = parseAmt(subAmt);
      // A Current-Assets sub-item whose name *looks* like stock — covers
      // companies that named their stock ledger "Goods", "Finished Goods",
      // "Raw Material", "Inventory Items" etc. and grouped it directly
      // under Current Assets without using a Stock-in-Hand parent.  These
      // would otherwise slip through as "otherCurrentAssets" and the D5
      // check would falsely report no closing stock.
      if (isStockLikeName(name)) {
        if (Math.abs(subAmtVal) > Math.abs(closingStock)) closingStock = Math.abs(subAmtVal);
      } else {
        // Uncategorized sub-item under Current Assets (e.g. Input GST, Advance Tax, Prepaid)
        otherCurrentAssets.push({ name: rawName, amount: Math.abs(subAmtVal) });
      }
    }
  }

  // Classic import-format fallback — every magnitude is abs()'d so
  // downstream consumers see positive values regardless of which sign
  // convention Tally's BS export used.  Treats assets and liabilities
  // symmetrically — the BS equation check (D3) reads from
  // parseBSheetStatement.totals which preserves signs separately, so
  // we don't need to keep raw signs here.
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

  // Last-resort closing-stock catch — Tally's BS XML sometimes lists
  // "Closing Stock" / "Stock-in-Hand" as a sub-item whose <BSAMT> block
  // sits more than the strict tokeniser allows away from the
  // <DSPACCNAME>.  Scan with a more forgiving regex over the whole BS
  // XML before giving up.
  if (closingStock === 0) {
    const found = findAmountByLineName(xml, [
      /\bclosing\s+stock\b/i,
      /\bstock[-\s]?in[-\s]?hand\b/i,
      /\bstock[-\s]?in[-\s]?trade\b/i,
      /^\s*(finished\s+)?goods\b/i,
      /\bmerchandise\b/i,
      /\binventor(?:y|ies)\b/i,
      /\bwork[-\s]?in[-\s]?progress\b/i,
    ]);
    if (found !== 0) closingStock = found;
  }
  // Most permissive fallback — search the raw BS XML for the label
  // and pick the next numeric value (handles Tally Prime exports with
  // non-standard tag wrapping around the stock line).
  if (closingStock === 0) {
    const direct = findAmountNearText(xml, [
      /Closing\s+Stock/i,
      /Stock[-\s]?in[-\s]?Hand/i,
      /Stock[-\s]?in[-\s]?Trade/i,
    ]);
    if (direct !== 0) closingStock = direct;
  }

  const bsCashBankTotal = bankBal + cashBal;
  return { ca, cl, bankBal, debtorBal, creditorBal, closingStock, fixedAssets, bsCashBankTotal, bsNetProfit, otherCurrentAssets, bsSuspenseLedgers };
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
    cashOver10k: 0, cashReceiptOver2L: 0, roundCount: 0, dupVnoMap: {},
    monthCounts: {}, dateSet: [], custMap: {}, vendMap: {},
    totalDebit: 0, totalCredit: 0, salesVoucherTotal: 0,
    purchVoucherTotal: 0, cashBankNetMovement: 0, receiptTotal: 0, paymentTotal: 0, contraTotal: 0,
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
  // Party detection — Tally records the party in three different shapes
  // depending on Tally version, voucher source (manual / import / GST-aware),
  // and how the voucher was entered:
  //   1. <PARTYLEDGERNAME> at voucher level  — the standard, most common
  //   2. <PARTYNAME> at voucher level        — legacy / non-accounting voucher types
  //   3. <ISPARTYLEDGER>Yes</ISPARTYLEDGER>  — inside one ALLLEDGERENTRIES.LIST
  //      entry, with that entry's <LEDGERNAME> being the actual party.
  //      Imported vouchers and some custom voucher classes leave the top-
  //      level field empty but always mark the per-entry flag.
  // Checking only #1 produced false-positive "missing party" flags on
  // perfectly valid trade vouchers where #3 carries the party.
  let party = xmlText(block, 'PARTYLEDGERNAME') || xmlText(block, 'PARTYNAME');
  if (!party) {
    const entryRe = /<ALLLEDGERENTRIES\.LIST\b[^>]*>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi;
    let em: RegExpExecArray | null;
    while ((em = entryRe.exec(block)) !== null) {
      const entry = em[1];
      if (/<ISPARTYLEDGER>\s*Yes\s*<\/ISPARTYLEDGER>/i.test(entry)) {
        const candidate = xmlText(entry, 'LEDGERNAME');
        if (candidate) { party = candidate; break; }
      }
    }
  }
  const dateStr = xmlText(block, 'DATE');
  const amt = extractAmt(block);
  // Signed master amount — used only by the net sales/purchase totals.
  // All other counters and flags keep using the absolute `amt`, which is
  // the right semantic for "did this voucher exceed ₹X / lack narration /
  // get bunched into October" type checks.
  const signedAmt = extractSignedAmt(block);

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

  // Per-voucher flags — kept in lockstep with the counter increments
  // below so the UI can drill from "10 of 198 missing numbers" back to
  // the actual 10 rows without re-running detection client-side.
  const voucherFlags: VoucherFlag[] = [];

  if (!vno) { stats.missingVno++; voucherFlags.push('missingVno'); }
  if (narration) stats.narrated++;

  if (vno) {
    // Key on type+vno: Tally allows the same number across different
    // voucher types (Sales/001 and Receipt/001 are independent series).
    // Keying on vno alone wrongly flagged those legitimate collisions.
    const dupKey = makeDupKey(vtype, vno);
    stats.dupVnoMap[dupKey] = (stats.dupVnoMap[dupKey] || 0) + 1;
  }

  // A party (debtor/creditor/cash/bank) is expected for sales, purchase,
  // receipt, payment, and their returns.  Memorandum / Stock / Order
  // vouchers don't need one.
  if (!party && (isSales || isSalesReturn || isPurchase || isPurchaseReturn || isReceipt || isPayment)) {
    stats.missingParty++;
    voucherFlags.push('missingParty');
  }

  if (amt === 0) { stats.zeroAmt++; voucherFlags.push('zeroAmt'); }

  if (amt > 100_000 && narration) stats.highValueNarrated++;
  if (amt > 100_000) stats.highValueCount++;

  if (isJournal) {
    stats.totalJournals++;
    stats.journalNetAmt += amt;
  }

  // Cash >₹10k threshold (s.40A(3) compliance) — fires on any voucher whose
  // type *name* contains "cash" (Tally's "Cash Payment", "Cash Receipt").
  // Kept on raw substring because it's a heuristic about ledger choice,
  // not voucher semantics.
  if (vtype.includes('cash') && amt > 10_000) { stats.cashOver10k++; voucherFlags.push('cashOver10k'); }

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
    voucherFlags.push('wrongType');
  } else if ((isReceipt || isPayment) && !touchesBankCash && ledgerNames.length > 0) {
    stats.wrongType++;
    voucherFlags.push('wrongType');
  }

  if (amt > 0 && amt % 1000 === 0) stats.roundCount++;

  // Sign-aware revenue/expense aggregation.
  //
  // Goal: net = Tally's Debit-column total − Credit-column total for the
  // voucher type — the bottom-line figure on Tally's columnar Day Book.
  //
  // Algorithm: look at the FIRST <ALLLEDGERENTRIES.LIST> entry — that's
  // the ledger Tally displays in its "Particulars" column for each
  // voucher row.  Read its ISDEEMEDPOSITIVE flag for direction; if the
  // flag is empty, default to Dr (matches Tally's "(-)X" notation case
  // where a negative-Dr entry shows under the Debit column rather than
  // flipping to Credit — Tally's column placement honours the deemed
  // direction, not the raw AMOUNT sign).  Apply Dr → +amt, Cr → −amt.
  //
  // Why first leg, not party leg or master AMOUNT:
  //   • Party-leg direction encodes "the trade party's accounting
  //     impact" (Cr for normal purchase = vendor to be paid), which is
  //     correct accounting but DOES NOT match Tally's daybook column
  //     placement — Tally shows the Purchase A/c leg (Dr) in Particulars
  //     for normal purchases, not the party.  Using party direction
  //     produces a sign-inverted net.
  //   • Master <AMOUNT> tag position varies across exports; xmlText
  //     picks whichever happens to come first, leading to inconsistent
  //     direction across voucher types.
  //   • First <ALLLEDGERENTRIES.LIST> entry is what Tally's display
  //     engine treats as the voucher's primary leg — deterministic
  //     across exports.
  //
  // Empty-flag fallback: default to Dr.  Tally's daybook total math
  // (verified against user's purchase data) sums abs(amount) under the
  // deemed direction's column regardless of AMOUNT sign — so when the
  // flag is missing on a reversal-style entry like "(-)5,000 Dr", we
  // pick Dr direction and contribute +amt, which is what Tally does.
  //
  //   • Return-type vouchers (Sales/Purchase Return) override with an
  //     explicit −amt branch — type-level signal is unambiguous.
  // Direction for Tally's columnar Day Book = the FIRST leg's
  // ISDEEMEDPOSITIVE flag, with a special "reversal Dr" rule for entries
  // displayed as "(-)X" in the Dr column.  Empirically verified against
  // Tally Prime sample data and the user's actual data:
  //
  //   <VOUCHER VCHTYPE="Purchase">
  //     <PARTYLEDGERNAME>AutomateIQ</PARTYLEDGERNAME>
  //     <LEDGERENTRIES.LIST>
  //       <LEDGERNAME>Purchase</LEDGERNAME>
  //       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>   ← flag=Yes ⇒ Dr
  //       <AMOUNT>-100000.00</AMOUNT>                ← Tally invoice mode stores Dr as flag=Yes + negative AMOUNT
  //     </LEDGERENTRIES.LIST>
  //     <LEDGERENTRIES.LIST>
  //       <LEDGERNAME>AutomateIQ</LEDGERNAME>
  //       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>    ← flag=No ⇒ Cr
  //       <AMOUNT>118000.00</AMOUNT>                 ← Cr leg has positive AMOUNT
  //     </LEDGERENTRIES.LIST>
  //   </VOUCHER>
  //
  // Rules (in priority order):
  //   1. flag=Yes  → Dr (standard Tally-invoice Dr leg)
  //   2. flag=No, AMOUNT >= 0 → Cr (standard Cr leg)
  //   3. flag=No, AMOUNT < 0  → Dr (reversal entry — Tally displays as
  //                                  "(-)X" in Dr column.  This is the
  //                                  case for v33-style adjustment
  //                                  vouchers.)
  //   4. flag missing → Dr (default)
  //
  // Three important fixes vs the earlier XNOR rule:
  //   • The container is LEDGERENTRIES.LIST for invoice-mode vouchers
  //     (not ALLLEDGERENTRIES.LIST).  Match BOTH so we don't miss
  //     invoice-mode vouchers entirely (the old regex only matched
  //     ALL-prefixed and skipped Purchase/Sales Invoice vouchers).
  //   • Trust ISDEEMEDPOSITIVE alone for the Yes case.  XNOR with sign
  //     flipped every normal Dr leg into Cr because Tally invoice mode
  //     stores Dr legs with negative AMOUNT (counter-intuitive).
  //   • For flag=No, the AMOUNT sign DOES matter — distinguishes
  //     standard Cr (positive AMOUNT) from a "reversal Dr" (negative
  //     AMOUNT, displayed with "(-)X" notation under the Dr column).
  // Match both container shapes (LEDGERENTRIES.LIST and ALLLEDGERENTRIES.LIST).
  const legContainerRe =
    /<((?:ALL)?LEDGERENTRIES)\.LIST\b[^>]*>([\s\S]*?)<\/\1\.LIST>/i;
  const firstLegMatch = block.match(legContainerRe);
  let firstLegIsDr: boolean | null = null;
  if (firstLegMatch) {
    const entry = firstLegMatch[2];
    const flag = xmlText(entry, 'ISDEEMEDPOSITIVE');
    const entryAmt = parseAmt(xmlText(entry, 'AMOUNT'));
    firstLegIsDr = legDirection(flag, entryAmt);
  } else {
    firstLegIsDr = true;
  }
  const drSign = firstLegIsDr === false ? -1 : +1;

  // Initialize breakdown buckets on first hit (the type marks them
  // optional for backward compat with cached chunkedStats from prior runs).
  if (stats.salesVoucherDr === undefined) {
    stats.salesVoucherDr = 0;
    stats.salesVoucherCr = 0;
    stats.purchVoucherDr = 0;
    stats.purchVoucherCr = 0;
    stats.salesVoucherBreakdown = [];
    stats.purchVoucherBreakdown = [];
  }

  function recordBreakdown(arr: Array<{ vno: string; amt: number; dr: boolean }> | undefined, dr: boolean) {
    if (!arr) return;
    if (arr.length >= 1000) return;  // cap to keep memory bounded
    arr.push({ vno: vno || '', amt, dr });
  }

  if (isSales) {
    stats.salesVoucherTotal += drSign * amt;
    if (firstLegIsDr) stats.salesVoucherDr! += amt;
    else              stats.salesVoucherCr! += amt;
    recordBreakdown(stats.salesVoucherBreakdown, !!firstLegIsDr);
  }
  if (isSalesReturn) {
    stats.salesVoucherTotal -= amt;
    // Return type forces Cr-column accounting (subtracts from net).
    stats.salesVoucherCr! += amt;
    recordBreakdown(stats.salesVoucherBreakdown, false);
  }
  if (isPurchase) {
    stats.purchVoucherTotal += drSign * amt;
    if (firstLegIsDr) stats.purchVoucherDr! += amt;
    else              stats.purchVoucherCr! += amt;
    recordBreakdown(stats.purchVoucherBreakdown, !!firstLegIsDr);
  }
  if (isPurchaseReturn) {
    stats.purchVoucherTotal -= amt;
    stats.purchVoucherCr! += amt;
    recordBreakdown(stats.purchVoucherBreakdown, false);
  }
  if (isJournal)                      stats.taxVoucherTotal   += amt;

  // Cash/Bank movement total — fired by Receipt, Payment, and Contra
  // vouchers (Contra moves between cash and bank), plus the legacy
  // substring fallback for vouchers whose type literally contains
  // "cash"/"bank" (covers user-defined types that haven't been classified
  // yet via the override store).
  if (isReceipt || isPayment || isContra || vtype.includes('cash') || vtype.includes('bank')) {
    stats.cashBankNetMovement += amt;
  }
  // Receipt-only volume — paired with paymentTotal below.  H4 uses
  // (receipts − payments) as the net change in cash/bank from the
  // DayBook to compare against the TB's net period movement.
  if (isReceipt) stats.receiptTotal += amt;
  // Payment-only volume — used as the denominator in E6's TDS-as-%-of-
  // payments check.  Excludes Receipts (money in) and Contras (internal
  // bank↔cash) since neither attracts TDS.
  if (isPayment) stats.paymentTotal += amt;

  // Contra-only volume — every contra touches TWO cash/bank ledgers,
  // so it lands twice in the TB's cash/bank Dr+Cr turnover but only
  // once in cashBankNetMovement above.  H4 adds this back to the DB
  // side to keep both totals comparable.
  if (isContra) stats.contraTotal += amt;

  // Customer / vendor concentration maps — keyed on the voucher's
  // resolved party (PARTYLEDGERNAME, with fallbacks already applied
  // upstream).  Drives BPI1 (top customers / concentration), BPI8
  // (top vendors / concentration), WC3 (top debtors), WC9 (top
  // creditors), BPI3 (new vs repeat customer detection).  Sales-side
  // vouchers contribute to custMap; purchase-side to vendMap.  Returns
  // (credit / debit notes) subtract so a fully-returned customer
  // shows net-zero rather than inflated turnover.
  if (party && amt > 0) {
    if (isSales)            stats.custMap[party] = (stats.custMap[party] ?? 0) + amt;
    else if (isSalesReturn) stats.custMap[party] = (stats.custMap[party] ?? 0) - amt;
    else if (isPurchase)    stats.vendMap[party] = (stats.vendMap[party] ?? 0) + amt;
    else if (isPurchaseReturn) stats.vendMap[party] = (stats.vendMap[party] ?? 0) - amt;
  }

  stats.totalDebit += amt;
  stats.totalCredit += amt;

  if (dateStr) {
    const dt = parseTallyDate(dateStr);
    if (dt) {
      if (dt < fyStart || dt > fyEnd) { stats.outOfFY++; voucherFlags.push('outOfFY'); }
      const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      stats.monthCounts[monthKey] = (stats.monthCounts[monthKey] || 0) + 1;
      dateSet.add(dateStr);
    }
  }

  // Push the actual transaction detail (limit to 50000 to prevent crashing on massive DBs)
  if (!stats.vouchers) stats.vouchers = [];
  if (stats.vouchers.length < 50000) {
    // Per-leg snapshot of ALLLEDGERENTRIES.LIST.  Captures both ledger
    // name (lowercased) and Dr/Cr direction (ISDEEMEDPOSITIVE=Yes → Dr,
    // anything else → Cr).  Powers two engine post-passes:
    //   • missingParty rescue scans names looking for a debtor/creditor leg
    //   • wrong-type classification uses both category and direction to
    //     detect e.g. a Payment voucher with the bank leg actually Dr
    //     (money flowed INTO the bank) — that's structurally a Receipt.
    // Falls back to AMOUNT sign (negative = Cr) when ISDEEMEDPOSITIVE is
    // absent in the entry — older Tally exports sometimes skip the flag.
    const legs: Array<{ name: string; dr: boolean; amt: number }> = [];
    const seenLegs = new Set<string>();
    const entryBlockRe = /<ALLLEDGERENTRIES\.LIST\b[^>]*>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = entryBlockRe.exec(block)) !== null) {
      const entry = lm[1];
      const rawName = xmlText(entry, 'LEDGERNAME');
      if (!rawName) continue;
      const name = rawName.toLowerCase();
      const amtTxt = xmlText(entry, 'AMOUNT');
      const amtN = parseAmt(amtTxt);
      // Shared legDirection helper — handles ISDEEMEDPOSITIVE=No + neg
      // AMOUNT reversal correctly.  Previously this loop used a "flag
      // wins" rule and disagreed with H2/H3 first-leg sign netting on
      // reversal entries, causing H4 cash-leg direction + wrong-type
      // rescan to miscount on those vouchers.
      const flag = xmlText(entry, 'ISDEEMEDPOSITIVE');
      const dr = legDirection(flag, amtN);
      const key = `${name}${dr ? 'd' : 'c'}`;
      if (seenLegs.has(key)) continue;
      seenLegs.add(key);
      legs.push({ name, dr, amt: Math.abs(amtN) });
    }
    stats.vouchers.push({
      date: dateStr || '',
      vno: vno || '',
      type: vtype || '',
      party: party || '',
      amount: amt,
      narration: narration || '',
      ...(voucherFlags.length ? { flags: voucherFlags } : {}),
      ...(legs.length ? { legs } : {}),
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

/** Extract a GST rate (percent) from a Tally master <LEDGER> block.
 *
 *  Tally Prime stores per-ledger GST configuration under several field
 *  names depending on version and how GST was originally configured:
 *
 *    Direct rate fields (most common):
 *      <RATEOFTAX>18.00</RATEOFTAX>
 *      <GSTTAXRATE>18</GSTTAXRATE>
 *
 *    Nested in <GSTDETAILS.LIST>:
 *      <GSTDETAILS.LIST>
 *        <GSTRATE>18</GSTRATE>
 *        ...
 *      </GSTDETAILS.LIST>
 *
 *    Statutory details nested deeper (Tally Prime 3.x+):
 *      <STATUTORYDETAILS.LIST>
 *        <GSTAPPLICABILITY>Applicable</GSTAPPLICABILITY>
 *        <GSTRATE>18</GSTRATE>
 *      </STATUTORYDETAILS.LIST>
 *
 *  Returns the first non-zero rate found across these tag candidates,
 *  or undefined when no rate is present (which is what E2a flags as
 *  missing GST configuration on a sales ledger).
 */
function extractGstRate(ledgerBlock: string): number | undefined {
  const TAG_CANDIDATES = ['RATEOFTAX', 'GSTTAXRATE', 'GSTRATE', 'TAXRATE'];
  for (const tag of TAG_CANDIDATES) {
    const all = xmlAll(ledgerBlock, tag);
    for (const v of all) {
      const n = parseAmt(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

/** Extract GST applicability from a Tally master <LEDGER> block.
 *  Looks for <GSTAPPLICABILITY> with values "Applicable" / "Not Applicable" /
 *  "Use Default" (Tally's canonical strings). */
function extractGstApplicability(ledgerBlock: string): MasterEntry['gstApplicable'] {
  const raw = xmlText(ledgerBlock, 'GSTAPPLICABILITY').toLowerCase().trim();
  if (!raw) return undefined;
  if (raw.includes('not applicable')) return 'not-applicable';
  if (raw.includes('use default'))    return 'use-default';
  if (raw.includes('applicable'))     return 'applicable';
  return undefined;
}

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

  // GST rate / applicability extraction — pull from raw XML with a
  // per-LEDGER regex pass and merge into the entries we already built.
  // The ordered XML structure exposes children as opaque nodes that
  // would need re-serialisation to use the flat tag extractors;
  // running a parallel regex pass over the raw text is simpler and
  // reuses the same helpers that the fallback path below already uses.
  //
  // We do this AFTER the ordered-parse loop because the ordered path
  // is the high-quality source of truth for name+parent+type; the
  // regex pass just enriches existing entries with GST fields.
  const ledgerEnrichRe = /<LEDGER\s+NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/gi;
  let em: RegExpExecArray | null;
  while ((em = ledgerEnrichRe.exec(xml)) !== null) {
    const name = decodeEntities(em[1].trim());
    if (!name || name === 'undefined') continue;
    const key = normalizeMasterKey(name);
    const existing = map.get(key);
    if (!existing || existing.type !== 'ledger') continue;
    const block = em[2];
    const gstRate = extractGstRate(block);
    const gstApplicable = extractGstApplicability(block);
    if (gstRate !== undefined || gstApplicable !== undefined) {
      map.set(key, { ...existing, gstRate, gstApplicable });
    }
  }

  if (map.size > 0) return map;

  // Fallback regex path — runs only when the ordered XML parser didn't
  // produce anything (rare; older Tally exports without standard
  // grouping).  Same GST extraction applied here for consistency.
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
    const block = m[2];
    const parent = xmlText(block, 'PARENT').trim() || 'Primary';
    const gstRate = extractGstRate(block);
    const gstApplicable = extractGstApplicability(block);
    map.set(normalizeMasterKey(name), { name, parent, type: 'ledger', gstRate, gstApplicable });
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
