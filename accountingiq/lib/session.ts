'use client';

import type { FileKey, CompanyProfile } from './types';

const SESSION_KEY = 'aiq_files';
const PROFILE_KEY = 'aiq_profile';

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

export function persistProfile(profile: CompanyProfile) {
  try {
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch { /* ignore */ }
}

export function restoreProfile(): CompanyProfile | null {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(PROFILE_KEY);
  } catch { /* ignore */ }
}
