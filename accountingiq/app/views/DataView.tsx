'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/lib/state';
import type { TBLedger, TBFullRow, ParsedData, ChunkedStats, PLSection, Voucher, FinancialNode, ParsedStatement, MasterEntry } from '@/lib/types';
import { classifyBSSide, parseMasterMap } from '@/lib/parser';
import { classifyLedger, buildBSHierarchyMap, LEDGER_CATEGORY_OPTIONS, type ClassificationConfidence } from '@/lib/tally-groups';
import { splitDupKey } from '@/lib/voucher-filters';
import { classifyVoucherType } from '@/lib/tally-voucher-types';
import VoucherDrillDown from '@/app/components/VoucherDrillDown';
import AgentFixView from '@/app/views/AgentFixView';
import { parseBills, type Bill } from '@/lib/bills-parser';


function formatAmount(n: number): string {
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// ── Shared classification badge ──────────────────────────────────────────
//
// Reusable across TB / P&L / BS tabs.  Renders the Master Setup category
// for a single ledger as a compact pill; same colour palette as
// MasterSetupView so the user reads the same signal everywhere.
//
// Designed to be cheap — caller passes a pre-built `classMap` and we just
// look up.  Returns null for groups (which don't have a classification of
// their own) and for ledgers absent from the map.

interface ClassMapEntry {
  category: string;
  confidence: ClassificationConfidence;
  label: string;
}
type ClassMap = Map<string, ClassMapEntry>;

const CATEGORY_PALETTE: Record<ClassificationConfidence, { bg: string; fg: string }> = {
  overridden: { bg: 'rgba(45,212,191,0.15)', fg: 'var(--teal)' },
  high:       { bg: 'rgba(34,197,94,0.12)',  fg: 'var(--green)' },
  medium:     { bg: 'rgba(234,179,8,0.12)',  fg: 'var(--amber)' },
  low:        { bg: 'rgba(234,179,8,0.18)',  fg: 'var(--amber)' },
  none:       { bg: 'rgba(239,68,68,0.15)',  fg: 'var(--red)' },
};

function CategoryBadge({ ledgerName, classMap }: { ledgerName: string; classMap: ClassMap | undefined }) {
  if (!classMap) return null;
  const cls = classMap.get(ledgerName);
  if (!cls) return null;
  const palette = CATEGORY_PALETTE[cls.confidence];
  return (
    <span
      className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 whitespace-nowrap inline-block align-middle"
      style={{ background: palette.bg, color: palette.fg }}
      title={`Category: ${cls.label} (${cls.confidence})`}
    >
      {cls.label}
    </span>
  );
}

function formatDate(raw: string): string {
  if (!raw) return '—';
  // Try 'D-Mon-YYYY' or 'DD-Mon-YYYY' (e.g. '1-Apr-2025')
  const m1 = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m1) return `${m1[1].padStart(2,'0')} ${m1[2]} ${m1[3]}`;
  // Try YYYYMMDD
  if (raw.length >= 8 && /^\d{8}/.test(raw)) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const y = raw.slice(0,4), mo = parseInt(raw.slice(4,6),10)-1, day = raw.slice(6,8);
    return `${day} ${months[mo] ?? raw.slice(4,6)} ${y}`;
  }
  return raw;
}

function StrictStatementRow({ node, depth = 0, classMap }: { node: FinancialNode; depth?: number; classMap?: ClassMap }) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const isMain = node.nodeType === 'main';
  const hasVariance = node.childrenBalanced === false;

  return (
    <>
      <tr
        onClick={() => hasChildren && setOpen(v => !v)}
        style={{
          borderBottom: '1px solid var(--border)',
          cursor: hasChildren ? 'pointer' : 'default',
          background: isMain ? 'rgba(255,255,255,0.025)' : 'transparent',
        }}
      >
        <td
          className={isMain ? 'py-2.5 font-semibold' : 'py-1.5 text-xs'}
          style={{
            color: isMain ? 'var(--text1)' : 'var(--text2)',
            paddingLeft: `${1.5 + depth * 1.25}rem`,
            userSelect: 'none',
          }}
        >
          {hasChildren && <span style={{ marginRight: 6, fontSize: 10, color: 'var(--text3)' }}>{open ? '▼' : '▶'}</span>}
          {!hasChildren && <span style={{ display: 'inline-block', width: depth > 0 ? 16 : 0 }} />}
          <span className="align-middle">{node.name}</span>
          {/* Master Setup category — only meaningful on leaves; group
              headers are rollups and don't have a category of their own. */}
          {!hasChildren && <CategoryBadge ledgerName={node.name} classMap={classMap} />}
        </td>
        <td className={isMain ? 'px-6 py-2.5 text-right font-mono font-bold' : 'px-6 py-1.5 text-right font-mono text-xs'} style={{ color: node.amount >= 0 ? 'var(--teal)' : 'var(--coral)' }}>
          <div>{formatAmount(Math.abs(node.amount))}</div>
          {hasVariance && node.childrenTotal != null && node.childrenVariance != null && (
            <div className="text-xs font-normal mt-0.5" style={{ color: 'var(--amber)' }}>
              Child sum {formatAmount(Math.abs(node.childrenTotal))} · Var {formatAmount(Math.abs(node.childrenVariance))}
            </div>
          )}
        </td>
      </tr>
      {open && node.children.map(child => (
        <StrictStatementRow key={child.id} node={child} depth={depth + 1} classMap={classMap} />
      ))}
    </>
  );
}

