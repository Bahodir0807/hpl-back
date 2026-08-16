import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InboundWebhookEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../../../modules/prisma/prisma.service';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    source: string,
    externalId: string,
  ): Promise<InboundWebhookEvent | null> {
    return this.prisma.inboundWebhookEvent.findUnique({
      where: {
        source_externalId: { source, externalId },
      },
    });
  }

  async create(
    source: string,
    externalId: string,
    payload: unknown,
  ): Promise<InboundWebhookEvent> {
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    return this.prisma.inboundWebhookEvent.create({
      data: {
        source,
        externalId,
        payloadHash,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  async markProcessed(id: string, error?: string): Promise<InboundWebhookEvent> {
    return this.prisma.inboundWebhookEvent.update({
      where: { id },
      data: {
        processedAt: new Date(),
        error: error ?? null,
      },
    });
  }

  async markProcessedByExternalId(
    source: string,
    externalId: string,
    error?: string,
  ): Promise<void> {
    await this.prisma.inboundWebhookEvent.update({
      where: {
        source_externalId: { source, externalId },
      },
      data: {
        processedAt: new Date(),
        error: error ?? null,
      },
    });
  }

  async markFailedByExternalId(
    source: string,
    externalId: string,
    error: string,
  ): Promise<void> {
    await this.prisma.inboundWebhookEvent.update({
      where: {
        source_externalId: { source, externalId },
      },
      data: {
        error,
      },
    });
  }
}

export type { Prisma };
