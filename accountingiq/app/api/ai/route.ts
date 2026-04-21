import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { DimKey } from '@/lib/types';
import { getActiveProvider } from '@/lib/ai-config';

// Build client from the active provider config.
// For non-OpenAI providers the SDK injects X-Stainless-* headers that some
// proxies/WAFs block with a 403. We pass a custom fetch that strips them.
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

// ── System prompt — kept exactly as specified ──────────────────────────────

const SYSTEM_PROMPT = `You are a senior Chartered Accountant in India reviewing AccountingIQ output for a client's
Tally books. Your tone is direct, unembellished, and actionable. You write the way a CA
writes to another CA, not to a consumer.

CORE RULES:
1. Never invent numbers. Every rupee figure you mention must come from the input JSON.
   If asked implicitly to reference a figure not in the data, omit it.
2. Never suggest specific journal entries with rupee amounts. You can say "reclassify
   the suspense balance against Capital Account" but never "Dr Suspense 20,98,400
   Cr Capital 20,98,400". You are explaining findings, not doing the accounting.
3. Group findings by root cause, not by check ID. If B1 (suspense) + B3 (no capital)
   + D-failures cluster together, that's one cluster called "Incomplete opening setup",
   not three.
4. Use Indian accounting context: GST (CGST/SGST/IGST), TDS, Schedule III, Section 269ST,
   DPDPA 2023, GSTR-2B matching, ITC. Don't explain these acronyms unless a check's
   failure hinges on them.
5. Action items are sorted by leverage = (impact weight × number of checks resolved)
   divided by effort. Highest leverage first.
6. Financial commentary only discusses metrics present in the input. Do not fabricate
   ratios or trends the input does not support. Single-period data does not support
   trend commentary.
7. Preflight is specifically actions in Tally — "F11 > Show Opening Balances > Yes",
   "Re-export Trial Balance after posting capital entry", etc. Not actions in AccountingIQ.

Return ONLY the JSON. No preamble, no markdown fencing.`;

// ── Request/Response types matching lib/types.ts ──────────────────────────

interface AIRequestBody {
  score: number;
  grade: string;
  dimScores: Record<DimKey, number>;
  findings: Array<{
    id: string;
    dim: DimKey;
    name: string;
    status: string;
    note: string;
    max: number;
  }>;
  financials: {
    revenue: number;
    netProfit: number;
    currentAssets: number;
    currentLiabilities: number;
    bankBalance: number;
    debtorBalance: number;
    creditorBalance: number;
    suspenseBalance: number;
    fixedAssets: number;
    closingStock: number;
  };
  profile: Record<string, boolean>;
  dataNotes: {
    filesUploaded: number;
    dayBookVoucherCount: number;
    distinctMonthsInData: number;
    scoreCapped: boolean;
  };
}

interface AIResponseBody {
  executiveSummary: string;
  rootCauses: Array<{
    theme: string;
    findingIds: string[];
    explanation: string;
  }>;
  actions: Array<{
    task: string;
    impact: 'critical' | 'high' | 'medium' | 'low';
    effort: 'S' | 'M' | 'L';
    category: string;
    resolvesCheckIds: string[];
  }>;
  financialCommentary: string;
  preflight: string[];
}

// ── Validation layer ──────────────────────────────────────────────────────

function validateResponse(parsed: AIResponseBody, input: AIRequestBody): AIResponseBody {
  const validCheckIds = new Set(input.findings.map(f => f.id));

  // Cap arrays
  if (parsed.rootCauses?.length > 5) {
    parsed.rootCauses = parsed.rootCauses.slice(0, 5);
  }
  if (parsed.actions?.length > 10) {
    parsed.actions = parsed.actions.slice(0, 10);
  }

  // Strip phantom check IDs from rootCauses
  if (parsed.rootCauses) {
    for (const rc of parsed.rootCauses) {
      if (rc.findingIds) {
        rc.findingIds = rc.findingIds.filter(id => validCheckIds.has(id));
      }
    }
  }

  // Strip phantom check IDs from actions
  if (parsed.actions) {
    for (const action of parsed.actions) {
      if (action.resolvesCheckIds) {
        action.resolvesCheckIds = action.resolvesCheckIds.filter(id => validCheckIds.has(id));
      }
    }
  }

  // Ensure required fields exist with defaults
  parsed.executiveSummary = parsed.executiveSummary || 'Analysis summary not available.';
  parsed.rootCauses = parsed.rootCauses || [];
  parsed.actions = parsed.actions || [];
  parsed.financialCommentary = parsed.financialCommentary || '';
  parsed.preflight = parsed.preflight || [];

  return parsed;
}

// ── Build user prompt ─────────────────────────────────────────────────────

function buildUserPrompt(data: AIRequestBody): string {
  return `Here is the analysis output JSON:

${JSON.stringify(data, null, 2)}

Generate the five-section report as structured JSON matching this schema:
{
  "executiveSummary": "2-4 sentence plain-English executive summary",
  "rootCauses": [{"theme": "string", "findingIds": ["check IDs"], "explanation": "2-3 sentences"}],
  "actions": [{"task": "string", "impact": "critical|high|medium|low", "effort": "S|M|L", "category": "Chart of Accounts|Statutory|Data Integrity|Reconciliation|Reporting", "resolvesCheckIds": ["check IDs"]}],
  "financialCommentary": "3-5 sentences about the financial metrics",
  "preflight": ["3-5 Tally-specific actions before re-running"]
}`;
}

// ── API route handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const provider = getActiveProvider();
  if (!provider.apiKey) {
    return NextResponse.json(
      { error: `API key not configured for provider "${provider.label}". Check .env.local.` },
      { status: 500 },
    );
  }

  try {
    const body: AIRequestBody = await req.json();
    const client = getClient();

    const response = await client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(body) },
      ],
      ...(provider.supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
    });

    const rawContent = response.choices[0].message.content!;

    // Extract JSON — strip markdown fences if the model wraps it
    const jsonStr = extractJSON(rawContent);

    let parsed: AIResponseBody;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (process.env.NODE_ENV === 'development') {
        return NextResponse.json({ error: 'AI response was not valid JSON', raw: rawContent }, { status: 500 });
      }
      return NextResponse.json({ error: 'AI analysis failed — invalid response format' }, { status: 500 });
    }

    const validated = validateResponse(parsed, body);
    return NextResponse.json(validated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Robustly extract JSON from model output that may contain reasoning blocks or markdown fences */
function extractJSON(raw: string): string {
  // 1. Strip <think>...</think> reasoning blocks (Gemma chain-of-thought)
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // 2. Strip markdown fences
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // 3. Extract first complete JSON object or array (handles preamble/postamble)
  const objMatch = s.match(/(\{[\s\S]*\})/);
  if (objMatch) return objMatch[1].trim();
  const arrMatch = s.match(/(\[[\s\S]*\])/);
  if (arrMatch) return arrMatch[1].trim();
  return s;
}
