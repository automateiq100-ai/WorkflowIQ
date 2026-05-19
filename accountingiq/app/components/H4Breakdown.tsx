'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TBLedger, MasterEntry, ParsedStatement, ChunkedStats } from '@/lib/types';
import { classifyLedger, type LedgerCategory } from '@/lib/tally-groups';
import type { OverrideMap } from '@/lib/ledger-overrides';
import { buildH4Context, computeDBCashBankFlow } from '@/lib/h4-flow';
import VoucherDrillDown from './VoucherDrillDown';

interface Props {
  tbLedgers: TBLedger[];
  masterEntries: MasterEntry[];
  bsStatement: ParsedStatement | undefined;
  ledgerOverrides: OverrideMap | undefined;
  dbStats: ChunkedStats | null;
  onClose: () => void;
}

const CASH_BANK_CATEGORIES: ReadonlySet<LedgerCategory> = new Set<LedgerCategory>(['cash', 'bank', 'bank-od']);

// Voucher type names that should be EXCLUDED from the Payments bucket
// even though they classify as payment-semantic at the catalog level.
// Tally ships these as separate voucher types under parent="Payment" —
// they belong in the engine's H4 math (which counts all cash outflows)
// but not in the modal's Payments row, which is meant to mirror Tally's
// "List of Payment Vouchers" UI filter (strict type-name match).
const PAYMENT_EXCLUDED_NAMES = new Set([
  'bank charges entry',
  'salary payment',
  'salary voucher',
  'payroll',
  'expense entry',
]);
const CONTRA_TYPE_NAMES = new Set(['contra', 'cash to bank', 'bank to cash', 'inter bank transfer']);

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000)    return `${sign}${(abs / 100_000).toFixed(2)}L`;
  return `${sign}${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function H4Breakdown({
  tbLedgers, masterEntries, bsStatement, ledgerOverrides, dbStats, onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ctx = useMemo(
    () => buildH4Context(masterEntries, bsStatement, ledgerOverrides),
    [masterEntries, bsStatement, ledgerOverrides],
  );

  // TBLedger values arrive in canonical Dr-positive convention after the
  // parser-side sign normalization (parseTrialBalance applies the flip
  // upstream so every downstream consumer sees the same sign meaning).
  // Cash & bank Dr-asset balances are therefore stored as POSITIVE — we
  // can use them directly for display.
  const tbRows = useMemo(() => {
    return tbLedgers
      .filter(l => CASH_BANK_CATEGORIES.has(classifyLedger(l.name, ctx.masterMap, ctx.ledgerOverrides, ctx.bsHierarchy).category))
      .map(l => ({
        name: l.name,
        opening: l.opening,
        closing: l.closing,
      }))
      .sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
  }, [tbLedgers, ctx]);

  const tbAnyOpening = tbRows.some(r => r.opening !== undefined);
  const tbTotalOpening = tbRows.reduce((s, r) => s + (r.opening ?? 0), 0);
  const tbTotalClosing = tbRows.reduce((s, r) => s + r.closing, 0);
  const tbTotalNet: number | null = tbAnyOpening ? tbTotalClosing - tbTotalOpening : null;

  // DayBook cash/bank flow — same helper the engine's H4 fail message
  // uses, so the modal and the engine never disagree on the numbers.
  const dbAgg = useMemo(() => computeDBCashBankFlow(dbStats?.vouchers, ctx), [dbStats, ctx]);

  const [drill, setDrill] = useState<null | 'receipts' | 'payments' | 'contras'>(null);
  const drillData = drill === 'receipts'
    ? { title: `Receipt vouchers (${dbAgg.rCount})`, vouchers: dbAgg.receiptVouchers }
    : drill === 'payments'
      ? { title: `Payment vouchers (${dbAgg.pCount})`, vouchers: dbAgg.paymentVouchers }
      : drill === 'contras'
        ? { title: `Contra vouchers (${dbAgg.cCount})`, vouchers: dbAgg.contraVouchers }
        : null;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border w-full max-w-5xl max-h-[85vh] flex flex-col"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold mb-0.5 truncate" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              Cash &amp; Bank reconciliation — backup data
            </h2>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              Side-by-side: cash &amp; bank ledger balances from the Trial Balance vs the underlying voucher flow from the DayBook.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none px-2 py-0.5 rounded shrink-0"
            style={{ color: 'var(--text3)' }}
            aria-label="Close"
          >×</button>
        </div>

        <div className="flex-1 overflow-auto grid md:grid-cols-2 gap-px" style={{ background: 'var(--border)' }}>
          <section style={{ background: 'var(--bg2)' }} className="p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text1)' }}>
              Trial Balance — Cash &amp; Bank Ledgers
            </h3>
            {tbRows.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text3)' }}>
                No cash or bank ledgers classified in the Trial Balance.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'var(--text3)' }}>
                    <th className="text-left  px-2 py-1.5 font-medium">Ledger</th>
                    <th className="text-right px-2 py-1.5 font-medium">Opening</th>
                    <th className="text-right px-2 py-1.5 font-medium">Closing</th>
                    <th className="text-right px-2 py-1.5 font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {tbRows.map(r => {
                    const net: number | null = r.opening !== undefined ? r.closing - r.opening : null;
                    return (
                      <tr key={r.name} className="border-t" style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}>
                        <td className="px-2 py-1.5">{r.name}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.opening)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.closing)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}>
                    <td className="px-2 py-2">Total</td>
                    <td className="px-2 py-2 text-right font-mono">{tbAnyOpening ? fmt(tbTotalOpening) : '—'}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmt(tbTotalClosing)}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmt(tbTotalNet)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            {!tbAnyOpening && tbRows.length > 0 && (
              <p className="text-xs mt-3" style={{ color: 'var(--amber)' }}>
                ⚠ This Trial Balance export has no opening balance data — the H4 net-flow check can&apos;t run.
                Re-pull the TB via the Tally bridge (or re-export with <em>F12 → Show Opening Balance = Yes</em>) to populate openings.
              </p>
            )}
          </section>

          <section style={{ background: 'var(--bg2)' }} className="p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text1)' }}>
              DayBook — Cash &amp; Bank Voucher Flow
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text3)' }}>
                  <th className="text-left  px-2 py-1.5 font-medium">Voucher type</th>
                  <th className="text-right px-2 py-1.5 font-medium">Count</th>
                  <th className="text-right px-2 py-1.5 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  className="border-t cursor-pointer transition-colors hover:bg-[var(--bg3)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}
                  onClick={() => dbAgg.rCount > 0 && setDrill('receipts')}
                >
                  <td className="px-2 py-1.5">
                    Receipts (cash in){dbAgg.rCount > 0 && <span style={{ color: 'var(--teal)' }}> →</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{dbAgg.rCount.toLocaleString('en-IN')}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(dbAgg.receipts)}</td>
                </tr>
                <tr
                  className="border-t cursor-pointer transition-colors hover:bg-[var(--bg3)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}
                  onClick={() => dbAgg.pCount > 0 && setDrill('payments')}
                >
                  <td className="px-2 py-1.5">
                    Payments (cash out){dbAgg.pCount > 0 && <span style={{ color: 'var(--teal)' }}> →</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{dbAgg.pCount.toLocaleString('en-IN')}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(dbAgg.payments)}</td>
                </tr>
                <tr
                  className="border-t cursor-pointer transition-colors hover:bg-[var(--bg3)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}
                  onClick={() => dbAgg.cCount > 0 && setDrill('contras')}
                >
                  <td className="px-2 py-1.5">
                    Contras (cash ↔ bank transfers){dbAgg.cCount > 0 && <span style={{ color: 'var(--teal)' }}> →</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{dbAgg.cCount.toLocaleString('en-IN')}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(dbAgg.contras)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}>
                  <td className="px-2 py-2">Net flow (Receipts − Payments)</td>
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(dbAgg.net)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="text-xs mt-3" style={{ color: 'var(--text3)' }}>
              Contras net to zero in the flow — one leg in, one leg out on cash/bank ledgers.
            </p>
          </section>
        </div>

        <div className="px-5 py-3 border-t shrink-0 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
          H4 passes when <strong style={{ color: 'var(--text2)' }}>Net flow (DayBook)</strong> matches{' '}
          <strong style={{ color: 'var(--text2)' }}>Total Net (Trial Balance)</strong> within ₹100.
          When the Trial Balance has no openings, the check is reported as uncertain rather than failed.
          {' '}Click any DayBook row to see the underlying vouchers.
        </div>
      </div>
    </div>
    {drillData && (
      <VoucherDrillDown
        title={drillData.title}
        vouchers={drillData.vouchers}
        onClose={() => setDrill(null)}
      />
    )}
    </>
  );
}
