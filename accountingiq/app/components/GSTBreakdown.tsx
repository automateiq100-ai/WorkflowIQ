'use client';

import { useEffect } from 'react';
import type { ParsedData } from '@/lib/types';

interface Props {
  working: NonNullable<ParsedData['gstWorking']>;
  onClose: () => void;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n === 0) return '₹0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

export default function GSTBreakdown({ working, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { sales, effectiveRate, headlineRate, expectedGST, recordedGST, variance, source } = working;
  const diff = recordedGST - expectedGST;
  const over = diff > 0;
  const fromVouchers = source === 'vouchers';

  // Each working line: label, value, and an optional sub-note.
  const rows: Array<{ label: string; value: string; note?: string; strong?: boolean; tone?: 'plain' | 'expected' | 'recorded' | 'variance' }> = [
    { label: 'Taxable sales (GST-exclusive)', value: fmt(sales), note: 'From P&L revenue, or TB sales aggregate', tone: 'plain' },
    { label: 'Nearest GST slab applied', value: pct(headlineRate), note: `Effective rate = ${pct(effectiveRate)} (recorded GST ÷ sales), snapped to the nearest Indian slab (5 / 12 / 18 / 28%)`, tone: 'plain' },
    { label: 'Expected output GST = sales × slab', value: fmt(expectedGST), strong: true, tone: 'expected' },
    {
      label: 'Recorded output GST',
      value: fmt(recordedGST),
      note: fromVouchers
        ? 'GST actually charged on sales-voucher tax legs this period (Cr in sales, less Dr in credit notes)'
        : '⚠ Fallback: accumulated GST-payable closing balance from the Trial Balance (carried forward across periods) — no sales-voucher tax legs found. Pull the Day Book to get the period figure.',
      strong: true,
      tone: 'recorded',
    },
    { label: `Variance (${over ? 'over' : 'under'}-recorded)`, value: `${fmt(Math.abs(diff))}  ·  ${pct(variance)}`, strong: true, tone: 'variance' },
  ];

  const toneColor = (t?: string) =>
    t === 'expected' ? 'var(--teal)' : t === 'recorded' ? 'var(--text1)' : t === 'variance' ? (over ? 'var(--amber)' : 'var(--red)') : 'var(--text1)';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold mb-0.5 truncate" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              Output GST reconciliation — working
            </h2>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              How the expected output GST is derived and compared against what&apos;s recorded in the books.
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
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-1 py-3 align-top" style={{ color: 'var(--text2)' }}>
                    <div style={{ color: 'var(--text1)', fontWeight: r.strong ? 600 : 400 }}>{r.label}</div>
                    {r.note && <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>{r.note}</div>}
                  </td>
                  <td
                    className="px-1 py-3 text-right font-mono align-top whitespace-nowrap"
                    style={{ color: toneColor(r.tone), fontWeight: r.strong ? 700 : 400, fontSize: r.strong ? '1rem' : undefined }}
                  >
                    {r.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t shrink-0 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
          Assumption: Tally&apos;s Sales ledger holds the <strong style={{ color: 'var(--text2)' }}>taxable value</strong> (GST-exclusive), with output
          GST in a separate ledger — so expected GST = <strong style={{ color: 'var(--text2)' }}>sales × slab</strong>.
          The slab is snapped to the nearest of 5 / 12 / 18 / 28%, which can over/understate for genuinely multi-rate businesses.
          E2b passes under 5% variance, partial under 15%, fails above.
        </div>
      </div>
    </div>
  );
}
