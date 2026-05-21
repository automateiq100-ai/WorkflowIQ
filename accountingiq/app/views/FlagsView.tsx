'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { generateFlags } from '@/lib/flags';
import { getDrillDown, hasDrillDown, drillLabel } from '@/lib/voucher-filters';
import VoucherDrillDown from '@/app/components/VoucherDrillDown';
import H4Breakdown from '@/app/components/H4Breakdown';
import GSTBreakdown from '@/app/components/GSTBreakdown';
import LedgerPairDrillDown from '@/app/components/LedgerPairDrillDown';
import type { AnomalyFlag } from '@/lib/types';

type Severity = AnomalyFlag['severity'];

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};

// Map severity to badge CSS class
const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'badge-critical',
  high:     'badge-high',
  medium:   'badge-medium',
  low:      'badge-missing',
};

export default function FlagsView() {
  const { state, dispatch } = useApp();
  const { results, parsedData, files } = state;
  const [drillFlag, setDrillFlag] = useState<AnomalyFlag | null>(null);

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
  const flags = generateFlags(results, parsedData, dbStats);

  const grouped = SEVERITY_ORDER.reduce<Record<Severity, AnomalyFlag[]>>(
    (acc, s) => { acc[s] = flags.filter(f => f.severity === s); return acc; },
    { critical: [], high: [], medium: [], low: [] },
  );

  const totalFlags = flags.length;

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      <h1
        className="text-2xl mb-1"
        style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
      >
        Anomaly Flags
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text3)' }}>
        {totalFlags === 0
          ? 'No anomalies detected'
          : `${totalFlags} anomal${totalFlags !== 1 ? 'ies' : 'y'} detected`}
      </p>

      {totalFlags === 0 ? (
        <div
          className="rounded-xl border px-5 py-8 text-center"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          <div className="text-3xl mb-2">✓</div>
          <p className="text-sm" style={{ color: 'var(--teal)' }}>
            No anomalies flagged — books look clean.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {SEVERITY_ORDER.map(severity => {
            const group = grouped[severity];
            if (group.length === 0) return null;
            return (
              <section key={severity}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`${SEVERITY_BADGE[severity]} text-xs px-2 py-0.5 rounded font-semibold`}>
                    {SEVERITY_LABELS[severity]}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    {group.length} flag{group.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div
                  className="rounded-xl border overflow-hidden divide-y"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
                >
                  {group.map(flag => (
                    <FlagRow
                      key={flag.id}
                      flag={flag}
                      drillable={hasDrillDown(flag.id, dbStats, parsedData)}
                      onDrill={() => setDrillFlag(flag)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {drillFlag && drillFlag.id === 'H4' && (
        <H4Breakdown
          tbLedgers={parsedData.tbLedgers ?? []}
          masterEntries={parsedData.masterEntries ?? []}
          bsStatement={parsedData.bsheetStatement}
          ledgerOverrides={state.ledgerOverrides}
          dbStats={dbStats}
          onClose={() => setDrillFlag(null)}
        />
      )}
      {drillFlag && drillFlag.id === 'E2b' && parsedData.gstWorking && (
        <GSTBreakdown working={parsedData.gstWorking} onClose={() => setDrillFlag(null)} />
      )}
      {drillFlag && (drillFlag.id === 'B2' || drillFlag.id === 'G1' || drillFlag.id === 'G2') && (() => {
        // B2 / G1 / G2 all use LedgerPairDrillDown but read from
        // different parsedData fields — see ChecklistView for the
        // canonical routing.
        const pairs =
          drillFlag.id === 'G1' ? (parsedData.partySplitPairs   ?? [])
          : drillFlag.id === 'G2' ? (parsedData.expenseSplitPairs ?? [])
                                  : (parsedData.dupPairDetails    ?? []);
        if (pairs.length === 0) return null;
        return (
          <LedgerPairDrillDown
            title={drillFlag.title}
            pairs={pairs}
            onClose={() => setDrillFlag(null)}
          />
        );
      })()}
      {drillFlag && drillFlag.id !== 'H4' && drillFlag.id !== 'E2b' && drillFlag.id !== 'B2' && drillFlag.id !== 'G1' && drillFlag.id !== 'G2' && (() => {
        const drill = getDrillDown(drillFlag.id, drillFlag.title, dbStats, parsedData);
        if (!drill) return null;
        return (
          <VoucherDrillDown
            title={drill.title}
            vouchers={drill.vouchers}
            extraColumns={drill.extraColumns}
            onClose={() => setDrillFlag(null)}
          />
        );
      })()}
    </div>
  );
}

function FlagRow({
  flag, drillable, onDrill,
}: {
  flag: AnomalyFlag;
  drillable: boolean;
  onDrill: () => void;
}) {
  const Wrapper: 'button' | 'div' = drillable ? 'button' : 'div';
  return (
    <Wrapper
      className={`w-full flex items-start gap-4 px-5 py-3 text-left ${drillable ? 'transition-colors hover:bg-[var(--bg3)] cursor-pointer' : ''}`}
      style={{ borderColor: 'var(--border)' }}
      {...(drillable ? { onClick: onDrill } : {})}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium mb-0.5" style={{ color: 'var(--text1)' }}>
          {flag.title}
        </div>
        <div className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
          {flag.detail}
        </div>
        {drillable && (
          <div className="text-xs mt-1" style={{ color: 'var(--teal)' }}>
            {drillLabel(flag.id)}
          </div>
        )}
      </div>
      {flag.count !== undefined && (
        <div
          className="shrink-0 text-xs font-mono px-2 py-0.5 rounded"
          style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
        >
          ×{flag.count}
        </div>
      )}
    </Wrapper>
  );
}
