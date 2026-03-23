const { spawn } = require('child_process');
const path = require('path');

// ResearchIQ Express runs on internal port 3001
const researchiq = spawn('node', ['server.js'], {
  cwd: path.join(__dirname, 'researchiq'),
  env: { ...process.env, PORT: '3001' },
  stdio: 'inherit',
});

// AccountingIQ Next.js runs on the port Render exposes (process.env.PORT)
const accountingiq = spawn('node', ['node_modules/.bin/next', 'start'], {
  cwd: path.join(__dirname, 'accountingiq'),
  stdio: 'inherit',
});

researchiq.on('error', (err) => console.error('ResearchIQ error:', err));
accountingiq.on('error', (err) => console.error('AccountingIQ error:', err));

process.on('SIGTERM', () => { researchiq.kill(); accountingiq.kill(); });
process.on('SIGINT',  () => { researchiq.kill(); accountingiq.kill(); });
