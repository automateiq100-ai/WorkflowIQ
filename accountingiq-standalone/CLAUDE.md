@AGENTS.md

# AccountingIQ — Project Reference

> **Standalone build.** This is AccountingIQ extracted from the WorkFlowIQ
> portal into its own app + repo. It owns its auth (Supabase email/password —
> sign up, sign in, forgot/reset password) and runs at `/` directly. There is no
> portal, tool-selector, PracticeIQ, or ResearchIQ here. Profiles live in
> `accountingiq_users` (see `supabase/schema.sql`), not `workflowiq_clients`.

## Purpose
Tally XML accounting health analyser for Indian businesses. Parses Tally ERP/Prime XML export files, runs 60 rule-based compliance and accuracy checks across 8 dimensions, and produces a 0–100 quality score with actionable insights and AI-powered analysis.

---

## Tech Stack
- **Framework**: Next.js 16.2.1 (App Router, Turbopack)
- **UI**: React 19.2.4, Tailwind CSS v4, custom dark theme CSS variables
- **Language**: TypeScript 5
- **Fonts**: DM Serif Display (headings), Outfit (body), DM Mono (code)
- **Auth**: Supabase via `@supabase/ssr` (email/password — sign up, sign in, forgot/reset password)
- **AI**: OpenAI GPT-4o (five-section AI Analysis, server-side API route `/app/api/ai/route.ts`)
- **State**: React Context + useReducer (no external state library)
- **Persistence**: Browser sessionStorage (file metadata + company profile + AI consent only)

---

## Directory Structure

```
accountingiq/
├── app/
│   ├── api/
│   │   └── ai/route.ts            POST — calls OpenAI GPT-4o, returns 5-section AIResponse JSON
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts           Supabase auth callback handler
│   ├── components/
│   │   ├── AppProvider.tsx        Context provider; restores session on mount
│   │   ├── ConsentModal.tsx       DPDPA consent modal with 3 checkboxes:
│   │   │                            1. Local processing consent (required)
│   │   │                            2. Professional responsibility (required)
│   │   │                            3. AI Analysis consent (optional — gates AI tab)
│   │   │                          consentGiven in AppState gates all views.
│   │   │                          aiConsentGiven gates AI Analysis tab separately.
│   │   ├── PortalShell.tsx        Portal landing page / workspace selector
│   │   ├── Shell.tsx              Sidebar nav + view router + user footer
│   │   ├── ScoreRing.tsx          Animated SVG score circle (0–100, grade)
│   │   └── StatusBadge.tsx        Check status pill (pass/fail/partial/etc.)
│   ├── login/
│   │   └── page.tsx               Supabase sign-in page (public route)
│   ├── portal/
│   │   └── page.tsx               Portal workspace page
│   ├── views/
│   │   ├── UploadView.tsx         Folder picker + auto-detection + status grid
│   │   ├── DashboardView.tsx      Score ring + dimension bars + KPI tiles (signed values, ANOMALY pills)
│   │   ├── ChecklistView.tsx      60 checks table with filter tabs (uses failLabel on fail/partial)
│   │   ├── InsightsView.tsx       Rule-based insights + legacy AI Summary panel
│   │   ├── AIAnalysisView.tsx     Five-section AI Analysis (exec summary, root causes, actions, commentary, preflight)
│   │   ├── HealthView.tsx         Financial health signals (ratios, balances — signed)
│   │   ├── FlagsView.tsx          Anomaly flags grouped by severity (deterministic from check.max)
│   │   ├── ProfileView.tsx        Company profile toggles (GST, TDS, etc.)
│   │   ├── ReportsView.tsx        Print-ready analysis summary
│   │   └── RulesView.tsx          User-defined Rules Engine
│   ├── globals.css                Design tokens, badge variants, animations
│   ├── layout.tsx                 Root layout with Google fonts + metadata
│   └── page.tsx                   Entry: <AppProvider><Shell />
├── lib/
│   ├── types.ts                   All TypeScript interfaces (FileKey, Check, AIRequest, AIResponse, etc.)
│   ├── constants.ts               DIM_WEIGHTS, FILE_TIERS, VIEWS (incl. aiAnalysis), GRADE_THRESHOLDS
│   ├── engine.ts                  analyseFiles() — 60 checks → 8 dim scores → overall (prefers bsNetProfit)
│   ├── parser.ts                  XML parsers for TB, P&L, BS, GrpSum, DayBook (signed values, 3-stage dup detection)
│   ├── chunkedParser.ts           Streaming DayBook parser for files >10 MB
│   ├── state.ts                   AppContext, reducer, useApp() hook (incl. AI state)
│   ├── session.ts                 sessionStorage helpers (metadata, profile, AI consent)
│   ├── insights.ts                generateInsights() — rule-based Insight[]
│   ├── health.ts                  generateHealthSignals() — financial ratios (signed, anomaly-aware)
│   ├── flags.ts                   generateFlags() + deriveSeverity() — severity from check.max points
│   └── supabase/
│       ├── client.ts              Browser Supabase client
│       └── server.ts              Server-side Supabase client
├── .env.local                     Secret keys (not committed)
├── CLAUDE.md                      ← this file
├── AGENTS.md                      Agent guidelines (Next.js breaking changes note)
├── next.config.ts                 Next.js config
├── postcss.config.mjs             Tailwind CSS v4 setup
└── tsconfig.json                  TypeScript config with @/ path alias
```

