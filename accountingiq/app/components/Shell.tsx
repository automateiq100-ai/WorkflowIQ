'use client';

import { useApp } from '@/lib/state';
import { VIEWS, MODULES, MODULE_VIEWS } from '@/lib/constants';
import { clearSession } from '@/lib/session';
import type { ViewId, ModuleId } from '@/lib/types';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ProfilePanel from '@/app/components/ProfilePanel';

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
const AIAnalysisView      = dynamic(() => import('@/app/views/AIAnalysisView'));
const CompanySelectorView = dynamic(() => import('@/app/views/CompanySelectorView'));

const CompanyDashboardView = dynamic(() => import('@/app/views/CompanyDashboardView'));
const DataView             = dynamic(() => import('@/app/views/DataView'));
const AgentFixView         = dynamic(() => import('@/app/views/AgentFixView'));
const TallyConnectionView  = dynamic(() => import('@/app/views/TallyConnectionView'));
const MasterSetupView      = dynamic(() => import('@/app/views/MasterSetupView'));

const VIEW_COMPONENTS: Record<ViewId, React.ComponentType> = {
  'company-select':    CompanySelectorView,
  'company-dashboard': CompanyDashboardView,
  upload:              UploadView,
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
  'data-view':     DataView,
  'agent-fix':     AgentFixView as React.ComponentType,
  'tally-connection': TallyConnectionView,
  'master-setup':     MasterSetupView,
};

// Accounting module: always visible
const ACCOUNTING_ALWAYS: ViewId[] = ['company-select'];
// Accounting module: visible only when a company is selected
const ACCOUNTING_COMPANY: ViewId[] = ['company-dashboard', 'upload', 'tally-connection', 'profile', 'rules', 'master-setup'];
// Accounting module: visible only after analysis
// Flags lives inside Checklist, Health inside Dashboard, Insights inside Analysis, Fix Planner inside Data & Fix
const ACCOUNTING_POST: ViewId[] = ['dashboard', 'checklist', 'aiAnalysis', 'data-view', 'reports'];

interface UserInfo {
  name: string | null;
  email: string | null;
  image: string | null;
}

