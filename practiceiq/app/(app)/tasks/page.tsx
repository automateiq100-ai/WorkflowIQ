'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import type { Task, TaskStatus, TaskPriority, Client, TaskStats, ServiceModule, ServiceTemplate } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';
import { fyOptions, currentFY, formatTaskNumber } from '@/lib/practiceiq/fy';

const COLUMNS: { key: TaskStatus; label: string; dot: string; chip: string }[] = [
  { key: 'open',       label: 'Open',         dot: '#34d399', chip: 'rgba(52,211,153,0.15)' },
  { key: 'processing', label: 'Processing',   dot: '#f97373', chip: 'rgba(249,115,115,0.15)' },
  { key: 'review',     label: 'Under Review', dot: '#a78bfa', chip: 'rgba(167,139,250,0.18)' },
  { key: 'done',       label: 'Done',         dot: '#94a3b8', chip: 'rgba(148,163,184,0.18)' },
];

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: 'var(--text3)',
  normal: 'var(--blue)',
  high: 'var(--amber)',
  urgent: 'var(--red)',
};

type Bucket =
  | 'all'
  | 'due_today'
  | 'due_tomorrow'
  | 'due_in_7_days'
  | 'due_after_7_days'
  | 'overdue_le_7_days'
  | 'overdue_gt_7_days'
  | 'due_total'
  | 'chargeable'
  | 'non_chargeable';

const FY_OPTS = fyOptions(5);

