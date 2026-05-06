'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { Employee, Department, EmployeeStatus } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

export default function ViewEmployeePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  async function load() {
    setLoading(true);
    const [e, d] = await Promise.all([
      fetch(api('/api/practiceiq/hrms/employees')).then(r => r.json()),
      fetch(api('/api/practiceiq/hrms/departments')).then(r => r.json()),
    ]);
    setEmployees(e.data ?? []);
    setDepartments(d.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      e.full_name.toLowerCase().includes(q)
      || (e.email ?? '').toLowerCase().includes(q)
      || e.employee_code.toLowerCase().includes(q)
      || (e.designation ?? '').toLowerCase().includes(q)
    );
  }, [employees, search]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>HRMS</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>{employees.length} employee{employees.length === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--purple)', color: '#fff' }}
        >
          + Add employee
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <NavTile href="/hrms" label="View Employee" emoji="👥" active />
        <NavTile href="/hrms/hierarchy" label="Employee Hierarchy" emoji="🌳" />
        <NavTile href="/hrms/leave" label="My Leave" emoji="🌴" />
        <NavTile href="/hrms/attendance" label="My Attendance" emoji="🕒" />
        <NavTile href="/hrms/expense" label="My Expense" emoji="💸" />
        <NavTile href="/hrms/approvals" label="Manager Approval" emoji="✅" />
        <NavTile href="/hrms/reports" label="Manager Reports" emoji="📈" />
        <NavTile href="/hrms/timesheet" label="Timesheet" emoji="⏱️" />
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, code, designation…"
        style={inputStyle}
        className="text-sm mb-4 max-w-md"
      />

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(e => (
            <button
              key={e.id}
              onClick={() => { setEditing(e); setShowForm(true); }}
              className="rounded-xl border p-4 text-left"
              style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                  style={{ background: 'var(--bg3)', color: 'var(--purple)' }}
                >
                  {e.full_name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'E'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: 'var(--text1)' }}>{e.full_name}</div>
                  <div className="text-xs font-mono" style={{ color: 'var(--text3)' }}>{e.employee_code}</div>
                </div>
                <StatusPill status={e.status} />
              </div>
              <div className="text-xs" style={{ color: 'var(--text2)' }}>
                {e.designation ?? '—'}
                {e.department_id && (
                  <> · <span style={{ color: 'var(--text3)' }}>{departments.find(d => d.id === e.department_id)?.name ?? '—'}</span></>
                )}
              </div>
              {e.email && <div className="text-xs mt-1 truncate" style={{ color: 'var(--text3)' }}>{e.email}</div>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-sm col-span-full text-center py-12" style={{ color: 'var(--text3)' }}>
              No employees{search ? ' match this search' : ' yet'}.
            </div>
          )}
        </div>
      )}

      {showForm && (
        <EmployeeForm
          initial={editing}
          employees={employees}
          departments={departments}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function NavTile({ href, label, emoji, active }: { href: string; label: string; emoji: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className="rounded-xl border p-4 flex items-center gap-3"
      style={{
        background: active ? 'var(--bg3)' : 'var(--bg2)',
        borderColor: active ? 'var(--purple)' : 'var(--border)',
      }}
    >
      <div className="text-2xl">{emoji}</div>
      <div className="text-sm" style={{ color: 'var(--text1)' }}>{label}</div>
    </Link>
  );
}

function StatusPill({ status }: { status: EmployeeStatus }) {
  const color = status === 'active' ? 'var(--green)' : 'var(--text3)';
  return (
    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded" style={{ background: 'var(--bg3)', color }}>
      {status}
    </span>
  );
}

function EmployeeForm({ initial, employees, departments, onClose, onSaved }: {
  initial: Employee | null;
  employees: Employee[];
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Employee>>(initial ?? { status: 'active' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const url = initial?.id
      ? api(`/api/practiceiq/hrms/employees/${initial.id}`)
      : api('/api/practiceiq/hrms/employees');
    const method = initial?.id ? 'PATCH' : 'POST';
    await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        manager_id: form.manager_id || null,
        department_id: form.department_id || null,
        date_of_joining: form.date_of_joining || null,
      }),
    });
    setSaving(false);
    onSaved();
  }

  async function del() {
    if (!initial?.id) return;
    if (!confirm('Delete this employee?')) return;
    await fetch(api(`/api/practiceiq/hrms/employees/${initial.id}`), { method: 'DELETE' });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-xl" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          {initial?.id ? `Edit ${initial.employee_code}` : 'New Employee'}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name *"><input value={form.full_name ?? ''} onChange={e => setForm({ ...form, full_name: e.target.value })} style={inputStyle} /></Field>
          <Field label="Email"><input type="email" value={form.email ?? ''} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} /></Field>
          <Field label="Phone"><input value={form.phone ?? ''} onChange={e => setForm({ ...form, phone: e.target.value })} style={inputStyle} /></Field>
          <Field label="Designation"><input value={form.designation ?? ''} onChange={e => setForm({ ...form, designation: e.target.value })} style={inputStyle} /></Field>
          <Field label="Department">
            <select value={form.department_id ?? ''} onChange={e => setForm({ ...form, department_id: e.target.value || null })} style={inputStyle}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Manager">
            <select value={form.manager_id ?? ''} onChange={e => setForm({ ...form, manager_id: e.target.value || null })} style={inputStyle}>
              <option value="">— None —</option>
              {employees.filter(e => e.id !== initial?.id).map(e => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>
              ))}
            </select>
          </Field>
          <Field label="Date of joining"><input type="date" value={form.date_of_joining ?? ''} onChange={e => setForm({ ...form, date_of_joining: e.target.value })} style={inputStyle} /></Field>
          <Field label="Status">
            <select value={form.status ?? 'active'} onChange={e => setForm({ ...form, status: e.target.value as EmployeeStatus })} style={inputStyle}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>
        <div className="mt-6 flex justify-between">
          {initial?.id ? <button onClick={del} className="px-3 py-2 text-xs" style={{ color: 'var(--red)' }}>Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
            <button onClick={save} disabled={saving || !form.full_name} className="px-4 py-2 text-sm rounded-lg" style={{ background: 'var(--purple)', color: '#fff', opacity: saving || !form.full_name ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>{children}</label>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', fontSize: 13,
};
