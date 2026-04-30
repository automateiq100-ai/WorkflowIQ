#!/usr/bin/env node
// AccountingIQ Bridge — main entry. Three launch modes:
//   1. Protocol URL: accountingiq-bridge://pair?code=...&cloud=... → auto-pair, no prompts
//   2. Existing config at ~/.accountingiq-bridge.json → just run
//   3. No args / no config → interactive prompts
// On every launch, ensures the URL protocol handler is registered in HKCU.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { runRelay, UnauthorizedError } from './relay.mjs';
import { assertGatewayLocalOnly } from './tally.mjs';

const CONFIG_PATH = path.join(os.homedir(), '.accountingiq-bridge.json');
const DEFAULT_CLOUD = process.env.ACCOUNTINGIQ_CLOUD ?? 'http://localhost:3000';
const PROTOCOL = 'accountingiq-bridge';

function ask(question, fallback) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (a) => {
      rl.close();
      const v = (a ?? '').trim();
      resolve(v || fallback || '');
    });
  });
}

async function pause(msg = 'Press Enter to exit…') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(msg, () => { rl.close(); resolve(); }));
}

function exePath() {
  // process.execPath for pkg-built binaries returns the .exe path itself
  return process.execPath;
}

function startupShortcutPath() {
  return path.join(
    os.homedir(),
    'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
    'AccountingIQ Bridge.lnk',
  );
}

function registerProtocolHandler() {
  if (process.platform !== 'win32') return;
  const exe = exePath();
  // Skip if running from a non-final location (e.g., dev under node)
  if (!exe.toLowerCase().endsWith('.exe')) return;
  try {
    const base = `HKCU\\Software\\Classes\\${PROTOCOL}`;
    const cmd = `"${exe}" "%1"`;
    execFileSync('reg', ['add', base, '/ve', '/d', `URL:AccountingIQ Bridge Protocol`, '/f'], { stdio: 'ignore' });
    execFileSync('reg', ['add', base, '/v', 'URL Protocol', '/d', '', '/f'], { stdio: 'ignore' });
    execFileSync('reg', ['add', `${base}\\shell\\open\\command`, '/ve', '/d', cmd, '/f'], { stdio: 'ignore' });
  } catch (err) {
    // Non-fatal — manual entry still works
    console.warn(`[bridge] could not register URL protocol: ${err?.message ?? err}`);
  }
}

function installStartupShortcut() {
  if (process.platform !== 'win32') return false;
  const exe = exePath();
  if (!exe.toLowerCase().endsWith('.exe')) return false;
  const target = startupShortcutPath();
  if (fs.existsSync(target)) return false; // Already installed

  // Build a PowerShell script to create the .lnk via WScript.Shell
  const ps = `
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut('${target.replace(/'/g, "''")}')
    $sc.TargetPath = '${exe.replace(/'/g, "''")}'
    $sc.WorkingDirectory = '${path.dirname(exe).replace(/'/g, "''")}'
    $sc.Description = 'AccountingIQ Bridge — keeps Tally connected to the cloud.'
    $sc.Save()
  `.trim();
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore' });
    return fs.existsSync(target);
  } catch (err) {
    console.warn(`[bridge] could not install startup shortcut: ${err?.message ?? err}`);
    return false;
  }
}

function findProtocolArg() {
  for (const a of process.argv) {
    if (typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`)) return a;
  }
  return null;
}

function parseProtocolUrl(raw) {
  try {
    const u = new URL(raw);
    // u.host is the "command" (e.g., "pair"); u.searchParams has the args.
    const action = u.host || u.pathname.replace(/^\/+/, '');
    if (action !== 'pair') return null;
    const code = u.searchParams.get('code');
    const cloud = u.searchParams.get('cloud') ?? DEFAULT_CLOUD;
    return code ? { code: code.trim(), cloudUrl: cloud.trim() } : null;
  } catch {
    return null;
  }
}

async function claimCode(cloudUrl, code) {
  const res = await fetch(`${cloudUrl}/api/tally/pair-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Pairing failed (${res.status}): ${data.error ?? 'unknown'}`);
  }
  const { bridgeId, bridgeToken } = await res.json();
  const cfg = { cloudUrl, bridgeId, bridgeToken };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

async function pairInteractive() {
  console.log('\n=== AccountingIQ Bridge — First-time setup ===\n');
  const cloudUrl = await ask(`Cloud URL [${DEFAULT_CLOUD}]: `, DEFAULT_CLOUD);
  const code = await ask('Pairing code (from the Connect Tally page): ');
  if (!code) {
    console.error('No code entered. Cannot pair.');
    return null;
  }
  console.log(`\nClaiming code at ${cloudUrl}…`);
  try {
    return await claimCode(cloudUrl, code);
  } catch (err) {
    console.error(err.message);
    return null;
  }
}

function readExistingConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg.cloudUrl && cfg.bridgeToken) return cfg;
  } catch {}
  return null;
}

async function main() {
  console.log('AccountingIQ Bridge');
  console.log('-------------------');

  // Always (re-)register on launch — keeps registry current if .exe is moved.
  registerProtocolHandler();

  let cfg = null;

  // Mode 1: launched via accountingiq-bridge:// URL
  const urlArg = findProtocolArg();
  if (urlArg) {
    const parsed = parseProtocolUrl(urlArg);
    if (!parsed) {
      console.error(`Could not parse protocol URL: ${urlArg}`);
      await pause();
      process.exit(2);
    }
    console.log(`Auto-pairing via cloud=${parsed.cloudUrl} code=${parsed.code}`);
    try {
      cfg = await claimCode(parsed.cloudUrl, parsed.code);
      console.log('Paired successfully.\n');
    } catch (err) {
      console.error(err.message);
      await pause();
      process.exit(1);
    }
  }

  // Mode 2: existing config
  if (!cfg) cfg = readExistingConfig();

  // Mode 3: interactive
  if (!cfg) cfg = await pairInteractive();

  if (!cfg) {
    await pause();
    process.exit(2);
  }

  // Install Windows Startup shortcut so the bridge auto-runs at login.
  if (installStartupShortcut()) {
    console.log('[bridge] auto-start enabled — will launch at every Windows login.');
  }

  await assertGatewayLocalOnly();
  console.log(`[bridge] connected to ${cfg.cloudUrl} as ${cfg.bridgeId}`);
  console.log('[bridge] polling for jobs (leave this window open)…\n');
  try {
    await runRelay({ cloudUrl: cfg.cloudUrl, bridgeToken: cfg.bridgeToken });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      console.error('\n[bridge] Session expired or invalidated by the server.');
      console.error('[bridge] Clearing saved pairing — you will need to re-pair from the Tally Connection page.');
      try { fs.unlinkSync(CONFIG_PATH); } catch {}
      await pause();
      process.exit(0);
    }
    throw err;
  }
}

try {
  await main();
} catch (err) {
  console.error(`\nBridge stopped: ${err?.message ?? err}`);
  await pause();
  process.exit(1);
}