function StrictStatementTable({
  statement,
  bsNetProfit,
  classMap,
}: {
  statement: ParsedStatement;
  bsNetProfit?: number | null;
  classMap?: ClassMap;
}) {
  // Net profit = algebraic sum of all top-level section amounts.
  // Income sections carry positive (Cr) amounts; expense sections carry negative (Dr) amounts.
  const computedProfit = statement.nodes.reduce((s, n) => s + n.amount, 0);
  const totalIncome    = statement.nodes.filter(n => n.amount > 0).reduce((s, n) => s + n.amount, 0);
  const totalExpenses  = statement.nodes.filter(n => n.amount < 0).reduce((s, n) => s + Math.abs(n.amount), 0);

  // Prefer BS-sourced net profit (Profit & Loss A/c line) when available and non-zero
  const displayProfit  = (bsNetProfit != null && bsNetProfit !== 0) ? bsNetProfit : computedProfit;
  const isProfit       = displayProfit >= 0;
  const profitColor    = isProfit ? 'var(--green)' : 'var(--red)';
  const profitBg       = isProfit ? 'rgba(76,175,121,0.08)' : 'rgba(242,107,91,0.08)';

  // Show a reconciliation note if BS figure differs materially from computed
  const bsDiffers = bsNetProfit != null && bsNetProfit !== 0 &&
    Math.abs(bsNetProfit - computedProfit) > 1;

  return (
    <div className="flex flex-col gap-3 max-w-4xl">
      {/* Summary tiles */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Total Income', value: totalIncome, color: 'var(--teal)' },
          { label: 'Total Expenses', value: totalExpenses, color: 'var(--coral)' },
          { label: isProfit ? 'Net Profit' : 'Net Loss', value: Math.abs(displayProfit), color: profitColor },
        ].map(s => (
          <div key={s.label} className="px-4 py-2.5 rounded-lg flex-1" style={{ background: 'var(--bg3)', minWidth: 140 }}>
            <div className="text-xs mb-0.5" style={{ color: 'var(--text3)' }}>{s.label}</div>
            <div className="text-base font-bold font-mono" style={{ color: s.color }}>{formatAmount(s.value)}</div>
          </div>
        ))}
      </div>

      {bsDiffers && (
        <div className="px-4 py-2 rounded-lg text-xs flex items-center gap-2"
          style={{ background: 'rgba(239,170,30,0.10)', color: 'var(--amber)', border: '1px solid rgba(239,170,30,0.25)' }}>
          <span>⚠</span>
          <span>
            P&amp;L computed profit <strong>{formatAmount(Math.abs(computedProfit))}</strong> differs
            from Balance Sheet P&amp;L A/c <strong>{formatAmount(Math.abs(bsNetProfit!))}</strong>.
            Displaying BS figure.
          </span>
        </div>
      )}

      <div className="overflow-auto rounded-xl border shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', borderBottom: '2px solid var(--border)' }}>
              <th className="px-6 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'var(--text3)', fontWeight: 700 }}>Particulars</th>
              <th className="px-6 py-3 text-right text-xs uppercase tracking-wider" style={{ color: 'var(--text3)', fontWeight: 700 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {statement.nodes.map(node => <StrictStatementRow key={node.id} node={node} classMap={classMap} />)}
            {statement.nodes.length === 0 && (
              <tr><td colSpan={2} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>No statement rows parsed</td></tr>
            )}
          </tbody>
          <tfoot>
            {/* Subtotal lines */}
            <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--bg3)' }}>
              <td className="px-6 py-2 text-xs font-semibold" style={{ color: 'var(--text2)' }}>Total Income</td>
              <td className="px-6 py-2 text-right font-mono text-xs font-semibold" style={{ color: 'var(--teal)' }}>{formatAmount(totalIncome)}</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--bg3)' }}>
              <td className="px-6 py-2 text-xs font-semibold" style={{ color: 'var(--text2)' }}>Total Expenses</td>
              <td className="px-6 py-2 text-right font-mono text-xs font-semibold" style={{ color: 'var(--coral)' }}>{formatAmount(totalExpenses)}</td>
            </tr>
            {/* Net Profit / Loss */}
            <tr style={{ borderTop: '2px solid var(--border)', background: profitBg }}>
              <td className="px-6 py-3 font-bold" style={{ color: 'var(--text1)', fontSize: 13 }}>
                {isProfit ? 'Net Profit' : 'Net Loss'} for the period
              </td>
              <td className="px-6 py-3 text-right font-mono font-bold" style={{ color: profitColor, fontSize: 15 }}>
                {formatAmount(Math.abs(displayProfit))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── BS two-column layout (Liabilities | Assets) ───────────────────────────

function BSSectionTable({
  title, nodes, totalLabel, classMap,
}: {
  title: string;
  nodes: FinancialNode[];
  totalLabel: string;
  classMap?: ClassMap;
}) {
  const total = nodes.reduce((s, n) => s + Math.abs(n.amount), 0);
  return (
    <div className="flex flex-col gap-1">
      <div
        className="text-xs font-bold uppercase tracking-widest px-2 py-1 rounded"
        style={{ background: 'var(--bg3)', color: 'var(--text3)' }}
      >
        {title}
      </div>
      <div className="overflow-auto rounded-xl border shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', borderBottom: '2px solid var(--border)' }}>
              <th className="px-4 py-2.5 text-left text-xs uppercase tracking-wider" style={{ color: 'var(--text3)', fontWeight: 700 }}>Particulars</th>
              <th className="px-4 py-2.5 text-right text-xs uppercase tracking-wider" style={{ color: 'var(--text3)', fontWeight: 700 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 && (
              <tr><td colSpan={2} className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text3)' }}>—</td></tr>
            )}
            {nodes.map(node => <StrictStatementRow key={node.id} node={node} classMap={classMap} />)}
            <tr style={{ background: 'var(--bg3)', borderTop: '2px solid var(--border)' }}>
              <td className="px-4 py-2.5 text-xs font-bold" style={{ color: 'var(--text1)' }}>{totalLabel}</td>
              <td className="px-4 py-2.5 text-right font-mono font-bold text-sm" style={{ color: 'var(--teal)' }}>
                {formatAmount(total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BSStrictView({
  statement,
  masterMap = new Map(),
  classMap,
}: {
  statement: ParsedStatement;
  masterMap?: Map<string, MasterEntry>;
  classMap?: ClassMap;
}) {
  const hasMaster = masterMap.size > 0;

  function sideOf(node: FinancialNode): 'liability' | 'asset' {
    if (hasMaster) {
      const side = classifyBSSide(node.name, masterMap);
      if (side !== 'unknown') return side;
    }
    // Tally sign convention: positive = Cr (liabilities/equity), negative = Dr (assets)
    return node.amount >= 0 ? 'liability' : 'asset';
  }

  const liabilityNodes = statement.nodes.filter(n => sideOf(n) === 'liability');
  const assetNodes     = statement.nodes.filter(n => sideOf(n) === 'asset');

  const liabilityTotal = liabilityNodes.reduce((s, n) => s + n.amount, 0);
  const assetTotal     = assetNodes.reduce((s, n) => s + Math.abs(n.amount), 0);
  const balanced       = Math.abs(liabilityTotal - assetTotal) < 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Balance indicator */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs px-2 py-0.5 rounded font-semibold"
          style={{
            background: balanced ? 'rgba(76,175,121,0.12)' : 'rgba(239,68,68,0.12)',
            color: balanced ? 'var(--green)' : 'var(--red)',
          }}
        >
          {balanced ? '✓ Assets = Liabilities' : `⚠ Difference: ${formatAmount(Math.abs(liabilityTotal - assetTotal))}`}
        </span>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-5">
        <BSSectionTable title="Liabilities" nodes={liabilityNodes} totalLabel="Total Liabilities" classMap={classMap} />
        <BSSectionTable title="Assets"       nodes={assetNodes}     totalLabel="Total Assets"      classMap={classMap} />
      </div>
    </div>
  );
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

interface TBNode extends TBFullRow {
  children: TBNode[];
  depth: number;
}

function buildTBTree(rows: TBFullRow[], masterMap: Map<string, MasterEntry>): TBNode[] {
  const nodeMap = new Map<string, TBNode>();
  for (const row of rows) {
    nodeMap.set(row.name.toLowerCase().trim(), { ...row, children: [], depth: 0 });
  }
  const roots: TBNode[] = [];
  for (const row of rows) {
    const key = row.name.toLowerCase().trim();
    const node = nodeMap.get(key)!;
    const parentName = masterMap.get(key)?.parent?.trim();
    if (parentName && parentName.toLowerCase() !== 'primary' && parentName !== '') {
      const parentNode = nodeMap.get(parentName.toLowerCase().trim());
      if (parentNode) {
        parentNode.children.push(node);
        node.depth = parentNode.depth + 1;
        continue;
      }
    }
    roots.push(node);
  }
  return roots;
}

function collectGroupNames(nodes: TBNode[], out: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.isGroup) { out.add(n.name); collectGroupNames(n.children, out); }
  }
  return out;
}

function flattenVisible(nodes: TBNode[], expanded: Set<string>): TBNode[] {
  const result: TBNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.isGroup && expanded.has(node.name) && node.children.length > 0) {
      result.push(...flattenVisible(node.children, expanded));
    }
  }
  return result;
}

/** Format amount for TB display — show raw number with commas, no abbreviation */
function fmtTBAmt(v: number): string {
  if (v === 0) return '—';
  return Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Aggregate opening / movement / closing totals for a TB node, matching
 * Tally's "Trial Balance" report rollup logic:
 *   - leaf ledgers contribute their own values directly (closing/opening
 *     bucket into Dr or Cr by sign; movements are positive magnitudes)
 *   - groups WITH children: sum recursively
 *   - groups WITHOUT children (e.g. Sundry Creditors when no party ledgers
 *     were in TrialBal.xml): treat as a leaf so totals don't vanish
 */
interface TBAggregate {
  openingDr: number; openingCr: number;
  debit:     number; credit:    number;
  closingDr: number; closingCr: number;
}

function computeGroupAggregate(node: TBNode): TBAggregate {
  if (!node.isGroup || node.children.length === 0) {
    return {
      // parseTBFull normalizes to canonical Dr-positive: positive=Dr,
      // negative=Cr.  Bucketing reads off the sign directly.
      openingDr: node.opening > 0 ? node.opening            : 0,
      openingCr: node.opening < 0 ? Math.abs(node.opening) : 0,
      debit:     node.debitMov,
      credit:    node.creditMov,
      closingDr: node.closing > 0 ? node.closing            : 0,
      closingCr: node.closing < 0 ? Math.abs(node.closing) : 0,
    };
  }
  const acc: TBAggregate = { openingDr: 0, openingCr: 0, debit: 0, credit: 0, closingDr: 0, closingCr: 0 };
  for (const child of node.children) {
    const sub = computeGroupAggregate(child);
    acc.openingDr += sub.openingDr;
    acc.openingCr += sub.openingCr;
    acc.debit     += sub.debit;
    acc.credit    += sub.credit;
    acc.closingDr += sub.closingDr;
    acc.closingCr += sub.closingCr;
  }
  return acc;
}

/** Backwards-compat: closing-only split (some other places may import this). */
function computeGroupDrCr(node: TBNode): { dr: number; cr: number } {
  const a = computeGroupAggregate(node);
  return { dr: a.closingDr, cr: a.closingCr };
}

function TBTab({ tbRows, masterEntries, classMap }: {
  tbRows: TBFullRow[];
  masterEntries: MasterEntry[];
  classMap?: ClassMap;
}) {
  const masterMap = useMemo(() => {
    const m = new Map<string, MasterEntry>();
    for (const e of masterEntries) m.set(e.name.toLowerCase().trim(), e);
    return m;
  }, [masterEntries]);

  const tree = useMemo(() => buildTBTree(tbRows, masterMap), [tbRows, masterMap]);

  const allGroupNames = useMemo(() => collectGroupNames(tree), [tree]);

  // classMap is built once at the DataView level and passed down so all
  // three tabs (TB / P&L / BS) read the same classifications.

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allGroupNames));
  const [search, setSearch] = useState('');

  // Re-expand when data changes (new analysis run)
  React.useEffect(() => {
    setExpanded(new Set(allGroupNames));
  }, [allGroupNames]);

  // Search → flat filtered list (depth=0, no indent); no search → hierarchical tree
  const visibleRows = useMemo((): TBNode[] => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return tbRows
        .filter(r => r.name.toLowerCase().includes(q))
        .map(r => ({ ...r, children: [], depth: 0 }));
    }
    return flattenVisible(tree, expanded);
  }, [tbRows, tree, expanded, search]);

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  // Index full aggregate per row name — used for both group-row rendering and
  // the grand total.  For groups we descend into children; for leaves we
  // bucket their own values.
  const aggByName = useMemo(() => {
    const map = new Map<string, TBAggregate>();
    function visit(n: TBNode) {
      map.set(n.name, computeGroupAggregate(n));
      for (const c of n.children) visit(c);
    }
    for (const root of tree) visit(root);
    return map;
  }, [tree]);

  // Grand totals — sum from LEAF rows only, so groups can't double-count.
  // (Mirrors how Tally's footer aggregates.)
  const ledgerRows = tbRows.filter(r => !r.isGroup);
  const grandOpeningDr = ledgerRows.reduce((s, r) => s + (r.opening < 0 ? Math.abs(r.opening) : 0), 0);
  const grandOpeningCr = ledgerRows.reduce((s, r) => s + (r.opening > 0 ? r.opening           : 0), 0);
  const grandDebit     = ledgerRows.reduce((s, r) => s + r.debitMov,  0);
  const grandCredit    = ledgerRows.reduce((s, r) => s + r.creditMov, 0);
  // Dr-positive canonical (see parseTBFull): closing > 0 = Dr, < 0 = Cr
  const grandTotalDr   = ledgerRows.reduce((s, r) => s + (r.closing > 0 ? r.closing           : 0), 0);
  const grandTotalCr   = ledgerRows.reduce((s, r) => s + (r.closing < 0 ? Math.abs(r.closing) : 0), 0);

  // Adaptive columns: only show Opening / Movements columns when Tally
  // returned non-zero data for them.  Some Tally exports (and some Tally
  // versions ignoring the F12 toggles in the TDL request) only ship the
  // closing balance — in that case fall back to the classic 3-column layout.
  const hasOpeningData   = grandOpeningDr > 0 || grandOpeningCr > 0;
  const hasMovementsData = grandDebit > 0 || grandCredit > 0;

  const thStyle: React.CSSProperties = {
    color: 'var(--text3)', fontWeight: 600, fontSize: 11,
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Summary tiles */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Total Debit',  value: grandTotalDr, color: 'var(--coral)' },
          { label: 'Total Credit', value: grandTotalCr, color: 'var(--teal)' },
          { label: 'Groups',       value: allGroupNames.size, color: 'var(--blue)', raw: true },
          { label: 'Ledgers',      value: ledgerRows.length,  color: 'var(--text2)', raw: true },
        ].map(s => (
          <div key={s.label} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg3)', minWidth: 110 }}>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>{s.label}</div>
            <div className="text-sm font-semibold" style={{ color: s.color }}>
              {'raw' in s && s.raw ? String(s.value) : formatAmount(s.value as number)}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search accounts…"
          className="px-3 py-1.5 rounded-lg text-sm flex-1"
          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)', minWidth: 180, outline: 'none' }}
        />
        {!search && (
          <>
            <button
              onClick={() => setExpanded(new Set(allGroupNames))}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)' }}
            >
              Expand all
            </button>
            <button
              onClick={() => setExpanded(new Set())}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)' }}
            >
              Collapse all
            </button>
          </>
        )}
        <span className="text-xs" style={{ color: 'var(--text3)' }}>
          {search ? `${visibleRows.length} matches` : `${visibleRows.length} rows visible`}
        </span>
      </div>

      {/* Table — Tally TB layout. Columns adapt to what the export contains:
            • Always: Particulars, Closing Dr, Closing Cr
            • If Tally returned Opening Balance:   add Opening Dr / Cr
            • If Tally returned Transactions:      add Debit / Credit (year)        */}
      <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)', maxHeight: 560 }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            {/* Widen Particulars when there are fewer numeric columns */}
            <col style={{ width: hasOpeningData && hasMovementsData ? '28%' : hasOpeningData || hasMovementsData ? '36%' : '50%' }} />
            {hasOpeningData && (<>
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
            </>)}
            {hasMovementsData && (<>
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
            </>)}
            <col style={{ width: hasOpeningData && hasMovementsData ? '12%' : hasOpeningData || hasMovementsData ? '14%' : '25%' }} />
            <col style={{ width: hasOpeningData && hasMovementsData ? '12%' : hasOpeningData || hasMovementsData ? '14%' : '25%' }} />
          </colgroup>
          <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th rowSpan={2} className="px-3 py-2 text-left align-middle" style={thStyle}>Particulars</th>
              {hasOpeningData && (
                <th colSpan={2} className="px-3 py-2 text-center"
                  style={{ ...thStyle, borderBottom: '1px solid var(--border)' }}>
                  Opening Balance
                </th>
              )}
              {hasMovementsData && (
                <th colSpan={2} className="px-3 py-2 text-center"
                  style={{ ...thStyle, borderBottom: '1px solid var(--border)' }}>
                  Transactions (Year)
                </th>
              )}
              <th colSpan={2} className="px-3 py-2 text-center"
                style={{ ...thStyle, borderBottom: '1px solid var(--border)' }}>
                Closing Balance
              </th>
            </tr>
            <tr>
              {hasOpeningData && (<>
                <th className="px-3 py-1.5 text-right" style={thStyle}>Debit</th>
                <th className="px-3 py-1.5 text-right" style={thStyle}>Credit</th>
              </>)}
              {hasMovementsData && (<>
                <th className="px-3 py-1.5 text-right" style={thStyle}>Debit</th>
                <th className="px-3 py-1.5 text-right" style={thStyle}>Credit</th>
              </>)}
              <th className="px-3 py-1.5 text-right" style={thStyle}>Debit</th>
              <th className="px-3 py-1.5 text-right" style={thStyle}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => {
              const isExpanded = expanded.has(row.name);
              const isSuspense = /suspense|miscellaneous/i.test(row.name);
              const rowBg = row.isGroup
                ? 'var(--bg3)'
                : isSuspense
                  ? 'rgba(251,191,36,0.05)'
                  : i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)';

              // Resolve values for this row.  Groups: precomputed aggregate.
              // Leaves: bucket their own opening/closing by sign; movements
              // are positive magnitudes already.
              let opDr = 0, opCr = 0, dbt = 0, crd = 0, clDr = 0, clCr = 0;
              if (row.isGroup) {
                const a = aggByName.get(row.name);
                if (a) {
                  opDr = a.openingDr; opCr = a.openingCr;
                  dbt  = a.debit;     crd  = a.credit;
                  clDr = a.closingDr; clCr = a.closingCr;
                }
              } else {
                // Dr-positive canonical (parseTBFull normalization).
                if (row.opening > 0) opDr = row.opening;
                else if (row.opening < 0) opCr = Math.abs(row.opening);
                dbt = row.debitMov; crd = row.creditMov;
                if (row.closing > 0) clDr = row.closing;
                else if (row.closing < 0) clCr = Math.abs(row.closing);
              }

              const numCellStyle = (color: string): React.CSSProperties => ({
                color: color,
                fontWeight: row.isGroup ? 600 : 400,
              });

              return (
                <tr key={row.name + row.depth}
                  style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
                  {/* Particulars — name with chevron and depth indent */}
                  <td className="px-3 py-1.5" style={{ overflow: 'hidden' }}>
                    <div className="flex items-center gap-1" style={{ paddingLeft: search ? 0 : row.depth * 14 }}>
                      {row.isGroup ? (
                        <button
                          onClick={() => toggleExpand(row.name)}
                          style={{ fontSize: 10, width: 14, flexShrink: 0, color: 'var(--text3)', cursor: 'pointer' }}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      ) : (
                        <span style={{ width: 14, flexShrink: 0 }} />
                      )}
                      <span
                        className="truncate"
                        title={row.name}
                        style={{
                          color: row.isGroup ? 'var(--text1)' : 'var(--text2)',
                          fontWeight: row.isGroup ? 600 : 400,
                          fontSize: row.isGroup ? 13 : 12,
                        }}
                      >
                        {row.name}
                      </span>
                      {isSuspense && !row.isGroup && (
                        <span className="ml-1 px-1.5 rounded text-xs shrink-0"
                          style={{ background: 'rgba(251,191,36,0.15)', color: 'var(--amber)' }}>⚑</span>
                      )}
                      {/* Master Setup classification badge — visible on every
                          leaf ledger so the user's master work is reflected
                          right here in Data & Fix. */}
                      {!row.isGroup && <CategoryBadge ledgerName={row.name} classMap={classMap} />}
                    </div>
                  </td>
                  {hasOpeningData && (<>
                    <td className="px-3 py-1.5 text-right font-mono text-xs"
                      style={numCellStyle(opDr > 0 ? 'var(--coral)' : 'var(--text3)')}>
                      {opDr > 0 ? fmtTBAmt(opDr) : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs"
                      style={numCellStyle(opCr > 0 ? 'var(--teal)' : 'var(--text3)')}>
                      {opCr > 0 ? fmtTBAmt(opCr) : ''}
                    </td>
                  </>)}
                  {hasMovementsData && (<>
                    <td className="px-3 py-1.5 text-right font-mono text-xs"
                      style={numCellStyle(dbt > 0 ? 'var(--coral)' : 'var(--text3)')}>
                      {dbt > 0 ? fmtTBAmt(dbt) : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs"
                      style={numCellStyle(crd > 0 ? 'var(--teal)' : 'var(--text3)')}>
                      {crd > 0 ? fmtTBAmt(crd) : ''}
                    </td>
                  </>)}
                  <td className="px-3 py-1.5 text-right font-mono text-xs"
                    style={numCellStyle(clDr > 0 ? 'var(--coral)' : 'var(--text3)')}>
                    {clDr > 0 ? fmtTBAmt(clDr) : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs"
                    style={numCellStyle(clCr > 0 ? 'var(--teal)' : 'var(--text3)')}>
                    {clCr > 0 ? fmtTBAmt(clCr) : ''}
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr><td colSpan={3 + (hasOpeningData ? 2 : 0) + (hasMovementsData ? 2 : 0)}
                  className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>
                {tbRows.length === 0 ? 'No Trial Balance data loaded' : 'No accounts match'}
              </td></tr>
            )}
          </tbody>
          <tfoot style={{ position: 'sticky', bottom: 0 }}>
            <tr style={{ background: 'var(--bg3)', borderTop: '2px solid var(--border)' }}>
              <td className="px-3 py-2.5 font-bold text-sm" style={{ color: 'var(--text1)' }}>
                Grand Total
              </td>
              {hasOpeningData && (<>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-sm" style={{ color: 'var(--coral)' }}>
                  {grandOpeningDr > 0 ? fmtTBAmt(grandOpeningDr) : ''}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-sm" style={{ color: 'var(--teal)' }}>
                  {grandOpeningCr > 0 ? fmtTBAmt(grandOpeningCr) : ''}
                </td>
              </>)}
              {hasMovementsData && (<>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-sm" style={{ color: 'var(--coral)' }}>
                  {grandDebit > 0 ? fmtTBAmt(grandDebit) : ''}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-sm" style={{ color: 'var(--teal)' }}>
                  {grandCredit > 0 ? fmtTBAmt(grandCredit) : ''}
                </td>
              </>)}
              <td className="px-3 py-2.5 text-right font-mono font-bold text-sm" style={{ color: 'var(--coral)' }}>
                {fmtTBAmt(grandTotalDr)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono font-bold text-sm" style={{ color: 'var(--teal)' }}>
                {fmtTBAmt(grandTotalCr)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── P&L tab ────────────────────────────────────────────────────────────────

/** Expandable row for a P&L group that has children in the XML */
function PLGroupRow({ label, total, children, color, note, classMap }: {
  label: string; total: number; children: Array<{name:string;amount:number}>;
  color?: string; note?: string; classMap?: ClassMap;
}) {
  const [open, setOpen] = useState(false);
  const hasChildren = children.length > 0;
  return (
    <>
      <tr
        onClick={() => hasChildren && setOpen(v => !v)}
        style={{ borderBottom: '1px solid var(--border)', cursor: hasChildren ? 'pointer' : 'default', background: 'rgba(255,255,255,0.02)' }}
      >
        <td className="px-6 py-2.5 font-semibold" style={{ color: 'var(--text1)', userSelect: 'none' }}>
          {hasChildren && <span style={{ marginRight: 6, fontSize: 10, color: 'var(--text3)' }}>{open ? '▼' : '▶'}</span>}
          {label}
          {note && <span className="text-xs font-normal ml-2" style={{ color: 'var(--text3)' }}>{note}</span>}
        </td>
        <td className="px-6 py-2.5 text-right font-mono font-bold" style={{ color: color ?? 'var(--text1)' }}>
          {formatAmount(total)}
        </td>
      </tr>
      {open && children.map(ch => (
        <tr key={ch.name} style={{ borderBottom: '1px solid var(--border)', background: 'transparent' }}>
          <td className="py-1.5 text-xs" style={{ color: 'var(--text2)', paddingLeft: '2.5rem' }}>
            <span className="align-middle">{ch.name}</span>
            <CategoryBadge ledgerName={ch.name} classMap={classMap} />
          </td>
          <td className="px-6 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--text2)' }}>{formatAmount(ch.amount)}</td>
        </tr>
      ))}
    </>
  );
}

function PLTab({ pd, classMap }: { pd: Record<string, unknown>; classMap?: ClassMap }) {
  const strictStatement = pd.pandlStatement as ParsedStatement | undefined;
  if (strictStatement?.nodes?.length) {
    const bsNetProfit = pd.bsNetProfit as number | null | undefined;
    return <StrictStatementTable statement={strictStatement} bsNetProfit={bsNetProfit} classMap={classMap} />;
  }

  const plSections = (pd.plSections as PLSection[] | undefined) ?? [];
  const directRevenue  = (pd.directRevenue as number) ?? 0;
  const otherIncome    = (pd.otherIncome as number) ?? 0;
  const costOfMaterials = (pd.costOfMaterials as number) ?? 0;
  const expenses       = (pd.expenses as number) ?? 0;
  const netProfit      = (pd.netProfit as number) ?? 0;
  const totalIncome    = directRevenue + otherIncome;
  // totalExpenses from parser already includes cost of materials + indirect expenses
  const totalExpenses  = expenses || (costOfMaterials + (pd.indirectExpenses as number ?? 0));

  // Map sections from XML to schedule groups
  const salesSections  = plSections.filter(s => s.name.toLowerCase().includes('sales') && !s.name.toLowerCase().includes('cost of sales'));
  const purchSections  = plSections.filter(s => {
    const nl = s.name.toLowerCase();
    return nl.includes('purchase') || nl.includes('cost of sales') || nl.includes('direct expense') || nl.includes('manufacturing');
  });
  const incomeSections = plSections.filter(s => !s.name.toLowerCase().includes('sales') && !s.name.toLowerCase().includes('purchase') && (s.name.toLowerCase().includes('income')));
  const expSections    = plSections.filter(s => !salesSections.includes(s) && !purchSections.includes(s) && !incomeSections.includes(s));

  // Divider row
  const Divider = ({ label }: { label: string }) => (
    <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
      <td colSpan={2} className="px-6 py-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text3)' }}>{label}</td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="overflow-auto rounded-xl border shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', borderBottom: '2px solid var(--border)' }}>
              <th className="px-6 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'var(--text3)', fontWeight: 700 }}>Particulars</th>
              <th className="px-6 py-3 text-right text-xs uppercase tracking-wider" style={{ color: 'var(--text3)', fontWeight: 700 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <Divider label="I  Revenue from operations" />
            {salesSections.length > 0 ? salesSections.map(s => (
              <PLGroupRow key={s.name} label={s.name} total={Math.abs(s.total)} children={s.children.map(c => ({ name: c.name, amount: Math.abs(c.amount) }))} color="var(--teal)" classMap={classMap} />
            )) : (
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-6 py-2.5" style={{ color: 'var(--text2)' }}>Sales Accounts</td>
                <td className="px-6 py-2.5 text-right font-mono font-bold" style={{ color: 'var(--teal)' }}>{formatAmount(directRevenue)}</td>
              </tr>
            )}
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(20,184,166,0.06)' }}>
              <td className="px-6 py-2.5 font-bold" style={{ color: 'var(--text1)' }}>Total Revenue from Operations (I)</td>
              <td className="px-6 py-2.5 text-right font-mono font-bold" style={{ color: 'var(--teal)' }}>{formatAmount(directRevenue)}</td>
            </tr>

            <Divider label="II  Other Income" />
            {incomeSections.length > 0 ? incomeSections.map(s => (
              <PLGroupRow key={s.name} label={s.name} total={Math.abs(s.total)} children={s.children.map(c => ({ name: c.name, amount: Math.abs(c.amount) }))} color="var(--green)" classMap={classMap} />
            )) : (
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-6 py-2.5" style={{ color: 'var(--text2)' }}>Other Income</td>
                <td className="px-6 py-2.5 text-right font-mono font-bold" style={{ color: 'var(--green)' }}>{formatAmount(otherIncome)}</td>
              </tr>
            )}
            <tr style={{ borderBottom: '2px solid var(--border)', background: 'rgba(20,184,166,0.08)' }}>
              <td className="px-6 py-2.5 font-bold" style={{ color: 'var(--text1)' }}>III  Total Income (I + II)</td>
              <td className="px-6 py-2.5 text-right font-mono font-bold" style={{ color: 'var(--teal)' }}>{formatAmount(totalIncome)}</td>
            </tr>

            <Divider label="IV  Expenses" />
            {purchSections.length > 0 ? purchSections.map(s => (
              <PLGroupRow key={s.name} label="Cost of materials consumed" total={Math.abs(s.total)} children={s.children.map(c => ({ name: c.name, amount: Math.abs(c.amount) }))} color="var(--coral)" note={`(${s.name})`} classMap={classMap} />
            )) : (
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-6 py-2.5" style={{ color: 'var(--text2)' }}>Cost of materials consumed</td>
                <td className="px-6 py-2.5 text-right font-mono" style={{ color: 'var(--coral)' }}>{formatAmount(costOfMaterials)}</td>
              </tr>
            )}
            {expSections.map(s => (
              <PLGroupRow key={s.name} label={s.name} total={Math.abs(s.total)} children={s.children.map(c => ({ name: c.name, amount: Math.abs(c.amount) }))} color="var(--coral)" classMap={classMap} />
            ))}
            <tr style={{ borderBottom: '2px solid var(--border)', background: 'rgba(242,107,91,0.06)' }}>
              <td className="px-6 py-2.5 font-bold" style={{ color: 'var(--text1)' }}>Total Expenses (IV)</td>
              <td className="px-6 py-2.5 text-right font-mono font-bold" style={{ color: 'var(--coral)' }}>{formatAmount(totalExpenses)}</td>
            </tr>

            <tr style={{ borderBottom: '1px solid var(--border)', background: netProfit >= 0 ? 'rgba(76,175,121,0.08)' : 'rgba(242,107,91,0.08)' }}>
              <td className="px-6 py-3 font-bold" style={{ color: 'var(--text1)' }}>
                {netProfit >= 0 ? 'Net Profit' : 'Net Loss'} for the period
              </td>
              <td className="px-6 py-3 text-right font-mono font-bold" style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '1rem' }}>
                {formatAmount(Math.abs(netProfit || (totalIncome - totalExpenses)))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Balance Sheet tab ──────────────────────────────────────────────────────

/** Expandable balance sheet group row */
function BSGroupRow({ label, amount, children, color }: {
  label: string; amount: number; children?: Array<{name:string;amount:number}>;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasChildren = (children?.length ?? 0) > 0;
  return (
    <>
      <tr
        onClick={() => hasChildren && setOpen(v => !v)}
        style={{ borderBottom: '1px solid var(--border)', cursor: hasChildren ? 'pointer' : 'default' }}
      >
        <td className="px-6 py-2.5" style={{ color: 'var(--text1)', fontWeight: 500, userSelect: 'none' }}>
          {hasChildren && <span style={{ marginRight: 6, fontSize: 10, color: 'var(--text3)' }}>{open ? '▼' : '▶'}</span>}
          {label}
        </td>
        <td className="px-6 py-2.5 text-right font-mono" style={{ color: color ?? 'var(--text1)', fontWeight: hasChildren ? 600 : 400 }}>
          {formatAmount(amount)}
        </td>
      </tr>
      {open && children?.map(ch => (
        <tr key={ch.name} style={{ borderBottom: '1px solid var(--border)', background: 'transparent' }}>
          <td className="py-1.5 text-xs" style={{ color: 'var(--text2)', paddingLeft: '2.5rem' }}>{ch.name}</td>
          <td className="px-6 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--text2)' }}>{formatAmount(ch.amount)}</td>
        </tr>
      ))}
    </>
  );
}

function BSTab({ pd, classMap }: { pd: Record<string, unknown>; classMap?: ClassMap }) {
  const strictStatement = pd.bsheetStatement as ParsedStatement | undefined;
  const masterEntries   = pd.masterEntries as MasterEntry[] | undefined;

  const masterMap = useMemo(() => {
    if (!masterEntries?.length) return new Map<string, MasterEntry>();
    const m = new Map<string, MasterEntry>();
    for (const e of masterEntries) m.set(e.name.toLowerCase().trim(), e);
    return m;
  }, [masterEntries]);

  if (strictStatement?.nodes?.length) {
    return <BSStrictView statement={strictStatement} masterMap={masterMap} classMap={classMap} />;
  }

  // In Tally BS export convention:
  // Assets: BSSUBAMT with positive = Dr = asset (show as positive)
  //         But in the BSheet.xml, Tally stores ASSETS as NEGATIVE (Cr convention for the ledger side)
  //         So we negate: display value = -rawValue for assets
  const ca      = -(pd.ca as number ?? 0);          // negate: negative in Tally = asset
  const fa      = Math.abs((pd.fixedAssets as number) ?? 0);
  const stock   = Math.abs((pd.closingStock as number) ?? 0);
  const bankBal = Math.abs((pd.bankBal as number) ?? 0);
  const debtors = Math.abs((pd.debtorBal as number) ?? 0);
  const cl      = Math.abs((pd.cl as number) ?? 0);
  const bsNet   = (pd.bsNetProfit as number) ?? 0;
  const creds   = Math.abs((pd.creditorBal as number) ?? 0);
  const bsCashBankTotal = Math.abs((pd.bsCashBankTotal as number) ?? 0);

  // Others in current assets = CA total - known items
  const knownCA = stock + debtors + bankBal;
  const otherCA = Math.max(0, ca - knownCA);

  const BSSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-bold uppercase tracking-widest px-1 mt-2" style={{ color: 'var(--text3)' }}>{title}</div>
      <div className="overflow-auto rounded-xl border shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );

  const Divider = ({ label }: { label: string }) => (
    <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
      <td colSpan={2} className="px-6 py-1.5 text-xs font-semibold" style={{ color: 'var(--text3)' }}>{label}</td>
    </tr>
  );

  const TotalRow = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <tr style={{ background: 'rgba(255,255,255,0.04)', borderTop: '2px solid var(--border)' }}>
      <td className="px-6 py-3 font-bold" style={{ color: 'var(--text1)' }}>{label}</td>
      <td className="px-6 py-3 text-right font-mono font-bold" style={{ color, fontSize: '1rem' }}>{formatAmount(value)}</td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <BSSection title="ASSETS">
        <Divider label="Non-current assets" />
        <BSGroupRow label="(a) Property, Plant and Equipment" amount={fa} color="var(--blue)" />
        <Divider label="Current assets" />
        <BSGroupRow label="(a) Inventories" amount={stock} color="var(--text2)" />
        <BSGroupRow label="(b) Trade receivables" amount={debtors} color="var(--text2)" />
        <BSGroupRow label="(c) Cash and cash equivalents" amount={bsCashBankTotal || bankBal} color="var(--green)" />
        {otherCA > 1 && <BSGroupRow label="(d) Others" amount={otherCA} color="var(--text2)" />}
        <TotalRow label="Total Assets" value={ca + fa} color="var(--teal)" />
      </BSSection>

      <BSSection title="EQUITY AND LIABILITIES">
        <Divider label="Equity" />
        <BSGroupRow label="(b) Other Equity (Profit & Loss)" amount={bsNet} color={bsNet >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Divider label="Non-current liabilities" />
        <Divider label="Current liabilities" />
        <BSGroupRow label="(a) Trade payables" amount={creds} color="var(--text2)" />
        <BSGroupRow label="(b) Other current liabilities" amount={cl - creds > 0 ? cl - creds : 0} color="var(--text2)" />
        <TotalRow label="Total Equity and Liabilities" value={bsNet + cl} color="var(--coral)" />
      </BSSection>
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
  const [showTxns, setShowTxns] = useState(false);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [drill, setDrill] = useState<{ title: string; vouchers: Voucher[] } | null>(null);
  const limit = 100;

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
  const allVouchers = stats.vouchers ?? [];

  // Tile definitions — each tile carries the predicate used to filter
  // dbStats.vouchers for its drill-down.  Percentage tiles click through
  // to the *gap* (the vouchers NOT meeting the bar) because that's the
  // user-actionable subset.  Filtering needs to be done with the actual
  // voucher data so the predicate runs on each click; for tiles that
  // have a corresponding parser-set flag (missingVno / zeroAmt / etc.)
  // we use the flag for a single source of truth with the engine checks.
  interface MetricTile {
    label: string;
    value: string;
    color?: string;
    /** Title shown at the top of the drill-down modal. */
    drillTitle?: string;
    /** Predicate over the full voucher list — undefined disables click. */
    predicate?: (v: Voucher) => boolean;
  }
  const metrics: MetricTile[] = [
    {
      label: 'Total Vouchers',
      value: stats.totalVouchers.toLocaleString('en-IN'),
      color: 'var(--text1)',
      drillTitle: 'All vouchers in DayBook',
      predicate: () => true,
    },
    {
      label: 'Narration Coverage',
      value: `${narrationPct.toFixed(1)}%`,
      color: narrationPct >= 80 ? 'var(--green)' : narrationPct >= 50 ? 'var(--amber)' : 'var(--red)',
      // Click → the gap: vouchers without any narration.
      drillTitle: 'Vouchers without narration',
      predicate: v => !v.narration?.trim(),
    },
    {
      label: 'High Value Entries (>₹1L)',
      value: stats.highValueCount.toLocaleString('en-IN'),
      color: 'var(--text2)',
      drillTitle: 'High-value vouchers (>₹1,00,000)',
      predicate: v => v.amount > 100_000,
    },
    {
      label: 'High Value with Narration',
      value: `${hvNarPct.toFixed(1)}%`,
      color: hvNarPct >= 80 ? 'var(--green)' : 'var(--amber)',
      // Click → the gap: high-value vouchers WITHOUT narration.
      drillTitle: 'High-value vouchers missing narration',
      predicate: v => v.amount > 100_000 && !v.narration?.trim(),
    },
    {
      label: 'Missing Voucher Nos',
      value: stats.missingVno.toLocaleString('en-IN'),
      color: stats.missingVno > 0 ? 'var(--red)' : 'var(--green)',
      drillTitle: 'Vouchers with missing voucher numbers',
      predicate: v => v.flags?.includes('missingVno') ?? !v.vno,
    },
    {
      label: 'Zero Amount Vouchers',
      value: stats.zeroAmt.toLocaleString('en-IN'),
      color: stats.zeroAmt > 0 ? 'var(--amber)' : 'var(--green)',
      drillTitle: 'Zero-amount vouchers',
      predicate: v => v.flags?.includes('zeroAmt') ?? v.amount === 0,
    },
    {
      label: 'Journal Vouchers',
      value: stats.totalJournals.toLocaleString('en-IN'),
      color: 'var(--text2)',
      drillTitle: 'Journal vouchers',
      predicate: v => classifyVoucherType(v.type).semantic === 'journal',
    },
    {
      label: 'Cash Transactions >₹10k',
      value: stats.cashOver10k.toLocaleString('en-IN'),
      color: stats.cashOver10k > 0 ? 'var(--amber)' : 'var(--green)',
      drillTitle: 'Cash transactions over ₹10,000',
      predicate: v => v.flags?.includes('cashOver10k') ?? false,
    },
    {
      label: 'Round Amount Vouchers',
      value: stats.roundCount.toLocaleString('en-IN'),
      color: 'var(--text2)',
      drillTitle: 'Round-amount vouchers (multiples of ₹1,000)',
      predicate: v => v.amount > 0 && v.amount % 1000 === 0,
    },
    {
      label: 'Entries Outside FY',
      value: stats.outOfFY.toLocaleString('en-IN'),
      color: stats.outOfFY > 0 ? 'var(--red)' : 'var(--green)',
      drillTitle: 'Vouchers dated outside the financial year',
      predicate: v => v.flags?.includes('outOfFY') ?? false,
    },
  ];

  function openDrill(tile: MetricTile) {
    if (!tile.predicate || !tile.drillTitle) return;
    const vouchers = allVouchers.filter(tile.predicate);
    if (vouchers.length === 0) return;
    setDrill({ title: tile.drillTitle, vouchers });
  }

  // Monthly breakdown
  const months = Object.entries(stats.monthCounts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const maxMonthCount = Math.max(...months.map(([, c]) => c), 1);

  // Duplicate vouchers — dupVnoMap is keyed on `${type}${vno}` so
  // legitimate cross-series collisions (Sales/001 vs Receipt/001) don't
  // get flagged.  Split for display.
  const dupVnos = Object.entries(stats.dupVnoMap ?? {})
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ ...splitDupKey(key), count }));

  return (
    <div className="flex flex-col gap-6">
      {/* Metrics grid — every tile is clickable when its predicate
          matches at least one voucher, opening the drill-down modal.
          Percentage tiles drill into the *gap* (e.g. Narration Coverage
          shows vouchers WITHOUT narration). */}
      <div className="grid grid-cols-2 gap-2" style={{ maxWidth: 600 }}>
        {metrics.map(tile => {
          const matchCount = tile.predicate ? allVouchers.filter(tile.predicate).length : 0;
          const drillable = matchCount > 0;
          const Tag: 'button' | 'div' = drillable ? 'button' : 'div';
          return (
            <Tag
              key={tile.label}
              {...(drillable ? { onClick: () => openDrill(tile) } : {})}
              className={`px-3 py-2 rounded-lg text-left w-full ${drillable ? 'transition-colors hover:bg-[var(--bg4)] cursor-pointer' : ''}`}
              style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs" style={{ color: 'var(--text3)' }}>{tile.label}</div>
                {drillable && <span className="text-xs" style={{ color: 'var(--teal)' }}>→</span>}
              </div>
              <div className="text-sm font-semibold" style={{ color: tile.color }}>{tile.value}</div>
            </Tag>
          );
        })}
      </div>

      {drill && (
        <VoucherDrillDown
          title={drill.title}
          vouchers={drill.vouchers}
          onClose={() => setDrill(null)}
        />
      )}

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
            <table className="text-sm" style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 520 }}>
              <thead style={{ background: 'var(--bg3)' }}>
                <tr>
                  <th className="px-3 py-2 text-left text-xs" style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>Voucher Type</th>
                  <th className="px-3 py-2 text-left text-xs" style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>Voucher No</th>
                  <th className="px-3 py-2 text-right text-xs" style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {dupVnos.slice(0, 50).map(({ type, vno, count }, i) => (
                  <tr key={`${type}|${vno}`} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                    <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--text2)' }}>{type || '(no type)'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs" style={{ color: 'var(--text2)' }}>{vno}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--amber)' }}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactions Toggle */}
      {stats.vouchers && stats.vouchers.length > 0 && (
        <div className="mt-4 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>Raw Transactions</div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>{stats.vouchers.length.toLocaleString('en-IN')} vouchers extracted from DayBook</div>
            </div>
            <button 
              onClick={() => setShowTxns(!showTxns)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ background: showTxns ? 'var(--bg3)' : 'var(--teal)', color: showTxns ? 'var(--text1)' : '#000' }}
            >
              {showTxns ? 'Hide Transactions' : 'View Transactions'}
            </button>
          </div>

          {showTxns && (() => {
            // Apply filtering and searching
            const filteredVouchers = stats.vouchers!.filter(v => {
              if (filterType !== 'All' && v.type.toLowerCase() !== filterType.toLowerCase()) return false;
              if (searchTerm) {
                const term = searchTerm.toLowerCase();
                return (
                  v.party.toLowerCase().includes(term) ||
                  v.vno.toLowerCase().includes(term) ||
                  v.narration.toLowerCase().includes(term) ||
                  v.amount.toString().includes(term)
                );
              }
              return true;
            });
            const totalPages = Math.ceil(filteredVouchers.length / limit);
            const currentVouchers = filteredVouchers.slice((page - 1) * limit, page * limit);

            // Get unique voucher types for the filter dropdown
            const voucherTypes = ['All', ...Array.from(new Set(stats.vouchers!.map(v => v.type))).filter(Boolean).sort()];

            return (
              <div className="flex flex-col gap-3 animate-fade-in">
                {/* Search & Filter Bar */}
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Search party, voucher no, narration, amount..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                    className="flex-1 px-3 py-2 rounded-lg text-sm"
                    style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text1)', outline: 'none' }}
                  />
                  <select
                    value={filterType}
                    onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
                    className="px-3 py-2 rounded-lg text-sm capitalize"
                    style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text1)', outline: 'none', cursor: 'pointer' }}
                  >
                    {voucherTypes.map(vt => (
                      <option key={vt} value={vt} className="capitalize">{vt}</option>
                    ))}
                  </select>
                </div>

                {/* Data Table */}
                <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)', maxHeight: 500 }}>
                  <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
                      <tr>
                        <th className="px-3 py-2 text-xs text-left" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Date</th>
                        <th className="px-3 py-2 text-xs text-left" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Type</th>
                        <th className="px-3 py-2 text-xs text-left" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Voucher No</th>
                        <th className="px-3 py-2 text-xs text-left" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Party/Ledger</th>
                        <th className="px-3 py-2 text-xs text-left" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Narration</th>
                        <th className="px-3 py-2 text-xs text-right" style={{ color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentVouchers.map((v, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                          <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text2)' }}>{formatDate(v.date)}</td>
                          <td className="px-3 py-2 text-xs capitalize whitespace-nowrap" style={{ color: 'var(--text1)' }}>{v.type}</td>
                          <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text2)' }}>{v.vno || '—'}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--teal)' }}>{v.party || '—'}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--text2)', maxWidth: 200 }}><div className="truncate" title={v.narration}>{v.narration || '—'}</div></td>
                          <td className="px-3 py-2 text-xs font-mono text-right font-semibold" style={{ color: 'var(--text1)' }}>{formatAmount(v.amount)}</td>
                        </tr>
                      ))}
                      {currentVouchers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>No transactions match your search</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                
                {/* Pagination */}
                {filteredVouchers.length > 0 && (
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs" style={{ color: 'var(--text3)' }}>
                      Showing {(page - 1) * limit + 1} to {Math.min(page * limit, filteredVouchers.length)} of {filteredVouchers.length.toLocaleString('en-IN')}
                      {filteredVouchers.length < stats.vouchers!.length && ` (filtered from ${stats.vouchers!.length.toLocaleString('en-IN')})`}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded text-xs disabled:opacity-30" style={{ background: 'var(--bg3)', color: 'var(--text1)' }}>Prev</button>
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded text-xs disabled:opacity-30" style={{ background: 'var(--bg3)', color: 'var(--text1)' }}>Next</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
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

  // ── Unified classification map (drives the badge across TB / P&L / BS) ─
  // Build once per analysis run + override change, then thread the same map
  // into all three tabs so the user sees a consistent category label
  // everywhere.  We collect every ledger name from the parsed TB rows and
  // every leaf from the parsed P&L / BS hierarchies, run them through the
  // classifier (which already respects overrides → master walk → BS
  // hierarchy → regex), and cache the result.
  const dataClassMap = useMemo<ClassMap>(() => {
    const m: ClassMap = new Map();
    const labelByCategory = new Map(LEDGER_CATEGORY_OPTIONS.map(o => [o.value, o.label]));

    const masterEntries = (parsedData.masterEntries as MasterEntry[] | undefined) ?? [];
    const masterMap = new Map<string, MasterEntry>();
    for (const e of masterEntries) masterMap.set(e.name.toLowerCase().trim(), e);

    const bsHierarchy = buildBSHierarchyMap(parsedData.bsheetStatement ?? null);

    function add(name: string) {
      if (!name || m.has(name)) return;
      const cls = classifyLedger(name, masterMap, state.ledgerOverrides, bsHierarchy);
      m.set(name, {
        category: cls.category,
        confidence: cls.confidence,
        label: labelByCategory.get(cls.category) ?? 'Unknown',
      });
    }

    // TB: every leaf row.
    const tbRows = (parsedData.tbRows as TBFullRow[] | undefined) ?? [];
    for (const r of tbRows) if (!r.isGroup) add(r.name);

    // Walk the financial-statement hierarchies — collect leaves only,
    // since groups don't have a meaningful category (they're rollups).
    function walk(nodes: FinancialNode[] | undefined) {
      if (!nodes) return;
      for (const n of nodes) {
        if (!n.children || n.children.length === 0) add(n.name);
        else walk(n.children);
      }
    }
    walk(parsedData.bsheetStatement?.nodes);
    walk(parsedData.pandlStatement?.nodes);

    return m;
  }, [parsedData, state.ledgerOverrides]);

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
  const tbLedgers: TBLedger[]    = pd.tbLedgers     ?? [];
  const tbRows:    TBFullRow[]   = pd.tbRows        ?? [];
  const masterEntries: MasterEntry[] = pd.masterEntries ?? [];
  const pdRaw = pd as Record<string, unknown>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text1)' }}>Data View</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
          Explore parsed Tally data in tabular form. {tbRows.length} accounts loaded.
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
          <TBTab
            tbRows={tbRows}
            masterEntries={masterEntries}
            classMap={dataClassMap}
          />
        )}
        {activeTab === 'pl' && <PLTab pd={pdRaw} classMap={dataClassMap} />}
        {activeTab === 'bs' && <BSTab pd={pdRaw} classMap={dataClassMap} />}
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
