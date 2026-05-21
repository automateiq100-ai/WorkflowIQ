'use client';

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type {
  AppState, FileKey, FileEntry, AnalysisResults, CompanyProfile,
  ParsedData, ChunkedStats, ViewId, ModuleId, Theme, MISSetup, AIResponse, ActiveCompany, FixTask,
} from './types';
import { MODULE_VIEWS } from './constants';
import { loadOverrides, saveOverrides, type OverrideMap } from './ledger-overrides';
import { loadMISProfile, saveMISProfile } from './mis-profile-storage';

// ── default state ──────────────────────────────────────────────────────────
function emptyFile(): FileEntry {
  return { name: '', size: 0, content: null, hasContent: false, chunkedStats: null, sessionExpired: false };
}

export const DEFAULT_FILTERS: CompanyProfile = {
  gstApplicable: false,
  gstRegular: false,
  tdsApplicable: false,
  hasEmployees: false,
  hasFAfilter: false,
  isGoods: false,
  fullFY: true,
};

const FILE_KEYS: FileKey[] = [
  'daybook','trialbal','pandl','bsheet','grpsum',
  'sales','purchase','bills','payables','cashflow',
  'faregister','stock','bankrecon','master',
];

function initialFiles(): Record<FileKey, FileEntry> {
  return Object.fromEntries(FILE_KEYS.map(k => [k, emptyFile()])) as Record<FileKey, FileEntry>;
}

const DEFAULT_MIS_SETUP: MISSetup = {
  sector: null,
  hasBudget: false,
  selectedMetricIds: [],
};

const INITIAL_STATE: AppState = {
  files: initialFiles(),
  parsedData: {},
  results: null,
  filters: DEFAULT_FILTERS,
  analysed: false,
  currentView: 'company-select',
  currentModule: 'accounting',
  theme: 'dark',
  consentGiven: false,
  aiConsentGiven: false,
  uploadProgress: null,
  misSetup: DEFAULT_MIS_SETUP,
  aiAnalysis: null,
  aiAnalysisHash: null,
  currentCompany: null,
  fixTasks: null,
  fixTasksLoading: false,
  aiAnalysisLoading: false,
  aiAnalysisError: null,
};

// ── actions ───────────────────────────────────────────────────────────────
export type Action =
  | { type: 'CONSENT_GIVEN' }
  | { type: 'AI_CONSENT_GIVEN' }
  | { type: 'SET_VIEW'; view: ViewId }
  | { type: 'SET_MODULE'; module: ModuleId }
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'FILE_LOADED'; key: FileKey; entry: Partial<FileEntry> }
  | { type: 'FILE_REMOVED'; key: FileKey }
  | { type: 'UPLOAD_PROGRESS'; message: string | null }
  | { type: 'ANALYSIS_DONE'; results: AnalysisResults; parsedData: Partial<ParsedData>; dbStats: ChunkedStats | null }
  | { type: 'FILTERS_UPDATED'; filters: CompanyProfile }
  | { type: 'MIS_SETUP_UPDATED'; misSetup: Partial<MISSetup> }
  | { type: 'AI_ANALYSIS_DONE'; analysis: AIResponse; hash: string }
  | { type: 'AI_ANALYSIS_CLEAR' }
  | { type: 'SESSION_CLEARED' }
  | { type: 'COMPANY_SELECTED'; company: ActiveCompany; filters: CompanyProfile }
  | { type: 'COMPANY_DESELECTED' }
  | { type: 'FIX_TASKS_LOADING' }
  | { type: 'FIX_TASKS_LOADED'; tasks: FixTask[] }
  | { type: 'FIX_TASK_STATUS'; id: string; status: FixTask['status'] }
  | { type: 'FIX_TASKS_CLEAR' }
  | { type: 'AI_ANALYSIS_LOADING' }
  | { type: 'AI_ANALYSIS_ERROR'; error: string }
  | { type: 'LEDGER_OVERRIDES_SET'; overrides: OverrideMap }
  | { type: 'REQUESTED_PERIOD_SET'; period: { start: string; end: string; type: 'monthly' | 'quarterly' | 'yearly' | 'custom' } }
  | { type: 'MIS_MANUAL_INPUTS_SET'; inputs: import('./layer2/types').ManualInputs }
  | { type: 'MIS_BUDGET_SET'; budget: import('./layer2/types').BudgetData | null }
  | { type: 'MIS_DOCUMENT_ADDED'; doc: import('./types').MISDocumentRef }
  | { type: 'MIS_DOCUMENT_REMOVED'; id: string }
  | { type: 'MIS_RULES_SET'; rules: import('./layer2/rules').Rule[] }
  | { type: 'MIS_RULES_UPSERT'; rule: import('./layer2/rules').Rule }
  | { type: 'MIS_RULES_DELETE'; id: string }
  | { type: 'MIS_RULES_RESET' }
  | { type: 'MIS_BACKUP_FOCUS'; metricId: string | null }
  | { type: 'MIS_UPLOAD_DEEPLINK'; deepLink: { tab: 'tally' | 'excel' | 'pdf' | 'manual'; sourceId?: string } | null };

