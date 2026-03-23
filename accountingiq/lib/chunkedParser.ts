'use client';

import type { ChunkedStats } from './types';
import { processVoucher, parseTallyDate } from './parser';
import { CHUNK_SIZE } from './constants';

type ProgressCallback = (message: string) => void;
type DoneCallback = (stats: ChunkedStats) => void;

function detectEncoding(file: File): string {
  // Tally Prime often exports UTF-16LE. Check file extension and size heuristic.
  if (file.name.toLowerCase().endsWith('.xml') && file.size > 10_000) {
    // We'll try to detect by reading first 4 bytes
    return 'utf-16le'; // default for large Tally exports; confirmed at runtime
  }
  return 'utf-8';
}

export function parseDAYBOOK_chunked(
  file: File,
  fyStart: Date,
  fyEnd: Date,
  onProgress: ProgressCallback,
  onDone: DoneCallback,
  onError: (err: string) => void,
) {
  const stats: ChunkedStats = {
    totalVouchers: 0, missingVno: 0, narrated: 0,
    totalJournals: 0, highValueCount: 0, highValueNarrated: 0,
    zeroAmt: 0, wrongType: 0, missingParty: 0,
    cashOver10k: 0, roundCount: 0, dupVnoMap: {},
    monthCounts: {}, dateSet: [], custMap: {}, vendMap: {},
    totalDebit: 0, totalCredit: 0, salesVoucherTotal: 0,
    purchVoucherTotal: 0, cashBankNetMovement: 0,
    taxVoucherTotal: 0, journalNetAmt: 0, outOfFY: 0,
  };

  const dateSet = new Set<string>();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let chunkIndex = 0;
  let tail = '';

  function readNextChunk() {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    const reader = new FileReader();

    reader.onerror = () => onError('Failed to read file chunk');

    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      let enc = chunkIndex === 0 ? sniffEncoding(buf) : 'utf-8';
      let text: string;

      try {
        const decoder = new TextDecoder(enc);
        text = decoder.decode(buf, { stream: true });
      } catch {
        try {
          const decoder = new TextDecoder('utf-8');
          text = decoder.decode(buf, { stream: true });
        } catch (e) {
          onError('Encoding error: ' + String(e));
          return;
        }
      }

      const combined = tail + text;

      // Extract complete vouchers from combined
      const lastClose = combined.lastIndexOf('</VOUCHER>');
      const toProcess = lastClose >= 0 ? combined.slice(0, lastClose + 10) : '';
      tail = lastClose >= 0 ? combined.slice(lastClose + 10) : combined.slice(-20_000);

      if (toProcess) {
        const voucherRe = /<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/gi;
        let m: RegExpExecArray | null;
        while ((m = voucherRe.exec(toProcess)) !== null) {
          processVoucher(m[1], stats, dateSet, fyStart, fyEnd);
        }
      }

      chunkIndex++;
      const pct = Math.round((chunkIndex / totalChunks) * 100);
      onProgress(`Parsing DayBook.xml… ${pct}% (${chunkIndex}/${totalChunks} chunks)`);

      if (chunkIndex < totalChunks) {
        // Use setTimeout to avoid blocking UI
        setTimeout(readNextChunk, 0);
      } else {
        // Process remaining tail
        if (tail) {
          const voucherRe = /<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/gi;
          let m: RegExpExecArray | null;
          while ((m = voucherRe.exec(tail)) !== null) {
            processVoucher(m[1], stats, dateSet, fyStart, fyEnd);
          }
        }
        stats.dateSet = Array.from(dateSet);
        onDone(stats);
      }
    };

    reader.readAsArrayBuffer(blob);
  }

  readNextChunk();
}

function sniffEncoding(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf.slice(0, 4));
  // UTF-16 LE BOM: FF FE
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  // UTF-16 BE BOM: FE FF
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  // UTF-8 BOM: EF BB BF
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  return 'utf-8';
}
