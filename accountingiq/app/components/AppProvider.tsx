'use client';

import { useReducer, useEffect, useRef } from 'react';
import { AppContext, reducer, INITIAL_STATE } from '@/lib/state';
import type { FileKey } from '@/lib/types';
import {
  restoreFileMetadata, restoreProfile,
  persistFileMetadata, persistProfile,
} from '@/lib/session';

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const mounted = useRef(false);

  // Restore session on mount
  useEffect(() => {
    const files = restoreFileMetadata();
    const profile = restoreProfile();

    if (files) {
      for (const [key, f] of Object.entries(files)) {
        if (f.hasContent) {
          dispatch({
            type: 'FILE_LOADED',
            key: key as FileKey,
            entry: { name: f.name, size: f.size, hasContent: false, content: null, chunkedStats: null, sessionExpired: true },
          });
        }
      }
    }
    if (profile) {
      dispatch({ type: 'FILTERS_UPDATED', filters: profile });
    }
    mounted.current = true;
  }, []);

  // Persist on changes
  useEffect(() => {
    if (!mounted.current) return;
    persistFileMetadata(state.files);
    persistProfile(state.filters);
  }, [state.files, state.filters]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
