// Прод-конфиг Prisma (Neon Postgres). Локальный dev использует тот же
// prisma/schema.prisma (postgresql) и prisma.config.ts.
//
// Порядок на проде/CI:
//   npx prisma migrate deploy --config prisma.postgres.config.ts
//   npm run build
//   npx prisma db seed --config prisma.postgres.config.ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
