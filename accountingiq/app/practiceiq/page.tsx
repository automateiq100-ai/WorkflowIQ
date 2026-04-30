import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import type { Task, Invoice, Client } from '@/lib/practiceiq/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: clients }, { data: tasks }, { data: invoices }] = await Promise.all([
    supabase.from('practiceiq_clients').select('*').order('created_at', { ascending: false }),
    supabase.from('practiceiq_tasks').select('*'),
    supabase.from('practiceiq_invoices').select('*'),
  ]);

  const allClients = (clients ?? []) as Client[];
  const allTasks = (tasks ?? []) as Task[];
  const allInvoices = (invoices ?? []) as Invoice[];

  const today = new Date();
  const in7 = new Date(today);  in7.setDate(today.getDate() + 7);
  const in30 = new Date(today); in30.setDate(today.getDate() + 30);

  const overdueTasks = allTasks.filter(t =>
    t.status !== 'done' && t.due_date && new Date(t.due_date) < today
  );
  const dueIn7 = allTasks.filter(t =>
    t.status !== 'done' && t.due_date &&
    new Date(t.due_date) >= today && new Date(t.due_date) <= in7
  );
  const dueIn30 = allTasks.filter(t =>
    t.status !== 'done' && t.due_date &&
    new Date(t.due_date) >= today && new Date(t.due_date) <= in30
  );
  const openTasks = allTasks.filter(t => t.status !== 'done');
  const completedTasks = allTasks.filter(t => t.status === 'done');

  const unbilled = allInvoices
    .filter(i => i.status === 'sent' || i.status === 'overdue')
    .reduce((s, i) => s + Number(i.total ?? 0), 0);
  const collectedThisFY = allInvoices
    .filter(i => i.status === 'paid')
    .reduce((s, i) => s + Number(i.total ?? 0), 0);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1
        className="text-2xl mb-1"
        style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
      >
        Dashboard
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Practice overview at a glance
      </p>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KPI label="Total Clients" value={allClients.length} color="var(--blue)" />
        <KPI label="Open Tasks" value={openTasks.length} color="var(--teal)" />
        <KPI label="Overdue" value={overdueTasks.length} color="var(--red)" />
        <KPI label="Due in 7 days" value={dueIn7.length} color="var(--amber)" />
        <KPI label="Due in 30 days" value={dueIn30.length} color="var(--purple)" />
        <KPI label="Completed" value={completedTasks.length} color="var(--green)" />
        <KPI label="Unbilled (₹)" value={fmt(unbilled)} color="var(--coral)" />
        <KPI label="Collected (₹)" value={fmt(collectedThisFY)} color="var(--green)" />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Overdue Tasks" empty="No overdue tasks 🎉">
          {overdueTasks.slice(0, 8).map(t => (
            <TaskRow key={t.id} task={t} clients={allClients} />
          ))}
        </Card>
        <Card title="Upcoming (next 7 days)" empty="Nothing due this week.">
          {dueIn7.slice(0, 8).map(t => (
            <TaskRow key={t.id} task={t} clients={allClients} />
          ))}
        </Card>
      </div>

      <div className="mt-6 flex gap-3 flex-wrap">
        <Link href="/practiceiq/clients" style={btn('var(--blue)')}>+ Add Client</Link>
        <Link href="/practiceiq/tasks" style={btn('var(--teal)')}>+ New Task</Link>
        <Link href="/practiceiq/invoices/new" style={btn('var(--coral)')}>+ Invoice</Link>
        <Link href="/practiceiq/tasks/recurring" style={btn('var(--purple)')}>Manage Recurring</Link>
      </div>
    </div>
  );
}

function KPI({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
    >
      <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-2xl" style={{ color, fontFamily: 'var(--font-dm-serif)' }}>{value}</div>
    </div>
  );
}

function Card({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
    >
      <div className="text-sm mb-3" style={{ color: 'var(--text1)' }}>{title}</div>
      {isEmpty ? (
        <div className="text-xs py-4" style={{ color: 'var(--text3)' }}>{empty}</div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

function TaskRow({ task, clients }: { task: Task; clients: Client[] }) {
  const client = clients.find(c => c.id === task.client_id);
  return (
    <Link
      href={`/practiceiq/tasks`}
      className="flex items-center justify-between p-2 rounded text-xs"
      style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
    >
      <div>
        <div style={{ color: 'var(--text1)' }}>{task.title}</div>
        {client && <div style={{ color: 'var(--text3)' }}>{client.name}</div>}
      </div>
      <div style={{ color: 'var(--text3)' }}>{task.due_date}</div>
    </Link>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN').format(Math.round(n));
}
function btn(color: string): React.CSSProperties {
  return {
    background: color,
    color: '#000',
    fontSize: 12,
    padding: '8px 14px',
    borderRadius: 8,
    fontWeight: 500,
  };
}
