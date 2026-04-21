/**
 * One-time script: sets password "Hey@1234" for all existing users
 * who signed in via Google OAuth and have no password set.
 *
 * Run from the accountingiq directory:
 *   node scripts/set-default-passwords.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env.local manually
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.error('Could not read .env.local — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY manually.');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_PASSWORD = 'Hey@1234';

async function run() {
  // Fetch all users
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) { console.error('Failed to list users:', error.message); process.exit(1); }

  const users = data.users;
  console.log(`Found ${users.length} user(s) total.`);

  // Only target users with no password (OAuth-only users have empty encrypted_password)
  // app_metadata.provider === 'google' or providers includes google
  const oauthUsers = users.filter(u => {
    const providers = u.app_metadata?.providers ?? [];
    const hasGoogle = providers.includes('google') || u.app_metadata?.provider === 'google';
    const hasPassword = providers.includes('email') || u.app_metadata?.provider === 'email';
    return hasGoogle && !hasPassword;
  });

  if (oauthUsers.length === 0) {
    console.log('No OAuth-only users found. Nothing to do.');
    return;
  }

  console.log(`Setting default password for ${oauthUsers.length} OAuth user(s)…`);

  let success = 0;
  let failed = 0;

  for (const user of oauthUsers) {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: DEFAULT_PASSWORD,
    });
    if (error) {
      console.error(`  ✗ ${user.email}: ${error.message}`);
      failed++;
    } else {
      console.log(`  ✓ ${user.email}`);
      success++;
    }
  }

  console.log(`\nDone. ${success} updated, ${failed} failed.`);
  if (success > 0) {
    console.log(`\nThese users can now sign in with their email and password: "${DEFAULT_PASSWORD}"`);
    console.log('Remind them to change their password after first login.');
  }
}

run();
