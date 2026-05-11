'use client';

import { useEffect, useState } from 'react';
import type { ConnectorSession, ConnectorCompany, ReportKind } from '@/lib/connectors/types';
import { useApp } from '@/lib/state';

const SESSION_KEY = 'aiq.tallySession';

/** Indian-FY default that matches UploadView's currentFYDates: during Apr–Jun
 * we default to the *previous* FY (closing-the-prior-year window). */
function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const month = now.getMonth();
  const year = month <= 5 ? now.getFullYear() - 1 : now.getFullYear();
  // FY year start = Apr 1 of `year`; end = Mar 31 of `year+1`.
  const start = new Date(year, 3, 1).toISOString().slice(0, 10);
  const end = new Date(year + 1, 2, 31).toISOString().slice(0, 10);
  return { start, end };
}

interface DebugSyncEntry {
  sizeBytes: number;
  fetchedAt: number;
  ok: boolean;
  error?: string;
  firstChars: string;
  tallyError: string | null;
}

function loadSession(): ConnectorSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConnectorSession>;
    // Reject malformed sessions left over from earlier failed pairings — a
    // session without bridgeId is unusable and would crash the render.
    if (!parsed || typeof parsed.bridgeId !== 'string' || !parsed.bridgeId) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed as ConnectorSession;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(s: ConnectorSession | null): void {
  if (typeof window === 'undefined') return;
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
}

