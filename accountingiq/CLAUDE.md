@AGENTS.md

# AccountingIQ — Project Reference

## Purpose
Tally XML accounting health analyser for Indian businesses. Parses Tally ERP/Prime XML export files, runs 59 rule-based compliance and accuracy checks across 8 dimensions, and produces a 0–100 quality score with actionable insights.

---

## Tech Stack
- **Framework**: Next.js 16.2.1 (App Router, Turbopack)
- **UI**: React 19.2.4, Tailwind CSS v4, custom dark theme CSS variables
- **Language**: TypeScript 5
- **Fonts**: DM Serif Display (headings), Outfit (body), DM Mono (code)
- **Auth**: NextAuth.js v5 (Google OAuth)
- **AI**: OpenAI GPT-4o (optional AI summary, server-side API route)
- **State**: React Context + useReducer (no external state library)
- **Persistence**: Browser sessionStorage (file metadata + company profile only)

---

## Directory Structure

```
accountingiq/
├── app/
│   ├── api/
│   │   ├── ai/route.ts            POST — calls OpenAI, returns AI summary JSON
│   │   └── auth/[...nextauth]/
│   │       └── route.ts           NextAuth.js route handler (GET + POST)
│   ├── components/
│   │   ├── AppProvider.tsx        Context provider; restores session on mount
│   │   ├── Shell.tsx              Sidebar nav + view router + user footer
│   │   ├── ScoreRing.tsx          Animated SVG score circle (0–100, grade)
│   │   └── StatusBadge.tsx        Check status pill (pass/fail/partial/etc.)
│   ├── login/
│   │   └── page.tsx               Google sign-in page (public route)
│   ├── views/
│   │   ├── UploadView.tsx         Folder picker + auto-detection + status grid
│   │   ├── DashboardView.tsx      Score ring + dimension bars + stat cards
│   │   ├── ChecklistView.tsx      59 checks table with filter tabs
│   │   ├── InsightsView.tsx       Rule-based insights + AI Summary panel
│   │   ├── HealthView.tsx         Financial health signals (ratios, balances)
│   │   ├── FlagsView.tsx          Anomaly flags grouped by severity
│   │   ├── ProfileView.tsx        Company profile toggles (GST, TDS, etc.)
│   │   └── ReportsView.tsx        Print-ready analysis summary
│   ├── globals.css                Design tokens, badge variants, animations
│   ├── layout.tsx                 Root layout with Google fonts + metadata
│   └── page.tsx                   Entry: <AppProvider><Shell />
├── lib/
│   ├── types.ts                   All TypeScript interfaces (FileKey, Check, etc.)
│   ├── constants.ts               DIM_WEIGHTS, FILE_TIERS, VIEWS, GRADE_THRESHOLDS
│   ├── engine.ts                  analyseFiles() — 59 checks → 8 dim scores → overall
│   ├── parser.ts                  XML parsers for TB, P&L, BS, GrpSum, DayBook
│   ├── chunkedParser.ts           Streaming DayBook parser for files >10 MB
│   ├── state.ts                   AppContext, reducer, useApp() hook
│   ├── session.ts                 sessionStorage helpers (metadata only, no XML)
│   ├── insights.ts                generateInsights() — rule-based Insight[]
│   ├── health.ts                  generateHealthSignals() — financial ratios
│   └── flags.ts                   generateFlags() — anomaly AnomalyFlag[]
├── auth.ts                        NextAuth config (Google provider)
├── middleware.ts                  Route protection — redirects to /login if unauth
├── .env.local                     Secret keys (not committed)
├── CLAUDE.md                      ← this file
├── AGENTS.md                      Agent guidelines (Next.js breaking changes note)
├── next.config.ts                 Next.js config
├── tailwind.config (via postcss)  Tailwind CSS v4 setup
└── tsconfig.json                  TypeScript config with @/ path alias
```

---

## Key Architecture

### Analysis Engine (lib/engine.ts)
```
analyseFiles(AppState)
  → parseTrialBalance()  → TBLedger[], suspenseCount, GST/TDS flags
  → parsePandL()         → revenue, expenses, netProfit, depFound
  → parseBSheet()        → ca, cl, bankBal, debtorBal, closingStock
  → parseGrpSum()        → dutiesUnderExpense flag
  → parseDayBook()       → ChunkedStats (voucher counts, narration %, etc.)
  → 59 checks (A1–H8)   → Check[]  (pass/partial/fail/missing/uncertain/na)
  → 8 dimension scores   → weighted 0–100 overall
  → AnalysisResults
```

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

---

## Environment Variables (.env.local)

```
OPENAI_API_KEY=sk-...           # Required for AI Summary feature
AUTH_SECRET=...                 # Required for NextAuth (generate: npx auth secret)
AUTH_GOOGLE_ID=...              # Google OAuth Client ID
AUTH_GOOGLE_SECRET=...          # Google OAuth Client Secret
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
| Sales Register | `sales` | Conditional |
| Purchase Register | `purchase` | Conditional |
| Bills Receivable | `bills` | Conditional |
| Bills Payable | `payables` | Conditional |
| Cash Flow | `cashflow` | Conditional |
| Fixed Asset Register | `faregister` | Optional |
| Stock Summary | `stock` | Optional |
| Bank Reconciliation | `bankrecon` | Optional |
