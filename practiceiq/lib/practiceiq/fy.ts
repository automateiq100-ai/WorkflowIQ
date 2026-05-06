/**
 * Indian financial year helpers. FY runs 1 April → 31 March; we label as
 * "26-27" for the year starting 1 Apr 2026.
 */

export function fyForDate(d: Date): string {
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const next = year + 1;
  return `${String(year).slice(-2)}-${String(next).slice(-2)}`;
}

export function currentFY(): string {
  return fyForDate(new Date());
}

/** Returns the recent FY options, latest first. */
export function fyOptions(count = 5): string[] {
  const today = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - i);
    out.push(fyForDate(d));
  }
  return out;
}

/** [from, to] ISO date strings (yyyy-mm-dd) for the boundaries of the given FY label. */
export function fyDateRange(fy: string): { from: string; to: string } {
  const [a, b] = fy.split('-');
  if (!a || !b) {
    const cur = currentFY();
    return fyDateRange(cur);
  }
  const startYear = 2000 + parseInt(a, 10);
  const endYear = 2000 + parseInt(b, 10);
  const from = `${startYear}-04-01`;
  const to = `${endYear}-03-31`;
  return { from, to };
}

export function formatTaskNumber(n: number | null | undefined): string {
  if (n == null) return 'TSK?????';
  return `TSK${String(n).padStart(5, '0')}`;
}
