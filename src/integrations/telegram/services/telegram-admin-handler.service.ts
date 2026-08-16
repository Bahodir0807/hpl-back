import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActivityType,
  LeadStatus,
  RoleName,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../common/queues/queue.constants';
import type { Env } from '../../../config/env.schema';
import { NotificationService } from '../../../modules/notifications/notification.service';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { expandUuid, type TelegramAssignFallbackJob } from '../telegram.types';
import { TelegramBotService } from './telegram-bot.service';

type CallbackContext = {
  adminChatId: string;
  adminMessageId: string;
  callbackQueryId: string;
};

const ASSIGNMENT_FALLBACK_DELAY_MS = 10 * 60 * 1000;

@Injectable()
export class TelegramAdminHandlerService {
  private readonly logger = new Logger(TelegramAdminHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botService: TelegramBotService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService<Env, true>,
    @InjectQueue(QUEUE_NAMES.TELEGRAM_ASSIGN_FALLBACK)
    private readonly assignFallbackQueue: Queue<TelegramAssignFallbackJob>,
  ) {}

  async scheduleAssignmentFallback(leadId: string): Promise<void> {
    const jobId = `telegram-assign-fallback-${leadId}`;

    try {
      await this.assignFallbackQueue.add(
        'assign-least-loaded',
        { leadId },
        {
          delay: ASSIGNMENT_FALLBACK_DELAY_MS,
          jobId,
          removeOnComplete: true,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule assign fallback for ${leadId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async assignLeastLoadedManager(leadId: string): Promise<void> {
    const meta = await this.prisma.telegramLeadMetadata.findUnique({
      where: { leadId },
    });

    if (!meta?.isPendingAssignment) {
      return;
    }

    const manager = await this.findLeastLoadedManager();

    if (!manager) {
      this.logger.warn(
        `No active manager found for fallback assign of lead ${leadId}`,
      );
      return;
    }

    const context: CallbackContext | undefined =
      meta.adminChatId && meta.adminMessageId
        ? {
            adminChatId: meta.adminChatId,
            adminMessageId: meta.adminMessageId,
            callbackQueryId: '',
          }
        : undefined;

    await this.assignManager(leadId, manager.id, context, 'telegram_assign_fallback');
  }

  async assignManager(
    leadId: string,
    managerId: string,
    context?: CallbackContext,
    source = 'telegram_admin_button',
  ): Promise<void> {
    const systemUser = await this.getSystemUser();
    const poolUser = await this.getPoolUser();

    const manager = await this.prisma.user.findFirst({
      where: {
        id: managerId,
        isActive: true,
        roles: { some: { role: { name: RoleName.MANAGER } } },
      },
    });

    if (!manager) {
      await this.answerCallback(context, '❌ Менеджер не найден');
      return;
    }

    const meta = await this.prisma.telegramLeadMetadata.findUnique({
      where: { leadId },
    });

    if (!meta?.isPendingAssignment) {
      await this.answerCallback(context, '⚠️ Лид уже распределён');
      await this.editAdminMessage(context, '⚠️ Лид уже распределён');
      return;
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.telegramLeadMetadata.updateMany({
        where: { leadId, isPendingAssignment: true },
        data: {
          isPendingAssignment: false,
          assignedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await tx.lead.update({
        where: { id: leadId },
        data: { ownerId: managerId },
      });

      await tx.leadAssignmentHistory.create({
        data: {
          leadId,
          previousOwnerId: poolUser.id,
          newOwnerId: managerId,
          assignedById: systemUser.id,
        },
      });

      await tx.activity.create({
        data: {
          type: ActivityType.OWNER_CHANGED,
          relatedType: 'Lead',
          relatedId: leadId,
          authorId: systemUser.id,
          metadata: {
            source,
            managerId,
            managerName: `${manager.firstName} ${manager.lastName}`.trim(),
          },
        },
      });

      return true;
    });

    if (!claimed) {
      await this.answerCallback(context, '⚠️ Лид уже распределён');
      return;
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: { contacts: { where: { isPrimary: true }, take: 1 } },
        },
      },
    });

    const managerName = `${manager.firstName} ${manager.lastName}`.trim();
    const contactPhone =
      lead?.client?.contacts[0]?.phone ?? lead?.client?.phone ?? '—';
    const clientName = lead?.client?.name ?? lead?.title ?? 'Клиент';
    const messageText =
      source === 'telegram_assign_fallback'
        ? `Автоназначение: лид ушёл на ${this.escapeHtml(managerName)} (не было реакции 10 мин)`
        : `Назначено на ${this.escapeHtml(managerName)}`;

    await this.syncAdminMessages(leadId, context, messageText);
    await this.answerCallback(context, '✅ Назначено');

    await this.prisma.notification.create({
      data: {
        userId: managerId,
        title: 'Вам назначен новый лид из Telegram',
        message: `Заявка от ${clientName}, тел: ${contactPhone}`,
        type: 'lead_assigned',
        relatedType: 'Lead',
        relatedId: leadId,
      },
    });

    await this.notifyAssignedManager(manager, clientName, contactPhone, leadId);
  }

  async assignManagerByIndex(
    leadId: string,
    managerIndex: number,
    context: CallbackContext,
  ): Promise<void> {
    const managers = await this.listManagers();
    const manager = managers[managerIndex];

    if (!manager) {
      await this.answerCallback(context, '❌ Менеджер не найден');
      return;
    }

    await this.assignManager(leadId, manager.id, context);
  }

  async skipLead(leadId: string, context: CallbackContext): Promise<void> {
    const systemUser = await this.getSystemUser();

    await this.prisma.activity.create({
      data: {
        type: ActivityType.NOTE,
        relatedType: 'Lead',
        relatedId: leadId,
        authorId: systemUser.id,
        metadata: { action: 'skipped_by_admin', leadId },
      },
    });

    await this.syncAdminMessages(leadId, context, 'Лид пропущен');
    await this.botService.answerCallbackQuery(
      context.callbackQueryId,
      '⏭ Пропущено',
    );
  }

  async handleCallbackData(
    data: string,
    context: CallbackContext,
  ): Promise<void> {
    if (data.includes(':') && !data.includes('|')) {
      await this.handleColonCallback(data, context);
      return;
    }

    const [action, compactLeadId, thirdPart] = data.split('|');

    if (!action || !compactLeadId) {
      await this.answerCallback(context, 'Некорректные данные кнопки');
      return;
    }

    const leadId = expandUuid(compactLeadId);

    if (action === 'a') {
      const managerIndex = Number.parseInt(thirdPart ?? '', 10);

      if (Number.isNaN(managerIndex)) {
        await this.assignManager(leadId, thirdPart, context);
        return;
      }

      await this.assignManagerByIndex(leadId, managerIndex, context);
      return;
    }

    if (action === 's') {
      await this.skipLead(leadId, context);
      return;
    }

    if (action === 'more') {
      await this.showMoreManagers(leadId, context);
    }
  }

  private async handleColonCallback(
    data: string,
    context: CallbackContext,
  ): Promise<void> {
    const [action, compactLeadId, thirdPart] = data.split(':');

    if (!action || !compactLeadId) {
      await this.answerCallback(context, 'Некорректные данные кнопки');
      return;
    }

    let leadId: string;

    try {
      leadId = expandUuid(compactLeadId);
    } catch {
      await this.answerCallback(context, 'Некорректные данные кнопки');
      return;
    }

    if (action === 'assign') {
      const managerIndex = Number.parseInt(thirdPart ?? '', 10);

      if (Number.isNaN(managerIndex)) {
        await this.assignManager(leadId, thirdPart, context);
        return;
      }

      await this.assignManagerByIndex(leadId, managerIndex, context);
      return;
    }

    if (action === 'skip') {
      await this.skipLead(leadId, context);
      return;
    }

    if (action === 'more_managers') {
      await this.showMoreManagers(leadId, context);
    }
  }

  private async showMoreManagers(
    leadId: string,
    context: CallbackContext,
  ): Promise<void> {
    const managers = await this.listManagers();

    if (managers.length <= 3) {
      await this.answerCallback(context, 'Все менеджеры уже показаны');
      return;
    }

    const keyboard = this.botService.buildAdminAssignmentKeyboard(
      leadId,
      managers,
      3,
    );

    await this.botService.editMessageText(
      context.adminChatId,
      context.adminMessageId,
      'Назначить менеджера:',
      keyboard,
    );
    await this.answerCallback(context, 'Ещё менеджеры');
  }

  async listManagers(): Promise<Array<{ id: string; displayName: string }>> {
    const managers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        roles: { some: { role: { name: RoleName.MANAGER } } },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });

    return managers.map((manager) => ({
      id: manager.id,
      displayName: `${manager.firstName} ${manager.lastName}`.trim(),
    }));
  }

  private async findLeastLoadedManager(): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null> {
    const poolUser = await this.getPoolUser();
    const managers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: poolUser.id },
        roles: { some: { role: { name: RoleName.MANAGER } } },
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (managers.length === 0) {
      return null;
    }

    const counts = await this.prisma.lead.groupBy({
      by: ['ownerId'],
      where: {
        deletedAt: null,
        status: { in: [LeadStatus.NEW, LeadStatus.IN_PROGRESS] },
        ownerId: { in: managers.map((manager) => manager.id) },
      },
      _count: { id: true },
    });

    const countByOwner = new Map(
      counts.map((row) => [row.ownerId, row._count.id]),
    );

    return [...managers].sort((left, right) => {
      const leftCount = countByOwner.get(left.id) ?? 0;
      const rightCount = countByOwner.get(right.id) ?? 0;
      return leftCount - rightCount;
    })[0];
  }

  private async answerCallback(
    context: CallbackContext | undefined,
    text: string,
  ): Promise<void> {
    if (!context?.callbackQueryId) {
      return;
    }

    await this.botService.answerCallbackQuery(context.callbackQueryId, text);
  }

  private async syncAdminMessages(
    leadId: string,
    context: CallbackContext | undefined,
    text: string,
  ): Promise<void> {
    const edited = new Set<string>();

    if (context?.adminChatId && context.adminMessageId) {
      await this.botService.editMessageText(
        context.adminChatId,
        context.adminMessageId,
        text,
      );
      edited.add(`${context.adminChatId}:${context.adminMessageId}`);
    }

    const adminUserId = this.configService.get('TELEGRAM_ADMIN_USER_ID', {
      infer: true,
    });

    if (!adminUserId) {
      return;
    }

    const meta = await this.prisma.telegramLeadMetadata.findUnique({
      where: { leadId },
      select: { adminMessageId: true, adminChatId: true },
    });

    if (!meta?.adminMessageId) {
      return;
    }

    const dmKey = `${adminUserId}:${meta.adminMessageId}`;

    if (edited.has(dmKey)) {
      return;
    }

    await this.botService.editAdminMessage(
      Number.parseInt(meta.adminMessageId, 10),
      text,
    );
  }

  private async notifyAssignedManager(
    manager: { id: string; email: string; telegramId?: string | null },
    clientName: string,
    contactPhone: string,
    leadId: string,
  ): Promise<void> {
    const telegramId = manager.telegramId;

    if (telegramId) {
      await this.botService.sendMessage(
        telegramId,
        `Вам назначен новый лид из Telegram\nКлиент: ${this.escapeHtml(clientName)}\nТел: ${this.escapeHtml(contactPhone)}`,
      );
      return;
    }

    if (manager.email) {
      this.notificationService.sendEmail({
        to: manager.email,
        subject: 'Вам назначен новый лид из Telegram',
        text: `Заявка от ${clientName}, тел: ${contactPhone}\nЛид: ${leadId}`,
      });
    }
  }

  private async editAdminMessage(
    context: CallbackContext | undefined,
    text: string,
  ): Promise<void> {
    if (!context?.adminChatId || !context.adminMessageId) {
      return;
    }

    await this.botService.editMessageText(
      context.adminChatId,
      context.adminMessageId,
      text,
    );
  }

  private async getSystemUser() {
    const email = this.configService.get('SYSTEM_USER_EMAIL', { infer: true });

    return this.prisma.user.findUniqueOrThrow({
      where: { email },
    });
  }

  private async getPoolUser() {
    const email = this.configService.get('LEAD_POOL_USER_EMAIL', { infer: true });

    return this.prisma.user.findUniqueOrThrow({
      where: { email },
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
