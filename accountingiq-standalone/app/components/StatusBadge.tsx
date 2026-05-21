'use client';

import type { CheckStatus } from '@/lib/types';

const LABELS: Record<CheckStatus, string> = {
  pass:      'Pass',
  partial:   'Partial',
  fail:      'Fail',
  missing:   'Missing',
  uncertain: 'Uncertain',
  na:        'N/A',
};

export default function StatusBadge({ status }: { status: CheckStatus }) {
  return (
    <span
      className={`badge-${status} inline-block rounded px-2 py-0.5 text-xs font-medium`}
      style={{ minWidth: '5rem', textAlign: 'center' }}
    >
      {LABELS[status]}
    </span>
  );
}
