'use client';

import { useEffect, useState } from 'react';
import type { Role, PermissionModule, PermissionMap } from '@/lib/practiceiq/types';
import { ALL_PERMISSION_MODULES } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard:  'Dashboard',
  clients:    'Clients',
  services:   'Services',
  calendar:   'Calendar',
  tasks:      'Tasks',
  documents:  'Documents',
  invoices:   'Invoices',
  hrms:       'HRMS (own data)',
  hrms_admin: 'HRMS Admin (all employees)',
  admin:      'Firm Admin',
  reports:    'Reports',
};

type PermissionRow = { role_id: string; module: PermissionModule; can_read: boolean; can_write: boolean };

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionsByRole, setPermissionsByRole] = useState<Record<string, PermissionMap>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  async function load() {
    setLoading(true);
    const r = await fetch(api('/api/practiceiq/admin/roles')).then(r => r.json());
    const list: Role[] = r.data?.roles ?? [];
    const perms: PermissionRow[] = r.data?.permissions ?? [];
    const map: Record<string, PermissionMap> = {};
    for (const role of list) {
      map[role.id] = ALL_PERMISSION_MODULES.reduce((acc, m) => {
        acc[m] = { can_read: false, can_write: false };
        return acc;
      }, {} as PermissionMap);
    }
    for (const p of perms) {
      if (!map[p.role_id]) continue;
      map[p.role_id][p.module] = { can_read: p.can_read, can_write: p.can_write };
    }
    setRoles(list);
    setPermissionsByRole(map);
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function togglePerm(module: PermissionModule, kind: 'can_read' | 'can_write') {
    if (!selectedId) return;
    setPermissionsByRole(prev => {
      const current = prev[selectedId] ?? ({} as PermissionMap);
      const updated = { ...current };
      const before = updated[module] ?? { can_read: false, can_write: false };
      const next = { ...before, [kind]: !before[kind] };
      // Write implies read in the UI for clarity.
      if (kind === 'can_write' && next.can_write) next.can_read = true;
      if (kind === 'can_read' && !next.can_read) next.can_write = false;
      updated[module] = next;
      return { ...prev, [selectedId]: updated };
    });
  }

  function setRestrictFlag(value: boolean) {
    if (!selectedId) return;
    setRoles(prev => prev.map(r => r.id === selectedId ? { ...r, restrict_to_assigned_clients: value } : r));
  }

  async function save() {
    if (!selectedId) return;
    setSaving(true);
    setMsg(null);
    const role = roles.find(r => r.id === selectedId);
    const perms = permissionsByRole[selectedId];
    if (!role || !perms) { setSaving(false); return; }

    const [permRes, roleRes] = await Promise.all([
      fetch(api(`/api/practiceiq/admin/roles/${selectedId}/permissions`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissions: perms }),
      }),
      fetch(api(`/api/practiceiq/admin/roles/${selectedId}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: role.name,
          description: role.description,
          restrict_to_assigned_clients: role.restrict_to_assigned_clients,
        }),
      }),
    ]);
    setSaving(false);
    if (permRes.ok && roleRes.ok) setMsg('✓ Saved');
    else setMsg('Save failed');
  }

  async function createRole() {
    if (!newName.trim()) return;
    setCreating(true);
    setMsg(null);
    const res = await fetch(api('/api/practiceiq/admin/roles'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setCreating(false);
    if (res.ok) {
      const j = await res.json();
      setNewName('');
      await load();
      if (j.data?.id) setSelectedId(j.data.id);
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(`Failed: ${j.error ?? res.status}`);
    }
  }

  async function deleteRole() {
    if (!selectedId) return;
    const role = roles.find(r => r.id === selectedId);
    if (!role || role.is_system) return;
    if (!confirm(`Delete role "${role.name}"?`)) return;
    const res = await fetch(api(`/api/practiceiq/admin/roles/${selectedId}`), { method: 'DELETE' });
    if (res.ok) {
      setSelectedId(null);
      await load();
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(`Delete failed: ${j.error ?? res.status}`);
    }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>;

  const selected = roles.find(r => r.id === selectedId) ?? null;
  const perms = selectedId ? permissionsByRole[selectedId] : null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Roles &amp; Permissions</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Define the access matrix per role. Members inherit module permissions from their role; write implies read.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left: role list */}
        <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Roles</div>
          <div className="space-y-1 mb-4">
            {roles.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className="w-full text-left rounded-md px-3 py-2"
                style={{
                  background: selectedId === r.id ? 'var(--bg3)' : 'transparent',
                  border: '1px solid',
                  borderColor: selectedId === r.id ? 'var(--purple)' : 'transparent',
                  color: 'var(--text1)',
                }}
              >
                <div className="text-sm">{r.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
                  {r.is_system ? 'system' : 'custom'}
                  {r.restrict_to_assigned_clients ? ' · client-restricted' : ''}
                </div>
              </button>
            ))}
          </div>
          <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New role name"
              style={inputStyle}
              className="text-sm mb-2"
            />
            <button
              onClick={createRole}
              disabled={creating || !newName.trim()}
              className="w-full px-3 py-2 text-xs rounded-md font-semibold"
              style={{ background: 'var(--purple)', color: '#fff', opacity: creating ? 0.5 : 1 }}
            >
              {creating ? 'Creating…' : '+ Create role'}
            </button>
          </div>
        </div>

        {/* Right: editor */}
        <div className="md:col-span-2 rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          {!selected || !perms ? (
            <div className="text-sm" style={{ color: 'var(--text3)' }}>Select a role to edit.</div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-lg" style={{ color: 'var(--text1)' }}>{selected.name}</div>
                  {selected.description && (
                    <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>{selected.description}</div>
                  )}
                </div>
                {!selected.is_system && (
                  <button onClick={deleteRole} className="text-xs" style={{ color: 'var(--red)' }}>Delete role</button>
                )}
              </div>

              <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer" style={{ color: 'var(--text1)' }}>
                <input
                  type="checkbox"
                  checked={selected.restrict_to_assigned_clients}
                  onChange={e => setRestrictFlag(e.target.checked)}
                />
                <span>Restrict members of this role to assigned clients only</span>
              </label>

              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <table className="w-full text-sm">
                  <thead style={{ background: 'var(--bg3)' }}>
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: 'var(--text3)' }}>Module</th>
                      <th className="px-3 py-2 text-center text-xs font-medium" style={{ color: 'var(--text3)' }}>Read</th>
                      <th className="px-3 py-2 text-center text-xs font-medium" style={{ color: 'var(--text3)' }}>Write</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_PERMISSION_MODULES.map(m => {
                      const cur = perms[m] ?? { can_read: false, can_write: false };
                      return (
                        <tr key={m} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-3 py-2" style={{ color: 'var(--text1)' }}>{MODULE_LABELS[m]}</td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={cur.can_read} onChange={() => togglePerm(m, 'can_read')} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={cur.can_write} onChange={() => togglePerm(m, 'can_write')} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-lg"
                  style={{ background: 'var(--purple)', color: '#fff', opacity: saving ? 0.5 : 1 }}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </>
          )}
          {msg && <div className="text-xs mt-2" style={{ color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', fontSize: 13,
};
