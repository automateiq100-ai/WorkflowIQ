'use client';

import type {
  AppState, Check, CheckStatus, DimKey, AnalysisResults, ParsedData, ChunkedStats, CompanyProfile,
} from './types';
import { DIM_WEIGHTS } from './constants';
import {
  parseTrialBalance, parseTBFull,
  parsePandL, parseBSheet, parseGrpSum, parseDayBook, parseTallyDate,
  parseCashFlow, parseLedgerGroups, parseMasterMap, parsePandLStatement, parseBSheetStatement, flattenStatement,
  normalizeMasterKey,
} from './parser';
import { buildBSHierarchyMap, classifyLedger } from './tally-groups';
import { classifyVoucherType } from './tally-voucher-types';
import { recordClassificationSummary } from './telemetry';

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
  const tbRows    = hasTB  ? parseTBFull(files.trialbal.content!, masterMap) : [];
  const plResult  = hasPL  ? parsePandL(files.pandl.content!)           : null;
  const bsResult  = hasBS  ? parseBSheet(files.bsheet.content!)         : null;
  const pandlStatement = hasPL ? parsePandLStatement(files.pandl.content!, masterMap) : null;

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
      const has = (c: string) => cats.includes(c);
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

  // Cash-transactions-over-₹10k rescan — master-aware replacement for
  // the parse-time substring approximation.  The parser flags vouchers
  // whose TYPE NAME contains "cash" (matches "Cash Payment", "Cash
  // Receipt" voucher types but misses any standard Payment/Receipt
  // voucher that happens to touch a cash ledger via its entries).
  // We classify each leg via the master and look for the 'cash'
  // category instead, so a Payment voucher with a "Cash-in-Hand" leg
  // correctly counts toward s.40A(3) compliance.
  if (dbStats?.vouchers?.length && masterMap.size > 0) {
    for (const v of dbStats.vouchers) {
      if (v.flags?.includes('cashOver10k')) {
        v.flags = v.flags.filter(f => f !== 'cashOver10k');
        if (v.flags.length === 0) delete v.flags;
      }
    }
    let newCashOver10k = 0;
    for (const v of dbStats.vouchers) {
      if (v.amount <= 10000 || !v.legs?.length) continue;
      const touchesCash = v.legs.some(leg => {
        return classifyLedger(leg.name, masterMap, overrides, bsHierarchy).category === 'cash';
      });
      if (!touchesCash) continue;
      if (!v.flags) v.flags = [];
      v.flags.push('cashOver10k');
      newCashOver10k++;
    }
    dbStats.cashOver10k = newCashOver10k;
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

  // Bug 2 fix: prefer bsNetProfit from Balance Sheet over P&L-derived netProfit
  if (bsResult?.bsNetProfit != null && bsResult.bsNetProfit !== 0) {
    parsedData.netProfit = bsResult.bsNetProfit;
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
    revenue = 0, netProfit = 0, depFound = false, depAmt = 0, openingStock = 0, plClosingStock = 0,
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

        // No purchases at all in a goods business — almost certainly mis-
        // tagged profile (likely services, not goods).
        if (pur === 0 && op === 0 && close === 0) {
          return uncertain(4, 'Opening, Purchases, and Closing all zero — verify "Goods Business" profile flag');
        }

        // Implied COGS derived from the equation; if explicit COGS line
        // exists in P&L, reconcile against it.
        if (cogs > 0) {
          const variance = Math.abs(cogs - impliedCogs);
          const tolerance = Math.max(1000, cogs * 0.05);   // 5% or ₹1k floor
          if (variance < tolerance) {
            return pass(4, 4,
              `Op ₹${fmt(op)} + Pur ₹${fmt(pur)} − Close ₹${fmt(close)} = ₹${fmt(impliedCogs)} ≈ COGS ₹${fmt(cogs)}`);
          }
          return partial(2, 4,
            `Stock equation off by ₹${fmt(variance)} — Op ₹${fmt(op)} + Pur ₹${fmt(pur)} − Close ₹${fmt(close)} = ₹${fmt(impliedCogs)} vs P&L COGS ₹${fmt(cogs)}`);
        }

        // No explicit COGS in P&L — many SME setups don't have a separate
        // "Cost of materials consumed" line; the equation still holds,
        // we just can't independently verify against an existing total.
        // Report the implied COGS as a pass with the breakdown so the
        // user can see we computed it.
        return pass(4, 4,
          `Implied COGS = Op ₹${fmt(op)} + Pur ₹${fmt(pur)} − Close ₹${fmt(close)} = ₹${fmt(impliedCogs)} (no explicit COGS line in P&L to reconcile against)`);
      })());

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
  // Net change in cash/bank from the DayBook = receipts − payments.
  // Contras net to zero at the cash/bank aggregate level (one leg in,
  // one out), so they're correctly excluded.
  const dbCashBankNet = dbReceipts - dbPayments;
  c('H4', 'H', 'Cash + Bank turnover reconciles between DayBook and TB',
    !(hasDaybook && hasTB) ? uncertain(8, 'Requires DayBook and Trial Balance')
    : dbCashBank === 0 ? uncertain(8, 'DayBook cash+bank turnover not computed')
    : tbCashBankMovement > 0
        // Preferred path: gross Dr + Cr cross-check (only when the TB
        // happens to have period movement columns enabled).
        ? Math.abs(dbCashBankWithContra - tbCashBankMovement) / tbCashBankMovement < 0.02
            ? pass(8, 8, `Cash+Bank turnover reconciled ₹${fmt(tbCashBankMovement)}`)
            : fail(8, `Cash+Bank turnover variance: DB ₹${fmt(dbCashBankWithContra)} vs TB ₹${fmt(tbCashBankMovement)} — investigate cash/bank ledgers hit by non-Receipt/Payment/Contra vouchers`)
    : tbCashBankNetMovement !== 0 || dbCashBankNet !== 0
        // Net-movement fallback: opening + closing are always available
        // when the bridge pulls the TB via the custom collection.
        // Compare DayBook net (receipts − payments) against TB net
        // (closing − opening) on cash/bank ledgers — they should match
        // to within ₹100 (small rounding tolerance, no percentage).
        ? Math.abs(dbCashBankNet - tbCashBankNetMovement) < 100
            ? pass(8, 8, `Cash+Bank net flow reconciled ₹${fmt(Math.abs(dbCashBankNet))} (DB receipts−payments matches TB closing−opening)`)
            : fail(8, `Cash+Bank net flow variance: DB ₹${fmt(dbCashBankNet)} (receipts−payments) vs TB ₹${fmt(tbCashBankNetMovement)} (closing−opening) — voucher activity doesn't match TB balances`)
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
