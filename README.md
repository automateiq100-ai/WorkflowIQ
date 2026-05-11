# WorkFlowIQ

Unified AI-powered workspace combining **AccountingIQ** (Tally XML accounting health analyser) and **ResearchIQ** (AI-powered legal case research).

## Monorepo Structure

This project is organized as an npm monorepo using workspaces:

- `root`: Main Express server and shared dependencies.
- `accountingiq/`: Next.js 16 frontend and accounting engine.
- `researchiq/`: Express-based legal research API and engine.
- `practiceiq/`: Next.js CA practice management tool, mounted at `/practiceiq`.

## Getting Started

### Prerequisites

- Node.js & npm (installed via Homebrew or standard installer)

### Installation

1. Clone the repository.
2. Run `npm install` from the root directory to install all dependencies for all workspaces.
3. Configure your environment by copying `.env.example` to `.env` and filling in the required keys.

### Running the App

Start the unified development server (Express + Next.js):

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

- **AccountingIQ Portal**: `/`
- **ResearchIQ Dashboard**: `/researchiq`

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS v4
- **Backend**: Express 5, Node.js
- **Database/Auth**: Supabase
- **AI**: OpenAI GPT-4o
