/**
 * AI MIS Fix Plan endpoint — full Layer-2 scope.
 *
 *  Takes a comprehensive MIS snapshot (readiness, all metric results,
 *  rule violations, financial summary, forecast assumptions + projection,
 *  plan health score) and returns a categorised action plan that lifts
 *  the overall MIS quality across:
 *     • Data setup     — what to upload / configure in Tally
 *     • Financial      — operating levers (revenue / margin / cost)
 *     • Working capital — cash, debtors, creditors, stock
 *     • Compliance     — GST, TDS, MSME, statutory
 *     • Forecast       — assumption tweaks
 *
 *  PII-safe: numbers only.  No party names, voucher details, or raw
 *  ledger data — only aggregates and metric IDs.
 */

import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { getActiveProvider } from '@/lib/ai-config';

function getClient() {
  const p = getActiveProvider();
  return new OpenAI({
    apiKey: p.apiKey,
    baseURL: p.baseURL,
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      for (const key of [...headers.keys()]) {
        if (key.toLowerCase().startsWith('x-stainless') || key.toLowerCase() === 'user-agent') {
          headers.delete(key);
        }
      }
      return fetch(url as RequestInfo, { ...init, headers });
    },
  });
}

const SYSTEM_PROMPT = `You are a CFO advisor for an Indian SMB reviewing a comprehensive MIS report.
You write the way a senior CA / CFO writes — direct, concrete, leverage-ranked,
no fluff.

Your job: produce a categorised action plan that lifts BOTH the readiness score
(coverage of MIS metrics) AND the financial performance (revenue, margin, cash,
compliance) of the company.

CORE RULES:
1. Never invent numbers. Every figure you cite must come from the input JSON.
2. Group findings into THEMES — root causes, not metric IDs. e.g. "Trade
   payables aging is invisible" covers WC6 (creditor aging) + WC8 (MSME 45d)
   + CF10 (committed outflows) all stemming from missing Payables.xml.
3. Rank steps by LEVERAGE = (score lift × impact breadth × confidence) ÷ effort.
   Highest leverage first.  At most 8 steps total.
4. Each step is categorised:
     - "data-setup"  → upload a missing XML, tag ledgers in Tally master, enable
                       cost centres / godowns / stock items
     - "operations"  → real business action (cut DSO, renegotiate vendor terms,
                       hire / freeze, price hike, etc.)
     - "financial"   → assumption tweak the user can preview in Forecast
     - "compliance"  → GST / TDS / MSME / statutory action
     - "reporting"   → ledger reorganisation, separate revenue ledgers per
                       product, etc.
5. Each step has:
     - title         (≤ 70 chars, imperative voice: "Tag MSME vendors in Tally")
     - category      (one of the 5 above)
     - rationale     (2-3 sentences citing input numbers + WHY this matters)
     - resolvesIds   (array of metric IDs from the input.metrics block that
                      this step unlocks or improves; empty array if none)
     - lever         (object — only for "financial" category, OR null)
                     { "assumption": "<key>", "from": <number>, "to": <number> }
                     Assumption keys: revenueGrowthMoM | grossMarginPct |
                     fixedOpsCostMonth | interestMonth | capexMonth | targetDSO
                     Units: decimals (e.g. 0.06 = 6%) for growth / margin,
                     ₹ per month for ops/interest/capex, days for DSO.
     - impact        (1 sentence on what changes: readiness / cash / margin /
                      growth / compliance)
     - effort        ("S" = days, "M" = weeks, "L" = months)
     - tallySteps    (optional 1-4 concrete Tally menu actions when applicable —
                      e.g. "Gateway → Display → Statements of Accounts →
                      Outstandings → Bills Payable → Alt+E → XML")
6. Use Indian SMB context: GST input credit, Section 269ST, MSME 45-day rule,
   DPDPA 2023, GSTR-2B matching, ITC, FY April-March cycle.
7. Be realistic — if revenue grew at 4% historically, don't propose 30%.
   Suggest 6-8%. If gross margin is 25%, don't propose 50%.
8. Don't suggest journal entries with specific rupee amounts.
9. Don't propose more than 8 steps total — quality over quantity.

Also produce:
  - executiveSummary (3-5 sentences setting the plan up — current state,
                      headline opportunity, what success looks like)
  - themes (array of 2-5 root-cause clusters, each with:
            { "title": "Cluster name", "metricIds": ["WC6", "CF10"],
              "explanation": "2-3 sentences on why they cluster" })
  - projectedScoreLift (integer 0-100 — estimated new Plan Health Score if
                        all steps apply)
  - quickWins (array of 1-3 step indices that are "S" effort + high impact —
               for the "Top 3 quick wins" callout box)
  - risks (1-3 short risk strings — what could go wrong)

Return ONLY the JSON.  No preamble, no markdown fencing.`;

