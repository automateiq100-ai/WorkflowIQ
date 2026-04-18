'use client';

import { useApp } from '@/lib/state';
import { VIEWS, MODULES, MODULE_VIEWS } from '@/lib/constants';
import { clearSession } from '@/lib/session';
import type { ViewId, ModuleId } from '@/lib/types';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// Lazy-load views
const ConsentModal      = dynamic(() => import('@/app/components/ConsentModal'));
const UploadView        = dynamic(() => import('@/app/views/UploadView'));
const DashboardView     = dynamic(() => import('@/app/views/DashboardView'));
const ChecklistView     = dynamic(() => import('@/app/views/ChecklistView'));
const InsightsView      = dynamic(() => import('@/app/views/InsightsView'));
const HealthView        = dynamic(() => import('@/app/views/HealthView'));
const FlagsView         = dynamic(() => import('@/app/views/FlagsView'));
const ProfileView       = dynamic(() => import('@/app/views/ProfileView'));
const ReportsView       = dynamic(() => import('@/app/views/ReportsView'));
const RulesView         = dynamic(() => import('@/app/views/RulesView'));
const MISReportView     = dynamic(() => import('@/app/views/MISReportView'));
const ReconciliationView = dynamic(() => import('@/app/views/ReconciliationView'));
const AIAnalysisView    = dynamic(() => import('@/app/views/AIAnalysisView'));

const VIEW_COMPONENTS: Record<ViewId, React.ComponentType> = {
  upload:          UploadView,
  dashboard:       DashboardView,
  checklist:       ChecklistView,
  insights:        InsightsView,
  health:          HealthView,
  flags:           FlagsView,
  profile:         ProfileView,
  reports:         ReportsView,
  rules:           RulesView,
  'mis-setup':     MISReportView,
  'mis-report':    MISReportView,
  reconciliation:  ReconciliationView,
  aiAnalysis:      AIAnalysisView,
};

// Accounting module: views always visible
const ACCOUNTING_ALWAYS: ViewId[] = ['upload', 'profile', 'rules'];
// Accounting module: views only after analysis
const ACCOUNTING_POST: ViewId[] = ['dashboard', 'checklist', 'insights', 'aiAnalysis', 'health', 'flags', 'reports'];

interface UserInfo {
  name: string | null;
  email: string | null;
  image: string | null;
}

export default function Shell({ user }: { user: UserInfo | null }) {
  const { state, dispatch } = useApp();
  const { currentView, currentModule, analysed, uploadProgress, consentGiven, aiConsentGiven, theme } = state;

  function navigate(view: ViewId) {
    dispatch({ type: 'SET_VIEW', view });
  }

  function switchModule(mod: ModuleId) {
    dispatch({ type: 'SET_MODULE', module: mod });
  }

  function toggleTheme() {
    dispatch({ type: 'SET_THEME', theme: theme === 'dark' ? 'light' : 'dark' });
  }

  function handleClear() {
    clearSession();
    dispatch({ type: 'SESSION_CLEARED' });
  }

  const ViewComponent = VIEW_COMPONENTS[currentView];

  // Which nav items to show based on current module
  const moduleViews = MODULE_VIEWS[currentModule];

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* DPDPA consent modal */}
      {!consentGiven && <ConsentModal />}

      {/* ── Top Module Tab Bar ── */}
      <header
        className="shrink-0 flex items-center border-b px-4"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)', height: 48 }}
      >
        {/* Logo */}
        <div
          className="text-sm font-semibold tracking-tight mr-6"
          style={{ color: 'var(--text1)', fontFamily: 'var(--font-dm-serif)' }}
        >
          AccountingIQ
        </div>

        {/* Module tabs */}
        <nav className="flex items-center flex-1 gap-1">
          {MODULES.map(mod => {
            const active = currentModule === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => switchModule(mod.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-all"
                style={{
                  background: active ? 'var(--bg4)' : 'transparent',
                  color: active ? 'var(--teal)' : 'var(--text2)',
                  borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
                  borderRadius: active ? '6px 6px 0 0' : '6px',
                }}
              >
                <span style={{ fontSize: 12 }}>{mod.icon}</span>
                {mod.label}
              </button>
            );
          })}
        </nav>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          id="theme-toggle"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-8 h-8 flex items-center justify-center rounded-lg border text-sm transition-all"
          style={{
            background: 'var(--bg3)',
            borderColor: 'var(--border)',
            color: 'var(--text2)',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--teal)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text2)')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      {/* ── Main body: sidebar + content ── */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className="flex flex-col shrink-0 border-r"
          style={{ width: 200, background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {/* Nav */}
          <nav className="flex-1 py-3 overflow-y-auto">
            {currentModule === 'accounting' && (
              <>
                {/* Always visible */}
                {VIEWS.filter(v => ACCOUNTING_ALWAYS.includes(v.id)).map(v => (
                  <NavItem key={v.id} view={v} active={currentView === v.id} onClick={() => navigate(v.id)} />
                ))}

                {/* Divider + post-analysis */}
                {analysed && (
                  <>
                    <div className="mx-4 my-2 border-t" style={{ borderColor: 'var(--border)' }} />
                    {VIEWS.filter(v => ACCOUNTING_POST.includes(v.id)).map(v => {
                      // Lock AI Analysis tab if user hasn't consented
                      const isAILocked = v.id === 'aiAnalysis' && !aiConsentGiven;
                      return (
                        <NavItem
                          key={v.id}
                          view={v}
                          active={currentView === v.id}
                          onClick={() => navigate(v.id)}
                          locked={isAILocked}
                        />
                      );
                    })}
                  </>
                )}
              </>
            )}

            {currentModule === 'mis' && (
              <div className="px-5 py-4 text-xs" style={{ color: 'var(--text3)' }}>
                {/* Sidebar nav intentionally left blank for MIS module to avoid redundant tabs */}
              </div>
            )}

            {currentModule === 'reconciliation' && (
              <div className="px-5 py-4 text-xs" style={{ color: 'var(--text3)' }}>
                {/* Sidebar nav intentionally left blank for Reconciliation */}
              </div>
            )}
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

        {/* Main content */}
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

          <main className="flex-1 overflow-y-auto">
            <ViewComponent />
          </main>
        </div>
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
    <div className="p-3 flex items-center gap-2.5 border-t" style={{ borderColor: 'var(--border)' }}>
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
  locked,
}: {
  view: { id: ViewId; label: string; icon: string };
  active: boolean;
  onClick: () => void;
  locked?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors"
      style={{
        background: active ? 'var(--bg4)' : 'transparent',
        color: active ? 'var(--text1)' : locked ? 'var(--text3)' : 'var(--text2)',
        borderLeft: active ? '2px solid var(--teal)' : '2px solid transparent',
        opacity: locked ? 0.6 : 1,
      }}
    >
      <span className="text-base w-4 text-center shrink-0">{locked ? '🔒' : view.icon}</span>
      <span>{view.label}</span>
    </button>
  );
}
