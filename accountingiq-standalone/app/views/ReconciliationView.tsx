'use client';

const COMING_SOON = [
  {
    icon: '🏦',
    title: 'Bank Reconciliation',
    description: 'Automatically match bank statement entries against Tally vouchers. Identify timing differences, uncleared cheques, and bank charges.',
    eta: 'Coming in v2',
  },
  {
    icon: '📋',
    title: 'GSTR-2A vs Books',
    description: 'Compare your purchase register against GSTR-2A data from the GST portal. Flag ITC discrepancies and missing invoices automatically.',
    eta: 'Coming in v2',
  },
  {
    icon: '📑',
    title: 'TDS Reconciliation (26AS)',
    description: 'Match TDS deducted in your books against the 26AS statement. Surface mismatches and ensure you claim all eligible TDS credit.',
    eta: 'Coming in v2',
  },
  {
    icon: '⚖',
    title: 'Debtors / Creditors Ledger Recon',
    description: 'Reconcile individual debtor and creditor accounts against confirmation letters or party statements.',
    eta: 'Coming in v3',
  },
];

export default function ReconciliationView() {
  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="text-5xl mb-4">⇌</div>
        <h1
          className="text-2xl mb-2"
          style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
        >
          Reconciliation
        </h1>
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Automated reconciliation tools are coming soon. Here's what we're building.
        </p>
      </div>

      {/* Coming soon cards */}
      <div className="space-y-3">
        {COMING_SOON.map(item => (
          <div
            key={item.title}
            className="rounded-xl border px-5 py-4 flex items-start gap-4"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            <div className="text-2xl shrink-0 mt-0.5">{item.icon}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>{item.title}</div>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
                >
                  {item.eta}
                </span>
              </div>
              <div className="text-xs" style={{ color: 'var(--text2)' }}>{item.description}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-8 px-4 py-3 rounded-lg text-xs text-center border"
        style={{ borderColor: 'var(--border)', color: 'var(--text3)', background: 'var(--bg2)' }}
      >
        Want to prioritise a specific reconciliation? Let us know via the Feedback button.
      </div>
    </div>
  );
}
