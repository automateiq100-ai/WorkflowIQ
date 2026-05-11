'use client';

import { useEffect, useState, useMemo } from 'react';
import type { AttendanceRecord, LeaveRequest, TimesheetEntry, Employee } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

export default function ManagerReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [timesheet, setTimesheet] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const j = await fetch(api(`/api/practiceiq/hrms/manager/reports?from=${from}&to=${to}`)).then(r => r.json());
    setEmployees(j.data?.employees ?? []);
    setAttendance(j.data?.attendance ?? []);
    setLeaves(j.data?.leaves ?? []);
    setTimesheet(j.data?.timesheet ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  // Attendance: group by employee → present days count.
  const presentByEmp = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attendance) {
      if (!a.check_in_at) continue;
      m.set(a.employee_id, (m.get(a.employee_id) ?? 0) + 1);
    }
    return m;
  }, [attendance]);

  // Leaves: group by type per employee.
  const leaveByEmp = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const l of leaves) {
      const cur = m.get(l.employee_id) ?? {};
      cur[l.leave_type] = (cur[l.leave_type] ?? 0) + Number(l.days);
      m.set(l.employee_id, cur);
    }
    return m;
  }, [leaves]);

  // Timesheet: billable / non-billable / total hours per employee.
  const tsByEmp = useMemo(() => {
    const m = new Map<string, { billable: number; nonBillable: number; total: number }>();
    for (const t of timesheet) {
      const cur = m.get(t.employee_id) ?? { billable: 0, nonBillable: 0, total: 0 };
      const h = Number(t.hours);
      cur.total += h;
      if (t.billable) cur.billable += h; else cur.nonBillable += h;
      m.set(t.employee_id, cur);
    }
    return m;
  }, [timesheet]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Manager Reports</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>Aggregate attendance, leave, and timesheet for the selected window.</p>

      <div className="flex items-end gap-3 mb-6">
        <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} /></Field>
        <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} /></Field>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : employees.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--text3)' }}>No visible employees.</div>
      ) : (
        <>
          <Section title="Attendance — present days">
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--bg3)' }}><tr><Th>Employee</Th><Th>Code</Th><Th>Designation</Th><Th>Present days</Th></tr></thead>
              <tbody>
                {employees.map(e => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2" style={{ color: 'var(--text1)' }}>{e.full_name}</td>
                    <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text3)' }}>{e.employee_code}</td>
                    <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>{e.designation ?? '—'}</td>
                    <td className="px-4 py-2" style={{ color: 'var(--text1)' }}>{presentByEmp.get(e.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Leaves taken">
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--bg3)' }}><tr><Th>Employee</Th><Th>Casual</Th><Th>Sick</Th><Th>Earned</Th><Th>Unpaid</Th></tr></thead>
              <tbody>
                {employees.map(e => {
                  const r = leaveByEmp.get(e.id) ?? {};
                  return (
                    <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-4 py-2" style={{ color: 'var(--text1)' }}>{e.full_name}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>{r['casual'] ?? 0}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>{r['sick'] ?? 0}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>{r['earned'] ?? 0}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text2)' }}>{r['unpaid'] ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section title="Timesheet — hours">
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--bg3)' }}><tr><Th>Employee</Th><Th>Billable</Th><Th>Non-billable</Th><Th>Total</Th></tr></thead>
              <tbody>
                {employees.map(e => {
                  const r = tsByEmp.get(e.id) ?? { billable: 0, nonBillable: 0, total: 0 };
                  return (
                    <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-4 py-2" style={{ color: 'var(--text1)' }}>{e.full_name}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--green)' }}>{r.billable.toFixed(2)}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text3)' }}>{r.nonBillable.toFixed(2)}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text1)' }}>{r.total.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border mb-6 overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="px-4 py-3 border-b text-xs uppercase font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
        {title}
      </div>
      {/* Horizontal scroll on narrow screens so wide rows don't break the layout */}
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>{children}</label>;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', fontSize: 13,
};
