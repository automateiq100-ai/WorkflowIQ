import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { DIM_LABELS } from '@/lib/constants';
import type { DimKey } from '@/lib/types';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface AIRequest {
  score: number;
  grade: string;
  dimScores: Record<DimKey, number>;
  topIssues: { id: string; name: string; note: string }[];
  financials: {
    revenue: number;
    netProfit: number;
    suspenseBalance: number;
    currentRatio: number | null;
  };
}

function fmtINR(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function buildPrompt(data: AIRequest): string {
  const dims = (Object.entries(data.dimScores) as [DimKey, number][])
    .map(([k, v]) => `  ${k}. ${DIM_LABELS[k]}: ${v.toFixed(0)}/100`)
    .join('\n');

  const issues = data.topIssues.length
    ? data.topIssues.map(i => `  - [${i.id}] ${i.name}: ${i.note}`).join('\n')
    : '  None';

  const { revenue, netProfit, suspenseBalance, currentRatio } = data.financials;

  return `You are an accounting quality analyst reviewing Indian business books (Tally ERP).
A rule-based engine has produced the following health check results.

OVERALL SCORE: ${data.score}/100 (Grade ${data.grade})

DIMENSION SCORES:
${dims}

TOP FAILING CHECKS:
${issues}

KEY FINANCIALS:
  Revenue: ${fmtINR(revenue)}
  Net Profit: ${fmtINR(netProfit)}
  Suspense Balance: ${fmtINR(suspenseBalance)}
  Current Ratio: ${currentRatio !== null ? currentRatio : 'N/A'}

Based on the above, return a JSON object with exactly these three fields:
{
  "summary": "2-3 sentence plain-English executive summary of the accounting health",
  "priorities": ["top action item 1", "top action item 2", "top action item 3"],
  "observation": "one specific, data-driven observation about an unusual pattern or key risk"
}
Be concise and specific to the numbers shown. Use Indian accounting context where relevant.`;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  try {
    const body: AIRequest = await req.json();

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: buildPrompt(body) }],
      response_format: { type: 'json_object' },
      max_tokens: 600,
    });

    const result = JSON.parse(response.choices[0].message.content!);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