/** Action types that mutate the MIS profile and should trigger a save. */
const MIS_PROFILE_ACTIONS: ReadonlySet<Action['type']> = new Set([
  'MIS_SETUP_UPDATED',
  'MIS_MANUAL_INPUTS_SET',
  'MIS_BUDGET_SET',
  'MIS_DOCUMENT_ADDED',
  'MIS_DOCUMENT_REMOVED',
  'MIS_RULES_SET',
  'MIS_RULES_UPSERT',
  'MIS_RULES_DELETE',
  'MIS_RULES_RESET',
]);

function reducerInner(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CONSENT_GIVEN':
      return { ...state, consentGiven: true };

    case 'AI_CONSENT_GIVEN':
      return { ...state, aiConsentGiven: true };

    case 'SET_VIEW':
      return { ...state, currentView: action.view };

    case 'SET_MODULE': {
      // No-op when the user clicks their already-active module — keep them
      // on whatever view they're on rather than reshuffling.
      if (state.currentModule === action.module) return state;
      // Restore the user's last position in the target module (within this
      // session) instead of dumping them on the module's first view.
      // Falls back to a smart default when no memory exists or the
      // remembered view is no longer reachable (e.g. it requires a company
      // that's no longer selected).
      const remembered = state.lastViewByModule?.[action.module];
      const moduleViews = MODULE_VIEWS[action.module];
      const REQUIRES_COMPANY: ViewId[] = [
        'company-dashboard', 'upload', 'profile', 'rules', 'master-setup',
        'dashboard', 'checklist', 'insights', 'aiAnalysis', 'health', 'flags',
        'reports', 'data-view', 'agent-fix', 'tally-connection',
        // MIS views all assume a company too
        'mis-profile', 'mis-upload', 'mis-fix', 'mis-rules',
        'mis-dashboard', 'mis-metrics-checklist', 'mis-checklist', 'mis-analysis',
        'mis-report-cover', 'mis-report-pl', 'mis-report-cf', 'mis-report-bs',
        'mis-report-wc', 'mis-report-cost', 'mis-report-bpi',
        'mis-report-statutory', 'mis-report-forecast', 'mis-report-backup',
      ];
      const REQUIRES_ANALYSIS: ViewId[] = [
        'dashboard', 'checklist', 'insights', 'aiAnalysis', 'health',
        'flags', 'reports', 'data-view', 'agent-fix',
      ];
      const viewIsReachable = (v: ViewId | undefined): v is ViewId => {
        if (!v) return false;
        if (!moduleViews.includes(v)) return false;
        if (REQUIRES_COMPANY.includes(v) && !state.currentCompany) return false;
        if (REQUIRES_ANALYSIS.includes(v) && !state.analysed) return false;
        return true;
      };
      let nextView: ViewId;
      if (viewIsReachable(remembered)) {
        nextView = remembered;
      } else if (action.module === 'accounting') {
        // Smart default for Account Health: skip the Companies list when a
        // company is already selected — go straight to dashboard if
        // analysed, otherwise company-dashboard.
        nextView = !state.currentCompany
          ? 'company-select'
          : state.analysed ? 'dashboard' : 'company-dashboard';
      } else {
        nextView = moduleViews[0];
      }
      return { ...state, currentModule: action.module, currentView: nextView };
    }

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'FILE_LOADED':
      return {
        ...state,
        files: {
          ...state.files,
          [action.key]: { ...state.files[action.key], ...action.entry },
        },
      };

    case 'FILE_REMOVED':
      return {
        ...state,
        files: { ...state.files, [action.key]: emptyFile() },
        results: null,
        analysed: false,
      };

    case 'UPLOAD_PROGRESS':
      return { ...state, uploadProgress: action.message };

    case 'ANALYSIS_DONE': {
      // Route the user post-analysis based on whether they've ever set up
      // the classification master for this company:
      //
      //   • No overrides yet  → take them to Master Setup so they discover
      //     the surface, can review the auto-classification, bulk-confirm
      //     the high-confidence rows, and apply an industry template.
      //   • Already-configured master  → take them straight to Dashboard
      //     since they already know what Master Setup is and just want to
      //     see the recomputed numbers.
      //
      // We only redirect when the user is currently on the Upload view
      // (the natural "I just clicked Run Analysis" surface).  If they
      // triggered a re-run from elsewhere (e.g. Master Setup itself, the
      // background debounce), we don't yank them to a different tab.
      const overrideCount = state.ledgerOverrides?.size ?? 0;
      const nextView: ViewId =
        state.currentView !== 'upload'
          ? state.currentView
          : overrideCount === 0
            ? 'master-setup'
            : 'dashboard';
      return {
        ...state,
        results: action.results,
        parsedData: action.parsedData,
        analysed: true,
        uploadProgress: null,
        currentView: nextView,
        // Clear AI cache on every re-analysis — the previous run's
        // checkExplanations / smartInsights reference numbers from the
        // OLD `note` text, but the UI reads them next to the NEW check
        // results.  Without this clear, users see AI rationale citing
        // "10 of 199 vouchers missing numbers" while the visible check
        // note now says "12 of 201".  AI Analysis view also relied on
        // a hash comparison (good); ChecklistView's inline AI panel
        // and InsightsView's smart-insights panel didn't (bad).
        aiAnalysis: null,
        aiAnalysisHash: null,
        // Persist computed DayBook stats — overwrite previous chunkedStats so
        // any parser/engine change (sign-aware netting, voucher-flag updates,
        // etc.) shows up everywhere the UI reads from
        // state.files.daybook.chunkedStats (InsightBackup, drill-downs,
        // health panels).  The previous gated form ("only set when
        // chunkedStats was null") froze the cache after the first analysis
        // run, so notes computed by the engine showed fresh numbers but
        // modals reading the cached stats showed the original numbers —
        // a confusing description/working divergence.
        files: action.dbStats
          ? { ...state.files, daybook: { ...state.files.daybook, chunkedStats: action.dbStats } }
          : state.files,
      };
    }

    case 'FILTERS_UPDATED':
      return { ...state, filters: action.filters, results: null, analysed: false };

    case 'MIS_SETUP_UPDATED':
      return { ...state, misSetup: { ...state.misSetup, ...action.misSetup } };

    case 'AI_ANALYSIS_LOADING':
      return { ...state, aiAnalysisLoading: true, aiAnalysisError: null };

    case 'AI_ANALYSIS_ERROR':
      return { ...state, aiAnalysisLoading: false, aiAnalysisError: action.error };

    case 'AI_ANALYSIS_DONE':
      return { ...state, aiAnalysis: action.analysis, aiAnalysisHash: action.hash, aiAnalysisLoading: false, aiAnalysisError: null };

    case 'AI_ANALYSIS_CLEAR':
      return { ...state, aiAnalysis: null, aiAnalysisHash: null, aiAnalysisLoading: false, aiAnalysisError: null };

    case 'SESSION_CLEARED':
      return { ...INITIAL_STATE, consentGiven: false, aiConsentGiven: false, theme: state.theme, currentCompany: null, currentView: 'company-select', fixTasks: null, fixTasksLoading: false, aiAnalysisLoading: false, aiAnalysisError: null };

    case 'COMPANY_SELECTED': {
      // Hydrate per-company MIS profile (sector, manuals, budget, rules,
      // documents) so the user doesn't re-enter everything on each re-upload.
      const misSnapshot = loadMISProfile(action.company.id);
      return {
        ...state,
        currentCompany: action.company,
        filters: action.filters,
        // Hydrate per-company classification overrides from localStorage so the
        // master config the user maintained for this company is honoured the
        // next time analysis runs.
        ledgerOverrides: loadOverrides(action.company.id),
        files: initialFiles(),
        results: null,
        parsedData: {},
        analysed: false,
        aiAnalysis: null,
        aiAnalysisHash: null,
        fixTasks: null,
        fixTasksLoading: false,
        aiAnalysisLoading: false,
        aiAnalysisError: null,
        currentView: 'company-dashboard',
        // MIS profile — restored from localStorage.  Default-empty if no
        // prior session exists.
        misSetup: misSnapshot.misSetup ?? DEFAULT_MIS_SETUP,
        misManualInputs: misSnapshot.misManualInputs,
        misBudget: misSnapshot.misBudget,
        misRules: misSnapshot.misRules,
        misDocuments: misSnapshot.misDocuments,
      };
    }

    case 'LEDGER_OVERRIDES_SET':
      // Persist alongside state update so a refresh / re-pull never loses
      // the user's master config.  Storage call is sync but failure-safe.
      if (state.currentCompany?.id) {
        saveOverrides(state.currentCompany.id, action.overrides);
      }
      return { ...state, ledgerOverrides: action.overrides };

    case 'REQUESTED_PERIOD_SET':
      return { ...state, requestedPeriod: action.period };

    case 'MIS_MANUAL_INPUTS_SET':
      return { ...state, misManualInputs: { ...(state.misManualInputs ?? {}), ...action.inputs } };

    case 'MIS_BUDGET_SET':
      return { ...state, misBudget: action.budget ?? undefined };

    case 'MIS_DOCUMENT_ADDED':
      return { ...state, misDocuments: { ...(state.misDocuments ?? {}), [action.doc.id]: action.doc } };

    case 'MIS_DOCUMENT_REMOVED': {
      if (!state.misDocuments) return state;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [action.id]: _removed, ...rest } = state.misDocuments;
      return { ...state, misDocuments: rest };
    }

    case 'MIS_RULES_SET':
      return { ...state, misRules: action.rules };

    case 'MIS_RULES_UPSERT': {
      const cur = state.misRules ?? [];
      const exists = cur.some(r => r.id === action.rule.id);
      const next = exists
        ? cur.map(r => (r.id === action.rule.id ? action.rule : r))
        : [...cur, action.rule];
      return { ...state, misRules: next };
    }

    case 'MIS_RULES_DELETE':
      return { ...state, misRules: (state.misRules ?? []).filter(r => r.id !== action.id) };

    case 'MIS_RULES_RESET':
      return { ...state, misRules: undefined };

    case 'MIS_BACKUP_FOCUS':
      return { ...state, misBackupFocusMetricId: action.metricId ?? undefined };

    case 'MIS_UPLOAD_DEEPLINK':
      return { ...state, misUploadDeepLink: action.deepLink ?? undefined };

    case 'COMPANY_DESELECTED':
      return {
        ...state,
        currentCompany: null,
        currentView: 'company-select',
        files: initialFiles(),
        results: null,
        parsedData: {},
        analysed: false,
        aiAnalysis: null,
        aiAnalysisHash: null,
        fixTasks: null,
        fixTasksLoading: false,
        aiAnalysisLoading: false,
        aiAnalysisError: null,
      };

    case 'FIX_TASKS_LOADING':
      return { ...state, fixTasksLoading: true };

    case 'FIX_TASKS_LOADED':
      return { ...state, fixTasks: action.tasks, fixTasksLoading: false };

    case 'FIX_TASK_STATUS':
      return {
        ...state,
        fixTasks: state.fixTasks?.map(t =>
          t.id === action.id ? { ...t, status: action.status } : t
        ) ?? null,
      };

    case 'FIX_TASKS_CLEAR':
      return { ...state, fixTasks: null, fixTasksLoading: false };

    default:
      return state;
  }
}

