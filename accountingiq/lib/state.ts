'use client';

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { AppState, FileKey, FileEntry, AnalysisResults, CompanyProfile, ParsedData, ViewId } from './types';

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

const INITIAL_STATE: AppState = {
  files: initialFiles(),
  parsedData: {},
  results: null,
  filters: DEFAULT_FILTERS,
  analysed: false,
  currentView: 'upload',
  consentGiven: false,
  uploadProgress: null,
};

// ── actions ───────────────────────────────────────────────────────────────
export type Action =
  | { type: 'CONSENT_GIVEN' }
  | { type: 'SET_VIEW'; view: ViewId }
  | { type: 'FILE_LOADED'; key: FileKey; entry: Partial<FileEntry> }
  | { type: 'FILE_REMOVED'; key: FileKey }
  | { type: 'UPLOAD_PROGRESS'; message: string | null }
  | { type: 'ANALYSIS_DONE'; results: AnalysisResults; parsedData: Partial<ParsedData> }
  | { type: 'FILTERS_UPDATED'; filters: CompanyProfile }
  | { type: 'SESSION_CLEARED' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CONSENT_GIVEN':
      return { ...state, consentGiven: true };

    case 'SET_VIEW':
      return { ...state, currentView: action.view };

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

    case 'SESSION_CLEARED':
      return { ...INITIAL_STATE, consentGiven: false };

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
