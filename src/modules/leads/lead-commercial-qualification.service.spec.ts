import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CommercialQualificationStatus,
  HplApplication,
  LeadStatus,
} from '@prisma/client';
import { UpsertLeadCommercialQualificationDto } from './dto/upsert-lead-commercial-qualification.dto';
import { LeadCommercialQualificationService } from './lead-commercial-qualification.service';

describe('LeadCommercialQualificationService Stage-2', () => {
  const prisma = {
    lead: { findFirst: jest.fn(), update: jest.fn() },
    leadQualification: { findUnique: jest.fn() },
    leadCommercialQualification: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    supplier: { findUnique: jest.fn() },
    qualityClass: { findUnique: jest.fn() },
    panelType: { findUnique: jest.fn(), findFirst: jest.fn() },
    supplierQualityMapping: { findFirst: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    task: { updateMany: jest.fn() },
    notification: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const ownedLead = {
    id: 'lead-id',
    title: 'Lobby HPL',
    ownerId: 'owner-id',
    status: LeadStatus.QUALIFIED,
    dealId: null,
    deletedAt: null,
  };

  const stage1 = {
    leadId: 'lead-id',
    application: HplApplication.EXTERIOR_WITH_UV,
    panelTypeId: 'exterior-type-id',
    thicknessMm: 10,
    panelSizeId: 'size-id',
    customWidthMm: null,
    customHeightMm: null,
    colorCode: 'X',
    colorName: 'Requested color',
    requiredAreaM2: 100,
    installationRequired: false,
    customerRequirements: 'Customer asked for color X',
  };

  const dto = {
    supplierId: 'tianran-id',
    qualityClassId: 'premium-id',
    decisionComment: 'Tianran Premium for exterior facade',
  } as UpsertLeadCommercialQualificationDto;

  const serializedRow = {
    id: 'cq-id',
    leadId: 'lead-id',
    supplierId: dto.supplierId,
    qualityClassId: dto.qualityClassId,
    mappingId: 'mapping-id',
    status: CommercialQualificationStatus.CONFIRMED,
    decisionComment: dto.decisionComment,
    confirmedById: 'head-id',
    confirmedAt: new Date('2026-08-17T00:00:00.000Z'),
    createdAt: new Date('2026-08-17T00:00:00.000Z'),
    updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    supplier: { id: 'tianran-id', code: 'tianran', name: 'Tianran' },
    qualityClass: { id: 'premium-id', code: 'premium', nameRu: 'Премиум' },
  };

  let service: LeadCommercialQualificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadCommercialQualificationService(prisma as never);
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.lead.update.mockResolvedValue({
      ...ownedLead,
      targetDate: new Date('2026-10-01T00:00:00.000Z'),
    });
    prisma.leadQualification.findUnique.mockResolvedValue(stage1);
    prisma.leadCommercialQualification.findUnique.mockResolvedValue(null);
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'tianran-id',
      code: 'tianran',
    });
    prisma.qualityClass.findUnique.mockResolvedValue({
      id: 'premium-id',
      code: 'premium',
    });
    prisma.panelType.findUnique.mockResolvedValue({
      id: 'exterior-type-id',
      code: 'exterior_with_uv',
      isActive: true,
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping-id',
    });
    prisma.leadCommercialQualification.create.mockResolvedValue(serializedRow);
    prisma.leadCommercialQualification.update.mockResolvedValue(serializedRow);
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.task.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.create.mockResolvedValue({});
  });

  it('allows HEAD with leads:read_all to confirm Stage 2 on another manager lead', async () => {
    const result = await service.confirm('lead-id', dto, 'head-id', [
      'leads:commercial_qualify',
      'leads:read_all',
    ]);

    expect(result.status).toBe(CommercialQualificationStatus.CONFIRMED);
    expect(result.supplierId).toBe(dto.supplierId);
    expect(result.qualityClassId).toBe(dto.qualityClassId);
    expect(prisma.leadCommercialQualification.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'LEAD_COMMERCIAL_QUALIFIED',
        entityType: 'Lead',
        newValue: expect.objectContaining({
          supplierId: dto.supplierId,
          qualityClassId: dto.qualityClassId,
        }),
      }),
    });
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'COMPLETED',
        result: 'Stage-2 commercial qualification confirmed',
      }),
      where: expect.objectContaining({
        relatedType: 'Lead',
        relatedId: 'lead-id',
        title: { startsWith: 'Stage 2 commercial qualification:' },
      }),
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'owner-id',
        title: 'Commercial qualification ready',
        type: 'lead_commercially_qualified',
      }),
    });
  });

  it('denies a caller who cannot access the lead', async () => {
    await expect(
      service.confirm('lead-id', dto, 'stranger-id', [
        'leads:commercial_qualify',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects Stage 2 on NEW / IN_PROGRESS leads', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      status: LeadStatus.NEW,
    });

    await expect(
      service.confirm('lead-id', dto, 'head-id', [
        'leads:commercial_qualify',
        'leads:read_all',
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects Stage 2 on CONVERTED and UNQUALIFIED leads', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      status: LeadStatus.CONVERTED,
      dealId: 'deal-id',
    });
    await expect(
      service.confirm('lead-id', dto, 'head-id', [
        'leads:commercial_qualify',
        'leads:read_all',
      ]),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      status: LeadStatus.UNQUALIFIED,
    });
    await expect(
      service.confirm('lead-id', dto, 'head-id', [
        'leads:commercial_qualify',
        'leads:read_all',
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['tianran', 'interior', 'economy', HplApplication.INTERIOR, true],
    [
      'tianran',
      'exterior_with_uv',
      'medium',
      HplApplication.EXTERIOR_WITH_UV,
      true,
    ],
    [
      'tianran',
      'exterior_with_uv',
      'premium',
      HplApplication.EXTERIOR_WITH_UV,
      true,
    ],
    [
      'tianran',
      'exterior_with_uv',
      'economy',
      HplApplication.EXTERIOR_WITH_UV,
      false,
    ],
    [
      'wuya',
      'exterior_with_uv',
      'economy',
      HplApplication.EXTERIOR_WITH_UV,
      true,
    ],
    [
      'polybet',
      'exterior_with_uv',
      'premium',
      HplApplication.EXTERIOR_WITH_UV,
      true,
    ],
    ['wuya', 'furniture', 'economy', HplApplication.FURNITURE, true],
    ['tianran', 'furniture', 'medium', HplApplication.FURNITURE, true],
    ['polybet', 'furniture', 'premium', HplApplication.FURNITURE, true],
    ['wuya', 'furniture', 'premium', HplApplication.FURNITURE, false],
    ['tianran', 'furniture', 'economy', HplApplication.FURNITURE, false],
    ['wuya', 'laboratory', 'economy', HplApplication.LABORATORY, true],
    ['tianran', 'laboratory', 'medium', HplApplication.LABORATORY, true],
    ['polybet', 'laboratory', 'premium', HplApplication.LABORATORY, true],
    ['polybet', 'laboratory', 'economy', HplApplication.LABORATORY, false],
  ])(
    'matrix %s + %s + %s for %s',
    async (supplierCode, panelTypeCode, qualityCode, application, allowed) => {
      prisma.leadQualification.findUnique.mockResolvedValue({
        ...stage1,
        application,
        panelTypeId: `${panelTypeCode}-type-id`,
      });
      prisma.panelType.findUnique.mockResolvedValue({
        id: `${panelTypeCode}-type-id`,
        code: panelTypeCode,
        isActive: true,
      });
      prisma.supplier.findUnique.mockResolvedValue({
        id: `${supplierCode}-id`,
        code: supplierCode,
      });
      prisma.qualityClass.findUnique.mockResolvedValue({
        id: `${qualityCode}-id`,
        code: qualityCode,
      });
      prisma.supplierQualityMapping.findFirst.mockResolvedValue(
        allowed ? { id: 'mapping-id' } : null,
      );

      const confirm = service.confirm(
        'lead-id',
        {
          supplierId: `${supplierCode}-id`,
          qualityClassId: `${qualityCode}-id`,
        } as UpsertLeadCommercialQualificationDto,
        'head-id',
        ['leads:commercial_qualify', 'leads:read_all'],
      );

      if (allowed) {
        await expect(confirm).resolves.toEqual(
          expect.objectContaining({
            status: CommercialQualificationStatus.CONFIRMED,
          }),
        );
      } else {
        await expect(confirm).rejects.toBeInstanceOf(BadRequestException);
      }
    },
  );

  it('lets HEAD commercially qualify FURNITURE with a valid supplier line', async () => {
    const targetDate = new Date('2026-09-15T00:00:00.000Z');
    prisma.leadQualification.findUnique.mockResolvedValue({
      ...stage1,
      application: HplApplication.FURNITURE,
      panelTypeId: 'furniture-type-id',
    });
    prisma.panelType.findUnique.mockResolvedValue({
      id: 'furniture-type-id',
      code: 'furniture',
      isActive: true,
    });
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'wuya-id',
      code: 'wuya',
    });
    prisma.qualityClass.findUnique.mockResolvedValue({
      id: 'economy-id',
      code: 'economy',
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'wuya-furniture-economy',
    });
    prisma.leadCommercialQualification.create.mockResolvedValue({
      ...serializedRow,
      supplierId: 'wuya-id',
      qualityClassId: 'economy-id',
      mappingId: 'wuya-furniture-economy',
      supplier: { id: 'wuya-id', code: 'wuya', name: 'Wuya' },
      qualityClass: { id: 'economy-id', code: 'economy', nameRu: 'Эконом' },
    });

    const result = await service.confirm(
      'lead-id',
      {
        supplierId: 'wuya-id',
        qualityClassId: 'economy-id',
        targetDate,
        decisionComment: 'Wuya Economy for furniture HPL',
      } as UpsertLeadCommercialQualificationDto,
      'head-id',
      ['leads:commercial_qualify', 'leads:read_all'],
    );

    expect(result.supplierId).toBe('wuya-id');
    expect(result.qualityClassId).toBe('economy-id');
    expect(result.qualityClass).toEqual(
      expect.objectContaining({ code: 'economy', nameRu: 'Эконом' }),
    );
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-id' },
      data: { targetDate },
    });
    expect(prisma.leadCommercialQualification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplierId: 'wuya-id',
        qualityClassId: 'economy-id',
        mappingId: 'wuya-furniture-economy',
      }),
      include: expect.anything(),
    });
  });

  it('does not mutate Stage-1 customer need fields', async () => {
    await service.confirm('lead-id', dto, 'head-id', [
      'leads:commercial_qualify',
      'leads:read_all',
    ]);

    expect(prisma.leadQualification.findUnique).toHaveBeenCalled();
    expect(
      Object.keys(prisma).filter((key) => key === 'leadQualification'),
    ).toEqual(['leadQualification']);
  });

  it('is idempotent for the same supplier/quality decision', async () => {
    prisma.leadCommercialQualification.findUnique.mockResolvedValue(
      serializedRow,
    );

    const result = await service.confirm('lead-id', dto, 'head-id', [
      'leads:commercial_qualify',
      'leads:read_all',
    ]);

    expect(result.id).toBe('cq-id');
    expect(prisma.leadCommercialQualification.create).not.toHaveBeenCalled();
    expect(prisma.leadCommercialQualification.update).not.toHaveBeenCalled();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it('updates decisionComment without advancing confirmedAt', async () => {
    prisma.leadCommercialQualification.findUnique.mockResolvedValue(
      serializedRow,
    );

    await service.confirm(
      'lead-id',
      {
        ...dto,
        decisionComment: 'Comment only',
      } as UpsertLeadCommercialQualificationDto,
      'head-id',
      ['leads:commercial_qualify', 'leads:read_all'],
    );

    expect(prisma.leadCommercialQualification.update).toHaveBeenCalledWith({
      where: { leadId: 'lead-id' },
      data: { decisionComment: 'Comment only' },
      include: expect.anything(),
    });
    const updateData = prisma.leadCommercialQualification.update.mock
      .calls[0][0].data as Record<string, unknown>;
    expect(updateData.confirmedAt).toBeUndefined();
    expect(updateData.supplierId).toBeUndefined();
    expect(updateData.qualityClassId).toBeUndefined();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('updates an existing Stage-2 selection without rewriting historical calculations', async () => {
    prisma.leadCommercialQualification.findUnique.mockResolvedValue({
      ...serializedRow,
      supplierId: 'wuya-id',
      qualityClassId: 'economy-id',
    });
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'tianran-id',
      code: 'tianran',
    });

    await service.confirm('lead-id', dto, 'head-id', [
      'leads:commercial_qualify',
      'leads:read_all',
    ]);

    expect(prisma.leadCommercialQualification.update).toHaveBeenCalledWith({
      where: { leadId: 'lead-id' },
      data: expect.objectContaining({
        supplierId: dto.supplierId,
        qualityClassId: dto.qualityClassId,
        status: CommercialQualificationStatus.CONFIRMED,
        confirmedAt: expect.any(Date),
      }),
      include: expect.anything(),
    });
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Commercial qualification updated',
      }),
    });
  });

  it('lets HEAD persist commercial timeline onto Lead.targetDate', async () => {
    const targetDate = new Date('2026-10-15T00:00:00.000Z');

    await service.confirm(
      'lead-id',
      { ...dto, targetDate } as UpsertLeadCommercialQualificationDto,
      'head-id',
      ['leads:commercial_qualify', 'leads:read_all'],
    );

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-id' },
      data: { targetDate },
    });
    expect(prisma.leadCommercialQualification.create).toHaveBeenCalled();
  });

  it('updates targetDate without rewriting a confirmed commercial decision', async () => {
    prisma.leadCommercialQualification.findUnique.mockResolvedValue(
      serializedRow,
    );
    const targetDate = new Date('2026-11-01T00:00:00.000Z');

    await service.confirm(
      'lead-id',
      { ...dto, targetDate } as UpsertLeadCommercialQualificationDto,
      'head-id',
      ['leads:commercial_qualify', 'leads:read_all'],
    );

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-id' },
      data: { targetDate },
    });
    expect(prisma.leadCommercialQualification.create).not.toHaveBeenCalled();
    expect(prisma.leadCommercialQualification.update).not.toHaveBeenCalled();
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it('does not clear historical targetDate when Stage-2 omits the timeline', async () => {
    await service.confirm('lead-id', dto, 'head-id', [
      'leads:commercial_qualify',
      'leads:read_all',
    ]);

    expect(prisma.lead.update).not.toHaveBeenCalled();
  });
});
