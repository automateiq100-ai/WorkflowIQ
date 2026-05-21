'use client';

import { useEffect, useState } from 'react';
import type { ConnectorSession, VoucherDraft } from '@/lib/connectors/types';
import type { Check, ParsedData } from '@/lib/types';

const TALLY_SESSION_KEY = 'aiq.tallySession';

function loadSession(): ConnectorSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TALLY_SESSION_KEY);
    return raw ? (JSON.parse(raw) as ConnectorSession) : null;
  } catch { return null; }
}

function todayYYYYMMDD(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${m}${day}`;
}

interface Props {
  check: Check;
  parsedData: Partial<ParsedData>;
}

// Today this only handles B1 (suspense reclassification). Add new branches as
// the engine grows more auto-fixable checks. Anything more involved should stay
// read-only — write-back blast radius is intentionally narrow in v1.
export default function PushToTallyButton({ check, parsedData }: Props) {
  const [session, setSession] = useState<ConnectorSession | null>(null);
  useEffect(() => { setSession(loadSession()); }, []);

  if (check.id !== 'B1') return null;
  if (!session?.selectedCompany) return null;
  const suspense = parsedData.suspenseLedgers ?? [];
  if (suspense.length === 0) return null;

  return <SuspenseFixModal session={session} suspense={suspense} checkId={check.id} />;
}

function SuspenseFixModal({
  session,
  suspense,
  checkId,
}: {
  session: ConnectorSession;
  suspense: NonNullable<ParsedData['suspenseLedgers']>;
  checkId: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('Capital Account');
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handlePost(ledger: string, amount: number) {
    setPosting(true);
    setResult(null);
    // amount carries Tally's sign convention (positive = Cr). Reclassify by
    // booking the opposite side on the suspense ledger and the same side on
    // the target ledger (net zero).
    const draft: VoucherDraft = {
      date: todayYYYYMMDD(),
      voucherType: 'Journal',
      narration: `Reclassify ${ledger} to ${target} (AccountingIQ check ${checkId})`,
      lines: [
        { ledger, amount: -amount },
        { ledger: target, amount: amount },
      ],
      sourceCheckId: checkId,
    };
    try {
      const r = await fetch('/api/tally/post-voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: session.bridgeId, draft }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error ?? 'Post failed');
      setResult(`Posted to Tally as voucher ${data.voucherNumber ?? '(no number returned)'}`);
    } catch (e) {
      setResult(`Failed: ${(e as Error).message}`);
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium transition-colors"
        style={{ color: 'var(--teal)' }}
      >
        ⇌ Push fix to Tally
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full max-w-lg rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>
                Reclassify suspense balances
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
                Posts a Journal voucher into{' '}
                <strong style={{ color: 'var(--teal)' }}>{session.selectedCompany?.name}</strong>.
                You can review it in Tally before saving.
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text3)' }}>
                  Reclassify against ledger
                </label>
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg"
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)' }}
                />
              </div>

              <div className="space-y-1">
                {suspense.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                    style={{ background: 'var(--bg3)' }}
                  >
                    <div>
                      <div style={{ color: 'var(--text1)' }}>{s.name}</div>
                      <div style={{ color: 'var(--text3)' }}>₹{s.amount.toLocaleString('en-IN')}</div>
                    </div>
                    <button
                      onClick={() => handlePost(s.name, s.amount)}
                      disabled={posting || !target.trim()}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                      style={{ background: 'var(--teal)', color: '#000' }}
                    >
                      Post
                    </button>
                  </div>
                ))}
              </div>

              {result && (
                <div className="text-xs" style={{ color: result.startsWith('Failed') ? 'var(--red)' : 'var(--teal)' }}>
                  {result}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end px-5 pb-4">
              <button
                onClick={() => setOpen(false)}
                className="text-xs px-3 py-1.5 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
