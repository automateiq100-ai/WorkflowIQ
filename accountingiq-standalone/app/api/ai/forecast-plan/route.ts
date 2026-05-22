/**
 * AI Forecast Fix Plan endpoint.
 *
 *  Takes the user's current MIS snapshot + their custom plan assumptions +
 *  the plan-health score breakdown, and returns a structured 3–6-step
 *  action plan to lift the Plan Health Score.  Reuses the same provider
 *  config (workflowiq / openai) as the L1 audit-analysis route.
 *
 *  No PII (no party names, voucher details, etc.).  Numbers only.
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

const SYSTEM_PROMPT = `You are a CFO advisor for an Indian SMB reviewing a 3-month MIS forecast plan.

Your job: produce a concise, concrete action plan to lift the user's "Plan Health Score"
to ≥ 75 over the next quarter.  The user runs a Tally-based business in India.

CORE RULES:
1. Never invent numbers.  Every figure you cite must come from the input JSON.
2. Each action must specify EXACTLY which assumption it moves and to what value.
   The forecast model accepts these assumption keys (units in parentheses):
     - revenueGrowthMoM    (decimal, e.g. 0.06 = +6% per month)
     - grossMarginPct      (decimal, e.g. 0.40 = 40%)
     - fixedOpsCostMonth   (₹ per month — salary + rent + admin recurring)
     - interestMonth       (₹ per month)
     - capexMonth          (₹ per month — investing cash outflow)
     - targetDSO           (days — debtor collection lag)
3. Plan steps must be ranked by leverage = (score lift × confidence) ÷ effort.
   Highest leverage first.  Don't propose more than 6 steps.
4. Each step has:
     - title       (≤ 60 chars, imperative voice: "Cut DSO by 10 days")
     - rationale   (2-3 sentences citing the input numbers and WHY this helps)
     - lever       (object — the assumption it moves, OR null if it's an
                    operational change that needs Tally action rather than
                    an assumption tweak)
                   {
                     "assumption": "revenueGrowthMoM" | "grossMarginPct" |
                                   "fixedOpsCostMonth" | "interestMonth" |
                                   "capexMonth" | "targetDSO",
                     "from": number,
                     "to": number
                   }
     - impact      (1 sentence — which health-score bucket this moves:
                    cash runway / margin / growth realism / PAT trajectory)
     - effort      ("S" = days, "M" = weeks, "L" = months)
     - tallySteps  (optional array of 1-3 concrete Tally menu actions IF
                    the user needs to set up data tracking for the change —
                    e.g. "Create separate revenue ledger per product")
5. The user has already entered ledgers in Tally — your steps should
   leverage existing data, not require massive new setup.
6. Be realistic.  If revenue grew at 4% historically, don't propose 30%.
   Suggest 6–8%.  If gross margin is 25%, don't propose 50%.
7. Use Indian SMB context — GST input credit, cash limits (Section 40A(3): cash expense >₹10k/day disallowed; Section 269ST: cash receipts ≥₹2L barred),
   MSME 45-day rule, DPDPA, vendor advances, etc.

Also produce:
  - executiveSummary (3-4 sentences setting the plan up)
  - projectedScoreLift (estimated new Plan Health Score if all steps apply,
    0-100, integer)
  - risks (1-3 short risk strings — what could go wrong with this plan)

Return ONLY the JSON, no preamble, no markdown.`;

interface ForecastPlanRequest {
  /** Current state of the books and projection. */
  current: {
    revenue: number;
    grossProfitPct: number;
    ebitda: number;
    pat: number;
    patMarginPct: number;
    cashPosition: number;
    debtors: number;
    creditors: number;
    closingStock: number;
  };
  /** Assumptions the forecast is using right now. */
  assumptions: {
    revenueGrowthMoM: number;
    grossMarginPct: number;
    fixedOpsCostMonth: number;
    interestMonth: number;
    capexMonth: number;
    targetDSO: number;
  };
  /** The 3 projected months under those assumptions. */
  projection: Array<{
    label: string;
    revenue: number;
    pat: number;
    cashPosition: number;
    grossProfitPct: number;
  }>;
  /** Health score breakdown. */
  health: {
    score: number;
    label: string;
    cashPositiveMonths: number;
    avgPatMarginPct: number;
    growthDeltaPct: number;
    patTrendingUp: boolean;
  };
  /** Optional sector context (Trading / Manufacturing / Services / ...). */
  sector?: string | null;
  /** Optional historical reference for realism checks. */
  history?: {
    avgMoMGrowthPct: number;
    avgGrossMarginPct: number;
    monthsTracked: number;
  };
}

