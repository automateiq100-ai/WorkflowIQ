'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Invoice, Client, InvoiceStatus } from '@/lib/practiceiq/types';

const STATUS_COLOR: Record<InvoiceStatus, string> = {
  draft: 'var(--text3)',
  sent: 'var(--blue)',
  paid: 'var(--green)',
  overdue: 'var(--red)',
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [i, c] = await Promise.all([
      fetch('/api/practiceiq/invoices').then(r => r.json()),
      fetch('/api/practiceiq/clients').then(r => r.json()),
    ]);
    setInvoices(i.data ?? []);
    setClients(c.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const totals = {
    draft: invoices.filter(i => i.status === 'draft').reduce((s, i) => s + Number(i.total), 0),
    sent: invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + Number(i.total), 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total), 0),
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Invoices
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/practiceiq/invoices/new" className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--purple)', color: '#fff' }}>
          + Create Invoice
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Stat label="Drafts" value={totals.draft} color="var(--text3)" />
        <Stat label="Outstanding" value={totals.sent} color="var(--amber)" />
        <Stat label="Collected" value={totals.paid} color="var(--green)" />
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-4xl mb-3">🧾</div>
          <div className="text-sm" style={{ color: 'var(--text3)' }}>No invoices yet.</div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <Th>Number</Th><Th>Client</Th><Th>Issue Date</Th><Th>Due</Th><Th>Total</Th><Th>Status</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(i => {
                const client = clients.find(c => c.id === i.client_id);
                return (
                  <tr key={i.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text1)', fontFamily: 'var(--font-dm-mono)' }}>
                      <Link href={`/practiceiq/invoices/${i.id}`}>{i.invoice_number}</Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{client?.name ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{i.issue_date}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{i.due_date ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>₹{Number(i.total).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full uppercase" style={{ background: 'var(--bg3)', color: STATUS_COLOR[i.status] }}>
                        {i.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/practiceiq/invoices/${i.id}`} className="text-xs" style={{ color: 'var(--purple)' }}>
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-xl" style={{ color, fontFamily: 'var(--font-dm-serif)' }}>₹{value.toLocaleString('en-IN')}</div>
    </div>
  );
}
function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}
