'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
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
        <div className="mb-6 text-center">
          <div
            className="text-2xl mb-1"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            Reset password
          </div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            We&apos;ll email you a link to set a new password
          </div>
        </div>

        {sent ? (
          <div
            className="rounded-lg p-4 text-sm text-center"
            style={{ background: 'var(--bg4)', color: 'var(--teal)', border: '1px solid var(--border)' }}
          >
            If an account exists for {email}, a reset link is on its way. Check your inbox.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
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
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <Link href="/login" className="text-xs transition-colors" style={{ color: 'var(--text3)' }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
