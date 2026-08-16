import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { QualifyLeadDto } from './dto/qualify-lead.dto';
import { LeadsService } from './leads.service';

describe('LeadsService.qualify Stage-1 lifecycle', () => {
  const prisma = {
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    leadQualification: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    deal: {
      create: jest.fn(),
    },
    activity: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    task: {
      create: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const leadQualificationService = {
    upsertInTx: jest.fn(),
    assertStage1Complete: jest.fn(),
  };

  const ownedLead = {
    id: 'lead-id',
    title: 'Lobby HPL',
    ownerId: 'owner-id',
    status: LeadStatus.NEW,
    dealId: null,
    deletedAt: null,
  };

  const qualifyDto = {
    clientId: 'client-id',
    projectObjectId: 'object-id',
    needDescription: 'HPL panels for lobby',
    estimatedAmount: 125000,
    targetDate: new Date('2026-09-01T00:00:00.000Z'),
    decisionMakerContact: 'Chief architect',
  } as QualifyLeadDto;

  const qualifiedLead = {
    ...ownedLead,
    ...qualifyDto,
    status: LeadStatus.QUALIFIED,
    dealId: null,
    deal: null,
  };

  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadsService(
      prisma as never,
      leadQualificationService as never,
    );
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    leadQualificationService.upsertInTx.mockResolvedValue({});
    leadQualificationService.assertStage1Complete.mockReset();
    leadQualificationService.assertStage1Complete.mockImplementation(
      () => undefined,
    );
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.leadQualification.findUnique.mockResolvedValue({
      leadId: 'lead-id',
      installationRequired: false,
    });
    prisma.user.findUnique.mockResolvedValue({
      managerId: 'head-id',
      manager: { id: 'head-id', isActive: true },
    });
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.task.create.mockResolvedValue({ id: 'task-id' });
    prisma.notification.create.mockResolvedValue({});
    prisma.lead.findUnique.mockResolvedValue(qualifiedLead);
    prisma.lead.findUniqueOrThrow.mockResolvedValue(qualifiedLead);
  });

  it('transitions a complete Stage-1 lead to QUALIFIED without creating a Deal', async () => {
    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(result.dealId).toBeNull();
    expect(prisma.deal.create).not.toHaveBeenCalled();
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead-id',
        deletedAt: null,
        dealId: null,
        status: { in: [LeadStatus.NEW, LeadStatus.IN_PROGRESS] },
      },
      data: expect.objectContaining({
        status: LeadStatus.QUALIFIED,
        clientId: qualifyDto.clientId,
      }),
    });
    expect(prisma.lead.updateMany.mock.calls[0][0].data.dealId).toBeUndefined();
    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'STATUS_CHANGED',
        metadata: { action: 'lead_qualified_stage1' },
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'LEAD_QUALIFIED_STAGE1',
        entityType: 'Lead',
        oldValue: { status: LeadStatus.NEW },
        newValue: { status: LeadStatus.QUALIFIED },
      }),
    });
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'OTHER',
        relatedType: 'Lead',
        relatedId: 'lead-id',
        assigneeId: 'head-id',
        title: 'Stage 2 commercial qualification: Lobby HPL',
      }),
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'owner-id',
        title: 'Stage 1 qualification complete',
      }),
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'head-id',
        title: 'Stage 2 commercial qualification required',
      }),
    });
  });

  it('assigns the Stage-2 handoff to owner.managerId when a supervisor exists', async () => {
    await service.qualify('lead-id', qualifyDto, 'owner-id', ['leads:qualify']);

    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assigneeId: 'head-id',
        relatedType: 'Lead',
        title: 'Stage 2 commercial qualification: Lobby HPL',
      }),
    });
    expect(prisma.task.create.mock.calls[0][0].data.assigneeId).not.toBe(
      'owner-id',
    );
  });

  it('does not assign Stage-2 to the ordinary owner when managerId is absent', async () => {
    prisma.user.findUnique.mockResolvedValue({
      managerId: null,
      manager: null,
    });

    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(result.dealId).toBeNull();
    expect(prisma.lead.updateMany).toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'owner-id',
        title: 'Stage 1 qualification complete',
      }),
    });
    expect(prisma.notification.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Stage 2 commercial qualification required',
        }),
      }),
    );
    expect(prisma.notification.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'owner-id',
          title: 'Stage 2 commercial qualification required',
        }),
      }),
    );
  });

  it('rejects Stage-1 when installationRequired is unknown', async () => {
    leadQualificationService.assertStage1Complete.mockImplementation(() => {
      throw new BadRequestException({
        message: 'Lead Stage-1 HPL qualification is incomplete',
        missingFields: ['installationRequired'],
      });
    });

    await expect(
      service.qualify('lead-id', qualifyDto, 'owner-id', ['leads:qualify']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('allows qualification without supplier, quality, FX or price fields', async () => {
    await service.qualify('lead-id', qualifyDto, 'owner-id', ['leads:qualify']);

    expect(prisma.deal.create).not.toHaveBeenCalled();
    expect(prisma.lead.updateMany).toHaveBeenCalled();
  });

  it('returns the existing QUALIFIED lead on a repeated qualify without side effects', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      status: LeadStatus.QUALIFIED,
    });

    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.activity.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('does not create a Deal when two qualifies race and the loser observes QUALIFIED', async () => {
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    prisma.lead.findUnique.mockResolvedValue(qualifiedLead);

    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(result.dealId).toBeNull();
    expect(prisma.deal.create).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects qualify on a converted lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      status: LeadStatus.CONVERTED,
      dealId: 'deal-id',
    });

    await expect(
      service.qualify('lead-id', qualifyDto, 'owner-id', ['leads:qualify']),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('rejects qualify on an unqualified lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      status: LeadStatus.UNQUALIFIED,
    });

    await expect(
      service.qualify('lead-id', qualifyDto, 'owner-id', ['leads:qualify']),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('denies qualify when the caller cannot access the lead', async () => {
    await expect(
      service.qualify('lead-id', qualifyDto, 'stranger-id', ['leads:qualify']),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
