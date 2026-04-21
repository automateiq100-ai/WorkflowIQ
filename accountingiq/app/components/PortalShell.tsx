'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import ProfilePanel from './ProfilePanel';

interface UserInfo {
  name: string | null;
  email: string;
  mobile: string | null;
}

const ALL_TOOLS = [
  {
    id: 'accountingiq',
    label: 'AccountingIQ',
    tagline: 'Tally XML Analyser',
    tagColor: 'var(--teal)',
    icon: '📊',
    description: '59 health checks across 8 dimensions. Upload Tally XML exports and get a 0–100 accounting quality score.',
    href: '/accountingiq',
  },
  {
    id: 'researchiq',
    label: 'ResearchIQ',
    tagline: 'AI-Powered Legal Research',
    tagColor: 'var(--blue)',
    icon: '⚖️',
    description: 'Search and analyse thousands of legal cases. AI-powered relevancy scoring and synthesis memos.',
    href: null,
  },
];

export default function PortalShell({
  user,
  selectedTools,
}: {
  user: UserInfo;
  selectedTools: string[];
}) {
  const router = useRouter();

  const displayName = user.name ?? user.email;
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  const visibleTools = ALL_TOOLS.filter(t => selectedTools.includes(t.id));

  // Profile panel state
  const [profileOpen, setProfileOpen] = useState(false);

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
    window.location.href = `/researchiq#${hash}`;
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  function handleToolClick(tool: typeof ALL_TOOLS[number]) {
    if (tool.id === 'researchiq') {
      goToResearchIQ();
    } else if (tool.href) {
      router.push(tool.href);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
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
            WorkflowIQ
          </div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>Your AI-powered workspace</div>
        </div>

        {/* User */}
        <div className="flex items-center gap-2.5">
          {/* Profile button */}
          <button
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors"
            style={{ color: 'var(--text2)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: 'var(--teal)', color: '#000' }}
            >
              {initials}
            </div>
            <span className="text-xs">{displayName}</span>
          </button>
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

        {visibleTools.length === 0 ? (
          <div
            className="rounded-xl border p-8 text-center max-w-sm"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
          >
            <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
              You don&apos;t have access to any tools yet.
            </p>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              Contact your administrator to enable tool access for your account.
            </p>
          </div>
        ) : (
          <div className="flex gap-6 flex-wrap justify-center w-full max-w-2xl">
            {visibleTools.map(tool => (
              <button
                key={tool.id}
                onClick={() => handleToolClick(tool)}
                className="flex-1 min-w-64 rounded-2xl border p-8 text-left transition-all"
                style={{ background: 'var(--bg2)', borderColor: 'var(--border)', minWidth: 260 }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = tool.tagColor;
                  (e.currentTarget as HTMLElement).style.background = 'var(--bg3)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                  (e.currentTarget as HTMLElement).style.background = 'var(--bg2)';
                }}
              >
                <div className="text-3xl mb-4">{tool.icon}</div>
                <div
                  className="text-lg mb-1"
                  style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
                >
                  {tool.label}
                </div>
                <div className="text-xs mb-4" style={{ color: tool.tagColor }}>
                  {tool.tagline}
                </div>
                <p className="text-sm" style={{ color: 'var(--text2)' }}>
                  {tool.description}
                </p>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Profile slide panel */}
      {profileOpen && (
        <ProfilePanel
          user={user}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </div>
  );
}
