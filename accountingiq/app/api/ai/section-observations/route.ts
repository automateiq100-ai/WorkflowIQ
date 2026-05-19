/**
 * AI Section Observations endpoint.
 *
 *  Powers the per-tab "AI Observations" panel at the bottom of every MIS
 *  report page (P&L, Cash Flow, Balance Sheet, Working Capital, Cost
 *  Analysis, Business Performance, Statutory, Forecast, Executive Summary).
 *
 *  Takes the section name + filtered metric list + headline financials and
 *  returns 3-5 short, conversational observations specific to that section.
 *  Reuses the same provider config (workflowiq / openai) as the other AI
 *  endpoints.  PII-safe.
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

const SYSTEM_PROMPT = `You are a CFO advisor for an Indian SMB writing a short insights panel for a single
section of an MIS report (P&L, Cash Flow, Balance Sheet, Working Capital, Cost Analysis,
Business Performance, Statutory, Forecast, or Executive Summary).

Your output has TWO blocks:
  A) observations  — 3-5 sharp, conversational readings of the data
  B) fixSteps      — 2-5 ranked, concrete actions to improve this section's health

Tone is direct and unembellished — the way one CA writes to another.

CORE RULES:
1. Never invent numbers.  Every figure you cite must come from the input.
2. Stay SPECIFIC to the section provided — don't drift across sections.
   (E.g. on Balance Sheet don't talk about marketing spend; on Working Capital
   don't talk about EBITDA.)
3. Use Indian SMB context — GST input credit, MSME 45-day rule, Section 269ST,
   DPDPA, GSTR-2B, where relevant.
4. NEVER suggest specific journal entries with rupee amounts.
5. No preamble like "Here are observations" — go straight to the points.

OBSERVATIONS:
6. Mix factual readings ("Debtors at ₹12.05L is X% of revenue") with implication
   sentences ("This translates to ~410-day DSO — well above the 45-day norm").
7. Tag each observation as one of:
     - "positive"  → something going well
     - "risk"      → red-flag / breach / unsustainable trend
     - "note"      → factual reading, neither good nor bad
8. Each observation is one or two sentences.  Be punchy.
9. If a metric has status "missing-data" or "partial", flag the data gap rather
   than the value ("Bills.xml not uploaded — exact aging not visible").

FIX STEPS:
10. Each step is one concrete, actionable item that improves THIS section's
    health.  Rank by leverage = (impact × confidence) ÷ effort.  At most 5
    steps; quality over quantity.  Omit if section is already healthy and
    needs no fixing — return an empty array.
11. Each step has:
     - title       (≤ 70 chars, imperative voice — "Cut DSO by 10 days")
     - category    ("data-setup" | "operations" | "financial" |
                    "compliance" | "reporting")
     - rationale   (2-3 sentences citing input numbers + WHY this helps)
     - impact      (1 sentence on the expected outcome)
     - effort      ("S" = days, "M" = weeks, "L" = months)
     - tallySteps  (optional 1-3 concrete Tally menu actions when applicable)
12. Be realistic — if revenue grew at 4% historically, don't propose 30%.

Return ONLY the JSON, no preamble, no markdown.`;

interface SectionObservationsRequest {
  section: string;
  /** Metric snapshot filtered to this section's domain. */
  metrics: Array<{
    id: string;
    label: string;
    status: 'computed' | 'partial' | 'missing-data' | 'manual-required' | 'na';
    value?: number | string;
    unit?: string;
    reason?: string;
  }>;
  /** Headline financials for context. */
  financials?: Record<string, number | undefined>;
  /** Rule violations firing in this section. */
  violations?: Array<{
    severity: string;
    message: string;
    metricId?: string;
  }>;
  /** Optional sector for industry context. */
  sector?: string | null;
}

interface SectionObservation {
  type: 'positive' | 'risk' | 'note';
  text: string;
}

interface SectionFixStep {
  title: string;
  category: 'data-setup' | 'operations' | 'financial' | 'compliance' | 'reporting';
  rationale: string;
  impact: string;
  effort: 'S' | 'M' | 'L';
  tallySteps?: string[];
}

interface SectionObservationsResponse {
  observations: SectionObservation[];
  fixSteps: SectionFixStep[];
}

const VALID_TYPES = new Set<SectionObservation['type']>(['positive', 'risk', 'note']);
const VALID_CATEGORIES = new Set<SectionFixStep['category']>([
  'data-setup', 'operations', 'financial', 'compliance', 'reporting',
]);

function validate(parsed: unknown): SectionObservationsResponse {
  const r = (parsed ?? {}) as Partial<SectionObservationsResponse>;
  const observations: SectionObservation[] = [];
  if (Array.isArray(r.observations)) {
    for (const o of r.observations.slice(0, 6)) {
      if (!o || typeof o.text !== 'string') continue;
      const type = VALID_TYPES.has(o.type) ? o.type as SectionObservation['type'] : 'note';
      observations.push({ type, text: o.text.slice(0, 500) });
    }
  }
  const fixSteps: SectionFixStep[] = [];
  if (Array.isArray(r.fixSteps)) {
    for (const s of r.fixSteps.slice(0, 6)) {
      if (!s || typeof s.title !== 'string') continue;
      fixSteps.push({
        title: s.title.slice(0, 140),
        category: VALID_CATEGORIES.has(s.category) ? s.category as SectionFixStep['category'] : 'operations',
        rationale: typeof s.rationale === 'string' ? s.rationale.slice(0, 600) : '',
        impact: typeof s.impact === 'string' ? s.impact.slice(0, 300) : '',
        effort: s.effort === 'S' || s.effort === 'M' || s.effort === 'L' ? s.effort : 'M',
        tallySteps: Array.isArray(s.tallySteps)
          ? s.tallySteps.filter((x): x is string => typeof x === 'string').slice(0, 5)
          : undefined,
      });
    }
  }
  return { observations, fixSteps };
}

export async function POST(request: NextRequest) {
  let body: SectionObservationsRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.section || !Array.isArray(body.metrics)) {
    return NextResponse.json({ error: 'Missing section or metrics' }, { status: 400 });
  }

  const provider = getActiveProvider();
  if (!provider.apiKey) {
    return NextResponse.json({
      error: `AI provider "${provider.label}" has no API key configured`,
    }, { status: 503 });
  }

  const client = getClient();
  const userPrompt = `Section: ${body.section}

Input (numbers only — no PII):

${JSON.stringify(body, null, 2)}

Produce the insights as structured JSON matching this exact schema:
{
  "observations": [
    { "type": "positive" | "risk" | "note", "text": "1-2 sentence observation citing input numbers" }
  ],
  "fixSteps": [
    {
      "title": "imperative ≤ 70 chars",
      "category": "data-setup" | "operations" | "financial" | "compliance" | "reporting",
      "rationale": "2-3 sentences citing input numbers + why this helps",
      "impact": "1 sentence on expected outcome",
      "effort": "S" | "M" | "L",
      "tallySteps": ["optional Tally action 1"]
    }
  ]
}

Produce 3-5 observations and 2-5 fix steps specific to "${body.section}".  Empty fixSteps is fine if the section is already healthy.`;

  try {
    const completion = await client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1500,
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

    return NextResponse.json(validate(parsed));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      error: `AI provider "${provider.label}" failed: ${message}`,
    }, { status: 502 });
  }
}
