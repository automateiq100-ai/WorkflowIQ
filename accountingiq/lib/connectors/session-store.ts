// In-memory pairing-code + bridge-session store. v1 is single-instance;
// move to Supabase or Redis when we scale beyond one Next.js server.

import type { ConnectorSession, ConnectorCompany } from './types';

interface PairingCode {
  code: string;             // 6-digit
  userId: string;
  createdAt: number;
  // Filled in once a bridge claims the code.
  bridgeId?: string;
  bridgeToken?: string;
}

interface BridgeSessionRecord {
  bridgeId: string;
  bridgeToken: string;
  userId: string;
  pairedAt: number;
  selectedCompany?: ConnectorCompany;
  lastSeenAt: number;
}

const PAIRING_TTL_MS = 5 * 60 * 1000;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

const PAIRINGS = new Map<string, PairingCode>();         // code → record
const SESSIONS = new Map<string, BridgeSessionRecord>(); // bridgeId → record
const TOKEN_INDEX = new Map<string, string>();           // bridgeToken → bridgeId

function rand(n: number, alphabet: string): string {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function createPairingCode(userId: string): string {
  // Avoid 0/O/1/I — easier to read on a small bridge UI.
  const code = rand(6, '23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
  PAIRINGS.set(code, { code, userId, createdAt: Date.now() });
  return code;
}

export function claimPairingCode(code: string): { bridgeId: string; bridgeToken: string; userId: string } | null {
  const rec = PAIRINGS.get(code.toUpperCase());
  if (!rec) return null;
  if (Date.now() - rec.createdAt > PAIRING_TTL_MS) {
    PAIRINGS.delete(rec.code);
    return null;
  }
  if (rec.bridgeId) return null; // already claimed
  const bridgeId = `b_${rand(16, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
  const bridgeToken = rand(48, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  rec.bridgeId = bridgeId;
  rec.bridgeToken = bridgeToken;
  const session: BridgeSessionRecord = {
    bridgeId,
    bridgeToken,
    userId: rec.userId,
    pairedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  SESSIONS.set(bridgeId, session);
  TOKEN_INDEX.set(bridgeToken, bridgeId);
  return { bridgeId, bridgeToken, userId: rec.userId };
}

export function consumePairingResult(code: string, userId: string): ConnectorSession | null {
  const rec = PAIRINGS.get(code.toUpperCase());
  if (!rec || rec.userId !== userId || !rec.bridgeId) return null;
  // Single-use: drop after the cloud picks it up.
  PAIRINGS.delete(rec.code);
  return {
    connectorId: 'tally',
    bridgeId: rec.bridgeId,
    pairedAt: Date.now(),
  };
}

export function authenticateBridge(token: string): BridgeSessionRecord | null {
  const bridgeId = TOKEN_INDEX.get(token);
  if (!bridgeId) return null;
  const s = SESSIONS.get(bridgeId);
  if (!s) return null;
  if (Date.now() - s.lastSeenAt > SESSION_IDLE_MS) {
    disconnectBridge(bridgeId);
    return null;
  }
  s.lastSeenAt = Date.now();
  return s;
}

export function getSessionForUser(userId: string, bridgeId: string): BridgeSessionRecord | null {
  const s = SESSIONS.get(bridgeId);
  if (!s || s.userId !== userId) return null;
  return s;
}

export function setSessionCompany(bridgeId: string, company: ConnectorCompany): void {
  const s = SESSIONS.get(bridgeId);
  if (s) s.selectedCompany = company;
}

export function disconnectBridge(bridgeId: string): void {
  const s = SESSIONS.get(bridgeId);
  if (!s) return;
  TOKEN_INDEX.delete(s.bridgeToken);
  SESSIONS.delete(bridgeId);
}

export function toClientSession(rec: BridgeSessionRecord): ConnectorSession {
  return {
    connectorId: 'tally',
    bridgeId: rec.bridgeId,
    selectedCompany: rec.selectedCompany,
    pairedAt: rec.pairedAt,
  };
}
