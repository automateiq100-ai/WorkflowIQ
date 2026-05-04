'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Task, ComplianceEvent, Client } from '@/lib/practiceiq/types';
import type { Deliverable } from '@/lib/practiceiq/deliverables';
import { statutoryEventsForYear } from '@/lib/practiceiq/compliance-calendar';
import { api } from '@/lib/api';

const TYPE_COLOR: Record<ComplianceEvent['type'], string> = {
  gst: 'var(--blue)',
  tds: 'var(--amber)',
  itr: 'var(--coral)',
  roc: 'var(--purple)',
  tax: 'var(--teal)',
  other: 'var(--text3)',
};

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const [today] = useState(new Date());
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(api('/api/practiceiq/tasks')).then(r => r.json()),
      fetch(api('/api/practiceiq/clients')).then(r => r.json()),
    ]).then(([t, c]) => { setTasks(t.data ?? []); setClients(c.data ?? []); });
  }, []);

  useEffect(() => {
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    fetch(api(`/api/practiceiq/calendar/deliverables?from=${from}&to=${to}`))
      .then(r => r.json())
      .then(d => setDeliverables(d.data ?? []));
  }, [year, month]);

  useEffect(() => {
    if (!selectedDate) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedDate(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedDate]);

  const events = useMemo(() => statutoryEventsForYear(year), [year]);

  const monthName = new Date(year, month, 1).toLocaleString('default', { month: 'long' });
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: { date: Date | null }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d) });
  while (cells.length % 7 !== 0) cells.push({ date: null });

  function nav(delta: number) {
    let m = month + delta; let y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth(m); setYear(y);
  }

  function eventsFor(date: Date) {
    const iso = isoOf(date);
    return {
      stat: events.filter(e => e.date === iso),
      myTasks: tasks.filter(t => t.due_date === iso),
      delivs: deliverables.filter(d => d.date === iso),
    };
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Compliance Calendar</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>India statutory deadlines + your tasks + client deliverables</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => nav(-1)} className="px-3 py-1.5 rounded text-sm" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>←</button>
          <div className="text-sm px-3" style={{ color: 'var(--text1)', minWidth: 140, textAlign: 'center' }}>{monthName} {year}</div>
          <button onClick={() => nav(1)} className="px-3 py-1.5 rounded text-sm" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>→</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        {(['gst','tds','itr','roc','tax'] as const).map(t => (
          <div key={t} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text2)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[t] }}></span>
            {t.toUpperCase()}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text2)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--green)' }}></span>
          Your task
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text2)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--pink)' }}></span>
          Client deliverable
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs mb-1" style={{ color: 'var(--text3)' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="px-2 py-1">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} style={{ minHeight: 100 }} />;
          const date = c.date;
          const isToday = date.toDateString() === today.toDateString();
          const { stat, myTasks, delivs } = eventsFor(date);
          const totalCount = stat.length + myTasks.length + delivs.length;
          const shownStat = stat.slice(0, 3);
          const shownTasks = myTasks.slice(0, 2);
          const shownDelivs = delivs.slice(0, 3);
          const shown = shownStat.length + shownTasks.length + shownDelivs.length;
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(date)}
              className="rounded p-2 text-left transition-colors hover:brightness-110"
              style={{
                background: 'var(--bg2)',
                border: `1px solid ${isToday ? 'var(--purple)' : 'var(--border)'}`,
                minHeight: 100,
                cursor: totalCount > 0 ? 'pointer' : 'default',
              }}
            >
              <div className="text-xs mb-1" style={{ color: isToday ? 'var(--purple)' : 'var(--text2)', fontWeight: isToday ? 600 : 400 }}>{date.getDate()}</div>
              <div className="space-y-0.5">
                {shownStat.map((e, j) => (
                  <div key={`s${j}`} title={e.description ?? e.title} className="text-[10px] truncate px-1 rounded" style={{ background: 'var(--bg3)', color: TYPE_COLOR[e.type] }}>{e.title}</div>
                ))}
                {shownTasks.map(t => {
                  const client = clients.find(c2 => c2.id === t.client_id);
                  return (
                    <div key={`t${t.id}`} title={`${t.title}${client ? ` · ${client.name}` : ''}`} className="text-[10px] truncate px-1 rounded" style={{ background: 'rgba(76,175,121,0.15)', color: 'var(--green)' }}>
                      ✓ {t.title}
                    </div>
                  );
                })}
                {shownDelivs.map((d, j) => (
                  <div
                    key={`d${j}`}
                    title={`${d.client_name} — ${d.service}${d.followup_start_date ? ` · follow-up from ${d.followup_start_date}` : ''}`}
                    className="text-[10px] truncate px-1 rounded"
                    style={{ background: 'rgba(232,121,195,0.15)', color: 'var(--pink)' }}
                  >
                    📨 {d.client_name} · {d.service}
                  </div>
                ))}
                {totalCount > shown && <div className="text-[10px]" style={{ color: 'var(--text3)' }}>+{totalCount - shown} more</div>}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <DayDetail
          date={selectedDate}
          stat={eventsFor(selectedDate).stat}
          myTasks={eventsFor(selectedDate).myTasks}
          delivs={eventsFor(selectedDate).delivs}
          clients={clients}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}

