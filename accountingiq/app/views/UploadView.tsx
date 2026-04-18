'use client';

import { useRef, useState } from 'react';
import { useApp } from '@/lib/state';
import { FILE_LABELS, FILE_DESCRIPTIONS, FILE_TIERS } from '@/lib/constants';
import { analyseFiles } from '@/lib/engine';
import { parseDAYBOOK_chunked } from '@/lib/chunkedParser';
import type { FileKey } from '@/lib/types';

const CHUNK_THRESHOLD = 10 * 1024 * 1024; // 10 MB

function currentFYDates() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { start: new Date(year, 3, 1), end: new Date(year + 1, 2, 31) };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── File type detection ───────────────────────────────────────────────────

function detectFileKey(filename: string, xmlContent: string): FileKey | null {
  // 1. REPORTNAME tag (most reliable — Tally embeds in every export)
  const reportMatch = xmlContent.match(/<REPORTNAME[^>]*>([^<]+)<\/REPORTNAME>/i);
  if (reportMatch) {
    const rn = reportMatch[1].trim().toLowerCase();
    if (rn.includes('day book') || rn === 'daybook') return 'daybook';
    if (rn.includes('trial balance')) return 'trialbal';
    if (rn.includes('profit') || rn.includes('p & l') || rn.includes('p&l')) return 'pandl';
    if (rn.includes('balance sheet')) return 'bsheet';
    if (rn.includes('group summary')) return 'grpsum';
    if (rn.includes('sales register')) return 'sales';
    if (rn.includes('purchase register')) return 'purchase';
    if (rn.includes('bills receivable')) return 'bills';
    if (rn.includes('bills payable')) return 'payables';
    if (rn.includes('cash flow')) return 'cashflow';
    if (rn.includes('fixed asset')) return 'faregister';
    if (rn.includes('stock summary')) return 'stock';
    if (rn.includes('bank reconciliation') || rn.includes('bank recon')) return 'bankrecon';
  }

  // 2. Filename patterns (fallback)
  const fn = filename.toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');
  if (fn.includes('daybook') || fn.startsWith('dayb')) return 'daybook';
  if (fn.includes('trialbal') || fn.includes('trial')) return 'trialbal';
  if (fn.includes('pandl') || fn.includes('p&l') || fn.includes('profitloss')) return 'pandl';
  if (fn.includes('bsheet') || fn.includes('balancesheet') || fn.includes('bsh')) return 'bsheet';
  if (fn.includes('grpsum') || fn.includes('groupsummary') || fn.startsWith('grp')) return 'grpsum';
  if (fn.includes('salesreg') || fn.includes('salesregister')) return 'sales';
  if ((fn.includes('purchreg') || fn.includes('purchaseregister') || fn === 'pr.xml') && !fn.includes('profit')) return 'purchase';
  if (fn.includes('billsrec') || fn.includes('billsr') || (fn.includes('bills') && !fn.includes('pay'))) return 'bills';
  if (fn.includes('billspay') || fn.includes('billsp') || fn.includes('payables')) return 'payables';
  if (fn.includes('cashflow') || fn === 'cf.xml') return 'cashflow';
  if (fn.includes('faregister') || fn.includes('fixedasset') || fn.includes('fixed')) return 'faregister';
  if (fn.includes('stocksummary') || fn.includes('stock')) return 'stock';
  if (fn.includes('bankrecon') || fn.includes('recon')) return 'bankrecon';

  // 3. Content fingerprints (last resort)
  const xmlLower = xmlContent.slice(0, 4000).toLowerCase();
  if (xmlLower.includes('<voucher ') || xmlLower.includes('<voucher>')) return 'daybook';
  if (xmlLower.includes('<plamt>') || xmlLower.includes('<plsubamt>')) return 'pandl';
  if (xmlLower.includes('<bsamt>') || xmlLower.includes('<bssubamt>')) return 'bsheet';
  if (xmlLower.includes('<dspclamta>') && !xmlLower.includes('<bsamt>')) return 'trialbal';

  return null;
}

// ── Encoding-aware file reader ────────────────────────────────────────────

