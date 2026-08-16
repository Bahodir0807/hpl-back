import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not configured. Set it in .env before starting the app.',
      );
    }

    const adapter = new PrismaPg({
      connectionString: resolvePgConnectionString(connectionString),
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

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

  const databaseUrl = payload.databaseUrl;

  if (typeof databaseUrl !== 'string') {
    throw new Error('Prisma Postgres api_key databaseUrl is invalid');
  }

  return databaseUrl;
}
