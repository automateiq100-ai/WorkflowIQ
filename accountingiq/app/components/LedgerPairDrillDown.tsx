'use client';

import { useEffect, useMemo, useState } from 'react';

interface Props {
  title: string;
  pairs: Array<[string, string]>;
  onClose: () => void;
}

function toCSV(rows: Array<[string, string]>): string {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ['Ledger A,Ledger B']
    .concat(rows.map(([a, b]) => `${escape(a)},${escape(b)}`))
    .join('\n');
}

export default function LedgerPairDrillDown({ title, pairs, onClose }: Props) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return pairs;
    const q = query.toLowerCase();
    return pairs.filter(([a, b]) =>
      a.toLowerCase().includes(q) || b.toLowerCase().includes(q),
    );
  }, [pairs, query]);

  function handleDownload() {
    const csv = toCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${filtered.length}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

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
              {pairs.length === 0
                ? 'No near-duplicate ledger pairs detected'
                : `${filtered.length}${filtered.length !== pairs.length ? ` of ${pairs.length}` : ''} pair${filtered.length === 1 ? '' : 's'}`}
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
            >×</button>
          </div>
        </div>

        {/* Search */}
        {pairs.length > 0 && (
          <div className="px-5 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter by ledger name…"
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
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text3)' }}>
                {pairs.length === 0
                  ? 'No near-duplicate ledger pairs detected.'
                  : 'No pairs match the current filter.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead
                className="sticky top-0"
                style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}
              >
                <tr style={{ color: 'var(--text3)' }}>
                  <th className="text-left px-4 py-2 font-medium">Ledger A</th>
                  <th className="text-center px-4 py-2 font-medium" style={{ width: '40px' }}>↔</th>
                  <th className="text-left px-4 py-2 font-medium">Ledger B</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(([a, b], i) => (
                  <tr
                    key={`${a}-${b}-${i}`}
                    className="border-t"
                    style={{ borderColor: 'var(--border)', color: 'var(--text1)' }}
                  >
                    <td className="px-4 py-2">{a}</td>
                    <td className="px-4 py-2 text-center" style={{ color: 'var(--text3)' }}>↔</td>
                    <td className="px-4 py-2">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t shrink-0 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
          If any pair listed here represents the same real-world account, merge the duplicate
          ledger in Tally (Gateway → Alter → Ledger → Master, then re-target entries to the
          surviving ledger).
        </div>
      </div>
    </div>
  );
}
