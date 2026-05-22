'use client';

import type { FileKey, ActiveCompany } from './types';

const SESSION_KEY = 'aiq_files';

interface PersistedFile {
  name: string;
  size: number;
  hasContent: boolean;
}

export function persistFileMetadata(files: Record<string, { name: string; size: number; hasContent: boolean }>) {
  try {
    const data: Record<string, PersistedFile> = {};
    for (const [k, f] of Object.entries(files)) {
      data[k] = { name: f.name, size: f.size, hasContent: f.hasContent };
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch { /* quota exceeded — ignore */ }
}

export function restoreFileMetadata(): Record<FileKey, PersistedFile> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(AI_CONSENT_KEY);
    sessionStorage.removeItem(COMPANY_KEY);
  } catch { /* ignore */ }
}

// ── AI consent persistence ──

const AI_CONSENT_KEY = 'aiq_ai_consent';

export function persistAIConsent(consented: boolean) {
  try {
    sessionStorage.setItem(AI_CONSENT_KEY, JSON.stringify(consented));
  } catch { /* ignore */ }
}

export function restoreAIConsent(): boolean {
  try {
    const raw = sessionStorage.getItem(AI_CONSENT_KEY);
    return raw ? JSON.parse(raw) === true : false;
  } catch {
    return false;
  }
}

// ── Company persistence ──

const COMPANY_KEY = 'aiq_company';

export function persistCurrentCompany(company: ActiveCompany | null) {
  try {
    if (company) sessionStorage.setItem(COMPANY_KEY, JSON.stringify(company));
    else sessionStorage.removeItem(COMPANY_KEY);
  } catch { /* ignore */ }
}

export function restoreCurrentCompany(): ActiveCompany | null {
  try {
    const raw = sessionStorage.getItem(COMPANY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
