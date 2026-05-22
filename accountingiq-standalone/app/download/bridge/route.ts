// GET /download/bridge
// Serves the prebuilt AccountingIQ Bridge Windows .exe built via pkg.
// Build step (manual): cd bridge && npx pkg src/main.mjs --target node18-win-x64 --output dist/accountingiq-bridge.exe

import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'accountingiq-bridge.exe';

function resolveExePath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'bridge', 'dist', FILE_NAME),
    path.join(process.cwd(), '..', 'bridge', 'dist', FILE_NAME),
    // Fallback: out-of-tree build location (used when OneDrive/Defender blocks
    // writing new .exe files inside the synced repo folder).
    process.env.ACCOUNTINGIQ_BRIDGE_EXE || '',
    'C:\\Temp\\accountingiq-bridge.exe',
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET() {
  const exePath = resolveExePath();
  if (!exePath) {
    return new Response(
      'Bridge binary not found. Build it with: cd bridge && npx pkg src/main.mjs --target node18-win-x64 --output dist/accountingiq-bridge.exe',
      { status: 404, headers: { 'Content-Type': 'text/plain' } },
    );
  }
  const stat = fs.statSync(exePath);
  const stream = fs.createReadStream(exePath);
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${FILE_NAME}"`,
      'Cache-Control': 'no-store',
    },
  });
}
