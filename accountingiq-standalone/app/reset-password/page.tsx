'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  // The recovery link routes through /auth/callback, which exchanges the code
  // for a session before redirecting here. Confirm a session is present.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      } else {
        setError('This reset link is invalid or has expired. Please request a new one.');
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setDone(true);
      setTimeout(() => { router.push('/'); router.refresh(); }, 1500);
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
            Set a new password
          </div>
        </div>

        {done ? (
          <div
            className="rounded-lg p-4 text-sm text-center"
            style={{ background: 'var(--bg4)', color: 'var(--teal)', border: '1px solid var(--border)' }}
          >
            Password updated. Redirecting…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="New password (min 8 characters)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={!ready}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              disabled={!ready}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
            <button
              type="submit"
              disabled={loading || !ready}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
              style={{ background: 'var(--teal)', color: '#000', opacity: (loading || !ready) ? 0.6 : 1 }}
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
