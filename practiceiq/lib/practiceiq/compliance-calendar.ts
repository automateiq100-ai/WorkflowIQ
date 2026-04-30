import type { ComplianceEvent } from './types';

export function statutoryEventsForYear(year: number): ComplianceEvent[] {
  const events: ComplianceEvent[] = [];

  for (let m = 0; m < 12; m++) {
    events.push({ date: iso(year, m, 11), title: 'GSTR-1 due', type: 'gst', description: 'Outward supplies return for previous month' });
  }
  for (let m = 0; m < 12; m++) {
    events.push({ date: iso(year, m, 20), title: 'GSTR-3B due', type: 'gst', description: 'Summary return + tax payment for previous month' });
  }
  for (let m = 0; m < 12; m++) {
    if (m === 3) {
      events.push({ date: iso(year, 3, 30), title: 'TDS payment (March)', type: 'tds' });
    } else {
      events.push({ date: iso(year, m, 7), title: 'TDS payment', type: 'tds' });
    }
  }

  events.push({ date: iso(year, 6, 31), title: 'TDS Q1 return (24Q/26Q)', type: 'tds' });
  events.push({ date: iso(year, 9, 31), title: 'TDS Q2 return (24Q/26Q)', type: 'tds' });
  events.push({ date: iso(year, 0, 31), title: 'TDS Q3 return (24Q/26Q)', type: 'tds' });
  events.push({ date: iso(year, 4, 31), title: 'TDS Q4 return (24Q/26Q)', type: 'tds' });

  events.push({ date: iso(year, 5, 15), title: 'Advance tax — 1st instalment (15%)', type: 'tax' });
  events.push({ date: iso(year, 8, 15), title: 'Advance tax — 2nd instalment (45%)', type: 'tax' });
  events.push({ date: iso(year, 11, 15), title: 'Advance tax — 3rd instalment (75%)', type: 'tax' });
  events.push({ date: iso(year, 2, 15), title: 'Advance tax — 4th instalment (100%)', type: 'tax' });

  events.push({ date: iso(year, 6, 31), title: 'ITR filing — non-audit cases', type: 'itr' });
  events.push({ date: iso(year, 9, 31), title: 'ITR filing — audit cases', type: 'itr' });
  events.push({ date: iso(year, 8, 30), title: 'Tax Audit Report (3CD)', type: 'itr' });

  events.push({ date: iso(year, 9, 30), title: 'ROC AOC-4 filing', type: 'roc' });
  events.push({ date: iso(year, 10, 29), title: 'ROC MGT-7 filing', type: 'roc' });

  return events;
}

function iso(y: number, mZeroBased: number, d: number): string {
  const m = String(mZeroBased + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export const RECURRING_PRESETS = [
  { title: 'GSTR-1 filing', cadence: 'monthly' as const, day_of_month: 11 },
  { title: 'GSTR-3B filing', cadence: 'monthly' as const, day_of_month: 20 },
  { title: 'TDS payment', cadence: 'monthly' as const, day_of_month: 7 },
  { title: 'TDS return (24Q/26Q)', cadence: 'quarterly' as const, day_of_month: 31, month_of_year: 7 },
  { title: 'Advance tax instalment', cadence: 'quarterly' as const, day_of_month: 15, month_of_year: 6 },
  { title: 'ITR filing (non-audit)', cadence: 'annual' as const, day_of_month: 31, month_of_year: 7 },
  { title: 'ITR filing (audit)', cadence: 'annual' as const, day_of_month: 31, month_of_year: 10 },
  { title: 'Tax Audit Report (3CD)', cadence: 'annual' as const, day_of_month: 30, month_of_year: 9 },
  { title: 'ROC AOC-4', cadence: 'annual' as const, day_of_month: 30, month_of_year: 10 },
  { title: 'ROC MGT-7', cadence: 'annual' as const, day_of_month: 29, month_of_year: 11 },
];
