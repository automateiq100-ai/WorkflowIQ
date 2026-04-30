'use client';

import { useEffect, useState } from 'react';
import type { ConnectorSession, ConnectorCompany } from '@/lib/connectors/types';

const SESSION_KEY = 'aiq.tallySession';

function loadSession(): ConnectorSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ConnectorSession) : null;
  } catch { return null; }
}

function saveSession(s: ConnectorSession | null): void {
  if (typeof window === 'undefined') return;
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
}

export default function TallyConnectionView() {
  const [session, setSession] = useState<ConnectorSession | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [companies, setCompanies] = useState<ConnectorCompany[] | null>(null);
  const [loadingCo, setLoadingCo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setSession(loadSession()); }, []);

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
