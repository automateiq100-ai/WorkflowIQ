'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FirmUser, FirmInvite, FirmRole } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

const ROLES: FirmRole[] = ['admin', 'dept_head', 'staff', 'hr_admin'];

export default function AdminUsersPage() {
  const [members, setMembers] = useState<FirmUser[]>([]);
  const [invites, setInvites] = useState<FirmInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<FirmRole>('staff');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [u, i] = await Promise.all([
      fetch(api('/api/practiceiq/admin/users')).then(r => r.json()),
      fetch(api('/api/practiceiq/admin/invites')).then(r => r.json()),
    ]);
    setMembers(u.data ?? []);
    setInvites(i.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function invite() {
    setErr(null);
    setMsg(null);
    if (!inviteEmail.trim()) { setErr('Email required'); return; }
    setCreating(true);
    const res = await fetch(api('/api/practiceiq/admin/invites'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), role: inviteRole }),
    }).then(r => r.json());
    setCreating(false);
    if (res.error) { setErr(res.error); return; }
    setInviteEmail('');
    if (res.data?.email_sent) {
      setMsg(`✓ Invite sent to ${res.data.invite.email}.`);
    } else {
      const why = res.data?.email_error ? ` (email send failed: ${res.data.email_error})` : '';
      setMsg(`Invite created for ${res.data.invite.email}${why}. They'll be added on first sign-in.`);
    }
    await load();
  }

  async function revokeInvite(token: string) {
    if (!confirm('Revoke this invite?')) return;
    await fetch(api(`/api/practiceiq/admin/invites/${token}`), { method: 'DELETE' });
    await load();
  }

  async function removeMember(userId: string) {
    if (!confirm('Remove this user from the firm?')) return;
    const res = await fetch(api(`/api/practiceiq/admin/users/${userId}`), { method: 'DELETE' }).then(r => r.json());
    if (res.error) { setErr(res.error); return; }
    await load();
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>;

  const isSolo = members.length === 1 && invites.length === 0;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Team</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        {isSolo
          ? 'You are the only user in this firm. Invite a partner or staff member when you are ready.'
          : `${members.length} member${members.length === 1 ? '' : 's'}${invites.length ? ` · ${invites.length} pending invite${invites.length === 1 ? '' : 's'}` : ''}.`}
      </p>

      <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Members ({members.length})</div>
        {members.map(m => (
          <div key={m.user_id} className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-sm" style={{ color: 'var(--text1)' }}>{m.email ?? <span style={{ color: 'var(--text3)' }}>(no email)</span>}</div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                {m.role}{m.department_id ? ` · dept ${m.department_id.slice(0, 6)}…` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/admin/users/${m.user_id}`}
                className="text-xs"
                style={{ color: 'var(--purple)' }}
              >
                Manage
              </Link>
              {m.role !== 'admin' && (
                <button onClick={() => removeMember(m.user_id)} className="text-xs" style={{ color: 'var(--red)' }}>Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Invite a user</div>
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[200px]">
            <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Email</div>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="partner@firm.in"
              style={input}
            />
          </label>
          <label>
            <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Role</div>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as FirmRole)} style={input}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button
            onClick={invite}
            disabled={creating}
            className="px-4 py-2 text-sm rounded-lg"
            style={{ background: 'var(--purple)', color: '#fff', opacity: creating ? 0.5 : 1 }}
          >
            {creating ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        {msg && <div className="text-xs mt-3" style={{ color: 'var(--green)' }}>{msg}</div>}
        {err && <div className="text-xs mt-3" style={{ color: 'var(--red)' }}>{err}</div>}
      </div>

      {invites.length > 0 && (
        <div className="rounded-xl border p-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Pending invites ({invites.length})</div>
          {invites.map(inv => (
            <div key={inv.token} className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="text-sm" style={{ color: 'var(--text1)' }}>{inv.email}</div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => revokeInvite(inv.token)} className="text-xs" style={{ color: 'var(--red)' }}>Revoke</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const input: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)', fontSize: 13 };
