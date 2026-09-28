const esbuild = require('esbuild');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const outDir = join(root, 'dist', 'prisma');

const externals = [
  '@prisma/client',
  '@prisma/adapter-pg',
  'dotenv',
  'dotenv/config',
  'pg',
  'pg-native',
];

const seeds = [
  {
    entry: join(root, 'prisma', 'seed-facade-reference.ts'),
    outfile: join(outDir, 'seed-facade-reference.js'),
    label: 'Facade reference seed bundle',
  },
  {
    entry: join(root, 'prisma', 'seed-panel-sizes.ts'),
    outfile: join(outDir, 'seed-panel-sizes.js'),
    label: 'Panel size seed bundle',
  },
];

mkdirSync(outDir, { recursive: true });

Promise.all(
  seeds.map(({ entry, outfile, label }) =>
    esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      outfile,
      sourcemap: true,
      external: externals,
      logLevel: 'info',
    }).then(() => {
      console.log(`${label}: ${outfile}`);
    }),
  ),
)
  .then(() => undefined)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
