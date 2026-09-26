const esbuild = require('esbuild');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const outDir = join(root, 'dist', 'prisma');
const outfile = join(outDir, 'seed-facade-reference.js');

mkdirSync(outDir, { recursive: true });

esbuild
  .build({
    entryPoints: [join(root, 'prisma', 'seed-facade-reference.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    sourcemap: true,
    external: [
      '@prisma/client',
      '@prisma/adapter-pg',
      'dotenv',
      'dotenv/config',
      'pg',
      'pg-native',
    ],
    logLevel: 'info',
  })
  .then(() => {
    console.log(`Facade reference seed bundle: ${outfile}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
