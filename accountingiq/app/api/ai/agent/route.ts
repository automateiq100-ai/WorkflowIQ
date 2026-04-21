import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { DimKey } from '@/lib/types';
import { getActiveProvider } from '@/lib/ai-config';

// Strip X-Stainless-* headers the SDK adds — some proxies/WAFs block them (403).
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

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentRequestBody {
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

interface RawFixTask {
  id: string;
  title: string;
  detail: string;
  tallySteps: string[];
  checkIds: string[];
  effort: 'S' | 'M' | 'L';
  category: string;
}

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior Chartered Accountant in India who also knows Tally Prime deeply.
Your task is to convert accounting check failures into a structured, actionable fix plan for a CA or accountant
who will execute the fixes inside Tally Prime.

CORE RULES:
1. Every task you output must reference specific Tally Prime menu paths — not Tally ERP 9 menus.
   Use the correct Tally Prime navigation: Gateway of Tally → [menu path].
2. Never suggest specific rupee amounts or journal entries with amounts.
3. Each task must map to one or more specific check IDs from the failing/partial findings.
4. Tasks must be ordered by score impact (highest check.max sum first).
5. Maximum 12 tasks. Merge closely related checks into one task.
6. Tally steps must be concrete and numbered — e.g.:
   "1. Gateway of Tally → Chart of Accounts → Ledgers → Alter
    2. Search for the suspense ledger name
    3. Change the group from 'Suspense Account' to the appropriate group
    4. Accept and save"
7. effort values: S = ~15 minutes, M = ~1 hour, L = ~half day
8. category must be one of: Chart of Accounts, Statutory, Data Integrity, Reconciliation, Reporting
9. Do NOT hallucinate check IDs. Only reference checkIds that appear in the failing/partial findings input.
10. Your response is consumed by code — return ONLY valid JSON, no preamble, no markdown.`;

// ── User prompt ────────────────────────────────────────────────────────────

function buildUserPrompt(data: AgentRequestBody): string {
  const failingFindings = data.findings.filter(
    f => f.status === 'fail' || f.status === 'partial' || f.status === 'missing'
  );

  return `Here is the AccountingIQ analysis output for a Tally Prime export.

Overall Score: ${data.score}/100 (Grade: ${data.grade})
${data.dataNotes.scoreCapped ? 'NOTE: Score is capped at 60 because DayBook is missing.' : ''}

FAILING / PARTIAL CHECKS (${failingFindings.length} issues):
${JSON.stringify(failingFindings, null, 2)}

DIMENSION SCORES:
${JSON.stringify(data.dimScores, null, 2)}

COMPANY PROFILE:
${JSON.stringify(data.profile, null, 2)}

Generate a JSON array of fix tasks (max 12). Each task fixes one or more check failures.
Order by estimated score impact (highest first).

Required JSON schema:
[
  {
    "id": "fix-1",
    "title": "Short action title (max 8 words)",
    "detail": "1-2 sentences explaining the problem and why it matters",
    "tallySteps": [
      "1. Gateway of Tally → ...",
      "2. ...",
      "3. ..."
    ],
    "checkIds": ["B1", "B3"],
    "effort": "S|M|L",
    "category": "Chart of Accounts|Statutory|Data Integrity|Reconciliation|Reporting"
  }
]

Return ONLY the JSON array. No wrapper object, no preamble, no markdown fencing.`;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateTasks(
  tasks: RawFixTask[],
  input: AgentRequestBody,
  checkMaxMap: Map<string, number>
): Array<RawFixTask & { estimatedScoreGain: number; status: 'todo' }> {
  const validIds = new Set(input.findings.map(f => f.id));
  const VALID_EFFORTS = new Set(['S', 'M', 'L']);
  const VALID_CATEGORIES = new Set(['Chart of Accounts', 'Statutory', 'Data Integrity', 'Reconciliation', 'Reporting']);

  return tasks
    .filter(t => t.id && t.title && Array.isArray(t.tallySteps))
    .slice(0, 12)
    .map((t, i) => {
      // Strip phantom check IDs
      const cleanCheckIds = (t.checkIds ?? []).filter(id => validIds.has(id));
      // Compute score gain server-side from check.max values (never from AI)
      const estimatedScoreGain = cleanCheckIds.reduce((sum, id) => sum + (checkMaxMap.get(id) ?? 0), 0);

      return {
        ...t,
        id: t.id || `fix-${i + 1}`,
        checkIds: cleanCheckIds,
        effort: VALID_EFFORTS.has(t.effort) ? t.effort : 'M',
        category: VALID_CATEGORIES.has(t.category) ? t.category : 'Data Integrity',
        tallySteps: (t.tallySteps ?? []).slice(0, 10),
        estimatedScoreGain,
        status: 'todo' as const,
      };
    })
    .sort((a, b) => b.estimatedScoreGain - a.estimatedScoreGain);
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const provider = getActiveProvider();
  if (!provider.apiKey) {
    return NextResponse.json(
      { error: `API key not configured for provider "${provider.label}". Check .env.local.` },
      { status: 500 },
    );
  }

  try {
    const body: AgentRequestBody = await req.json();

    // Build check max map for server-side score gain computation
    const checkMaxMap = new Map<string, number>(
      body.findings.map(f => [f.id, f.max])
    );

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

    // Strip markdown fences that some models add
    const jsonStr = extractJSON(rawContent);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (process.env.NODE_ENV === 'development') {
        return NextResponse.json({ error: 'AI response was not valid JSON', raw: rawContent }, { status: 500 });
      }
      return NextResponse.json({ error: 'Fix plan generation failed — invalid response format' }, { status: 500 });
    }

    // GPT sometimes wraps the array in an object with a key like "tasks" or "fixTasks"
    let tasksArr: RawFixTask[];
    if (Array.isArray(parsed)) {
      tasksArr = parsed as RawFixTask[];
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const arrKey = Object.keys(obj).find(k => Array.isArray(obj[k]));
      tasksArr = arrKey ? (obj[arrKey] as RawFixTask[]) : [];
    } else {
      tasksArr = [];
    }

    const validated = validateTasks(tasksArr, body, checkMaxMap);
    return NextResponse.json({ tasks: validated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Strip ```json ... ``` fences that some models add despite instructions */
function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}
