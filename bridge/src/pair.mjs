// One-shot pairing CLI:
//   node src/pair.mjs --cloud https://app.example.com --code AB12CD
// Persists { cloudUrl, bridgeId, bridgeToken } to ~/.accountingiq-bridge.json.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_PATH = path.join(os.homedir(), '.accountingiq-bridge.json');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cloudUrl = arg('cloud');
const code = arg('code');
if (!cloudUrl || !code) {
  console.error('Usage: node src/pair.mjs --cloud <url> --code <pairing-code>');
  process.exit(2);
}

const r = await fetch(`${cloudUrl}/api/tally/pair-claim`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
if (!r.ok) {
  const data = await r.json().catch(() => ({}));
  console.error(`Pairing failed (${r.status}): ${data.error ?? 'unknown'}`);
  process.exit(1);
}
const { bridgeId, bridgeToken } = await r.json();
fs.writeFileSync(CONFIG_PATH, JSON.stringify({ cloudUrl, bridgeId, bridgeToken }, null, 2), { mode: 0o600 });
console.log(`Paired. Config saved to ${CONFIG_PATH}`);
console.log('Now run: node src/main.mjs');
