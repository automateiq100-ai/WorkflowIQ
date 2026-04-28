/**
 * Parser tests — Bugs 1, 2, 3
 *
 * Bug 1: Sign preservation in BS/TB values
 * Bug 2: Revenue deduplication (group-level totals only, GST excluded)
 * Bug 3: Three-stage near-duplicate detection
 */

import { describe, it, expect } from 'vitest';
import {
  parseTrialBalance,
  parsePandL,
  parseBSheet,
  parseAmt,
  isDuplicate,
  isSiblingVariant,
  stemClean,
  similarity,
  parseMasterMap,
  parsePandLStatement,
  parseBSheetStatement,
} from '../parser';

// ── parseAmt ──────────────────────────────────────────────────────────────

describe('parseAmt', () => {
  it('handles positive amounts', () => {
    expect(parseAmt('10000')).toBe(10000);
    expect(parseAmt('10,000')).toBe(10000);
    expect(parseAmt('1,23,456.78')).toBe(123456.78);
  });

  it('handles negative amounts (Tally Cr convention)', () => {
    expect(parseAmt('-50000')).toBe(-50000);
    expect(parseAmt('-1,00,000')).toBe(-100000);
  });

  it('handles empty / garbage strings', () => {
    expect(parseAmt('')).toBe(0);
    expect(parseAmt('abc')).toBe(0);
    expect(parseAmt('  ')).toBe(0);
  });
});

// ── Bug 1: Trial Balance sign preservation ────────────────────────────────

describe('parseTrialBalance — Bug 1 sign preservation', () => {
  it('preserves positive (Dr) closing balances', () => {
    const xml = `
      <DSPACCNAME><DSPDISPNAME>Cash in Hand</DSPDISPNAME></DSPACCNAME>
      <DSPACCINFO><DSPCLAMTA>25000</DSPCLAMTA></DSPACCINFO>
    `;
    const result = parseTrialBalance(xml);
    const cash = result.tbLedgers.find(l => l.name === 'Cash in Hand');
    expect(cash).toBeDefined();
    expect(cash!.closing).toBe(25000);
    expect(cash!.dr).toBe(true);
  });

  it('preserves negative (Cr) closing balances', () => {
    const xml = `
      <DSPACCNAME><DSPDISPNAME>Sundry Creditors</DSPDISPNAME></DSPACCNAME>
      <DSPACCINFO><DSPCLAMTA>-150000</DSPCLAMTA></DSPACCINFO>
    `;
    const result = parseTrialBalance(xml);
    const creditors = result.tbLedgers.find(l => l.name === 'Sundry Creditors');
    expect(creditors).toBeDefined();
    expect(creditors!.closing).toBe(-150000);
    expect(creditors!.dr).toBe(false);
  });

  it('does not Math.abs() any closing balance', () => {
    const xml = `
      <DSPACCNAME><DSPDISPNAME>Capital Account</DSPDISPNAME></DSPACCNAME>
      <DSPACCINFO><DSPCLAMTA>-2098400</DSPCLAMTA></DSPACCINFO>
      <DSPACCNAME><DSPDISPNAME>Sundry Debtors</DSPDISPNAME></DSPACCNAME>
      <DSPACCINFO><DSPCLAMTA>340000</DSPCLAMTA></DSPACCINFO>
    `;
    const result = parseTrialBalance(xml);
    const cap = result.tbLedgers.find(l => l.name === 'Capital Account');
    const debtors = result.tbLedgers.find(l => l.name === 'Sundry Debtors');
    expect(cap!.closing).toBe(-2098400); // negative = Cr
    expect(debtors!.closing).toBe(340000); // positive = Dr
  });
});

// ── Bug 1: Balance Sheet sign preservation ────────────────────────────────

