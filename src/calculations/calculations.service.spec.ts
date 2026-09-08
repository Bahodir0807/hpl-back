import { HttpStatus } from '@nestjs/common';
import { ActivityType, LeadStatus, Prisma } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { PanelQuantityCalculator } from '../panels/services/panel-quantity-calculator.service';
import {
  CalculationService,
  MANAGER_CALCULATION_ITEM_REQUIRED_MESSAGE,
} from './calculations.service';
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

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    firstName: 'Head',
    lastName: 'Test',
    roles: ['HEAD'],
    permissions: [
      'calculations:create',
      'calculations:read',
      'calculations:read_all',
      'leads:read',
      'leads:read_all',
      'leads:commercial_qualify',
    ],
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
      application: 'EXTERIOR_WITH_UV',
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
      quantityCalc,
      priceCalc as never,
      currencyRateService as never,
    );

    prisma.lead.findFirst.mockResolvedValue(lead);
    prisma.panelType.findFirst.mockResolvedValue({
      id: 'type-id',
      code: 'exterior_with_uv',
    });
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
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping',
    });
    currencyRateService.getActiveCnyUsdRate.mockResolvedValue(
      new Prisma.Decimal('0.1'),
    );
    quantityCalc.calculate.mockReturnValue({
      sheetsCount: 6,
      wastePercent: new Prisma.Decimal('5.83'),
      actualAreaM2: new Prisma.Decimal('17.8608'),
    });
    priceCalc.calculate.mockResolvedValue({
      supplierPricePerM2: new Prisma.Decimal('100'),
      clientPricePerM2: new Prisma.Decimal('20'),
      pricePerSheet: new Prisma.Decimal('59.536'),
      total: new Prisma.Decimal('357.22'),
      areaM2: new Prisma.Decimal('2.9768'),
    });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
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

  it('ignores client sheetsCount and persists custom dimensions', async () => {
    const dto: CreateCalculationDto = {
      leadId: lead.id,
      items: [
        {
          ...baseItem,
          sheetsCount: 4,
          customWidthMm: 1400,
          customHeightMm: 3100,
          coating: 'PE',
          texture: 'woodgrain',
          colorId: undefined,
        },
      ],
    };

    await service.create(dto, manager);

    const priceInput = priceCalc.calculate.mock.calls[0][0] as {
      sheets: number;
    };
    expect(priceInput.sheets).toBe(6);
    const createData = prisma.calculationSession.create.mock.calls[0][0]
      .data as {
      items: {
        create: Array<{
          sheetsCount: number;
          customWidthMm: number | null;
          customHeightMm: number | null;
          coating: string | null;
          texture: string | null;
        }>;
      };
    };
    expect(createData.items.create[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 6,
        customWidthMm: 1400,
        customHeightMm: 3100,
        coating: 'PE',
        texture: 'woodgrain',
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

  it('still returns PRICING_NOT_CONFIGURED for FURNITURE after a valid mapping', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      qualification: {
        ...lead.qualification,
        application: 'FURNITURE',
        thicknessMm: 1.5,
      },
    });
    prisma.panelType.findFirst.mockResolvedValue({
      id: 'type-id',
      code: 'furniture',
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'furniture-mapping',
    });
    priceCalc.calculate.mockRejectedValue(
      new BusinessException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PRICING_NOT_CONFIGURED',
        'Цена для толщины 1.5 мм не настроена',
      ),
    );

    await expect(
      service.create(
        {
          leadId: lead.id,
          items: [{ ...baseItem, thicknessMm: 1.5 }],
        },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'PRICING_NOT_CONFIGURED',
      }),
    });
    expect(prisma.supplierQualityMapping.findFirst).toHaveBeenCalled();
    expect(priceCalc.calculate).toHaveBeenCalled();
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

  it('fails closed for custom dimensions without inventing a catalog size', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      qualification: {
        ...lead.qualification,
        panelSizeId: null,
        customWidthMm: 1400,
        customHeightMm: 3100,
      },
    });

    await expect(
      service.create(
        { leadId: lead.id, items: [{}] } as CreateCalculationDto,
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CUSTOM_SIZE_PRICING_NOT_CONFIGURED',
      }),
    });
    expect(prisma.panelSize.findFirst).not.toHaveBeenCalled();
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('lets HEAD preview mechanical quantities without PanelThicknessPricing', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      ownerId: head.id,
      qualification: {
        ...lead.qualification,
        application: 'FURNITURE',
        thicknessMm: 2.9,
      },
    });
    prisma.panelType.findFirst.mockResolvedValue({
      id: 'type-id',
      code: 'furniture',
    });
    prisma.panelSize.findFirst.mockResolvedValue({
      id: 'size-id',
      areaM2: new Prisma.Decimal('2.79075'),
      widthMm: 1525,
      heightMm: 1830,
    });
    quantityCalc.calculate.mockReturnValue({
      sheetsCount: 359,
      wastePercent: new Prisma.Decimal('0.19'),
      actualAreaM2: new Prisma.Decimal('1001.8793'),
    });

    const preview = await service.preview(
      {
        leadId: lead.id,
        panelTypeId: 'type-id',
        panelSizeId: 'size-id',
        thicknessMm: '2.9',
        requiredAreaM2: '1000',
      },
      head,
    );

    expect(preview.sheetsCount).toBe(359);
    expect(preview.areaM2.toString()).toBe('1001.8793');
    expect(preview.total).toBeUndefined();
    expect(preview.clientPricePerM2).toBeUndefined();
    expect(currencyRateService.getActiveCnyUsdRate).not.toHaveBeenCalled();
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('lets HEAD submit a manual CNY purchase price and skips catalog pricing', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      ownerId: head.id,
    });
    priceCalc.calculate.mockResolvedValue({
      supplierPricePerM2: new Prisma.Decimal('80'),
      clientPricePerM2: new Prisma.Decimal('24'),
      pricePerSheet: new Prisma.Decimal('71.4432'),
      total: new Prisma.Decimal('428.66'),
      areaM2: new Prisma.Decimal('2.9768'),
    });

    await service.create(
      {
        leadId: lead.id,
        items: [{ ...baseItem, purchasePricePerM2Cny: '80' }],
      },
      head,
    );

    const priceInput = priceCalc.calculate.mock.calls[0][0] as {
      purchasePricePerM2Cny: Prisma.Decimal;
      cnyUsdRate: Prisma.Decimal;
      sheets: number;
    };
    expect(priceInput.purchasePricePerM2Cny.toString()).toBe('80');
    expect(priceInput.cnyUsdRate.toString()).toBe('0.1');
    expect(priceInput.sheets).toBe(6);
    const createData = prisma.calculationSession.create.mock.calls[0][0]
      .data as {
      items: { create: Array<{ supplierPricePerM2: Prisma.Decimal }> };
      cnyUsdRate: Prisma.Decimal;
      sellingCoefficient: Prisma.Decimal;
    };
    expect(createData.items.create[0]?.supplierPricePerM2.toString()).toBe(
      '80',
    );
    expect(createData.cnyUsdRate.toString()).toBe('0.1');
    expect(createData.sellingCoefficient.toString()).toBe('2');
  });

  it('requires a manual purchase price when HEAD saves a calculation', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      ownerId: head.id,
    });

    await expect(
      service.create({ leadId: lead.id, items: [baseItem] }, head),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'PURCHASE_PRICE_REQUIRED',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
    });
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('forbids MANAGER from submitting a manual purchase price', async () => {
    await expect(
      service.create(
        {
          leadId: lead.id,
          items: [{ ...baseItem, purchasePricePerM2Cny: '80' }],
        },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'MANUAL_PURCHASE_PRICE_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('forbids MANAGER preview with a crafted manual purchase price', async () => {
    await expect(
      service.preview(
        {
          leadId: lead.id,
          ...baseItem,
          purchasePricePerM2Cny: '80',
        },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'MANUAL_PURCHASE_PRICE_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
  });

  it('rejects zero and negative HEAD purchase prices', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      ownerId: head.id,
    });

    await expect(
      service.create(
        {
          leadId: lead.id,
          items: [{ ...baseItem, purchasePricePerM2Cny: '0' }],
        },
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_SUPPLIER_PRICE',
      }),
    });

    await expect(
      service.create(
        {
          leadId: lead.id,
          items: [{ ...baseItem, purchasePricePerM2Cny: '-10' }],
        },
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_SUPPLIER_PRICE',
      }),
    });
  });

  it('keeps FX-not-found when HEAD prices a calculation without CurrencyRate', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      ownerId: head.id,
    });
    currencyRateService.getActiveCnyUsdRate.mockRejectedValue(
      new BusinessException(
        HttpStatus.BAD_REQUEST,
        'CURRENCY_RATE_NOT_FOUND',
        'Не задан курс CNY → USD',
      ),
    );

    await expect(
      service.create(
        {
          leadId: lead.id,
          items: [{ ...baseItem, purchasePricePerM2Cny: '80' }],
        },
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CURRENCY_RATE_NOT_FOUND',
      }),
    });
  });

  it('does not look up PanelThicknessPricing after the CNY snapshot is stored', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...lead,
      ownerId: head.id,
    });
    priceCalc.calculate.mockResolvedValue({
      supplierPricePerM2: new Prisma.Decimal('80'),
      clientPricePerM2: new Prisma.Decimal('24'),
      pricePerSheet: new Prisma.Decimal('71.44'),
      total: new Prisma.Decimal('428.64'),
      areaM2: new Prisma.Decimal('2.9768'),
    });

    await service.create(
      {
        leadId: lead.id,
        items: [{ ...baseItem, purchasePricePerM2Cny: '80' }],
      },
      head,
    );

    expect(prisma.panelThicknessPricing.findFirst).not.toHaveBeenCalled();
    const createData = prisma.calculationSession.create.mock.calls[0][0]
      .data as {
      items: {
        create: Array<{
          supplierPricePerM2: Prisma.Decimal;
          totalPrice: Prisma.Decimal;
        }>;
      };
    };
    expect(createData.items.create[0]?.supplierPricePerM2.toString()).toBe(
      '80',
    );
    expect(createData.items.create[0]?.totalPrice.toString()).toBe('428.64');
  });
});

