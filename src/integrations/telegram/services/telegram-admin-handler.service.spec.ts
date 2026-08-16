import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RoleName } from '@prisma/client';
import { QUEUE_NAMES } from '../../../common/queues/queue.constants';
import { NotificationService } from '../../../modules/notifications/notification.service';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { compactUuid } from '../telegram.types';
import { TelegramAdminHandlerService } from './telegram-admin-handler.service';
import { TelegramBotService } from './telegram-bot.service';

describe('TelegramAdminHandlerService', () => {
  let service: TelegramAdminHandlerService;

  const poolUser = { id: 'pool-id', email: 'lead-pool@hpl.com' };
  const systemUser = { id: 'system-id', email: 'system@hpl.com' };
  const manager = {
    id: 'manager-id',
    firstName: 'Иван',
    lastName: 'Петров',
    email: 'manager@test.com',
    isActive: true,
  };

  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
    },
    telegramLeadMetadata: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    lead: {
      findUnique: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    leadAssignmentHistory: {
      create: jest.fn(),
    },
    activity: {
      create: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const botService = {
    answerCallbackQuery: jest.fn(),
    editMessageText: jest.fn(),
    editAdminMessage: jest.fn(),
    sendMessage: jest.fn(),
    buildAdminAssignmentKeyboard: jest.fn().mockReturnValue({
      inline_keyboard: [],
    }),
  };

  const notificationService = {
    sendEmail: jest.fn(),
  };

  const assignFallbackQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma.user.findUniqueOrThrow.mockImplementation(async ({ where }) => {
      if (where.email === poolUser.email) {
        return poolUser;
      }

      return systemUser;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramAdminHandlerService,
        { provide: PrismaService, useValue: prisma },
        { provide: TelegramBotService, useValue: botService },
        { provide: NotificationService, useValue: notificationService },
        {
          provide: getQueueToken(QUEUE_NAMES.TELEGRAM_ASSIGN_FALLBACK),
          useValue: assignFallbackQueue,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LEAD_POOL_USER_EMAIL') {
                return poolUser.email;
              }

              if (key === 'SYSTEM_USER_EMAIL') {
                return systemUser.email;
              }

              if (key === 'TELEGRAM_ADMIN_USER_ID') {
                return '999001';
              }

              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(TelegramAdminHandlerService);
  });

  it('assignManager updates lead, metadata, history and activity', async () => {
    prisma.user.findFirst.mockResolvedValue(manager);
    prisma.telegramLeadMetadata.findUnique.mockResolvedValue({
      leadId: 'lead-id',
      isPendingAssignment: true,
    });
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-id',
      title: 'TG lead',
      client: { name: 'Client', phone: '79990001122', contacts: [] },
    });
    prisma.$transaction.mockImplementation(async (callback) => {
      await callback({
        telegramLeadMetadata: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        lead: { update: jest.fn() },
        leadAssignmentHistory: { create: jest.fn() },
        activity: { create: jest.fn() },
      });
      return true;
    });

    await service.assignManager('lead-id', manager.id, {
      adminChatId: '1',
      adminMessageId: '100',
      callbackQueryId: 'cq-1',
    });

    expect(botService.editMessageText).toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('assignManager refuses when lead is already assigned', async () => {
    prisma.user.findFirst.mockResolvedValue(manager);
    prisma.telegramLeadMetadata.findUnique.mockResolvedValue({
      leadId: 'lead-id',
      isPendingAssignment: false,
    });

    await service.assignManager('lead-id', manager.id, {
      adminChatId: '1',
      adminMessageId: '100',
      callbackQueryId: 'cq-1',
    });

    expect(botService.answerCallbackQuery).toHaveBeenCalledWith(
      'cq-1',
      '⚠️ Лид уже распределён',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skipLead creates activity and edits admin message', async () => {
    await service.skipLead('lead-id', {
      adminChatId: '1',
      adminMessageId: '100',
      callbackQueryId: 'cq-2',
    });

    expect(prisma.activity.create).toHaveBeenCalled();
    expect(botService.editMessageText).toHaveBeenCalled();
  });

  it('handleCallbackData parses compact assign callback', async () => {
    const leadId = '11111111-1111-1111-1111-111111111111';
    const assignSpy = jest
      .spyOn(service, 'assignManagerByIndex')
      .mockResolvedValue(undefined);

    await service.handleCallbackData(`a|${compactUuid(leadId)}|0`, {
      adminChatId: '1',
      adminMessageId: '100',
      callbackQueryId: 'cq-3',
      actorUserId: '999001',
    });

    expect(assignSpy).toHaveBeenCalledWith(
      leadId,
      0,
      expect.objectContaining({ callbackQueryId: 'cq-3' }),
    );
  });

  it('denies state-changing callback from an unauthorized Telegram actor', async () => {
    const leadId = '11111111-1111-1111-1111-111111111111';
    const assignSpy = jest
      .spyOn(service, 'assignManagerByIndex')
      .mockResolvedValue(undefined);

    await service.handleCallbackData(`a|${compactUuid(leadId)}|0`, {
      adminChatId: '1',
      adminMessageId: '100',
      callbackQueryId: 'cq-unauthorized',
      actorUserId: '555555',
    });

    expect(assignSpy).not.toHaveBeenCalled();
    expect(botService.answerCallbackQuery).toHaveBeenCalledWith(
      'cq-unauthorized',
      '❌ Недостаточно прав',
    );
  });

  it('allows state-changing callback from the configured Telegram admin', async () => {
    const leadId = '11111111-1111-1111-1111-111111111111';
    const assignSpy = jest
      .spyOn(service, 'assignManagerByIndex')
      .mockResolvedValue(undefined);

    await service.handleCallbackData(`assign:${compactUuid(leadId)}:1`, {
      adminChatId: '1',
      adminMessageId: '100',
      callbackQueryId: 'cq-admin',
      actorUserId: '999001',
    });

    expect(assignSpy).toHaveBeenCalledWith(
      leadId,
      1,
      expect.objectContaining({ callbackQueryId: 'cq-admin' }),
    );
  });

  it('listManagers returns active managers only', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: manager.id,
        firstName: manager.firstName,
        lastName: manager.lastName,
      },
    ]);

    const managers = await service.listManagers();

    expect(managers[0]?.displayName).toBe('Иван Петров');
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { name: RoleName.MANAGER } } },
        }),
      }),
    );
  });
});
