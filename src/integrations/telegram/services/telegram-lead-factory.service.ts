import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  ClientStatus,
  ClientType,
  HplApplication,
  Lead,
  Prisma,
  RoleName,
} from '@prisma/client';
import { normalizePhone } from '../../../common/utils/phone-normalizer';
import type { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { TelegramFormData } from '../telegram.types';
import { TelegramBotService } from './telegram-bot.service';

/** Lead.source для заявок из Telegram-бота. Фронт фильтрует по значению `telegram`. */
const TELEGRAM_LEAD_SOURCE = 'telegram';

@Injectable()
export class TelegramLeadFactory {
  private readonly logger = new Logger(TelegramLeadFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
    private readonly botService: TelegramBotService,
  ) {}

  async create(input: {
    telegramUserId: string;
    telegramUsername?: string;
    formData: TelegramFormData;
    updateId: string;
    rawPayload: Prisma.InputJsonValue;
  }): Promise<Lead> {
    const poolUser = await this.getPoolUser();
    const systemUser = await this.getSystemUser();

    const existingMetadata = await this.prisma.telegramLeadMetadata.findMany({
      where: {
        telegramUserId: input.telegramUserId,
        isPendingAssignment: true,
      },
    });

    for (const metadata of existingMetadata) {
      const existingLead = await this.prisma.lead.findFirst({
        where: {
          id: metadata.leadId,
          source: TELEGRAM_LEAD_SOURCE,
          ownerId: poolUser.id,
        },
      });

      if (existingLead) {
        await this.notifyAdminDm(existingLead, input.formData);
        return existingLead;
      }
    }

    let client = await this.findClientByPhone(input.formData.phone);

    const lead = await this.prisma.$transaction(async (tx) => {
      if (!client) {
        client = await tx.client.create({
          data: {
            type: ClientType.INDIVIDUAL,
            status: ClientStatus.ACTIVE,
            name: input.formData.name?.trim() || 'Unknown',
            phone: input.formData.phone
              ? normalizePhone(input.formData.phone)
              : undefined,
            ownerId: poolUser.id,
          },
        });

        if (input.formData.phone) {
          await tx.contact.create({
            data: {
              clientId: client.id,
              firstName: input.formData.name?.trim() || 'Unknown',
              phone: normalizePhone(input.formData.phone),
              messenger: input.telegramUsername
                ? `@${input.telegramUsername}`
                : undefined,
              isPrimary: true,
            },
          });
        }
      }

      const lead = await tx.lead.create({
        data: {
          title: `TG-сайт: ${input.formData.name?.trim() || 'Unknown'}`,
          source: TELEGRAM_LEAD_SOURCE,
          needDescription: this.buildDescription(input),
          ownerId: poolUser.id,
          clientId: client.id,
          status: 'NEW',
        },
      });

      const mappedNeed = await this.mapTrustedPanelPreference(
        tx,
        input.formData.panelTypePreference,
      );

      if (mappedNeed) {
        await tx.leadQualification.create({
          data: {
            leadId: lead.id,
            application: mappedNeed.application,
            panelTypeId: mappedNeed.panelTypeId,
          },
        });
      }

      await tx.telegramLeadMetadata.create({
        data: {
          leadId: lead.id,
          telegramUserId: input.telegramUserId,
          telegramUsername: input.telegramUsername,
          rawPayload: input.rawPayload,
          isPendingAssignment: true,
          adminChatId: this.configService.get('TELEGRAM_ADMIN_CHAT_ID', {
            infer: true,
          }),
        },
      });

      await tx.activity.create({
        data: {
          type: 'NOTE',
          relatedType: 'Lead',
          relatedId: lead.id,
          authorId: systemUser.id,
          metadata: {
            source: TELEGRAM_LEAD_SOURCE,
            action: 'incoming_lead',
            updateId: input.updateId,
          },
        },
      });

      return lead;
    });

    await this.notifyAdminDm(lead, input.formData);

    return lead;
  }

  private async notifyAdminDm(
    lead: Lead,
    formData: TelegramFormData,
  ): Promise<void> {
    const adminUserId = this.configService.get('TELEGRAM_ADMIN_USER_ID', {
      infer: true,
    });

    if (!adminUserId) {
      this.logger.warn(
        'TELEGRAM_ADMIN_USER_ID is not configured — skipping admin DM',
      );
      return;
    }

    const existingMeta = await this.prisma.telegramLeadMetadata.findUnique({
      where: { leadId: lead.id },
      select: { adminMessageId: true },
    });

    if (existingMeta?.adminMessageId) {
      return;
    }

    const managers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        roles: { some: { role: { name: RoleName.MANAGER } } },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });

    const text = [
      'Новая заявка из Telegram',
      `Имя: ${this.escapeHtml(formData.name || '—')}`,
      `Телефон: ${this.escapeHtml(formData.phone || '—')}`,
      `Сообщение: ${this.escapeHtml(formData.message || '—')}`,
    ].join('\n');

    try {
      const sent = await this.botService.sendMessageToAdmin(
        text,
        this.botService.buildAdminAssignmentKeyboard(
          lead.id,
          managers.map((manager) => ({
            id: manager.id,
            displayName: `${manager.firstName} ${manager.lastName}`.trim(),
          })),
        ),
      );

      if (!sent?.message_id) {
        return;
      }

      await this.prisma.telegramLeadMetadata.update({
        where: { leadId: lead.id },
        data: {
          adminMessageId: String(sent.message_id),
          adminChatId: adminUserId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send admin DM for lead ${lead.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  private async findClientByPhone(phone?: string): Promise<Client | null> {
    if (!phone?.trim()) {
      return null;
    }

    const normalizedPhone = normalizePhone(phone);

    const contact = await this.prisma.contact.findFirst({
      where: { phone: normalizedPhone },
      include: { client: true },
    });

    if (contact?.client) {
      return contact.client;
    }

    return this.prisma.client.findFirst({
      where: {
        deletedAt: null,
        OR: [{ phone: normalizedPhone }, { phone: phone.trim() }],
      },
    });
  }

  private async getPoolUser() {
    const email = this.configService.get('LEAD_POOL_USER_EMAIL', {
      infer: true,
    });

    return this.prisma.user.findUniqueOrThrow({
      where: { email },
    });
  }

  private async getSystemUser() {
    const email = this.configService.get('SYSTEM_USER_EMAIL', { infer: true });

    return this.prisma.user.findUniqueOrThrow({
      where: { email },
    });
  }

  private async mapTrustedPanelPreference(
    tx: Prisma.TransactionClient,
    rawPreference?: string,
  ): Promise<{
    application: HplApplication | null;
    panelTypeId: string | null;
  } | null> {
    const normalized = rawPreference?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const interiorAliases = new Set([
      'interior',
      'интерьер',
      'интерьерные',
      'inside',
    ]);
    const exteriorAliases = new Set([
      'exterior',
      'экстерьер',
      'экстерьерные',
      'outside',
      'fasad',
      'фасад',
    ]);
    const laboratoryAliases = new Set(['laboratory', 'лабораторные', 'lab']);

    let application: HplApplication | null = null;
    let panelTypeCode: string | null = null;

    if (interiorAliases.has(normalized)) {
      application = HplApplication.INTERIOR;
      panelTypeCode = 'interior';
    } else if (exteriorAliases.has(normalized)) {
      application = HplApplication.EXTERIOR_WITH_UV;
      panelTypeCode = 'exterior_with_uv';
    } else if (laboratoryAliases.has(normalized)) {
      application = HplApplication.LABORATORY;
      panelTypeCode = 'laboratory';
    } else if (
      normalized === 'furniture' ||
      normalized === 'мебельный' ||
      normalized === 'мебель'
    ) {
      application = HplApplication.FURNITURE;
      panelTypeCode = 'furniture';
    } else {
      return null;
    }

    const panelType = panelTypeCode
      ? await tx.panelType.findFirst({
          where: { code: panelTypeCode, isActive: true },
          select: { id: true },
        })
      : null;

    return {
      application,
      panelTypeId: panelType?.id ?? null,
    };
  }

  private buildDescription(input: {
    formData: TelegramFormData;
    telegramUsername?: string;
  }): string {
    const form = input.formData;

    return [
      'Заявка с сайта',
      `Имя: ${form.name || '—'}`,
      `Тел: ${form.phone || '—'}`,
      `Сообщение: ${form.message || '—'}`,
      `Предпочтение: ${form.panelTypePreference || 'не указано'}`,
      `TG: @${input.telegramUsername || 'no_username'}`,
    ].join('\n');
  }
}
