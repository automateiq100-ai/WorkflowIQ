import type { Cadence } from './types';
import { toIsoDate } from './recurring-engine';

export type DeliverableSpec = {
  cadence: Cadence;
  deadline_day: number | null;
  deadline_month: number | null;
  followup_lead_days: number | null;
};

export type Deliverable = {
  date: string;
  client_id: string;
  client_name: string;
  service: string;
  cadence: Cadence;
  followup_start_date: string | null;
};

function clamp(year: number, monthIdx: number, day: number): Date {
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return new Date(year, monthIdx, Math.min(day, lastDay));
}

export function projectDeliverableDates(
  spec: DeliverableSpec,
  from: Date,
  to: Date,
): Date[] {
  const day = spec.deadline_day ?? 1;
  const out: Date[] = [];

  if (spec.cadence === 'monthly') {
    const startY = from.getFullYear();
    const startM = from.getMonth();
    const endY = to.getFullYear();
    const endM = to.getMonth();
    let y = startY, m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      const occ = clamp(y, m, day);
      if (occ >= from && occ <= to) out.push(occ);
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return out;
  }

  if (spec.cadence === 'quarterly') {
    const anchor = ((spec.deadline_month ?? 6) - 1 + 12) % 12;
    const months = [0, 1, 2, 3].map(i => (anchor + i * 3) % 12).sort((a, b) => a - b);
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
      for (const m of months) {
        const occ = clamp(y, m, day);
        if (occ >= from && occ <= to) out.push(occ);
      }
    }
    return out;
  }

  // annual
  const m = ((spec.deadline_month ?? 7) - 1 + 12) % 12;
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    const occ = clamp(y, m, day);
    if (occ >= from && occ <= to) out.push(occ);
  }
  return out;
}

export function buildDeliverables(
  service: DeliverableSpec & { service: string; client_id: string; client_name: string },
  from: Date,
  to: Date,
): Deliverable[] {
  const dates = projectDeliverableDates(service, from, to);
  return dates.map(d => {
    let followup: string | null = null;
    if (service.followup_lead_days != null) {
      const f = new Date(d);
      f.setDate(f.getDate() - service.followup_lead_days);
      followup = toIsoDate(f);
    }
    return {
      date: toIsoDate(d),
      client_id: service.client_id,
      client_name: service.client_name,
      service: service.service,
      cadence: service.cadence,
      followup_start_date: followup,
    };
  });
}
