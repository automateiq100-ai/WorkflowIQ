import type { RecurringTemplate, Cadence } from './types';

export function nextOccurrence(template: RecurringTemplate, asOf: Date = new Date()): Date {
  const day = template.day_of_month ?? 1;
  const refY = asOf.getFullYear();
  const refM = asOf.getMonth();
  const refD = asOf.getDate();

  if (template.cadence === 'monthly') {
    if (refD <= day) return new Date(refY, refM, day);
    return new Date(refY, refM + 1, day);
  }

  if (template.cadence === 'quarterly') {
    const anchor = (template.month_of_year ?? 6) - 1;
    const months = [0, 1, 2, 3].map(i => (anchor + i * 3) % 12);
    months.sort((a, b) => a - b);
    for (const m of months) {
      const d = new Date(refY, m, day);
      if (d >= asOf) return d;
    }
    return new Date(refY + 1, months[0], day);
  }

  // annual
  const m = (template.month_of_year ?? 7) - 1;
  const thisYear = new Date(refY, m, day);
  if (thisYear >= asOf) return thisYear;
  return new Date(refY + 1, m, day);
}

export function periodKey(date: Date, cadence: Cadence): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  if (cadence === 'monthly') return `${y}-${m}`;
  if (cadence === 'quarterly') {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `${y}-Q${q}`;
  }
  return String(y);
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
