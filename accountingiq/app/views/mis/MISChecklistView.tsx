'use client';

/**
 * Pre-MIS Book Closure Checklist — the 6 phases of month-end close that
 * must be done before the MIS for a period can be trusted.
 *
 * Drives a printable list the CA/accountant can tick off during close.
 * Local checkbox state only — not persisted to Supabase (per the spec).
 */

import { useState } from 'react';
import { CHART_COLORS } from './atoms';

const BOOK_CLOSURE = [
  {
    phase: 'Phase 1: Revenue & Sales Entries',
    deadline: 'Deadline: 3rd of next month',
    items: [
      { id: 'BC1_1', text: 'All sales invoices for the month entered in Tally', critical: true, type: 'Manual' },
      { id: 'BC1_2', text: 'All credit notes / sales returns entered', critical: false, type: 'Manual' },
      { id: 'BC1_3', text: 'Advance receipts correctly classified (not booked as revenue)', critical: true, type: 'Manual' },
      { id: 'BC1_4', text: 'Deferred / unbilled revenue accrued (subscriptions, AMC, projects)', critical: false, type: 'Manual' },
    ],
  },
  {
    phase: 'Phase 2: Purchase & Expense Entries',
    deadline: 'Deadline: 5th of next month',
    items: [
      { id: 'BC2_1', text: 'All purchase invoices for the month entered', critical: false, type: 'Manual' },
      { id: 'BC2_2', text: 'All expense vouchers / petty cash entered', critical: false, type: 'Manual' },
      { id: 'BC2_3', text: 'Prepaid expenses correctly split (only current month portion expensed)', critical: true, type: 'Manual' },
      { id: 'BC2_4', text: 'Accrued expenses / provisions entered via journal', critical: false, type: 'Manual' },
      { id: 'BC2_5', text: 'Purchase returns / debit notes entered', critical: false, type: 'Manual' },
    ],
  },
  {
    phase: 'Phase 3: Bank & Cash Reconciliation',
    deadline: 'Deadline: 5th of next month',
    items: [
      { id: 'BC3_1', text: 'Bank statement downloaded and reconciled with Tally', critical: true, type: 'Critical' },
      { id: 'BC3_2', text: 'Bank charges / interest entered from bank statement', critical: false, type: 'Manual' },
      { id: 'BC3_3', text: 'Cheques issued but not yet presented identified (timing difference)', critical: false, type: 'Auto-verify' },
      { id: 'BC3_4', text: 'Cash in hand physically counted and matched with Tally balance', critical: false, type: 'Manual' },
      { id: 'BC3_5', text: 'Inter-bank transfers correctly entered (not double-counted)', critical: false, type: 'Auto-verify' },
    ],
  },
  {
    phase: 'Phase 4: Statutory Entries',
    deadline: 'Deadline: 7th of next month',
    items: [
      { id: 'BC4_1', text: 'GST liability journal entries passed (output GST, ITC reversal if applicable)', critical: true, type: 'Critical' },
      { id: 'BC4_2', text: 'TDS deducted and TDS payable ledger updated (by section)', critical: false, type: 'Manual' },
      { id: 'BC4_3', text: 'PF / ESI payable entry passed (employee + employer contribution)', critical: false, type: 'Manual' },
      { id: 'BC4_4', text: 'Advance tax liability estimated and provided for', critical: false, type: 'Manual' },
    ],
  },
  {
    phase: 'Phase 5: Period-end Adjustments',
    deadline: 'Deadline: 7th of next month',
    items: [
      { id: 'BC5_1', text: 'Depreciation for the month charged (from fixed assets register)', critical: true, type: 'Critical' },
      { id: 'BC5_2', text: 'Closing stock value updated (physical / system count, valued at cost)', critical: true, type: 'Critical' },
      { id: 'BC5_3', text: 'Salary payable journal passed if salary not yet paid', critical: false, type: 'Manual' },
      { id: 'BC5_4', text: 'Interest accrued on loans (if not auto-debited)', critical: false, type: 'Manual' },
      { id: 'BC5_5', text: 'Foreign exchange revaluation (if forex debtors / creditors exist)', critical: false, type: 'Manual' },
      { id: 'BC5_6', text: 'Related party transactions verified and documented', critical: false, type: 'Manual' },
    ],
  },
  {
    phase: 'Phase 6: AccountingIQ Validation Gates',
    deadline: 'Auto-checked on upload',
    items: [
      { id: 'BC6_2', text: 'No Suspense ledger balances outstanding → Check B1', critical: true, type: 'Auto-verify' },
      { id: 'BC6_3', text: 'P&L net profit = Balance Sheet retained earnings → Check D2', critical: true, type: 'Auto-verify' },
      { id: 'BC6_5', text: 'AccountingIQ Step 1 score ≥ 50 (below 50 = books too unreliable for MIS)', critical: true, type: 'Auto-verify' },
    ],
  },
];

export default function MISChecklistView() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const totalItems = BOOK_CLOSURE.flatMap(p => p.items).length;
  const completedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Book Closure Checklist
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            {completedCount} / {totalItems} completed — finish this before generating the MIS for the period.
          </p>
        </div>
        <button onClick={() => window.print()}
          className="text-xs px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
          🖨 Print
        </button>
      </div>

      <div className="h-2 rounded-full" style={{ background: 'var(--bg4)' }}>
        <div className="h-full rounded-full transition-all" style={{
          width: `${(completedCount / totalItems) * 100}%`,
          background: CHART_COLORS.teal,
        }} />
      </div>

      {BOOK_CLOSURE.map(phase => (
        <div key={phase.phase} className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}>
            <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{phase.phase}</div>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>{phase.deadline}</div>
          </div>
          {phase.items.map(item => (
            <label key={item.id}
              className="flex items-start gap-3 px-5 py-3 border-b cursor-pointer transition-colors"
              style={{
                borderColor: 'var(--border)',
                background: checked[item.id] ? 'rgba(76,175,121,0.05)' : 'transparent',
              }}>
              <input type="checkbox"
                checked={!!checked[item.id]}
                onChange={() => setChecked(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                className="mt-0.5 shrink-0"
                style={{ accentColor: CHART_COLORS.teal }} />
              <div className="flex-1">
                <span className="text-xs" style={{
                  color: checked[item.id] ? 'var(--text3)' : 'var(--text1)',
                  textDecoration: checked[item.id] ? 'line-through' : 'none',
                }}>{item.text}</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                    background: item.type === 'Auto-verify' ? 'rgba(76,175,121,0.12)' : item.critical ? 'rgba(240,72,72,0.12)' : 'var(--bg4)',
                    color: item.type === 'Auto-verify' ? CHART_COLORS.green : item.critical ? CHART_COLORS.red : 'var(--text3)',
                  }}>
                    {item.type}
                  </span>
                  {item.critical && (
                    <span className="text-[10px]" style={{ color: CHART_COLORS.red }}>Critical</span>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
