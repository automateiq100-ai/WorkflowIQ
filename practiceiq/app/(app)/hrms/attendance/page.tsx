'use client';

import { useEffect, useState } from 'react';
import type { AttendanceRecord } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(rec: AttendanceRecord): string {
  if (!rec.check_in_at) return '—';
  const start = new Date(rec.check_in_at).getTime();
  const end = rec.check_out_at ? new Date(rec.check_out_at).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m${rec.check_out_at ? '' : ' (running)'}`;
}

export default function MyAttendancePage() {
  const [rows, setRows] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Default to last 30 days.
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    fetch(api(`/api/practiceiq/hrms/attendance?from=${monthAgo}&to=${today}`))
      .then(r => r.json())
      .then(j => setRows(j.data ?? []))
      .finally(() => setLoading(false));
  }, [monthAgo, today]);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>My Attendance</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Last 30 days. Use the Check In / Check Out button in the top bar to log time.
      </p>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg3)' }}>
              <tr>
                <Th>Date</Th><Th>Check in</Th><Th>Check out</Th><Th>Duration</Th><Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{r.date}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{fmtTime(r.check_in_at)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{fmtTime(r.check_out_at)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{fmtDuration(r)}</td>
                  <td className="px-4 py-3 text-xs uppercase" style={{ color: 'var(--text3)' }}>{r.source}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-sm" style={{ color: 'var(--text3)' }}>No attendance recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}
