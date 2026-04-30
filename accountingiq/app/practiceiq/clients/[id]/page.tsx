'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Client, Task, Invoice } from '@/lib/practiceiq/types';
import { ClientForm } from '../page';

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editing, setEditing] = useState(false);

  async function load() {
    const [c, t, i] = await Promise.all([
      fetch(`/api/practiceiq/clients/${id}`).then(r => r.json()),
      fetch(`/api/practiceiq/tasks?client_id=${id}`).then(r => r.json()),
      fetch(`/api/practiceiq/invoices?client_id=${id}`).then(r => r.json()),
    ]);
    setClient(c.data ?? null);
    setTasks(t.data ?? []);
    setInvoices(i.data ?? []);
  }

  useEffect(() => { load(); }, [id]);

  async function handleDelete() {
    if (!confirm('Delete this client and all linked tasks/invoices?')) return;
    await fetch(`/api/practiceiq/clients/${id}`, { method: 'DELETE' });
    router.push('/practiceiq/clients');
  }

  if (!client) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/practiceiq/clients" className="text-xs mb-4 inline-block" style={{ color: 'var(--text3)' }}>
        ← All clients
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            {client.name}
          </h1>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            {client.client_type} {client.pan && `· PAN ${client.pan}`} {client.gstin && `· GSTIN ${client.gstin}`}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs rounded" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>
            Edit
          </button>
          <button onClick={handleDelete} className="px-3 py-1.5 text-xs rounded" style={{ background: 'var(--bg3)', color: 'var(--red)' }}>
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Box title="Contact">
          <Row k="Email" v={client.email} />
          <Row k="Phone" v={client.phone} />
          <Row k="Address" v={client.address} />
          <Row k="Assigned to" v={client.assigned_to} />
        </Box>
        <Box title="Services">
          <div className="flex flex-wrap gap-1.5">
            {(client.services ?? []).map(s => (
              <span key={s} className="text-xs px-2 py-0.5 rounded-full uppercase" style={{ background: 'var(--bg3)', color: 'var(--purple)' }}>
                {s}
              </span>
            ))}
            {!client.services?.length && <div className="text-xs" style={{ color: 'var(--text3)' }}>None</div>}
          </div>
          {client.notes && (
            <div className="mt-3 text-xs" style={{ color: 'var(--text2)' }}>{client.notes}</div>
          )}
        </Box>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Box title={`Tasks (${tasks.length})`}>
          {tasks.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>No tasks yet.</div>
          ) : tasks.slice(0, 6).map(t => (
            <div key={t.id} className="flex justify-between text-xs py-1.5">
              <span style={{ color: 'var(--text1)' }}>{t.title}</span>
              <span style={{ color: 'var(--text3)' }}>{t.status} · {t.due_date ?? '—'}</span>
            </div>
          ))}
        </Box>
        <Box title={`Invoices (${invoices.length})`}>
          {invoices.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>No invoices yet.</div>
          ) : invoices.slice(0, 6).map(i => (
            <div key={i.id} className="flex justify-between text-xs py-1.5">
              <span style={{ color: 'var(--text1)' }}>{i.invoice_number}</span>
              <span style={{ color: 'var(--text3)' }}>₹{Number(i.total).toLocaleString('en-IN')} · {i.status}</span>
            </div>
          ))}
        </Box>
      </div>

      {editing && (
        <ClientForm
          initial={client}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span style={{ color: 'var(--text3)' }}>{k}</span>
      <span style={{ color: 'var(--text1)' }}>{v ?? '—'}</span>
    </div>
  );
}