/**
 * Outer reducer that wraps `reducerInner` with two side-effects:
 *   1. Persist the MIS profile snapshot to localStorage after MIS_* mutations
 *   2. Auto-track `lastViewByModule[currentModule] = currentView` whenever
 *      a reducer transition lands the user on a new view — covers SET_VIEW
 *      explicitly *and* implicit navigations like ANALYSIS_DONE /
 *      COMPANY_SELECTED that change currentView without going through SET_VIEW.
 */
function reducer(state: AppState, action: Action): AppState {
  const next = reducerInner(state, action);
  let result = next;

  // (2) View-memory: when currentView changed within the *same* module,
  // record it.  Skip SET_MODULE itself — that action restores a remembered
  // view; recording its outcome would just be a no-op anyway.
  if (
    action.type !== 'SET_MODULE'
    && next.currentModule === state.currentModule
    && next.currentView !== state.currentView
  ) {
    result = {
      ...next,
      lastViewByModule: {
        ...(next.lastViewByModule ?? {}),
        [next.currentModule]: next.currentView,
      },
    };
  }

  // (1) Persist MIS profile when the mutation touched it.
  if (MIS_PROFILE_ACTIONS.has(action.type) && result.currentCompany?.id) {
    saveMISProfile(result.currentCompany.id, {
      misSetup: result.misSetup,
      misManualInputs: result.misManualInputs,
      misBudget: result.misBudget,
      misRules: result.misRules,
      misDocuments: result.misDocuments,
    });
  }
  return result;
}

// ── context ───────────────────────────────────────────────────────────────
export const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<Action>;
} | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export { INITIAL_STATE, reducer, initialFiles };
