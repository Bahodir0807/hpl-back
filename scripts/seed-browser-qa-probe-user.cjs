/**
 * Creates a probe user ONLY in crm_browser_qa for isolation verification.
 * Does not touch crm_dev, crm_e2e, or production.
 */
const path = require('path');
const { Client } = require('pg');
const { hash } = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PROBE_EMAIL = 'phase5-qa-isolation@browser-qa.hpl';
const REQUIRED_DB = 'crm_browser_qa';

function qaDatabaseUrl() {
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
  const connectionString = qaDatabaseUrl();
  const dbName = new URL(connectionString).pathname.replace(/^\//, '').split('?')[0];
  if (dbName !== REQUIRED_DB) {
    throw new Error(`Refusing: expected ${REQUIRED_DB}`);
  }

  const client = new Client({ connectionString });
  await client.connect();

  const role = await client.query(
    `SELECT id FROM "Role" WHERE name = 'MANAGER' LIMIT 1`,
  );
  if (role.rowCount === 0) {
    throw new Error('MANAGER role missing — run prisma db seed on crm_browser_qa first');
  }
  const roleId = role.rows[0].id;

  const existing = await client.query(
    `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
    [PROBE_EMAIL],
  );
  if (existing.rowCount > 0) {
    console.log(`OK: probe user already present in ${REQUIRED_DB}`);
    await client.end();
    return;
  }

  const passwordHash = await hash('Password123!', 12);
  await client.query(
    `INSERT INTO "User" (id, email, "passwordHash", "firstName", "lastName", "isActive", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'Phase5', 'IsolationProbe', true, NOW(), NOW())`,
    [PROBE_EMAIL, passwordHash],
  );
  const user = await client.query(
    `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
    [PROBE_EMAIL],
  );
  await client.query(
    `INSERT INTO "UserRole" ("userId", "roleId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [user.rows[0].id, roleId],
  );

  await client.end();
  console.log(`OK: probe user created in ${REQUIRED_DB} (${PROBE_EMAIL})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