function DayDetail({
  date, stat, myTasks, delivs, clients, onClose,
}: {
  date: Date;
  stat: ComplianceEvent[];
  myTasks: Task[];
  delivs: Deliverable[];
  clients: Client[];
  onClose: () => void;
}) {
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const totalCount = stat.length + myTasks.length + delivs.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border p-6 w-full max-w-2xl max-h-[90vh] overflow-auto"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              {dateLabel}
            </h2>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              {totalCount === 0
                ? 'Nothing scheduled.'
                : `${totalCount} item${totalCount === 1 ? '' : 's'}`}
            </div>
          </div>
          <button onClick={onClose} className="text-sm px-2 py-1" style={{ color: 'var(--text3)' }}>Close ✕</button>
        </div>

        {stat.length > 0 && (
          <Section title={`Statutory (${stat.length})`}>
            {stat.map((e, j) => (
              <div
                key={`s${j}`}
                className="rounded-lg p-3 mb-2"
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2 text-sm" style={{ color: TYPE_COLOR[e.type] }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[e.type] }}></span>
                  <span className="uppercase text-[10px]" style={{ color: 'var(--text3)' }}>{e.type}</span>
                  <span style={{ color: 'var(--text1)' }}>{e.title}</span>
                </div>
                {e.description && (
                  <div className="text-xs mt-1" style={{ color: 'var(--text2)' }}>{e.description}</div>
                )}
              </div>
            ))}
          </Section>
        )}

        {myTasks.length > 0 && (
          <Section title={`Tasks (${myTasks.length})`}>
            {myTasks.map(t => {
              const client = clients.find(c => c.id === t.client_id);
              return (
                <div
                  key={t.id}
                  className="rounded-lg p-3 mb-2"
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
                >
                  <div className="text-sm" style={{ color: 'var(--text1)' }}>✓ {t.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
                    {t.status} · {t.priority}
                    {client && ` · ${client.name}`}
                  </div>
                </div>
              );
            })}
          </Section>
        )}

        {delivs.length > 0 && (
          <Section title={`Client deliverables (${delivs.length})`}>
            {delivs.map((d, j) => (
              <Link
                key={`d${j}`}
                href={`/clients/${d.client_id}`}
                onClick={onClose}
                className="block rounded-lg p-3 mb-2"
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <span style={{ color: 'var(--pink)' }}>📨</span>
                  <span className="text-sm" style={{ color: 'var(--text1)' }}>{d.client_name}</span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>·</span>
                  <span className="text-xs" style={{ color: 'var(--text2)' }}>{d.service}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                  {d.cadence}
                  {d.followup_start_date && ` · follow-up from ${d.followup_start_date}`}
                </div>
              </Link>
            ))}
          </Section>
        )}

        {totalCount === 0 && (
          <div
            className="rounded-lg p-6 text-center text-sm"
            style={{ background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}
          >
            No deadlines, tasks, or deliverables on this date.
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs uppercase mb-2" style={{ color: 'var(--text3)' }}>{title}</div>
      {children}
    </div>
  );
}
