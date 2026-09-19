import { ForbiddenException } from '@nestjs/common';
import { LeadStatus, LossReason } from '@prisma/client';
import { LeadsService } from './leads.service';

describe('LeadsService authorization', () => {
  const prisma = {
    lead: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    leadAssignmentHistory: {
      create: jest.fn(),
    },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findMany: jest.fn() },
    task: { findMany: jest.fn(), create: jest.fn() },
    leadEngineeringAssignment: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const ownedLead = {
    id: 'lead-id',
    ownerId: 'owner-id',
    status: LeadStatus.NEW,
    deletedAt: null,
  };

  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadsService(
      prisma as never,
      {
        upsertInTx: jest.fn(),
        assertStage1Complete: jest.fn(),
      } as never,
      {
        syncFromQualificationInTx: jest.fn(),
        notifyRequestSubmittedSafe: jest.fn(),
      } as never,
    );
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);
  });

  it('rejects create-time ownerId assignment without leads:assign', async () => {
    await expect(
      service.create(
        {
          title: 'Foreign lead',
          source: 'web',
          ownerId: 'other-manager',
        },
        'manager-id',
        ['leads:create'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects assign when the caller cannot access the lead', async () => {
    await expect(
      service.assign('lead-id', { newOwnerId: 'new-owner' }, 'stranger-id', [
        'leads:assign',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the owner to assign their lead', async () => {
    prisma.lead.findUniqueOrThrow.mockResolvedValue(ownedLead);
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.lead.update.mockResolvedValue({
      ...ownedLead,
      ownerId: 'new-owner',
    });

    await service.assign('lead-id', { newOwnerId: 'new-owner' }, 'owner-id', [
      'leads:assign',
    ]);

    expect(prisma.lead.update).toHaveBeenCalled();
  });

  it('allows a privileged user with leads:read_all to read another manager lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      assignmentHistory: [],
    });

    await expect(
      service.findOne('lead-id', 'head-id', ['leads:read', 'leads:read_all']),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'lead-id',
      }),
    );
  });

  it('reopens ProjectObject stage/deadline and qualification vent-facade answers', async () => {
    const expectedDate = new Date('2026-11-15T00:00:00.000Z');
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      assignmentHistory: [],
      projectObject: {
        id: 'object-id',
        name: 'Школа №12',
        address: 'Ташкент',
        stage: 'Скоро фасад',
        expectedDate,
      },
      qualification: {
        ventFacadeExists: true,
        ventFacadeKitRequired: false,
      },
    });

    const result = await service.findOne('lead-id', 'owner-id', ['leads:read']);

    expect(prisma.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          projectObject: {
            select: expect.objectContaining({
              stage: true,
              expectedDate: true,
            }),
          },
        }),
      }),
    );
    expect(result.projectObject).toEqual(
      expect.objectContaining({
        stage: 'Скоро фасад',
        expectedDate,
      }),
    );
    expect(result.qualification).toEqual(
      expect.objectContaining({
        ventFacadeExists: true,
        ventFacadeKitRequired: false,
      }),
    );
  });

  it('persists server-derived structured loss data and creates HEAD recovery for PRICE', async () => {
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    prisma.lead.findUniqueOrThrow.mockResolvedValue({
      ...ownedLead,
      status: LeadStatus.LOST,
      lostReasonCode: LossReason.PRICE,
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'head-id' }]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.create.mockResolvedValue({ id: 'recovery-id' });

    await service.lose('lead-id', { reason: LossReason.PRICE }, 'owner-id', [
      'leads:update',
    ]);

    expect(prisma.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lostReasonCode: LossReason.PRICE,
          lostById: 'owner-id',
          lostAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
  });

  it('records COMPETITOR without creating a recovery task', async () => {
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    prisma.lead.findUniqueOrThrow.mockResolvedValue(ownedLead);

    await service.lose(
      'lead-id',
      { reason: LossReason.COMPETITOR },
      'owner-id',
      ['leads:update'],
    );

    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('requires a non-empty comment for OTHER', async () => {
    await expect(
      service.lose(
        'lead-id',
        { reason: LossReason.OTHER, comment: '   ' },
        'owner-id',
        ['leads:update'],
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('denies a foreign Manager from losing the Lead', async () => {
    await expect(
      service.lose('lead-id', { reason: LossReason.PRICE }, 'foreign-id', [
        'leads:update',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects MANAGER create-time targetDate without commercial authority', async () => {
    await expect(
      service.create(
        {
          title: 'Timeline leak',
          source: 'web',
          targetDate: new Date('2026-10-01T00:00:00.000Z'),
        },
        'manager-id',
        ['leads:create'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects MANAGER PATCH of targetDate without commercial authority', async () => {
    await expect(
      service.update(
        'lead-id',
        { targetDate: new Date('2026-10-01T00:00:00.000Z') },
        'owner-id',
        ['leads:update'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('lets an assigned engineer read a lead without becoming owner', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-1',
      quotes: [{ id: 'quote-1' }],
      managerCommercialNote: 'secret',
    });
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
    });

    const result = await service.findOne('lead-id', 'engineer-1', [
      'leads:read',
      'engineering:read',
    ]);

    expect(result).not.toHaveProperty('quotes');
    expect(result).not.toHaveProperty('managerCommercialNote');
  });

  it('denies an engineer without an active assignment', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-1',
    });

    await expect(
      service.findOne('lead-id', 'engineer-1', [
        'leads:read',
        'engineering:read',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
