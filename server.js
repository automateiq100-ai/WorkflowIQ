'use strict';
const path = require('path');

// Load environment variables from root .env
require('dotenv').config();

// Env var aliases — Cross-populate between sub-app name conventions
process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY         || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
process.env.SUPABASE_SERVICE_KEY      = process.env.SUPABASE_SERVICE_KEY      || process.env.SUPABASE_SERVICE_ROLE_KEY;

process.env.NEXT_PUBLIC_SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL      || process.env.SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const next    = require('next');
const express = require('express');
const cors    = require('cors');

// Default to production mode. Dev mode (Turbopack) is opt-in via NEXT_DEV=1
// because this repo's host filesystem is too slow for Turbopack — it produces
// truncated routes.d.ts artifacts that break compilation. Production mode uses
// the prebuilt .next/ output and is stable + fast.
const dev  = process.env.NEXT_DEV === '1';
const port = parseInt(process.env.PORT) || 3000;
// Keep NODE_ENV consistent with the mode we picked, so Next + downstream libs
// behave predictably regardless of how the script was invoked.
process.env.NODE_ENV = dev ? 'development' : 'production';

// ResearchIQ Express sub-app (all routes exported from researchiq/server.js)
const researchiqApp = require('./researchiq/server');

// Next.js app — AccountingIQ (portal, login, Tally XML tool)
const accountingiqApp = next({ dev, dir: path.join(__dirname, 'accountingiq') });
const accountingHandle = accountingiqApp.getRequestHandler();

// Next.js app — PracticeIQ (basePath: /practiceiq)
const practiceiqApp = next({ dev, dir: path.join(__dirname, 'practiceiq') });
const practiceHandle = practiceiqApp.getRequestHandler();

Promise.all([
  accountingiqApp.prepare(),
  practiceiqApp.prepare(),
]).then(() => {
  const server = express();
  server.use(cors());

  // ResearchIQ: serve index.html at /researchiq
  server.get('/researchiq', (_req, res) => {
    res.sendFile(path.join(__dirname, 'researchiq', 'public', 'index.html'));
  });

  // ResearchIQ: all sub-routes (/config, /api/*, static files in public/)
  server.use('/researchiq', researchiqApp);

  // PracticeIQ: all routes under /practiceiq (Next.js basePath handles the prefix internally)
  server.all('/practiceiq', (req, res) => practiceHandle(req, res));
  server.all('/practiceiq/*splat', (req, res) => practiceHandle(req, res));

  // Everything else → AccountingIQ Next.js (portal, login, Tally XML tool)
  server.all(/(.*)/, (req, res) => accountingHandle(req, res));

  server.listen(port, () => {
    console.log(`\n🚀 WorkFlowIQ running on http://localhost:${port}`);
    console.log(`   AccountingIQ → http://localhost:${port}/`);
    console.log(`   ResearchIQ   → http://localhost:${port}/researchiq`);
    console.log(`   PracticeIQ   → http://localhost:${port}/practiceiq\n`);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
