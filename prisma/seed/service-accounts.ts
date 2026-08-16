import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

const TELEGRAM_BOT_PERMISSIONS = [
  'leads:create',
  'clients:create',
  'contacts:create',
  'activities:create',
] as const;

function hashToken(token: string, pepper: string): string {
  return createHash('sha256').update(token + pepper).digest('hex');
}

export async function seedServiceAccounts(prisma: PrismaClient): Promise<void> {
  const pepper = process.env.SERVICE_ACCOUNT_TOKEN_PEPPER;

  if (!pepper || pepper.length < 32) {
    throw new Error(
      'SERVICE_ACCOUNT_TOKEN_PEPPER must be set and at least 32 characters for seed',
    );
  }

  const existing = await prisma.serviceAccount.findUnique({
    where: { name: 'telegram-bot' },
  });

  if (existing) {
    return;
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token, pepper);

  await prisma.serviceAccount.create({
    data: {
      name: 'telegram-bot',
      tokenHash,
      permissions: [...TELEGRAM_BOT_PERMISSIONS] as Prisma.InputJsonValue,
      isActive: true,
    },
  });

  const envTelegramPath = path.join(process.cwd(), '.env.telegram');
  const envTelegramContent = [
    `TELEGRAM_BOT_API_KEY=${token}`,
    'CRM_WEBHOOK_URL=http://localhost:3001/api/integrations/telegram/webhook',
    '',
  ].join('\n');

  await writeFile(envTelegramPath, envTelegramContent, 'utf8');

  console.log('=== TELEGRAM_BOT_API_KEY (saved to .env.telegram) ===');
  console.log(token);
  console.log('====================================================');
}
