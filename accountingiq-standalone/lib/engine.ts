'use client';

import type {
  AppState, Check, CheckStatus, DimKey, AnalysisResults, ParsedData, ChunkedStats, CompanyProfile,
  FinancialNode, Voucher,
} from './types';
import { DIM_WEIGHTS, CASH_LIMIT, CASH_RECEIPT_LIMIT } from './constants';
import {
  parseTrialBalance, parseTBFull,
  parsePandL, parseBSheet, parseGrpSum, parseDayBook, parseTallyDate,
  parseCashFlow, parseLedgerGroups, parseMasterMap, parsePandLStatement, parseBSheetStatement, flattenStatement,
  normalizeMasterKey, isDuplicate, stemClean,
} from './parser';
import { buildBSHierarchyMap, classifyLedger } from './tally-groups';
import { classifyVoucherType } from './tally-voucher-types';
import { recordClassificationSummary } from './telemetry';
import { buildH4Context, computeDBCashBankFlow, computeTBCashBankNet } from './h4-flow';
import { computeGSTVariance } from './gst-variance';

// ── Balance-Sheet metric derivation from the hierarchical statement ─────────
// The dashboard / ratios used to read ca, cl, debtorBal, creditorBal from the
// regex `parseBSheet`, which pulls each group TOTAL from that group's own
// header amount.  Many real Tally BS exports leave the header blank and show
// the total only via child rows — so Current Assets came back ~0 and the
// current ratio collapsed to a nonsensical 0.01.  These helpers re-derive the
// magnitudes from the SAME hierarchical statement the Data view renders
// (parseBSheetStatement), which sums children, so the dashboard matches
// Data → Balance Sheet by construction.

/** A BS group's true magnitude: its own signed amount when the header carries
 *  one, otherwise the sum of its descendants (blank header → total is in the
 *  child rows).  Never double-counts: a header with its own amount wins. */
function bsGroupMagnitude(node: FinancialNode): number {
  if (Math.abs(node.amount) > 0) return Math.abs(node.amount);
  return node.children.reduce((s, c) => s + bsGroupMagnitude(c), 0);
}

/** Largest-magnitude node whose name matches `re`, searched anywhere in the
 *  hierarchy (debtors/creditors nest under Current Assets/Liabilities).
 *  Returns 0 when not found, so callers can fall back to the regex value. */
