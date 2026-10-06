/**
 * Runs backend E2E only against an allowlisted isolated database (default: crm_e2e).
 * Refuses crm_dev, production-like hosts, or non-local databases.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ALLOWED_DB_NAMES = new Set(['crm_e2e', 'crm_test']);
const BLOCKED_DB_SUBSTRINGS = ['crm_dev', 'production', '_prod', 'prod_'];

function resolveE2eDatabaseUrl() {
  const explicit = process.env.E2E_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const base = process.env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error('DATABASE_URL is not set. Configure .env or set E2E_DATABASE_URL.');
  }

  const parsed = new URL(base);
  parsed.pathname = '/crm_e2e';
  return parsed.toString();
}

function assertSafeDatabaseUrl(connectionString) {
  const parsed = new URL(connectionString);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];

  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(
      `E2E blocked: database host must be localhost (got ${host}).`,
    );
  }

  const lowerDb = dbName.toLowerCase();
  if (!ALLOWED_DB_NAMES.has(lowerDb)) {
    throw new Error(
      `E2E blocked: database name must be one of ${[...ALLOWED_DB_NAMES].join(', ')} (got ${dbName}).`,
    );
  }

  for (const blocked of BLOCKED_DB_SUBSTRINGS) {
    if (lowerDb.includes(blocked)) {
      throw new Error(`E2E blocked: database name looks unsafe (${dbName}).`);
    }
  }
}

function main() {
  const e2eUrl = resolveE2eDatabaseUrl();
  assertSafeDatabaseUrl(e2eUrl);

  const jestArgs = process.argv.slice(2);
  const projectRoot = path.join(__dirname, '..');
  const jestCli = path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  const childEnv = { ...process.env, DATABASE_URL: e2eUrl };

  // Invoke Jest directly so the exit code is the test process status (not npm wrapper).
  const result = spawnSync(
    process.execPath,
    [jestCli, '--config', './test/jest-e2e.json', ...jestArgs],
    {
      env: childEnv,
      stdio: 'inherit',
      cwd: projectRoot,
    },
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  const code = result.status;
  if (code === null) {
    process.exit(1);
  }
  process.exit(code);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