const ZERO_STATS: TaskStats = {
  due_today: 0, due_tomorrow: 0, due_in_7_days: 0, due_after_7_days: 0,
  overdue_le_7_days: 0, overdue_gt_7_days: 0, due_total: 0,
  chargeable_total: 0, non_chargeable_total: 0,
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<TaskStats>(ZERO_STATS);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [filterClient, setFilterClient] = useState<string>('');
  const [filterChargeable, setFilterChargeable] = useState<'' | 'true' | 'false'>('');
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<Bucket>('all');
  const [fy, setFy] = useState<string>(currentFY());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, c, s] = await Promise.all([
      fetch(api(`/api/practiceiq/tasks?fy=${encodeURIComponent(fy)}`)).then(r => r.json()),
      fetch(api('/api/practiceiq/clients')).then(r => r.json()),
      fetch(api(`/api/practiceiq/tasks/stats?fy=${encodeURIComponent(fy)}`)).then(r => r.json()),
    ]);
    setTasks(t.data ?? []);
    setClients(c.data ?? []);
    setStats(s.data ?? ZERO_STATS);
    setLoading(false);
  }, [fy]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const dayMs = 86400000;
    const tomorrow = new Date(today.getTime() + dayMs);
    const in7 = new Date(today.getTime() + 7 * dayMs);
    const overdue7 = new Date(today.getTime() - 7 * dayMs);

    return tasks.filter(t => {
      if (filterClient && t.client_id !== filterClient) return false;
      if (filterChargeable === 'true' && !t.chargeable) return false;
      if (filterChargeable === 'false' && t.chargeable) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${t.title} ${t.description ?? ''} ${t.service_type ?? ''} ${formatTaskNumber(t.task_number)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (bucket !== 'all') {
        if (t.status === 'done') return false;
        const due = t.due_date ? new Date(t.due_date + 'T00:00:00') : null;
        switch (bucket) {
          case 'due_today':         if (!due || t.due_date !== today.toISOString().slice(0,10)) return false; break;
          case 'due_tomorrow':      if (!due || t.due_date !== tomorrow.toISOString().slice(0,10)) return false; break;
          case 'due_in_7_days':     if (!due || !(due > tomorrow && due <= in7)) return false; break;
          case 'due_after_7_days':  if (!due || !(due > in7)) return false; break;
          case 'overdue_le_7_days': if (!due || !(due < today && due >= overdue7)) return false; break;
          case 'overdue_gt_7_days': if (!due || !(due < overdue7)) return false; break;
          case 'due_total':         if (!due || due < today) return false; break;
          case 'chargeable':        if (!t.chargeable) return false; break;
          case 'non_chargeable':    if (t.chargeable) return false; break;
        }
      }
      return true;
    });
  }, [tasks, filterClient, filterChargeable, search, bucket]);

  async function move(task: Task, status: TaskStatus) {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    await fetch(api(`/api/practiceiq/tasks/${task.id}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header banner — matches the screenshot's teal "Task Dashboard" bar */}
      <div
        className="rounded-xl px-4 sm:px-5 py-3 sm:py-4 mb-5 flex flex-wrap items-center justify-between gap-3"
        style={{ background: 'linear-gradient(90deg, var(--teal), var(--blue))' }}
      >
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: '#0e0f11' }}>
          Task Dashboard
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md overflow-hidden bg-black/10">
            <button onClick={() => setView('kanban')} className="px-3 py-1 text-xs font-semibold" style={{ background: view === 'kanban' ? '#fff' : 'transparent', color: view === 'kanban' ? 'var(--bg)' : '#0e0f11' }}>Kanban</button>
            <button onClick={() => setView('list')} className="px-3 py-1 text-xs font-semibold" style={{ background: view === 'list' ? '#fff' : 'transparent', color: view === 'list' ? 'var(--bg)' : '#0e0f11' }}>List</button>
          </div>
          <select
            value={fy}
            onChange={e => setFy(e.target.value)}
            className="rounded-md text-xs font-semibold px-2 py-1"
            style={{ background: '#fff', color: 'var(--bg)', border: 'none' }}
          >
            {FY_OPTS.map(f => <option key={f} value={f}>FY {f}</option>)}
          </select>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-md px-3 py-1 text-xs font-semibold"
            style={{ background: '#0e0f11', color: 'var(--teal)' }}
          >
            + New Task
          </button>
        </div>
      </div>

      {/* Bucket selector — kept as a plain "All" pill so users can clear the active stat tile */}
      <div className="mb-3">
        <button
          onClick={() => setBucket('all')}
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            background: bucket === 'all' ? 'var(--teal)' : 'var(--bg3)',
            color: bucket === 'all' ? 'var(--bg)' : 'var(--text2)',
            border: '1px solid var(--border)',
          }}
        >
          All
        </button>
      </div>

      {/* 9 stat tiles */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-6">
        <StatTile label="DUE TODAY"         value={stats.due_today}            tone="amber" active={bucket === 'due_today'}         onClick={() => setBucket(bucket === 'due_today' ? 'all' : 'due_today')} />
        <StatTile label="DUE TOMORROW"      value={stats.due_tomorrow}         tone="amber" active={bucket === 'due_tomorrow'}      onClick={() => setBucket(bucket === 'due_tomorrow' ? 'all' : 'due_tomorrow')} />
        <StatTile label="DUE IN 7 DAYS"     value={stats.due_in_7_days}        tone="teal"  active={bucket === 'due_in_7_days'}     onClick={() => setBucket(bucket === 'due_in_7_days' ? 'all' : 'due_in_7_days')} />
        <StatTile label="DUE AFTER 7 DAYS"  value={stats.due_after_7_days}     tone="teal"  active={bucket === 'due_after_7_days'}  onClick={() => setBucket(bucket === 'due_after_7_days' ? 'all' : 'due_after_7_days')} />
        <StatTile label="OVERDUE ≤ 7 DAYS"  value={stats.overdue_le_7_days}    tone="red"   active={bucket === 'overdue_le_7_days'} onClick={() => setBucket(bucket === 'overdue_le_7_days' ? 'all' : 'overdue_le_7_days')} />
        <StatTile label="OVERDUE > 7 DAYS"  value={stats.overdue_gt_7_days}    tone="red"   active={bucket === 'overdue_gt_7_days'} onClick={() => setBucket(bucket === 'overdue_gt_7_days' ? 'all' : 'overdue_gt_7_days')} />
        <StatTile label="DUE TOTAL"         value={stats.due_total}            tone="blue"  active={bucket === 'due_total'}         onClick={() => setBucket(bucket === 'due_total' ? 'all' : 'due_total')} />
        <StatTile label="CHARGEABLE"        value={stats.chargeable_total}     tone="purple" active={bucket === 'chargeable'}        onClick={() => setBucket(bucket === 'chargeable' ? 'all' : 'chargeable')} />
        <StatTile label="NON-CHARGEABLE"    value={stats.non_chargeable_total} tone="grey"  active={bucket === 'non_chargeable'}    onClick={() => setBucket(bucket === 'non_chargeable' ? 'all' : 'non_chargeable')} />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)} style={inputStyle} className="text-sm">
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterChargeable} onChange={e => setFilterChargeable(e.target.value as '' | 'true' | 'false')} style={inputStyle} className="text-sm">
          <option value="">All billing</option>
          <option value="true">Chargeable only</option>
          <option value="false">Non-chargeable only</option>
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search title, ID, service…"
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          className="text-sm"
        />
      </div>

      {/* Section header — mirrors "By status & due date" in the reference */}
      <div className="flex items-baseline justify-between mt-2 mb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>By status &amp; due date</h2>
        <span className="text-xs" style={{ color: 'var(--text3)' }}>
          {filtered.length} task{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : view === 'kanban' ? (
        <KanbanBoard tasks={filtered} clients={clients} onMove={move} onClick={setEditing} />
      ) : (
        <ListView tasks={filtered} clients={clients} onClick={setEditing} />
      )}

      {(showForm || editing) && (
        <TaskForm
          initial={editing ?? undefined}
          clients={clients}
          defaultFy={fy}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

const TILE_STYLES: Record<string, { bg: string; fg: string; band: string }> = {
  amber:  { bg: '#fff7d6', fg: '#7a5500', band: '#facc15' },
  teal:   { bg: '#daf6e8', fg: '#0a6b50', band: '#10b981' },
  red:    { bg: '#fde4dc', fg: '#9b1f10', band: '#ef4444' },
  blue:   { bg: '#dceaff', fg: '#163e8a', band: '#3b82f6' },
  purple: { bg: '#ebe2fb', fg: '#5a3aa8', band: '#8b5cf6' },
  grey:   { bg: '#e9ecf2', fg: '#3b4151', band: '#94a3b8' },
};

function StatTile({ label, value, tone, active, onClick }: {
  label: string; value: number; tone: keyof typeof TILE_STYLES; active: boolean; onClick: () => void;
}) {
  const s = TILE_STYLES[tone];
  return (
    <button
      onClick={onClick}
      className="rounded-lg overflow-hidden text-center transition-all flex flex-col"
      style={{
        background: s.bg,
        color: s.fg,
        boxShadow: active ? `0 0 0 2px ${s.band}` : '0 1px 2px rgba(0,0,0,0.25)',
      }}
    >
      {/* top color band */}
      <div style={{ height: 3, background: s.band }} />
      <div className="px-2 pt-3 pb-2 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold leading-none" style={{ color: s.fg }}>{value}</div>
        <div
          className="text-[10px] mt-1.5 leading-tight uppercase tracking-wider font-semibold opacity-80"
        >
          {label}
        </div>
      </div>
    </button>
  );
}

function KanbanBoard({ tasks, clients, onMove, onClick }: {
  tasks: Task[]; clients: Client[]; onMove: (t: Task, s: TaskStatus) => void; onClick: (t: Task) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {COLUMNS.map(col => {
        const items = tasks.filter(t => t.status === col.key);
        return (
          <div
            key={col.key}
            className="rounded-xl p-3 min-h-[420px]"
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
            onDragOver={e => e.preventDefault()}
            onDrop={() => {
              if (!dragId) return;
              const t = tasks.find(x => x.id === dragId);
              if (t && t.status !== col.key) onMove(t, col.key);
              setDragId(null);
            }}
          >
            <div
              className="flex items-center justify-between mb-3 px-3 py-2 rounded-md"
              style={{ background: col.chip }}
            >
              <div className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text1)' }}>
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: col.dot }} />
                {col.label}
              </div>
              <div
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--text1)' }}
              >
                {items.length}
              </div>
            </div>
            {items.map(t => <TaskCard key={t.id} task={t} client={clients.find(c => c.id === t.client_id) ?? null} onDragStart={() => setDragId(t.id)} onClick={() => onClick(t)} />)}
            {items.length === 0 && (
              <div className="text-xs text-center py-6" style={{ color: 'var(--text3)' }}>No tasks</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task, client, onDragStart, onClick }: {
  task: Task; client: Client | null; onDragStart: () => void; onClick: () => void;
}) {
  const overdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="rounded-md p-3 mb-2 cursor-pointer transition-shadow hover:shadow-md"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-[11px] font-mono font-semibold" style={{ color: 'var(--text2)' }}>
          {formatTaskNumber(task.task_number)}
        </div>
        {task.service_type && (
          <span
            className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded"
            style={{
              background: 'rgba(167,139,250,0.18)',
              color: '#a78bfa',
              letterSpacing: 1,
              border: '1px solid rgba(167,139,250,0.3)',
            }}
          >
            {task.service_type}
          </span>
        )}
      </div>
      <div className="text-sm mb-2 leading-snug font-medium" style={{ color: 'var(--text1)' }}>
        {task.title}
      </div>
      {client && (
        <div className="text-[11px] mb-1 truncate" style={{ color: 'var(--text3)' }}>
          {client.name}
        </div>
      )}
      <div className="flex justify-between items-center text-[11px] mt-1">
        <span style={{ color: overdue ? 'var(--red)' : 'var(--text3)' }}>
          {task.due_date ? new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'No due date'}
        </span>
        {!task.chargeable && (
          <span
            className="text-[9px] uppercase px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(148,163,184,0.18)', color: 'var(--text2)' }}
          >
            Non-billable
          </span>
        )}
      </div>
    </div>
  );
}

function ListView({ tasks, clients, onClick }: { tasks: Task[]; clients: Client[]; onClick: (t: Task) => void }) {
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <table className="w-full text-sm">
        <thead><tr style={{ background: 'var(--bg3)' }}><Th>ID</Th><Th>Title</Th><Th>Client</Th><Th>Service</Th><Th>Status</Th><Th>Priority</Th><Th>Due</Th><Th>Fee</Th></tr></thead>
        <tbody>
          {tasks.map(t => {
            const client = clients.find(c => c.id === t.client_id);
            const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
            return (
              <tr key={t.id} onClick={() => onClick(t)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text2)' }}>{formatTaskNumber(t.task_number)}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{t.title}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{client?.name ?? '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--purple)' }}>{t.service_type ?? '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{t.status}</td>
                <td className="px-4 py-3" style={{ color: PRIORITY_COLOR[t.priority] }}>{t.priority}</td>
                <td className="px-4 py-3" style={{ color: overdue ? 'var(--red)' : 'var(--text3)' }}>{t.due_date ?? '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{t.fee_amount != null ? `₹${Number(t.fee_amount).toLocaleString('en-IN')}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tasks.length === 0 && <div className="p-8 text-center text-sm" style={{ color: 'var(--text3)' }}>No tasks.</div>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}

function TaskForm({ initial, clients, onClose, onSaved, defaultFy }: {
  initial?: Task; clients: Client[]; onClose: () => void; onSaved: () => void; defaultFy: string;
}) {
  const [form, setForm] = useState<Partial<Task>>(
    initial ?? { status: 'open', priority: 'normal', chargeable: true, financial_year: defaultFy },
  );
  const [saving, setSaving] = useState(false);

  // Module + filing pickers for service_type. The chosen pair is serialised
  // as "{module.code}: {filing.service}" into the existing service_type
  // text column so cards / search / list view need no changes.
  const [modules, setModules] = useState<ServiceModule[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [moduleId, setModuleId] = useState<string>('');
  const [filing, setFiling] = useState<string>('');
  const [freeText, setFreeText] = useState<boolean>(false);

  useEffect(() => {
    Promise.all([
      fetch(api('/api/practiceiq/service-modules')).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(api('/api/practiceiq/service-templates')).then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([m, t]) => {
      const mods: ServiceModule[] = m.data ?? [];
      const tmpls: ServiceTemplate[] = t.data ?? [];
      setModules(mods);
      setTemplates(tmpls);
      // Try to parse an existing "{CODE}: {filing}" service_type into the
      // pickers; if it doesn't match any module/filing, fall back to free text.
      const st = (initial?.service_type ?? '').trim();
      if (st) {
        const match = st.match(/^([A-Z0-9_]+):\s*(.+)$/);
        if (match) {
          const mod = mods.find(x => x.code === match[1]);
          if (mod) {
            const fil = tmpls.find(x => x.module_id === mod.id && x.service === match[2].trim());
            if (fil) {
              setModuleId(mod.id);
              setFiling(fil.service);
              return;
            }
          }
        }
        setFreeText(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filingsForModule = useMemo(
    () => templates.filter(t => t.module_id === moduleId),
    [templates, moduleId],
  );

  async function save() {
    setSaving(true);
    // Compute service_type from picker pair (or fall through to free text).
    let serviceType: string | null = null;
    if (freeText) {
      serviceType = (form.service_type ?? '').trim() || null;
    } else if (moduleId && filing) {
      const mod = modules.find(m => m.id === moduleId);
      if (mod) serviceType = `${mod.code}: ${filing}`;
    }
    const url = initial?.id ? api(`/api/practiceiq/tasks/${initial.id}`) : api('/api/practiceiq/tasks');
    const method = initial?.id ? 'PATCH' : 'POST';
    await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        client_id: form.client_id || null,
        fee_amount: form.fee_amount === undefined || form.fee_amount === null || (form.fee_amount as unknown) === '' ? null : Number(form.fee_amount),
        due_date: form.due_date || null,
        service_type: serviceType,
        financial_year: form.financial_year || null,
        chargeable: form.chargeable !== false,
      }),
    });
    setSaving(false);
    onSaved();
  }

  async function del() {
    if (!initial?.id) return;
    if (!confirm('Delete task?')) return;
    await fetch(api(`/api/practiceiq/tasks/${initial.id}`), { method: 'DELETE' });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl border p-6 w-full max-w-xl" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          {initial?.id ? `Edit Task ${formatTaskNumber(initial.task_number)}` : 'New Task'}
        </h2>
        <div className="space-y-3">
          <Field label="Title *"><input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} /></Field>
          <Field label="Description"><textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              <select value={form.client_id ?? ''} onChange={e => setForm({ ...form, client_id: e.target.value || null })} style={inputStyle}>
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {freeText ? (
              <Field label="Service type (free text)">
                <input
                  value={form.service_type ?? ''}
                  onChange={e => setForm({ ...form, service_type: e.target.value })}
                  placeholder="AUDIT, GST, ITR…"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => { setFreeText(false); setForm({ ...form, service_type: '' }); }}
                  className="text-[10px] mt-1"
                  style={{ color: 'var(--purple)' }}
                >
                  ← Use module picker
                </button>
              </Field>
            ) : (
              <Field label="Module">
                <select
                  value={moduleId}
                  onChange={e => { setModuleId(e.target.value); setFiling(''); }}
                  style={inputStyle}
                >
                  <option value="">— None —</option>
                  {modules.map(m => (
                    <option key={m.id} value={m.id}>{m.icon ? `${m.icon} ` : ''}{m.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setFreeText(true); setModuleId(''); setFiling(''); }}
                  className="text-[10px] mt-1"
                  style={{ color: 'var(--text3)' }}
                >
                  Use free text instead
                </button>
              </Field>
            )}
            {!freeText && (
              <Field label="Filing">
                <select
                  value={filing}
                  onChange={e => setFiling(e.target.value)}
                  disabled={!moduleId}
                  style={inputStyle}
                >
                  <option value="">— Pick a filing —</option>
                  {filingsForModule.map(t => (
                    <option key={t.id} value={t.service}>{t.service}</option>
                  ))}
                </select>
              </Field>
            )}
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
            <Field label="Financial year">
              <select value={form.financial_year ?? ''} onChange={e => setForm({ ...form, financial_year: e.target.value })} style={inputStyle}>
                <option value="">—</option>
                {FY_OPTS.map(f => <option key={f} value={f}>FY {f}</option>)}
              </select>
            </Field>
            <Field label="Assigned to"><input value={form.assigned_to ?? ''} onChange={e => setForm({ ...form, assigned_to: e.target.value })} style={inputStyle} /></Field>
            <Field label="Fee (₹)"><input type="number" value={form.fee_amount ?? ''} onChange={e => setForm({ ...form, fee_amount: e.target.value === '' ? null : Number(e.target.value) })} style={inputStyle} /></Field>
            <Field label="Chargeable">
              <select value={form.chargeable === false ? 'false' : 'true'} onChange={e => setForm({ ...form, chargeable: e.target.value === 'true' })} style={inputStyle}>
                <option value="true">Chargeable</option>
                <option value="false">Non-chargeable</option>
              </select>
            </Field>
          </div>
        </div>
        <div className="mt-6 flex justify-between">
          {initial?.id ? <button onClick={del} className="px-3 py-2 text-xs" style={{ color: 'var(--red)' }}>Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--text2)' }}>Cancel</button>
            <button onClick={save} disabled={saving || !form.title} className="px-4 py-2 text-sm rounded-lg" style={{ background: 'var(--purple)', color: '#fff', opacity: saving || !form.title ? 0.5 : 1 }}>
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

const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)', fontSize: 13 };
