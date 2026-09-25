import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  printFacadeReferenceSeedReport,
  seedFacadeReferenceConfiguration,
} from './seed/facade-reference';

function resolvePgConnectionString(connectionString: string): string {
  const parsedUrl = new URL(connectionString);

  if (parsedUrl.protocol !== 'prisma+postgres:') {
    return connectionString;
  }

  const apiKey = parsedUrl.searchParams.get('api_key');
  if (!apiKey) {
    throw new Error('Prisma Postgres api_key is missing databaseUrl');
  }

  const decoded = Buffer.from(apiKey, 'base64url').toString('utf8');
  const payload: unknown = JSON.parse(decoded);
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('databaseUrl' in payload)
  ) {
    throw new Error('Prisma Postgres api_key payload is invalid');
  }

  const databaseUrl = (payload as { databaseUrl: unknown }).databaseUrl;
  if (typeof databaseUrl !== 'string') {
    throw new Error('Prisma Postgres api_key databaseUrl is invalid');
  }

  return databaseUrl;
}

async function createPrismaClient(): Promise<PrismaClient> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for facade reference seed');
  }

  if (
    connectionString.startsWith('postgres') ||
    connectionString.startsWith('prisma+postgres')
  ) {
    const { PrismaPg } = await import('@prisma/adapter-pg');
    return new PrismaClient({
      adapter: new PrismaPg({
        connectionString: resolvePgConnectionString(connectionString),
      }),
    });
  }

  throw new Error(
    'Facade reference seed requires PostgreSQL. Set DATABASE_URL to a postgresql:// connection string.',
  );
}

async function bootstrap(): Promise<void> {
  const prisma = await createPrismaClient();
  try {
    const report = await seedFacadeReferenceConfiguration(prisma);
    printFacadeReferenceSeedReport(report);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
