import { HttpStatus } from '@nestjs/common';
import { ActivityType, LeadStatus, Prisma } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { CalculationService } from './calculations.service';
import { CreateCalculationDto } from './dto/create-calculation.dto';

describe('CalculationService', () => {
  let service: CalculationService;

  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    firstName: 'Manager',
    lastName: 'Test',
    roles: ['MANAGER'],
    permissions: ['calculations:create', 'calculations:read', 'leads:read'],
  };

  const lead = {
    id: 'lead-id',
    ownerId: 'manager-id',
    clientId: 'client-id',
    projectObjectId: null,
    dealId: null,
    deletedAt: null,
    status: LeadStatus.QUALIFIED,
    qualification: {
      application: 'EXTERIOR',
      panelTypeId: 'type-id',
      thicknessMm: 10,
      panelSizeId: 'size-id',
      customWidthMm: null,
      customHeightMm: null,
      colorCode: 'W100',
      colorName: 'White',
      requiredAreaM2: 15.5,
      installationRequired: false,
      customerRequirements: 'Need in stock',
    },
    commercialQualification: {
      supplierId: 'supplier-id',
      qualityClassId: 'quality-id',
      status: 'CONFIRMED',
      confirmedAt: new Date('2026-08-17T00:00:00.000Z'),
    },
  };

  const prisma = {
    lead: { findFirst: jest.fn() },
    panelType: { findFirst: jest.fn() },
    panelSize: { findFirst: jest.fn() },
    panelThicknessPricing: { findFirst: jest.fn() },
    supplierQualityMapping: { findFirst: jest.fn() },
    panelColor: { findUnique: jest.fn() },
    calculationSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    calculationLineItem: { deleteMany: jest.fn() },
    activity: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const quantityCalc = {
    calculate: jest.fn(),
  };

  const priceCalc = {
    calculate: jest.fn(),
  };

  const currencyRateService = {
    getActiveCnyUsdRate: jest.fn(),
  };

  const baseItem = {
    panelTypeId: 'type-id',
    panelSizeId: 'size-id',
    thicknessMm: 10,
    supplierId: 'supplier-id',
    qualityClassId: 'quality-id',
    requiredAreaM2: '15.50',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalculationService(
      prisma as never,
      quantityCalc as never,
      priceCalc as never,
      currencyRateService as never,
    );

    prisma.lead.findFirst.mockResolvedValue(lead);
    prisma.panelType.findFirst.mockResolvedValue({ id: 'type-id', code: 'exterior' });
    prisma.panelSize.findFirst.mockResolvedValue({
      id: 'size-id',
      areaM2: new Prisma.Decimal('2.9768'),
      widthMm: 1220,
      heightMm: 2440,
    });
    prisma.panelThicknessPricing.findFirst.mockResolvedValue({
      basePricePerM2: new Prisma.Decimal('60000'),
      currencyCode: 'UZS',
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({ id: 'mapping' });
    currencyRateService.getActiveCnyUsdRate.mockResolvedValue(
      new Prisma.Decimal('0.1'),
    );
    quantityCalc.calculate.mockReturnValue({
      sheetsCount: 6,
      wastePercent: new Prisma.Decimal('5.83'),
    });
    priceCalc.calculate.mockResolvedValue({
      supplierPricePerM2: new Prisma.Decimal('100'),
      clientPricePerM2: new Prisma.Decimal('20'),
      pricePerSheet: new Prisma.Decimal('59.536'),
      total: new Prisma.Decimal('357.22'),
      areaM2: new Prisma.Decimal('2.9768'),
    });
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    prisma.calculationSession.create.mockResolvedValue({
      id: 'calc-id',
      leadId: lead.id,
      status: 'draft',
      totalAmount: new Prisma.Decimal('1071648'),
      items: [],
    });
    prisma.activity.create.mockResolvedValue({});
  });

  it('creates calculation with one item', async () => {
    const dto: CreateCalculationDto = {
      leadId: lead.id,
      notes: 'Test',
      items: [baseItem],
    };

    await service.create(dto, manager);

    const createData = prisma.calculationSession.create.mock.calls[0][0]
      .data as {
      displayCurrency: string;
      sellingCoefficient: Prisma.Decimal;
      cnyUsdRate: Prisma.Decimal;
      commercialSupplierId: string;
      commercialQualityClassId: string;
    };
    expect(createData.displayCurrency).toBe('USD');
    expect(createData.sellingCoefficient.toString()).toBe('2');
    expect(createData.cnyUsdRate.toString()).toBe('0.1');
    expect(createData.commercialSupplierId).toBe('supplier-id');
    expect(createData.commercialQualityClassId).toBe('quality-id');
    const priceInput = priceCalc.calculate.mock.calls[0][0] as {
      cnyUsdRate: Prisma.Decimal;
      sheets: number;
    };
    expect(priceInput.cnyUsdRate.toString()).toBe('0.1');
    expect(priceInput.sheets).toBe(6);
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: ActivityType.CALCULATION,
          relatedId: lead.id,
        }),
      }),
    );
  });

  it('sums totalAmount for three items', async () => {
    priceCalc.calculate
      .mockResolvedValueOnce({
        supplierPricePerM2: new Prisma.Decimal('60000'),
        clientPricePerM2: new Prisma.Decimal('69000'),
        pricePerSheet: new Prisma.Decimal('100'),
        total: new Prisma.Decimal('100'),
        areaM2: new Prisma.Decimal('2.9768'),
      })
      .mockResolvedValueOnce({
        supplierPricePerM2: new Prisma.Decimal('60000'),
        clientPricePerM2: new Prisma.Decimal('69000'),
        pricePerSheet: new Prisma.Decimal('200'),
        total: new Prisma.Decimal('200'),
        areaM2: new Prisma.Decimal('2.9768'),
      })
      .mockResolvedValueOnce({
        supplierPricePerM2: new Prisma.Decimal('60000'),
        clientPricePerM2: new Prisma.Decimal('69000'),
        pricePerSheet: new Prisma.Decimal('300'),
        total: new Prisma.Decimal('300'),
        areaM2: new Prisma.Decimal('2.9768'),
      });

    const dto: CreateCalculationDto = {
      leadId: lead.id,
      items: [baseItem, baseItem, baseItem],
    };

    await service.create(dto, manager);

    expect(prisma.calculationSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: new Prisma.Decimal('600'),
        }),
      }),
    );
  });

  it('rejects calculation before Stage-2 commercial qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      commercialQualification: null,
    });

    await expect(
      service.create({ leadId: lead.id, items: [baseItem] }, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'COMMERCIAL_QUALIFICATION_REQUIRED',
      }),
    });
    expect(prisma.calculationSession.create).not.toHaveBeenCalled();
  });

  it('rejects calculation on a Stage-1 NEW lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      status: LeadStatus.NEW,
    });

    await expect(
      service.create({ leadId: lead.id, items: [baseItem] }, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'COMMERCIAL_QUALIFICATION_REQUIRED',
      }),
    });
  });

  it('rejects client override of Stage-2 supplier or quality', async () => {
    await expect(
      service.create(
        {
          leadId: lead.id,
          items: [{ ...baseItem, supplierId: 'other-supplier' }],
        },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'COMMERCIAL_OVERRIDE_FORBIDDEN',
      }),
    });

    await expect(
      service.create(
        {
          leadId: lead.id,
          items: [{ ...baseItem, qualityClassId: 'other-quality' }],
        },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'COMMERCIAL_OVERRIDE_FORBIDDEN',
      }),
    });
  });

  it('derives supplier and quality from Stage 2, not the client payload', async () => {
    const dto = {
      leadId: lead.id,
      items: [
        {
          panelTypeId: baseItem.panelTypeId,
          panelSizeId: baseItem.panelSizeId,
          thicknessMm: baseItem.thicknessMm,
          requiredAreaM2: baseItem.requiredAreaM2,
        },
      ],
    };

    await service.create(dto as CreateCalculationDto, manager);

    const createData = prisma.calculationSession.create.mock.calls[0][0]
      .data as {
      items: { create: Array<{ supplierId: string; qualityClassId: string }> };
    };
    expect(createData.items.create[0]?.supplierId).toBe('supplier-id');
    expect(createData.items.create[0]?.qualityClassId).toBe('quality-id');
  });

  it('rejects invalid supplier and quality mapping', async () => {
    prisma.supplierQualityMapping.findFirst.mockResolvedValue(null);

    await expect(
      service.create({ leadId: lead.id, items: [baseItem] }, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_QUALITY_MAPPING',
      }),
    });
  });

  it('forbids access to another managers lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      ownerId: 'other-manager',
    });

    await expect(
      service.create({ leadId: lead.id, items: [baseItem] }, manager),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('finalizes draft and blocks further updates', async () => {
    prisma.calculationSession.findFirst
      .mockResolvedValueOnce({
        id: 'calc-id',
        createdById: manager.id,
        status: 'draft',
        deletedAt: null,
        notes: null,
        totalAmount: new Prisma.Decimal('100'),
      })
      .mockResolvedValueOnce({
        id: 'calc-id',
        createdById: manager.id,
        status: 'finalized',
        deletedAt: null,
        notes: null,
        totalAmount: new Prisma.Decimal('100'),
      });
    prisma.calculationSession.update.mockResolvedValue({
      id: 'calc-id',
      status: 'finalized',
      items: [],
    });
    prisma.calculationSession.findUniqueOrThrow.mockResolvedValue({
      id: 'calc-id',
      status: 'finalized',
      items: [],
    });

    await service.finalize('calc-id', manager);

    await expect(
      service.update('calc-id', { notes: 'changed' }, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CALCULATION_LOCKED',
        statusCode: HttpStatus.CONFLICT,
      }),
    });
  });

  it('lists calculations by leadId', async () => {
    prisma.calculationSession.findMany.mockResolvedValue([{ id: 'calc-1' }]);
    prisma.calculationSession.count.mockResolvedValue(1);
    prisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }

      throw new Error('expected array transaction');
    });

    const result = await service.findAll({ leadId: lead.id }, manager);

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(prisma.lead.findFirst).toHaveBeenCalled();
  });

  it('ignores manager-injected supplier price, rate and coefficient', async () => {
    const dto = {
      leadId: lead.id,
      items: [
        {
          ...baseItem,
          supplierPricePerM2: '1',
          cnyUsdRate: '999',
          coefficient: '1',
          clientPricePerM2: '1',
        },
      ],
    };

    await service.create(dto as CreateCalculationDto, manager);

    const priceInput = priceCalc.calculate.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect((priceInput.cnyUsdRate as Prisma.Decimal).toString()).toBe('0.1');
    expect(priceInput.supplierPricePerM2).toBeUndefined();
    expect(priceInput.coefficient).toBeUndefined();
    expect(priceInput.clientPricePerM2).toBeUndefined();
  });
});
