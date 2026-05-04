import type { Cadence } from './types';

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
