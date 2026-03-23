# Project Instructions & Best Practices

This document outlines the core architecture, tech stack, coding conventions, UI guidelines, and security rules for the Centax Search Assistant (WorkflowIQ Casebot) project.

## 1. Tech Stack & Rationale

*   **Backend:** Node.js + Express.js
    *   *Why:* Lightweight, fast to set up, and excellent ecosystem for API integrations (OpenAI, Supabase, Axios). Perfect for a middle-tier bridging the frontend with external APIs.
*   **Frontend:** Vanilla HTML / CSS / JS
    *   *Why:* Keeps the project simple and dependency-free for the client side. Avoids build steps (like Webpack/Vite) while allowing for rapid UI iteration using custom CSS variables and modern DOM APIs.
*   **Database & Storage:** Supabase (PostgreSQL)
    *   *Why:* Provides a robust, open-source Firebase alternative with built-in pgvector for eventual hybrid search functionality, plus simple object storage for caching case HTML.
*   **AI Integration:** OpenAI (`gpt-4o`, `gpt-4o-mini`)
    *   *Why:* Industry-leading reasoning and summarization capabilities needed for legal text synthesis and keyword generation.

## 2. Strict Coding Conventions

*   **Naming:**
    *   **Variables & Functions:** `camelCase` (e.g., `fetchCaseText`, `generateKeywords`).
    *   **Classes/Constructors:** `PascalCase`.
    *   **Constants:** `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`, `DOWNLOADS_DIR`).
    *   **File Names:** `kebab-case.js` or `snake_case.js` is acceptable, but be consistent (currently using `server.js`, `analyzer.js`).
*   **File Structure:**
    *   `/public`: All frontend assets (`index.html`, CSS, client-side JS).
    *   `/src`: Backend modules (business logic, DB adapters, API wrappers). Keep `server.js` lean by delegating logic to `/src` modules.
    *   Do not mix frontend and backend dependencies.
*   **Imports/Exports:**
    *   Use CommonJS (`require` / `module.exports`) for backend files (Node.js standard without `.mjs` or `"type": "module"` in package.json).

## 3. UI Rules & Component Guidelines

Our frontend utilizes a custom design system defined in `index.html` via CSS variables.
*   **Typography:** Strict use of Google Fonts `Inter`.
*   **Colors & Theming:** Use the defined CSS variables (`var(--bg-primary)`, `var(--accent-gradient)`, etc.). Do not hardcode hex colors in inline styles or new CSS classes.
*   **Icons:** Use `Material Icons Round`.
*   **Styling Structure:** Avoid Tailwind or external CSS frameworks; use structural CSS in `index.html` or a dedicated `.css` file using the established `--radius`, `--shadow`, and flex/grid patterns.
*   **Animations:** Use subtle micro-interactions (`fadeInUp`, border-color transitions, hover transformations like `translateY(-1px)`). The UI should feel premium and responsive.
*   **Responsiveness:** Ensure mobile/tablet viewing is supported by using flexible units and wrap layouts.

## 4. Security Rules (What NEVER to do)

*   **NEVER** commit the `.env` file or hardcode sensitive keys (OpenAI keys, Supabase Service keys) anywhere in the source code.
*   **NEVER** expose the Supabase `SERVICE_ROLE_KEY` to the client-side `/public` folder. Only the `ANON_KEY` can safely be used on the client.
*   **NEVER** execute raw, unparameterized SQL queries manually (Supabase SDK handles parameterization automatically).
*   **NEVER** execute or evaluate (`eval()`) untrusted user input—especially important because AI-generated text is sometimes fed back into the system.
*   **NEVER** process unvalidated request bodies. Always verify `req.body` structures for required fields before proceeding.

## 5. Auth and Database Queries

*   **Authentication:** Currently, the system is primarily backend-driven. If user authentication is added, use Supabase Auth and handle JWT verification via Express middleware before granting access to `/api/*` routes.
*   **Database Queries (Supabase SDK):**
    *   Perform database operations strictly on the server (`/src/db.js`).
    *   Handle errors gracefully on every query (`const { data, error } = await supabase...`).
    *   Never crash the main process on a DB write failure; use fire-and-forget fallback strategies where appropriate (e.g., `.catch(() => {})` for cache writes) so the main user flow is uninterrupted.
    *   For vectors/embeddings, ensure `pgvector` extension matching is utilized carefully via RPC calls.
    *   When dealing with file storage, always check if an object exists before blind uploading/downloading to minimize redundant traffic.
