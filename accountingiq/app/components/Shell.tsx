'use client';

import { useApp } from '@/lib/state';
import { VIEWS } from '@/lib/constants';
import { clearSession } from '@/lib/session';
import type { ViewId } from '@/lib/types';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// Lazy-load views to keep initial bundle small
const UploadView    = dynamic(() => import('@/app/views/UploadView'));
const DashboardView = dynamic(() => import('@/app/views/DashboardView'));
const ChecklistView = dynamic(() => import('@/app/views/ChecklistView'));
const InsightsView  = dynamic(() => import('@/app/views/InsightsView'));
const HealthView    = dynamic(() => import('@/app/views/HealthView'));
const FlagsView     = dynamic(() => import('@/app/views/FlagsView'));
const ProfileView   = dynamic(() => import('@/app/views/ProfileView'));
const ReportsView   = dynamic(() => import('@/app/views/ReportsView'));

const VIEW_COMPONENTS: Record<ViewId, React.ComponentType> = {
  upload:    UploadView,
  dashboard: DashboardView,
  checklist: ChecklistView,
  insights:  InsightsView,
  health:    HealthView,
  flags:     FlagsView,
  profile:   ProfileView,
  reports:   ReportsView,
};

// Views always visible in nav (regardless of analysed state)
const ALWAYS_VISIBLE: ViewId[] = ['upload', 'profile'];
// Views only visible after analysis
const POST_ANALYSIS: ViewId[] = ['dashboard', 'checklist', 'insights', 'health', 'flags', 'reports'];

interface UserInfo {
  name: string | null;
  email: string | null;
  image: string | null;
}

export default function Shell({ user }: { user: UserInfo | null }) {
  const { state, dispatch } = useApp();
  const { currentView, analysed, uploadProgress } = state;

  function navigate(view: ViewId) {
    dispatch({ type: 'SET_VIEW', view });
  }

  function handleClear() {
    clearSession();
    dispatch({ type: 'SESSION_CLEARED' });
  }

  const ViewComponent = VIEW_COMPONENTS[currentView];

  return (
    <div className="flex h-full" style={{ background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col shrink-0 border-r"
        style={{
          width: 220,
          background: 'var(--bg2)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Logo */}
        <div className="px-5 pt-6 pb-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div
            className="text-base font-semibold tracking-tight"
            style={{ color: 'var(--text1)', fontFamily: 'var(--font-dm-serif)' }}
          >
            AccountingIQ
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
            Tally XML Analyser
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {/* Always visible */}
          {VIEWS.filter(v => ALWAYS_VISIBLE.includes(v.id)).map(v => (
            <NavItem
              key={v.id}
              view={v}
              active={currentView === v.id}
              onClick={() => navigate(v.id)}
            />
          ))}

          {/* Divider */}
          {analysed && (
            <div className="mx-4 my-2 border-t" style={{ borderColor: 'var(--border)' }} />
          )}

          {/* Post-analysis views */}
          {analysed && VIEWS.filter(v => POST_ANALYSIS.includes(v.id)).map(v => (
            <NavItem
              key={v.id}
              view={v}
              active={currentView === v.id}
              onClick={() => navigate(v.id)}
            />
          ))}
        </nav>

        {/* Clear session */}
        <div className="px-3 pt-2" style={{ borderTop: `1px solid var(--border)` }}>
          <button
            onClick={handleClear}
            className="w-full text-xs px-3 py-2 rounded text-left transition-colors"
            style={{ color: 'var(--text3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
          >
            ✕ Clear session
          </button>
        </div>

        {/* User footer */}
        <UserFooter user={user} />
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Progress banner */}
        {uploadProgress && (
          <div
            className="px-4 py-2 text-xs text-center shrink-0"
            style={{ background: 'var(--bg4)', color: 'var(--amber)' }}
          >
            {uploadProgress}
          </div>
        )}

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <ViewComponent />
        </main>
      </div>
    </div>
  );
}

function UserFooter({ user }: { user: UserInfo | null }) {
  const router = useRouter();
  if (!user) return null;

  const displayName = user.name ?? user.email ?? 'User';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div
      className="p-3 flex items-center gap-2.5 border-t"
      style={{ borderColor: 'var(--border)' }}
    >
      {/* Avatar */}
      {user.image ? (
        <Image
          src={user.image}
          alt={displayName}
          width={28}
          height={28}
          className="rounded-full shrink-0"
        />
      ) : (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          {initials}
        </div>
      )}

      {/* Name + sign out */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: 'var(--text1)' }}>
          {displayName}
        </div>
        <button
          onClick={handleSignOut}
          className="text-xs transition-colors"
          style={{ color: 'var(--text3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function NavItem({
  view,
  active,
  onClick,
}: {
  view: { id: ViewId; label: string; icon: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors"
      style={{
        background: active ? 'var(--bg4)' : 'transparent',
        color: active ? 'var(--text1)' : 'var(--text2)',
        borderLeft: active ? '2px solid var(--teal)' : '2px solid transparent',
      }}
    >
      <span className="text-base w-4 text-center shrink-0">{view.icon}</span>
      <span>{view.label}</span>
    </button>
  );
}