function bsMagByName(nodes: FinancialNode[], re: RegExp): number {
  let best = 0;
  const walk = (ns: FinancialNode[]) => {
    for (const n of ns) {
      if (re.test(n.name)) best = Math.max(best, bsGroupMagnitude(n));
      walk(n.children);
    }
  };
  walk(nodes);
  return best;
}

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
  const hasMaster   = files.master.hasContent;

  // Parse each XML — masterMap first so parseTrialBalance can filter GROUP rollup rows.
  const masterMap = hasMaster && files.master.content ? parseMasterMap(files.master.content) : new Map();

  // Per-company classification overrides — user-confirmed entries here always
  // win over auto-classification (see lib/ledger-overrides.ts).  Threaded
  // through TB parsing so capFound / bankFound / tbSales etc. all honour
  // user-supplied ground truth.
  const overrides = state.ledgerOverrides;

  // Phase 6: Parse the BS hierarchy BEFORE the Trial Balance, so the
  // BS-section map can be threaded into TB classification.  This gives us
  // a MEDIUM-confidence fallback for companies that uploaded Tally exports
  // without a master file — most leaves still get a primary group via the
  // BS's own section structure.
  const bsheetStatement = hasBS ? parseBSheetStatement(files.bsheet.content!, masterMap) : null;
  const bsHierarchy = bsheetStatement ? buildBSHierarchyMap(bsheetStatement) : new Map<string, string>();

  const tbResult  = hasTB  ? parseTrialBalance(files.trialbal.content!, masterMap, overrides, bsHierarchy) : null;
  // Full TB (groups + ledgers) for the hierarchical Data View display
  const tbRows    = hasTB  ? parseTBFull(files.trialbal.content!, masterMap, overrides, bsHierarchy) : [];
  const plResult  = hasPL  ? parsePandL(files.pandl.content!)           : null;
  const bsResult  = hasBS  ? parseBSheet(files.bsheet.content!)         : null;
  const pandlStatement = hasPL ? parsePandLStatement(files.pandl.content!, masterMap) : null;

  // Build ledger→parent map from DayBook (All Masters format) for group checks
  const ledgerGroups = files.daybook.content ? parseLedgerGroups(files.daybook.content) : new Map<string, string>();
  const grpResult = hasGrp ? parseGrpSum(files.grpsum.content!, ledgerGroups) : null;

  const hasCF      = files.cashflow.hasContent;
  const cfResult   = hasCF ? parseCashFlow(files.cashflow.content!)     : null;

  // DayBook stats — parse with default FY first to get monthCounts.
  //
  // Prefer fresh parseDayBook over cached chunkedStats so any parser/engine
  // change (sign-aware purchase netting, voucher-flag updates, etc.) is
  // picked up on the next "Run Analysis" without forcing the user to
  // re-upload the daybook.  We only fall back to the cached stats when
  // `content` is unavailable — that's the >10 MB chunked-upload path,
  // where the raw XML is intentionally discarded after streaming to keep
  // memory bounded.  Small files (<10 MB) always have `content` retained.
  let dbStats: ChunkedStats | null = null;
  if (hasDaybook) {
    if (files.daybook.content) {
      dbStats = parseDayBook(files.daybook.content, fyStart, fyEnd);
    } else if (files.daybook.chunkedStats) {
      dbStats = files.daybook.chunkedStats;
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

    // Re-stamp the per-voucher `outOfFY` flag against the detected FY
    // bounds.  parseDayBook initially stamped these against the SYSTEM
    // CLOCK's FY (whatever currentFY() returned), which is wrong for
    // any historic-period data.  Without this re-stamp, C4's count and
    // drill-down disagree: count says "0 vouchers outside FY" but the
    // drill-down lists every voucher (because they were flagged against
    // the current FY at parse time).
    if (dbStats.vouchers) {
      for (const v of dbStats.vouchers) {
        const dt = v.date ? parseTallyDate(v.date) : null;
        const isOutOfFY = dt !== null && (dt < fyStart || dt > fyEnd);
        const had = v.flags?.includes('outOfFY') ?? false;
        if (isOutOfFY && !had) {
          v.flags = v.flags ? [...v.flags, 'outOfFY'] : ['outOfFY'];
        } else if (!isOutOfFY && had) {
          v.flags = v.flags!.filter(f => f !== 'outOfFY');
        }
      }
    }
  }

  // Missing-party rescue pass — Tally Prime in double-entry mode often
  // leaves both <PARTYLEDGERNAME> and <ISPARTYLEDGER> empty even when the
  // party clearly appears as one leg of ALLLEDGERENTRIES.LIST (e.g. a
  // Payment voucher with "Sales Account" + "ABC Traders" entries — the
  // user sees the party in Tally, but the XML never names it as such).
  // The parser captures every voucher's ledger entries on Voucher.ledgers
  // so we can classify them here using the same master + overrides that
  // drive TB classification.  Anything that resolves to a Sundry Debtor
  // or Sundry Creditor becomes the party; the missingParty flag and
  // counter are cleared in lockstep so downstream checks (C3) and the
  // drill-down (flag-missing-party) both see the corrected state.
  if (dbStats?.vouchers?.length && masterMap.size > 0) {
    let rescued = 0;
    for (const v of dbStats.vouchers) {
      if (v.party || !v.flags?.includes('missingParty') || !v.legs?.length) continue;
      for (const leg of v.legs) {
        const cls = classifyLedger(leg.name, masterMap, overrides, bsHierarchy);
        if (cls.category === 'debtor' || cls.category === 'creditor') {
          // Use the master's original-case name where available so the
          // drill-down shows "ABC Traders" not "abc traders".
          const m = masterMap.get(normalizeMasterKey(leg.name));
          v.party = m?.name ?? leg.name;
          v.flags = v.flags.filter(f => f !== 'missingParty');
          if (v.flags.length === 0) delete v.flags;
          rescued++;
          break;
        }
      }
    }
    if (rescued > 0) dbStats.missingParty = Math.max(0, dbStats.missingParty - rescued);
  }

  // Wrong-type rescan — master-aware replacement for the parse-time
  // substring approximation.  The parser flags wrongType based on
  // whether ledger names contain "cash"/"bank" substrings; that misses
  // structurally-wrong vouchers like a Payment with Sales + Debtor
  // (clearly a Sales voucher mis-typed) and over-counts customers
  // literally named "Cashew Traders".  Here we classify each ledger via
  // the master and apply richer rules:
  //   • Journal touching cash/bank        → wrong; suggest receipt/payment/contra
  //   • Receipt/Payment without cash/bank → wrong; suggest sales/purchase/journal
  //   • Sales / Sales Return without any sales ledger
  //   • Purchase / Purchase Return without any purchase ledger
  //   • Contra touching anything other than cash/bank
  // The suggestedType is shown in the wrong-type drill-down so the user
  // knows what to reclassify each voucher to.
  if (dbStats?.vouchers?.length && masterMap.size > 0) {
    // Clear the parse-time wrongType flag on every voucher first — the
    // rescan re-adds it based on master-aware rules.  Skipping this
    // would leave false-positive substring matches stuck.
    for (const v of dbStats.vouchers) {
      if (v.flags?.includes('wrongType')) {
        v.flags = v.flags.filter(f => f !== 'wrongType');
        if (v.flags.length === 0) delete v.flags;
      }
      delete v.suggestedType;
    }

    // Natural Dr/Cr direction of the non-cash legs lets us pick between
    // Receipt and Payment even when neither a debtor nor a creditor is
    // present.  E.g. "Dr Swiggy Expense / Cr Axis Bank" has no creditor
    // but the expense is Dr-natural — money clearly went OUT, so the
    // voucher should be a Payment (not a Journal).
    const CASH_BANK_CATS = new Set(['cash', 'bank', 'bank-od']);
    const INFLOW_CATS = new Set([
      'debtor', 'sales', 'direct-income', 'indirect-income', 'capital',
    ]);
    const OUTFLOW_CATS = new Set([
      'creditor', 'purchase', 'direct-expense', 'indirect-expense',
      'fixed-asset', 'investment', 'deposit', 'loan-given',
      'duties-output', 'duties-input',
    ]);
    // Categories that legitimately appear in a Contra (only cash-like).
    // Anything else means it isn't really a contra.
    function inferDirection(otherCats: string[]): 'in' | 'out' | 'either' {
      let inCount = 0, outCount = 0;
      for (const c of otherCats) {
        if (INFLOW_CATS.has(c)) inCount++;
        if (OUTFLOW_CATS.has(c)) outCount++;
      }
      if (inCount > 0 && outCount === 0) return 'in';
      if (outCount > 0 && inCount === 0) return 'out';
      return 'either';
    }

    let newWrongType = 0;
    for (const v of dbStats.vouchers) {
      if (!v.legs?.length || !v.type) continue;
      const semantic = classifyVoucherType(v.type).semantic;
      const legCats = v.legs.map(l => ({
        ...l,
        category: classifyLedger(l.name, masterMap, overrides, bsHierarchy).category,
      }));
      const cats = legCats.map(l => l.category);
      const has = (c: typeof cats[number]) => cats.includes(c);
      const hasCashOrBank = cats.some(c => CASH_BANK_CATS.has(c));
      const hasSales     = has('sales');
      const hasPurchase  = has('purchase');
      const nonCashCats  = cats.filter(c => !CASH_BANK_CATS.has(c));
      const direction    = inferDirection(nonCashCats);

      // Direction the cash/bank leg actually moves money in this voucher:
      //   Dr cash/bank = money came IN  (the bank is gaining)
      //   Cr cash/bank = money went OUT (the bank is losing)
      // Used to catch Payment-with-bank-Dr (really a Receipt) and the
      // mirror case Receipt-with-bank-Cr (really a Payment) — these slip
      // past every category-only rule because they HAVE a cash/bank leg.
      const cashLeg = legCats.find(l => CASH_BANK_CATS.has(l.category));
      const bankDir: 'in' | 'out' | undefined = cashLeg
        ? (cashLeg.dr ? 'in' : 'out')
        : undefined;

      let isWrong = false;
      let suggested = '';

      if (semantic === 'payment' && bankDir === 'in') {
        // Payment voucher but the bank is Dr → money flowed IN.  This is
        // really a Receipt regardless of what other ledgers are present.
        isWrong = true;
        suggested = 'Receipt';
      } else if (semantic === 'receipt' && bankDir === 'out') {
        // Mirror of the above — Receipt with bank Cr → money flowed OUT.
        isWrong = true;
        suggested = 'Payment';
      } else if (semantic === 'journal' && hasCashOrBank) {
        // Journal touching cash/bank — almost always should be Receipt,
        // Payment, or Contra.  Direction tells us which.
        isWrong = true;
        if (nonCashCats.length === 0) suggested = 'Contra';
        else if (direction === 'in')  suggested = 'Receipt';
        else if (direction === 'out') suggested = 'Payment';
        else suggested = 'Receipt or Payment';
      } else if ((semantic === 'receipt' || semantic === 'payment') && !hasCashOrBank) {
        // No cash/bank — it isn't really a Receipt or Payment.
        isWrong = true;
        if (hasSales)         suggested = 'Sales';
        else if (hasPurchase) suggested = 'Purchase';
        else                  suggested = 'Journal';
      } else if ((semantic === 'sales' || semantic === 'sales-return') && !hasSales) {
        // Sales voucher with no sales ledger isn't really a sale.
        isWrong = true;
        if (hasPurchase)              suggested = semantic === 'sales' ? 'Purchase' : 'Purchase Return';
        else if (hasCashOrBank && direction === 'in')  suggested = 'Receipt';
        else if (hasCashOrBank && direction === 'out') suggested = 'Payment';
        else if (hasCashOrBank)       suggested = 'Receipt';   // Sales-typed → user expected money in
        else                          suggested = 'Journal';
      } else if ((semantic === 'purchase' || semantic === 'purchase-return') && !hasPurchase) {
        // Purchase voucher with no purchase ledger isn't really a purchase.
        // This covers the Swiggy case: "Dr Swiggy Expense / Cr Axis Bank"
        // — typed Purchase, but really a Payment for an expense.
        isWrong = true;
        if (hasSales)                 suggested = semantic === 'purchase' ? 'Sales' : 'Sales Return';
        else if (hasCashOrBank && direction === 'out') suggested = 'Payment';
        else if (hasCashOrBank && direction === 'in')  suggested = 'Receipt';
        else if (hasCashOrBank)       suggested = 'Payment';   // Purchase-typed → user expected money out
        else                          suggested = 'Journal';
      } else if (semantic === 'contra') {
        // Contra is internal cash/bank movement only.  Any non-cash/bank
        // leg means it's not really a contra.  inferDirection handles the
        // P&L / party / tax categories properly.
        if (nonCashCats.length > 0 && direction !== 'either') {
          isWrong = true;
          suggested = direction === 'in' ? 'Receipt' : 'Payment';
        } else if (nonCashCats.length > 0) {
          isWrong = true;
          if (hasSales)         suggested = 'Sales';
          else if (hasPurchase) suggested = 'Purchase';
          else                  suggested = 'Journal';
        }
      }

      if (isWrong) {
        if (!v.flags) v.flags = [];
        v.flags.push('wrongType');
        if (suggested) v.suggestedType = suggested;
        newWrongType++;
      }
    }
    dbStats.wrongType = newWrongType;
  }

  // Master-aware cash-compliance rescan — separates the two distinct cash
  // limits the parse-time substring heuristic conflated:
  //   • Section 40A(3): cash EXPENDITURE (cash paid OUT) over ₹10,000 to one
  //     person in one day is disallowed as a deduction.
  //   • Section 269ST: cash RECEIPTS (cash taken IN) of ₹2,00,000 or more from
  //     one person in one day is barred (penalty 100% u/s 271DA).
  // We classify each leg via the master; a cash-category leg that is CREDITED
  // (dr === false) is cash going OUT (a payment), a DEBITED cash leg is cash
  // coming IN (a receipt).  We then aggregate per (person, day) — 40A(3) and
  // 269ST are both daily-per-person limits — so split payments/receipts that
  // dodge the per-voucher threshold are still caught.
  if (dbStats?.vouchers?.length && masterMap.size > 0) {
    for (const v of dbStats.vouchers) {
      if (v.flags?.length) {
        v.flags = v.flags.filter(f => f !== 'cashOver10k' && f !== 'cashReceiptOver2L');
        if (v.flags.length === 0) delete v.flags;
      }
    }
    const isCash = (name: string) =>
      classifyLedger(name, masterMap, overrides, bsHierarchy).category === 'cash';
    // Net cash legs on a voucher: amount paid out (Cr cash) and taken in (Dr cash).
    const cashFlow = (v: Voucher): { out: number; in: number } => {
      let out = 0, inn = 0;
      for (const leg of v.legs ?? []) {
        if (!isCash(leg.name)) continue;
        const amt = Math.abs(leg.amt);
        if (leg.dr) inn += amt; else out += amt;
      }
      return { out, in: inn };
    };
    // "Person" key for daily aggregation: the counterparty.  Prefer the
    // voucher party; fall back to the joined non-cash ledger names so split
    // payments to the same payee on the same day still aggregate.
    const personKey = (v: Voucher): string => {
      const p = (v.party ?? '').trim().toLowerCase();
      if (p) return p;
      const others = (v.legs ?? [])
        .filter(leg => !isCash(leg.name))
        .map(leg => leg.name.toLowerCase().trim())
        .sort();
      return others.join('|') || '(unknown)';
    };

    // Aggregate per (date, person) for a given direction, then flag every
    // contributing voucher when the day's total breaches `limit`.
    const flagOverLimit = (
      dir: 'out' | 'in',
      limit: number,
      atOrAbove: boolean,
      flag: 'cashOver10k' | 'cashReceiptOver2L',
    ): number => {
      const groups = new Map<string, Voucher[]>();
      const totals = new Map<string, number>();
      for (const v of dbStats.vouchers) {
        const amt = cashFlow(v)[dir];
        if (amt <= 0) continue;
        const key = `${v.date}::${personKey(v)}`;
        let arr = groups.get(key);
        if (!arr) { arr = []; groups.set(key, arr); }
        arr.push(v);
        totals.set(key, (totals.get(key) ?? 0) + amt);
      }
      let count = 0;
      for (const [key, total] of totals) {
        if (atOrAbove ? total < limit : total <= limit) continue;
        for (const v of groups.get(key)!) {
          (v.flags ??= []).push(flag);
          count++;
        }
      }
      return count;
    };

    dbStats.cashOver10k       = flagOverLimit('out', CASH_LIMIT,         false, 'cashOver10k');
    dbStats.cashReceiptOver2L = flagOverLimit('in',  CASH_RECEIPT_LIMIT, true,  'cashReceiptOver2L');
  }

  // Assemble parsedData
  const parsedData: Partial<ParsedData> = {
    ...(tbResult  ?? {}),
    ...(plResult  ?? {}),
    ...(bsResult  ?? {}),
    ...(grpResult ?? {}),
    ...(cfResult  ?? {}),
    masterEntries: Array.from(masterMap.values()),
    tbRows,
    ...(pandlStatement ? { pandlStatement, pandlRows: flattenStatement(pandlStatement) } : {}),
    ...(bsheetStatement ? { bsheetStatement, bsheetRows: flattenStatement(bsheetStatement) } : {}),
  };

  // Preserve the raw P&L-derived net profit BEFORE the overwrite below —
  // D2 (and any UI surfacing both figures) needs the two raw numbers to
  // compare.  Prefer the hierarchy-walking totals from parsePandLStatement
  // (same number the Data view shows) over the regex-based extraction in
  // parsePandL — the former walks the full P&L XML structure, while the
  // latter falls back to `revenue − totalExpenses` which can miss lines
  // (other income, statutory adjustments) and undercount net profit.
  parsedData.plNetProfit = pandlStatement?.totals.net
    ?? plResult?.netProfit
    ?? null;

  // Net profit for the PERIOD = P&L income − expenses (what Tally shows as
  // "Nett Profit/Loss" for the period).  Use the hierarchy-walked P&L total
  // (same figure the Data view shows) when available.
  //
  // We deliberately do NOT use the Balance Sheet "Profit & Loss A/c" figure
  // (bsNetProfit) as the headline net profit.  That BS line is the ACCUMULATED
  // carried-forward balance — prior years' retained earnings + the current
  // period — so for any established or multi-year company, or any sub-FY pull,
  // it is NOT the period result (e.g. ₹14.07 Cr accumulated on the BS vs a
  // ₹0.57 Cr loss for the month).  Surfacing it as "Net Profit" on the
  // dashboard / MIS contradicted the P&L totals.  bsNetProfit is still kept
  // separately (parsedData.bsNetProfit + plNetProfit) for the D2 /
  // cross-statement reconciliation check.
  if (parsedData.plNetProfit != null) {
    parsedData.netProfit = parsedData.plNetProfit;
  }

  // ── Single source of truth for Balance-Sheet metrics ─────────────────────
  // Re-derive ca / cl / debtorBal / creditorBal from the hierarchical BS
  // statement (the SAME structure Data → Balance Sheet renders) so the
  // dashboard, current ratio and downstream checks match what the user sees in
  // the Data section.  The regex parseBSheet reads group totals off blank
  // headers and produced ~0 Current Assets (→ 0.01 current ratio).  Only
  // override when the statement actually yields the group, else keep the regex
  // value as a fallback.
  if (bsheetStatement?.nodes?.length) {
    const caS   = bsMagByName(bsheetStatement.nodes, /current\s*assets?/i);
    const clS   = bsMagByName(bsheetStatement.nodes, /current\s*liabilit/i);
    const debS  = bsMagByName(bsheetStatement.nodes, /sundry\s*debtors?|trade\s*receivable|account\s*receivable/i);
    const credS = bsMagByName(bsheetStatement.nodes, /sundry\s*creditors?|trade\s*payable|account\s*payable/i);
    if (caS   > 0) parsedData.ca          = caS;
    if (clS   > 0) parsedData.cl          = clS;
    if (debS  > 0) parsedData.debtorBal   = debS;
    if (credS > 0) parsedData.creditorBal = credS;
  }

  // Closing-stock fallback — when the BS parser missed it (custom-named
  // stock ledger that doesn't match its narrow regex), substitute the
  // TB-derived sum of every Stock-classified ledger.  closingStock from
  // BS retains its sign; tbStock is already |abs|, so we coerce both to
  // the same magnitude before comparing.
  const tbStockTotal = (tbResult?.tbStock ?? 0);
  if ((parsedData.closingStock == null || Math.abs(parsedData.closingStock) === 0) && tbStockTotal > 0) {
    parsedData.closingStock = tbStockTotal;
  }

  const {
    tbLedgers = [], dupPairs = 0,
    capFound = false, bankFound: bankFoundTB = false, cashFound: cashFoundTB = false,
    debtorFound: debtorFoundTB = false, creditorFound: creditorFoundTB = false, hasOpeningBal = false,
    tbTotal = 0, tbSales = 0, tbPurch = 0,
    outputGSTAmt = 0, inputITCAmt = 0, tdsLedgerFound = false, tdsPayableAmt = 0, pfLedgerFound = false,
    gstDiffPct = 0,
    revenue = 0, netProfit = 0, bsNetProfit = null, depFound = false, depAmt = 0, openingStock = 0, plClosingStock = 0,
    closingStock = 0, costOfMaterials = 0, fixedAssets = 0, bsCashBankTotal = 0, tbCashBankMovement = 0, tbCashBankNetMovement = 0,
    bankBal = 0, debtorBal = 0, creditorBal = 0,
    salesWrongGroup = false, purchaseWrongGroup = false, dutiesUnderExpense = false,
    suspenseLedgers: tbSuspenseLedgers = [], dupPairDetails = [],
    bsSuspenseLedgers = [],
  } = parsedData as Partial<ParsedData>;

  // Merge the TB-side and BS-side suspense lists.  Each side catches
  // what the other misses: parseTrialBalance skips GROUP-type rows
  // (so "Suspense A/c" group rollups fall through), while parseBSheet
  // only sees top-level rows and a few sub-items, missing leaf-level
  // suspense ledgers buried under other groups.  Dedupe by lowercased
  // name so the same ledger seen by both sources counts once.
  const seenSusp = new Set<string>();
  const suspenseLedgers: Array<{ name: string; amount: number }> = [];
  for (const s of [...tbSuspenseLedgers, ...bsSuspenseLedgers]) {
    if (s.amount === 0) continue;
    const key = s.name.toLowerCase().trim();
    if (seenSusp.has(key)) continue;
    seenSusp.add(key);
    suspenseLedgers.push(s);
  }
  const suspenseCount = suspenseLedgers.length;
  // Mirror the merged list into parsedData so flags.ts, remediation.ts
  // and PushToTallyButton — which still read parsedData.* — see the
  // same combined view the engine checks operate on.
  parsedData.suspenseLedgers = suspenseLedgers;
  parsedData.suspenseCount = suspenseCount;

  // Existence flags for trade / banking ledgers — the TB-only signal
  // misses companies whose Trial Balance was exported with bank/cash/
  // debtor/creditor rolled up to their parent GROUP (Tally's default
  // collapsed view).  parseTrialBalance skips GROUP-type rows so those
  // never reach classifyLedger and the *FoundTB flags stay false.  Fall
  // back to BS-derived balances: a non-zero closing balance on the BS
  // is conclusive proof the ledger exists, regardless of whether the
  // TB happened to list it as a leaf.  Also peek at the master file
  // for ledgers explicitly classified into the relevant primary group.
  const masterHasCategory = (cat: 'bank' | 'cash' | 'debtor' | 'creditor'): boolean => {
    if (masterMap.size === 0) return false;
    for (const entry of masterMap.values()) {
      if (entry.type !== 'ledger') continue;
      const cls = classifyLedger(entry.name, masterMap, overrides, bsHierarchy);
      if (cls.category === cat) return true;
      if (cat === 'bank' && cls.category === 'bank-od') return true;
    }
    return false;
  };
  const bankFound     = bankFoundTB     || bankBal     !== 0 || masterHasCategory('bank');
  const cashFound     = cashFoundTB     || bsCashBankTotal - bankBal !== 0 || masterHasCategory('cash');
  const debtorFound   = debtorFoundTB   || debtorBal   !== 0 || masterHasCategory('debtor');
  const creditorFound = creditorFoundTB || creditorBal !== 0 || masterHasCategory('creditor');

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
  const cashReceiptOver2L = dbStats?.cashReceiptOver2L ?? 0;
  const roundCount      = dbStats?.roundCount        ?? 0;
  const dupVnoMap       = dbStats?.dupVnoMap         ?? {};
  const monthCounts     = dbStats?.monthCounts       ?? {};
  const outOfFY         = dbStats?.outOfFY           ?? 0;
  const dbSales         = dbStats?.salesVoucherTotal ?? 0;
  const dbPurch         = dbStats?.purchVoucherTotal ?? 0;
  const dbCashBank      = dbStats?.cashBankNetMovement ?? 0;
  const dbContraTotal   = dbStats?.contraTotal          ?? 0;
  const dbReceipts      = dbStats?.receiptTotal         ?? 0;
  const dbPayments      = dbStats?.paymentTotal         ?? 0;
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
  // Show the first 8 pairs inline (was 3 — too aggressive a truncation).
  // The full list is available via the B2 flag drill-down.
  const dupNote = dupPairs === 0
    ? 'No duplicates detected'
    : `${dupPairs} near-duplicate ledger pair${dupPairs > 1 ? 's' : ''}: ${dupPairDetails.slice(0, 8).map(([a,b]) => `"${a}" ↔ "${b}"`).join(', ')}${dupPairs > 8 ? '…' : ''}`;
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

  // C2 — keying on `${type}${vno}` so cross-series collisions don't
  // inflate the count.  We report TWO metrics together so the user
  // doesn't have to flip between them: distinct duplicated numbers and
  // total occurrences (sum of group sizes for groups whose size > 1).
  const dupOccurrences = Object.values(dupVnoMap)
    .filter(c => c > 1)
    .reduce((s, v) => s + v, 0);
  c('C2', 'C', 'No duplicate voucher numbers',
    !hasDaybook ? uncertain(6, 'Requires DayBook')
    : dupVouchers === 0 ? pass(6, 6, 'No duplicate voucher numbers')
    : fail(6, `${dupVouchers} duplicate voucher number${dupVouchers > 1 ? 's' : ''} found (${dupOccurrences} total occurrences)`),
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

  // Wrong-type postings: Journal vouchers touching cash/bank, or
  // Receipt/Payment vouchers with no cash/bank ledger.  Counted in
  // processVoucher (parser.ts) by scanning each voucher's ledger entries.
  c('C5', 'C', 'No wrong-type postings',
    !hasDaybook ? uncertain(6, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(6, 'No vouchers parsed')
    : wrongType === 0 ? pass(6, 6, 'No wrong-type postings detected')
    : wrongType <= 2
      ? partial(3, 6, `${wrongType} potential wrong-type voucher${wrongType === 1 ? '' : 's'} — review Journal/Receipt/Payment classifications`)
      : fail(6, `${wrongType} wrong-type postings — Journal vouchers touching cash/bank, or Receipts/Payments missing cash/bank counterpart`),
    'Wrong-type voucher postings detected');

  c('C6', 'C', 'Zero-amount vouchers below 2%',
    !hasDaybook ? uncertain(3, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(3, 'No vouchers parsed')
    : zeroPct > 0.99 ? uncertain(3, 'Almost all vouchers are zero-amount — possible parsing issue')
    : zeroPct < 0.02 ? pass(3, 3, `${(zeroPct*100).toFixed(1)}% zero-amount vouchers`)
    : fail(3, `${(zeroPct*100).toFixed(1)}% zero-amount vouchers (threshold: 2%)`),
    'Excessive zero-amount vouchers');

  // C7 — every voucher's PARTYLEDGERNAME must exist in the ledger master.
  //
  // Was a stub that just passed when both files were uploaded.  Now we
  // build a Set of every known ledger (master entries + TB rows) and
  // count vouchers whose PARTY is set but isn't in that set.  A mismatch
  // indicates a deleted ledger, a typo, or a corrupted reference.
  //
  // Vouchers without a party (Journals, Contras) are ignored — they
  // legitimately have no party.
  c('C7', 'C', 'No voucher references absent from ledger',
    !(hasDaybook && hasTB) ? uncertain(4, 'Requires both DayBook and Trial Balance')
    : (() => {
        const known = new Set<string>();
        for (const m of (parsedData.masterEntries ?? [])) known.add(m.name.toLowerCase().trim());
        for (const l of tbLedgers) known.add(l.name.toLowerCase().trim());
        if (known.size === 0) return uncertain(4, 'No ledger names parsed from TB or master');

        const vouchers = dbStats?.vouchers ?? [];
        let orphans = 0;
        const orphanSamples: string[] = [];
        for (const v of vouchers) {
          if (!v.party) continue;  // Journals / Contras commonly have none
          if (!known.has(v.party.toLowerCase().trim())) {
            orphans++;
            if (orphanSamples.length < 3) orphanSamples.push(v.party);
          }
        }
        if (vouchers.length === 0) return uncertain(4, 'No vouchers parsed');
        if (orphans === 0) return pass(4, 4, `All voucher parties exist in ledger master (${vouchers.length} vouchers checked)`);
        const pct = (orphans / vouchers.length) * 100;
        const sample = orphanSamples.length > 0 ? ` (e.g. ${orphanSamples.map(s => `"${s}"`).join(', ')})` : '';
        if (pct < 1) return partial(3, 4, `${orphans} voucher${orphans === 1 ? '' : 's'} reference parties absent from ledger master${sample}`);
        return fail(4, `${orphans} vouchers (${pct.toFixed(1)}%) reference parties absent from ledger master${sample}`);
      })(),
    'Vouchers reference parties absent from ledger master');

  // ────── D: Arithmetical Accuracy ──────
  const tbDr = hasTB ? tbLedgers.filter(l => l.dr).reduce((s,l) => s+l.closing, 0) : 0;
  const tbCr = hasTB ? tbLedgers.filter(l => !l.dr).reduce((s,l) => s+Math.abs(l.closing), 0) : 0;
  // D1 ("Trial Balance balances Dr = Cr") was removed: Tally won't let an
  // unbalanced voucher save, so this check is structurally always-pass and
  // adds no signal — the equivalent Difference tile was also removed from
  // the Data view earlier for the same reason.

  // D1 — Trial Balance tallies as a function of PERIOD ACTIVITY:
  //   (closing_Cr − opening_Cr) − (closing_Dr − opening_Dr) ≈ 0
  // i.e. Dr postings during the period = Cr postings during the period,
  // which is the real double-entry invariant.  This catches a misposting
  // even when both the opening and closing TBs happen to be off-balance
  // by the same amount (closing-only check would mask it).
  //
  // Fallback: when the TB export doesn't include opening balances, run
  // the closing-only check — it still surfaces an unbalanced end-state.
  let tbClosingDr = 0, tbClosingCr = 0;
  let tbOpeningDr = 0, tbOpeningCr = 0;
  let tbOpeningSeen = false;
  for (const l of tbLedgers) {
    if (l.closing > 0)      tbClosingDr += l.closing;
    else if (l.closing < 0) tbClosingCr += Math.abs(l.closing);
    if (l.opening !== undefined) {
      tbOpeningSeen = true;
      if (l.opening > 0)      tbOpeningDr += l.opening;
      else if (l.opening < 0) tbOpeningCr += Math.abs(l.opening);
    }
  }
  const tbDrMovement = tbClosingDr - tbOpeningDr;
  const tbCrMovement = tbClosingCr - tbOpeningCr;
  const tbMovDiff    = tbCrMovement - tbDrMovement;       // user's formula
  const tbClosingDiff = tbClosingDr - tbClosingCr;        // closing-only fallback
  const tbSignFlip = parsedData.tbSignFlip;
  c('D1', 'D', 'Trial Balance: Dr movement = Cr movement',
    !hasTB ? missing(8, 'Requires Trial Balance')
    : tbTotal === 0 ? uncertain(8, 'TB has no balances')
    : tbSignFlip === 0 ? uncertain(8, 'Sign convention could not be determined from this TB (too few classifiable ledgers) — Dr / Cr totals may be inverted. Upload All Masters (Ledger.xml) or BS to enable a confident check.')
    : tbOpeningSeen
        ? Math.abs(tbMovDiff) < 100
            ? pass(8, 8, `Period balances: Dr movement ₹${fmt(tbDrMovement)} = Cr movement ₹${fmt(tbCrMovement)}`)
            : fail(8, `Period postings off by ₹${fmt(tbMovDiff)}: Cr movement ₹${fmt(tbCrMovement)} (= ₹${fmt(tbClosingCr)} − ₹${fmt(tbOpeningCr)}) vs Dr movement ₹${fmt(tbDrMovement)} (= ₹${fmt(tbClosingDr)} − ₹${fmt(tbOpeningDr)})`)
        // No opening data — fall back to a closing-only tally check.
        : Math.abs(tbClosingDiff) < 100
            ? pass(8, 8, `TB tallies: Dr ₹${fmt(tbClosingDr)} = Cr ₹${fmt(tbClosingCr)} (opening data not present — period-movement check skipped)`)
            : fail(8, `TB does NOT tally: Dr ₹${fmt(tbClosingDr)} vs Cr ₹${fmt(tbClosingCr)} — out of balance by ₹${fmt(tbClosingDiff)} (opening data not present, period-movement check skipped)`),
    'Trial Balance period postings out of balance');

  // D2 — P&L net profit must match the BS "Profit & Loss A/c" line.
  // Prefer the hierarchy-walking pandlStatement totals (same number the
  // Data view shows) over the regex-based plResult.netProfit, which can
  // undercount (its fallback is `revenue − totalExpenses` and may miss
  // other-income / statutory-adjustment rows).  Tolerance ₹100 — both
  // figures come from the same XML and ought to match exactly, but
  // Tally's BS rounds large totals to the nearest rupee while the P&L
  // hierarchy carries paise, so a sub-₹100 gap is the rounding floor.
  const plNetRaw  = pandlStatement?.totals.net ?? plResult?.netProfit;
  const bsNetRaw  = bsResult?.bsNetProfit;
  // The BS "Profit & Loss A/c" line is the ACCUMULATED balance:
  //   Profit & Loss A/c = Opening Balance (prior years) + Current Period.
  // The P&L statement's net profit is just THIS period, so it must reconcile
  // with the "Current Period" sub-line, NOT the accumulated total.  When Tally
  // explodes the BS (we send EXPLODEFLAG=Yes) it emits that sub-line, so pull
  // it from the hierarchical statement.  Only fall back to the accumulated
  // total for first-year books that carry no opening P&L (total = period).
  const bsCurrentPL = bsheetStatement?.nodes?.length
    ? bsMagByName(bsheetStatement.nodes, /current\s*period/i)
    : 0;
  const usingCurrentPeriod = bsCurrentPL > 0;
  const bsReconcile = usingCurrentPeriod ? bsCurrentPL : bsNetRaw;
  // Compare magnitudes — the P&L statement and the BS use opposite display
  // sign conventions for a loss, so a signed compare produced false mismatches.
  const reconDiff = (plNetRaw != null && bsReconcile != null)
    ? Math.abs(plNetRaw) - Math.abs(bsReconcile) : null;
  c('D2', 'D', 'P&L net profit = BS current-period Profit & Loss',
    !hasPL || !hasBS ? missing(8, 'Requires P&L and Balance Sheet')
    : bsReconcile == null ? uncertain(8, 'BS "Profit & Loss A/c" line not detected — cannot compare')
    : plNetRaw == null ? uncertain(8, 'P&L net profit not extracted — cannot compare')
    : !usingCurrentPeriod && bsNetRaw != null && reconDiff != null && Math.abs(reconDiff) >= 100
        // BS gives only the accumulated balance (no exploded current-period
        // line) and it differs from the period P&L — EXPECTED for a company
        // with prior-year retained earnings.  Tally's BS export simply doesn't
        // carry the current-period P&L line, so this cross-check can't be run
        // here for a multi-year company.  Mark Not Applicable (not "needs
        // data" — the user can't supply what Tally doesn't export) so it
        // doesn't nag or count against the score.
        ? na(`Not applicable: Tally's BS export shows only the accumulated "Profit & Loss A/c" balance (₹${fmt(bsNetRaw)} = prior years + this period), not the current-period line, so it can't be reconciled against the period P&L (₹${fmt(plNetRaw)}). The period figure is taken from the P&L statement and used throughout.`)
    : reconDiff != null && Math.abs(reconDiff) < 100
        ? pass(8, 8, `Period net ${plNetRaw < 0 ? 'loss' : 'profit'} ₹${fmt(Math.abs(plNetRaw))} reconciles with BS ${usingCurrentPeriod ? 'Current Period' : 'Profit & Loss A/c'}`)
        : fail(8, `Period net profit mismatch: P&L ₹${fmt(plNetRaw)} vs BS ${usingCurrentPeriod ? 'Current Period' : 'P&L A/c'} ₹${fmt(bsReconcile)} (diff ₹${fmt(reconDiff ?? 0)})`),
    'P&L net profit does not match Balance Sheet');

  // D3 — Balance Sheet equation: Assets = Liabilities + Equity.  Reads
  // off parseBSheetStatement totals (Cr-positive convention: positive
  // amounts in the hierarchy = liab+equity side, negative = asset side).
  //
  // IMPORTANT: Tally's BS XML export OMITS the on-screen "Difference in
  // opening balances" balancing line.  So a company whose opening balances
  // don't fully tie (very common after splitting company data across financial
  // years — e.g. "NARNKAR & CO - (from 1-Apr-20) - (from 1-Apr-21) …") shows a
  // residual gap here equal to exactly that line: Assets exceed Liab+Equity by
  // the un-exported difference.  Tally itself displays the BS balanced, so this
  // is NOT a broken equation — it's an opening-balance reconciliation item.
  // We treat a small relative residual as that (partial, with guidance, no
  // critical flag) and reserve an outright failure for a LARGE gap, which
  // points at a genuinely unposted entry or a parser gap.
  const bsTotals = bsheetStatement?.totals;
  const bsAssets = bsTotals?.debit  ?? 0;   // Dr side = total assets
  const bsLiabEq = bsTotals?.credit ?? 0;   // Cr side = liab + equity
  const bsBalDiff = bsAssets - bsLiabEq;
  const bsSideMax = Math.max(Math.abs(bsAssets), Math.abs(bsLiabEq));
  const bsRelDiff = bsSideMax > 0 ? Math.abs(bsBalDiff) / bsSideMax : 0;
  c('D3', 'D', 'Balance Sheet balances (Assets = Liab + Cap)',
    !hasBS ? missing(8, 'Balance Sheet not uploaded')
    : !bsTotals || (bsAssets === 0 && bsLiabEq === 0)
        ? uncertain(8, 'BS structure not parsed — cannot verify equation')
    : Math.abs(bsBalDiff) < 100
        ? pass(8, 8, `BS balances: Assets ₹${fmt(bsAssets)} = Liab + Equity ₹${fmt(bsLiabEq)}`)
    : bsRelDiff < 0.02
        // Minor residual = Tally's "Difference in opening balances" (not exported in the XML).
        ? partial(6, 8, `BS balances in Tally; opening balances carry a "Difference in opening balances" of ₹${fmt(bsBalDiff)} (${(bsRelDiff * 100).toFixed(2)}% of assets) that Tally auto-balances on screen but does not export to XML. Review opening-balance entries — common after splitting company data across financial years.`)
        : fail(8, `BS does NOT balance: Assets ₹${fmt(bsAssets)} vs Liab + Equity ₹${fmt(bsLiabEq)} — out of balance by ₹${fmt(bsBalDiff)} (${(bsRelDiff * 100).toFixed(1)}% of assets). Likely an unposted entry or a missing group.`),
    'Balance Sheet equation broken — Assets ≠ Liabilities + Equity');

  // D4 (TB Dr total ≈ BS total assets) was removed — TB and BS represent
  // the same underlying ledgers but at different aggregation levels (TB
  // is per-ledger, BS rolls up under groups with Tally's display-side
  // sign convention), so a strict total-vs-total comparison routinely
  // showed noisy 20–40% variances that didn't reflect real audit issues.
  // The D3 BS-equation check already verifies internal balance; if a
  // ledger is missing from one side or the other, D1 catches it.

  // D5 — closing stock should appear on BOTH P&L (as a deduction inside
  // Cost of Sales) and BS (as a current-asset balance), and the two
  // amounts should match.  A common error: the user enters "Less:
  // Closing Stock" on the P&L as a year-end adjustment but never creates
  // a corresponding ledger under Stock-in-Hand on the BS — books then
  // overstate profit by the stock value.  We now distinguish those
  // failure modes in the message so the user knows where to look.
  //
  // Tally encodes Dr balances as NEGATIVE on the BS XML (Closing Stock,
  // being an asset, comes through as e.g. -26,111), so we compare on
  // absolute values — the sign carries no business meaning here.
  const bsStock = Math.abs(closingStock);
  const plStock = Math.abs(plClosingStock);
  c('D5', 'D', 'Closing stock: P&L = BS figure',
    !isGoods ? na('Not applicable (goods not selected in profile)')
    : bsStock > 0 && plStock > 0 && Math.abs(bsStock - plStock) / Math.max(bsStock, plStock) < 0.02
        ? pass(5, 5, `Closing stock ₹${fmt(bsStock)} reconciles between P&L and BS`)
    : bsStock > 0 && plStock > 0
        ? fail(5, `Closing stock mismatch: P&L ₹${fmt(plStock)} vs BS ₹${fmt(bsStock)} — adjust whichever is wrong so both balance`)
    : bsStock > 0 && plStock === 0
        ? partial(3, 5, `Closing stock on BS (₹${fmt(bsStock)}) but no "Less: Closing Stock" entry on P&L — Cost of Sales likely overstated`)
    : plStock > 0 && bsStock === 0
        ? fail(5, `P&L shows "Less: Closing Stock" ₹${fmt(plStock)} but no matching stock balance on BS — create a Stock-in-Hand ledger or correct the P&L entry`)
    : fail(5, 'No closing stock found in either P&L or Balance Sheet'),
    'Closing stock mismatch between P&L and Balance Sheet');

  // ────── E: Statutory Accuracy ──────
  c('E1', 'E', 'Output GST ledger exists',
    !gstApplicable ? na('Not applicable (GST not selected)')
    : !hasTB ? uncertain(5, 'Requires Trial Balance')
    : outputGSTAmt > 0 ? pass(5, 5, `Output GST: ₹${fmt(outputGSTAmt)}`)
    : fail(5, 'No output GST ledger found'),
    'No Output GST ledger found');

  // E2a — verify every sales ledger has a GST rate configured in Tally
  // master.  Now that parseMasterMap extracts per-ledger gstRate +
  // gstApplicability from RATEOFTAX / GSTRATE / STATUTORYDETAILS, we
  // can actually run this check end-to-end:
  //
  //   1. Identify sales ledgers (cls.category === 'sales') from the TB.
  //   2. For each, look up the matching master entry by name.
  //   3. Pass = every sales ledger has gstRate > 0 OR is explicitly
  //      "Not Applicable" (zero-rated supply / exempt sales — both
  //      legitimate states).
  //   4. Fail = one or more sales ledgers have neither.
  //
  // Previously this was a 4-point stub-pass that auto-passed whenever
  // GST applied and a TB existed — no actual verification.
  const salesLedgerNames: string[] = [];
  const salesLedgersWithoutGst: string[] = [];
  if (gstApplicable && hasTB) {
    for (const l of tbLedgers) {
      const cls = classifyLedger(l.name, masterMap, overrides, bsHierarchy);
      if (cls.category !== 'sales') continue;
      salesLedgerNames.push(l.name);
      const master = masterMap.get(normalizeMasterKey(l.name));
      const hasRate = master?.gstRate !== undefined && master.gstRate > 0;
      const exempt  = master?.gstApplicable === 'not-applicable';
      if (!hasRate && !exempt) salesLedgersWithoutGst.push(l.name);
    }
  }
  // Persist for the E2a drill-down (which sales ledgers are missing a rate).
  parsedData.salesLedgersWithoutGst = salesLedgersWithoutGst;
  c('E2a', 'E', 'All sales ledgers have GST rate specified',
    !gstApplicable ? na('Not applicable')
    : !hasTB ? uncertain(4, 'Requires Trial Balance')
    : masterMap.size === 0 ? uncertain(4, 'Upload All Masters (Ledger.xml) to verify per-ledger GST rate configuration')
    : salesLedgerNames.length === 0 ? uncertain(4, 'No sales ledgers detected — cannot verify GST rates')
    : salesLedgersWithoutGst.length === 0
        ? pass(4, 4, `${salesLedgerNames.length} sales ledger${salesLedgerNames.length === 1 ? '' : 's'} — all have GST rate configured`)
    : salesLedgersWithoutGst.length <= 2
        ? partial(2, 4, `${salesLedgersWithoutGst.length} sales ledger${salesLedgersWithoutGst.length === 1 ? '' : 's'} missing GST rate: ${salesLedgersWithoutGst.slice(0, 3).join(', ')}`)
    : fail(4, `${salesLedgersWithoutGst.length} of ${salesLedgerNames.length} sales ledgers missing GST rate — configure rate in Tally master to enable correct GST computation`),
    'Sales ledgers missing GST rate configuration');

  // E2b — compare Output GST in the books against what's expected if every
  // sale was taxed at the nearest GST slab (5 / 12 / 18 / 28).  Sales are
  // taken from P&L revenue (GST-exclusive taxable value) when available,
  // else from the TB sales aggregate.  See lib/gst-variance.ts for the
  // assumption + snap-to-slab logic.
  // ── Period output GST — the correct basis for E2b ────────────────────────
  // The GST CHARGED on sales this period comes from the sales / sales-return
  // voucher tax legs: a Cr to a GST ledger inside a sales voucher is output
  // GST charged; a Dr inside a credit note (sales return) reverses it.  THIS
  // is what should equal sales × rate.  The TB "GST payable" CLOSING balance
  // (outputGSTAmt) is instead the accumulated net liability carried forward
  // across periods — wrong for a period comparison (it gave a 76% effective
  // "rate" for a multi-year company).  Fall back to it only when the daybook
  // has no sales-voucher tax legs to read.
  // One pass over the daybook computes BOTH period output GST (sales side) and
  // period input GST / ITC (purchase side) from the tax legs:
  //   • Sales / sales-return  → output GST: Cr charges, Dr (credit note) reverses.
  //   • Purchase / purch-return → input ITC: Dr claims,  Cr (debit note) reverses.
  //
  // Identifying a GST TAX leg matters: a bare /gst/ name match wrongly catches
  // the SALES ledger itself (e.g. "GST Sales", "Sales IGST 18%") or a party
  // named with "GST" — counting the taxable value as tax.  So a leg counts only
  // when (a) its name is a GST acronym (cgst/sgst/igst/utgst/gst — excludes
  // TDS/PF) AND (b) the master classifies it as a duties/tax ledger (which
  // tags "GST Sales" as sales, not tax).  Falls back to a name-only guard when
  // no master is loaded.
  const GST_NAME_RE = /\b(?:c|s|i|ut)?gst\b/i;
  const isGstLeg = (name: string): boolean => {
    if (!GST_NAME_RE.test(name)) return false;
    const cat = classifyLedger(name, masterMap, overrides, bsHierarchy).category;
    if (cat === 'duties-output' || cat === 'duties-input') return true;
    if (cat === 'unknown') return !/sale|purchas|income|revenue|expense|debtor|creditor|party/i.test(name);
    return false; // classified as sales / debtor / income / etc. → not a tax leg
  };
  let periodOutputGST = 0, periodInputGST = 0;
  let sawSalesGstLeg = false, sawPurchGstLeg = false;
  for (const v of dbStats?.vouchers ?? []) {
    const sem = classifyVoucherType(v.type).semantic;
    const isSale  = sem === 'sales'    || sem === 'sales-return';
    const isPurch = sem === 'purchase' || sem === 'purchase-return';
    if (!isSale && !isPurch) continue;
    for (const leg of v.legs ?? []) {
      if (!isGstLeg(leg.name)) continue;
      if (isSale) {
        sawSalesGstLeg = true;
        periodOutputGST += leg.dr ? -leg.amt : leg.amt;  // Cr (sale) charges, Dr (return) reverses
      } else {
        sawPurchGstLeg = true;
        periodInputGST += leg.dr ? leg.amt : -leg.amt;   // Dr (purchase) claims, Cr (return) reverses
      }
    }
  }
  const gstSource: 'vouchers' | 'tb-closing' = sawSalesGstLeg ? 'vouchers' : 'tb-closing';
  const recordedGST = sawSalesGstLeg ? periodOutputGST : outputGSTAmt;
  const inputGstSource: 'vouchers' | 'tb-closing' = sawPurchGstLeg ? 'vouchers' : 'tb-closing';
  const recordedInputGST = sawPurchGstLeg ? periodInputGST : inputITCAmt;
  const gstVariance = computeGSTVariance(revenue || tbSales, recordedGST);
  const gstVarPct = gstVariance.variance;
  // Persist the working for the E2b "View working" drill-down (GSTBreakdown).
  parsedData.gstWorking = {
    sales: gstVariance.sales,
    effectiveRate: gstVariance.effectiveRate,
    headlineRate: gstVariance.headlineRate,
    expectedGST: gstVariance.expectedGST,
    recordedGST,
    variance: gstVariance.variance,
    source: gstSource,
  };
  // Guard the FALLBACK (accumulated TB balance) only: an effective rate above
  // the 28% ceiling means that balance isn't this period's output GST, so we
  // can't reconcile.  With the period-voucher basis the rate is real, so the
  // normal pass/partial/fail verdict applies.
  const gstRateImpossible = gstSource === 'tb-closing' && gstVariance.effectiveRate > 0.30;
  const gstSrcNote = gstSource === 'vouchers' ? ' (from sales vouchers)' : ' (TB closing balance)';
  c('E2b', 'E', 'Output GST amount matches computed amount',
    !gstRegular ? na('Not applicable (non-regular taxpayer)')
    : !hasTB ? uncertain(4, 'Requires Trial Balance')
    : gstVariance.sales <= 0 ? uncertain(4, 'Sales not detected — cannot compute expected GST')
    : gstRateImpossible
        ? na(`Can't reconcile: recorded output GST ₹${fmt(recordedGST)} implies a ${(gstVariance.effectiveRate*100).toFixed(0)}% effective rate — above the 28% GST ceiling. The daybook had no sales-voucher tax legs, so this is the ACCUMULATED closing balance of the GST-payable ledgers (carried forward across periods), not the GST charged on sales this period. Pull the Day Book with sales-voucher tax legs to verify against expected ₹${fmt(gstVariance.expectedGST)}.`)
    : gstVarPct < 0.05 ? pass(4, 4, `GST variance: ${(gstVarPct*100).toFixed(1)}% — output GST ₹${fmt(recordedGST)}${gstSrcNote} ≈ expected ₹${fmt(gstVariance.expectedGST)} at ${(gstVariance.headlineRate*100).toFixed(0)}%`)
    : gstVarPct < 0.15 ? partial(2, 4, `GST variance: ${(gstVarPct*100).toFixed(1)}% (>5%, expected ₹${fmt(gstVariance.expectedGST)} at ${(gstVariance.headlineRate*100).toFixed(0)}%, recorded ₹${fmt(recordedGST)}${gstSrcNote})`)
    : fail(4, `GST variance: ${(gstVarPct*100).toFixed(1)}% — exceeds 15% threshold (expected ₹${fmt(gstVariance.expectedGST)} at ${(gstVariance.headlineRate*100).toFixed(0)}%, recorded ₹${fmt(recordedGST)}${gstSrcNote})`),
    'Output GST amount does not match computed total');

  c('E3', 'E', 'Input ITC ledgers exist',
    !gstApplicable ? na('Not applicable')
    : !hasTB ? uncertain(3, 'Requires Trial Balance')
    : inputITCAmt > 0 ? pass(3, 3, `Input ITC: ₹${fmt(inputITCAmt)}`)
    : fail(3, 'No Input ITC/CGST/SGST/IGST ledger found'),
    'No Input ITC ledger found');

  // E4 — Input ITC vs Output GST.  Uses the PERIOD figures (input ITC claimed
  // on purchase-voucher tax legs vs output GST charged on sales-voucher tax
  // legs) when the daybook has them, else the accumulated TB closing balances.
  // ITC exceeding output GST in a period is only a SOFT signal: it's routinely
  // legitimate (capital purchases, inventory build-up, exports / inverted-duty
  // structures put a business in a net-credit position), so a breach is a
  // partial "review" rather than an outright failure.
  const inputSrcNote = inputGstSource === 'vouchers' ? ' (from purchase vouchers)' : ' (TB closing balance)';
  const outSrcNote   = gstSource      === 'vouchers' ? ' (from sales vouchers)'    : ' (TB closing balance)';
  c('E4', 'E', 'Input ITC does not exceed Output GST',
    !gstApplicable ? na('Not applicable')
    : !hasTB ? uncertain(3, 'Requires Trial Balance')
    : recordedGST === 0 ? uncertain(3, 'Output GST not found — cannot compare')
    : recordedInputGST <= recordedGST
        ? pass(3, 3, `Input ITC ₹${fmt(recordedInputGST)}${inputSrcNote} ≤ Output GST ₹${fmt(recordedGST)}${outSrcNote}`)
    : partial(1, 3, `Input ITC ₹${fmt(recordedInputGST)}${inputSrcNote} exceeds Output GST ₹${fmt(recordedGST)}${outSrcNote} — review. Often legitimate (capital purchases, inventory build-up, exports / inverted-duty) but verify no ITC is claimed on ineligible or fake purchases.`),
    'Input ITC exceeds Output GST');

  c('E5', 'E', 'TDS Payable ledger exists',
    !tdsApplicable ? na('Not applicable')
    : !hasTB ? uncertain(5, 'Requires Trial Balance')
    : tdsLedgerFound ? pass(5, 5, 'TDS Payable ledger found')
    : fail(5, 'No TDS Payable ledger found'),
    'No TDS Payable ledger found');

  // E6 — TDS amount reasonable vs payments.  Was a stub waiting on a
  // never-shipped "TDS XML" file slot; now computed from already-parsed
  // sources:
  //   - Numerator: tdsPayableAmt = sum of |closing| over all TDS-related
  //     ledgers in the Trial Balance (TDS Payable / TDS on X / Tax
  //     Deducted at Source).
  //   - Denominator: dbPayments = sum of |amount| over Payment-semantic
  //     vouchers in the DayBook (Phase 4 voucher-type taxonomy).
  //
  // Indian TDS rates run 0.1% (sec 194Q) to 30% (sec 195) depending on
  // section, with most company books landing in the 1-10% range
  // weighted-average across sections.  Loose pass band 0.5%-15%.
  c('E6', 'E', 'TDS amount reasonable vs payments',
    !tdsApplicable ? na('Not applicable')
    : !hasTB ? uncertain(4, 'Requires Trial Balance')
    : !hasDaybook ? uncertain(4, 'Requires DayBook to compute payment volume')
    : tdsPayableAmt === 0
        ? fail(4, 'TDS applicable but no TDS Payable balance — no deduction recorded?')
    : dbPayments === 0
        ? uncertain(4, 'No Payment-type vouchers parsed — cannot compute ratio')
    : (() => {
        const ratio = tdsPayableAmt / dbPayments;
        const pct = (ratio * 100).toFixed(2);
        if (ratio < 0.005) {
          return partial(2, 4, `TDS ${pct}% of payments — below typical 1-10% range; under-deduction risk`);
        }
        if (ratio > 0.15) {
          return partial(2, 4, `TDS ${pct}% of payments — unusually high; check for misclassified ledgers in TDS group`);
        }
        return pass(4, 4, `TDS ₹${fmt(tdsPayableAmt)} = ${pct}% of payments ₹${fmt(dbPayments)} — within reasonable range`);
      })(),
    'TDS deduction percentage outside reasonable range');

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

  // E9 — depreciation reasonableness.  Only fires when a depreciation
  // charge actually exists; the *absence* of depreciation is E8's job,
  // so when depAmt is zero we mark E9 as Not Applicable rather than
  // duplicating E8's finding.
  // Tally encodes asset balances as NEGATIVE on the BS XML (Dr
  // balances), so we compare on absolute values — the sign is an
  // encoding convention, not a business signal.
  const absDep = Math.abs(depAmt);
  const absFA  = Math.abs(fixedAssets);
  c('E9', 'E', 'Depreciation amount reasonable',
    !hasFAfilter ? na('Not applicable')
    : !(hasPL && hasBS) ? uncertain(3, 'Requires P&L and Balance Sheet')
    : absDep === 0 ? na('No depreciation booked — see E8')
    : absFA === 0 ? uncertain(3, 'Fixed Assets value not extracted from Balance Sheet')
    : absDep < absFA ? pass(3, 3, `Dep ₹${fmt(absDep)} < FA ₹${fmt(absFA)} (${((absDep / absFA) * 100).toFixed(1)}%)`)
    : fail(3, `Depreciation ₹${fmt(absDep)} exceeds Fixed Assets ₹${fmt(absFA)} — verify both figures`),
    'Depreciation amount unreasonable');

  c('E10', 'E', 'Closing stock in Balance Sheet',
    !isGoods ? na('Not applicable')
    : !hasBS ? uncertain(4, 'Requires Balance Sheet')
    : bsStock > 0 ? pass(4, 4, `Closing stock: ₹${fmt(bsStock)}`)
    : plStock > 0
        ? fail(4, `P&L shows closing stock ₹${fmt(plStock)} but no matching ledger on BS — create a Stock-in-Hand ledger to record it as an asset`)
        : fail(4, 'No closing stock in Balance Sheet'),
    'No closing stock in Balance Sheet');

  // E11 — Stock equation:  Opening + Purchases − Closing  ≈  COGS
  //
  // Previously this was a stub that fired uncertain whenever closingStock
  // was 0 or openingStock was negative — confused "value is zero" with
  // "value is missing" and never actually computed anything.  Now we:
  //
  //   1. Take |abs| of each leg (Tally signs assets negative; the equation
  //      is sign-agnostic since each term is a magnitude).
  //   2. Compute implied COGS from the BS/TB legs.
  //   3. If the P&L provides an explicit "Cost of materials consumed"
  //      line, compare it to the implied COGS and pass within 5%.
  //   4. Otherwise just report the implied COGS — the equation is well-
  //      formed and the user can sanity-check it.
  c('E11', 'E', 'Stock equation: Op + Pur − COGS ≈ Closing',
    !isGoods ? na('Not applicable')
    : !(hasPL && hasBS && hasTB) ? uncertain(4, 'Requires P&L, Balance Sheet, and Trial Balance')
    : (() => {
        const op    = Math.abs(openingStock);
        const pur   = Math.abs(tbPurch);
        const close = Math.abs(closingStock);
        const cogs  = Math.abs(costOfMaterials);
        const impliedCogs = op + pur - close;

        // Display helper: fmt() returns '—' on zero/NaN, which combined
        // with the template literal's leading ₹ produces "₹—" — a
        // meaningless string the user sees as a rendering bug.  When the
        // value is genuinely absent (zero, in a context where zero means
        // "not in the data"), render "n/a" instead.
        const r = (n: number) => (n === 0 ? 'n/a' : `₹${fmt(n)}`);

        // No purchases at all in a goods business — almost certainly mis-
        // tagged profile (likely services, not goods).
        if (pur === 0 && op === 0 && close === 0) {
          return uncertain(4, 'Opening, Purchases, and Closing all zero — verify "Goods Business" profile flag');
        }

        // Verify the stock equation is well-formed and report the
        // implied COGS.  We deliberately DO NOT compare against a
        // separately-parsed P&L "COGS" or "Cost of materials consumed"
        // figure because:
        //
        //   1. Tally Prime's standard P&L layout doesn't have a single
        //      "Cost of materials" line — it lays out Opening Stock,
        //      Purchase Accounts, Direct Expenses, and Closing Stock as
        //      separate top-level rows.  There's no aggregate to compare
        //      against.
        //   2. Some Tally exports DO emit a rolled-up "Cost of Sales"
        //      subtotal in the XML even when it's not displayed.  My
        //      earlier regex caught it AND the Purchase Accounts group,
        //      producing a doubled figure (~ ₹12.86L on the user's data
        //      where Purchases were actually ₹6.46L).
        //
        // Instead the equation IS the verification: Op + Pur − Close = COGS
        // is the definition of COGS for trading businesses.  When all
        // three components are detected and consistent (no negative
        // implied COGS, no zero-everything), the books are structurally
        // fine for this dimension.
        const formula = `Op ${r(op)} + Pur ${r(pur)} − Close ${r(close)} = ${r(impliedCogs)}`;

        // Implied COGS should be non-negative on any well-kept books.
        // A negative implied COGS means closing stock exceeds purchases +
        // opening, which is mathematically impossible unless purchases
        // are missing or closing stock is overstated.
        if (impliedCogs < 0) {
          return partial(2, 4,
            `${formula} — implied COGS is NEGATIVE; closing stock (${r(close)}) exceeds opening (${r(op)}) + purchases (${r(pur)}). Check for missing purchase entries or overstated closing stock.`);
        }

        // Sanity: closing stock should be a reasonable fraction of
        // purchases.  > 5× purchases is suspicious (stock build-up far
        // beyond normal turnover).
        if (close > 0 && pur > 0 && close > pur * 5) {
          return partial(3, 4,
            `${formula} — closing stock (${r(close)}) is ${(close/pur).toFixed(1)}× purchases; unusually high.`);
        }

        return pass(4, 4, `${formula} (implied COGS for the period)`);
      })());

  // E12 — was a stub-pass (DayBook existence ≠ stock movement existence).
  // Real signal: count vouchers whose type semantics map to stock
  // movement (Delivery Note / Receipt Note / Stock Journal / Material
  // In/Out / Physical Stock).  Falls back to a name-pattern scan over
  // dbStats.vouchers for setups where the classifier hasn't seen the
  // user's custom stock voucher types yet.
  c('E12', 'E', 'Stock movement entries exist',
    !isGoods ? na('Not applicable')
    : !hasDaybook ? uncertain(3, 'Requires DayBook')
    : (() => {
        const vouchers = dbStats?.vouchers ?? [];
        if (vouchers.length === 0) return uncertain(3, 'No vouchers parsed');
        const STOCK_TYPE_RE = /\b(stock|delivery\s*note|receipt\s*note|material\s*in|material\s*out|physical\s*stock|inventory)\b/i;
        let stockVouchers = 0;
        for (const v of vouchers) {
          if (v.type && STOCK_TYPE_RE.test(v.type)) stockVouchers++;
        }
        if (stockVouchers === 0) return fail(3, 'No stock-movement vouchers detected (Delivery Note / Receipt Note / Stock Journal). Material movement should be recorded as inventory vouchers, not Journal entries.');
        return pass(3, 3, `${stockVouchers} stock-movement voucher${stockVouchers === 1 ? '' : 's'} detected`);
      })(),
    'No stock-movement vouchers detected');

  // ────── F: Recording Discipline ──────
  c('F1', 'F', 'No gaps > 30 days in active months',
    !hasDaybook ? uncertain(4, 'Requires DayBook')
    : dates.length < 2 ? uncertain(4, 'Insufficient date data')
    : maxGapDays <= 30 ? pass(4, 4, `Max gap: ${Math.round(maxGapDays)} days`)
    : maxGapDays <= 60 ? partial(2, 4, `Max gap: ${Math.round(maxGapDays)} days (>30 days)`)
    : fail(4, `Max gap: ${Math.round(maxGapDays)} days (>60 days)`),
    'Date gap over 30 days in active months');

  // F2 — books current.  Previously auto-passed whenever a DayBook was
  // uploaded, regardless of whether the latest entry was anywhere near
  // FY end.  That's a textbook "no-stub-passes" violation: the audit
  // signal "books are up to date" requires comparing the latest voucher
  // date to fyEnd, not the existence of a DayBook file.
  //
  // Rule: latest voucher date should land within ~30 days of fyEnd (a
  // typical bookkeeping lag).  Pass <=30d, partial 31-60d, fail >60d.
  // If the latest entry is *after* fyEnd that's fine — the user uploaded
  // a TB that runs a bit past year-end, or fyEnd was inferred slightly
  // early; either way it's not "books behind".
  c('F2', 'F', 'Books current — entries up to FY end',
    !fullFY ? na('Not applicable (partial FY)')
    : !hasDaybook ? uncertain(3, 'Requires DayBook')
    : dates.length === 0 ? uncertain(3, 'No voucher dates parsed')
    : (() => {
        const latest = dates[dates.length - 1];
        const latestStr = latest.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const fyEndStr  = fyEnd .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const daysBehind = (fyEnd.getTime() - latest.getTime()) / (1000 * 60 * 60 * 24);
        if (daysBehind <= 0)  return pass(3, 3, `Latest entry ${latestStr} — at or after FY end ${fyEndStr}`);
        if (daysBehind <= 30) return pass(3, 3, `Latest entry ${latestStr} — ${Math.round(daysBehind)} days before FY end (within typical lag)`);
        if (daysBehind <= 60) return partial(2, 3, `Latest entry ${latestStr} — ${Math.round(daysBehind)} days before FY end ${fyEndStr}; books slightly behind`);
        return fail(3, `Latest entry ${latestStr} — ${Math.round(daysBehind)} days before FY end ${fyEndStr}; books significantly behind`);
      })(),
    'Latest voucher date significantly behind FY end');

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
  // G1 — same party not split across multiple ledgers.
  //
  // Previously a stub that always passed (`${tbLedgers.length} ledgers
  // reviewed`) regardless of underlying data — violates the
  // no-stub-passes rule.  Now we actually look for the specific signal:
  // the SAME party name appearing as both a Sundry Debtor ledger AND a
  // Sundry Creditor ledger.  That's a real audit signal — "ABC Corp"
  // listed under debtors (₹50k receivable) AND under creditors (₹20k
  // payable) means the books should net the two and report one
  // position, not double-stack the gross figures.
  //
  // Note: within-category near-duplicates (two debtor ledgers for the
  // same party) are already caught by B2's general near-duplicate
  // detection — G1 deliberately scopes to cross-category splits so we
  // don't double-count the same finding twice in the dashboard.
  const partyLedgers: Array<{ name: string; nl: string; category: 'debtor' | 'creditor' }> = [];
  if (hasTB) {
    for (const l of tbLedgers) {
      const cls = classifyLedger(l.name, masterMap, overrides, bsHierarchy);
      if (cls.category === 'debtor' || cls.category === 'creditor') {
        partyLedgers.push({ name: l.name, nl: l.nl, category: cls.category });
      }
    }
  }
  const crossCategoryPartySplits: Array<[string, string]> = [];
  for (let i = 0; i < partyLedgers.length; i++) {
    for (let j = i + 1; j < partyLedgers.length; j++) {
      const A = partyLedgers[i];
      const B = partyLedgers[j];
      if (A.category === B.category) continue;     // within-category: B2's job
      if (!isDuplicate(A.nl, B.nl)) continue;
      crossCategoryPartySplits.push([A.name, B.name]);
    }
  }
  const splitCount = crossCategoryPartySplits.length;
  const splitNote = splitCount === 0
    ? 'No party found split across debtor + creditor'
    : `${splitCount} party${splitCount === 1 ? '' : ' pairs'} split across debtor + creditor: ${
        crossCategoryPartySplits.slice(0, 5).map(([a, b]) => `"${a}" ↔ "${b}"`).join(', ')
      }${splitCount > 5 ? '…' : ''}`;
  // Mirror into parsedData so the ChecklistView G1 drill-down can render
  // the full pair list via LedgerPairDrillDown (the inline note only shows
  // the first 5).
  parsedData.partySplitPairs = crossCategoryPartySplits;
  c('G1', 'G', 'Same party not split across multiple ledgers',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : partyLedgers.length === 0 ? uncertain(3, 'No debtor or creditor ledgers detected')
    : splitCount === 0 ? pass(3, 3, splitNote)
    : partial(1, 3, splitNote),
    'Same party split across debtor + creditor ledgers');

  // G2 — same expense classified into different ledger groups.
  // Previously this reused B2's `dupPairs` (near-duplicate ledger NAMES),
  // which is structurally different — B2 catches "Bank Charge" vs "Bank
  // Charges", G2 should catch "Office Rent" in Indirect Expenses vs
  // "Office Rent" in Direct Expenses (same name, different group).
  // Now we compare stem-cleaned names across the TB ledger list and
  // flag pairs whose names match but whose Tally classification category
  // differs (e.g. one classified as 'indirect-expense', the other as
  // 'direct-expense').  Failures get a real failLabel so the flag panel
  // can surface a concrete message.
  const expenseSplitPairs: Array<[string, string]> = [];
  if (hasTB) {
    type CatLedger = { name: string; nl: string; stem: string; cat: string };
    const catLedgers: CatLedger[] = tbLedgers.map(l => ({
      name: l.name,
      nl:   l.nl,
      stem: stemClean(l.nl),
      cat:  classifyLedger(l.name, masterMap, overrides, bsHierarchy).category,
    }));
    // Only consider Dr-side P&L categories — Cr-side (income) splits are
    // a separate accounting concern; mixing the two would double-count
    // legitimate naming patterns like "Sales — Domestic" / "Sales —
    // Export" that exist for compliance reasons.
    const DR_PL_CATS = new Set(['direct-expense', 'indirect-expense', 'purchase']);
    for (let i = 0; i < catLedgers.length; i++) {
      for (let j = i + 1; j < catLedgers.length; j++) {
        const A = catLedgers[i];
        const B = catLedgers[j];
        if (!DR_PL_CATS.has(A.cat) || !DR_PL_CATS.has(B.cat)) continue;
        if (A.cat === B.cat) continue;     // same group — not a split
        if (A.stem !== B.stem) continue;   // names don't match
        expenseSplitPairs.push([A.name, B.name]);
      }
    }
  }
  const expSplitNote = expenseSplitPairs.length === 0
    ? 'No same-name expenses across multiple groups'
    : `${expenseSplitPairs.length} expense pair${expenseSplitPairs.length === 1 ? '' : 's'} split across groups: ${
        expenseSplitPairs.slice(0, 5).map(([a, b]) => `"${a}" ↔ "${b}"`).join(', ')
      }${expenseSplitPairs.length > 5 ? '…' : ''}`;
  c('G2', 'G', 'Same expense not in multiple ledger groups',
    !hasTB ? uncertain(3, 'Requires Trial Balance')
    : expenseSplitPairs.length === 0 ? pass(3, 3, expSplitNote)
    : partial(1, 3, expSplitNote),
    'Same-name expense split across multiple ledger groups');
  // Mirror to parsedData for the G2 drill-down (LedgerPairDrillDown).
  parsedData.expenseSplitPairs = expenseSplitPairs;

  // Section 40A(3) — cash EXPENDITURE over ₹10,000 in a day to a single
  // person is disallowed as a deduction (₹35,000 for transport operators).
  // (NOT Section 269ST — that bars cash RECEIPTS of ₹2,00,000 or more.)
  // Statutory compliance check — max=5 so a failure derives to 'high'
  // severity, matching how the legacy `flag-cash-limit` surfaced it.
  c('G3', 'G', 'Cash not used for entries > ₹10,000',
    !hasDaybook ? uncertain(5, 'Requires DayBook')
    : cashOver10k === 0 ? pass(5, 5, 'No cash entries above ₹10,000')
    : fail(5, `${cashOver10k} cash entries exceed ₹10,000 (Section 40A(3) — cash expenditure disallowance)`),
    'Cash entries exceeding ₹10,000');

  // Section 269ST — receiving ₹2,00,000 or more in cash from one person in a
  // day (or per transaction / event) is prohibited; penalty u/s 271DA equals
  // 100% of the amount received.  (Distinct from 40A(3) above, which is about
  // cash PAYMENTS over ₹10,000.)  max=5 → a failure derives to 'high'.
  c('G5', 'G', 'No cash receipts ≥ ₹2 lakh (Section 269ST)',
    !hasDaybook ? uncertain(5, 'Requires DayBook')
    : cashReceiptOver2L === 0 ? pass(5, 5, 'No single-party cash receipts of ₹2 lakh or more in a day')
    : fail(5, `${cashReceiptOver2L} cash receipt voucher(s) total ₹2 lakh or more from one party in a day (Section 269ST — prohibited; penalty = 100% of the amount u/s 271DA)`),
    'Cash receipts of ₹2 lakh or more (Section 269ST)');

  c('G4', 'G', 'Round-number entries below 20% of total',
    !hasDaybook ? uncertain(2, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(2, 'No vouchers parsed')
    : roundPct < 0.20 ? pass(2, 2, `${(roundPct*100).toFixed(1)}% round-number entries`)
    : partial(1, 2, `${(roundPct*100).toFixed(1)}% round-number entries (threshold: 20%)`));

  // ────── H: Cross-Statement Reconciliation ──────
  // H1 ("DayBook Dr+Cr totals = Trial Balance totals") was removed.  It
  // compared a flow (sum of voucher amounts during the year) against a
  // snapshot (TB closing-Dr total) — these don't equate by any accounting
  // principle.  The parser also collapsed totalDebit and totalCredit to the
  // same voucher amount (both `+= amt`), making the check structurally
  // broken regardless.  H2/H3/H4 below do meaningful cross-statement
  // reconciliations on Sales, Purchases, and Cash+Bank — keep those.

  // H2 — Sales reconciliation (gross-to-gross).
  //
  // DayBook side: extractAmt() returns the master <AMOUNT> on each Sales
  //   voucher, which Tally fills with the *gross* (incl. GST) figure.
  // TB side: tbSales counts only ledgers literally named "sales" or
  //   "revenue from", which is the *net-of-GST* sales-ledger balance and
  //   misses GST output collected and any other revenue accounts named
  //   differently (e.g. "Service Charges", "GST Services").  To make the
  //   comparison apples-to-apples we add Output-GST collected to the TB
  //   side — that's the GST component included in the gross voucher
  //   amount.  We can't perfectly recover other revenue ledgers without
  //   master/group data, so we widen the tolerance to 5% and downgrade
  //   substantial mismatches to `partial` (informational) rather than
  //   `fail` (critical) — the variance is more often a data-classification
  //   nuance (sales returns, GST cess, period cut-off, multiple revenue
  //   ledgers) than an actual book-keeping error.
  const tbSalesGross = tbSales + outputGSTAmt;
  c('H2', 'H', 'Sales vouchers total ≈ TB Sales + Output GST',
    !(hasDaybook && hasTB) ? uncertain(8, 'Requires DayBook and Trial Balance')
    : tbSalesGross === 0 || dbSales === 0 ? uncertain(8, 'Sales figures not extracted')
    : Math.abs(dbSales - tbSalesGross) / tbSalesGross < 0.05
        ? pass(8, 8, `Sales reconciled within 5% (DB ₹${fmt(dbSales)} ≈ TB+GST ₹${fmt(tbSalesGross)})`)
    : Math.abs(dbSales - tbSalesGross) / tbSalesGross < 0.25
        ? partial(4, 8, `Sales variance: DB ₹${fmt(dbSales)} vs TB+GST ₹${fmt(tbSalesGross)} — common causes: sales returns, multiple revenue ledgers, period cut-off`)
    : partial(2, 8, `Sales variance >25%: DB ₹${fmt(dbSales)} vs TB+GST ₹${fmt(tbSalesGross)} — investigate misclassified revenue ledgers, sales returns, or period mismatch`),
    'Sales voucher total does not match Trial Balance');

  // H3 — Purchase reconciliation (gross-to-gross), same shape as H2.
  // TB side adds back Input-ITC (GST paid on purchases) so we compare the
  // gross purchase value seen in Day Book vouchers against the gross
  // purchase value implied by the Trial Balance.
  const tbPurchGross = tbPurch + inputITCAmt;
  c('H3', 'H', 'Purchase vouchers total ≈ TB Purchase + Input ITC',
    !(hasDaybook && hasTB) ? uncertain(8, 'Requires DayBook and Trial Balance')
    : tbPurchGross === 0 || dbPurch === 0 ? uncertain(8, 'Purchase figures not extracted')
    : Math.abs(dbPurch - tbPurchGross) / tbPurchGross < 0.05
        ? pass(8, 8, `Purchase reconciled within 5% (DB ₹${fmt(dbPurch)} ≈ TB+ITC ₹${fmt(tbPurchGross)})`)
    : Math.abs(dbPurch - tbPurchGross) / tbPurchGross < 0.25
        ? partial(4, 8, `Purchase variance: DB ₹${fmt(dbPurch)} vs TB+ITC ₹${fmt(tbPurchGross)} — common causes: purchase returns, multiple expense ledgers, period cut-off`)
    : partial(2, 8, `Purchase variance >25%: DB ₹${fmt(dbPurch)} vs TB+ITC ₹${fmt(tbPurchGross)} — investigate misclassified purchase ledgers, returns, or period mismatch`),
    'Purchase voucher total does not match Trial Balance');

  // H4 — DayBook cash/bank voucher turnover ≈ TB cash/bank period turnover.
  //
  // Both sides are GROSS Dr+Cr volume during the period (not closing
  // balances — the previous version compared DB turnover against BS
  // closing balance, which are mathematically unrelated quantities and
  // produced false-positive criticals on every clean dataset).
  //
  //   DB side: |amt| over Receipt + Payment + Contra vouchers.  Each
  //            Contra hits two cash/bank ledgers in the TB but only
  //            counts once in dbCashBank, so we add contraTotal again
  //            to match the TB's double-count.
  //   TB side: sum of Dr + Cr period movement over every ledger
  //            classified as cash / bank / bank-od.  Only available
  //            when the TB export is a "TB with transactions" report.
  //
  // Tolerance is 2% — anything wider points at vouchers touching
  // cash/bank ledgers without a Receipt/Payment/Contra type (or vice
  // versa), which is the original audit signal H4 was meant to surface.
  const dbCashBankWithContra = dbCashBank + dbContraTotal;
  // Shared H4 computation — both this fail message and the H4Breakdown
  // modal read from h4-flow.ts so the numbers stay in lockstep.  Receipts
  // are direction-agnostic, payments handle refunds via cash-leg direction,
  // and the TB side auto-detects Cr-positive convention exports and flips
  // signs so a "bank balance grew" reading always reads positive.
  const h4Ctx = buildH4Context(parsedData.masterEntries, parsedData.bsheetStatement, overrides);
  const h4DB  = computeDBCashBankFlow(dbStats?.vouchers, h4Ctx);
  const h4TBNet = computeTBCashBankNet(tbLedgers, h4Ctx);
  const dbCashBankNet = h4DB.net;
  const tbNetForH4 = h4TBNet ?? 0;
  const tbHasOpenings = h4TBNet !== null;
  c('H4', 'H', 'Cash + Bank turnover reconciles between DayBook and TB',
    !(hasDaybook && hasTB) ? uncertain(8, 'Requires DayBook and Trial Balance')
    : dbCashBank === 0 ? uncertain(8, 'DayBook cash+bank turnover not computed')
    : tbCashBankMovement > 0
        // Preferred path: gross Dr + Cr cross-check (only when the TB
        // happens to have period movement columns enabled).
        ? Math.abs(dbCashBankWithContra - tbCashBankMovement) / tbCashBankMovement < 0.02
            ? pass(8, 8, `Cash+Bank turnover reconciled ₹${fmt(tbCashBankMovement)}`)
            : fail(8, `Cash+Bank turnover variance: DB ₹${fmt(dbCashBankWithContra)} vs TB ₹${fmt(tbCashBankMovement)} — investigate cash/bank ledgers hit by non-Receipt/Payment/Contra vouchers`)
    // Net-movement fallback path requires the TB export to actually
    // include opening balance fields.  computeTBCashBankNet returns null
    // when no cash/bank ledger has opening data — gate on that so we
    // correctly surface "we don't have the data" instead of comparing
    // against a phantom zero.
    : tbHasOpenings && (tbNetForH4 !== 0 || dbCashBankNet !== 0)
        // Compare DayBook net (receipts − payments) against TB net
        // (closing − opening) on cash/bank ledgers — they should match
        // to within ₹100 (small rounding tolerance, no percentage).
        ? Math.abs(dbCashBankNet - tbNetForH4) < 100
            ? pass(8, 8, `Cash+Bank net flow reconciled ₹${fmt(Math.abs(dbCashBankNet))} (DB receipts−payments matches TB closing−opening)`)
            : fail(8, `Cash+Bank net flow variance: DB ₹${fmt(dbCashBankNet)} (receipts−payments) vs TB ₹${fmt(tbNetForH4)} (closing−opening) — voucher activity doesn't match TB balances`)
    : uncertain(8, 'TB has no opening balance or period movement data — re-pull via the Tally bridge to get this check'),
    'Cash + Bank turnover does not match between DayBook and TB');

  // H5 — Tax balances reasonable vs sales.  Was a stub waiting on a
  // never-shipped Form 26AS / GSTR-3B import.  Now we sanity-check the
  // Output GST closing balance against revenue: GST output should land
  // roughly between 1% (very low-rate composite) and 25% (mostly 18%
  // rate goods) of sales.  Outside that band suggests a misclassified
  // ledger or under/over-reporting.  Same shape for TDS via dbPayments
  // (covered separately by E6) so this slot focuses on GST.
  c('H5', 'H', 'Tax balances reasonable vs sales',
    !(gstApplicable || tdsApplicable) ? na('Not applicable')
    : !hasTB ? uncertain(6, 'Requires Trial Balance')
    : (() => {
        if (!gstApplicable) {
          // TDS-only company — handled by E6 in detail.  Surface a brief
          // pass here when TDS ledger exists.
          return tdsLedgerFound
            ? pass(6, 6, 'TDS ledger present (full reconciliation handled by E6)')
            : fail(6, 'TDS applicable but no TDS ledger found in TB');
        }
        const gstSales = tbSales > 0 ? tbSales : Math.abs(revenue);
        if (gstSales === 0) return uncertain(6, 'Sales figure not extracted — cannot compute tax ratio');
        if (outputGSTAmt === 0) {
          return fail(6, 'GST applicable but Output GST balance is zero — verify GST classification or composition scheme');
        }
        const ratio = outputGSTAmt / gstSales;
        const pct = (ratio * 100).toFixed(2);
        if (ratio < 0.01) return partial(3, 6, `Output GST ${pct}% of sales — below typical 1-25% range; possible classification miss`);
        if (ratio > 0.25) return partial(3, 6, `Output GST ${pct}% of sales — unusually high; review GST ledger classification`);
        return pass(6, 6, `Output GST ₹${fmt(outputGSTAmt)} = ${pct}% of sales ₹${fmt(gstSales)} — within reasonable range`);
      })(),
    'Output GST percentage outside reasonable range');

  // H6 — Profit-to-Capital closing entry detection.
  //
  // At period-end, the P&L Net Profit must be transferred to the Capital A/c
  // (or Reserves & Surplus / Retained Earnings) via a closing Journal entry:
  //
  //   Dr  Profit & Loss A/c       [Net Profit]
  //   Cr  Capital A/c / Reserves  [Net Profit]
  //
  // Without this entry, the books aren't finalised — the BS won't show the
  // year's profit accumulated in equity, and the next period's opening
  // balances will be wrong.
  //
  // Detection: scan DayBook for any voucher whose legs include BOTH a
  // P&L-style ledger AND a Capital/Reserves-style ledger.  Match by
  // substring on the lowercased leg name (which the parser already stores
  // in the legs[] array).  Sum the matched legs' amounts and compare
  // against |netProfit|.
  //
  // Previous H6 (`gross |amount| sum of all journals ≈ netProfit`) was a
  // numerical coincidence test with no accounting basis — see the user
  // discussion that prompted this rewrite.
  const PL_KEYS  = ['profit & loss', 'profit and loss', 'p&l', 'p & l', 'p/l'];
  const CAP_KEYS = ['capital', 'reserves', 'retained earnings', 'proprietor', 'partners capital', 'owner equity', 'owners equity'];
  function legMatches(name: string, keys: string[]): boolean {
    const n = name.toLowerCase();
    return keys.some(k => n.includes(k));
  }
  const profitClosingEntries: NonNullable<ParsedData['profitClosingEntries']> = [];
  for (const v of (dbStats?.vouchers ?? [])) {
    if (!v.legs || v.legs.length < 2) continue;
    const plLeg  = v.legs.find(l => legMatches(l.name, PL_KEYS));
    const capLeg = v.legs.find(l => legMatches(l.name, CAP_KEYS));
    if (!plLeg || !capLeg) continue;
    // Don't match when the same leg satisfies both predicates (e.g. a
    // ledger literally named "Capital Profit Reserve" matches CAP_KEYS;
    // a single-leg combo isn't a closing entry).
    if (plLeg === capLeg) continue;
    profitClosingEntries.push({
      date: v.date,
      vno: v.vno,
      type: v.type,
      plLedger: plLeg.name,
      capitalLedger: capLeg.name,
      // Both legs must carry the same magnitude in a balanced 2-leg
      // closing entry.  Use the P&L leg's amount as the canonical value.
      amount: plLeg.amt,
    });
  }
  parsedData.profitClosingEntries = profitClosingEntries;

  const totalClosed   = profitClosingEntries.reduce((s, e) => s + e.amount, 0);
  const targetProfit  = Math.abs(netProfit);
  const closeVariance = targetProfit > 0 ? Math.abs(totalClosed - targetProfit) / targetProfit : 0;

  c('H6', 'H', 'Profit transferred to Capital / Reserves at period end',
    !(hasDaybook && hasPL) ? uncertain(5, 'Requires DayBook and P&L')
    : targetProfit === 0
        ? uncertain(5, 'P&L Net Profit is zero — nothing to transfer')
    : profitClosingEntries.length === 0
        ? fail(5, `No closing Journal entry found that transfers profit (Dr P&L → Cr Capital/Reserves). Expected ≈ ₹${fmt(targetProfit)}.`)
    : closeVariance < 0.005
        ? pass(5, 5, `Closing entry transfers ₹${fmt(totalClosed)} to ${profitClosingEntries[0].capitalLedger} — matches Net Profit`)
    : closeVariance < 0.05
        ? partial(3, 5, `Closing entry transfers ₹${fmt(totalClosed)} vs Net Profit ₹${fmt(targetProfit)} (${(closeVariance*100).toFixed(1)}% variance)`)
        : partial(1, 5, `Closing entry amount ₹${fmt(totalClosed)} differs from Net Profit ₹${fmt(targetProfit)} by ${(closeVariance*100).toFixed(1)}% — investigate`),
    'P&L profit not transferred to Capital/Reserves');

  // H7 — DayBook sales reconciled to P&L revenue.
  //
  // DayBook sales naturally INCLUDE Output GST (each sale voucher records
  // the gross party-side amount = taxable value + GST).  P&L revenue is
  // GST-exclusive (Tally classifies Output GST as a Duties & Taxes
  // liability, not income).  Comparing them directly produces a
  // structural mismatch in every GST-applicable company — which is just
  // GST encoding noise, not an audit signal.
  //
  // Fix: subtract Output GST from the DayBook side before comparing.
  // What's left is the net (GST-exclusive) sales magnitude — apples to
  // apples with P&L revenue.  Any remaining variance is a real signal
  // (sales returns, missing revenue ledgers, period cut-off, etc.).
  const dbSalesNetOfGST = dbSales - outputGSTAmt;
  c('H7', 'H', 'DayBook sales (net of GST) ≈ P&L revenue',
    !(hasDaybook && hasPL) ? uncertain(5, 'Requires DayBook and P&L')
    : revenue === 0 ? uncertain(5, 'Revenue not extracted from P&L')
    : Math.abs(dbSalesNetOfGST - revenue) / (revenue || 1) < 0.05
        ? pass(5, 5, `DB sales (net of GST) ₹${fmt(dbSalesNetOfGST)} ≈ Revenue ₹${fmt(revenue)}`)
    : partial(1, 5, `DB sales (net of GST) ₹${fmt(dbSalesNetOfGST)} vs P&L revenue ₹${fmt(revenue)} (>5%)`));

  // H8 — month-wise volume consistency.
  //
  // The rule (≥3 distinct months needed) is purely mechanical: you can't
  // compute a "max ÷ average" spike with fewer than 3 data points.  But
  // *why* there are fewer than 3 months matters for categorisation:
  //
  //   • DayBook returned 0 vouchers          → uncertain (data issue)
  //   • Profile says fullFY, vouchers exist
  //     but only span <3 months              → PASS, sparse-books note —
  //     the business genuinely had quiet
  //     months; the rule literally cannot
  //     fire and isn't applicable
  //   • Profile says partial-FY, <3 months   → uncertain (user knew
  //     they uploaded a narrow period)
  //   • ≥3 months                            → spike detection runs
  c('H8', 'H', 'Month-wise volumes consistent — no spikes',
    !hasDaybook ? uncertain(5, 'Requires DayBook')
    : totalVouchers === 0 ? uncertain(5, 'No vouchers parsed from DayBook')
    : distinctMonths < 3
        ? (fullFY
            ? pass(5, 5, `Only ${distinctMonths} month${distinctMonths === 1 ? '' : 's'} had voucher activity in the full-FY period — sparse-books company, spike detection not applicable`)
            : uncertain(5, `Only ${distinctMonths} month${distinctMonths === 1 ? '' : 's'} of voucher data — need ≥3 for spike detection. Switch the period selector to a wider range or set "Full FY" in Profile if this is the complete year.`))
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

  // ── Phase 7: classification telemetry ──────────────────────────────────
  // Compute the per-run summary AFTER analysis completes (so we know what
  // the classifier actually did) and fire the network call asynchronously
  // so it never blocks the user-visible flow.  Only emit when a company
  // is selected — without an FK there's nothing the server can persist.
  const tbLedgersForTelemetry = parsedData.tbLedgers ?? [];
  if (state.currentCompany?.id && tbLedgersForTelemetry.length > 0) {
    const summary = {
      company_id: state.currentCompany.id,
      total_ledgers: tbLedgersForTelemetry.length,
      ledger_overridden: 0,
      ledger_high: 0,
      ledger_medium: 0,
      ledger_low: 0,
      ledger_none: 0,
      unclassified_ledgers: [] as string[],
      low_conf_ledgers: [] as string[],
      unknown_voucher_types: [] as string[],
      industry: state.currentCompany.companyType ?? undefined,
      files_loaded: Object.values(files).filter(f => f.hasContent).length,
    };
    for (const l of tbLedgersForTelemetry) {
      const cls = classifyLedger(l.name, masterMap, overrides, bsHierarchy);
      switch (cls.confidence) {
        case 'overridden': summary.ledger_overridden++; break;
        case 'high':       summary.ledger_high++;       break;
        case 'medium':     summary.ledger_medium++;     break;
        case 'low':
          summary.ledger_low++;
          summary.low_conf_ledgers.push(l.name);
          break;
        case 'none':
          summary.ledger_none++;
          summary.unclassified_ledgers.push(l.name);
          break;
      }
    }
    // Voucher-type unknown names (Phase 4 catalog evolution) — collected
    // from the parsed daybook stats.  We rebuild a small set since the
    // existing dbStats doesn't track per-type classification, but the
    // unique voucher type strings are cheap to derive.
    if (dbStats?.vouchers) {
      const seen = new Set<string>();
      for (const v of dbStats.vouchers) {
        if (v.type) seen.add(v.type);
      }
      // Note: full classification round-trip avoided here for cost — the
      // server can re-classify on the aggregation side using the same
      // catalog.  We just send the unique type names.
      summary.unknown_voucher_types = Array.from(seen);
    }
    void recordClassificationSummary(summary);
  }

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
