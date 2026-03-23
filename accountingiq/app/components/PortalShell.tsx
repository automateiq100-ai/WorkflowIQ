'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

interface UserInfo {
  name: string | null;
  email: string;
  image: string | null;
}

export default function PortalShell({
  user,
  hasMobile,
}: {
  user: UserInfo;
  hasMobile: boolean;
}) {
  const [mobile, setMobile] = useState('');
  const [showModal, setShowModal] = useState(!hasMobile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const displayName = user.name ?? user.email;
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  async function handleMobileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mobile.trim()) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/portal/mobile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: mobile.trim() }),
    });
    if (res.ok) {
      setShowModal(false);
    } else {
      setError('Failed to save. Please try again.');
    }
    setSaving(false);
  }

  async function goToResearchIQ() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const hash = [
      `access_token=${session.access_token}`,
      `refresh_token=${session.refresh_token}`,
      `expires_in=${session.expires_in}`,
      `token_type=bearer`,
      `type=bearer`,
    ].join('&');
    // ResearchIQ is served at /researchiq on the same origin via Next.js proxy
    window.location.href = `/researchiq#${hash}`;
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Mobile number modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-2xl border p-8"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            <div className="mb-5">
              <div
                className="text-lg font-semibold mb-1"
                style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
              >
                One last thing
              </div>
              <p className="text-sm" style={{ color: 'var(--text2)' }}>
                Add your mobile number so we can reach you if needed.
              </p>
            </div>

            <form onSubmit={handleMobileSubmit} className="flex flex-col gap-3">
              <input
                type="tel"
                placeholder="+91 98765 43210"
                value={mobile}
                onChange={e => setMobile(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{
                  background: 'var(--bg4)',
                  border: '1px solid var(--border)',
                  color: 'var(--text1)',
                }}
              />
              {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
                style={{ background: 'var(--teal)', color: '#000', opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Continue'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <header
        className="px-6 py-4 border-b flex items-center justify-between shrink-0"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div>
          <div
            className="text-lg"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            WorkFlowIQ
          </div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>Your AI-powered workspace</div>
        </div>

        {/* User */}
        <div className="flex items-center gap-2.5">
          {user.image ? (
            <Image src={user.image} alt={displayName} width={28} height={28} className="rounded-full shrink-0" />
          ) : (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: 'var(--teal)', color: '#000' }}
            >
              {initials}
            </div>
          )}
          <div className="text-xs" style={{ color: 'var(--text2)' }}>{displayName}</div>
          <button
            onClick={handleSignOut}
            className="text-xs ml-1 transition-colors"
            style={{ color: 'var(--text3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tool selection */}
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="mb-10 text-center">
          <h1
            className="text-3xl mb-2"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            Choose your tool
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Welcome back, {user.name?.split(' ')[0] ?? 'there'}
          </p>
        </div>

        <div className="flex gap-6 flex-wrap justify-center w-full max-w-2xl">
          {/* AccountingIQ card — coming soon */}
          <div
            className="flex-1 min-w-64 rounded-2xl border p-8 text-left"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)', minWidth: 260, opacity: 0.5, cursor: 'not-allowed' }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="text-3xl">📊</div>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--bg4)', color: 'var(--text3)', border: '1px solid var(--border)' }}
              >
                Launching soon
              </span>
            </div>
            <div
              className="text-lg mb-1"
              style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
            >
              AccountingIQ
            </div>
            <div className="text-xs mb-4" style={{ color: 'var(--teal)' }}>
              Tally XML Analyser
            </div>
            <p className="text-sm" style={{ color: 'var(--text2)' }}>
              59 health checks across 8 dimensions. Upload Tally XML exports and get a 0–100 accounting quality score.
            </p>
          </div>

          {/* ResearchIQ card */}
          <button
            onClick={goToResearchIQ}
            className="flex-1 min-w-64 rounded-2xl border p-8 text-left transition-all"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)', minWidth: 260 }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--blue)';
              (e.currentTarget as HTMLElement).style.background = 'var(--bg3)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLElement).style.background = 'var(--bg2)';
            }}
          >
            <div className="text-3xl mb-4">⚖️</div>
            <div
              className="text-lg mb-1"
              style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
            >
              ResearchIQ
            </div>
            <div className="text-xs mb-4" style={{ color: 'var(--blue)' }}>
              AI-Powered Legal Research
            </div>
            <p className="text-sm" style={{ color: 'var(--text2)' }}>
              Search and analyse thousands of legal cases. AI-powered relevancy scoring and synthesis memos.
            </p>
          </button>
        </div>
      </main>
    </div>
  );
}
