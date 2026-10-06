/**
 * Proves Frontend QA BFF targets Backend QA (3006) + crm_browser_qa only.
 * Does not print passwords or tokens.
 */
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PROBE_EMAIL = 'phase5-qa-isolation@browser-qa.hpl';
const PROBE_PASSWORD = 'Password123!';
const FRONT_QA = process.env.FRONT_QA_URL ?? 'http://localhost:3007';
const BACK_QA = process.env.BACK_QA_URL ?? 'http://localhost:3006/api';
const BACK_LEGACY = process.env.BACK_LEGACY_URL ?? 'http://localhost:3001/api';

function qaDatabaseUrl() {
  const base = process.env.DATABASE_URL?.trim();
  const parsed = new URL(base);
  parsed.pathname = '/crm_browser_qa';
  return parsed.toString();
}

function devDatabaseUrl() {
  const base = process.env.DATABASE_URL?.trim();
  const parsed = new URL(base);
  parsed.pathname = '/crm_dev';
  return parsed.toString();
}

async function countUser(connectionString, email) {
  const client = new Client({ connectionString });
  await client.connect();
  const result = await client.query(
    `SELECT COUNT(*)::int AS c FROM "User" WHERE email = $1`,
    [email],
  );
  await client.end();
  return result.rows[0].c;
}

async function tryLogin(baseUrl) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD }),
  });
  return response.status;
}

async function main() {
  const qaCount = await countUser(qaDatabaseUrl(), PROBE_EMAIL);
  const devCount = await countUser(devDatabaseUrl(), PROBE_EMAIL);

  console.log(`probe_in_crm_browser_qa=${qaCount}`);
  console.log(`probe_in_crm_dev=${devCount}`);
  if (qaCount !== 1 || devCount !== 0) {
    throw new Error('Probe user isolation precondition failed');
  }

  const frontLogin = await fetch(`${FRONT_QA}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD }),
  });
  console.log(`front_qa_bff_login_status=${frontLogin.status}`);
  if (!frontLogin.ok) {
    throw new Error('Frontend QA BFF login failed for probe user');
  }

  const backQaStatus = await tryLogin(BACK_QA);
  console.log(`back_qa_direct_login_status=${backQaStatus}`);

  let legacyStatus = 'unreachable';
  try {
    legacyStatus = String(await tryLogin(BACK_LEGACY));
  } catch {
    legacyStatus = 'unreachable';
  }
  console.log(`back_3001_probe_login_status=${legacyStatus}`);

  if (legacyStatus === '200' || legacyStatus === '201') {
    throw new Error('Probe user must not authenticate against legacy :3001 backend');
  }

  console.log('OK: Frontend QA isolation proof passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
