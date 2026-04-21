'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/lib/state';
import type { TBLedger, ParsedData, ChunkedStats } from '@/lib/types';
import AgentFixView from '@/app/views/AgentFixView';

// ── Bill parser ────────────────────────────────────────────────────────────

interface Bill {
  party: string;
  billRef: string;
  amount: number;
  dueDate: string;
  overdue: boolean;
  type: 'receivable' | 'payable';
}

function parseBills(xml: string, type: 'receivable' | 'payable'): Bill[] {
  const bills: Bill[] = [];
  // Match each DSPBILLDETAILS block
  const blockRe = /<DSPBILLDETAILS[^>]*>([\s\S]*?)<\/DSPBILLDETAILS>/gi;
  let block;
  while ((block = blockRe.exec(xml)) !== null) {
    const inner = block[1];
    const party   = inner.match(/<DSPBILLPARTY[^>]*>\s*([\s\S]*?)\s*<\/DSPBILLPARTY>/i)?.[1]?.trim() ?? '';
    const ref     = inner.match(/<DSPBILLREF[^>]*>\s*([\s\S]*?)\s*<\/DSPBILLREF>/i)?.[1]?.trim() ?? '';
    const amtStr  = inner.match(/<DSPBILLFINAL[^>]*>\s*([\s\S]*?)\s*<\/DSPBILLFINAL>/i)?.[1]?.trim() ?? '0';
    const dueStr  = inner.match(/<DSPBILLDUE[^>]*>\s*([\s\S]*?)\s*<\/DSPBILLDUE>/i)?.[1]?.trim() ?? '';
    const overdueStr = inner.match(/<DSPBILLOVERDUE[^>]*>\s*([\s\S]*?)\s*<\/DSPBILLOVERDUE>/i)?.[1]?.trim() ?? '';

    const amount = parseFloat(amtStr.replace(/,/g, '')) || 0;
    const overdue = overdueStr.toLowerCase() === 'yes' || overdueStr === '1' || parseInt(overdueStr) > 0;

    if (party || ref) {
      bills.push({ party, billRef: ref, amount: Math.abs(amount), dueDate: dueStr, overdue, type });
    }
  }
  return bills;
}

function formatAmount(n: number): string {
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string): string {
  if (!d || d.length < 8) return d || '—';
  // YYYYMMDD → DD Mon YYYY
  const y = d.slice(0, 4), m = d.slice(4, 6), day = d.slice(6, 8);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = parseInt(m, 10) - 1;
  return `${day} ${months[mi] ?? m} ${y}`;
}

// ── Tab types ──────────────────────────────────────────────────────────────

type Tab = 'tb' | 'pl' | 'bs' | 'bills' | 'daybook' | 'fix';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'tb',      label: 'Trial Balance',  icon: '⊟' },
  { id: 'pl',      label: 'P&L',            icon: '◈' },
  { id: 'bs',      label: 'Balance Sheet',  icon: '▤' },
  { id: 'bills',   label: 'Bills',          icon: '⊞' },
  { id: 'daybook', label: 'DayBook Stats',  icon: '▦' },
  { id: 'fix',     label: 'Fix Plan',       icon: '⚑' },
];

// ── Trial Balance tab ──────────────────────────────────────────────────────

type SortKey = 'name' | 'closing' | 'dr';
type SortDir = 'asc' | 'desc';

