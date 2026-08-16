import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { QUEUE_NAMES } from '../../common/queues/queue.constants';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  TelegramCallbackQueryDto,
  TelegramMessageDto,
  TelegramUpdateDto,
} from './dto/telegram-webhook.dto';
import { IdempotencyService } from './services/idempotency.service';
import { TelegramAdminHandlerService } from './services/telegram-admin-handler.service';
import { TelegramBotService } from './services/telegram-bot.service';
import { TelegramLeadFactory } from './services/telegram-lead-factory.service';
import { TelegramFormData } from './telegram.types';

const TELEGRAM_SOURCE = 'telegram';

@Processor(QUEUE_NAMES.TELEGRAM_INCOMING, {
  concurrency: 5,
})
export class TelegramIncomingProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramIncomingProcessor.name);

  constructor(
    private readonly leadFactory: TelegramLeadFactory,
    private readonly adminHandler: TelegramAdminHandlerService,
    private readonly botService: TelegramBotService,
    private readonly idempotency: IdempotencyService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job<TelegramUpdateDto>): Promise<{ status: string }> {
    const update = job.data;
    const externalId = String(update.update_id);

    try {
      if (update.callback_query) {
        await this.handleCallback(update.callback_query);
      } else if (update.message) {
        await this.handleMessage(update.message, externalId);
      }

      await this.idempotency.markProcessedByExternalId(
        TELEGRAM_SOURCE,
        externalId,
      );

      return { status: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job ${job.id} failed: ${message}`, error instanceof Error ? error.stack : undefined);
      await this.idempotency.markFailedByExternalId(
        TELEGRAM_SOURCE,
        externalId,
        message,
      );
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<TelegramUpdateDto> | undefined, error: Error): void {
    this.logger.error(
      `Job ${job?.id ?? 'unknown'} failed: ${error.message}`,
      error.stack,
    );
  }

  private async handleMessage(
    message: TelegramMessageDto,
    updateId: string,
  ): Promise<void> {
    const formData = this.parseFormData(message);
    const rawPayload = {
      message,
      formData,
      updateId,
    } as unknown as Prisma.InputJsonValue;

    const lead = await this.leadFactory.create({
      telegramUserId: String(message.from.id),
      telegramUsername: message.from.username,
      formData,
      updateId,
      rawPayload,
    });

    await this.adminHandler.scheduleAssignmentFallback(lead.id);

    const managers = await this.adminHandler.listManagers();
    const adminChatId = this.configService.get('TELEGRAM_ADMIN_CHAT_ID', {
      infer: true,
    });

    if (!adminChatId) {
      this.logger.warn('TELEGRAM_ADMIN_CHAT_ID is not configured');
    } else {
      const sentMessage = await this.botService.sendLeadToAdmin(
        adminChatId,
        lead,
        formData,
        managers,
      );

      const meta = await this.prisma.telegramLeadMetadata.findUnique({
        where: { leadId: lead.id },
        select: { adminChatId: true, adminMessageId: true },
      });
      const adminUserId = this.configService.get('TELEGRAM_ADMIN_USER_ID', {
        infer: true,
      });
      const dmAlreadyStored =
        Boolean(adminUserId) &&
        meta?.adminChatId === adminUserId &&
        Boolean(meta?.adminMessageId);

      if (sentMessage.message_id && !dmAlreadyStored) {
        await this.prisma.telegramLeadMetadata.update({
          where: { leadId: lead.id },
          data: {
            adminMessageId: String(sentMessage.message_id),
            adminChatId,
          },
        });
      }
    }

    if (!adminChatId) {
      return;
    }

    const adminUser = await this.findAdminUser();

    if (adminUser) {
      await this.prisma.notification.create({
        data: {
          userId: adminUser.id,
          title: 'Новая заявка из Telegram требует распределения',
          message: `Новая заявка: ${lead.title}`,
          type: 'new_telegram_lead_pending',
          relatedType: 'Lead',
          relatedId: lead.id,
        },
      });
    }
  }

  private async handleCallback(
    callback: TelegramCallbackQueryDto,
  ): Promise<void> {
    const adminChatId = String(callback.message?.chat.id ?? '');
    const adminMessageId = String(callback.message?.message_id ?? '');

    await this.adminHandler.handleCallbackData(callback.data, {
      adminChatId,
      adminMessageId,
      callbackQueryId: callback.id,
    });
  }

  private parseFormData(message: TelegramMessageDto): TelegramFormData {
    if (message.text) {
      try {
        const parsed: unknown = JSON.parse(message.text);

        if (typeof parsed === 'object' && parsed !== null) {
          const record = parsed as Record<string, unknown>;
          const nestedForm =
            typeof record.form_data === 'object' && record.form_data !== null
              ? (record.form_data as Record<string, unknown>)
              : record;

          return {
            name:
              typeof nestedForm.name === 'string'
                ? nestedForm.name
                : message.from.first_name,
            phone:
              typeof nestedForm.phone === 'string'
                ? nestedForm.phone
                : message.contact?.phone_number,
            message:
              typeof nestedForm.message === 'string' ? nestedForm.message : '',
            panelTypePreference:
              typeof nestedForm.panelTypePreference === 'string'
                ? nestedForm.panelTypePreference
                : undefined,
            sourcePage:
              typeof nestedForm.sourcePage === 'string'
                ? nestedForm.sourcePage
                : undefined,
          };
        }
      } catch {
        // plain text fallback below
      }
    }

    return {
      name: message.from.first_name || 'Unknown',
      phone: message.contact?.phone_number,
      message: message.text || '',
    };
  }

  private async findAdminUser() {
    return this.prisma.user.findFirst({
      where: {
        email: this.configService.get('ADMIN_USER_EMAIL', { infer: true }),
        isActive: true,
      },
    });
  }
}