describe('parseBSheet — Bug 1 sign preservation', () => {
  it('preserves signed Current Assets', () => {
    const xml = `
      <DSPDISPNAME>Current Assets</DSPDISPNAME>
      <BSAMT><BSMAINAMT>500000</BSMAINAMT></BSAMT>
    `;
    const result = parseBSheet(xml);
    expect(result.ca).toBe(500000);
  });

  it('preserves negative Current Liabilities', () => {
    const xml = `
      <DSPDISPNAME>Current Liabilities</DSPDISPNAME>
      <BSAMT><BSMAINAMT>-300000</BSMAINAMT></BSAMT>
    `;
    const result = parseBSheet(xml);
    expect(result.cl).toBe(-300000);
  });

  it('preserves negative creditor balances', () => {
    // Use BSMAINAMT which is the primary amount the parser extracts from BSAMT block
    const xml = `
      <DSPDISPNAME>Current Assets</DSPDISPNAME>
      <BSAMT><BSMAINAMT>1000</BSMAINAMT></BSAMT>
      <DSPDISPNAME>Sundry Creditors</DSPDISPNAME>
      <BSAMT><BSMAINAMT>-150000</BSMAINAMT></BSAMT>
    `;
    const result = parseBSheet(xml);
    expect(result.creditorBal).toBe(-150000);
  });

  it('extracts bsNetProfit from Profit & Loss A/c', () => {
    const xml = `
      <DSPDISPNAME>Profit &amp; Loss A/c</DSPDISPNAME>
      <BSAMT><BSMAINAMT>-75000</BSMAINAMT></BSAMT>
    `;
    const result = parseBSheet(xml);
    expect(result.bsNetProfit).toBe(-75000);
  });

  it('returns null bsNetProfit when not present', () => {
    const xml = `
      <DSPDISPNAME>Current Assets</DSPDISPNAME>
      <BSAMT><BSMAINAMT>500000</BSMAINAMT></BSAMT>
    `;
    const result = parseBSheet(xml);
    expect(result.bsNetProfit).toBeNull();
  });
});

// ── Bug 2: Revenue deduplication ──────────────────────────────────────────

describe('parsePandL — Bug 2 revenue deduplication', () => {
  it('sums only group-level BSMAINAMT, not sub-ledgers', () => {
    // Simulated P&L with a Sales Accounts group (BSMAINAMT=2390000)
    // and sub-ledger lines (BSSUBAMT values that should not be re-added)
    const xml = `
      <DSPDISPNAME>Sales Accounts</DSPDISPNAME>
      <PLAMT><BSMAINAMT>2390000</BSMAINAMT></PLAMT>
      <DSPDISPNAME>Sales A</DSPDISPNAME>
      <BSSUBAMT>1200000</BSSUBAMT>
      <DSPDISPNAME>Sales B</DSPDISPNAME>
      <BSSUBAMT>1190000</BSSUBAMT>
    `;
    const result = parsePandL(xml);
    // Revenue should be 2390000 (group total), NOT 2390000 + 1200000 + 1190000
    expect(result.revenue).toBe(2390000);
  });

  it('excludes GST ledgers from revenue even if under Income groups', () => {
    const xml = `
      <DSPDISPNAME>Sales Accounts</DSPDISPNAME>
      <PLAMT><BSMAINAMT>2390000</BSMAINAMT></PLAMT>
      <DSPDISPNAME>Output CGST</DSPDISPNAME>
      <PLAMT><BSMAINAMT>100000</BSMAINAMT></PLAMT>
      <DSPDISPNAME>Output SGST</DSPDISPNAME>
      <PLAMT><BSMAINAMT>100000</BSMAINAMT></PLAMT>
    `;
    const result = parsePandL(xml);
    // GST should be excluded
    expect(result.revenue).toBe(2390000);
  });

  it('includes Indirect Incomes in revenue', () => {
    const xml = `
      <DSPDISPNAME>Sales Accounts</DSPDISPNAME>
      <PLAMT><BSMAINAMT>2390000</BSMAINAMT></PLAMT>
      <DSPDISPNAME>Indirect Incomes</DSPDISPNAME>
      <PLAMT><BSMAINAMT>224</BSMAINAMT></PLAMT>
    `;
    const result = parsePandL(xml);
    expect(result.revenue).toBe(2390224);
  });
});

// ── Strict Tally statement hierarchy parsing ──────────────────────────────

