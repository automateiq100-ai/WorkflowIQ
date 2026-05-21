'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Voucher } from '@/lib/types';
import type { DrillDownExtraColumn } from '@/lib/voucher-filters';

interface Props {
  title: string;
  vouchers: Voucher[];
  /** Extra columns to render after Narration (e.g. "Suggested Type" for
   *  the wrong-type drill-down). */
  extraColumns?: DrillDownExtraColumn[];
  onClose: () => void;
}

/** Header label + per-voucher accessor for each known extra column. */
const EXTRA_COLUMN_DEFS: Record<DrillDownExtraColumn, { header: string; get: (v: Voucher) => string }> = {
  suggestedType: {
    header: 'Should be',
    get: v => v.suggestedType ?? '—',
  },
};

const ROW_CAP = 1000;

function fmtAmount(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Tally dates land as YYYYMMDD strings; pretty-print as DD-MM-YYYY. */
function fmtDate(s: string): string {
  if (!s || s.length < 8) return s;
  return `${s.slice(6, 8)}-${s.slice(4, 6)}-${s.slice(0, 4)}`;
}

function toCSV(rows: Voucher[], extras: DrillDownExtraColumn[]): string {
  const header = [
    'Date', 'Voucher No.', 'Type', 'Party', 'Amount', 'Narration',
    ...extras.map(k => EXTRA_COLUMN_DEFS[k].header),
  ].join(',');
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = rows.map(v => [
    escape(fmtDate(v.date)),
    escape(v.vno),
    escape(v.type),
    escape(v.party),
    String(v.amount),
    escape(v.narration),
    ...extras.map(k => escape(EXTRA_COLUMN_DEFS[k].get(v))),
  ].join(','));
  return [header, ...lines].join('\n');
}

export default function VoucherDrillDown({ title, vouchers, extraColumns, onClose }: Props) {
  const extras = extraColumns ?? [];
  const [query, setQuery] = useState('');

  // ESC closes the modal — standard expectation for an overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return vouchers;
    const q = query.toLowerCase();
    return vouchers.filter(v =>
      v.vno.toLowerCase().includes(q) ||
      v.party.toLowerCase().includes(q) ||
      v.type.toLowerCase().includes(q) ||
      v.narration.toLowerCase().includes(q) ||
      String(v.amount).includes(q),
    );
  }, [vouchers, query]);

  const display = filtered.slice(0, ROW_CAP);
  const overflow = filtered.length - display.length;

  function handleDownload() {
    const csv = toCSV(filtered, extras);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${filtered.length}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
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
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="min-w-0">
            <h2
              className="text-lg font-semibold mb-0.5 truncate"
              style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
            >
              {title}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              {vouchers.length === 0
                ? 'No vouchers matched this flag'
                : `${filtered.length}${filtered.length !== vouchers.length ? ` of ${vouchers.length}` : ''} voucher${filtered.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDownload}
              disabled={filtered.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
            >
              ↓ CSV
            </button>
            <button
              onClick={onClose}
              className="text-2xl leading-none px-2 py-0.5 rounded"
              style={{ color: 'var(--text3)' }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Search */}
        {vouchers.length > 0 && (
          <div className="px-5 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter by voucher no., party, type, amount, narration…"
              className="w-full text-sm px-3 py-2 rounded-lg"
              style={{
                background: 'var(--bg3)',
                color: 'var(--text1)',
                border: '1px solid var(--border)',
              }}
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {display.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text3)' }}>
                {vouchers.length === 0
                  ? 'No vouchers triggered this flag.'
                  : 'No vouchers match the current filter.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead
                className="sticky top-0"
                style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}
              >
                <tr style={{ color: 'var(--text3)' }}>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Voucher #</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-left px-4 py-2 font-medium">Party</th>
                  <th className="text-right px-4 py-2 font-medium">Amount (₹)</th>
                  <th className="text-left px-4 py-2 font-medium">Narration</th>
                  {extras.map(k => (
                    <th key={k} className="text-left px-4 py-2 font-medium">
                      {EXTRA_COLUMN_DEFS[k].header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {display.map((v, i) => (
                  <tr
                    key={`${v.date}-${v.vno}-${i}`}
                    className="border-t"
                    style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}
                  >
                    <td className="px-4 py-2 font-mono whitespace-nowrap">{fmtDate(v.date)}</td>
                    <td className="px-4 py-2 font-mono whitespace-nowrap">
                      {v.vno || <span style={{ color: 'var(--red)' }}>(missing)</span>}
                    </td>
                    <td className="px-4 py-2">{v.type}</td>
                    <td className="px-4 py-2">
                      {v.party || <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                      {fmtAmount(v.amount)}
                    </td>
                    <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>
                      {v.narration || <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    {extras.map(k => {
                      const text = EXTRA_COLUMN_DEFS[k].get(v);
                      return (
                        <td
                          key={k}
                          className="px-4 py-2 font-semibold whitespace-nowrap"
                          style={{ color: text === '—' ? 'var(--text3)' : 'var(--teal)' }}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {overflow > 0 && (
            <div
              className="px-5 py-3 text-center text-xs border-t"
              style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
            >
              Showing first {ROW_CAP.toLocaleString('en-IN')} of {filtered.length.toLocaleString('en-IN')} —
              use the search above to narrow, or download the full list as CSV.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
