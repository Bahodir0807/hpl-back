import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FACADE_SYSTEM_TABLES } from './facade-system-tables';
import { BASE_FACADE_CONFIG_CODE } from './facade-norms';
import {
  seedFacadeReferenceConfiguration,
} from '../../../../../prisma/seed/facade-reference';
import * as facadeSubsystemSeed from '../../../../../prisma/seed/facade-subsystem';

const REPO_ROOT = join(__dirname, '../../../../../');

const FORBIDDEN_SEED_CALLS = [
  'seedRolesAndPermissions',
  'synchronizeRbac',
  'seedServiceAccounts',
  'seedReferenceConfiguration',
  './seed.ts',
  "from './seed'",
  'prisma/seed.ts',
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

beforeAll(() => {
  execSync('npm run build:facade-seed', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
});

describe('facade reference seed entry point', () => {
  it('uses bundled dist entry for production-safe node execution', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['db:seed:facade-reference']).toBe(
      'node dist/prisma/seed-facade-reference.js',
    );
    expect(pkg.scripts['db:seed:facade-reference']).not.toContain('ts-node');
    expect(pkg.scripts['db:seed:facade-reference']).not.toContain('tsx');
  });

  it('uses a minimal facade-only bootstrap without forbidden seed paths', () => {
    const entry = readRepoFile('prisma/seed-facade-reference.ts');
    const module = readRepoFile('prisma/seed/facade-reference.ts');

    expect(entry).toContain('seedFacadeReferenceConfiguration');
    expect(entry).not.toContain('seedReferenceConfiguration');
    expect(module).toContain('seedFacadeSubsystemCatalog');

    for (const forbidden of FORBIDDEN_SEED_CALLS) {
      expect(entry).not.toContain(forbidden);
      expect(module).not.toContain(forbidden);
    }
  });

  it('delegates catalog seeding only to seedFacadeSubsystemCatalog', async () => {
    const prisma = {
      facadeSystemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      facadeNormSet: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      facadeMaterial: { count: jest.fn().mockResolvedValue(0) },
      facadeConsumptionNorm: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;

    const catalogSpy = jest
      .spyOn(facadeSubsystemSeed, 'seedFacadeSubsystemCatalog')
      .mockResolvedValue(undefined);

    await seedFacadeReferenceConfiguration(prisma);

    expect(catalogSpy).toHaveBeenCalledTimes(1);
    expect(catalogSpy).toHaveBeenCalledWith(prisma);

    catalogSpy.mockRestore();
  });

  it('npm script fails with controlled error when DATABASE_URL is missing', () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    env.DOTENV_CONFIG_PATH = join(REPO_ROOT, '.env.facade-seed-missing');
    try {
      execSync('npm run db:seed:facade-reference', {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      throw new Error('expected seed command to fail without DATABASE_URL');
    } catch (error) {
      const execError = error as Error & { stderr?: string; stdout?: string; status?: number };
      if (execError.message === 'expected seed command to fail without DATABASE_URL') {
        throw execError;
      }
      const combined = `${execError.stdout ?? ''}\n${execError.stderr ?? ''}\n${execError.message}`;
      expect(combined).toContain('DATABASE_URL is required for facade reference seed');
      expect(combined).not.toContain('ERR_UNKNOWN_FILE_EXTENSION');
      expect(combined).not.toContain('ERR_REQUIRE_CYCLE_MODULE');
    }
  });
});

const TEST_URL =
  process.env.FACADE_SEED_TEST_DATABASE_URL ??
  'postgresql://crm:crm@localhost:5432/crm_facade_upgrade?schema=public';

const runPg = process.env.FACADE_SEED_PG === '1';
const describePg = runPg ? describe : describe.skip;

describePg('facade reference seed PostgreSQL idempotency', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_URL }),
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('runs npm db:seed:facade-reference through the production script path', () => {
    const output = execSync('npm run db:seed:facade-reference', {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: TEST_URL,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output).toContain('Facade subsystem reference seed completed');
    expect(output).toContain('HPL_DRY_6MM_50MM');
    expect(output).toContain('HPL_DRY_8MM_80MM');
    expect(output).toContain('HPL_ADHESIVE_4MM');
    expect(output).toContain(BASE_FACADE_CONFIG_CODE);
  });

  it('does not duplicate facade catalog rows on a second run', async () => {
    const first = await seedFacadeReferenceConfiguration(prisma);
    const [
      configCountAfterFirst,
      normSetCountAfterFirst,
      materialCountAfterFirst,
      normCountAfterFirst,
    ] = await Promise.all([
      prisma.facadeSystemConfig.count(),
      prisma.facadeNormSet.count(),
      prisma.facadeMaterial.count(),
      prisma.facadeConsumptionNorm.count(),
    ]);

    const second = await seedFacadeReferenceConfiguration(prisma);

    expect(second.configCodes).toEqual(first.configCodes);
    expect(second.normSetCodes).toEqual(first.normSetCodes);
    expect(second.materialCount).toBe(first.materialCount);
    expect(second.consumptionNormCount).toBe(first.consumptionNormCount);

    expect(first.calculableSystemCodes.sort()).toEqual(
      FACADE_SYSTEM_TABLES.map((table) => table.code).sort(),
    );
    expect(first.configCodes).toContain(BASE_FACADE_CONFIG_CODE);

    await Promise.all([
      expect(prisma.facadeSystemConfig.count()).resolves.toBe(
        configCountAfterFirst,
      ),
      expect(prisma.facadeNormSet.count()).resolves.toBe(normSetCountAfterFirst),
      expect(prisma.facadeMaterial.count()).resolves.toBe(
        materialCountAfterFirst,
      ),
      expect(prisma.facadeConsumptionNorm.count()).resolves.toBe(
        normCountAfterFirst,
      ),
    ]);
  });
});