function readWithEncoding(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      let encoding = 'utf-8';
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) encoding = 'utf-16le';
      else if (bytes[0] === 0xFE && bytes[1] === 0xFF) encoding = 'utf-16be';
      resolve(new TextDecoder(encoding).decode(buf));
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

// ── Main export ───────────────────────────────────────────────────────────

export default function UploadView() {
  const { state, dispatch } = useApp();
  const { files } = state;

  if (!state.currentCompany) {
    return (
      <div className="flex items-center justify-center min-h-full p-8">
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Select a company first.{' '}
          <button
            className="underline"
            style={{ color: 'var(--teal)' }}
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'company-select' })}
          >
            Go to Companies
          </button>
        </p>
      </div>
    );
  }

  return <UploadScreen files={files} state={state} dispatch={dispatch} />;
}

// ── Upload screen ─────────────────────────────────────────────────────────

function UploadScreen({
  files,
  state,
  dispatch,
}: {
  files: ReturnType<typeof useApp>['state']['files'];
  state: ReturnType<typeof useApp>['state'];
  dispatch: ReturnType<typeof useApp>['dispatch'];
}) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState<{ total: number; matched: number; skipped: string[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const requiredLoaded = FILE_TIERS.required.every(k => files[k].hasContent);

  async function processFolder(fileList: FileList) {
    const xmlFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.xml'));
    if (xmlFiles.length === 0) return;

    setScanning(true);
    setScanSummary(null);

    let matched = 0;
    const skipped: string[] = [];
    const { start, end } = currentFYDates();

    for (const file of xmlFiles) {
      // For DayBook candidates, check size first — chunked path doesn't need full content
      const fnLower = file.name.toLowerCase();
      const likelyDaybook = fnLower.includes('daybook') || fnLower.includes('day book') || fnLower.startsWith('dayb');

      if (likelyDaybook && file.size > CHUNK_THRESHOLD) {
        // Chunked parse — key is daybook without reading full content
        dispatch({ type: 'UPLOAD_PROGRESS', message: `Parsing ${file.name}…` });
        await new Promise<void>((resolve) => {
          parseDAYBOOK_chunked(
            file, start, end,
            (msg) => dispatch({ type: 'UPLOAD_PROGRESS', message: msg }),
            (stats) => {
              dispatch({ type: 'UPLOAD_PROGRESS', message: null });
              dispatch({
                type: 'FILE_LOADED',
                key: 'daybook',
                entry: { name: file.name, size: file.size, hasContent: true, content: null, chunkedStats: stats, sessionExpired: false },
              });
              matched++;
              resolve();
            },
            (err) => {
              dispatch({ type: 'UPLOAD_PROGRESS', message: null });
              skipped.push(`${file.name} (parse error: ${err})`);
              resolve();
            },
          );
        });
        continue;
      }

      let content: string;
      try {
        content = await readWithEncoding(file);
      } catch {
        skipped.push(`${file.name} (read error)`);
        continue;
      }

      const key = detectFileKey(file.name, content);
      if (!key) {
        skipped.push(file.name);
        continue;
      }

      if (key === 'daybook' && file.size > CHUNK_THRESHOLD) {
        dispatch({ type: 'UPLOAD_PROGRESS', message: `Parsing ${file.name}…` });
        await new Promise<void>((resolve) => {
          parseDAYBOOK_chunked(
            file, start, end,
            (msg) => dispatch({ type: 'UPLOAD_PROGRESS', message: msg }),
            (stats) => {
              dispatch({ type: 'UPLOAD_PROGRESS', message: null });
              dispatch({
                type: 'FILE_LOADED',
                key,
                entry: { name: file.name, size: file.size, hasContent: true, content: null, chunkedStats: stats, sessionExpired: false },
              });
              matched++;
              resolve();
            },
            (err) => {
              dispatch({ type: 'UPLOAD_PROGRESS', message: null });
              skipped.push(`${file.name} (parse error: ${err})`);
              resolve();
            },
          );
        });
      } else {
        dispatch({
          type: 'FILE_LOADED',
          key,
          entry: { name: file.name, size: file.size, hasContent: true, content, chunkedStats: null, sessionExpired: false },
        });
        matched++;
      }
    }

    setScanning(false);
    setScanSummary({ total: xmlFiles.length, matched, skipped });
  }

  function onFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files;
    if (fl && fl.length > 0) processFolder(fl);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const fl = e.dataTransfer.files;
    if (fl && fl.length > 0) processFolder(fl);
  }

  async function handleAnalyse() {
    const { results, parsedData } = analyseFiles(state);
    dispatch({ type: 'ANALYSIS_DONE', results, parsedData });
    // Save to DB in the background — don't block UI
    fetch('/api/analysis/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overall_score: results.overall,
        capped_score: results.cappedScore,
        score_capped: results.scoreCapped,
        dim_scores: results.dimScores,
        checks: results.checks,
        company_id: state.currentCompany?.id ?? null,
      }),
    }).catch(() => {});
  }




  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        Upload Tally Export Folder
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Select the folder containing your Tally XML exports — files are identified automatically.
      </p>

      {/* Folder drop zone */}
      <div
        className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 px-6 mb-6 transition-colors cursor-pointer"
        style={{
          borderColor: dragging ? 'var(--teal)' : 'var(--border)',
          background: dragging ? 'rgba(15,212,160,0.05)' : 'var(--bg2)',
        }}
        onClick={() => folderInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is not in standard typings
          webkitdirectory="true"
          multiple
          accept=".xml"
          className="hidden"
          onChange={onFolderInput}
        />

        <div className="text-3xl" style={{ color: 'var(--text3)' }}>
          {scanning ? '⟳' : '⬆'}
        </div>
        <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
          {scanning ? 'Scanning files…' : 'Drop your Tally export folder here'}
        </div>
        <div className="text-xs" style={{ color: 'var(--text3)' }}>
          {scanning ? 'Please wait' : 'or click to select folder'}
        </div>
      </div>

      {/* Scan result summary */}
      {scanSummary && (
        <div
          className="text-xs px-4 py-2.5 rounded-lg mb-5 flex items-center gap-3"
          style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
        >
          <span style={{ color: 'var(--teal)' }}>✓</span>
          <span>
            Found <strong style={{ color: 'var(--text1)' }}>{scanSummary.matched}</strong> of{' '}
            {scanSummary.total} XML files identified
            {scanSummary.skipped.length > 0 && (
              <span style={{ color: 'var(--text3)' }}>
                {' '}· {scanSummary.skipped.length} unrecognised ({scanSummary.skipped.join(', ')})
              </span>
            )}
          </span>
        </div>
      )}

      {/* File status grid */}
      <StatusGrid files={files} dispatch={dispatch} state={state} />

      {/* Run Analysis */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={handleAnalyse}
          disabled={!requiredLoaded}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          {state.analysed ? 'Re-run Analysis' : 'Run Analysis'}
        </button>
        {!requiredLoaded && (
          <span className="text-xs" style={{ color: 'var(--text3)' }}>
            5 required files needed
          </span>
        )}
      </div>
    </div>
  );
}

