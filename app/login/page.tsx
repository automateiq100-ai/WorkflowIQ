'use client';

import { Suspense, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

type Tab = 'signin' | 'signup';

// Whitelist of safe redirect destinations after sign-in. Mirror of the
// guard in app/auth/callback/route.ts:isSafeNextPath.
function safeNext(raw: string | null, fallback = '/'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  const okPaths = ['/', '/login', '/reset-password'];
  if (okPaths.includes(raw)) return raw;
  return fallback;
}

const COUNTRY_CODES = [
  { flag: '🇮🇳', code: '+91',  name: 'India' },
  { flag: '🇺🇸', code: '+1',   name: 'USA' },
  { flag: '🇬🇧', code: '+44',  name: 'UK' },
  { flag: '🇦🇪', code: '+971', name: 'UAE' },
  { flag: '🇸🇬', code: '+65',  name: 'Singapore' },
  { flag: '🇦🇺', code: '+61',  name: 'Australia' },
  { flag: '🇨🇦', code: '+1',   name: 'Canada' },
  { flag: '🇩🇪', code: '+49',  name: 'Germany' },
];

export default function LoginPage() {
  // Suspense wraps the inner component because useSearchParams() requires
  // a CSR bailout boundary in Next.js 16.
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="text-sm" style={{ color: 'var(--text3)' }}>Loading…</div>
    </div>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams?.get('next') ?? null);
  const [tab, setTab] = useState<Tab>('signin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Sign in fields
  const [siEmail, setSiEmail] = useState('');
  const [siPassword, setSiPassword] = useState('');

  // Sign up fields
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suCountry, setSuCountry] = useState(COUNTRY_CODES[0]);
  const [suMobile, setSuMobile] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: siEmail, password: siPassword });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.push(next);
      router.refresh();
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (suPassword !== suConfirm) { setError('Passwords do not match.'); return; }
    if (suPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: suEmail,
      password: suPassword,
      options: {
        data: { full_name: suName.trim(), mobile: `${suCountry.code} ${suMobile.trim()}` },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else if (data.session) {
      // Email confirmation is disabled — session is live immediately.
      // The home page bootstraps the profile row on first load.
      router.push(next);
      router.refresh();
    } else {
      setMessage('Check your email for a verification link to complete sign-up.');
    }
  }

  const inputStyle = {
    background: 'var(--bg4)',
    border: '1px solid var(--border)',
    color: 'var(--text1)',
  };

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
      <div
        className="max-w-sm w-full mx-4 rounded-xl border p-8"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        {/* Logo */}
        <div className="mb-6 text-center">
          <div
            className="text-2xl mb-1"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            AccountingIQ
          </div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Tally XML Accounting Health Analyser
          </div>
        </div>

        {/* Tabs */}
        <div className="flex mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
          {(['signin', 'signup'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); setMessage(null); }}
              className="flex-1 pb-2 text-sm font-medium transition-colors"
              style={{
                color: tab === t ? 'var(--teal)' : 'var(--text3)',
                borderBottom: tab === t ? '2px solid var(--teal)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {message ? (
          <div
            className="rounded-lg p-4 text-sm text-center"
            style={{ background: 'var(--bg4)', color: 'var(--teal)', border: '1px solid var(--border)' }}
          >
            {message}
          </div>
        ) : tab === 'signin' ? (
          <form onSubmit={handleSignIn} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              value={siEmail}
              onChange={e => setSiEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password"
              value={siPassword}
              onChange={e => setSiPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
              style={{ background: 'var(--teal)', color: '#000', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <Link
              href="/forgot-password"
              className="text-xs text-center transition-colors"
              style={{ color: 'var(--text3)' }}
            >
              Forgot password?
            </Link>
          </form>
        ) : (
          <form onSubmit={handleSignUp} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Full name"
              value={suName}
              onChange={e => setSuName(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="email"
              placeholder="Email"
              value={suEmail}
              onChange={e => setSuEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            <div className="flex gap-2">
              <select
                value={suCountry.code + suCountry.name}
                onChange={e => setSuCountry(COUNTRY_CODES.find(c => c.code + c.name === e.target.value) ?? COUNTRY_CODES[0])}
                className="shrink-0 px-2 py-2.5 rounded-lg text-sm outline-none"
                style={{ ...inputStyle, width: 110 }}
              >
                {COUNTRY_CODES.map(c => (
                  <option key={c.code + c.name} value={c.code + c.name}>
                    {c.flag} {c.code}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                placeholder="Mobile number"
                value={suMobile}
                onChange={e => setSuMobile(e.target.value)}
                required
                className="flex-1 px-3 py-2.5 rounded-lg text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <input
              type="password"
              placeholder="Password (min 8 characters)"
              value={suPassword}
              onChange={e => setSuPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={suConfirm}
              onChange={e => setSuConfirm(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
              style={{ background: 'var(--teal)', color: '#000', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
