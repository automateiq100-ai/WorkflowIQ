'use client';

import { useReducer, useEffect, useRef } from 'react';
import { AppContext, reducer, INITIAL_STATE } from '@/lib/state';
import type { FileKey } from '@/lib/types';
import { companyToFilters } from '@/lib/types';
import {
  restoreFileMetadata, persistFileMetadata,
  restoreCurrentCompany, persistCurrentCompany,
} from '@/lib/session';

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const mounted = useRef(false);
  const profileLoaded = useRef(false);

  // Restore session on mount
  useEffect(() => {
    const files = restoreFileMetadata();
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

    // Load theme from DB (filters now come from selected company)
    fetch('/api/profile/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.theme) dispatch({ type: 'SET_THEME', theme: data.theme });
        profileLoaded.current = true;
      })
      .catch(() => { profileLoaded.current = true; });

    // Restore selected company from sessionStorage, re-verify via DB
    const savedCompany = restoreCurrentCompany();
    if (savedCompany) {
      fetch(`/api/companies/${savedCompany.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.company) {
            dispatch({
              type: 'COMPANY_SELECTED',
              company: { id: data.company.id, name: data.company.name, companyType: data.company.company_type },
              filters: companyToFilters(data.company),
            });
          }
        })
        .catch(() => {});
    }

    mounted.current = true;
  }, []);

  // Persist file metadata on changes
  useEffect(() => {
    if (!mounted.current) return;
    persistFileMetadata(state.files);
  }, [state.files]);

  // Persist selected company to sessionStorage
  useEffect(() => {
    if (!mounted.current) return;
    persistCurrentCompany(state.currentCompany);
  }, [state.currentCompany]);

  // Persist theme to DB on changes
  useEffect(() => {
    if (!mounted.current || !profileLoaded.current) return;
    fetch('/api/profile/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: state.theme }),
    }).catch(() => {});
  }, [state.theme]);

  // Apply theme class to <html> element
  useEffect(() => {
    const html = document.documentElement;
    if (state.theme === 'light') {
      html.classList.add('light');
    } else {
      html.classList.remove('light');
    }
  }, [state.theme]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