// ── Status grid ───────────────────────────────────────────────────────────

function StatusGrid({
  files,
  dispatch,
  state,
}: {
  files: ReturnType<typeof useApp>['state']['files'];
  dispatch: ReturnType<typeof useApp>['dispatch'];
  state: ReturnType<typeof useApp>['state'];
}) {
  return (
    <div className="space-y-5">
      <TierSection tier="required" label="Required" files={files} dispatch={dispatch} state={state} />
      <TierSection tier="conditional" label="Conditional" files={files} dispatch={dispatch} state={state} />
      <TierSection tier="optional" label="Optional" files={files} dispatch={dispatch} state={state} />
    </div>
  );
}

function TierSection({
  tier,
  label,
  files,
  dispatch,
  state,
}: {
  tier: 'required' | 'conditional' | 'optional';
  label: string;
  files: ReturnType<typeof useApp>['state']['files'];
  dispatch: ReturnType<typeof useApp>['dispatch'];
  state: ReturnType<typeof useApp>['state'];
}) {
  const keys = FILE_TIERS[tier];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
          {label}
        </span>
        {tier === 'required' && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(240,72,72,0.12)', color: 'var(--red)' }}>
            all required
          </span>
        )}
      </div>
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        {keys.map((key, i) => (
          <FileRow
            key={key}
            fileKey={key}
            entry={files[key]}
            dispatch={dispatch}
            state={state}
            last={i === keys.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function FileRow({
  fileKey,
  entry,
  dispatch,
  state,
  last,
}: {
  fileKey: FileKey;
  entry: ReturnType<typeof useApp>['state']['files'][FileKey];
  dispatch: ReturnType<typeof useApp>['dispatch'];
  state: ReturnType<typeof useApp>['state'];
  last: boolean;
}) {
  const manualRef = useRef<HTMLInputElement>(null);
  const loaded = entry.hasContent;
  const expired = entry.sessionExpired;

  function handleManualFile(file: File) {
    const { start, end } = currentFYDates();
    if (fileKey === 'daybook' && file.size > CHUNK_THRESHOLD) {
      dispatch({ type: 'UPLOAD_PROGRESS', message: `Parsing ${file.name}…` });
      parseDAYBOOK_chunked(
        file, start, end,
        (msg) => dispatch({ type: 'UPLOAD_PROGRESS', message: msg }),
        (stats) => {
          dispatch({ type: 'UPLOAD_PROGRESS', message: null });
          dispatch({ type: 'FILE_LOADED', key: fileKey, entry: { name: file.name, size: file.size, hasContent: true, content: null, chunkedStats: stats, sessionExpired: false } });
        },
        (err) => {
          dispatch({ type: 'UPLOAD_PROGRESS', message: null });
          alert(`Error reading ${file.name}: ${err}`);
        },
      );
    } else {
      readWithEncoding(file).then(content => {
        dispatch({ type: 'FILE_LOADED', key: fileKey, entry: { name: file.name, size: file.size, hasContent: true, content, chunkedStats: null, sessionExpired: false } });
      }).catch(() => alert(`Error reading ${file.name}`));
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{
        background: loaded ? 'var(--bg3)' : 'var(--bg2)',
        borderBottom: last ? 'none' : `1px solid var(--border)`,
      }}
    >
      <input
        ref={manualRef}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleManualFile(f); e.target.value = ''; }}
      />

      {/* Status dot */}
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 font-bold"
        style={{
          background: loaded ? 'rgba(15,212,160,0.15)' : 'var(--bg4)',
          color: loaded ? 'var(--teal)' : 'var(--text3)',
        }}
      >
        {loaded ? '✓' : '○'}
      </div>

      {/* Label + filename */}
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <span className="text-sm font-medium shrink-0" style={{ color: loaded ? 'var(--text1)' : 'var(--text2)' }}>
          {FILE_LABELS[fileKey]}
        </span>
        <span className="text-xs truncate" style={{ color: 'var(--text3)' }}>
          {loaded
            ? (expired ? `${entry.name} — re-upload needed` : `${entry.name} · ${fmtSize(entry.size)}`)
            : FILE_DESCRIPTIONS[fileKey]
          }
        </span>
      </div>

      {/* Actions */}
      {expired && (
        <button
          onClick={() => manualRef.current?.click()}
          className="text-xs px-2 py-1 rounded shrink-0"
          style={{ background: 'var(--bg4)', color: 'var(--amber)' }}
        >
          Re-upload
        </button>
      )}
      {loaded && !expired && (
        <button
          onClick={() => dispatch({ type: 'FILE_REMOVED', key: fileKey })}
          className="text-xs w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors"
          style={{ color: 'var(--text3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
        >
          ✕
        </button>
      )}
      {!loaded && !expired && (
        <button
          onClick={() => manualRef.current?.click()}
          className="text-xs w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors"
          style={{ color: 'var(--text3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text1)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
          title="Upload manually"
        >
          ↑
        </button>
      )}
    </div>
  );
}
