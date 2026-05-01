// Thin HTTP client for Tally Prime's XML gateway on localhost:9000.
// Mirrors the BOM/UTF-16 handling in accountingiq/lib/parser.ts so the cloud
// always receives plain UTF-8 XML.

import http from 'node:http';

const TALLY_HOST = '127.0.0.1';
const TALLY_PORT = parseInt(process.env.TALLY_PORT ?? '9000', 10);

export function postToTally(xml) {
  // Diagnostic: outgoing payload — lets us verify SVCURRENTCOMPANY + date range
  // when the bridge owner shares their console log to debug "all amounts ₹0".
  const reqSize = Buffer.byteLength(xml, 'utf8');
  const reqPreview = xml.slice(0, 200).replace(/\s+/g, ' ');
  console.log(`[bridge:tally] → POST 9000 ${reqSize}B  ${reqPreview}`);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: TALLY_HOST,
        port: TALLY_PORT,
        method: 'POST',
        path: '/',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': reqSize,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const decoded = decodeBody(buf);
          const bom = buf.length >= 4
            ? `${buf[0].toString(16).padStart(2,'0')} ${buf[1].toString(16).padStart(2,'0')} ${buf[2].toString(16).padStart(2,'0')} ${buf[3].toString(16).padStart(2,'0')}`
            : '(short)';
          const preview = decoded.slice(0, 600).replace(/\s+/g, ' ');
          console.log(`[bridge:tally] ← ${res.statusCode} bytes=${buf.length} bom=${bom} → utf8 chars=${decoded.length}`);
          console.log(`[bridge:tally]   first600: ${preview}`);
          resolve(decoded);
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(xml, 'utf8');
    req.end();
  });
}

function decodeBody(buf) {
  // Tally exports often arrive as UTF-16LE with BOM; normalise to UTF-8 string.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // Swap byte order then decode
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8');
}

export async function assertGatewayLocalOnly() {
  // Gateway is unauthenticated; refuse to run if Tally is reachable from
  // anywhere other than loopback. Heuristic: try a non-localhost interface and
  // confirm it does NOT answer.
  // Soft check: if env var ACCEPT_NON_LOOPBACK=1, skip — for power users.
  if (process.env.ACCEPT_NON_LOOPBACK === '1') return;
  // Real implementation would enumerate interfaces and probe each.
  // v1 just trusts that we're hitting 127.0.0.1; left as a TODO for the
  // hardened build.
}
