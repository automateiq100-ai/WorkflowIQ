'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/state';
import { FILE_LABELS, FILE_DESCRIPTIONS, FILE_TIERS, FILE_EXPORT_PATHS, FILE_EXPORT_ACTION } from '@/lib/constants';
import { analyseFiles } from '@/lib/engine';
import { parseDAYBOOK_chunked } from '@/lib/chunkedParser';
import type { FileKey, ParsedData } from '@/lib/types';
import type { ConnectorSession, ReportKind } from '@/lib/connectors/types';

const TALLY_SESSION_KEY = 'aiq.tallySession';
const TALLY_KIND_TO_FILE: Record<ReportKind, FileKey> = {
  master: 'master', trialbal: 'trialbal', pandl: 'pandl',
  bsheet: 'bsheet', grpsum: 'grpsum', daybook: 'daybook',
  sales: 'sales', purchase: 'purchase', bills: 'bills',
  payables: 'payables', cashflow: 'cashflow',
  faregister: 'faregister', stock: 'stock', bankrecon: 'bankrecon',
};

const CHUNK_THRESHOLD = 10 * 1024 * 1024; // 10 MB

/**
 * Default analysis period (Indian FY, Apr–Mar).
 *
 * Tally users typically analyse the books of the FY they just *closed*, not
 * the one in progress. So during April–June (the closing window), we default
 * to the *previous* FY. Otherwise (Jul–Mar), default to the FY currently in
 * progress. This avoids the trap where a sync defaults to a future period and
 * Tally legitimately returns zero closing balances.
 */
