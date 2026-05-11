'use client';

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type {
  AppState, FileKey, FileEntry, AnalysisResults, CompanyProfile,
  ParsedData, ChunkedStats, ViewId, ModuleId, Theme, MISSetup, AIResponse, ActiveCompany, FixTask,
} from './types';
import { MODULE_VIEWS } from './constants';
import { loadOverrides, saveOverrides, type OverrideMap } from './ledger-overrides';

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
  | { type: 'REQUESTED_PERIOD_SET'; period: { start: string; end: string; type: 'monthly' | 'quarterly' | 'yearly' | 'custom' } };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CONSENT_GIVEN':
      return { ...state, consentGiven: true };

    case 'AI_CONSENT_GIVEN':
      return { ...state, aiConsentGiven: true };

    case 'SET_VIEW':
      return { ...state, currentView: action.view };

    case 'SET_MODULE': {
      // When switching modules, navigate to the first view in that module
      const firstView = MODULE_VIEWS[action.module][0];
      return { ...state, currentModule: action.module, currentView: firstView };
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
        // Persist computed DayBook stats for small files (< 10 MB chunk threshold)
        files: action.dbStats && !state.files.daybook.chunkedStats
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

    case 'COMPANY_SELECTED':
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
      };

    case 'LEDGER_OVERRIDES_SET':
      // Persist alongside state update so a refresh / re-pull never loses
      // the user's master config.  Storage call is sync but failure-safe.
      if (state.currentCompany?.id) {
        saveOverrides(state.currentCompany.id, action.overrides);
      }
      return { ...state, ledgerOverrides: action.overrides };

    case 'REQUESTED_PERIOD_SET':
      return { ...state, requestedPeriod: action.period };

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