describe('strict Tally XML parsing', () => {
  const masterXml = `
    <ENVELOPE>
      <GROUP NAME="Sales Accounts"><PARENT>Primary</PARENT></GROUP>
      <GROUP NAME="Current Assets"><PARENT></PARENT></GROUP>
      <GROUP NAME="Zero Group"><PARENT>Primary</PARENT></GROUP>
      <LEDGER NAME="Sales Account"><PARENT>Sales Accounts</PARENT></LEDGER>
      <LEDGER NAME="Cash"><PARENT>Current Assets</PARENT></LEDGER>
      <LEDGER NAME="Zero Ledger"><PARENT>Zero Group</PARENT></LEDGER>
    </ENVELOPE>
  `;

  it('builds master map entries with parent and origin type', () => {
    const master = parseMasterMap(masterXml);

    expect(master.get('sales accounts')).toEqual({
      name: 'Sales Accounts',
      parent: 'Primary',
      type: 'group',
    });
    expect(master.get('current assets')).toEqual({
      name: 'Current Assets',
      parent: 'Primary',
      type: 'group',
    });
    expect(master.get('sales account')).toEqual({
      name: 'Sales Account',
      parent: 'Sales Accounts',
      type: 'ledger',
    });
  });

  it('uses BSMAINAMT as a main node and BSSUBAMT as its child', () => {
    const master = parseMasterMap(masterXml);
    const stmt = parseBSheetStatement(`
      <ENVELOPE>
        <BSNAME><DSPACCNAME><DSPDISPNAME>Current Assets</DSPDISPNAME></DSPACCNAME></BSNAME>
        <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT>5000</BSMAINAMT></BSAMT>
        <BSNAME><DSPACCNAME><DSPDISPNAME>Cash</DSPDISPNAME></DSPACCNAME></BSNAME>
        <BSAMT><BSSUBAMT>5000</BSSUBAMT><BSMAINAMT></BSMAINAMT></BSAMT>
      </ENVELOPE>
    `, master);

    expect(stmt.nodes).toHaveLength(1);
    expect(stmt.nodes[0].name).toBe('Current Assets');
    expect(stmt.nodes[0].nodeType).toBe('main');
    expect(stmt.nodes[0].children[0].name).toBe('Cash');
    expect(stmt.nodes[0].children[0].nodeType).toBe('sub');
  });

  it('uses PLSUBAMT as a child of the most recent main account', () => {
    const master = parseMasterMap(masterXml);
    const stmt = parsePandLStatement(`
      <ENVELOPE>
        <DSPACCNAME><DSPDISPNAME>Sales Accounts</DSPDISPNAME></DSPACCNAME>
        <PLAMT><PLSUBAMT></PLSUBAMT><BSMAINAMT>1000</BSMAINAMT></PLAMT>
        <DSPACCNAME><DSPDISPNAME>Sales Account</DSPDISPNAME></DSPACCNAME>
        <PLAMT><PLSUBAMT>1000</PLSUBAMT><BSMAINAMT></BSMAINAMT></PLAMT>
      </ENVELOPE>
    `, master);

    expect(stmt.nodes[0].name).toBe('Sales Accounts');
    expect(stmt.nodes[0].children).toHaveLength(1);
    expect(stmt.nodes[0].children[0].name).toBe('Sales Account');
    expect(stmt.nodes[0].children[0].nodeType).toBe('sub');
  });

  it('uses master map as zero-balance tie-breaker', () => {
    const master = parseMasterMap(masterXml);
    const stmt = parseBSheetStatement(`
      <ENVELOPE>
        <BSNAME><DSPACCNAME><DSPDISPNAME>Zero Group</DSPDISPNAME></DSPACCNAME></BSNAME>
        <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT></BSMAINAMT></BSAMT>
        <BSNAME><DSPACCNAME><DSPDISPNAME>Zero Ledger</DSPDISPNAME></DSPACCNAME></BSNAME>
        <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT></BSMAINAMT></BSAMT>
      </ENVELOPE>
    `, master);

    expect(stmt.nodes[0].nodeType).toBe('main');
    expect(stmt.nodes[0].children[0].nodeType).toBe('sub');
  });

  it('defaults missing zero-balance master entries to main and labels them computed', () => {
    const stmt = parseBSheetStatement(`
      <ENVELOPE>
        <BSNAME><DSPACCNAME><DSPDISPNAME>Unknown Structural Line</DSPDISPNAME></DSPACCNAME></BSNAME>
        <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT></BSMAINAMT></BSAMT>
      </ENVELOPE>
    `, new Map());

    expect(stmt.nodes[0].nodeType).toBe('main');
    expect(stmt.nodes[0].inMaster).toBe(false);
    expect(stmt.nodes[0].masterParent).toBe('Computed / Not in Master');
  });

  it('classifies computed P&L reporting lines only by amount tags', () => {
    const master = parseMasterMap(masterXml);
    const stmt = parsePandLStatement(`
      <ENVELOPE>
        <DSPACCNAME><DSPDISPNAME>Cost of Sales :</DSPDISPNAME></DSPACCNAME>
        <PLAMT><PLSUBAMT></PLSUBAMT><BSMAINAMT>-630000</BSMAINAMT></PLAMT>
        <DSPACCNAME><DSPDISPNAME>Opening Stock</DSPDISPNAME></DSPACCNAME>
        <PLAMT><PLSUBAMT>-10000</PLSUBAMT><BSMAINAMT></BSMAINAMT></PLAMT>
        <DSPACCNAME><DSPDISPNAME>Less: Closing Stock</DSPDISPNAME></DSPACCNAME>
        <PLAMT><PLSUBAMT>-31111</PLSUBAMT><BSMAINAMT></BSMAINAMT></PLAMT>
      </ENVELOPE>
    `, master);

    expect(stmt.nodes[0].name).toBe('Cost of Sales :');
    expect(stmt.nodes[0].nodeType).toBe('main');
    expect(stmt.nodes[0].masterParent).toBe('Computed / Not in Master');
    expect(stmt.nodes[0].children.map(n => [n.name, n.nodeType])).toEqual([
      ['Opening Stock', 'sub'],
      ['Less: Closing Stock', 'sub'],
    ]);
  });
});

