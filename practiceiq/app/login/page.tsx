'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.push('/dashboard');
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
            PracticeIQ
          </div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            CA Practice Management
          </div>
        </div>

        <form onSubmit={handleSignIn} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
          />
          {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
            style={{ background: 'var(--purple)', color: '#fff', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-4 text-center text-xs" style={{ color: 'var(--text3)' }}>
          <a href="/login" style={{ color: 'var(--text2)' }}>← Back to WorkFlowIQ</a>
        </div>
      </div>
    </div>
  );
}