function currentFYDates() {
  const now = new Date();
  const month = now.getMonth(); // 0=Jan … 11=Dec
  let year: number;
  if (month <= 2) {
    // Jan–Mar: still inside the FY that started last calendar year
    year = now.getFullYear() - 1;
  } else if (month <= 5) {
    // Apr–Jun: closing the prior FY's books — default to that prior FY
    year = now.getFullYear() - 1;
  } else {
    // Jul–Dec: current FY well underway
    year = now.getFullYear();
  }
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
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [tallySession, setTallySession] = useState<ConnectorSession | null>(null);
  const [tallyPulling, setTallyPulling] = useState(false);
  const [tallyPullError, setTallyPullError] = useState<string | null>(null);
  const requiredLoaded = FILE_TIERS.required.every(k => files[k].hasContent);

  useEffect(() => {
    let cancelled = false;

    function readLocal(): ConnectorSession | null {
      try {
        const raw = sessionStorage.getItem(TALLY_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<ConnectorSession>;
        if (!parsed || typeof parsed.bridgeId !== 'string' || !parsed.bridgeId) return null;
        return parsed as ConnectorSession;
      } catch { return null; }
    }

    async function refresh() {
      const local = readLocal();
      if (local) { if (!cancelled) setTallySession(local); return; }
      try {
        const r = await fetch('/api/tally/active-session');
        if (cancelled || !r.ok) return;
        const data = (await r.json()) as { session: ConnectorSession | null };
        if (cancelled || !data.session) return;
        sessionStorage.setItem(TALLY_SESSION_KEY, JSON.stringify(data.session));
        setTallySession(data.session);
      } catch { /* ignore — banner just stays in unpaired state */ }
    }

    refresh();
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  // Period selection
  const [periodType, setPeriodType] = useState<'monthly' | 'quarterly' | 'yearly' | 'custom'>('yearly');

  // Shared year (FY-starting for quarterly/yearly; calendar year for monthly).
  // Matches the Apr–Jun "closing window" default in currentFYDates so the
  // picker, the offline-upload helpers and the live-Tally sync all start on
  // the same FY by default.
  const [periodYear, setPeriodYear] = useState<string>(() =>
    String(currentFYDates().start.getFullYear()),
  );
  // Monthly-only
  const [periodMonth, setPeriodMonth] = useState<string>(() =>
    String(new Date().getMonth() + 1).padStart(2, '0'),
  );
  // Quarterly-only
  const [periodQuarter, setPeriodQuarter] = useState<1 | 2 | 3 | 4>(() => {
    const m = new Date().getMonth(); // 0-indexed
    if (m >= 3 && m <= 5) return 1;
    if (m >= 6 && m <= 8) return 2;
    if (m >= 9 && m <= 11) return 3;
    return 4;
  });
  // Custom-only
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  // DayBook actual date range (YYYYMMDD strings, extracted on load)
  const [daybookDateRange, setDaybookDateRange] = useState<{ min: string; max: string } | null>(null);

  // ── Period helpers ───────────────────────────────────────────────────────

  function getExpectedRange(): { start: Date; end: Date } | null {
    const yr = parseInt(periodYear, 10);
    switch (periodType) {
      case 'monthly': {
        const m = parseInt(periodMonth, 10) - 1;
        return { start: new Date(yr, m, 1), end: new Date(yr, m + 1, 0) };
      }
      case 'quarterly': {
        const qRanges: { start: Date; end: Date }[] = [
          { start: new Date(yr, 3, 1),  end: new Date(yr, 5, 30) },       // Q1 Apr–Jun
          { start: new Date(yr, 6, 1),  end: new Date(yr, 8, 30) },       // Q2 Jul–Sep
          { start: new Date(yr, 9, 1),  end: new Date(yr, 11, 31) },      // Q3 Oct–Dec
          { start: new Date(yr + 1, 0, 1), end: new Date(yr + 1, 2, 31) }, // Q4 Jan–Mar
        ];
        return qRanges[periodQuarter - 1];
      }
      case 'yearly':
        return { start: new Date(yr, 3, 1), end: new Date(yr + 1, 2, 31) };
      case 'custom':
        if (!periodStart || !periodEnd) return null;
        return { start: new Date(periodStart), end: new Date(periodEnd) };
    }
  }

  function getPeriodLabel(): string {
    const yr = parseInt(periodYear, 10);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    switch (periodType) {
      case 'monthly':
        return `${monthNames[parseInt(periodMonth, 10) - 1]} ${yr}`;
      case 'quarterly':
        return `Q${periodQuarter} FY ${yr}–${String(yr + 1).slice(2)}`;
      case 'yearly':
        return `FY ${yr}–${String(yr + 1).slice(2)}`;
      case 'custom':
        return periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : 'Custom';
    }
  }

  function getMismatchWarning(): string | null {
    if (!daybookDateRange) return null;
    const expected = getExpectedRange();
    if (!expected) return null;

    // Parse YYYYMMDD → Date
    const parse8 = (s: string) => new Date(
      parseInt(s.slice(0, 4), 10),
      parseInt(s.slice(4, 6), 10) - 1,
      parseInt(s.slice(6, 8), 10),
    );
    const dbMin = parse8(daybookDateRange.min);
    const dbMax = parse8(daybookDateRange.max);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    // Only warn when data extends OUTSIDE the selected period — not when it's shorter
    if (dbMin < expected.start || dbMax > expected.end) {
      return `⚠ DayBook contains entries outside the selected period — data: ${fmt(dbMin)} – ${fmt(dbMax)}, selected: ${fmt(expected.start)} – ${fmt(expected.end)}`;
    }
    return null;
  }

  // ── Saved period info for DB ─────────────────────────────────────────────

  function getPeriodForDB(): { period_type: string; period_start: string | null; period_end: string | null } {
    const expected = getExpectedRange();
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    return {
      period_type:  periodType,
      period_start: expected ? toISO(expected.start) : null,
      period_end:   expected ? toISO(expected.end)   : null,
    };
  }

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
                entry: { name: file.name, size: file.size, hasContent: true, content: null, chunkedStats: stats, sessionExpired: false, source: 'upload' },
              });
              // Extract date range from chunked stats
              if (stats.dateSet && stats.dateSet.length > 0) {
                const sorted = [...stats.dateSet].sort();
                setDaybookDateRange({ min: sorted[0], max: sorted[sorted.length - 1] });
              }
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
                entry: { name: file.name, size: file.size, hasContent: true, content: null, chunkedStats: stats, sessionExpired: false, source: 'upload' },
              });
              // Extract date range from chunked stats
              if (stats.dateSet && stats.dateSet.length > 0) {
                const sorted = [...stats.dateSet].sort();
                setDaybookDateRange({ min: sorted[0], max: sorted[sorted.length - 1] });
              }
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
        // Extract DayBook date range for non-chunked file
        if (key === 'daybook') {
          const dates = Array.from(content.matchAll(/<DATE>(\d{8})<\/DATE>/gi), m => m[1]);
          if (dates.length > 0) {
            const sorted = [...dates].sort();
            setDaybookDateRange({ min: sorted[0], max: sorted[sorted.length - 1] });
          }
        }
        dispatch({
          type: 'FILE_LOADED',
          key,
          entry: { name: file.name, size: file.size, hasContent: true, content, chunkedStats: null, sessionExpired: false, source: 'upload' },
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

  async function handlePullFromTally() {
    if (!tallySession?.selectedCompany) {
      setTallyPullError('Open Tally Connection and select a company first.');
      return;
    }
    const expected = getExpectedRange();
    if (!expected) {
      setTallyPullError('Pick an analysis period first.');
      return;
    }
    // Guard against the most common "all amounts ₹0" cause: a default FY that
    // hasn't happened yet. Tally legitimately returns empty closing balances
    // for a future period; warn the user before we waste a sync round-trip.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expected.end > today) {
      const prevFY = expected.start.getFullYear() - 1;
      const ok = window.confirm(
        `The selected period ends on ${expected.end.toLocaleDateString('en-IN')} — that's in the future.\n\n` +
        `Tally will return zero closing balances for periods that haven't completed.\n\n` +
        `Switch to FY ${prevFY}-${(prevFY + 1) % 100}?  (Cancel to sync the future period anyway.)`
      );
      if (ok) {
        setPeriodYear(String(prevFY));
        setTallyPullError(`Switched to FY ${prevFY}-${(prevFY + 1) % 100}. Click "Pull from Tally" again.`);
        return;
      }
    }
    setTallyPullError(null);
    setTallyPulling(true);
    dispatch({ type: 'UPLOAD_PROGRESS', message: 'Pulling reports from Tally…' });
    try {
      const period = {
        start: expected.start.toISOString().slice(0, 10),
        end:   expected.end.toISOString().slice(0, 10),
      };
      // Capture user's INTENT — what range they asked Tally for.  Drives
      // sparse-books detection downstream (e.g. H8 distinguishes "user
      // asked for 12 months but only 2 had vouchers" from "user
      // intentionally uploaded a 2-month slice").
      dispatch({ type: 'REQUESTED_PERIOD_SET', period: { ...period, type: periodType } });
      const r = await fetch('/api/tally/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: tallySession.bridgeId, period }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Sync failed');
      const results = data.results as Record<string, { ok: boolean; xml?: string; error?: string }>;
      const realFailures: string[] = [];
      const manualOnly: string[] = [];
      // Sentinel from connectors/tally/tdl.ts: errors prefixed with
      // "MANUAL_ONLY: " are reports that intentionally aren't fetched
      // (no standalone Tally TDL implementation — e.g. Bank Reconciliation
      // requires per-ledger F5).  Show them as a separate "manual-only"
      // category so users don't read them as broken integration.
      const MANUAL_ONLY_PREFIX = 'MANUAL_ONLY: ';
      for (const [kind, res] of Object.entries(results)) {
        const fileKey = TALLY_KIND_TO_FILE[kind as ReportKind];
        if (!fileKey) continue;
        // Diagnostic: per-kind size in browser DevTools console — helps a user
        // copy-paste evidence into a bug report without us asking for raw XML.
        console.log('[tally-sync]', kind, res.ok ? 'ok' : 'fail', 'len=' + (res.xml?.length ?? 0), res.error ?? '');
        if (!res.ok || !res.xml) {
          const err = res.error ?? 'unknown';
          if (err.startsWith(MANUAL_ONLY_PREFIX)) {
            manualOnly.push(`${FILE_LABELS[fileKey]} — ${err.slice(MANUAL_ONLY_PREFIX.length)}`);
          } else {
            realFailures.push(`${kind}: ${err}`);
          }
          continue;
        }
        dispatch({
          type: 'FILE_LOADED',
          key: fileKey,
          entry: {
            name: `${kind}.xml (Tally)`,
            size: res.xml.length,
            hasContent: true,
            content: res.xml,
            chunkedStats: null,
            sessionExpired: false,
            source: 'tally',
          },
        });
      }
      const parts: string[] = [];
      if (realFailures.length > 0) parts.push(`Failed: ${realFailures.join('; ')}`);
      if (manualOnly.length > 0)   parts.push(`Manual-only (export from Tally yourself): ${manualOnly.join('; ')}`);
      if (parts.length > 0) setTallyPullError(parts.join(' | '));
    } catch (e) {
      setTallyPullError((e as Error).message);
    } finally {
      dispatch({ type: 'UPLOAD_PROGRESS', message: null });
      setTallyPulling(false);
    }
  }

  async function handleAnalyse() {
    // Capture the user's intended period before analysis runs so the
    // engine and detector see the requested range alongside actual data.
    const expected = getExpectedRange();
    if (expected) {
      dispatch({
        type: 'REQUESTED_PERIOD_SET',
        period: {
          start: expected.start.toISOString().slice(0, 10),
          end:   expected.end.toISOString().slice(0, 10),
          type:  periodType,
        },
      });
    }
    const { results, parsedData, dbStats } = analyseFiles(state);
    dispatch({ type: 'ANALYSIS_DONE', results, parsedData, dbStats });

    // Extract key financial metrics from parsedData
    const pd = parsedData as Partial<ParsedData>;
    const financialSummary = {
      revenue:      pd.revenue      ?? null,
      expenses:     pd.expenses     ?? null,
      netProfit:    pd.bsNetProfit  ?? pd.netProfit ?? null,
      bankBal:      pd.bankBal      ?? null,
      debtorBal:    pd.debtorBal    ?? null,
      creditorBal:  pd.creditorBal  ?? null,
      currentRatio: (pd.ca && pd.cl) ? +(pd.ca / pd.cl).toFixed(2) : null,
    };

    // Save to DB — used to be fire-and-forget but the post-analysis
    // navigation to the dashboard frequently ran the history fetch
    // BEFORE this POST landed (~250-650ms), leaving "Last Analysis"
    // empty until manual refresh.  Awaiting (but not blocking analysis
    // dispatch above) ensures the canonical server-side record exists
    // before any view that reads from /api/analysis/history mounts.
    // Errors are still swallowed — a failed save shouldn't prevent the
    // user from seeing their fresh local analysis.
    const periodDB = getPeriodForDB();
    try {
      await fetch('/api/analysis/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overall_score: results.overall,
          capped_score: results.cappedScore,
          score_capped: results.scoreCapped,
          dim_scores: results.dimScores,
          checks: results.checks,
          company_id: state.currentCompany?.id ?? null,
          period_type:  periodDB.period_type,
          period_start: periodDB.period_start,
          period_end:   periodDB.period_end,
          financial_summary: financialSummary,
        }),
      });
    } catch {
      // Save failed — UI fallback in CompanyDashboardView synthesizes a
      // local AnalysisRun from state.results so the user still sees this
      // session's numbers.  Next successful save will write it through.
    }
  }




  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
        Upload Tally Export Folder
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Select the folder containing your Tally XML exports — files are identified automatically.
      </p>

      {/* Period selector */}
      <PeriodSelector
        periodType={periodType}  setPeriodType={setPeriodType}
        periodYear={periodYear}  setPeriodYear={setPeriodYear}
        periodMonth={periodMonth} setPeriodMonth={setPeriodMonth}
        periodQuarter={periodQuarter} setPeriodQuarter={setPeriodQuarter}
        periodStart={periodStart}  setPeriodStart={setPeriodStart}
        periodEnd={periodEnd}    setPeriodEnd={setPeriodEnd}
        periodLabel={getPeriodLabel()}
      />

      {/* Mismatch warning */}
      {getMismatchWarning() && (
        <div
          className="rounded-lg px-4 py-3 mb-4 text-xs"
          style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid var(--amber)', color: 'var(--amber)' }}
        >
          {getMismatchWarning()}
        </div>
      )}

      {/* Tally Prime live connection */}
      <div
        className="rounded-xl border p-4 mb-4"
        style={{ background: 'var(--bg2)', borderColor: tallySession ? 'var(--teal)' : 'var(--border)' }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text1)' }}>
              <span>⇌</span> Tally Prime — live connection
              {tallySession?.selectedCompany && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(15,212,160,0.15)', color: 'var(--teal)' }}
                >
                  {tallySession.selectedCompany.name}
                </span>
              )}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
              {tallySession?.selectedCompany
                ? 'Pull all 6 required reports from Tally for the selected period — no manual export.'
                : 'Pair your local Tally Prime instance to skip folder uploads.'}
            </div>
          </div>
          {tallySession?.selectedCompany ? (
            <button
              onClick={handlePullFromTally}
              disabled={tallyPulling}
              className="text-xs px-4 py-2 rounded-lg font-semibold disabled:opacity-50 shrink-0"
              style={{ background: 'var(--teal)', color: '#000' }}
            >
              {tallyPulling ? 'Pulling…' : 'Pull from Tally'}
            </button>
          ) : (
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'tally-connection' })}
              className="text-xs px-4 py-2 rounded-lg border shrink-0"
              style={{ borderColor: 'var(--teal)', color: 'var(--teal)' }}
            >
              Connect Tally Prime
            </button>
          )}
        </div>
        {tallyPullError && (
          <div className="text-xs mt-2" style={{ color: 'var(--red)' }}>{tallyPullError}</div>
        )}
      </div>

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
      <div className="mt-6 flex items-center gap-4 flex-wrap">
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
            6 required files needed
          </span>
        )}

        {/* Request from Client — shown when conditional files are missing */}
        {FILE_TIERS.conditional.some(k => !files[k].hasContent) && (
          <button
            onClick={() => setShowRequestModal(true)}
            className="text-xs px-3 py-2 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text2)', background: 'var(--bg3)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = 'var(--teal)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text2)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
          >
            ✉ Request from Client
          </button>
        )}
      </div>

      {/* Request from Client modal */}
      {showRequestModal && (
        <RequestClientModal
          files={files}
          companyName={state.currentCompany?.name ?? 'your company'}
          onClose={() => setShowRequestModal(false)}
        />
      )}
    </div>
  );
}

