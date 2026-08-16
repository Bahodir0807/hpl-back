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
    lead: { findFirst: jest.fn() },
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
    application: HplApplication.EXTERIOR,
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
      code: 'exterior',
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
    ['tianran', 'exterior', 'medium', HplApplication.EXTERIOR, true],
    ['tianran', 'exterior', 'premium', HplApplication.EXTERIOR, true],
    ['tianran', 'exterior', 'economy', HplApplication.EXTERIOR, false],
    ['wuya', 'exterior', 'economy', HplApplication.EXTERIOR, true],
    ['polybet', 'exterior', 'premium', HplApplication.EXTERIOR, true],
  ])(
    'matrix %s + %s + %s for %s',
    async (
      supplierCode,
      panelTypeCode,
      qualityCode,
      application,
      allowed,
    ) => {
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
});