export default function Shell({ user }: { user: UserInfo | null }) {
  const { state, dispatch } = useApp();
  const { currentView, currentModule, analysed, uploadProgress, consentGiven, aiConsentGiven, theme, currentCompany, aiAnalysisLoading } = state;
  const [exporting, setExporting] = useState(false);

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

  async function handleExportExcel() {
    if (!state.results) return;
    setExporting(true);
    try {
      const { exportToExcel } = await import('@/lib/excel');
      const dbStats = state.files.daybook?.chunkedStats ?? null;
      exportToExcel({
        results: state.results,
        parsedData: state.parsedData,
        dbStats,
        companyName: currentCompany?.name ?? 'Analysis',
        periodLabel: (state.results.runAt
          ? new Date(state.results.runAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
          : 'Export'),
        sourceXml: {
          pandl: state.files.pandl.content,
          bsheet: state.files.bsheet.content,
        },
      });
    } finally {
      setExporting(false);
    }
  }

  const ViewComponent = VIEW_COMPONENTS[currentView];

  // Which nav items to show based on current module
  const moduleViews = MODULE_VIEWS[currentModule];

  return (
    <div className="flex h-full" style={{ background: 'var(--bg)' }}>
      {/* DPDPA consent modal */}
      {!consentGiven && <ConsentModal />}

      {/* ── Sidebar — full height ── */}
      <aside
        className="flex flex-col shrink-0 border-r h-full"
        style={{ width: 216, background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        {/* Branding */}
        <div className="px-5 py-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <a href="/portal" className="block" style={{ textDecoration: 'none' }}>
            <div className="text-base" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              AccountingIQ
            </div>
            <div className="text-xs" style={{ color: 'var(--teal)' }}>
              Tally XML Analyser
            </div>
          </a>
        </div>

        {/* Module switcher */}
        <div className="px-2 py-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          {MODULES.map(mod => {
            const active = currentModule === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => switchModule(mod.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-all text-left"
                style={{
                  background: active ? 'var(--bg4)' : 'transparent',
                  color: active ? 'var(--teal)' : 'var(--text2)',
                  borderLeft: active ? '2px solid var(--teal)' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: 13 }}>{mod.icon}</span>
                {mod.label}
              </button>
            );
          })}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {currentModule === 'accounting' && (
            <>
              {VIEWS.filter(v => ACCOUNTING_ALWAYS.includes(v.id)).map(v => (
                <NavItem key={v.id} view={v} active={currentView === v.id} onClick={() => navigate(v.id)} />
              ))}

              {currentCompany && (
                <>
                  <div
                    className="mx-3 my-1 px-3 py-2 rounded-lg border cursor-pointer text-xs"
                    style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text2)' }}
                    onClick={() => navigate('company-select')}
                  >
                    <div style={{ color: 'var(--text3)', fontSize: 10 }}>Working on</div>
                    <div className="truncate font-semibold" style={{ color: 'var(--teal)' }}>
                      {currentCompany.name}
                    </div>
                  </div>
                  {VIEWS.filter(v => ACCOUNTING_COMPANY.includes(v.id)).map(v => (
                    <NavItem key={v.id} view={v} active={currentView === v.id} onClick={() => navigate(v.id)} />
                  ))}
                </>
              )}

              {analysed && (
                <>
                  <div className="mx-4 my-2 border-t" style={{ borderColor: 'var(--border)' }} />
                  {VIEWS.filter(v => ACCOUNTING_POST.includes(v.id)).map(v => {
                    const isAILocked = v.id === 'aiAnalysis' && !aiConsentGiven;
                    const showPulse = v.id === 'aiAnalysis' && aiAnalysisLoading;
                    return (
                      <NavItem
                        key={v.id}
                        view={v}
                        active={currentView === v.id}
                        onClick={() => navigate(v.id)}
                        locked={isAILocked}
                        showPulse={showPulse}
                      />
                    );
                  })}
                </>
              )}
            </>
          )}
        </nav>

        {/* Tools row: Excel export */}
        {analysed && state.results && (
          <div
            className="px-3 py-2 border-t shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <button
              onClick={handleExportExcel}
              disabled={exporting}
              title="Download Excel workbook"
              className="flex items-center gap-1.5 px-3 h-7 rounded-md border text-xs font-medium w-full transition-all disabled:opacity-40"
              style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text2)' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.color = 'var(--teal)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.color = 'var(--text2)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              }}
            >
              {exporting ? '⟳' : '⬇'} {exporting ? 'Generating…' : 'Excel'}
            </button>
          </div>
        )}

        {/* Clear session */}
        <div className="px-3 pb-1 shrink-0">
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

      {/* Theme toggle — fixed top-right */}
      <button
        onClick={toggleTheme}
        id="theme-toggle"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="fixed flex items-center justify-center rounded-lg border text-sm transition-all"
        style={{
          top: 12, right: 16, width: 32, height: 32, zIndex: 50,
          background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text2)',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--teal)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text2)')}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
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
  );
}

function UserFooter({ user }: { user: UserInfo | null }) {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  if (!user) return null;

  const displayName = user.name ?? user.email ?? 'User';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <>
      {/* Avatar + name row */}
      <div className="px-3 py-2.5 flex items-center gap-2.5 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setProfileOpen(true)}
          className="flex items-center gap-2 flex-1 min-w-0 rounded-lg px-1 py-0.5 transition-colors text-left"
          style={{ background: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate" style={{ color: 'var(--text1)' }}>
              {displayName}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>View profile</div>
          </div>
        </button>
      </div>

      {/* Portal link + Sign out strip */}
      <div
        className="px-4 pb-3 flex items-center gap-4 border-t text-xs"
        style={{ borderColor: 'var(--border)', paddingTop: 10 }}
      >
        <a
          href="/portal"
          className="transition-colors"
          style={{ color: 'var(--text2)', textDecoration: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--teal)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text2)')}
        >
          ← Portal
        </a>
        <button
          onClick={handleSignOut}
          className="transition-colors"
          style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
        >
          Sign out
        </button>
      </div>

      {profileOpen && (
        <ProfilePanel
          user={{ name: user.name, email: user.email ?? '', mobile: null }}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </>
  );
}

function NavItem({
  view,
  active,
  onClick,
  locked,
  showPulse,
}: {
  view: { id: ViewId; label: string; icon: string };
  active: boolean;
  onClick: () => void;
  locked?: boolean;
  showPulse?: boolean;
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
      <span className="flex-1">{view.label}</span>
      {showPulse && (
        <span
          className="ml-auto w-2 h-2 rounded-full animate-pulse shrink-0"
          style={{ background: 'var(--purple)' }}
          title="AI analysis running…"
        />
      )}
    </button>
  );
}
