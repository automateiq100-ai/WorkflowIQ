'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Task, ComplianceEvent, Client } from '@/lib/practiceiq/types';
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

export default function CalendarPage() {
  const [today] = useState(new Date());
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(api('/api/practiceiq/tasks')).then(r => r.json()),
      fetch(api('/api/practiceiq/clients')).then(r => r.json()),
    ]).then(([t, c]) => { setTasks(t.data ?? []); setClients(c.data ?? []); });
  }, []);

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
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { stat: events.filter(e => e.date === iso), myTasks: tasks.filter(t => t.due_date === iso) };
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>Compliance Calendar</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>India statutory deadlines + your tasks</p>
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
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs mb-1" style={{ color: 'var(--text3)' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="px-2 py-1">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} style={{ minHeight: 100 }} />;
          const isToday = c.date.toDateString() === today.toDateString();
          const { stat, myTasks } = eventsFor(c.date);
          return (
            <div key={i} className="rounded p-2" style={{ background: 'var(--bg2)', border: `1px solid ${isToday ? 'var(--purple)' : 'var(--border)'}`, minHeight: 100 }}>
              <div className="text-xs mb-1" style={{ color: isToday ? 'var(--purple)' : 'var(--text2)', fontWeight: isToday ? 600 : 400 }}>{c.date.getDate()}</div>
              <div className="space-y-0.5">
                {stat.slice(0, 3).map((e, j) => (
                  <div key={j} title={e.description ?? e.title} className="text-[10px] truncate px-1 rounded" style={{ background: 'var(--bg3)', color: TYPE_COLOR[e.type] }}>{e.title}</div>
                ))}
                {myTasks.slice(0, 2).map(t => {
                  const client = clients.find(c2 => c2.id === t.client_id);
                  return (
                    <div key={t.id} title={`${t.title}${client ? ` · ${client.name}` : ''}`} className="text-[10px] truncate px-1 rounded" style={{ background: 'rgba(76,175,121,0.15)', color: 'var(--green)' }}>
                      ✓ {t.title}
                    </div>
                  );
                })}
                {(stat.length + myTasks.length > 5) && <div className="text-[10px]" style={{ color: 'var(--text3)' }}>+{stat.length + myTasks.length - 5} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
