'use client';

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type {
  AppState, FileKey, FileEntry, AnalysisResults, CompanyProfile,
  ParsedData, ViewId, ModuleId, Theme, MISSetup, AIResponse, ActiveCompany,
} from './types';
import { MODULE_VIEWS } from './constants';

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
  'faregister','stock','bankrecon',
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
  | { type: 'ANALYSIS_DONE'; results: AnalysisResults; parsedData: Partial<ParsedData> }
  | { type: 'FILTERS_UPDATED'; filters: CompanyProfile }
  | { type: 'MIS_SETUP_UPDATED'; misSetup: Partial<MISSetup> }
  | { type: 'AI_ANALYSIS_DONE'; analysis: AIResponse; hash: string }
  | { type: 'AI_ANALYSIS_CLEAR' }
  | { type: 'SESSION_CLEARED' }
  | { type: 'COMPANY_SELECTED'; company: ActiveCompany; filters: CompanyProfile }
  | { type: 'COMPANY_DESELECTED' };

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

    case 'ANALYSIS_DONE':
      return {
        ...state,
        results: action.results,
        parsedData: action.parsedData,
        analysed: true,
        uploadProgress: null,
        currentView: state.currentView === 'upload' ? 'dashboard' : state.currentView,
      };

    case 'FILTERS_UPDATED':
      return { ...state, filters: action.filters, results: null, analysed: false };

    case 'MIS_SETUP_UPDATED':
      return { ...state, misSetup: { ...state.misSetup, ...action.misSetup } };

    case 'AI_ANALYSIS_DONE':
      return { ...state, aiAnalysis: action.analysis, aiAnalysisHash: action.hash };

    case 'AI_ANALYSIS_CLEAR':
      return { ...state, aiAnalysis: null, aiAnalysisHash: null };

    case 'SESSION_CLEARED':
      return { ...INITIAL_STATE, consentGiven: false, aiConsentGiven: false, theme: state.theme, currentCompany: null, currentView: 'company-select' };

    case 'COMPANY_SELECTED':
      return {
        ...state,
        currentCompany: action.company,
        filters: action.filters,
        files: initialFiles(),
        results: null,
        parsedData: {},
        analysed: false,
        aiAnalysis: null,
        aiAnalysisHash: null,
        currentView: 'upload',
      };

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
      };

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