export default function TallyConnectionView() {
  const { dispatch } = useApp();
  const [session, setSession] = useState<ConnectorSession | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [companies, setCompanies] = useState<ConnectorCompany[] | null>(null);
  const [loadingCo, setLoadingCo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Debug Sync state ──
  // Lets the user run a small sync (trialbal + bills) and inspect the raw
  // XML Tally returned. Primary use: confirm whether "all amounts ₹0" is
  // due to a future-period query (Tally legitimately returns empty) or
  // something else (Tally error envelope, gateway misconfig, etc.).
  const [dbgPeriod, setDbgPeriod] = useState(defaultPeriod());
  const [dbgRunning, setDbgRunning] = useState(false);
  const [dbgResults, setDbgResults] = useState<Record<string, DebugSyncEntry> | null>(null);
  const [dbgError, setDbgError] = useState<string | null>(null);
  const [dbgExpanded, setDbgExpanded] = useState<string | null>(null);

  // On mount: load from sessionStorage first; if absent, ask the cloud
  // whether the user has an active bridge session already (e.g., paired in
  // another tab, on another device, or here before sessionStorage was wiped).
  useEffect(() => {
    const local = loadSession();
    if (local) { setSession(local); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/tally/active-session');
        if (cancelled || !r.ok) return;
        const data = (await r.json()) as { session: ConnectorSession | null };
        if (cancelled || !data.session) return;
        saveSession(data.session);
        setSession(data.session);
      } catch { /* ignore — fall back to manual pairing */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Long-poll for pair completion
  useEffect(() => {
    if (!pairCode || session) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/tally/pair?code=${encodeURIComponent(pairCode)}`);
        if (cancelled) return;
        const data = await r.json();
        if (data.paired) {
          saveSession(data.session);
          setSession(data.session);
          setPairCode(null);
          setPairing(false);
          return;
        }
      } catch { /* ignore — keep polling */ }
      if (!cancelled) setTimeout(tick, 2000);
    };
    tick();
    return () => { cancelled = true; };
  }, [pairCode, session]);

  async function handleStartPairing(autoLaunch = false) {
    setError(null);
    setPairing(true);
    try {
      const r = await fetch('/api/tally/pair', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Failed to start pairing');
      setPairCode(data.code);
      if (autoLaunch) {
        const url = `accountingiq-bridge://pair?code=${encodeURIComponent(data.code)}&cloud=${encodeURIComponent(window.location.origin)}`;
        window.location.href = url;
      }
    } catch (e) {
      setError((e as Error).message);
      setPairing(false);
    }
  }

  async function handleLoadCompanies() {
    if (!session) return;
    setLoadingCo(true);
    setError(null);
    try {
      const r = await fetch(`/api/tally/companies?bridgeId=${encodeURIComponent(session.bridgeId)}`);
      const data = await r.json();
      if (r.status === 404 && data.error === 'No bridge session') {
        // Server lost track of this bridge — clear local session, force re-pair.
        saveSession(null);
        setSession(null);
        setCompanies(null);
        setError('Bridge connection lost (server restarted or bridge stopped). Please re-pair.');
        return;
      }
      if (!r.ok) throw new Error(data.error ?? 'Failed to list companies');
      setCompanies(data.companies);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingCo(false);
    }
  }

  async function handlePickCompany(c: ConnectorCompany) {
    if (!session) return;
    setError(null);
    try {
      const r = await fetch('/api/tally/companies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: session.bridgeId, companyName: c.name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Failed to select company');
      const next: ConnectorSession = { ...session, selectedCompany: c };
      saveSession(next);
      setSession(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDisconnect() {
    if (!session) return;
    try {
      await fetch('/api/tally/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: session.bridgeId }),
      });
    } catch { /* still clear locally */ }
    saveSession(null);
    setSession(null);
    setCompanies(null);
  }

  /** Run a cheap sync (trialbal + bills only) and read the snapshot back from
   * the debug endpoint. Whole purpose is to give the user direct sight of the
   * XML Tally returned for the chosen period. */
  async function handleDebugSync() {
    if (!session?.selectedCompany) return;
    setDbgRunning(true);
    setDbgError(null);
    setDbgResults(null);
    setDbgExpanded(null);
    try {
      const kinds: ReportKind[] = ['trialbal', 'bills'];
      const r = await fetch('/api/tally/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: session.bridgeId, period: dbgPeriod, kinds }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      // Now pull the persisted snapshot for richer per-kind detail.
      const snapRes = await fetch(`/api/tally/sync/debug?bridgeId=${encodeURIComponent(session.bridgeId)}`);
      const snap = await snapRes.json();
      if (!snapRes.ok) throw new Error(snap.error ?? `HTTP ${snapRes.status}`);
      setDbgResults(snap.kinds ?? {});
    } catch (e) {
      setDbgError((e as Error).message);
    } finally {
      setDbgRunning(false);
    }
  }

  function copySnippet(kind: string) {
    const entry = dbgResults?.[kind];
    if (!entry) return;
    void navigator.clipboard.writeText(entry.firstChars);
  }

  function downloadFull(kind: string) {
    if (!session) return;
    const url = `/api/tally/sync/debug?bridgeId=${encodeURIComponent(session.bridgeId)}&full=1&kind=${encodeURIComponent(kind)}`;
    window.open(url, '_blank');
  }

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        Connect Tally Prime
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Pair your local Tally Prime instance to pull reports directly — no folder uploads.
      </p>

      {error && (
        <div
          className="rounded-lg px-4 py-3 mb-4 text-xs"
          style={{ background: 'rgba(240,72,72,0.1)', border: '1px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* Step 1: Install bridge */}
      <Section title="1. Install the AccountingIQ Bridge" done={!!session}>
        <p className="text-xs mb-3" style={{ color: 'var(--text3)' }}>
          The bridge is a small Windows helper that runs alongside Tally Prime. It only makes
          outbound calls — no firewall changes needed.
        </p>
        <a
          href="/download/bridge"
          className="inline-block text-xs px-3 py-2 rounded-lg border"
          style={{ borderColor: 'var(--border)', color: 'var(--teal)' }}
        >
          ⬇ Download AccountingIQ Bridge for Windows
        </a>
        <div className="mt-3 text-xs" style={{ color: 'var(--text3)' }}>
          <p className="mb-1"><strong style={{ color: 'var(--text2)' }}>If Windows SmartScreen blocks the file:</strong></p>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>Right-click <code>accountingiq-bridge.exe</code> → <strong>Properties</strong> → tick <strong>Unblock</strong> → OK.</li>
            <li>Or, on the SmartScreen popup, click <strong>More info</strong> → <strong>Run anyway</strong>.</li>
          </ol>
          <p className="mt-2">Publisher will show as <em>WorkflowIQ</em> (self-signed). The bridge only opens outbound HTTPS to this app and posts to Tally on <code>localhost:9000</code>.</p>
          <p className="mt-2">When you double-click the .exe, a console window opens and asks for the pairing code shown below.</p>
        </div>
      </Section>

      {/* Step 2: Pair */}
      {!session && (
        <Section title="2. Pair this browser with the bridge" done={false}>
          {!pairCode ? (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleStartPairing(true)}
                disabled={pairing}
                className="text-xs px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                style={{ background: 'var(--teal)', color: '#000' }}
              >
                {pairing ? 'Connecting…' : '⚡ One-click connect (auto-launch bridge)'}
              </button>
              <button
                onClick={() => handleStartPairing(false)}
                disabled={pairing}
                className="text-xs px-4 py-2 rounded-lg font-semibold disabled:opacity-50 self-start"
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)' }}
              >
                Or generate code only (manual paste)
              </button>
              <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                One-click works after the bridge has been run at least once on this PC (it registers a URL handler).
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>
                If the bridge didn&apos;t open automatically, run <code>accountingiq-bridge.exe</code> and enter:
              </p>
              <div
                className="text-2xl font-mono tracking-widest text-center py-3 px-4 rounded-lg mb-2"
                style={{ background: 'var(--bg3)', border: '1px solid var(--teal)', color: 'var(--teal)', letterSpacing: '0.4em' }}
              >
                {pairCode}
              </div>
              <p className="text-xs" style={{ color: 'var(--text3)' }}>
                Code expires in 5 minutes. Waiting for bridge…
              </p>
            </div>
          )}
        </Section>
      )}

      {/* Step 3: Pick company */}
      {session && (
        <Section title="3. Select a Tally company" done={!!session.selectedCompany}>
          {session.selectedCompany ? (
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: 'var(--text2)' }}>
                Active company:{' '}
                <strong style={{ color: 'var(--teal)' }}>{session.selectedCompany.name}</strong>
              </span>
              <button
                onClick={() => { setCompanies(null); }}
                className="underline"
                style={{ color: 'var(--text3)' }}
              >
                Change
              </button>
            </div>
          ) : (
            <div>
              {!companies ? (
                <button
                  onClick={handleLoadCompanies}
                  disabled={loadingCo}
                  className="text-xs px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                >
                  {loadingCo ? 'Asking Tally…' : 'List companies in Tally'}
                </button>
              ) : companies.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  No companies returned. Open a company in Tally Prime, then retry.
                </p>
              ) : (
                <div className="space-y-1">
                  {companies.map(c => (
                    <button
                      key={c.id}
                      onClick={() => handlePickCompany(c)}
                      className="w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* Next-step CTA — once paired and company is picked, point users at Upload Files */}
      {session?.selectedCompany && (
        <div
          className="rounded-xl p-4 mb-3 flex items-center gap-4"
          style={{
            background: 'linear-gradient(135deg, rgba(45,212,191,0.12), rgba(45,212,191,0.04))',
            border: '1px solid var(--teal)',
          }}
        >
          <div
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            ✓
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>
              Tally is connected.
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
              Next: open <strong>Upload Files</strong> and click <strong>Pull from Tally</strong> to fetch the
              5 reports needed for analysis.
            </div>
          </div>
          <button
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
            className="shrink-0 text-xs px-4 py-2 rounded-lg font-semibold whitespace-nowrap"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            Go to Upload Files →
          </button>
        </div>
      )}

      {/* Step 4: Debug Sync — visible once a company is picked */}
      {session?.selectedCompany && (
        <Section title="4. Debug Sync (verify what Tally returns)" done={false}>
          <p className="text-xs mb-3" style={{ color: 'var(--text3)' }}>
            Pulls Trial Balance and Bills Receivable from Tally for the chosen
            period and shows the raw XML. If amounts come back empty, this is
            the fastest way to see whether Tally returned an error envelope, an
            HTML page, or a legitimate empty period.
          </p>
          <div className="flex gap-2 mb-3 flex-wrap items-center text-xs">
            <label style={{ color: 'var(--text2)' }}>From:&nbsp;
              <input
                type="date"
                value={dbgPeriod.start}
                onChange={e => setDbgPeriod(p => ({ ...p, start: e.target.value }))}
                style={{ background: 'var(--bg3)', color: 'var(--text1)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px' }}
              />
            </label>
            <label style={{ color: 'var(--text2)' }}>To:&nbsp;
              <input
                type="date"
                value={dbgPeriod.end}
                onChange={e => setDbgPeriod(p => ({ ...p, end: e.target.value }))}
                style={{ background: 'var(--bg3)', color: 'var(--text1)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px' }}
              />
            </label>
            <button
              onClick={handleDebugSync}
              disabled={dbgRunning}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium"
              style={{ background: 'var(--teal)', color: '#000', border: '1px solid var(--teal)', opacity: dbgRunning ? 0.5 : 1 }}
            >
              {dbgRunning ? 'Querying Tally…' : 'Run Debug Sync'}
            </button>
            <button
              onClick={() => setDbgPeriod(defaultPeriod())}
              className="px-2 py-1.5 rounded-lg text-xs underline"
              style={{ color: 'var(--text3)', background: 'transparent', border: 'none' }}
              title="Reset to default FY"
            >
              Reset
            </button>
          </div>

          {dbgError && (
            <div className="text-xs mb-3 p-2 rounded" style={{ background: 'rgba(240,72,72,0.12)', color: 'var(--red)' }}>
              {dbgError}
            </div>
          )}

          {dbgResults && Object.keys(dbgResults).length > 0 && (
            <div className="space-y-2">
              {Object.entries(dbgResults).map(([kind, entry]) => {
                const isExpanded = dbgExpanded === kind;
                const badge = !entry.ok
                  ? { text: 'fetch failed', color: 'var(--red)' }
                  : entry.tallyError
                    ? { text: entry.tallyError, color: 'var(--amber)' }
                    : { text: 'looks OK', color: 'var(--teal)' };
                return (
                  <div key={kind} className="rounded-lg border p-2" style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <strong style={{ color: 'var(--text1)' }}>{kind}</strong>
                        <span style={{ color: 'var(--text3)' }}>{entry.sizeBytes.toLocaleString()} chars</span>
                        <span style={{ color: badge.color, fontWeight: 600 }}>{badge.text}</span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setDbgExpanded(isExpanded ? null : kind)}
                          className="px-2 py-0.5 text-xs rounded border"
                          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                        >
                          {isExpanded ? 'Collapse' : 'Show first 1000 chars'}
                        </button>
                        <button
                          onClick={() => copySnippet(kind)}
                          className="px-2 py-0.5 text-xs rounded border"
                          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                          disabled={!entry.firstChars}
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => downloadFull(kind)}
                          className="px-2 py-0.5 text-xs rounded border"
                          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                          disabled={!entry.ok || entry.sizeBytes === 0}
                        >
                          Download full
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <pre
                        className="text-[11px] mt-2 p-2 rounded overflow-auto"
                        style={{ background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border)', maxHeight: 280 }}
                      >
                        {entry.firstChars || '(empty)'}
                      </pre>
                    )}
                    {entry.error && (
                      <div className="text-xs mt-1" style={{ color: 'var(--red)' }}>
                        Fetch error: {entry.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {/* Status + disconnect */}
      {session && (
        <div className="mt-6 flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text3)' }}>
            Bridge ID: <code>{session.bridgeId.slice(0, 14)}…</code>
            {' '}· Paired{' '}
            {new Date(session.pairedAt).toLocaleString('en-IN')}
          </span>
          <button
            onClick={handleDisconnect}
            className="underline"
            style={{ color: 'var(--red)' }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-4 mb-3"
      style={{ background: 'var(--bg2)', borderColor: done ? 'var(--teal)' : 'var(--border)' }}
    >
      <div className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2"
        style={{ color: done ? 'var(--teal)' : 'var(--text3)' }}>
        {done && <span>✓</span>}
        {title}
      </div>
      {children}
    </div>
  );
}