---

## Key Architecture

### Analysis Engine (lib/engine.ts)
```
analyseFiles(AppState)
  → parseTrialBalance()  → TBLedger[] (signed closing), suspenseCount, suspenseLedgers, dupPairDetails
  → parsePandL()         → revenue (group-level only, GST excluded), expenses, netProfit
  → parseBSheet()        → ca, cl, bankBal, debtorBal (all signed), bsNetProfit
  → parseGrpSum()        → dutiesUnderExpense flag
  → parseDayBook()       → ChunkedStats (voucher counts, narration %, etc.)
  → 60 checks (A1–H8)   → Check[] (pass/partial/fail/missing/uncertain/na) with failLabel
  → 8 dimension scores   → weighted 0–100 overall
  → AnalysisResults
```

Net Profit is read from BS "Profit & Loss A/c" line (`bsNetProfit`) when available; P&L-derived figure is only a fallback.

### 8 Dimensions & Weights
| Dim | Name | Weight |
|-----|------|--------|
| A | Data Completeness | 5% |
| B | Ledger Structure | 18% |
| C | Voucher Integrity | 18% |
| D | Arithmetical Accuracy | 22% |
| E | Statutory Accuracy | 18% |
| F | Recording Discipline | 7% |
| G | Consistency | 2% |
| H | Cross-Statement Reconciliation | 10% |

Score is capped at 60 if DayBook is missing.

### AI Analysis Layer
- API route at `/app/api/ai/route.ts` calls GPT-4o with structured system prompt
- Input: aggregated scores/metrics only (no raw XML, no party names, no voucher data)
- Output: 5-section AIResponse (executiveSummary, rootCauses, actions, financialCommentary, preflight)
- Validation layer strips phantom check IDs, caps array lengths, validates JSON parsing
- Gated by separate AI consent (aiConsentGiven) — user must opt in before AI tab is accessible
- Cached in AppState by input hash; Regenerate button clears cache and re-fetches

### File Upload Flow
1. User selects a folder → `<input webkitdirectory>`
2. Each `.xml` file is decoded (UTF-16LE BOM detection via `TextDecoder`)
3. `detectFileKey(filename, content)` → tries REPORTNAME tag → filename pattern → content fingerprint
4. Large DayBook (>10 MB) uses chunked streaming parser
5. All 5 required files loaded → "Run Analysis" enabled
6. `analyseFiles(state)` called client-side → `ANALYSIS_DONE` dispatched → navigate to Dashboard

### Tally XML Format
Tally display-report exports use non-standard tags:
- Account names: `<DSPDISPNAME>` inside `<DSPACCNAME>`
- Closing balances: `<DSPCLAMTA>`
- BS amounts: `<BSMAINAMT>` / `<BSSUBAMT>` inside `<BSAMT>`
- P&L amounts: `<BSMAINAMT>` inside `<PLAMT>`
- Encoding: UTF-16LE with BOM (`FF FE`) for most Tally exports
- Sign convention: negative = Cr, positive = Dr

### DPDPA Consent Modal
- `ConsentModal.tsx` gates all functionality behind two required checkboxes (local processing + professional responsibility)
- Third optional checkbox for AI Analysis consent (sends aggregated data to OpenAI)
- `consentGiven` in AppState gates all views
- `aiConsentGiven` gates AI Analysis tab separately
- AI consent persisted in sessionStorage via `lib/session.ts`

---

## Environment Variables (.env.local)

```
OPENAI_API_KEY=sk-...                   # Required for AI Analysis feature
NEXT_PUBLIC_SUPABASE_URL=https://...    # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...    # Supabase anon key (public)
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # Supabase service role key (server-side only)
```

---

## Required Tally Export Files

| File | Slot Key | Tier |
|------|----------|------|
| Day Book | `daybook` | Required |
| Trial Balance | `trialbal` | Required |
| P&L Statement | `pandl` | Required |
| Balance Sheet | `bsheet` | Required |
| Group Summary | `grpsum` | Required |
| All Masters (Ledger.xml) | `master` | Required |
| Sales Register | `sales` | Conditional |
| Purchase Register | `purchase` | Conditional |
| Bills Receivable | `bills` | Conditional |
| Bills Payable | `payables` | Conditional |
| Cash Flow | `cashflow` | Conditional |
| Fixed Asset Register | `faregister` | Optional |
| Stock Summary | `stock` | Optional |
| Bank Reconciliation | `bankrecon` | Optional |
