import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HplApplication, LeadStatus } from '@prisma/client';
import { UpsertLeadQualificationDto } from './dto/upsert-lead-qualification.dto';
import { LeadQualificationService } from './lead-qualification.service';

describe('LeadQualificationService', () => {
  const prisma = {
    lead: {
      findFirst: jest.fn(),
    },
    leadQualification: {
      findUnique: jest.fn(),
    },
    leadEngineeringAssignment: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const ownedLead = {
    id: 'lead-a',
    ownerId: 'manager-a',
    deletedAt: null,
    status: LeadStatus.QUALIFICATION,
  };

  let service: LeadQualificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadQualificationService(prisma as never);
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);
  });

  it('allows an owner to read their qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.leadQualification.findUnique.mockResolvedValue(null);

    await expect(
      service.get('lead-a', 'manager-a', ['leads:read']),
    ).resolves.toEqual({
      leadId: 'lead-a',
      qualification: null,
      requirementPrefill: null,
    });
  });

  it('allows HEAD/privileged leads:read_all to read another manager lead', async () => {
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.leadQualification.findUnique.mockResolvedValue(null);

    await expect(
      service.get('lead-a', 'head-id', ['leads:read', 'leads:read_all']),
    ).resolves.toEqual(
      expect.objectContaining({
        leadId: 'lead-a',
        qualification: null,
      }),
    );
  });

  it('denies Manager A reading Manager B qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-b',
    });

    await expect(
      service.get('lead-a', 'manager-a', ['leads:read', 'leads:update']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies Manager A updating Manager B qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-b',
    });

    await expect(
      service.upsert(
        'lead-a',
        { application: HplApplication.INTERIOR },
        'manager-a',
        ['leads:update'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the lead is missing', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);

    await expect(
      service.get('missing', 'manager-a', ['leads:read']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    [{ stockOnly: false }, { stockOnly: true, installationRequired: true }],
    [
      { installationRequired: false },
      { stockOnly: true, installationRequired: true },
    ],
    [
      { installationRequired: true },
      { stockOnly: false, installationRequired: false },
    ],
  ])(
    'rejects fulfillment-critical changes after Deal commitment',
    async (dto, current) => {
      const tx = {
        lead: {
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue({
            dealId: 'deal-id',
            status: LeadStatus.CONVERTED,
          }),
        },
        leadQualification: {
          findUnique: jest.fn().mockResolvedValue(current),
        },
        panelQuote: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      prisma.lead.findFirst.mockResolvedValue(ownedLead);
      prisma.$transaction.mockImplementation(async (callback) => callback(tx));

      await expect(
        service.upsert('lead-a', dto, 'manager-a', ['leads:update']),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('rejects inactive panel types', async () => {
    const tx = {
      panelType: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pt',
          code: 'interior',
          isActive: false,
        }),
      },
      leadQualification: { findUnique: jest.fn() },
    };

    const dto = Object.assign(new UpsertLeadQualificationDto(), {
      panelTypeId: 'pt',
    });

    await expect(
      service.upsertInTx(
        tx as never,
        'lead-a',
        dto,
        'manager-a',
        'lead_qualification_updated',
      ),
    ).rejects.toThrow('panelTypeId is invalid or inactive');
  });

  it('clears legacy scalars and persists an explicit empty items array', async () => {
    const qualification = {
      id: 'qualification-id',
      leadId: 'lead-a',
      application: null,
      panelTypeId: null,
      thicknessMm: null,
      panelSizeId: null,
      customWidthMm: null,
      customHeightMm: null,
      colorCode: null,
      colorName: null,
      requiredAreaM2: null,
      installationRequired: false,
      stockOnly: null,
      urgent: false,
      willingToWait: false,
      ventFacadeExists: null,
      ventFacadeKitRequired: null,
      customerRequirements: null,
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
      panelType: null,
      panelSize: null,
      items: [],
    };
    const tx = {
      leadQualification: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'qualification-id',
          application: HplApplication.INTERIOR,
          thicknessMm: null,
          panelTypeId: 'type-id',
          urgent: false,
          willingToWait: false,
        }),
        upsert: jest.fn().mockResolvedValue(qualification),
        findUniqueOrThrow: jest.fn().mockResolvedValue(qualification),
      },
      leadQualificationItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 'old-item' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activity: { create: jest.fn().mockResolvedValue({}) },
    };
    const dto = Object.assign(new UpsertLeadQualificationDto(), {
      application: HplApplication.INTERIOR,
      panelTypeId: 'type-id',
      requiredAreaM2: 12,
      items: [],
    });

    const result = await service.upsertInTx(
      tx as never,
      'lead-a',
      dto,
      'manager-a',
      'lead_qualification_updated',
    );

    expect(tx.leadQualification.upsert).toHaveBeenCalledTimes(1);
    const [[upsertCall]] = tx.leadQualification.upsert.mock
      .calls as unknown as [
      {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      },
    ][];
    expect(upsertCall.create).toMatchObject({
      application: null,
      panelTypeId: null,
      thicknessMm: null,
      panelSizeId: null,
      requiredAreaM2: null,
    });
    expect(upsertCall.update).toMatchObject({
      application: null,
      panelTypeId: null,
      thicknessMm: null,
      panelSizeId: null,
      requiredAreaM2: null,
    });
    expect(tx.leadQualificationItem.deleteMany).toHaveBeenCalledWith({
      where: { qualificationId: 'qualification-id' },
    });
    expect(result).toMatchObject({
      items: [],
      ventFacadeExists: null,
      ventFacadeKitRequired: null,
    });
  });

  it('rejects a partial urgent toggle that would preserve willingToWait=true', async () => {
    const tx = {
      leadQualification: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'qualification-id',
          application: null,
          thicknessMm: null,
          panelTypeId: null,
          urgent: false,
          willingToWait: true,
        }),
        upsert: jest.fn(),
      },
    };
    const dto = Object.assign(new UpsertLeadQualificationDto(), {
      urgent: true,
    });

    await expect(
      service.upsertInTx(
        tx as never,
        'lead-a',
        dto,
        'manager-a',
        'lead_qualification_updated',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.leadQualification.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [true, false],
    [false, true],
    [null, null],
  ] as const)(
    'persists ventFacadeExists=%s and ventFacadeKitRequired=%s on upsert',
    async (ventFacadeExists, ventFacadeKitRequired) => {
      const qualification = {
        id: 'qualification-id',
        leadId: 'lead-a',
        application: null,
        panelTypeId: null,
        thicknessMm: null,
        panelSizeId: null,
        customWidthMm: null,
        customHeightMm: null,
        colorCode: null,
        colorName: null,
        requiredAreaM2: null,
        installationRequired: true,
        stockOnly: null,
        urgent: false,
        willingToWait: false,
        ventFacadeExists,
        ventFacadeKitRequired,
        customerRequirements: null,
        createdAt: new Date('2026-08-28T00:00:00.000Z'),
        updatedAt: new Date('2026-08-28T00:00:00.000Z'),
        panelType: null,
        panelSize: null,
        items: [],
      };
      const tx = {
        leadQualification: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue(qualification),
          findUniqueOrThrow: jest.fn().mockResolvedValue(qualification),
        },
        leadQualificationItem: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        activity: { create: jest.fn().mockResolvedValue({}) },
      };
      const dto = Object.assign(new UpsertLeadQualificationDto(), {
        installationRequired: true,
        ventFacadeExists,
        ventFacadeKitRequired,
        items: [],
      });

      const result = await service.upsertInTx(
        tx as never,
        'lead-a',
        dto,
        'manager-a',
        'lead_qualification_updated',
      );

      const [[upsertCall]] = tx.leadQualification.upsert.mock
        .calls as unknown as [
        {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        },
      ][];
      expect(upsertCall.create).toMatchObject({
        ventFacadeExists,
        ventFacadeKitRequired,
      });
      expect(upsertCall.update).toMatchObject({
        ventFacadeExists,
        ventFacadeKitRequired,
      });
      expect(result).toMatchObject({
        ventFacadeExists,
        ventFacadeKitRequired,
      });
    },
  );

  it('reopens persisted false and null vent-facade answers', async () => {
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.leadQualification.findUnique.mockResolvedValue({
      id: 'qualification-id',
      leadId: 'lead-a',
      application: null,
      panelTypeId: null,
      thicknessMm: null,
      panelSizeId: null,
      customWidthMm: null,
      customHeightMm: null,
      colorCode: null,
      colorName: null,
      requiredAreaM2: null,
      installationRequired: false,
      stockOnly: null,
      urgent: false,
      willingToWait: true,
      ventFacadeExists: false,
      ventFacadeKitRequired: null,
      customerRequirements: null,
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
      panelType: null,
      panelSize: null,
      items: [],
    });

    await expect(
      service.get('lead-a', 'manager-a', ['leads:read']),
    ).resolves.toMatchObject({
      leadId: 'lead-a',
      qualification: {
        ventFacadeExists: false,
        ventFacadeKitRequired: null,
      },
    });
  });

  it('lets an assigned engineer read qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-b',
    });
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
    });
    prisma.leadQualification.findUnique.mockResolvedValue(null);

    await expect(
      service.get('lead-a', 'engineer-1', ['leads:read', 'engineering:read']),
    ).resolves.toEqual({
      leadId: 'lead-a',
      qualification: null,
      requirementPrefill: null,
    });
  });

  it('denies an engineer without an assignment from reading qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-b',
    });

    await expect(
      service.get('lead-a', 'engineer-1', ['leads:read', 'engineering:read']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
