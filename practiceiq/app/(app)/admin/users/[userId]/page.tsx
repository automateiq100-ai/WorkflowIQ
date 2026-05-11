'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Role, FirmUser, Client } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

export default function ManageMemberPage() {
  const params = useParams<{ userId: string }>();
  const userId = params?.userId;
  const [member, setMember] = useState<FirmUser | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState(false);
  const [savingClients, setSavingClients] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (!userId) return;
    setLoading(true);
    const [usersRes, rolesRes, clientsRes, assignRes] = await Promise.all([
      fetch(api('/api/practiceiq/admin/users')).then(r => r.json()),
      fetch(api('/api/practiceiq/admin/roles')).then(r => r.json()),
      fetch(api('/api/practiceiq/clients')).then(r => r.json()),
      fetch(api(`/api/practiceiq/admin/users/${userId}/client-assignments`)).then(r => r.json()),
    ]);
    setMember((usersRes.data ?? []).find((m: FirmUser) => m.user_id === userId) ?? null);
    setRoles(rolesRes.data?.roles ?? []);
    setClients(clientsRes.data ?? []);
    setAssigned(new Set((assignRes.data ?? []).map((a: { client_id: string }) => a.client_id)));
    setLoading(false);
  }

  useEffect(() => { load(); }, [userId]);

  async function setRole(roleId: string) {
    if (!userId) return;
    setSavingRole(true);
    setMsg(null);
    const res = await fetch(api(`/api/practiceiq/admin/users/${userId}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role_id: roleId }),
    });
    setSavingRole(false);
    if (res.ok) {
      setMsg('✓ Role updated');
      load();
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(`Failed: ${j.error ?? res.status}`);
    }
  }

  function toggleClient(clientId: string) {
    setAssigned(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
      return next;
    });
  }

  async function saveAssignments() {
    if (!userId) return;
    setSavingClients(true);
    setMsg(null);
    const res = await fetch(api(`/api/practiceiq/admin/users/${userId}/client-assignments`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_ids: Array.from(assigned) }),
    });
    setSavingClients(false);
    if (res.ok) setMsg('✓ Client assignments saved');
    else setMsg('Failed to save assignments');
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>;
  if (!member) return <div className="p-8 text-sm" style={{ color: 'var(--red)' }}>Member not found.</div>;

  // Look up the current role_id for the member by matching role text against system_key
  // (this works because the trigger keeps role text in sync with role.system_key | role.name).
  const currentRole = roles.find(r => r.is_system && r.system_key === member.role)
    ?? roles.find(r => r.name === member.role)
    ?? null;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        {member.email ?? 'Member'}
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Manage this member's role and client assignments.
      </p>

      <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Role</div>
        <div className="space-y-2">
          {roles.map(r => (
            <label key={r.id} className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="role"
                checked={currentRole?.id === r.id}
                onChange={() => setRole(r.id)}
                disabled={savingRole}
              />
              <div>
                <div className="text-sm" style={{ color: 'var(--text1)' }}>
                  {r.name}{r.is_system && <span className="ml-2 text-[10px] uppercase" style={{ color: 'var(--text3)' }}>system</span>}
                </div>
                {r.description && (
                  <div className="text-xs" style={{ color: 'var(--text3)' }}>{r.description}</div>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      {currentRole?.restrict_to_assigned_clients && (
        <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>
            Client assignments ({assigned.size}/{clients.length})
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--text3)' }}>
            This role is restricted. The member will see only the clients (and their tasks, documents, invoices) checked below.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
            {clients.map(c => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer rounded p-2"
                style={{ background: assigned.has(c.id) ? 'var(--bg3)' : 'transparent', color: 'var(--text1)' }}>
                <input
                  type="checkbox"
                  checked={assigned.has(c.id)}
                  onChange={() => toggleClient(c.id)}
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <button
              onClick={saveAssignments}
              disabled={savingClients}
              className="px-4 py-2 text-sm rounded-lg"
              style={{ background: 'var(--purple)', color: '#fff', opacity: savingClients ? 0.5 : 1 }}
            >
              {savingClients ? 'Saving…' : 'Save assignments'}
            </button>
          </div>
        </div>
      )}

      {msg && <div className="text-xs" style={{ color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</div>}
    </div>
  );
}