interface MisPlanRequest {
  company: { name: string; sector?: string | null };
  // L1 audit results (high-level only)
  audit: {
    overallScore: number;
    grade: string;
    dimScores: Record<string, number>;
  };
  // L2 MIS readiness
  readiness: {
    misScore: number;
    potentialScore: number;
    readinessPct: number;
    computable: number;
    selectedCount: number;
  };
  // Per-metric snapshot (IDs + statuses + headline values, no raw breakdowns)
  metrics: Array<{
    id: string;
    label: string;
    domain: string;
    status: 'computed' | 'partial' | 'missing-data' | 'manual-required' | 'na';
    value?: number | string;
    unit?: string;
    reason?: string;
  }>;
  // Rule violations firing right now
  violations: Array<{
    severity: 'critical' | 'warning' | 'info' | 'positive';
    message: string;
    metricId?: string;
  }>;
  // Current period financial summary
  financials: {
    revenue: number;
    grossProfit: number;
    grossMarginPct: number;
    ebitda: number;
    pat: number;
    patMarginPct: number;
    cashBank: number;
    debtors: number;
    creditors: number;
    closingStock: number;
    fixedAssets: number;
    currentRatio?: number;
    debtEquity?: number;
    dso?: number;
    dpo?: number;
    dio?: number;
  };
  // Forecast snapshot (current assumptions + 3-month projection)
  forecast: {
    assumptions: Record<string, number>;
    projection: Array<{ label: string; revenue: number; pat: number; cashPosition: number }>;
    healthScore: number;
    healthLabel: string;
  };
  // What XML files were / weren't uploaded
  files: {
    uploaded: string[];
    missing: string[];
  };
}

interface PlanStep {
  title: string;
  category: 'data-setup' | 'operations' | 'financial' | 'compliance' | 'reporting';
  rationale: string;
  resolvesIds: string[];
  lever: null | { assumption: string; from: number; to: number };
  impact: string;
  effort: 'S' | 'M' | 'L';
  tallySteps?: string[];
}

interface Theme {
  title: string;
  metricIds: string[];
  explanation: string;
}

interface MisPlanResponse {
  executiveSummary: string;
  themes: Theme[];
  steps: PlanStep[];
  projectedScoreLift: number;
  quickWins: number[];
  risks: string[];
}

const VALID_CATEGORIES = new Set(['data-setup', 'operations', 'financial', 'compliance', 'reporting']);
const VALID_ASSUMPTIONS = new Set(['revenueGrowthMoM', 'grossMarginPct', 'fixedOpsCostMonth', 'interestMonth', 'capexMonth', 'targetDSO']);