// ── Period selector ───────────────────────────────────────────────────────

const MONTHS = [
  { value: '01', label: 'January' }, { value: '02', label: 'February' },
  { value: '03', label: 'March' },   { value: '04', label: 'April' },
  { value: '05', label: 'May' },     { value: '06', label: 'June' },
  { value: '07', label: 'July' },    { value: '08', label: 'August' },
  { value: '09', label: 'September' },{ value: '10', label: 'October' },
  { value: '11', label: 'November' },{ value: '12', label: 'December' },
];

function fyYears(): string[] {
  const cur = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => String(cur - 2 + i));
}

function calYears(): string[] {
  const cur = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => String(cur - 2 + i));
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', borderRadius: 8, padding: '6px 10px',
  fontSize: 12, outline: 'none',
};

interface PeriodSelectorProps {
  periodType: 'monthly' | 'quarterly' | 'yearly' | 'custom';
  setPeriodType: (v: 'monthly' | 'quarterly' | 'yearly' | 'custom') => void;
  periodYear: string; setPeriodYear: (v: string) => void;
  periodMonth: string; setPeriodMonth: (v: string) => void;
  periodQuarter: 1 | 2 | 3 | 4; setPeriodQuarter: (v: 1 | 2 | 3 | 4) => void;
  periodStart: string; setPeriodStart: (v: string) => void;
  periodEnd: string;   setPeriodEnd:   (v: string) => void;
  periodLabel: string;
}

