'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Client, Task, InvoiceLineItem } from '@/lib/practiceiq/types';

export default function NewInvoicePage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clientId, setClientId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [taxRate, setTaxRate] = useState(18);
  const [items, setItems] = useState<InvoiceLineItem[]>([{ description: '', qty: 1, rate: 0, amount: 0 }]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/practiceiq/clients').then(r => r.json()),
      fetch('/api/practiceiq/tasks?status=done').then(r => r.json()),
      fetch('/api/practiceiq/settings').then(r => r.json()),
    ]).then(([c, t, s]) => {
      setClients(c.data ?? []);
      setTasks(t.data ?? []);
      if (s.data?.default_tax_rate != null) setTaxRate(Number(s.data.default_tax_rate));
    });
  }, []);

  function updateItem(i: number, patch: Partial<InvoiceLineItem>) {
    setItems(prev => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      next[i].amount = Number(next[i].qty) * Number(next[i].rate);
      return next;
    });
  }

  function addItem() {
    setItems(prev => [...prev, { description: '', qty: 1, rate: 0, amount: 0 }]);
  }
  function removeItem(i: number) {
    setItems(prev => prev.filter((_, idx) => idx !== i));
  }

  function importFromTask(taskId: string) {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    setItems(prev => [
      ...prev.filter(i => i.description || i.amount),
      { description: t.title, qty: 1, rate: Number(t.fee_amount ?? 0), amount: Number(t.fee_amount ?? 0), task_id: t.id },
    ]);
    if (!clientId && t.client_id) setClientId(t.client_id);
  }

  const subtotal = items.reduce((s, i) => s + Number(i.amount), 0);
  const taxAmount = subtotal * taxRate / 100;
  const total = subtotal + taxAmount;

  const completedTasksForClient = tasks.filter(t => t.client_id === clientId);

  async function save() {
    setSaving(true);
    const res = await fetch('/api/practiceiq/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId || null,
        issue_date: issueDate,
        due_date: dueDate || null,
        line_items: items.filter(i => i.description),
        subtotal,
        tax_amount: taxAmount,
        total,
        status: 'draft',
        notes: notes || null,
      }),
    }).then(r => r.json());
    setSaving(false);
    if (res.error) { alert(res.error); return; }
    router.push(`/practiceiq/invoices/${res.data.id}`);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/practiceiq/invoices" className="text-xs mb-4 inline-block" style={{ color: 'var(--text3)' }}>
        ← All invoices
      </Link>

      <h1 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        New Invoice
      </h1>

      <div className="rounded-xl border p-6 mb-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <Field label="Client *">
            <select value={clientId} onChange={e => setClientId(e.target.value)} style={input}>
              <option value="">— Select —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Issue Date">
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} style={input} />
          </Field>
          <Field label="Due Date">
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={input} />
          </Field>
        </div>

        {clientId && completedTasksForClient.length > 0 && (
          <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--bg3)' }}>
            <div className="text-xs mb-2" style={{ color: 'var(--text3)' }}>Add completed tasks for this client:</div>
            <div className="flex flex-wrap gap-1.5">
              {completedTasksForClient.map(t => (
                <button
                  key={t.id}
                  onClick={() => importFromTask(t.id)}
                  className="px-2 py-1 rounded text-xs"
                  style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                >
                  + {t.title} {t.fee_amount && <span style={{ color: 'var(--teal)' }}>· ₹{Number(t.fee_amount).toLocaleString('en-IN')}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs uppercase mb-2" style={{ color: 'var(--text3)' }}>Line Items</div>
        <table className="w-full text-sm mb-3">
          <thead>
            <tr>
              <th className="text-left text-xs pb-2" style={{ color: 'var(--text3)' }}>Description</th>
              <th className="text-right text-xs pb-2 w-20" style={{ color: 'var(--text3)' }}>Qty</th>
              <th className="text-right text-xs pb-2 w-28" style={{ color: 'var(--text3)' }}>Rate</th>
              <th className="text-right text-xs pb-2 w-28" style={{ color: 'var(--text3)' }}>Amount</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="pr-2 py-1">
                  <input value={it.description} onChange={e => updateItem(i, { description: e.target.value })} style={input} />
                </td>
                <td className="pr-2 py-1">
                  <input type="number" value={it.qty} onChange={e => updateItem(i, { qty: Number(e.target.value) })} style={{ ...input, textAlign: 'right' }} />
                </td>
                <td className="pr-2 py-1">
                  <input type="number" value={it.rate} onChange={e => updateItem(i, { rate: Number(e.target.value) })} style={{ ...input, textAlign: 'right' }} />
                </td>
                <td className="text-right py-1" style={{ color: 'var(--text1)' }}>₹{it.amount.toLocaleString('en-IN')}</td>
                <td className="text-center">
                  <button onClick={() => removeItem(i)} style={{ color: 'var(--red)' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addItem} className="text-xs" style={{ color: 'var(--purple)' }}>+ Add line item</button>

        <div className="mt-6 ml-auto" style={{ width: 280 }}>
          <Row k="Subtotal" v={`₹${subtotal.toLocaleString('en-IN')}`} />
          <div className="flex justify-between items-center text-sm py-1.5">
            <span style={{ color: 'var(--text3)' }}>Tax %</span>
            <input type="number" value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} style={{ ...input, width: 80, textAlign: 'right' }} />
          </div>
          <Row k="Tax" v={`₹${taxAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} />
          <div className="flex justify-between items-center text-base py-2 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text1)' }}>Total</span>
            <span style={{ color: 'var(--text1)', fontFamily: 'var(--font-dm-serif)' }}>₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        <div className="mt-4">
          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...input, minHeight: 60 }} />
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/practiceiq/invoices" className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</Link>
        <button
          onClick={save}
          disabled={saving || !clientId || items.every(i => !i.description)}
          className="px-4 py-2 text-sm rounded-lg"
          style={{ background: 'var(--purple)', color: '#fff', opacity: saving || !clientId ? 0.5 : 1 }}
        >
          {saving ? 'Saving...' : 'Create Invoice'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      {children}
    </label>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm py-1.5">
      <span style={{ color: 'var(--text3)' }}>{k}</span>
      <span style={{ color: 'var(--text1)' }}>{v}</span>
    </div>
  );
}
const input: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text1)',
  fontSize: 13,
};