function validate(parsed: unknown, validMetricIds: Set<string>): MisPlanResponse {
  const r = (parsed ?? {}) as Partial<MisPlanResponse>;
  const out: MisPlanResponse = {
    executiveSummary: typeof r.executiveSummary === 'string' ? r.executiveSummary : 'Analysis not available.',
    themes: [],
    steps: [],
    projectedScoreLift: typeof r.projectedScoreLift === 'number' && isFinite(r.projectedScoreLift)
      ? Math.max(0, Math.min(100, Math.round(r.projectedScoreLift))) : 0,
    quickWins: [],
    risks: Array.isArray(r.risks) ? r.risks.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
  };

  if (Array.isArray(r.themes)) {
    for (const t of r.themes.slice(0, 6)) {
      if (!t || typeof t.title !== 'string') continue;
      out.themes.push({
        title: t.title.slice(0, 120),
        metricIds: Array.isArray(t.metricIds)
          ? t.metricIds.filter((id): id is string => typeof id === 'string' && validMetricIds.has(id)).slice(0, 12)
          : [],
        explanation: typeof t.explanation === 'string' ? t.explanation : '',
      });
    }
  }

  if (Array.isArray(r.steps)) {
    for (const s of r.steps.slice(0, 8)) {
      if (!s || typeof s.title !== 'string') continue;
      const category = VALID_CATEGORIES.has(s.category) ? s.category as PlanStep['category'] : 'operations';
      let lever: PlanStep['lever'] = null;
      if (s.lever && typeof s.lever === 'object'
          && VALID_ASSUMPTIONS.has((s.lever as { assumption?: string }).assumption ?? '')
          && typeof (s.lever as { from?: number }).from === 'number'
          && typeof (s.lever as { to?: number }).to === 'number'
          && isFinite((s.lever as { from: number }).from)
          && isFinite((s.lever as { to: number }).to)) {
        lever = {
          assumption: (s.lever as { assumption: string }).assumption,
          from: (s.lever as { from: number }).from,
          to: (s.lever as { to: number }).to,
        };
      }
      out.steps.push({
        title: s.title.slice(0, 140),
        category,
        rationale: typeof s.rationale === 'string' ? s.rationale : '',
        resolvesIds: Array.isArray(s.resolvesIds)
          ? s.resolvesIds.filter((id): id is string => typeof id === 'string' && validMetricIds.has(id)).slice(0, 10)
          : [],
        lever,
        impact: typeof s.impact === 'string' ? s.impact : '',
        effort: s.effort === 'S' || s.effort === 'M' || s.effort === 'L' ? s.effort : 'M',
        tallySteps: Array.isArray(s.tallySteps)
          ? s.tallySteps.filter((x): x is string => typeof x === 'string').slice(0, 6)
          : undefined,
      });
    }
  }

  if (Array.isArray(r.quickWins)) {
    out.quickWins = r.quickWins
      .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < out.steps.length)
      .slice(0, 5);
  }

  return out;
}

export async function POST(request: NextRequest) {
  let body: MisPlanRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const provider = getActiveProvider();
  if (!provider.apiKey) {
    return NextResponse.json({
      error: `AI provider "${provider.label}" has no API key configured`,
    }, { status: 503 });
  }

  const validMetricIds = new Set((body.metrics ?? []).map(m => m.id));
  const client = getClient();
  const userPrompt = `MIS snapshot (numbers only — no PII):

${JSON.stringify(body, null, 2)}

Produce the fix plan as structured JSON matching this exact schema:
{
  "executiveSummary": "3-5 sentences framing the plan",
  "themes": [{ "title": "Cluster name", "metricIds": ["..."], "explanation": "..." }],
  "steps": [{
    "title": "imperative ≤ 70 chars",
    "category": "data-setup|operations|financial|compliance|reporting",
    "rationale": "2-3 sentences citing input numbers",
    "resolvesIds": ["metric IDs this step unlocks"],
    "lever": null | { "assumption": "<key>", "from": <number>, "to": <number> },
    "impact": "1 sentence",
    "effort": "S|M|L",
    "tallySteps": ["optional Tally setup steps"]
  }],
  "projectedScoreLift": <integer 0-100>,
  "quickWins": [<step index 0-7>, ...],
  "risks": ["short risk 1", "short risk 2"]
}`;

  try {
    const completion = await client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
      ...(provider.supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    }, { timeout: provider.timeoutMs });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed: unknown;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return NextResponse.json({
        error: 'Model returned non-JSON',
        raw: raw.slice(0, 500),
        detail: err instanceof Error ? err.message : String(err),
      }, { status: 502 });
    }

    return NextResponse.json(validate(parsed, validMetricIds));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      error: `AI provider "${provider.label}" failed: ${message}`,
    }, { status: 502 });
  }
}