// ── Bug 3: Near-duplicate detection ───────────────────────────────────────

describe('isDuplicate — Bug 3 three-stage detection', () => {
  // Stage 1: cleaned-identical
  it('detects cleaned-identical names (different spacing/punctuation)', () => {
    expect(isDuplicate('sundry creditors', 'sundry  creditors')).toBe(true);
    expect(isDuplicate('cash-in-hand', 'cash in hand')).toBe(true);
  });

  it('detects stem-identical names via Levenshtein', () => {
    // 'sales accounts' and 'sale account' — cleaned: 'salesaccounts' vs 'saleaccount'
    // stemmed: 'salaccount' vs 'salaccount' → same after stemming, so detected
    // But the stem function strips 'es' on 'sales' (len 5 = boundary), let's use actual behavior:
    // stemClean('sales accounts') = 'salaccount'  (sales→sal, accounts→account)
    // stemClean('sale account')   = 'salaccount'  (sale→sal, account→account) — wait, 'sale' ends with 'e' not 'es'
    // Actually: stem('sale') = 'sale' (length 4, 'es' needs length > 4), stem('account') = 'account'
    // stemClean('sale account') = 'saleaccount'
    // stemClean('sales accounts') = 'salaccount' — these differ!
    // So they're caught by Levenshtein: cleaned 'salesaccounts' vs 'saleaccount' = 13 vs 11 chars
    // similarity = 1 - 2/13 ≈ 0.846 — below 0.92 threshold
    // These won't match. Let's use a case that actually matches:
    expect(isDuplicate('sundry creditors', 'sundry creditor')).toBe(true);
  });

  // Stage 2: sibling exception — should NOT be flagged as duplicates
  it('allows sibling variants (trailing A/B/C)', () => {
    expect(isDuplicate('sales accounts a', 'sales accounts b')).toBe(false);
    expect(isDuplicate('hdfc bank', 'hdfc bank a')).toBe(false);
  });

  it('allows GST rate siblings', () => {
    expect(isDuplicate('output cgst', 'output sgst')).toBe(false);
  });

  it('allows percentage-suffixed siblings', () => {
    expect(isDuplicate('output cgst 9%', 'output cgst 18%')).toBe(false);
  });

  // Stage 3: Levenshtein ≥ 0.92
  it('detects high-similarity names (Levenshtein ≥ 0.92)', () => {
    // "hdfc bank current" vs "hdfc bank currant" — 1 char diff in 17-char string = 0.94 sim
    expect(isDuplicate('hdfc bank current', 'hdfc bank currant')).toBe(true);
  });

  it('does not flag clearly different names', () => {
    expect(isDuplicate('cash in hand', 'bank account')).toBe(false);
    expect(isDuplicate('sales', 'purchase')).toBe(false);
  });

  it('does not flag identical names as "near-duplicates"', () => {
    expect(isDuplicate('cash in hand', 'cash in hand')).toBe(false);
  });
});

describe('isSiblingVariant', () => {
  it('detects trailing token variants', () => {
    expect(isSiblingVariant('sales accounts a', 'sales accounts b')).toBe(true);
    expect(isSiblingVariant('hdfc bank', 'hdfc bank a')).toBe(true);
  });

  it('detects GST component siblings', () => {
    expect(isSiblingVariant('output cgst', 'output sgst')).toBe(true);
    expect(isSiblingVariant('input igst', 'input cgst')).toBe(true);
  });

  it('does not flag genuinely different names', () => {
    expect(isSiblingVariant('cash in hand', 'bank account')).toBe(false);
  });
});

describe('stemClean', () => {
  it('stems trailing s/es/ing', () => {
    // stem('sales') = 'sal' (ends with 'es', length 5 > 4)
    // stem('accounts') = 'account' (ends with 's', length 8 > 3)
    expect(stemClean('Sales Accounts')).toBe('salaccount');
    // stem('running') = 'runn' (ends with 'ing', length 7 > 5)
    // stem('expenses') = 'expens' (ends with 'es', length 8 > 4)
    expect(stemClean('Running Expenses')).toBe('runnexpens');
  });
});

describe('similarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(similarity('hello', 'hello')).toBe(1);
  });

  it('returns < 1 for similar strings', () => {
    const sim = similarity('hdfcbankcurrent', 'hdfcbankcurrant');
    expect(sim).toBeGreaterThanOrEqual(0.92);
  });

  it('returns low similarity for very different strings', () => {
    const sim = similarity('cashinhand', 'bankaccount');
    expect(sim).toBeLessThan(0.5);
  });
});