function TBTab({ ledgers, failedChecks }: {
  ledgers: TBLedger[];
  failedChecks: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('closing');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState<'all' | 'flagged' | 'dr' | 'cr'>('all');

  // Build flag set from check context
  const suspenseNames = useMemo(() => {
    const s = new Set<string>();
    // We flag "suspense" pattern names
    ledgers.forEach(l => {
      if (/suspense|misc\b|sundry|differ/i.test(l.nl)) s.add(l.name);
    });
    return s;
  }, [ledgers]);

  const zeroNames = useMemo(() => new Set(ledgers.filter(l => l.closing === 0).map(l => l.name)), [ledgers]);

  function isFlagged(l: TBLedger): string | null {
    if (suspenseNames.has(l.name)) return 'Suspense';
    if (zeroNames.has(l.name) && l.closing === 0) return 'Zero balance';
    return null;
  }

  const filtered = useMemo(() => {
    let rows = ledgers;
    if (search) rows = rows.filter(l => l.name.toLowerCase().includes(search.toLowerCase()));
    if (filter === 'flagged') rows = rows.filter(l => isFlagged(l));
    if (filter === 'dr') rows = rows.filter(l => l.dr);
    if (filter === 'cr') rows = rows.filter(l => !l.dr);
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'closing') cmp = Math.abs(a.closing) - Math.abs(b.closing);
      else if (sortKey === 'dr') cmp = (a.dr ? 1 : 0) - (b.dr ? 1 : 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgers, search, sortKey, sortDir, filter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const drTotal = ledgers.filter(l => l.dr).reduce((s, l) => s + l.closing, 0);
  const crTotal = ledgers.filter(l => !l.dr).reduce((s, l) => s + Math.abs(l.closing), 0);
  const diff = drTotal - crTotal;

  const SortBtn = ({ k }: { k: SortKey }) => (
    <button onClick={() => toggleSort(k)} style={{ marginLeft: 4, fontSize: 10, color: 'var(--text3)', cursor: 'pointer' }}>
      {sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Totals bar */}
      <div className="flex gap-4 flex-wrap">
        {[
          { label: 'Total Dr', value: drTotal, color: 'var(--teal)' },
          { label: 'Total Cr', value: crTotal, color: 'var(--coral)' },
          { label: 'Difference', value: diff, color: Math.abs(diff) < 1 ? 'var(--green)' : 'var(--red)' },
          { label: 'Ledgers', value: ledgers.length, color: 'var(--text2)', raw: true },
        ].map(s => (
          <div key={s.label} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg3)', minWidth: 120 }}>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>{s.label}</div>
            <div className="text-sm font-semibold" style={{ color: s.color }}>
              {'raw' in s ? s.value : formatAmount(s.value as number)}
            </div>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search ledger…"
          className="px-3 py-1.5 rounded-lg text-sm flex-1"
          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)', minWidth: 180, outline: 'none' }}
        />
        {(['all','flagged','dr','cr'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: filter === f ? 'var(--teal)' : 'var(--bg3)',
              color: filter === f ? '#000' : 'var(--text2)',
              border: '1px solid var(--border)',
            }}
          >
            {f === 'all' ? 'All' : f === 'flagged' ? '⚑ Flagged' : f.toUpperCase()}
          </button>
        ))}
        <span className="text-xs self-center" style={{ color: 'var(--text3)' }}>{filtered.length} rows</span>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)', maxHeight: 480 }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th className="px-3 py-2 text-left text-xs" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                Ledger Name <SortBtn k="name" />
              </th>
              <th className="px-3 py-2 text-right text-xs" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                Closing Balance <SortBtn k="closing" />
              </th>
              <th className="px-3 py-2 text-center text-xs" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                Dr/Cr <SortBtn k="dr" />
              </th>
              <th className="px-3 py-2 text-left text-xs" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                Flag
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l, i) => {
              const flag = isFlagged(l);
              return (
                <tr key={l.name + i}
                  style={{ background: flag ? 'rgba(251,191,36,0.06)' : i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}
                >
                  <td className="px-3 py-1.5" style={{ color: 'var(--text1)' }}>{l.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs" style={{ color: l.dr ? 'var(--teal)' : 'var(--coral)' }}>
                    {formatAmount(Math.abs(l.closing))}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: l.dr ? 'rgba(20,184,166,0.12)' : 'rgba(251,146,60,0.12)', color: l.dr ? 'var(--teal)' : 'var(--coral)' }}>
                      {l.dr ? 'Dr' : 'Cr'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {flag && (
                      <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'rgba(251,191,36,0.15)', color: 'var(--amber)' }}>
                        ⚑ {flag}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>No ledgers match</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── P&L tab ────────────────────────────────────────────────────────────────

function PLTab({ pd }: { pd: Record<string, unknown> }) {
  const revenue    = (pd.revenue as number) ?? 0;
  const expenses   = (pd.expenses as number) ?? 0;
  const netProfit  = (pd.netProfit as number) ?? 0;
  const bsNet      = pd.bsNetProfit as number | null;
  const dep        = (pd.depAmt as number) ?? 0;
  const openStock  = (pd.openingStock as number) ?? 0;
  const closeStock = (pd.closingStock as number) ?? 0;
  const gstOut     = (pd.outputGSTAmt as number) ?? 0;
  const gstIn      = (pd.inputITCAmt as number) ?? 0;
  const margin     = revenue > 0 ? ((netProfit / revenue) * 100) : null;

  const rows: [string, number | null, string?][] = [
    ['Revenue / Turnover', revenue, 'var(--teal)'],
    ['Total Expenses', expenses, 'var(--coral)'],
    ['Net Profit (P&L derived)', netProfit, netProfit >= 0 ? 'var(--green)' : 'var(--red)'],
    ['Net Profit (Balance Sheet)', bsNet, bsNet != null ? (bsNet >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)'],
    ['Depreciation', dep, 'var(--text2)'],
    ['Opening Stock', openStock, 'var(--text2)'],
    ['Closing Stock', closeStock, 'var(--text2)'],
    ['GST Output Tax', gstOut, 'var(--text2)'],
    ['GST Input ITC', gstIn, 'var(--text2)'],
  ];

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {margin !== null && (
        <div className="px-4 py-3 rounded-lg" style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>Net Profit Margin</div>
          <div className="text-2xl font-bold" style={{ color: margin >= 0 ? 'var(--teal)' : 'var(--red)' }}>
            {margin.toFixed(1)}%
          </div>
        </div>
      )}
      <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--bg3)' }}>
            <tr>
              <th className="px-4 py-2 text-left text-xs" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Line Item</th>
              <th className="px-4 py-2 text-right text-xs" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, val, color], i) => (
              <tr key={label} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>{label}</td>
                <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: color ?? 'var(--text1)' }}>
                  {val != null ? formatAmount(val) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Balance Sheet tab ──────────────────────────────────────────────────────

function BSTab({ pd }: { pd: Record<string, unknown> }) {
  const ca      = (pd.ca as number) ?? 0;
  const cl      = (pd.cl as number) ?? 0;
  const bankBal = (pd.bankBal as number) ?? 0;
  const debtors = (pd.debtorBal as number) ?? 0;
  const creds   = (pd.creditorBal as number) ?? 0;
  const fa      = (pd.fixedAssets as number) ?? 0;
  const bsNet   = pd.bsNetProfit as number | null;
  const currentRatio = cl !== 0 ? ca / Math.abs(cl) : null;

  const sections = [
    {
      title: 'Assets',
      rows: [
        ['Fixed Assets', fa, 'var(--blue)'],
        ['Current Assets', ca, 'var(--teal)'],
        ['Debtors / Receivables', debtors, 'var(--text2)'],
        ['Bank & Cash Balance', bankBal, 'var(--green)'],
      ] as [string, number, string][],
    },
    {
      title: 'Liabilities',
      rows: [
        ['Current Liabilities', cl, 'var(--coral)'],
        ['Creditors / Payables', creds, 'var(--text2)'],
        ['Net Profit (BS)', bsNet ?? 0, bsNet != null ? (bsNet >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)'],
      ] as [string, number, string][],
    },
  ];

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {currentRatio !== null && (
        <div className="flex gap-3">
          <div className="px-4 py-3 rounded-lg flex-1" style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>Current Ratio</div>
            <div className="text-2xl font-bold" style={{ color: currentRatio >= 1.5 ? 'var(--teal)' : currentRatio >= 1 ? 'var(--amber)' : 'var(--red)' }}>
              {currentRatio.toFixed(2)}x
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>Ideal: ≥ 1.5</div>
          </div>
        </div>
      )}
      {sections.map(sec => (
        <div key={sec.title}>
          <div className="text-xs font-semibold px-1 mb-1" style={{ color: 'var(--text3)' }}>{sec.title.toUpperCase()}</div>
          <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {sec.rows.map(([label, val, color], i) => (
                  <tr key={label} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                    <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>{label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs" style={{ color }}>
                      {formatAmount(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Bills tab ──────────────────────────────────────────────────────────────

function BillsTab({ billsXml, payablesXml }: { billsXml: string | null; payablesXml: string | null }) {
  const [view, setView] = useState<'receivable' | 'payable' | 'all'>('all');

  const allBills = useMemo(() => {
    const b: Bill[] = [];
    if (billsXml) b.push(...parseBills(billsXml, 'receivable'));
    if (payablesXml) b.push(...parseBills(payablesXml, 'payable'));
    return b.sort((a, b2) => b2.amount - a.amount);
  }, [billsXml, payablesXml]);

  const shown = view === 'all' ? allBills : allBills.filter(b => b.type === view);
  const overdueCount = shown.filter(b => b.overdue).length;
  const totalAmt = shown.reduce((s, b) => s + b.amount, 0);

  if (!billsXml && !payablesXml) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: 'var(--text3)' }}>
        <div className="text-center">
          <div className="text-2xl mb-2">⊞</div>
          <div className="text-sm">Bills Receivable and Bills Payable files not uploaded.</div>
          <div className="text-xs mt-1">Upload them in the Upload Files view to see bills data.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Summary */}
      <div className="flex gap-4 flex-wrap">
        {[
          { label: 'Total Bills', value: shown.length, raw: true, color: 'var(--text1)' },
          { label: 'Total Amount', value: totalAmt, color: 'var(--teal)' },
          { label: 'Overdue', value: overdueCount, raw: true, color: overdueCount > 0 ? 'var(--red)' : 'var(--green)' },
        ].map(s => (
          <div key={s.label} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg3)', minWidth: 120 }}>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>{s.label}</div>
            <div className="text-sm font-semibold" style={{ color: s.color }}>
              {'raw' in s && s.raw ? s.value : formatAmount(s.value as number)}
            </div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all','receivable','payable'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: view === v ? 'var(--teal)' : 'var(--bg3)',
              color: view === v ? '#000' : 'var(--text2)',
              border: '1px solid var(--border)',
            }}
          >
            {v === 'all' ? 'All' : v === 'receivable' ? 'Receivable' : 'Payable'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)', maxHeight: 460 }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
            <tr>
              {['Party','Bill Ref','Amount','Due Date','Type','Status'].map(h => (
                <th key={h} className="px-3 py-2 text-xs text-left" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((b, i) => (
              <tr key={i} style={{ background: b.overdue ? 'rgba(239,68,68,0.05)' : i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                <td className="px-3 py-1.5" style={{ color: 'var(--text1)' }}>{b.party || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs" style={{ color: 'var(--text2)' }}>{b.billRef || '—'}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--text1)' }}>{formatAmount(b.amount)}</td>
                <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--text2)' }}>{b.dueDate ? formatDate(b.dueDate) : '—'}</td>
                <td className="px-3 py-1.5">
                  <span className="px-2 py-0.5 rounded text-xs"
                    style={{ background: b.type === 'receivable' ? 'rgba(20,184,166,0.12)' : 'rgba(251,146,60,0.12)', color: b.type === 'receivable' ? 'var(--teal)' : 'var(--coral)' }}>
                    {b.type === 'receivable' ? 'Recv' : 'Pay'}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  {b.overdue && <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}>Overdue</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>No bills found in the uploaded files</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── DayBook Stats tab ──────────────────────────────────────────────────────

function DayBookTab({ stats }: { stats: ChunkedStats | null }) {
  if (!stats) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: 'var(--text3)' }}>
        <div className="text-center">
          <div className="text-2xl mb-2">▦</div>
          <div className="text-sm">DayBook not analysed yet.</div>
          <div className="text-xs mt-1">Upload DayBook and run analysis to see voucher statistics.</div>
        </div>
      </div>
    );
  }

  const narrationPct = stats.totalVouchers > 0 ? (stats.narrated / stats.totalVouchers * 100) : 0;
  const hvNarPct = stats.highValueCount > 0 ? (stats.highValueNarrated / stats.highValueCount * 100) : 0;

  const metrics: [string, string | number, string?][] = [
    ['Total Vouchers', stats.totalVouchers.toLocaleString('en-IN'), 'var(--text1)'],
    ['Narration Coverage', `${narrationPct.toFixed(1)}%`, narrationPct >= 80 ? 'var(--green)' : narrationPct >= 50 ? 'var(--amber)' : 'var(--red)'],
    ['High Value Entries (>₹1L)', stats.highValueCount.toLocaleString('en-IN'), 'var(--text2)'],
    ['High Value with Narration', `${hvNarPct.toFixed(1)}%`, hvNarPct >= 80 ? 'var(--green)' : 'var(--amber)'],
    ['Missing Voucher Nos', stats.missingVno.toLocaleString('en-IN'), stats.missingVno > 0 ? 'var(--red)' : 'var(--green)'],
    ['Zero Amount Vouchers', stats.zeroAmt.toLocaleString('en-IN'), stats.zeroAmt > 0 ? 'var(--amber)' : 'var(--green)'],
    ['Journal Vouchers', stats.totalJournals.toLocaleString('en-IN'), 'var(--text2)'],
    ['Cash Transactions >₹10k', stats.cashOver10k.toLocaleString('en-IN'), stats.cashOver10k > 0 ? 'var(--amber)' : 'var(--green)'],
    ['Round Amount Vouchers', stats.roundCount.toLocaleString('en-IN'), 'var(--text2)'],
    ['Entries Outside FY', stats.outOfFY.toLocaleString('en-IN'), stats.outOfFY > 0 ? 'var(--red)' : 'var(--green)'],
  ];

  // Monthly breakdown
  const months = Object.entries(stats.monthCounts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const maxMonthCount = Math.max(...months.map(([, c]) => c), 1);

  // Duplicate vouchers
  const dupVnos = Object.entries(stats.dupVnoMap ?? {}).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-6">
      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-2" style={{ maxWidth: 600 }}>
        {metrics.map(([label, val, color]) => (
          <div key={label} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>{label}</div>
            <div className="text-sm font-semibold" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Monthly bar chart */}
      {months.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text3)' }}>MONTHLY VOUCHER DISTRIBUTION</div>
          <div className="flex flex-col gap-1.5" style={{ maxWidth: 600 }}>
            {months.map(([month, count]) => (
              <div key={month} className="flex items-center gap-3">
                <div className="text-xs font-mono w-16 text-right shrink-0" style={{ color: 'var(--text3)' }}>{month}</div>
                <div className="flex-1 rounded-full overflow-hidden" style={{ background: 'var(--bg3)', height: 16 }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(count / maxMonthCount) * 100}%`, background: 'var(--teal)' }}
                  />
                </div>
                <div className="text-xs w-14 font-mono" style={{ color: 'var(--text2)' }}>{count.toLocaleString('en-IN')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate voucher numbers */}
      {dupVnos.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--red)' }}>⚑ DUPLICATE VOUCHER NUMBERS ({dupVnos.length})</div>
          <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)', maxHeight: 220 }}>
            <table className="text-sm" style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 400 }}>
              <thead style={{ background: 'var(--bg3)' }}>
                <tr>
                  <th className="px-3 py-2 text-left text-xs" style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>Voucher No</th>
                  <th className="px-3 py-2 text-right text-xs" style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {dupVnos.slice(0, 50).map(([vno, count], i) => (
                  <tr key={vno} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                    <td className="px-3 py-1.5 font-mono text-xs" style={{ color: 'var(--text2)' }}>{vno}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--amber)' }}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main DataView ──────────────────────────────────────────────────────────

export default function DataView() {
  const { state, dispatch } = useApp();
  const { parsedData, results, files, analysed } = state;
  const [activeTab, setActiveTab] = useState<Tab>('tb');

  const failedCheckIds = useMemo(() => {
    if (!results) return new Set<string>();
    return new Set(results.checks.filter(c => c.status === 'fail' || c.status === 'partial').map(c => c.id));
  }, [results]);

  if (!analysed) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-24">
        <div style={{ fontSize: 40, opacity: 0.3 }}>⊟</div>
        <div className="text-sm" style={{ color: 'var(--text3)' }}>Run analysis first to view the data tables.</div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          Go to Upload
        </button>
      </div>
    );
  }

  const pd = parsedData as Partial<ParsedData>;
  const tbLedgers: TBLedger[] = pd.tbLedgers ?? [];
  const pdRaw = pd as Record<string, unknown>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text1)' }}>Data View</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
          Explore parsed Tally data in tabular form. {tbLedgers.length} ledgers loaded.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-lg transition-all"
            style={{
              background: activeTab === t.id ? 'var(--bg4)' : 'transparent',
              color: activeTab === t.id ? 'var(--teal)' : 'var(--text2)',
              borderBottom: activeTab === t.id ? '2px solid var(--teal)' : '2px solid transparent',
            }}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === 'tb' && (
          <TBTab ledgers={tbLedgers} failedChecks={failedCheckIds} />
        )}
        {activeTab === 'pl' && <PLTab pd={pdRaw} />}
        {activeTab === 'bs' && <BSTab pd={pdRaw} />}
        {activeTab === 'bills' && (
          <BillsTab
            billsXml={files.bills.content}
            payablesXml={files.payables.content}
          />
        )}
        {activeTab === 'daybook' && (
          <DayBookTab stats={files.daybook.chunkedStats} />
        )}
        {activeTab === 'fix' && <AgentFixView embedded />}
      </div>
    </div>
  );
}