function PeriodSelector({
  periodType, setPeriodType,
  periodYear, setPeriodYear,
  periodMonth, setPeriodMonth,
  periodQuarter, setPeriodQuarter,
  periodStart, setPeriodStart,
  periodEnd, setPeriodEnd,
  periodLabel,
}: PeriodSelectorProps) {
  const btnBase: React.CSSProperties = {
    padding: '6px 14px', borderRadius: 8, fontSize: 12,
    fontWeight: 500, border: '1px solid', cursor: 'pointer', transition: 'all .15s',
  };
  const active: React.CSSProperties = { background: 'var(--teal)', color: '#000', borderColor: 'var(--teal)' };
  const inactive: React.CSSProperties = { background: 'var(--bg3)', color: 'var(--text2)', borderColor: 'var(--border)' };

  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
    >
      <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
        Analysis Period
        {periodLabel && (
          <span className="ml-2 normal-case font-normal" style={{ color: 'var(--teal)' }}>
            — {periodLabel}
          </span>
        )}
      </div>

      {/* Type pills */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {(['monthly', 'quarterly', 'yearly', 'custom'] as const).map(p => (
          <button key={p} onClick={() => setPeriodType(p)}
            style={{ ...btnBase, ...(periodType === p ? active : inactive) }}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Type-specific pickers */}
      {periodType === 'monthly' && (
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text3)' }}>Month</label>
            <select value={periodMonth} onChange={e => setPeriodMonth(e.target.value)} style={selectStyle}>
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text3)' }}>Year</label>
            <select value={periodYear} onChange={e => setPeriodYear(e.target.value)} style={selectStyle}>
              {calYears().map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      )}

      {periodType === 'quarterly' && (
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text3)' }}>Quarter</label>
            <div className="flex gap-1.5">
              {([1, 2, 3, 4] as const).map(q => (
                <button key={q} onClick={() => setPeriodQuarter(q)}
                  style={{ ...btnBase, ...(periodQuarter === q ? active : inactive), padding: '5px 10px' }}
                >
                  Q{q}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text3)' }}>Financial Year starting</label>
            <select value={periodYear} onChange={e => setPeriodYear(e.target.value)} style={selectStyle}>
              {fyYears().map(y => (
                <option key={y} value={y}>{y}–{String(parseInt(y) + 1).slice(2)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {periodType === 'yearly' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--text3)' }}>Financial Year</label>
          <select value={periodYear} onChange={e => setPeriodYear(e.target.value)} style={selectStyle}>
            {fyYears().map(y => (
              <option key={y} value={y}>FY {y}–{String(parseInt(y) + 1).slice(2)}</option>
            ))}
          </select>
        </div>
      )}

      {periodType === 'custom' && (
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text3)' }}>Start date</label>
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
              style={{ ...selectStyle, padding: '6px 10px' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text3)' }}>End date</label>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
              style={{ ...selectStyle, padding: '6px 10px' }} />
          </div>
        </div>
      )}
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
  if (!entry) return null;
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
          dispatch({ type: 'FILE_LOADED', key: fileKey, entry: { name: file.name, size: file.size, hasContent: true, content: null, chunkedStats: stats, sessionExpired: false, source: 'upload' } });
        },
        (err) => {
          dispatch({ type: 'UPLOAD_PROGRESS', message: null });
          alert(`Error reading ${file.name}: ${err}`);
        },
      );
    } else {
      readWithEncoding(file).then(content => {
        dispatch({ type: 'FILE_LOADED', key: fileKey, entry: { name: file.name, size: file.size, hasContent: true, content, chunkedStats: null, sessionExpired: false, source: 'upload' } });
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
        {loaded && entry.source === 'tally' && (
          <span
            className="text-xs px-1.5 py-0.5 rounded shrink-0"
            style={{ background: 'rgba(15,212,160,0.15)', color: 'var(--teal)' }}
          >
            ⇌ live
          </span>
        )}
      </div>

      {/* How-to-export popover — surfaces the manual Tally export path
          per file slot.  Clickable so the panel stays open while the user
          reads the multi-line instructions (a pure hover popover would
          dismiss every time they moved the cursor down). */}
      <ExportPathInfo fileKey={fileKey} />

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

// ── Per-row "How to export from Tally" popover ────────────────────────────
//
// Small ⓘ trigger that, when clicked, opens a panel below the row with
// the Tally export path, hotkey, and any report-specific tip.  Sourced
// from FILE_EXPORT_PATHS so every file slot stays in sync with the
// email modal and any other surface that surfaces the same data.
function ExportPathInfo({ fileKey }: { fileKey: FileKey }) {
  const [open, setOpen] = useState(false);
  const entry = FILE_EXPORT_PATHS[fileKey];
  // Close when clicking outside.  Tracked via a ref + global click
  // listener so the popover doesn't trap focus or block other rows from
  // opening their own info panels.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="text-xs w-6 h-6 rounded flex items-center justify-center transition-colors"
        style={{
          color: open ? 'var(--teal)' : 'var(--text3)',
          background: open ? 'rgba(15,212,160,0.12)' : 'transparent',
        }}
        title="How to export from Tally"
        aria-label="How to export from Tally"
      >
        ⓘ
      </button>
      {open && (
        <div
          className="absolute right-0 top-7 z-20 w-80 rounded-lg border shadow-lg p-3 text-xs leading-relaxed"
          style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text2)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="font-semibold mb-2" style={{ color: 'var(--text1)' }}>
            Export {FILE_LABELS[fileKey]} from Tally Prime
          </div>
          <div className="space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text3)' }}>Path</div>
              <div style={{ color: 'var(--text1)' }}>{entry.path}</div>
            </div>
            {entry.hotkey && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text3)' }}>Shortcut</div>
                <div className="font-mono" style={{ color: 'var(--text1)' }}>{entry.hotkey}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text3)' }}>Then</div>
              <div style={{ color: 'var(--text1)' }}>{FILE_EXPORT_ACTION}</div>
            </div>
            {entry.tip && (
              <div className="pt-1 mt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--amber)' }}>Tip</div>
                <div style={{ color: 'var(--text2)' }}>{entry.tip}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Request from Client modal ─────────────────────────────────────────────

function RequestClientModal({
  files,
  companyName,
  onClose,
}: {
  files: ReturnType<typeof useApp>['state']['files'];
  companyName: string;
  onClose: () => void;
}) {
  const missingConditional = FILE_TIERS.conditional.filter(k => !files[k].hasContent);
  const missingOptional    = FILE_TIERS.optional.filter(k => !files[k].hasContent);
  const [copied, setCopied] = useState(false);

  // Paths sourced from the shared FILE_EXPORT_PATHS constant so the email
  // template stays in sync with the per-row ⓘ popover (and any other
  // surface that lists export instructions).
  const formatPath = (k: FileKey) =>
    `  - ${FILE_LABELS[k]} — ${FILE_DESCRIPTIONS[k]}\n    Tally: ${FILE_EXPORT_PATHS[k].path} → ${FILE_EXPORT_ACTION}`
    + (FILE_EXPORT_PATHS[k].tip ? `\n    Tip: ${FILE_EXPORT_PATHS[k].tip}` : '');

  const conditionalLines = missingConditional.map(formatPath).join('\n\n');
  const optionalLines = missingOptional.length > 0
    ? `\nOptional (if applicable):\n${missingOptional.map(formatPath).join('\n\n')}`
    : '';

  const template = `Subject: Request for additional accounting data — ${companyName}

Dear [Client],

For a complete accounting health analysis of ${companyName}, we require the following additional reports exported from Tally Prime:

${conditionalLines}${optionalLines}

Export steps (Tally Prime):
Gateway of Tally → Display More Reports → [Report Name] → Export (Alt+E) → XML format

Please share these files at your earliest convenience.

Best regards,
[Your Name]`;

  function handleCopy() {
    navigator.clipboard.writeText(template).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-xl rounded-xl border overflow-hidden"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>Request from Client</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
              {missingConditional.length} conditional file{missingConditional.length !== 1 ? 's' : ''} missing
            </div>
          </div>
          <button onClick={onClose} className="text-sm" style={{ color: 'var(--text3)' }}>✕</button>
        </div>

        {/* Email template */}
        <div className="p-5">
          <textarea
            readOnly
            value={template}
            rows={16}
            className="w-full text-xs font-mono rounded-lg px-3 py-2.5 resize-none"
            style={{
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              color: 'var(--text2)',
              lineHeight: 1.6,
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-5 pb-4">
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
          >
            Close
          </button>
          <button
            onClick={handleCopy}
            className="text-xs px-4 py-2 rounded-lg font-semibold transition-opacity"
            style={{ background: copied ? 'var(--teal)' : 'var(--purple)', color: copied ? '#000' : '#fff' }}
          >
            {copied ? '✓ Copied!' : '⎘ Copy to clipboard'}
          </button>
        </div>
      </div>
    </div>
  );
}
