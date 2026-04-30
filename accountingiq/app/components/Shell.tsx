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
};

// Accounting module: always visible
const ACCOUNTING_ALWAYS: ViewId[] = ['company-select'];
// Accounting module: visible only when a company is selected
const ACCOUNTING_COMPANY: ViewId[] = ['company-dashboard', 'upload', 'tally-connection', 'profile', 'rules'];
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
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* DPDPA consent modal */}
      {!consentGiven && <ConsentModal />}

      {/* ── Top Module Tab Bar ── */}
      <header
        className="shrink-0 flex items-center border-b px-4"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)', height: 48 }}
      >
        {/* Logo / Home button */}
        <a
          href="/portal"
          className="flex items-center gap-1.5 text-sm font-semibold tracking-tight mr-6 transition-opacity"
          style={{ color: 'var(--text1)', fontFamily: 'var(--font-dm-serif)', textDecoration: 'none' }}
          title="Back to Portal"
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>⌂</span>
          AccountingIQ
        </a>

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

        {/* Export Excel — only when analysis is done */}
        {analysed && state.results && (
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            title="Download Excel workbook"
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg border text-xs font-medium transition-all disabled:opacity-40"
            style={{
              background: 'var(--bg3)',
              borderColor: 'var(--border)',
              color: 'var(--text2)',
              marginRight: 4,
            }}
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
        )}

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

                {/* Working-on chip + company-gated views */}
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

                {/* Divider + post-analysis */}
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
      <div className="p-3 flex items-center gap-2.5 border-t" style={{ borderColor: 'var(--border)' }}>
        {/* Avatar — clickable to open profile panel */}
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
            <div className="text-xs" style={{ color: 'var(--text3)', fontSize: 10 }}>
              View profile
            </div>
          </div>
        </button>
        <button
          onClick={handleSignOut}
          className="text-xs transition-colors shrink-0"
          style={{ color: 'var(--text3)' }}
          title="Sign out"
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
        >
          ⏻
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
