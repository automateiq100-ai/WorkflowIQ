/**
 * AI Provider Configuration — AccountingIQ
 * ─────────────────────────────────────────
 * To switch providers at any time, change ACTIVE_AI_PROVIDER below.
 * You can also set the env variable ACTIVE_AI_PROVIDER in .env.local to
 * override without touching code (requires server restart).
 *
 * To add a new provider: add an entry to AI_PROVIDERS with all fields filled.
 */

// ── Provider registry ──────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'workflowiq';

export interface AIProviderConfig {
  /** Human-readable label shown in logs */
  label: string;
  /** Base URL for the OpenAI-compatible API */
  baseURL: string;
  /** API key — read from env so secrets stay out of source code */
  apiKey: string;
  /** Model name to pass in the API request */
  model: string;
  /**
   * Whether to pass `response_format: { type: 'json_object' }`.
   * Set false if the backend doesn't support this parameter.
   * The system prompt still instructs the model to return JSON either way.
   */
  supportsJsonMode: boolean;
  /** max_tokens for the completion request */
  maxTokens: number;
  /** temperature (0 = deterministic, 1 = creative) */
  temperature: number;
  /** fetch timeout in ms — local/proxied models need more time than hosted APIs */
  timeoutMs: number;
}

export const AI_PROVIDERS: Record<AIProvider, AIProviderConfig> = {
  openai: {
    label: 'OpenAI GPT-4o',
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: 'gpt-4o',
    supportsJsonMode: true,
    maxTokens: 2500,
    temperature: 0.2,
    timeoutMs: 30_000,
  },

  workflowiq: {
    label: 'Gemma 4 · 🇮🇳 India',
    baseURL: process.env.WORKFLOWIQ_BASE_URL ?? 'https://api.workflowiq.in/v1',
    apiKey: process.env.WORKFLOWIQ_API_KEY ?? '',
    model: process.env.WORKFLOWIQ_MODEL ?? 'gemma4:e4b',
    supportsJsonMode: false,  // Gemma via local proxy — skip response_format param
    maxTokens: 4096,
    temperature: 0.2,
    timeoutMs: 180_000,       // 3 min — local Gemma is slower than hosted APIs
  },
};

// ── ACTIVE PROVIDER ────────────────────────────────────────────────────────
// Change this one line to switch providers:
//   'workflowiq'  →  WorkflowIQ Gemma 4 (India-resident, default)
//   'openai'      →  OpenAI GPT-4o
//
// Or set  ACTIVE_AI_PROVIDER=openai  in .env.local to override without editing code.

export const ACTIVE_AI_PROVIDER: AIProvider =
  (process.env.ACTIVE_AI_PROVIDER as AIProvider | undefined) ?? 'workflowiq';

// ── Helper ─────────────────────────────────────────────────────────────────

export function getActiveProvider(): AIProviderConfig {
  const cfg = AI_PROVIDERS[ACTIVE_AI_PROVIDER];
  if (!cfg) throw new Error(`Unknown AI provider: "${ACTIVE_AI_PROVIDER}"`);
  return cfg;
}
