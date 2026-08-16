import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceAccount } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { hashApiKeyToken } from './api-key-token.util';

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async findAccountByToken(token: string): Promise<ServiceAccount | null> {
    const tokenHash = this.hashToken(token);

    return this.prisma.serviceAccount.findUnique({
      where: { tokenHash },
    });
  }

  async validateToken(token: string): Promise<ServiceAccount | null> {
    const account = await this.findAccountByToken(token);

    if (!account || !account.isActive) {
      return null;
    }

    await this.touchLastUsed(account.id);
    return account;
  }

  async touchLastUsed(accountId: string): Promise<void> {
    await this.prisma.serviceAccount
      .update({
        where: { id: accountId },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async rotateToken(name: string): Promise<{ token: string; tokenHash: string }> {
    const existing = await this.prisma.serviceAccount.findUnique({
      where: { name },
    });

    if (!existing) {
      throw new NotFoundException(`Service account not found: ${name}`);
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    await this.prisma.serviceAccount.update({
      where: { name },
      data: { tokenHash },
    });

    return { token, tokenHash };
  }

  hashToken(token: string): string {
    const pepper = this.configService.get('SERVICE_ACCOUNT_TOKEN_PEPPER', {
      infer: true,
    });

    return hashApiKeyToken(token, pepper);
  }
}
