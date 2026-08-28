import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientStatus, ClientType, Lead } from '@prisma/client';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { TelegramLeadFactory } from './telegram-lead-factory.service';
import { TelegramBotService } from './telegram-bot.service';

describe('TelegramLeadFactory', () => {
  let factory: TelegramLeadFactory;

  const poolUser = { id: 'pool-user-id', email: 'lead-pool@hpl.com' };
  const systemUser = { id: 'system-user-id', email: 'system@hpl.com' };

  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    contact: {
      findFirst: jest.fn(),
    },
    client: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    telegramLeadMetadata: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
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
        TelegramLeadFactory,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TelegramBotService,
          useValue: {
            sendMessageToAdmin: jest.fn().mockResolvedValue({ message_id: 42 }),
            buildAdminAssignmentKeyboard: jest.fn().mockReturnValue({
              inline_keyboard: [],
            }),
          },
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

              if (key === 'TELEGRAM_ADMIN_CHAT_ID') {
                return '12345';
              }

              return undefined;
            }),
          },
        },
      ],
    }).compile();

    factory = module.get(TelegramLeadFactory);
  });

  it('creates Client and Contact for a new phone', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    prisma.client.findFirst.mockResolvedValue(null);

    const createdLead = { id: 'lead-1', title: 'TG-сайт: Иван' } as Lead;

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        client: {
          create: jest.fn().mockResolvedValue({
            id: 'client-1',
            type: ClientType.INDIVIDUAL,
            status: ClientStatus.ACTIVE,
          }),
        },
        contact: { create: jest.fn().mockResolvedValue({ id: 'contact-1' }) },
        lead: { create: jest.fn().mockResolvedValue(createdLead) },
        telegramLeadMetadata: { create: jest.fn().mockResolvedValue({}) },
        activity: { create: jest.fn().mockResolvedValue({}) },
      }),
    );

    const lead = await factory.create({
      telegramUserId: '999',
      telegramUsername: 'ivan',
      formData: {
        name: 'Иван',
        phone: '+998901234567',
        message: 'Нужны панели',
      },
      updateId: '1',
      rawPayload: {},
    });

    expect(lead.id).toBe('lead-1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('reuses existing Client when phone is found', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      client: { id: 'client-existing' },
    });

    const createdLead = { id: 'lead-2' } as Lead;

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        lead: {
          create: jest.fn().mockImplementation(async ({ data }) => {
            expect(data.clientId).toBe('client-existing');
            expect(data.ownerId).toBe(poolUser.id);
            return createdLead;
          }),
        },
        telegramLeadMetadata: {
          create: jest.fn().mockImplementation(async ({ data }) => {
            expect(data.isPendingAssignment).toBe(true);
          }),
        },
        activity: {
          create: jest.fn().mockImplementation(async ({ data }) => {
            expect(data.authorId).toBe(systemUser.id);
          }),
        },
      }),
    );

    const lead = await factory.create({
      telegramUserId: '999',
      formData: { name: 'Иван', phone: '+998901234567', message: 'test' },
      updateId: '2',
      rawPayload: {},
    });

    expect(lead.id).toBe('lead-2');
  });

  it('does not invent installationRequired=false when Telegram did not ask', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    prisma.client.findFirst.mockResolvedValue(null);

    const leadQualificationCreate = jest.fn();

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        client: {
          create: jest.fn().mockResolvedValue({
            id: 'client-1',
            type: ClientType.INDIVIDUAL,
            status: ClientStatus.ACTIVE,
          }),
        },
        contact: { create: jest.fn().mockResolvedValue({ id: 'contact-1' }) },
        lead: { create: jest.fn().mockResolvedValue({ id: 'lead-3' }) },
        panelType: { findFirst: jest.fn() },
        leadQualification: { create: leadQualificationCreate },
        telegramLeadMetadata: { create: jest.fn().mockResolvedValue({}) },
        activity: { create: jest.fn().mockResolvedValue({}) },
      }),
    );

    await factory.create({
      telegramUserId: '999',
      formData: {
        name: 'Иван',
        phone: '+998901234567',
        message: 'Нужны панели',
      },
      updateId: '3',
      rawPayload: {},
    });

    expect(leadQualificationCreate).not.toHaveBeenCalled();
  });

  it('maps a trusted interior preference and leaves installation unknown', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      client: { id: 'client-existing' },
    });

    const leadQualificationCreate = jest.fn().mockResolvedValue({});
    const panelTypeFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'pt-interior' });

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        lead: { create: jest.fn().mockResolvedValue({ id: 'lead-4' }) },
        panelType: { findFirst: panelTypeFindFirst },
        leadQualification: { create: leadQualificationCreate },
        telegramLeadMetadata: { create: jest.fn().mockResolvedValue({}) },
        activity: { create: jest.fn().mockResolvedValue({}) },
      }),
    );

    await factory.create({
      telegramUserId: '999',
      formData: {
        name: 'Иван',
        phone: '+998901234567',
        message: 'test',
        panelTypePreference: 'interior',
      },
      updateId: '4',
      rawPayload: {},
    });

    expect(panelTypeFindFirst).toHaveBeenCalledWith({
      where: { code: 'interior', isActive: true },
      select: { id: true },
    });
    expect(leadQualificationCreate).toHaveBeenCalledWith({
      data: {
        leadId: 'lead-4',
        application: 'INTERIOR',
        panelTypeId: 'pt-interior',
      },
    });
    const created = leadQualificationCreate.mock.calls[0][0].data as {
      installationRequired?: boolean;
      stockOnly?: boolean;
      urgent?: boolean;
    };
    expect(created.installationRequired).toBeUndefined();
    expect(created.stockOnly).toBeUndefined();
    expect(created.urgent).toBeUndefined();
  });
});
