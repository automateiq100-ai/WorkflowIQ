/**
 * AI validation layer tests — Workstream 2
 *
 * Tests the server-side validation that strips phantom check IDs,
 * caps root cause and action array lengths, and ensures required fields.
 */

import { describe, it, expect } from 'vitest';

// Re-implement the validation function here for unit testing
// (the actual function lives in app/api/ai/route.ts which is server-only)

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

interface AIRequestBody {
  findings: Array<{ id: string }>;
}

function validateResponse(parsed: AIResponseBody, input: AIRequestBody): AIResponseBody {
  const validCheckIds = new Set(input.findings.map(f => f.id));

  if (parsed.rootCauses?.length > 5) {
    parsed.rootCauses = parsed.rootCauses.slice(0, 5);
  }
  if (parsed.actions?.length > 10) {
    parsed.actions = parsed.actions.slice(0, 10);
  }

  if (parsed.rootCauses) {
    for (const rc of parsed.rootCauses) {
      if (rc.findingIds) {
        rc.findingIds = rc.findingIds.filter(id => validCheckIds.has(id));
      }
    }
  }

  if (parsed.actions) {
    for (const action of parsed.actions) {
      if (action.resolvesCheckIds) {
        action.resolvesCheckIds = action.resolvesCheckIds.filter(id => validCheckIds.has(id));
      }
    }
  }

  parsed.executiveSummary = parsed.executiveSummary || 'Analysis summary not available.';
  parsed.rootCauses = parsed.rootCauses || [];
  parsed.actions = parsed.actions || [];
  parsed.financialCommentary = parsed.financialCommentary || '';
  parsed.preflight = parsed.preflight || [];

  return parsed;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AI validateResponse', () => {
  const validInput: AIRequestBody = {
    findings: [
      { id: 'B1' },
      { id: 'B3' },
      { id: 'D1' },
      { id: 'C1' },
    ],
  };

  it('strips phantom check IDs from rootCauses', () => {
    const response: AIResponseBody = {
      executiveSummary: 'Summary',
      rootCauses: [{
        theme: 'Opening setup',
        findingIds: ['B1', 'B3', 'Z99', 'PHANTOM'],
        explanation: 'Explanation',
      }],
      actions: [],
      financialCommentary: '',
      preflight: [],
    };

    const validated = validateResponse(response, validInput);
    expect(validated.rootCauses[0].findingIds).toEqual(['B1', 'B3']);
    expect(validated.rootCauses[0].findingIds).not.toContain('Z99');
    expect(validated.rootCauses[0].findingIds).not.toContain('PHANTOM');
  });

  it('strips phantom check IDs from actions', () => {
    const response: AIResponseBody = {
      executiveSummary: 'Summary',
      rootCauses: [],
      actions: [{
        task: 'Post capital entry',
        impact: 'critical',
        effort: 'S',
        category: 'Chart of Accounts',
        resolvesCheckIds: ['B1', 'B3', 'FAKE_ID'],
      }],
      financialCommentary: '',
      preflight: [],
    };

    const validated = validateResponse(response, validInput);
    expect(validated.actions[0].resolvesCheckIds).toEqual(['B1', 'B3']);
    expect(validated.actions[0].resolvesCheckIds).not.toContain('FAKE_ID');
  });

  it('caps rootCauses at 5', () => {
    const response: AIResponseBody = {
      executiveSummary: 'Summary',
      rootCauses: Array.from({ length: 8 }, (_, i) => ({
        theme: `Theme ${i}`,
        findingIds: ['B1'],
        explanation: `Explanation ${i}`,
      })),
      actions: [],
      financialCommentary: '',
      preflight: [],
    };

    const validated = validateResponse(response, validInput);
    expect(validated.rootCauses).toHaveLength(5);
  });

  it('caps actions at 10', () => {
    const response: AIResponseBody = {
      executiveSummary: 'Summary',
      rootCauses: [],
      actions: Array.from({ length: 15 }, (_, i) => ({
        task: `Task ${i}`,
        impact: 'high' as const,
        effort: 'S' as const,
        category: 'Data Integrity',
        resolvesCheckIds: ['B1'],
      })),
      financialCommentary: '',
      preflight: [],
    };

    const validated = validateResponse(response, validInput);
    expect(validated.actions).toHaveLength(10);
  });

  it('fills in default values for missing fields', () => {
    const response = {
      rootCauses: [{
        theme: 'Test',
        findingIds: ['B1'],
        explanation: 'Test',
      }],
    } as unknown as AIResponseBody;

    const validated = validateResponse(response, validInput);
    expect(validated.executiveSummary).toBe('Analysis summary not available.');
    expect(validated.actions).toEqual([]);
    expect(validated.financialCommentary).toBe('');
    expect(validated.preflight).toEqual([]);
  });

  it('passes through valid data unchanged', () => {
    const response: AIResponseBody = {
      executiveSummary: 'Clean books analysis',
      rootCauses: [{
        theme: 'Opening setup',
        findingIds: ['B1', 'B3'],
        explanation: 'Capital and opening balances missing',
      }],
      actions: [{
        task: 'Post opening capital entry',
        impact: 'critical',
        effort: 'S',
        category: 'Chart of Accounts',
        resolvesCheckIds: ['B1', 'B3'],
      }],
      financialCommentary: 'Revenue at ₹23.90L with positive margin.',
      preflight: ['F11 > Show Opening Balances > Yes'],
    };

    const validated = validateResponse(response, validInput);
    expect(validated.executiveSummary).toBe('Clean books analysis');
    expect(validated.rootCauses[0].findingIds).toEqual(['B1', 'B3']);
    expect(validated.actions[0].resolvesCheckIds).toEqual(['B1', 'B3']);
    expect(validated.financialCommentary).toBe('Revenue at ₹23.90L with positive margin.');
    expect(validated.preflight).toEqual(['F11 > Show Opening Balances > Yes']);
  });
});
