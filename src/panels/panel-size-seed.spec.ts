import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  HPL_CANONICAL_PANEL_SIZES,
  panelSizeAreaM2,
  panelSizeDisplayName,
} from './hpl-catalog';
import { seedCanonicalPanelSizes } from '../../prisma/seed/panel-sizes';

const REPO_ROOT = join(__dirname, '../../');

const FORBIDDEN_SEED_CALLS = [
  'seedPanels',
  'seedReferenceConfiguration',
  'seedRolesAndPermissions',
  'synchronizeRbac',
  'seedServiceAccounts',
  './seed.ts',
  "from './seed'",
  'prisma/seed.ts',
  'deactivatedLegacySizeCount',
  'updateMany',
  'deleteMany',
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

beforeAll(() => {
  execSync('npm run build:production-seeds', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
});

describe('panel size reference seed entry point', () => {
  it('uses bundled dist entry for production-safe node execution', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['db:seed:panel-sizes']).toBe(
      'node dist/prisma/seed-panel-sizes.js',
    );
    expect(pkg.scripts['db:seed:panel-sizes']).not.toContain('ts-node');
    expect(pkg.scripts['db:seed:panel-sizes']).not.toContain('tsx');
  });

  it('uses a minimal panel-size-only bootstrap without forbidden seed paths', () => {
    const entry = readRepoFile('prisma/seed-panel-sizes.ts');
    const module = readRepoFile('prisma/seed/panel-sizes.ts');

    expect(entry).toContain('seedCanonicalPanelSizes');
    expect(entry).not.toContain('seedReferenceConfiguration');
    expect(entry).not.toContain('seedPanels');
    expect(module).not.toContain('seedPanels');

    for (const forbidden of FORBIDDEN_SEED_CALLS) {
      expect(entry).not.toContain(forbidden);
      expect(module).not.toContain(forbidden);
    }
  });

  it('npm script fails with controlled error when DATABASE_URL is missing', () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    env.DOTENV_CONFIG_PATH = join(REPO_ROOT, '.env.panel-size-seed-missing');
    try {
      execSync('npm run db:seed:panel-sizes', {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      throw new Error('expected seed command to fail without DATABASE_URL');
    } catch (error) {
      const execError = error as Error & {
        stderr?: string;
        stdout?: string;
      };
      if (
        execError.message === 'expected seed command to fail without DATABASE_URL'
      ) {
        throw execError;
      }
      const combined = `${execError.stdout ?? ''}\n${execError.stderr ?? ''}\n${execError.message}`;
      expect(combined).toContain(
        'DATABASE_URL is required for panel size seed',
      );
      expect(combined).not.toContain('ERR_UNKNOWN_FILE_EXTENSION');
      expect(combined).not.toContain('MODULE_NOT_FOUND');
      expect(combined).not.toContain('ERR_REQUIRE_CYCLE_MODULE');
    }
  });

  it('only calls panelSize.upsert on the prisma client', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { panelSize: { upsert } } as unknown as PrismaClient;

    await seedCanonicalPanelSizes(prisma);

    expect(upsert).toHaveBeenCalledTimes(HPL_CANONICAL_PANEL_SIZES.length);
    for (let index = 0; index < HPL_CANONICAL_PANEL_SIZES.length; index += 1) {
      const size = HPL_CANONICAL_PANEL_SIZES[index];
      expect(upsert).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({
          where: {
            widthMm_heightMm: {
              widthMm: size.widthMm,
              heightMm: size.heightMm,
            },
          },
          update: expect.objectContaining({
            displayName: panelSizeDisplayName(size.widthMm, size.heightMm),
            sortOrder: index + 1,
            areaM2: panelSizeAreaM2(size.widthMm, size.heightMm),
            isActive: true,
          }),
          create: expect.objectContaining({
            widthMm: size.widthMm,
            heightMm: size.heightMm,
            displayName: panelSizeDisplayName(size.widthMm, size.heightMm),
            sortOrder: index + 1,
            areaM2: panelSizeAreaM2(size.widthMm, size.heightMm),
            isActive: true,
          }),
        }),
      );
    }
  });
});

