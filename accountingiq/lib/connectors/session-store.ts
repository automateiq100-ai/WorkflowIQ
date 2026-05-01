// Bridge session store.
//
// Both pairing codes (short-lived, 5 min) and bridge sessions (long-lived) are
// persisted to Supabase so they survive Next.js restarts and deploys. Token
// material is hashed (SHA-256) before storage — the bridge keeps the plaintext
// in ~/.accountingiq-bridge.json.
//
// Service-role client only; both tables have RLS enabled with no policies, so
// anon/authenticated keys have no access.

import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ConnectorSession, ConnectorCompany } from './types';

const PAIRING_TTL_MS = 5 * 60 * 1000;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

// ── Supabase service-role client ────────────────────────────────────────────

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set for bridge session storage');
  }
  _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── Types — DB row shape ────────────────────────────────────────────────────

interface BridgeSessionRow {
  bridge_id: string;
  bridge_token_hash: string;
  user_id: string;
  connector_id: string;
  selected_company_id: string | null;
  selected_company_name: string | null;
  paired_at: string;
  last_seen_at: string;
}

export interface BridgeSessionRecord {
  bridgeId: string;
  bridgeToken: string;          // present only on the in-memory return from claimPairingCode
  userId: string;
  pairedAt: number;
  selectedCompany?: ConnectorCompany;
  lastSeenAt: number;
}

function rowToRecord(row: BridgeSessionRow, plaintextToken = ''): BridgeSessionRecord {
  return {
    bridgeId: row.bridge_id,
    bridgeToken: plaintextToken,  // never stored in DB; only available right after claim
    userId: row.user_id,
    pairedAt: new Date(row.paired_at).getTime(),
    lastSeenAt: new Date(row.last_seen_at).getTime(),
    selectedCompany: row.selected_company_name
      ? { id: row.selected_company_id ?? row.selected_company_name, name: row.selected_company_name }
      : undefined,
  };
}

// ── Random helpers ──────────────────────────────────────────────────────────

function rand(n: number, alphabet: string): string {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

// ── Pairing code lifecycle (Supabase-backed) ────────────────────────────────

interface PairingCodeRow {
  code: string;
  user_id: string;
  bridge_id: string | null;
  created_at: string;
}

function isExpired(createdAtIso: string): boolean {
  return Date.now() - new Date(createdAtIso).getTime() > PAIRING_TTL_MS;
}

export async function createPairingCode(userId: string): Promise<string> {
  // Avoid 0/O/1/I — easier to read on a small bridge UI.
  const code = rand(6, '23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
  const { error } = await admin().from('pairing_codes').insert({
    code,
    user_id: userId,
  });
  if (error) {
    console.error('[session-store] failed to persist pairing code', error);
    throw new Error('Could not generate pairing code');
  }
  return code;
}

/**
 * Bridge claims a code. Creates a persistent session in Supabase keyed by the
 * sha256 hash of the bridge token, and returns plaintext credentials to the bridge.
 */
export async function claimPairingCode(
  code: string,
): Promise<{ bridgeId: string; bridgeToken: string; userId: string } | null> {
  const upper = code.toUpperCase();
  const { data, error } = await admin()
    .from('pairing_codes')
    .select('*')
    .eq('code', upper)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as PairingCodeRow;
  if (isExpired(row.created_at)) {
    await admin().from('pairing_codes').delete().eq('code', upper);
    return null;
  }
  if (row.bridge_id) return null; // already claimed

  const bridgeId = `b_${rand(16, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
  const bridgeToken = rand(48, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  const tokenHash = hashToken(bridgeToken);

  const { error: insertErr } = await admin().from('bridge_sessions').insert({
    bridge_id: bridgeId,
    bridge_token_hash: tokenHash,
    user_id: row.user_id,
    connector_id: 'tally',
  });
  if (insertErr) {
    console.error('[session-store] failed to persist bridge session', insertErr);
    return null;
  }

  // Mark the code as claimed so the user's browser poll picks up the result.
  // If this update races with the cloud's poll, the worst case is the browser
  // takes one more poll cycle to see the bridge_id — harmless.
  await admin().from('pairing_codes').update({ bridge_id: bridgeId }).eq('code', upper);

  return { bridgeId, bridgeToken, userId: row.user_id };
}

export async function consumePairingResult(code: string, userId: string): Promise<ConnectorSession | null> {
  const upper = code.toUpperCase();
  const { data } = await admin()
    .from('pairing_codes')
    .select('*')
    .eq('code', upper)
    .eq('user_id', userId)
    .maybeSingle();
  const row = data as PairingCodeRow | null;
  if (!row || !row.bridge_id) return null;
  // Single-use: delete the row once the browser picks up the result. The
  // persistent bridge_sessions row remains.
  await admin().from('pairing_codes').delete().eq('code', upper);
  return {
    connectorId: 'tally',
    bridgeId: row.bridge_id,
    pairedAt: Date.now(),
  };
}

// ── Bridge session lookup (Supabase-backed) ─────────────────────────────────

/**
 * Look up the session by the bridge's bearer token. Updates last_seen_at and
 * evicts sessions idle for more than SESSION_IDLE_MS.
 */
export async function authenticateBridge(token: string): Promise<BridgeSessionRecord | null> {
  const tokenHash = hashToken(token);
  const { data, error } = await admin()
    .from('bridge_sessions')
    .select('*')
    .eq('bridge_token_hash', tokenHash)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as BridgeSessionRow;
  if (Date.now() - new Date(row.last_seen_at).getTime() > SESSION_IDLE_MS) {
    await disconnectBridge(row.bridge_id);
    return null;
  }
  // Touch last_seen_at. supabase-js builders are lazy PromiseLikes — they only
  // execute when `.then()` is called or awaited, so a bare `void builder()` is
  // a no-op. Trigger execution with `.then()` and swallow errors (next poll retries).
  admin()
    .from('bridge_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('bridge_id', row.bridge_id)
    .then(() => {}, () => {});
  return rowToRecord(row, token);
}

/**
 * Returns the user's most-recently-active bridge session, if any. Used by the
 * Tally Connection page to auto-resume after a browser sessionStorage wipe.
 */
export async function getActiveSessionForUser(userId: string): Promise<BridgeSessionRecord | null> {
  const cutoffIso = new Date(Date.now() - SESSION_IDLE_MS).toISOString();
  const { data, error } = await admin()
    .from('bridge_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('last_seen_at', cutoffIso)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToRecord(data as BridgeSessionRow);
}

export async function getSessionForUser(userId: string, bridgeId: string): Promise<BridgeSessionRecord | null> {
  const { data, error } = await admin()
    .from('bridge_sessions')
    .select('*')
    .eq('bridge_id', bridgeId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToRecord(data as BridgeSessionRow);
}

export async function setSessionCompany(bridgeId: string, company: ConnectorCompany): Promise<void> {
  await admin()
    .from('bridge_sessions')
    .update({
      selected_company_id: company.id,
      selected_company_name: company.name,
    })
    .eq('bridge_id', bridgeId);
}

export async function disconnectBridge(bridgeId: string): Promise<void> {
  await admin().from('bridge_sessions').delete().eq('bridge_id', bridgeId);
}

export function toClientSession(rec: BridgeSessionRecord): ConnectorSession {
  return {
    connectorId: 'tally',
    bridgeId: rec.bridgeId,
    selectedCompany: rec.selectedCompany,
    pairedAt: rec.pairedAt,
  };
}
