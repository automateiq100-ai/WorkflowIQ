'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Invoice, Client, ClientEmail, FirmSettings, InvoiceStatus } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue'];

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [primaryEmail, setPrimaryEmail] = useState<string | null>(null);
  const [settings, setSettings] = useState<FirmSettings | null>(null);

  async function load() {
    const i = await fetch(api(`/api/practiceiq/invoices/${id}`)).then(r => r.json());
    setInv(i.data ?? null);
    if (i.data?.client_id) {
      const [c, em] = await Promise.all([
        fetch(api(`/api/practiceiq/clients/${i.data.client_id}`)).then(r => r.json()),
        fetch(api(`/api/practiceiq/clients/${i.data.client_id}/emails`)).then(r => r.json()),
      ]);
      setClient(c.data ?? null);
      const list: ClientEmail[] = em.data ?? [];
      const primary = list.find(e => e.is_primary) ?? list[0];
      setPrimaryEmail(primary?.email ?? null);
    }
    const s = await fetch(api('/api/practiceiq/settings')).then(r => r.json());
    setSettings(s.data ?? null);
  }

  useEffect(() => { load(); }, [id]);

  async function setStatus(status: InvoiceStatus) {
    await fetch(api(`/api/practiceiq/invoices/${id}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
    load();
  }

  async function del() {
    if (!confirm('Delete this invoice?')) return;
    await fetch(api(`/api/practiceiq/invoices/${id}`), { method: 'DELETE' });
    router.push('/invoices');
  }

  if (!inv) return <div className="p-8 text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="print:hidden mb-4 flex items-center justify-between">
        <Link href="/invoices" className="text-xs" style={{ color: 'var(--text3)' }}>← All invoices</Link>
        <div className="flex gap-2">
          <select value={inv.status} onChange={e => setStatus(e.target.value as InvoiceStatus)} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--bg3)', color: 'var(--text1)', border: '1px solid var(--border)' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <button onClick={() => window.print()} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--purple)', color: '#fff' }}>Print / PDF</button>
          <button onClick={del} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--bg3)', color: 'var(--red)' }}>Delete</button>
        </div>
      </div>

      <div className="rounded-xl border p-8" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="flex justify-between items-start mb-8">
          <div>
            <div className="text-xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>{settings?.firm_name ?? 'Your Firm Name'}</div>
            {settings?.firm_address && <div className="text-xs" style={{ color: 'var(--text2)' }}>{settings.firm_address}</div>}
            {settings?.firm_gstin && <div className="text-xs" style={{ color: 'var(--text3)' }}>GSTIN: {settings.firm_gstin}</div>}
            {settings?.firm_pan && <div className="text-xs" style={{ color: 'var(--text3)' }}>PAN: {settings.firm_pan}</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>INVOICE</div>
            <div className="text-sm" style={{ color: 'var(--text2)', fontFamily: 'var(--font-dm-mono)' }}>{inv.invoice_number}</div>
            <div className="text-xs mt-2" style={{ color: 'var(--text3)' }}>Issued: {inv.issue_date}</div>
            {inv.due_date && <div className="text-xs" style={{ color: 'var(--text3)' }}>Due: {inv.due_date}</div>}
          </div>
        </div>

        {client && (
          <div className="mb-6">
            <div className="text-xs uppercase mb-1" style={{ color: 'var(--text3)' }}>Bill To</div>
            <div className="text-sm" style={{ color: 'var(--text1)' }}>{client.name}</div>
            {client.address && <div className="text-xs" style={{ color: 'var(--text2)' }}>{client.address}</div>}
            {client.gstin && <div className="text-xs" style={{ color: 'var(--text3)' }}>GSTIN: {client.gstin}</div>}
            {primaryEmail && <div className="text-xs" style={{ color: 'var(--text3)' }}>{primaryEmail}</div>}
          </div>
        )}

        <table className="w-full text-sm mb-6">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left py-2 text-xs" style={{ color: 'var(--text3)' }}>Description</th>
              <th className="text-right py-2 text-xs w-20" style={{ color: 'var(--text3)' }}>Qty</th>
              <th className="text-right py-2 text-xs w-28" style={{ color: 'var(--text3)' }}>Rate</th>
              <th className="text-right py-2 text-xs w-28" style={{ color: 'var(--text3)' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.line_items.map((it, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="py-2" style={{ color: 'var(--text1)' }}>{it.description}</td>
                <td className="text-right py-2" style={{ color: 'var(--text2)' }}>{it.qty}</td>
                <td className="text-right py-2" style={{ color: 'var(--text2)' }}>₹{Number(it.rate).toLocaleString('en-IN')}</td>
                <td className="text-right py-2" style={{ color: 'var(--text1)' }}>₹{Number(it.amount).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto" style={{ width: 280 }}>
          <Row k="Subtotal" v={`₹${Number(inv.subtotal).toLocaleString('en-IN')}`} />
          <Row k="Tax" v={`₹${Number(inv.tax_amount).toLocaleString('en-IN')}`} />
          <div className="flex justify-between text-base py-2 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text1)' }}>Total</span>
            <span style={{ color: 'var(--text1)', fontFamily: 'var(--font-dm-serif)' }}>₹{Number(inv.total).toLocaleString('en-IN')}</span>
          </div>
        </div>

        {inv.notes && (
          <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-xs uppercase mb-1" style={{ color: 'var(--text3)' }}>Notes</div>
            <div className="text-xs" style={{ color: 'var(--text2)' }}>{inv.notes}</div>
          </div>
        )}

        <div className="mt-8 text-center text-xs" style={{ color: 'var(--text3)' }}>
          Status: <span style={{ color: 'var(--text1)' }}>{inv.status.toUpperCase()}</span>
          {inv.paid_at && ` · Paid on ${new Date(inv.paid_at).toLocaleDateString()}`}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-sm py-1.5"><span style={{ color: 'var(--text3)' }}>{k}</span><span style={{ color: 'var(--text1)' }}>{v}</span></div>;
}
