# AccountingIQ

Standalone **Tally XML accounting health analyser** for Indian businesses. Parses
Tally ERP/Prime XML exports, runs 60 rule-based compliance and accuracy checks
across 8 dimensions, and produces a 0–100 quality score with actionable insights,
an MIS report layer, an optional Tally bridge connector, and AI-powered analysis.

This is the standalone extraction of AccountingIQ from the WorkFlowIQ portal. It
has its own authentication and runs as a self-contained Next.js application — it
no longer depends on the portal, PracticeIQ, or ResearchIQ.

## Tech stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, Tailwind CSS v4
- **Language**: TypeScript 5
- **Auth**: Supabase email/password (sign up, sign in, forgot/reset password)
- **AI**: OpenAI GPT-4o or a WorkflowIQ Gemma endpoint (configurable)

## Authentication

AccountingIQ has its own auth, independent of the WorkFlowIQ portal:

- Email + password **sign in** and **sign up** (`/login`).
- **Forgot password** (`/forgot-password`) → emailed reset link → **set new
  password** (`/reset-password`).
- No OAuth, no magic links, no portal tool-selector.

It reuses the same Supabase project but stores its profiles in its own
`accountingiq_users` table — it never reads or writes the portal's
`workflowiq_clients`.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in your Supabase + AI keys.
3. Apply the database schema once (Supabase SQL editor or `supabase db push`):
   ```
   supabase/schema.sql
   ```
   In the Supabase dashboard, set the email/password provider to enabled and add
   this app's URL (and `/auth/callback`) to the allowed redirect URLs.
4. Run the dev server:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

To run locally without auth, set `DEV_BYPASS_AUTH=true` in `.env.local` (never in
production).

## Environment variables

See `.env.example`. Required: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, and either
`OPENAI_API_KEY` (with `ACTIVE_AI_PROVIDER=openai`) or the `WORKFLOWIQ_*` keys.
Set `NEXT_PUBLIC_APP_URL` in production so auth email links point at the right
origin.

## Tally bridge

The optional Windows bridge that pushes/pulls data directly from Tally lives in
`bridge/`. Build it manually:

```bash
cd bridge
npx pkg src/main.mjs --target node18-win-x64 --output dist/accountingiq-bridge.exe
```

The app serves the built binary at `/download/bridge`.

## Tests

```bash
npm test
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm start` — serve the production build
- `npm test` — run the engine/parser test suite (Vitest)
