'use client';

import { useEffect, useState, useMemo } from 'react';
import type { Employee } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

type Node = { employee: Employee; children: Node[] };

export default function HierarchyPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(api('/api/practiceiq/hrms/employees'))
      .then(r => r.json())
      .then(j => setEmployees(j.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  // Build forest. Roots = employees with no manager_id (or manager_id pointing
  // outside this firm — defensive).
  const roots = useMemo<Node[]>(() => {
    const byId = new Map<string, Node>(employees.map(e => [e.id, { employee: e, children: [] }]));
    const out: Node[] = [];
    for (const e of employees) {
      const node = byId.get(e.id)!;
      if (e.manager_id && byId.has(e.manager_id)) {
        byId.get(e.manager_id)!.children.push(node);
      } else {
        out.push(node);
      }
    }
    return out;
  }, [employees]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Employee Hierarchy</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Tree view derived from each employee's reporting manager.
      </p>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : roots.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--text3)' }}>No employees yet.</div>
      ) : (
        <div className="rounded-xl border p-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <ul className="list-none m-0 p-0">
            {roots.map(r => <Branch key={r.employee.id} node={r} depth={0} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Branch({ node, depth }: { node: Node; depth: number }) {
  return (
    <li className="my-2" style={{ paddingLeft: depth * 24 }}>
      <div
        className="inline-flex items-center gap-3 rounded-lg border px-3 py-2"
        style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}
      >
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: 'var(--bg4)', color: 'var(--purple)' }}>
          {node.employee.full_name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'E'}
        </div>
        <div>
          <div className="text-sm" style={{ color: 'var(--text1)' }}>{node.employee.full_name}</div>
          <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
            {node.employee.designation ?? '—'} · <span className="font-mono">{node.employee.employee_code}</span>
          </div>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="list-none m-0 p-0 mt-1" style={{ borderLeft: '1px dashed var(--border)', marginLeft: 14 }}>
          {node.children.map(c => <Branch key={c.employee.id} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}
