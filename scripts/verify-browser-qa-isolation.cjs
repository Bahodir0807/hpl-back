/**
 * Verifies Backend QA DATABASE_URL targets crm_browser_qa (localhost only).
 * Does not print credentials.
 */
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED_DB = 'crm_browser_qa';

function resolveQaDatabaseUrl() {
  const explicit = process.env.BROWSER_QA_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const base = process.env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error('DATABASE_URL is not set');
  }
  const parsed = new URL(base);
  parsed.pathname = `/${REQUIRED_DB}`;
  return parsed.toString();
}

async function main() {
  const connectionString = resolveQaDatabaseUrl();
  const parsed = new URL(connectionString);
  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];

  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`Blocked: host must be localhost (got ${host})`);
  }
  if (dbName !== REQUIRED_DB) {
    throw new Error(`Blocked: expected database ${REQUIRED_DB}, got ${dbName}`);
  }
  if (dbName.includes('crm_dev') || dbName.includes('crm_e2e')) {
    throw new Error(`Blocked: unsafe database name ${dbName}`);
  }

  const client = new Client({ connectionString });
  await client.connect();
  const result = await client.query('SELECT current_database() AS db');
  await client.end();

  const current = result.rows[0]?.db;
  if (current !== REQUIRED_DB) {
    throw new Error(`Connected database mismatch: ${current}`);
  }

  console.log(`OK: isolation verified for ${host}/${REQUIRED_DB}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
