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
      update: jest.fn(),
    },
    contact: {
      findUnique: jest.fn(),
    },
    projectObject: {
      findUnique: jest.fn(),
      update: jest.fn(),
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
    dealStageHistory: { create: jest.fn() },
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
    estimatedAmount: 999999,
    targetDate: new Date('2026-12-01T00:00:00.000Z'),
  };

  const qualifyDto = {
    clientId: 'client-id',
    projectObjectId: 'object-id',
    needDescription: 'HPL panels for lobby',
    decisionMakerContact: 'Chief architect',
  } as QualifyLeadDto;

  const qualifiedLead = {
    ...ownedLead,
    ...qualifyDto,
    status: LeadStatus.QUALIFIED,
    dealId: 'deal-id',
    deal: { id: 'deal-id', title: 'Lobby HPL' },
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
    prisma.contact.findUnique.mockResolvedValue({
      id: 'contact-id',
      clientId: 'client-id',
    });
    prisma.projectObject.findUnique.mockResolvedValue({
      id: 'object-id',
      clientId: 'client-id',
    });
    prisma.projectObject.update.mockResolvedValue({});
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    prisma.lead.update.mockResolvedValue({});
    prisma.deal.create.mockResolvedValue({ id: 'deal-id', title: 'Lobby HPL' });
    prisma.dealStageHistory.create.mockResolvedValue({});
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.task.create.mockResolvedValue({ id: 'task-id' });
    prisma.notification.create.mockResolvedValue({});
    prisma.lead.findUnique.mockResolvedValue(qualifiedLead);
    prisma.lead.findUniqueOrThrow.mockResolvedValue(qualifiedLead);
  });

  it('transitions a complete Stage-1 lead to QUALIFIED and creates its Deal', async () => {
    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(result.dealId).toBe('deal-id');
    expect(prisma.deal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: qualifyDto.clientId,
        ownerId: 'owner-id',
        stage: 'QUALIFICATION',
      }),
    });
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-id' },
      data: { dealId: 'deal-id' },
    });
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
    expect(
      prisma.lead.updateMany.mock.calls[0][0].data.estimatedAmount,
    ).toBeUndefined();
    expect(
      prisma.lead.updateMany.mock.calls[0][0].data.targetDate,
    ).toBeUndefined();
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
    expect(result.dealId).toBe('deal-id');
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

    expect(prisma.deal.create).toHaveBeenCalledTimes(1);
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

  it('does not create a duplicate Deal when two qualifies race', async () => {
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    prisma.lead.findUnique.mockResolvedValue(qualifiedLead);

    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(result.dealId).toBe('deal-id');
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

  it('qualifies without estimatedAmount', async () => {
    const result = await service.qualify(
      'lead-id',
      { ...qualifyDto } as QualifyLeadDto,
      'owner-id',
      ['leads:qualify'],
    );

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(
      prisma.lead.updateMany.mock.calls[0][0].data.estimatedAmount,
    ).toBeUndefined();
  });

  it('qualifies without targetDate and does not overwrite historical timeline', async () => {
    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.status).toBe(LeadStatus.QUALIFIED);
    expect(
      prisma.lead.updateMany.mock.calls[0][0].data.targetDate,
    ).toBeUndefined();
  });

  it('does not require estimatedAmount or targetDate for Stage-1 completeness', async () => {
    await expect(
      service.qualify('lead-id', qualifyDto, 'owner-id', ['leads:qualify']),
    ).resolves.toEqual(
      expect.objectContaining({ status: LeadStatus.QUALIFIED }),
    );
  });

  it('persists contactId in the same Stage-1 claim as client and project', async () => {
    await service.qualify(
      'lead-id',
      { ...qualifyDto, contactId: 'contact-id' } as QualifyLeadDto,
      'owner-id',
      ['leads:qualify'],
    );

    expect(prisma.contact.findUnique).toHaveBeenCalledWith({
      where: { id: 'contact-id' },
      select: { id: true, clientId: true },
    });
    expect(prisma.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-id',
          contactId: 'contact-id',
          projectObjectId: 'object-id',
          status: LeadStatus.QUALIFIED,
        }),
      }),
    );
  });

  it('updates the selected project object stage and expected date in the qualification transaction', async () => {
    const objectExpectedDate = new Date('2026-11-15T00:00:00.000Z');

    await service.qualify(
      'lead-id',
      {
        ...qualifyDto,
        objectStage: 'Скоро фасад',
        objectExpectedDate,
      } as QualifyLeadDto,
      'owner-id',
      ['leads:qualify'],
    );

    expect(prisma.projectObject.findUnique).toHaveBeenCalledWith({
      where: { id: 'object-id' },
      select: { id: true, clientId: true },
    });
    expect(prisma.projectObject.update).toHaveBeenCalledWith({
      where: { id: 'object-id' },
      data: {
        stage: 'Скоро фасад',
        expectedDate: objectExpectedDate,
      },
    });
    expect(prisma.lead.updateMany).toHaveBeenCalled();
  });

  it.each([
    [true, false],
    [false, true],
    [null, null],
  ] as const)(
    'passes ventFacadeExists=%s and ventFacadeKitRequired=%s into the nested qualification upsert',
    async (ventFacadeExists, ventFacadeKitRequired) => {
      await service.qualify(
        'lead-id',
        {
          ...qualifyDto,
          qualification: {
            installationRequired: true,
            ventFacadeExists,
            ventFacadeKitRequired,
            items: [],
          },
        } as QualifyLeadDto,
        'owner-id',
        ['leads:qualify'],
      );

      expect(leadQualificationService.upsertInTx).toHaveBeenCalledWith(
        prisma,
        'lead-id',
        expect.objectContaining({
          installationRequired: true,
          ventFacadeExists,
          ventFacadeKitRequired,
          items: [],
        }),
        'owner-id',
        'lead_qualification_completed',
      );
    },
  );

  it('rejects a project object that belongs to another client before qualification is written', async () => {
    prisma.projectObject.findUnique.mockResolvedValue({
      id: 'object-id',
      clientId: 'other-client',
    });

    await expect(
      service.qualify('lead-id', qualifyDto, 'owner-id', ['leads:qualify']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.projectObject.update).not.toHaveBeenCalled();
    expect(leadQualificationService.upsertInTx).not.toHaveBeenCalled();
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back Stage-1 when contactId does not belong to the client', async () => {
    prisma.contact.findUnique.mockResolvedValue({
      id: 'contact-id',
      clientId: 'other-client',
    });

    await expect(
      service.qualify(
        'lead-id',
        { ...qualifyDto, contactId: 'contact-id' } as QualifyLeadDto,
        'owner-id',
        ['leads:qualify'],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(leadQualificationService.upsertInTx).not.toHaveBeenCalled();
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('does not claim QUALIFIED if nested HPL qualification write fails', async () => {
    leadQualificationService.upsertInTx.mockRejectedValue(
      new Error('qualification write failed'),
    );

    await expect(
      service.qualify(
        'lead-id',
        {
          ...qualifyDto,
          qualification: { application: undefined },
        } as QualifyLeadDto,
        'owner-id',
        ['leads:qualify'],
      ),
    ).rejects.toThrow('qualification write failed');
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('keeps historical estimatedAmount readable on the qualified lead', async () => {
    prisma.lead.findUnique.mockResolvedValue({
      ...qualifiedLead,
      estimatedAmount: ownedLead.estimatedAmount,
      targetDate: ownedLead.targetDate,
    });

    const result = await service.qualify('lead-id', qualifyDto, 'owner-id', [
      'leads:qualify',
    ]);

    expect(result.estimatedAmount).toBe(999999);
    expect(result.targetDate).toEqual(ownedLead.targetDate);
  });
});
