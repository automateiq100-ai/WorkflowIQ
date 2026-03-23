'use strict';
const path = require('path');

// Load env vars from both app subdirectories
require('dotenv').config({ path: path.join(__dirname, 'accountingiq', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, 'researchiq', '.env') });

// Env var aliases — ResearchIQ uses different names than AccountingIQ
process.env.SUPABASE_URL         = process.env.SUPABASE_URL         || process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const next    = require('next');
const express = require('express');
const cors    = require('cors');

const dev  = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT) || 3000;

// ResearchIQ Express sub-app (all routes exported from researchiq/server.js)
const researchiqApp = require('./researchiq/server');

// Next.js app (AccountingIQ — portal, login, Tally XML tool)
const nextApp = next({ dev, dir: path.join(__dirname, 'accountingiq') });
const handle  = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const server = express();
  server.use(cors());

  // ResearchIQ: serve index.html at /researchiq
  server.get('/researchiq', (_req, res) => {
    res.sendFile(path.join(__dirname, 'researchiq', 'public', 'index.html'));
  });

  // ResearchIQ: all sub-routes (/config, /api/*, static files in public/)
  server.use('/researchiq', researchiqApp);

  // Everything else → Next.js (portal, login, AccountingIQ)
  server.all(/(.*)/, (req, res) => handle(req, res));

  server.listen(port, () => {
    console.log(`\n🚀 WorkFlowIQ running on http://localhost:${port}\n`);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
