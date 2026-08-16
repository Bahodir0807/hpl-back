import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  ActivityType,
  Lead,
  TaskPriority,
  TaskType,
  TelegramLeadMetadata,
} from '@prisma/client';
import type { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { TelegramBotService } from './telegram-bot.service';

const TELEGRAM_LEAD_SOURCE = 'telegram';
const ESCALATION_MS = 30 * 60 * 1000;

@Injectable()
export class TelegramEscalationService {
  private readonly logger = new Logger(TelegramEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botService: TelegramBotService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  @Cron('*/5 * * * *')
  async handleEscalation(): Promise<void> {
    const poolUser = await this.prisma.user.findUnique({
      where: {
        email: this.configService.get('LEAD_POOL_USER_EMAIL', { infer: true }),
      },
    });

    if (!poolUser) {
      return;
    }

    const staleMetadata = await this.prisma.telegramLeadMetadata.findMany({
      where: {
        isPendingAssignment: true,
        escalatedAt: null,
        createdAt: { lt: new Date(Date.now() - ESCALATION_MS) },
      },
    });

    if (staleMetadata.length === 0) {
      return;
    }

    const leads = await this.prisma.lead.findMany({
      where: {
        id: { in: staleMetadata.map((item) => item.leadId) },
        source: TELEGRAM_LEAD_SOURCE,
        ownerId: poolUser.id,
        createdAt: { lt: new Date(Date.now() - ESCALATION_MS) },
      },
    });

    const metadataByLeadId = new Map(
      staleMetadata.map((item) => [item.leadId, item]),
    );

    for (const lead of leads) {
      const metadata = metadataByLeadId.get(lead.id) ?? null;
      await this.escalateLead(lead, metadata);
    }
  }

  private async escalateLead(
    lead: Lead,
    metadata: TelegramLeadMetadata | null,
  ): Promise<void> {
    if (!metadata?.isPendingAssignment || metadata.escalatedAt) {
      return;
    }

    const systemUser = await this.prisma.user.findUnique({
      where: {
        email: this.configService.get('SYSTEM_USER_EMAIL', { infer: true }),
      },
    });
    const adminUser = await this.prisma.user.findUnique({
      where: {
        email: this.configService.get('ADMIN_USER_EMAIL', { infer: true }),
      },
    });
    const adminChatId = this.configService.get('TELEGRAM_ADMIN_CHAT_ID', {
      infer: true,
    });

    if (adminChatId) {
      await this.botService.sendMessage(
        adminChatId,
        `⏰ Лид #${lead.id} не распределён 30+ мин!\n${lead.title}`,
      );
    }

    if (adminUser && systemUser) {
      const dueDate = new Date();

      await this.prisma.task.create({
        data: {
          type: TaskType.OTHER,
          title: 'Не распределён лид из Telegram',
          description: `Лид #${lead.id} ожидает назначения более 30 минут`,
          relatedType: 'Lead',
          relatedId: lead.id,
          assigneeId: adminUser.id,
          createdById: systemUser.id,
          dueDate,
          originalDueDate: dueDate,
        },
      });
    }

    if (systemUser) {
      await this.prisma.activity.create({
        data: {
          type: ActivityType.NOTE,
          relatedType: 'Lead',
          relatedId: lead.id,
          authorId: systemUser.id,
          metadata: {
            action: 'escalation_sent',
            reason: 'admin_no_assign_30min',
          },
        },
      });
    }

    await this.prisma.telegramLeadMetadata.update({
      where: { leadId: lead.id },
      data: { escalatedAt: new Date() },
    });

    this.logger.warn(`Escalated lead ${lead.id}`);
  }
}
