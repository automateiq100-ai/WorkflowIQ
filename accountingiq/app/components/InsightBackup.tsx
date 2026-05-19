'use client';

import { useEffect, useMemo } from 'react';
import type { Insight, ParsedData, TBLedger, ChunkedStats } from '@/lib/types';
import { computeGSTVariance } from '@/lib/gst-variance';

interface Props {
  insight: Insight;
  parsedData: Partial<ParsedData>;
  /** DayBook stats — required for reconciliation backups (H2/H3/H6/H7/H8)
   *  that compare DayBook-derived totals against TB / P&L figures.  Older
   *  callers that only opened arithmetic/GST backups (pos-arith / pos-gst)
   *  don't need to pass it. */
  dbStats?: ChunkedStats | null;
  onClose: () => void;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000)    return `${sign}${(abs / 100_000).toFixed(2)}L`;
  return `${sign}${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export default function InsightBackup({ insight, parsedData, dbStats, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // D1 working — mirrors the engine.  Period-movement check is the
  // primary invariant: (closing_Cr − opening_Cr) − (closing_Dr − opening_Dr)
  // should be ≈ 0 in a properly posted period.  Fall back to a
  // closing-only tally check when the TB export has no opening data.
  const tbRows = useMemo(() => {
    const ledgers = (parsedData.tbLedgers ?? []) as TBLedger[];
    let closingDr = 0, closingCr = 0, openingDr = 0, openingCr = 0;
    let openingSeen = false;
    for (const l of ledgers) {
      if (l.closing > 0)      closingDr += l.closing;
      else if (l.closing < 0) closingCr += Math.abs(l.closing);
      if (l.opening !== undefined) {
        openingSeen = true;
        if (l.opening > 0)      openingDr += l.opening;
        else if (l.opening < 0) openingCr += Math.abs(l.opening);
      }
    }
    const drMovement = closingDr - openingDr;
    const crMovement = closingCr - openingCr;
    return {
      closingDr, closingCr, openingDr, openingCr,
      drMovement, crMovement,
      movDiff:     crMovement - drMovement,
      closingDiff: closingDr - closingCr,
      openingSeen,
    };
  }, [parsedData.tbLedgers]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border w-full max-w-3xl max-h-[85vh] flex flex-col"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold mb-0.5 truncate" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              {insight.cat} — backup
            </h2>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              {insight.finding}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none px-2 py-0.5 rounded shrink-0"
            style={{ color: 'var(--text3)' }}
            aria-label="Close"
          >×</button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {insight.id === 'pos-arith' ? (
            <ArithmeticBackup parsedData={parsedData} tbStats={tbRows} />
          ) : insight.id === 'pos-gst' ? (
            <GSTBackup parsedData={parsedData} checkId={insight.checkId} />
          ) : insight.id === 'pos-recon' ? (
            <ReconBackup
              parsedData={parsedData}
              dbStats={dbStats ?? null}
              checkId={insight.checkId ?? ''}
            />
          ) : (
            <p className="text-sm" style={{ color: 'var(--text3)' }}>
              No structured backup available for this insight.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Arithmetic backup ─────────────────────────────────────────────────────

interface TBStats {
  closingDr: number;
  closingCr: number;
  openingDr: number;
  openingCr: number;
  drMovement: number;
  crMovement: number;
  movDiff: number;
  closingDiff: number;
  openingSeen: boolean;
}

function ArithmeticBackup({
  parsedData, tbStats,
}: {
  parsedData: Partial<ParsedData>;
  tbStats: TBStats;
}) {
  // Pick the same primary check the engine uses: period-movement when
  // opening data is present, closing-only as the fallback.
  const tbDiff = tbStats.openingSeen ? tbStats.movDiff : tbStats.closingDiff;
  const tbOk = Math.abs(tbDiff) < 100;
  const tbDrClosing = tbStats.closingDr;
  const tbCrClosing = tbStats.closingCr;

  // plNetProfit is the RAW P&L-derived net profit before the engine's
  // BS-preferred overwrite of parsedData.netProfit.  If it's absent
  // (older analysis run), fall back to parsedData.netProfit, but flag
  // that comparison may be a no-op.
  const netProfitPL = parsedData.plNetProfit ?? parsedData.netProfit ?? 0;
  const netProfitBS = parsedData.bsNetProfit ?? null;
  const netProfitDiff = netProfitBS !== null ? netProfitPL - netProfitBS : null;
  const netProfitOk = netProfitBS !== null && Math.abs(netProfitDiff ?? 0) < 1;

  const ca = parsedData.ca ?? 0;
  const cl = parsedData.cl ?? 0;
  const fixedAssets = parsedData.fixedAssets ?? 0;
  const closingStock = parsedData.closingStock ?? 0;

  // D3 totals: parseBSheetStatement classifies each top-level BS node by
  // sign (Cr-positive convention).  totals.debit = total assets;
  // totals.credit = total liabilities + equity.  Same numbers the engine
  // uses for the D3 check.
  const bsTotals = parsedData.bsheetStatement?.totals;
  const bsAssets = bsTotals?.debit ?? 0;
  const bsLiabEq = bsTotals?.credit ?? 0;
  const bsBalDiff = bsAssets - bsLiabEq;
  const bsBalOk = Math.abs(bsBalDiff) < 100;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          D1 — Trial Balance: Dr movement = Cr movement
        </h3>
        {tbStats.openingSeen ? (
          <>
            <BackupTable rows={[
              ['Opening Debit balances',  fmt(tbStats.openingDr)],
              ['Closing Debit balances',  fmt(tbStats.closingDr)],
              ['Debit movement (closing − opening)',  fmt(tbStats.drMovement)],
              ['Opening Credit balances', fmt(tbStats.openingCr)],
              ['Closing Credit balances', fmt(tbStats.closingCr)],
              ['Credit movement (closing − opening)', fmt(tbStats.crMovement)],
              ['Difference  (Cr movement − Dr movement)', fmt(tbStats.movDiff), tbOk ? 'good' : 'bad'],
              ['Status',
                tbOk ? '✓ Period postings balanced' : '✗ Period postings out of balance',
                tbOk ? 'good' : 'bad'],
            ]} />
            <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
              Formula: (closing Cr − opening Cr) − (closing Dr − opening Dr) should be ≈ 0 for any
              period whose journal entries are correctly double-entered.
            </p>
          </>
        ) : (
          <>
            <BackupTable rows={[
              ['Total Debit balances (closing)',  fmt(tbDrClosing)],
              ['Total Credit balances (closing)', fmt(tbCrClosing)],
              ['Difference',                       fmt(tbStats.closingDiff), tbOk ? 'good' : 'bad'],
              ['Status',
                tbOk ? '✓ Closing balances tally' : '✗ Closing balances out of balance',
                tbOk ? 'good' : 'bad'],
            ]} />
            <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
              Trial Balance export doesn&apos;t include opening balances — the period-movement check
              has been skipped. Re-pull via the Tally bridge (or re-export with F12 → Show Opening
              Balance = Yes) to enable it.
            </p>
          </>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          D2 — P&amp;L net profit = BS &quot;Profit &amp; Loss A/c&quot;
        </h3>
        <BackupTable rows={[
          ['Net profit per P&L',          fmt(netProfitPL)],
          ['Net profit per Balance Sheet', netProfitBS === null ? '—' : fmt(netProfitBS)],
          ['Difference',                  netProfitDiff === null ? '—' : fmt(netProfitDiff), netProfitOk ? 'good' : (netProfitBS === null ? undefined : 'bad')],
          ['Status',                      netProfitOk ? '✓ Match' : (netProfitBS === null ? 'BS P&L line not detected' : '✗ Mismatch'),
            netProfitOk ? 'good' : (netProfitBS === null ? undefined : 'bad')],
        ]} />
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          D3 — Balance Sheet equation (Assets = Liab + Equity)
        </h3>
        <BackupTable rows={[
          ['Total Assets (Dr side)',          fmt(bsAssets)],
          ['Total Liabilities + Equity (Cr side)', fmt(bsLiabEq)],
          ['Difference',                      fmt(bsBalDiff), bsBalOk ? 'good' : 'bad'],
          ['Status',
            (bsAssets === 0 && bsLiabEq === 0) ? 'BS structure not parsed'
            : bsBalOk ? '✓ Balanced'
            : '✗ Out of balance',
            bsBalOk ? 'good' : (bsAssets === 0 && bsLiabEq === 0 ? undefined : 'bad')],
        ]} />
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          Reference figures
        </h3>
        <BackupTable rows={[
          ['Current Assets',      fmt(ca)],
          ['Fixed Assets',        fmt(fixedAssets)],
          ['Closing Stock',       fmt(closingStock)],
          ['Current Liabilities', fmt(cl)],
        ]} />
        <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
          Raw inputs from individual BS groups — included for cross-checking the totals above.
        </p>
      </section>
    </div>
  );
}

// ── GST backup ────────────────────────────────────────────────────────────

function GSTBackup({ parsedData, checkId }: { parsedData: Partial<ParsedData>; checkId?: string }) {
  const outputGST = parsedData.outputGSTAmt ?? 0;
  const inputITC  = parsedData.inputITCAmt  ?? 0;
  const revenue   = parsedData.revenue      ?? 0;
  const tbSales   = parsedData.tbSales      ?? 0;
  const tbPurch   = parsedData.tbPurch      ?? 0;

  // Shared with the E2b engine check — see lib/gst-variance.ts.  Picks
  // the nearest Indian GST slab to the observed effective rate, computes
  // expected output GST = sales × slab, then variance vs recorded.
  const gst = computeGSTVariance(revenue || tbSales, outputGST);
  const sales = gst.sales;
  const inputRate = tbPurch > 0 ? inputITC / tbPurch : 0;
  const netGST = outputGST - inputITC;

  // When invoked from a specific check (E1 or E2b), show only that
  // check's section.  When invoked as a positive-insight summary
  // (insight.id === 'pos-gst' with no checkId), show all three sections.
  const showE1   = !checkId || checkId === 'E1';
  const showInput = !checkId;
  const showE2b  = !checkId || checkId === 'E2b';

  return (
    <div className="space-y-6">
      {showE1 && (
      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          E1 — Output GST ledger
        </h3>
        <BackupTable rows={[
          ['Total sales (P&L revenue / TB, taxable value)', fmt(sales)],
          ['Output GST collected',                          fmt(outputGST)],
          ['Effective output rate (collected / sales)',     sales > 0 ? pct(gst.effectiveRate) : '—'],
          ['Status',                                        outputGST > 0 ? '✓ Ledger present' : '✗ No output GST ledger', outputGST > 0 ? 'good' : 'bad'],
        ]} />
      </section>
      )}

      {showInput && (
      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          Input GST / ITC
        </h3>
        <BackupTable rows={[
          ['Total purchases (TB)',  fmt(tbPurch)],
          ['Input ITC claimed',     fmt(inputITC)],
          ['Effective input rate',  tbPurch > 0 ? pct(inputRate) : '—'],
        ]} />
      </section>
      )}

      {showE2b && (
      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
          E2b — Net GST liability &amp; variance
        </h3>
        <BackupTable rows={[
          ['Output GST − Input ITC',                                fmt(netGST)],
          [`Nearest GST slab to effective rate ${pct(gst.effectiveRate)}`,
                                                                    `${(gst.headlineRate * 100).toFixed(0)}%`],
          [`Expected output GST (sales × ${(gst.headlineRate * 100).toFixed(0)}% / 100)`,
                                                                    fmt(gst.expectedGST)],
          ['Recorded output GST',                                   fmt(outputGST)],
          [`Variance |recorded − expected| ÷ expected`,             sales > 0 ? pct(gst.variance) : '—',
            sales > 0 ? (gst.variance < 0.05 ? 'good' : 'bad') : undefined],
          ['Status',
            sales <= 0          ? 'Sales not detected — cannot compute'
            : gst.variance < 0.05  ? '✓ Within 5% threshold'
            : gst.variance < 0.15  ? '⚠ Outside 5% (within 15%)'
                                   : '✗ Exceeds 15% threshold',
            sales <= 0 ? undefined : (gst.variance < 0.05 ? 'good' : 'bad')],
        ]} />
      </section>
      )}

      <p className="text-xs" style={{ color: 'var(--text3)' }}>
        Variance assumes a single-rate business at the slab nearest to the
        observed effective rate.  For multi-rate businesses (e.g. mixed 5% &amp; 18%
        sales) a small variance is expected.  Always cross-check the figures
        above against the GSTR-1 (outward supplies) and GSTR-3B (consolidated
        return) you&apos;ll file for the same period — they should align within
        rounding.
      </p>
    </div>
  );
}

// ── Cross-statement reconciliation backup (H2/H3/H5/H6/H7/H8) ────────────
//
// Mirrors the formulas in lib/engine.ts so the numbers the user sees in
// the modal exactly match the engine's verdict.  Each check id picks one
// section block; we don't render the others, so the modal stays focused
// on the working that drove THIS check rather than dumping every H-check.

function ReconBackup({
  parsedData, dbStats, checkId,
}: {
  parsedData: Partial<ParsedData>;
  dbStats: ChunkedStats | null;
  checkId: string;
}) {
  // Shared inputs — pulled from the same fields the engine reads.  Default
  // to 0 when missing rather than '—', so the arithmetic still rolls up.
  const dbSales       = dbStats?.salesVoucherTotal     ?? 0;
  const dbPurch       = dbStats?.purchVoucherTotal     ?? 0;
  const dbSalesDr     = dbStats?.salesVoucherDr        ?? 0;
  const dbSalesCr     = dbStats?.salesVoucherCr        ?? 0;
  const dbPurchDr     = dbStats?.purchVoucherDr        ?? 0;
  const dbPurchCr     = dbStats?.purchVoucherCr        ?? 0;
  const journalNetAmt = dbStats?.journalNetAmt         ?? 0;
  const monthCounts   = dbStats?.monthCounts           ?? {};
  const tbSales       = parsedData.tbSales             ?? 0;
  const tbPurch       = parsedData.tbPurch             ?? 0;
  const outputGST     = parsedData.outputGSTAmt        ?? 0;
  const inputITC      = parsedData.inputITCAmt         ?? 0;
  const revenue       = parsedData.revenue             ?? 0;
  const netProfit     = parsedData.bsNetProfit ?? parsedData.netProfit ?? 0;

  function variancePct(actual: number, expected: number): number {
    if (expected === 0) return 0;
    return Math.abs(actual - expected) / Math.abs(expected);
  }

  // E11 — Stock equation
  if (checkId === 'E11') {
    const op    = Math.abs(parsedData.openingStock  ?? 0);
    const pur   = Math.abs(parsedData.tbPurch       ?? 0);
    const close = Math.abs(parsedData.closingStock  ?? 0);
    const impliedCogs = op + pur - close;
    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>E11 — Stock equation working</h3>
          <BackupTable rows={[
            ['Opening Stock (from P&L)',         fmt(op)],
            ['+ Purchases (TB Purchase Accounts)', fmt(pur)],
            ['− Closing Stock (from BS / P&L)',  fmt(close)],
            ['= Implied COGS (for the period)',  fmt(impliedCogs), 'good'],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            The stock equation <strong>Op + Pur − Close = COGS</strong> is the DEFINITION of
            Cost of Goods Sold for a trading business — Tally Prime&apos;s P&amp;L lays out
            these four components as separate top-level rows rather than as a single
            &ldquo;Cost of materials consumed&rdquo; line.  When all three input components
            are detected and the implied COGS is non-negative, the equation is structurally
            sound.  The check flags only obvious errors: negative implied COGS (closing
            stock exceeds opening + purchases) or extreme stock-to-purchase ratios.
          </p>
        </section>
      </div>
    );
  }

  // H2 — Sales reconciliation
  if (checkId === 'H2') {
    const tbSalesGross = tbSales + outputGST;
    const variance = variancePct(dbSales, tbSalesGross);
    const status = tbSalesGross === 0 || dbSales === 0 ? 'uncertain'
                 : variance < 0.05 ? 'pass'
                 : variance < 0.25 ? 'partial'
                 : 'fail';
    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H2 — DayBook Sales (Tally Day Book columnar)</h3>
          <BackupTable rows={[
            ['Total Debit  (sum of Dr-column entries)',  fmt(dbSalesDr)],
            ['Total Credit (sum of Cr-column entries)',  fmt(dbSalesCr)],
            ['Net = Debit − Credit',                     fmt(dbSalesDr - dbSalesCr), 'good'],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            Each Sales voucher contributes its amount to either the Debit or Credit column
            based on the first ledger entry&apos;s effective direction (ISDEEMEDPOSITIVE XOR
            AMOUNT sign — handles reversal entries displayed as &ldquo;(-)X&rdquo;).  The
            <strong> Net</strong> matches what Tally shows at the bottom of its columnar Day Book.
          </p>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H2 — Reconciliation vs Trial Balance</h3>
          <BackupTable rows={[
            ['DayBook sales (net of returns)',     fmt(dbSales)],
            ['Trial Balance sales',                fmt(tbSales)],
            ['Output GST (collected)',             fmt(outputGST)],
            ['TB + Output GST (apples-to-apples)', fmt(tbSalesGross)],
            ['Absolute variance',                  fmt(Math.abs(dbSales - tbSalesGross))],
            ['Relative variance (|DB − (TB+GST)| ÷ (TB+GST))', tbSalesGross > 0 ? pct(variance) : '—',
              tbSalesGross > 0 ? (variance < 0.05 ? 'good' : 'bad') : undefined],
            ['Status',
              status === 'pass'      ? '✓ Reconciled within 5%'
              : status === 'partial' ? '⚠ Variance 5–25%'
              : status === 'fail'    ? '✗ Variance > 25%'
                                     : 'Insufficient data',
              status === 'pass' ? 'good' : status === 'uncertain' ? undefined : 'bad'],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            TB side adds Output GST so we compare the gross voucher amount against the gross
            TB recognition.  Tolerance 5% pass, 5–25% partial, &gt; 25% fail — variance is
            often sales returns, multi-rate revenue ledgers, or period cut-off rather than
            misposting.
          </p>
        </section>
      </div>
    );
  }

  // H3 — Purchase reconciliation
  if (checkId === 'H3') {
    const tbPurchGross = tbPurch + inputITC;
    const variance = variancePct(dbPurch, tbPurchGross);
    const status = tbPurchGross === 0 || dbPurch === 0 ? 'uncertain'
                 : variance < 0.05 ? 'pass'
                 : variance < 0.25 ? 'partial'
                 : 'fail';
    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H3 — DayBook Purchases (Tally Day Book columnar)</h3>
          <BackupTable rows={[
            ['Total Debit  (sum of Dr-column entries)',  fmt(dbPurchDr)],
            ['Total Credit (sum of Cr-column entries)',  fmt(dbPurchCr)],
            ['Net = Debit − Credit',                     fmt(dbPurchDr - dbPurchCr), 'good'],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            Each Purchase voucher contributes its amount to either the Debit or Credit column
            based on the first ledger entry&apos;s effective direction (ISDEEMEDPOSITIVE XOR
            AMOUNT sign — handles reversal entries displayed as &ldquo;(-)X&rdquo;).  The
            <strong> Net</strong> should match what Tally shows at the bottom of its columnar
            Day Book filtered to Purchase vouchers.
          </p>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H3 — Reconciliation vs Trial Balance</h3>
          <BackupTable rows={[
            ['DayBook purchases (net of returns)',    fmt(dbPurch)],
            ['Trial Balance purchases',               fmt(tbPurch)],
            ['Input ITC (paid)',                      fmt(inputITC)],
            ['TB + Input ITC (apples-to-apples)',     fmt(tbPurchGross)],
            ['Absolute variance',                     fmt(Math.abs(dbPurch - tbPurchGross))],
            ['Relative variance (|DB − (TB+ITC)| ÷ (TB+ITC))', tbPurchGross > 0 ? pct(variance) : '—',
              tbPurchGross > 0 ? (variance < 0.05 ? 'good' : 'bad') : undefined],
            ['Status',
              status === 'pass'      ? '✓ Reconciled within 5%'
              : status === 'partial' ? '⚠ Variance 5–25%'
              : status === 'fail'    ? '✗ Variance > 25%'
                                     : 'Insufficient data',
              status === 'pass' ? 'good' : status === 'uncertain' ? undefined : 'bad'],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            Common variance causes: misclassified purchase ledgers, returns entered as
            Sales-side adjustments, or period cut-off.
          </p>
        </section>
      </div>
    );
  }

  // H5 — Tax balances reasonable vs sales (Output GST as % of sales)
  if (checkId === 'H5') {
    const salesForGST = tbSales > 0 ? tbSales : Math.abs(revenue);
    const ratio = salesForGST > 0 ? outputGST / salesForGST : 0;
    const inRange = ratio >= 0.01 && ratio <= 0.25;
    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H5 — Output GST as % of sales</h3>
          <BackupTable rows={[
            ['Sales (TB preferred, else P&L revenue)', fmt(salesForGST)],
            ['Output GST collected',                   fmt(outputGST)],
            ['Effective GST rate (Output ÷ Sales)',    salesForGST > 0 ? pct(ratio) : '—',
              salesForGST > 0 ? (inRange ? 'good' : 'bad') : undefined],
            ['Acceptable band',                        '1% – 25%'],
            ['Status',
              salesForGST === 0 || outputGST === 0 ? 'Insufficient data'
              : inRange ? '✓ Within 1–25%'
              : ratio < 0.01 ? '⚠ Below 1% — classification miss?'
                             : '⚠ Above 25% — verify GST ledger',
              salesForGST === 0 || outputGST === 0 ? undefined : (inRange ? 'good' : 'bad')],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            Band derived from typical Indian GST slabs (5% / 12% / 18% / 28%) blended across
            a normal sales mix.  Below 1% suggests Output GST ledger misclassified out of
            scope; above 25% suggests extra non-GST balances rolled into the ledger.
          </p>
        </section>
      </div>
    );
  }

  // H6 — Profit transferred to Capital / Reserves
  if (checkId === 'H6') {
    const entries = parsedData.profitClosingEntries ?? [];
    const totalClosed = entries.reduce((s, e) => s + e.amount, 0);
    const targetProfit = Math.abs(netProfit);
    const variance = targetProfit > 0 ? Math.abs(totalClosed - targetProfit) / targetProfit : 0;
    const found = entries.length > 0;

    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H6 — Profit transferred to Capital / Reserves</h3>
          <BackupTable rows={[
            ['P&L Net Profit (BS-preferred)',              fmt(targetProfit)],
            ['Closing entries found in DayBook',           entries.length.toString(),
              found ? 'good' : 'bad'],
            ['Total amount transferred (sum of P&L legs)', fmt(totalClosed)],
            ['Difference vs P&L Net Profit',               fmt(Math.abs(totalClosed - targetProfit))],
            ['Relative variance',                          targetProfit > 0 ? pct(variance) : '—',
              targetProfit > 0 ? (variance < 0.05 ? 'good' : 'bad') : undefined],
            ['Status',
              targetProfit === 0 ? 'No P&L profit — nothing to transfer'
              : !found ? '✗ No P&L → Capital closing entry found'
              : variance < 0.005 ? '✓ Match — books finalised correctly'
              : variance < 0.05  ? '⚠ Within 5% but not exact'
                                 : '⚠ Closing amount differs from Net Profit',
              targetProfit === 0 ? undefined
              : !found ? 'bad'
              : (variance < 0.05 ? 'good' : 'bad')],
          ]} />
        </section>

        {entries.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>
              Closing journal entries detected
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text3)' }}>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Vch No.</th>
                  <th className="px-2 py-2 font-medium">P&amp;L leg</th>
                  <th className="px-2 py-2 font-medium">Capital leg</th>
                  <th className="px-2 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-2 py-2" style={{ color: 'var(--text2)' }}>{e.date || '—'}</td>
                    <td className="px-2 py-2 font-mono" style={{ color: 'var(--text2)' }}>{e.vno || '—'}</td>
                    <td className="px-2 py-2" style={{ color: 'var(--text2)' }}>{e.plLedger}</td>
                    <td className="px-2 py-2" style={{ color: 'var(--text2)' }}>{e.capitalLedger}</td>
                    <td className="px-2 py-2 text-right font-mono" style={{ color: 'var(--text1)' }}>{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          At period end, P&amp;L Net Profit must be transferred to the Capital account
          (or Reserves &amp; Surplus / Retained Earnings) via a closing Journal entry:
          <strong> Dr P&amp;L A/c</strong>, <strong>Cr Capital / Reserves</strong>.  Without
          this entry the books aren&apos;t finalised — the BS won&apos;t reflect the year&apos;s
          profit in equity, and the next period&apos;s opening balances will be wrong.
          Detection looks for any voucher whose legs include both a P&amp;L-style ledger
          (&ldquo;profit &amp; loss&rdquo;, &ldquo;p&amp;l&rdquo;) AND a Capital-style ledger
          (&ldquo;capital&rdquo;, &ldquo;reserves&rdquo;, &ldquo;retained earnings&rdquo;,
          &ldquo;proprietor&rdquo;).
        </p>
      </div>
    );
  }

  // H7 — DayBook sales total ≈ P&L revenue
  if (checkId === 'H7') {
    const dbSalesNet = dbSales - outputGST;
    const variance = revenue !== 0 ? Math.abs(dbSalesNet - revenue) / Math.abs(revenue) : 0;
    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H7 — DayBook sales (GST-exclusive) ≈ P&amp;L revenue</h3>
          <BackupTable rows={[
            ['DayBook sales (gross, includes Output GST)',  fmt(dbSales)],
            ['Less: Output GST collected',                  fmt(outputGST)],
            ['DayBook sales net of GST (taxable value)',    fmt(dbSalesNet), 'good'],
            ['P&L revenue (group-level, GST-exclusive)',    fmt(revenue)],
            ['Absolute variance',                           fmt(Math.abs(dbSalesNet - revenue))],
            ['Relative variance',                           revenue !== 0 ? pct(variance) : '—',
              revenue !== 0 ? (variance < 0.05 ? 'good' : 'bad') : undefined],
            ['Status',
              revenue === 0   ? 'P&L revenue not extracted'
              : variance < 0.05 ? '✓ Within 5%'
                                : '⚠ Variance > 5%',
              revenue === 0 ? undefined : (variance < 0.05 ? 'good' : 'bad')],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            Sales vouchers in the DayBook carry gross amounts (taxable value + Output GST,
            since GST is collected as part of the party-side amount).  Tally&apos;s P&amp;L
            revenue row is GST-exclusive — Output GST sits in a separate Duties &amp; Taxes
            liability ledger, not income.  To compare apples-to-apples we subtract Output
            GST from the DayBook side so both figures represent the same taxable-value
            magnitude.  Any remaining variance is a real audit signal: sales returns not
            netted, missing revenue ledgers (e.g. service income posted outside the
            &ldquo;Sales&rdquo; voucher type), or period cut-off between voucher dates and
            P&amp;L recognition.
          </p>
        </section>
      </div>
    );
  }

  // H8 — Month-wise voucher volume
  if (checkId === 'H8') {
    const rows: Array<[string, string, RowState?]> = Object.entries(monthCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => [month, count.toLocaleString('en-IN'), undefined as RowState]);
    const vals = Object.values(monthCounts);
    const total = vals.reduce((a, b) => a + b, 0);
    const monthAvg = vals.length > 0 ? total / vals.length : 0;
    const monthMax = vals.length > 0 ? Math.max(...vals) : 0;
    const spike = monthAvg > 0 ? monthMax / monthAvg : 0;
    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>H8 — Voucher count by month</h3>
          <BackupTable rows={rows} />
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>Spike detection</h3>
          <BackupTable rows={[
            ['Total vouchers',           total.toLocaleString('en-IN')],
            ['Distinct months',          vals.length.toString()],
            ['Average per active month', monthAvg.toFixed(1)],
            ['Peak month volume',        monthMax.toLocaleString('en-IN')],
            ['Spike ratio (peak ÷ avg)', spike.toFixed(2) + '×',
              monthAvg === 0 ? undefined : (spike < 3 ? 'good' : 'bad')],
            ['Status',
              vals.length < 3 ? 'Need ≥3 months for spike detection'
              : spike < 3      ? '✓ Volumes spread'
                               : '⚠ Spike ≥3× average',
              vals.length < 3 ? undefined : (spike < 3 ? 'good' : 'bad')],
          ]} />
          <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
            A peak ≥3× the active-month average typically indicates back-dated bulk entry
            (e.g. all of December entered in March before filing).  Sparse-books companies
            with &lt;3 active months can&apos;t be evaluated this way — the engine marks them
            as pass with a sparse-books note.
          </p>
        </section>
      </div>
    );
  }

  return (
    <p className="text-sm" style={{ color: 'var(--text3)' }}>
      No structured backup available for {checkId || 'this check'}.
    </p>
  );
}

// ── Shared little table ───────────────────────────────────────────────────

type RowState = 'good' | 'bad' | undefined;

function BackupTable({ rows }: { rows: Array<[string, string, RowState?]> }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(([k, v, st], i) => (
          <tr key={i} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--border)' }}>
            <td className="px-2 py-2" style={{ color: 'var(--text2)' }}>{k}</td>
            <td
              className="px-2 py-2 text-right font-mono"
              style={{ color: st === 'good' ? 'var(--teal)' : st === 'bad' ? 'var(--red)' : 'var(--text1)' }}
            >
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
