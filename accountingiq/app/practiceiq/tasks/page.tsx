'use client';

import { useEffect, useState, useMemo } from 'react';
import type { Task, TaskStatus, TaskPriority, Client } from '@/lib/practiceiq/types';

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: 'open', label: 'Open', color: 'var(--text3)' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--blue)' },
  { key: 'review', label: 'Review', color: 'var(--amber)' },
  { key: 'done', label: 'Done', color: 'var(--green)' },
];

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: 'var(--text3)',
  normal: 'var(--blue)',
  high: 'var(--amber)',
  urgent: 'var(--red)',
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [filterClient, setFilterClient] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  async function load() {
    setLoading(true);
    const [t, c] = await Promise.all([
      fetch('/api/practiceiq/tasks').then(r => r.json()),
      fetch('/api/practiceiq/clients').then(r => r.json()),
    ]);
    setTasks(t.data ?? []);
    setClients(c.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return tasks.filter(t => !filterClient || t.client_id === filterClient);
  }, [tasks, filterClient]);

  async function move(task: Task, status: TaskStatus) {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    await fetch(`/api/practiceiq/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Tasks
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            {filtered.length} task{filtered.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text1)' }}
          >
            <option value="">All Clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setView('kanban')}
              className="px-3 py-2 text-xs"
              style={{ background: view === 'kanban' ? 'var(--bg3)' : 'var(--bg2)', color: 'var(--text1)' }}
            >Kanban</button>
            <button
              onClick={() => setView('list')}
              className="px-3 py-2 text-xs"
              style={{ background: view === 'list' ? 'var(--bg3)' : 'var(--bg2)', color: 'var(--text1)' }}
            >List</button>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--purple)', color: '#fff' }}
          >
            + Task
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>
      ) : view === 'kanban' ? (
        <KanbanBoard tasks={filtered} clients={clients} onMove={move} onClick={setEditing} />
      ) : (
        <ListView tasks={filtered} clients={clients} onClick={setEditing} />
      )}

      {(showForm || editing) && (
        <TaskForm
          initial={editing ?? undefined}
          clients={clients}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function KanbanBoard({
  tasks, clients, onMove, onClick,
}: {
  tasks: Task[]; clients: Client[];
  onMove: (t: Task, s: TaskStatus) => void;
  onClick: (t: Task) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {COLUMNS.map(col => {
        const items = tasks.filter(t => t.status === col.key);
        return (
          <div
            key={col.key}
            className="rounded-lg p-3 min-h-[400px]"
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
            onDragOver={e => e.preventDefault()}
            onDrop={() => {
              if (!dragId) return;
              const t = tasks.find(x => x.id === dragId);
              if (t && t.status !== col.key) onMove(t, col.key);
              setDragId(null);
            }}
          >
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="text-xs uppercase" style={{ color: col.color }}>{col.label}</div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>{items.length}</div>
            </div>
            {items.map(t => {
              const client = clients.find(c => c.id === t.client_id);
              const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
              return (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onClick={() => onClick(t)}
                  className="rounded-lg p-3 mb-2 cursor-pointer"
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-sm" style={{ color: 'var(--text1)' }}>{t.title}</div>
                    <span
                      className="text-[10px] uppercase shrink-0 px-1.5 rounded"
                      style={{ background: 'var(--bg4)', color: PRIORITY_COLOR[t.priority] }}
                    >{t.priority}</span>
                  </div>
                  {client && <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{client.name}</div>}
                  <div className="flex justify-between text-xs" style={{ color: overdue ? 'var(--red)' : 'var(--text3)' }}>
                    <span>{t.due_date ?? 'No due date'}</span>
                    {t.fee_amount != null && <span>₹{Number(t.fee_amount).toLocaleString('en-IN')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ListView({ tasks, clients, onClick }: { tasks: Task[]; clients: Client[]; onClick: (t: Task) => void }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: 'var(--bg3)' }}>
            <Th>Title</Th><Th>Client</Th><Th>Status</Th><Th>Priority</Th><Th>Due</Th><Th>Fee</Th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => {
            const client = clients.find(c => c.id === t.client_id);
            const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
            return (
              <tr key={t.id} onClick={() => onClick(t)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{t.title}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{client?.name ?? '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{t.status}</td>
                <td className="px-4 py-3" style={{ color: PRIORITY_COLOR[t.priority] }}>{t.priority}</td>
                <td className="px-4 py-3" style={{ color: overdue ? 'var(--red)' : 'var(--text3)' }}>{t.due_date ?? '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{t.fee_amount != null ? `₹${Number(t.fee_amount).toLocaleString('en-IN')}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tasks.length === 0 && (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--text3)' }}>No tasks.</div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}

function TaskForm({
  initial, clients, onClose, onSaved,
}: {
  initial?: Task; clients: Client[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Task>>(initial ?? { status: 'open', priority: 'normal' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const url = initial?.id ? `/api/practiceiq/tasks/${initial.id}` : '/api/practiceiq/tasks';
    const method = initial?.id ? 'PATCH' : 'POST';
    await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        client_id: form.client_id || null,
        fee_amount: form.fee_amount === undefined || form.fee_amount === null || (form.fee_amount as unknown) === '' ? null : Number(form.fee_amount),
        due_date: form.due_date || null,
      }),
    });
    setSaving(false);
    onSaved();
  }

  async function del() {
    if (!initial?.id) return;
    if (!confirm('Delete task?')) return;
    await fetch(`/api/practiceiq/tasks/${initial.id}`, { method: 'DELETE' });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-xl" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          {initial?.id ? 'Edit Task' : 'New Task'}
        </h2>
        <div className="space-y-3">
          <Field label="Title *">
            <input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Description">
            <textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              <select value={form.client_id ?? ''} onChange={e => setForm({ ...form, client_id: e.target.value || null })} style={inputStyle}>
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status ?? 'open'} onChange={e => setForm({ ...form, status: e.target.value as TaskStatus })} style={inputStyle}>
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={form.priority ?? 'normal'} onChange={e => setForm({ ...form, priority: e.target.value as TaskPriority })} style={inputStyle}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Due Date">
              <input type="date" value={form.due_date ?? ''} onChange={e => setForm({ ...form, due_date: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Assigned to">
              <input value={form.assigned_to ?? ''} onChange={e => setForm({ ...form, assigned_to: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Fee (₹)">
              <input type="number" value={form.fee_amount ?? ''} onChange={e => setForm({ ...form, fee_amount: e.target.value === '' ? null : Number(e.target.value) })} style={inputStyle} />
            </Field>
          </div>
        </div>

        <div className="mt-6 flex justify-between">
          {initial?.id ? (
            <button onClick={del} className="px-3 py-2 text-xs" style={{ color: 'var(--red)' }}>Delete</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
            <button
              onClick={save}
              disabled={saving || !form.title}
              className="px-4 py-2 text-sm rounded-lg"
              style={{ background: 'var(--purple)', color: '#fff', opacity: saving || !form.title ? 0.5 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text1)',
  fontSize: 13,
};