const TEST_URL =
  process.env.PANEL_SIZE_SEED_TEST_DATABASE_URL ??
  'postgresql://crm:crm@localhost:5432/crm_facade_upgrade?schema=public';

const runPg = process.env.PANEL_SIZE_SEED_PG === '1';
const describePg = runPg ? describe : describe.skip;

describePg('panel size reference seed PostgreSQL', () => {
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

  it('creates exactly 24 canonical sizes on an empty PanelSize table', async () => {
    await prisma.panelSize.deleteMany();

    await seedCanonicalPanelSizes(prisma);

    const rows = await prisma.panelSize.findMany({
      orderBy: [{ sortOrder: 'asc' }, { widthMm: 'asc' }, { heightMm: 'asc' }],
    });

    expect(rows).toHaveLength(HPL_CANONICAL_PANEL_SIZES.length);
    rows.forEach((row, index) => {
      const expected = HPL_CANONICAL_PANEL_SIZES[index];
      expect(row.widthMm).toBe(expected.widthMm);
      expect(row.heightMm).toBe(expected.heightMm);
      expect(row.sortOrder).toBe(index + 1);
      expect(row.isActive).toBe(true);
      expect(row.displayName).toBe(
        panelSizeDisplayName(expected.widthMm, expected.heightMm),
      );
      expect(row.areaM2.toFixed(4)).toBe(
        panelSizeAreaM2(expected.widthMm, expected.heightMm).toFixed(4),
      );
    });
  });

  it('is idempotent and leaves non-canonical rows untouched', async () => {
    const legacy = await prisma.panelSize.create({
      data: {
        widthMm: 9999,
        heightMm: 8888,
        displayName: 'legacy',
        sortOrder: 999,
        areaM2: new Prisma.Decimal('1.0000'),
        isActive: true,
      },
    });

    await seedCanonicalPanelSizes(prisma);
    const countAfterFirst = await prisma.panelSize.count();
    await seedCanonicalPanelSizes(prisma);
    const countAfterSecond = await prisma.panelSize.count();

    expect(countAfterSecond).toBe(countAfterFirst);
    expect(countAfterFirst).toBe(HPL_CANONICAL_PANEL_SIZES.length + 1);

    const legacyAfter = await prisma.panelSize.findUnique({
      where: { id: legacy.id },
    });
    expect(legacyAfter?.displayName).toBe('legacy');
    expect(legacyAfter?.sortOrder).toBe(999);
    expect(legacyAfter?.isActive).toBe(true);
  });

  it('corrects outdated canonical rows via upsert', async () => {
    const first = HPL_CANONICAL_PANEL_SIZES[0];
    await prisma.panelSize.upsert({
      where: {
        widthMm_heightMm: {
          widthMm: first.widthMm,
          heightMm: first.heightMm,
        },
      },
      update: {
        displayName: 'stale',
        sortOrder: 99,
        isActive: false,
      },
      create: {
        widthMm: first.widthMm,
        heightMm: first.heightMm,
        displayName: 'stale',
        sortOrder: 99,
        areaM2: panelSizeAreaM2(first.widthMm, first.heightMm),
        isActive: false,
      },
    });

    await seedCanonicalPanelSizes(prisma);

    const corrected = await prisma.panelSize.findUnique({
      where: {
        widthMm_heightMm: {
          widthMm: first.widthMm,
          heightMm: first.heightMm,
        },
      },
    });

    expect(corrected?.displayName).toBe(
      panelSizeDisplayName(first.widthMm, first.heightMm),
    );
    expect(corrected?.sortOrder).toBe(1);
    expect(corrected?.isActive).toBe(true);
  });

  it('runs npm db:seed:panel-sizes through the production script path', () => {
    const output = execSync('npm run db:seed:panel-sizes', {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: TEST_URL,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output).toContain('Panel size reference seed completed');
    expect(output).toContain('Canonical panel sizes upserted: 24');
  });
});