describe('CalculationService manager catalog sheetsCount', () => {
  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    firstName: 'Manager',
    lastName: 'Test',
    roles: ['MANAGER'],
    permissions: ['calculations:create', 'calculations:read', 'leads:read'],
  };

  const catalogLead = {
    id: 'lead-id',
    ownerId: 'manager-id',
    clientId: 'client-id',
    projectObjectId: null,
    dealId: null,
    deletedAt: null,
    status: LeadStatus.QUALIFIED,
    qualification: {
      application: 'INTERIOR',
      panelTypeId: 'type-id',
      thicknessMm: 8,
      panelSizeId: 'size-1830',
      customWidthMm: null,
      customHeightMm: null,
      colorCode: null,
      colorName: null,
      requiredAreaM2: 1000,
      installationRequired: false,
      customerRequirements: null,
    },
    commercialQualification: null,
  };

  const size1830x3050 = {
    id: 'size-1830',
    areaM2: new Prisma.Decimal('5.5815'),
    widthMm: 1830,
    heightMm: 3050,
  };
  const size1220x2440 = {
    id: 'size-1220',
    areaM2: new Prisma.Decimal('2.9768'),
    widthMm: 1220,
    heightMm: 2440,
  };

  const prisma = {
    lead: { findFirst: jest.fn() },
    panelType: { findFirst: jest.fn() },
    panelSize: { findFirst: jest.fn() },
    supplierQualityMapping: { findFirst: jest.fn() },
    panelColor: { findUnique: jest.fn() },
  };

  const priceCalc = {
    calculate: jest.fn(),
  };

  const currencyRateService = {
    getActiveCnyUsdRate: jest.fn(),
  };

  const catalogItem = {
    panelTypeId: 'type-id',
    panelSizeId: 'size-1830',
    thicknessMm: '8',
    qualityClassId: 'quality-id',
    requiredAreaM2: '1000',
  };

  let service: CalculationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalculationService(
      prisma as never,
      new PanelQuantityCalculator(),
      priceCalc as never,
      currencyRateService as never,
    );
    prisma.lead.findFirst.mockResolvedValue(catalogLead);
    prisma.panelType.findFirst.mockResolvedValue({
      id: 'type-id',
      code: 'interior',
    });
    prisma.panelSize.findFirst.mockResolvedValue(size1830x3050);
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping',
    });
    currencyRateService.getActiveCnyUsdRate.mockResolvedValue(
      new Prisma.Decimal('0.1'),
    );
    priceCalc.calculate.mockImplementation(
      async (input: { sheets: number }) => ({
        supplierPricePerM2: new Prisma.Decimal('100'),
        clientPricePerM2: new Prisma.Decimal('20'),
        pricePerSheet: new Prisma.Decimal('50'),
        total: new Prisma.Decimal(20 * input.sheets),
        areaM2: new Prisma.Decimal('5.5815'),
      }),
    );
  });

  it('calculates 180 sheets for 1830×3050 and 1000 m² on create', async () => {
    const result = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [catalogItem],
      manager,
    );

    expect(result.calculatedItems[0]?.sheetsCount).toBe(180);
    expect(result.calculatedItems[0]?.supplierId).toBeNull();
    expect(result.calculatedItems[0]?.totalPrice.toString()).toBe('0');
    expect(priceCalc.calculate).not.toHaveBeenCalled();
    expect(currencyRateService.getActiveCnyUsdRate).not.toHaveBeenCalled();
  });

  it.each([
    ['тип HPL', 'panelTypeId'],
    ['линейка', 'qualityClassId'],
    ['размер', 'panelSizeId'],
    ['толщина', 'thicknessMm'],
    ['площадь', 'requiredAreaM2'],
  ] as const)(
    'rejects a manager request when required field %s is absent',
    async (_label, missingField) => {
      const incompleteItem = { ...catalogItem, [missingField]: undefined };

      await expect(
        service.prepareManagerCatalogGroup(
          catalogLead.id,
          [incompleteItem],
          manager,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'CALCULATION_PREFILL_INCOMPLETE',
          statusCode: HttpStatus.BAD_REQUEST,
          message: MANAGER_CALCULATION_ITEM_REQUIRED_MESSAGE,
        }),
      });
    },
  );

  it('does not mention a manufacturer in manager required-field validation', async () => {
    expect(
      MANAGER_CALCULATION_ITEM_REQUIRED_MESSAGE.toLowerCase(),
    ).not.toContain('производител');
  });

  it('does not let a manager impose a different sheetsCount', async () => {
    const result = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [{ ...catalogItem, sheetsCount: 1 }],
      manager,
    );

    expect(result.calculatedItems[0]?.sheetsCount).toBe(180);
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('persists manager-selected item supplierId without pricing', async () => {
    const result = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [{ ...catalogItem, supplierId: 'manager-selected-supplier' }],
      manager,
    );

    expect(result.calculatedItems[0]?.supplierId).toBe(
      'manager-selected-supplier',
    );
    expect(priceCalc.calculate).not.toHaveBeenCalled();
    expect(result.calculatedItems[0]?.totalPrice.toString()).toBe('0');
  });

  it('recalculates quantity when requiredAreaM2 changes', async () => {
    const initial = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [catalogItem],
      manager,
    );
    const updated = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [{ ...catalogItem, requiredAreaM2: '10' }],
      manager,
    );

    expect(initial.calculatedItems[0]?.sheetsCount).toBe(180);
    expect(updated.calculatedItems[0]?.sheetsCount).toBe(2);
  });

  it('recalculates quantity when panelSizeId changes', async () => {
    const initial = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [catalogItem],
      manager,
    );

    prisma.panelSize.findFirst.mockResolvedValue(size1220x2440);
    const updated = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [{ ...catalogItem, panelSizeId: 'size-1220' }],
      manager,
    );

    expect(initial.calculatedItems[0]?.sheetsCount).toBe(180);
    expect(updated.calculatedItems[0]?.sheetsCount).toBe(336);
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('accepts other with customTypeDescription as a technical request', async () => {
    prisma.panelType.findFirst.mockResolvedValue({
      id: 'other-type-id',
      code: 'other',
    });

    const result = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [
        {
          ...catalogItem,
          panelTypeId: 'other-type-id',
          customTypeDescription: 'Fire-rated custom laminate',
        },
      ],
      manager,
    );

    expect(result.calculatedItems[0]).toEqual(
      expect.objectContaining({
        panelTypeId: 'other-type-id',
        customTypeDescription: 'Fire-rated custom laminate',
        sheetsCount: 180,
      }),
    );
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('accepts a manager-selected type that differs from the Lead application', async () => {
    prisma.panelType.findFirst.mockResolvedValue({
      id: 'laboratory-type-id',
      code: 'laboratory',
    });

    await expect(
      service.prepareManagerCatalogGroup(
        catalogLead.id,
        [{ ...catalogItem, panelTypeId: 'laboratory-type-id' }],
        manager,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        calculatedItems: [
          expect.objectContaining({ panelTypeId: 'laboratory-type-id' }),
        ],
      }),
    );
  });

  it('accepts a thickness when no purchase price is configured', async () => {
    priceCalc.calculate.mockRejectedValue(
      new BusinessException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PRICING_NOT_CONFIGURED',
        'Purchase price is not configured',
      ),
    );

    await expect(
      service.prepareManagerCatalogGroup(
        catalogLead.id,
        [{ ...catalogItem, thicknessMm: '13.5' }],
        manager,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        calculatedItems: [
          expect.objectContaining({
            thicknessMm: new Prisma.Decimal('13.5'),
            sheetsCount: 180,
          }),
        ],
      }),
    );
    expect(priceCalc.calculate).not.toHaveBeenCalled();
  });

  it('lets HEAD persist incomplete items with coating, texture and arbitrary Decor', async () => {
    const result = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [
        {
          colorName: 'Черный',
          coating: 'Матовый',
          texture: 'Гладкий',
          decor: 'Black Woodgrain X2',
          requiredAreaM2: '4',
        },
      ],
      manager,
      { allowIncomplete: true },
    );

    expect(result.calculatedItems[0]).toEqual(
      expect.objectContaining({
        panelTypeId: null,
        panelSizeId: null,
        qualityClassId: null,
        thicknessMm: null,
        colorName: 'Черный',
        coating: 'Матовый',
        texture: 'Гладкий',
        decor: 'Black Woodgrain X2',
        requiredAreaM2: new Prisma.Decimal('4'),
      }),
    );
    expect(prisma.panelType.findFirst).not.toHaveBeenCalled();
  });

  it('keeps customer color separate from Decor on a complete HEAD snapshot', async () => {
    const result = await service.prepareManagerCatalogGroup(
      catalogLead.id,
      [
        {
          ...catalogItem,
          colorName: 'Серый',
          coating: 'Матовый',
          texture: 'Под камень',
          decor: 'Concrete Grey 7016',
        },
      ],
      manager,
      { allowIncomplete: true },
    );

    expect(result.calculatedItems[0]).toEqual(
      expect.objectContaining({
        colorName: 'Серый',
        coating: 'Матовый',
        texture: 'Под камень',
        decor: 'Concrete Grey 7016',
      }),
    );
  });
});
