'use client';

import { useApp } from '@/lib/state';
import { generateHealthSignals } from '@/lib/health';
import type { HealthSignal } from '@/lib/types';

export default function HealthView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, files } = state;

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Run analysis first.{' '}
          <button
            className="underline"
            style={{ color: 'var(--teal)' }}
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
          >
            Upload files
          </button>
        </p>
      </div>
    );
  }

  const dbStats = files.daybook.chunkedStats ?? null;
  const signals = generateHealthSignals(parsedData, dbStats);

  if (signals.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          No financial data available. Upload Trial Balance, P&L, and Balance Sheet for health signals.
        </p>
      </div>
    );
  }

  // Group by category
  const categories = [...new Set(signals.map(s => s.category))];

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      <h1
        className="text-2xl mb-1"
        style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
      >
        Financial Health
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text3)' }}>
        Key financial metrics derived from uploaded reports
      </p>

      <div className="space-y-5">
        {categories.map(cat => {
          const catSignals = signals.filter(s => s.category === cat);
          return (
            <section key={cat}>
              <h2
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--text3)' }}
              >
                {cat}
              </h2>
              <div
                className="rounded-xl border overflow-hidden divide-y"
                style={{
                  background: 'var(--bg2)',
                  borderColor: 'var(--border)',
                  // @ts-ignore
                  '--tw-divide-opacity': 1,
                }}
              >
                {catSignals.map((sig, i) => (
                  <SignalRow key={i} signal={sig} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: HealthSignal }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--text2)' }}>{signal.signal}</div>
        {signal.note && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{signal.note}</div>
        )}
      </div>
      <div
        className="text-sm font-medium font-mono shrink-0"
        style={{ color: 'var(--text1)' }}
      >
        {signal.value}
      </div>
    </div>
  );
}
