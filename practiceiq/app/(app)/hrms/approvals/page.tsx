'use client';

import { useEffect, useState, useMemo } from 'react';
import type { LeaveRequest, ExpenseClaim, Employee } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

type Tab = 'leave' | 'expense';

export default function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('leave');
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [expenses, setExpenses] = useState<ExpenseClaim[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const j = await fetch(api('/api/practiceiq/hrms/manager/approvals')).then(r => r.json());
    setMyEmployeeId(j.data?.my_employee_id ?? null);
    setLeaves(j.data?.leaves ?? []);
    setExpenses(j.data?.expenses ?? []);
    setEmployees(j.data?.employees ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  // Filter to "my reports" — anyone whose manager_id = my employee id.
  // (RLS may already restrict, but this is what the UI labels as "Manager Approval".)
  const myReportIds = useMemo(() => new Set(
    employees.filter(e => myEmployeeId && e.manager_id === myEmployeeId).map(e => e.id),
  ), [employees, myEmployeeId]);

  const visibleLeaves = leaves.filter(l => myReportIds.has(l.employee_id) || !myEmployeeId);
  const visibleExpenses = expenses.filter(e => myReportIds.has(e.employee_id) || !myEmployeeId);

  async function decideLeave(id: string, decision: 'approved' | 'rejected') {
    await fetch(api(`/api/practiceiq/hrms/leave-requests/${id}/decide`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    load();
  }

  async function decideExpense(id: string, decision: 'approved' | 'rejected') {
    await fetch(api(`/api/practiceiq/hrms/expense-claims/${id}/decide`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    load();
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Manager Approval</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>Pending leave and expense decisions for your direct reports.</p>

      <div className="flex gap-2 mb-4">
        <TabBtn active={tab === 'leave'} onClick={() => setTab('leave')}>Leave ({visibleLeaves.length})</TabBtn>
        <TabBtn active={tab === 'expense'} onClick={() => setTab('expense')}>Expense ({visibleExpenses.length})</TabBtn>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : tab === 'leave' ? (
        <ListContainer>
          {visibleLeaves.map(l => (
            <div key={l.id} className="flex items-center justify-between border-b py-3 last:border-0" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="text-sm" style={{ color: 'var(--text1)' }}>
                  {empById.get(l.employee_id)?.full_name ?? 'Unknown'} — <span className="capitalize">{l.leave_type}</span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {l.from_date} → {l.to_date} ({l.days} days){l.reason ? ` · ${l.reason}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => decideLeave(l.id, 'approved')} className="px-3 py-1 text-xs rounded" style={{ background: 'var(--green)', color: '#0e0f11' }}>Approve</button>
                <button onClick={() => decideLeave(l.id, 'rejected')} className="px-3 py-1 text-xs rounded" style={{ background: 'var(--red)', color: '#fff' }}>Reject</button>
              </div>
            </div>
          ))}
          {visibleLeaves.length === 0 && <Empty>No pending leave requests.</Empty>}
        </ListContainer>
      ) : (
        <ListContainer>
          {visibleExpenses.map(e => (
            <div key={e.id} className="flex items-center justify-between border-b py-3 last:border-0" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="text-sm" style={{ color: 'var(--text1)' }}>
                  {empById.get(e.employee_id)?.full_name ?? 'Unknown'} — ₹{Number(e.amount).toLocaleString('en-IN')} <span className="capitalize" style={{ color: 'var(--text3)' }}>({e.category})</span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {e.claim_date}{e.description ? ` · ${e.description}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => decideExpense(e.id, 'approved')} className="px-3 py-1 text-xs rounded" style={{ background: 'var(--green)', color: '#0e0f11' }}>Approve</button>
                <button onClick={() => decideExpense(e.id, 'rejected')} className="px-3 py-1 text-xs rounded" style={{ background: 'var(--red)', color: '#fff' }}>Reject</button>
              </div>
            </div>
          ))}
          {visibleExpenses.length === 0 && <Empty>No pending expense claims.</Empty>}
        </ListContainer>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-md text-sm font-semibold"
      style={{
        background: active ? 'var(--purple)' : 'var(--bg3)',
        color: active ? '#fff' : 'var(--text2)',
      }}
    >
      {children}
    </button>
  );
}

function ListContainer({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border px-5 py-1" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm" style={{ color: 'var(--text3)' }}>{children}</div>;
}