interface PlanStep {
  title: string;
  rationale: string;
  lever: null | {
    assumption: 'revenueGrowthMoM' | 'grossMarginPct' | 'fixedOpsCostMonth' | 'interestMonth' | 'capexMonth' | 'targetDSO';
    from: number;
    to: number;
  };
  impact: string;
  effort: 'S' | 'M' | 'L';
  tallySteps?: string[];
}

interface ForecastPlanResponse {
  executiveSummary: string;
  steps: PlanStep[];
  projectedScoreLift: number;
  risks: string[];
}

const VALID_ASSUMPTIONS = new Set(['revenueGrowthMoM', 'grossMarginPct', 'fixedOpsCostMonth', 'interestMonth', 'capexMonth', 'targetDSO']);

function validate(parsed: unknown): ForecastPlanResponse {
  const r = (parsed ?? {}) as Partial<ForecastPlanResponse>;
  const out: ForecastPlanResponse = {
    executiveSummary: typeof r.executiveSummary === 'string' ? r.executiveSummary : 'Plan summary not available.',
    steps: [],
    projectedScoreLift: typeof r.projectedScoreLift === 'number' && isFinite(r.projectedScoreLift)
      ? Math.max(0, Math.min(100, Math.round(r.projectedScoreLift))) : 0,
    risks: Array.isArray(r.risks) ? r.risks.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
  };
  if (Array.isArray(r.steps)) {
    for (const s of r.steps.slice(0, 6)) {
      if (!s || typeof s.title !== 'string') continue;
      // Validate lever
      let lever: PlanStep['lever'] = null;
      if (s.lever && typeof s.lever === 'object' && VALID_ASSUMPTIONS.has(s.lever.assumption)
          && typeof s.lever.from === 'number' && typeof s.lever.to === 'number'
          && isFinite(s.lever.from) && isFinite(s.lever.to)) {
        lever = { assumption: s.lever.assumption, from: s.lever.from, to: s.lever.to };
      }
      out.steps.push({
        title: s.title.slice(0, 120),
        rationale: typeof s.rationale === 'string' ? s.rationale : '',
        lever,
        impact: typeof s.impact === 'string' ? s.impact : '',
        effort: s.effort === 'S' || s.effort === 'M' || s.effort === 'L' ? s.effort : 'M',
        tallySteps: Array.isArray(s.tallySteps) ? s.tallySteps.filter((x): x is string => typeof x === 'string').slice(0, 5) : undefined,
      });
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  let body: ForecastPlanRequest;
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

  const client = getClient();
  const userPrompt = `Plan input (numbers only — no PII):

${JSON.stringify(body, null, 2)}

Produce the fix plan as structured JSON matching this schema exactly:
{
  "executiveSummary": "3-4 sentences framing the plan",
  "steps": [{
    "title": "imperative ≤ 60 chars",
    "rationale": "2-3 sentences citing input numbers",
    "lever": null | { "assumption": "<key>", "from": <number>, "to": <number> },
    "impact": "1 sentence — which health bucket this lifts",
    "effort": "S" | "M" | "L",
    "tallySteps": ["optional Tally setup action 1", "..."]
  }],
  "projectedScoreLift": <integer 0-100>,
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
      // Strip fences if the model wrapped them despite instructions.
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return NextResponse.json({
        error: 'Model returned non-JSON',
        raw: raw.slice(0, 500),
        detail: err instanceof Error ? err.message : String(err),
      }, { status: 502 });
    }

    return NextResponse.json(validate(parsed));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      error: `AI provider "${provider.label}" failed: ${message}`,
    }, { status: 502 });
  }
}
