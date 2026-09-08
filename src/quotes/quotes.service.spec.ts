import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CALCULATION_STATUS } from '../calculations/calculation.constants';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { QuotesService } from './quotes.service';
import { QUOTE_STATUS } from './quote.constants';

describe('QuotesService', () => {
  let service: QuotesService;

  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    firstName: 'Manager',
    lastName: 'Test',
    roles: ['MANAGER'],
    permissions: [
      'quotes:create',
      'quotes:read',
      'quotes:update',
      'quotes:client_accept',
      'calculations:read',
    ],
  };

  const managerWithReadAll: CurrentUser = {
    ...manager,
    permissions: [
      'quotes:create',
      'quotes:read',
      'quotes:read_all',
      'quotes:update',
      'quotes:client_accept',
      'calculations:read',
    ],
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    firstName: 'Head',
    lastName: 'Test',
    roles: ['HEAD'],
    permissions: [
      'quotes:read',
      'quotes:read_all',
      'quotes:update',
      'quotes:approve',
    ],
  };

  const headCommercial: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    firstName: 'Head',
    lastName: 'Test',
    roles: ['HEAD'],
    permissions: [
      'quotes:create',
      'quotes:read',
      'quotes:read_all',
      'quotes:update',
      'quotes:approve',
      'leads:commercial_qualify',
      'calculations:read_all',
    ],
  };

  const director: CurrentUser = {
    id: 'director-id',
    email: 'director@test.com',
    firstName: 'Director',
    lastName: 'Test',
    roles: ['DIRECTOR'],
    permissions: [
      'quotes:create',
      'quotes:read',
      'quotes:read_all',
      'calculations:read_all',
    ],
  };

  const prisma = {
    calculationSession: { findFirst: jest.fn(), update: jest.fn() },
    calculationRequest: { updateMany: jest.fn() },
    panelQuote: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    leadCommercialQualification: { findUnique: jest.fn() },
    supplierQualityMapping: { findFirst: jest.fn() },
    product: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    task: { create: jest.fn() },
    notification: { create: jest.fn() },
    deal: { findFirst: jest.fn(), update: jest.fn() },
    dealStageHistory: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const notificationService = { sendEmail: jest.fn() };
  const dealFactory = {
    createFromQuote: jest.fn(),
  };
  const quoteStockService = { check: jest.fn() };
  const inventoryService = { reserveStock: jest.fn() };
  const panelPriceCalculator = { calculate: jest.fn() };
  const currencyRateService = { getActiveCnyUsdRate: jest.fn() };

  const confirmedAt = new Date('2026-08-17T00:00:00.000Z');

  const calculation = {
    id: 'calc-id',
    leadId: 'lead-id',
    status: CALCULATION_STATUS.FINALIZED,
    createdById: 'manager-id',
    totalAmount: new Prisma.Decimal('1000'),
    displayCurrency: 'UZS',
    commercialSupplierId: 'supplier-id',
    commercialQualityClassId: 'quality-id',
    commercialConfirmedAt: confirmedAt,
    panelQuote: null,
    items: [
      {
        panelType: { code: 'exterior_with_uv', displayNameRu: 'Exterior с УФ' },
        panelSize: {
          displayName: '1220×2440',
          areaM2: new Prisma.Decimal('2.9768'),
        },
        supplier: { code: 'wuya', name: 'Wuya' },
        qualityClass: { code: 'economy', nameRu: 'Эконом' },
        color: { colorCode: 'RAL 9010', colorName: 'Белый' },
        thicknessMm: 10,
        requiredAreaM2: new Prisma.Decimal('15.5'),
        sheetsCount: 6,
        supplierPricePerM2: new Prisma.Decimal('60000'),
        clientPricePerM2: new Prisma.Decimal('69000'),
        pricePerM2: new Prisma.Decimal('69000'),
        pricePerSheet: new Prisma.Decimal('178608'),
        totalPrice: new Prisma.Decimal('1071648'),
        wastePercent: new Prisma.Decimal('5.83'),
      },
    ],
    lead: { client: { email: 'client@test.com', name: 'Client' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QuotesService(
      prisma as never,
      notificationService as never,
      dealFactory,
      quoteStockService as never,
      inventoryService as never,
      { persistFinalPdf: jest.fn() } as never,
      panelPriceCalculator as never,
      currencyRateService as never,
    );
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    prisma.calculationSession.findFirst.mockResolvedValue(calculation);
    prisma.leadCommercialQualification.findUnique.mockResolvedValue({
      supplierId: 'supplier-id',
      qualityClassId: 'quality-id',
      status: 'CONFIRMED',
      confirmedAt,
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping-id',
    });
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'supplier-id',
      code: 'wuya',
      name: 'Wuya',
      deliveryDays: 7,
    });
    currencyRateService.getActiveCnyUsdRate.mockResolvedValue(
      new Prisma.Decimal('0.1'),
    );
    panelPriceCalculator.calculate.mockResolvedValue({
      supplierPricePerM2: new Prisma.Decimal('80'),
      clientPricePerM2: new Prisma.Decimal('16'),
      pricePerSheet: new Prisma.Decimal('47.63'),
      total: new Prisma.Decimal('285.78'),
      areaM2: new Prisma.Decimal('2.9768'),
    });
    prisma.panelQuote.create.mockResolvedValue({
      id: 'quote-id',
      status: QUOTE_STATUS.DRAFT,
      items: [],
    });
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.panelQuote.updateMany.mockResolvedValue({ count: 1 });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.deal.findFirst.mockResolvedValue({
      id: 'deal-id',
      stage: 'QUALIFICATION',
    });
    prisma.deal.update.mockResolvedValue({});
    prisma.dealStageHistory.create.mockResolvedValue({});
    prisma.lead.findUnique.mockResolvedValue({ dealId: 'deal-id' });
  });

  it('forbids MANAGER from converting a calculation to a quote', async () => {
    await expect(
      service.createFromCalculation(
        'calc-id',
        { clientComment: 'Test' },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('creates quote from finalized calculation', async () => {
    await service.createFromCalculation(
      'calc-id',
      { clientComment: 'Test' },
      headCommercial,
    );

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      documentDate: Date;
    };
    expect(createData.documentDate).toBeInstanceOf(Date);
    expect(
      Math.abs(createData.documentDate.getTime() - Date.now()),
    ).toBeLessThan(5_000);
    expect(panelPriceCalculator.calculate).not.toHaveBeenCalled();
  });

  it('requires each request item to have a supplier before creating a QuoteDraft', async () => {
    const technicalItem = {
      ...calculation.items[0],
      panelTypeId: 'type-id',
      panelSizeId: 'size-id',
      supplierId: null,
      supplier: null,
      qualityClassId: 'quality-id',
      panelSize: {
        ...calculation.items[0].panelSize,
        widthMm: 1220,
        heightMm: 2440,
      },
      color: null,
      supplierPricePerM2: new Prisma.Decimal(0),
      clientPricePerM2: new Prisma.Decimal(0),
      pricePerM2: new Prisma.Decimal(0),
      pricePerSheet: new Prisma.Decimal(0),
      totalPrice: new Prisma.Decimal(0),
    };
    const requestGroup = {
      ...calculation,
      requestId: 'request-id',
      title: 'Technical request',
      notes: null,
      sortOrder: 0,
      totalAmount: new Prisma.Decimal(0),
      cnyUsdRate: null,
      commercialSupplierId: null,
      commercialQualityClassId: null,
      commercialConfirmedAt: null,
      items: [technicalItem],
    };
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...requestGroup,
      request: { quotes: [], calculations: [requestGroup] },
    });

    await expect(
      service.createFromCalculation('calc-id', {}, headCommercial),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_SUPPLIER_REQUIRED',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
    });
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
    expect(panelPriceCalculator.calculate).not.toHaveBeenCalled();
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('keeps supplier compatibility mandatory but allows missing reference pricing', async () => {
    const technicalItem = {
      ...calculation.items[0],
      panelTypeId: 'type-id',
      panelSizeId: 'size-id',
      qualityClassId: 'quality-id',
      panelSize: {
        ...calculation.items[0].panelSize,
        widthMm: 1220,
        heightMm: 2440,
      },
      supplierId: 'supplier-id',
      supplier: { id: 'supplier-id', code: 'wuya', name: 'Wuya' },
      color: {
        ...calculation.items[0].color,
        supplierId: 'supplier-id',
      },
      supplierPricePerM2: new Prisma.Decimal(0),
      clientPricePerM2: new Prisma.Decimal(0),
      pricePerM2: new Prisma.Decimal(0),
      pricePerSheet: new Prisma.Decimal(0),
      totalPrice: new Prisma.Decimal(0),
    };
    const requestGroup = {
      ...calculation,
      requestId: 'request-id',
      title: 'Technical request',
      notes: null,
      sortOrder: 0,
      totalAmount: new Prisma.Decimal(0),
      cnyUsdRate: null,
      commercialSupplierId: null,
      commercialQualityClassId: null,
      commercialConfirmedAt: null,
      items: [technicalItem],
    };
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...requestGroup,
      request: { quotes: [], calculations: [requestGroup] },
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.createFromCalculation('calc-id', {}, headCommercial),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_QUALITY_MAPPING',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
    });
    expect(panelPriceCalculator.calculate).not.toHaveBeenCalled();

    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping-id',
    });
    panelPriceCalculator.calculate.mockRejectedValue(
      new BusinessException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PRICING_NOT_CONFIGURED',
        'Purchase price for the selected thickness is not configured',
      ),
    );

    await expect(
      service.createFromCalculation('calc-id', {}, headCommercial),
    ).resolves.toEqual(expect.objectContaining({ status: QUOTE_STATUS.DRAFT }));

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      totalAmount: Prisma.Decimal;
      items: {
        create: Array<{
          supplierCode: string;
          supplierPricePerM2: Prisma.Decimal | null;
          pricePerM2: Prisma.Decimal | null;
          currencyCode: string | null;
          pricePerSheet: Prisma.Decimal | null;
          totalPrice: Prisma.Decimal | null;
          priceApprovedAt: Date | null;
        }>;
      };
    };
    expect(createData.totalAmount.toString()).toBe('0');
    expect(createData.items.create[0]).toEqual(
      expect.objectContaining({
        supplierCode: 'wuya',
        supplierPricePerM2: null,
        pricePerM2: null,
        currencyCode: null,
        pricePerSheet: null,
        totalPrice: null,
        priceApprovedAt: null,
      }),
    );
  });

  it('converts the request after its purchase price is configured', async () => {
    const technicalItem = {
      ...calculation.items[0],
      panelTypeId: 'type-id',
      panelSizeId: 'size-id',
      qualityClassId: 'quality-id',
      panelSize: {
        ...calculation.items[0].panelSize,
        widthMm: 1220,
        heightMm: 2440,
      },
      supplierId: 'supplier-id',
      supplier: { id: 'supplier-id', code: 'wuya', name: 'Wuya' },
      color: {
        ...calculation.items[0].color,
        supplierId: 'supplier-id',
      },
      supplierPricePerM2: new Prisma.Decimal(0),
      clientPricePerM2: new Prisma.Decimal(0),
      pricePerM2: new Prisma.Decimal(0),
      pricePerSheet: new Prisma.Decimal(0),
      totalPrice: new Prisma.Decimal(0),
    };
    const requestGroup = {
      ...calculation,
      requestId: 'request-id',
      title: 'Technical request',
      notes: null,
      sortOrder: 0,
      totalAmount: new Prisma.Decimal(0),
      cnyUsdRate: null,
      commercialSupplierId: null,
      commercialQualityClassId: null,
      commercialConfirmedAt: null,
      items: [technicalItem],
    };
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...requestGroup,
      request: { quotes: [], calculations: [requestGroup] },
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    expect(panelPriceCalculator.calculate).not.toHaveBeenCalled();
    expect(prisma.supplierQualityMapping.findFirst).toHaveBeenCalledWith({
      where: {
        supplierId: 'supplier-id',
        panelTypeId: 'type-id',
        qualityClassId: 'quality-id',
      },
    });
    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      totalAmount: Prisma.Decimal;
      cnyUsdRate: Prisma.Decimal | null;
      productionDaysFrom: number | null;
      productionDaysTo: number | null;
      deliveryDaysFrom: number | null;
      deliveryDaysTo: number | null;
      items: {
        create: Array<{
          supplierCode: string;
          supplierName: string;
          supplierPricePerM2: Prisma.Decimal | null;
          pricePerM2: Prisma.Decimal | null;
          totalPrice: Prisma.Decimal | null;
        }>;
      };
    };
    expect(createData.totalAmount.toString()).toBe('0');
    expect(createData.cnyUsdRate).toBeNull();
    expect(createData.productionDaysFrom).toBeNull();
    expect(createData.productionDaysTo).toBeNull();
    expect(createData.deliveryDaysFrom).toBeNull();
    expect(createData.deliveryDaysTo).toBeNull();
    expect(createData.items.create[0]).toEqual(
      expect.objectContaining({
        supplierCode: 'wuya',
        supplierName: 'Wuya',
      }),
    );
    expect(createData.items.create[0]?.supplierPricePerM2).toBeNull();
    expect(createData.items.create[0]?.pricePerM2).toBeNull();
    expect(createData.items.create[0]?.totalPrice).toBeNull();
  });

  it('preserves different suppliers for different request items', async () => {
    const firstItem = {
      ...calculation.items[0],
      panelTypeId: 'type-id',
      panelSizeId: 'size-id',
      qualityClassId: 'quality-id',
      panelSize: {
        ...calculation.items[0].panelSize,
        widthMm: 1220,
        heightMm: 2440,
      },
      supplierId: 'supplier-a',
      supplier: { id: 'supplier-a', code: 'supplier-a', name: 'Supplier A' },
      color: null,
      colorCode: null,
      colorName: null,
      supplierPricePerM2: new Prisma.Decimal(0),
      clientPricePerM2: new Prisma.Decimal(0),
      pricePerM2: new Prisma.Decimal(0),
      pricePerSheet: new Prisma.Decimal(0),
      totalPrice: new Prisma.Decimal(0),
    };
    const secondItem = {
      ...firstItem,
      supplierId: 'supplier-b',
      supplier: { id: 'supplier-b', code: 'supplier-b', name: 'Supplier B' },
      requiredAreaM2: new Prisma.Decimal('25'),
    };
    const requestGroup = {
      ...calculation,
      requestId: 'request-id',
      title: 'Technical request',
      notes: null,
      sortOrder: 0,
      totalAmount: new Prisma.Decimal(0),
      cnyUsdRate: null,
      commercialSupplierId: null,
      commercialQualityClassId: null,
      commercialConfirmedAt: null,
      items: [firstItem, secondItem],
    };
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...requestGroup,
      request: { quotes: [], calculations: [requestGroup] },
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping-id',
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      items: {
        create: Array<{
          supplierCode: string;
          supplierName: string;
          totalPrice: Prisma.Decimal | null;
        }>;
      };
    };
    expect(createData.items.create).toHaveLength(2);
    expect(createData.items.create).toEqual([
      expect.objectContaining({
        supplierCode: 'supplier-a',
        supplierName: 'Supplier A',
      }),
      expect.objectContaining({
        supplierCode: 'supplier-b',
        supplierName: 'Supplier B',
      }),
    ]);
  });

  it('ignores a legacy global supplierId and keeps mixed item suppliers', async () => {
    const firstItem = {
      ...calculation.items[0],
      panelTypeId: 'type-id',
      panelSizeId: 'size-id',
      qualityClassId: 'quality-id',
      panelSize: {
        ...calculation.items[0].panelSize,
        widthMm: 1220,
        heightMm: 2440,
      },
      supplierId: 'supplier-a',
      supplier: { id: 'supplier-a', code: 'supplier-a', name: 'Supplier A' },
      color: null,
      colorCode: null,
      colorName: null,
      supplierPricePerM2: new Prisma.Decimal(0),
      clientPricePerM2: new Prisma.Decimal(0),
      pricePerM2: new Prisma.Decimal(0),
      pricePerSheet: new Prisma.Decimal(0),
      totalPrice: new Prisma.Decimal(0),
    };
    const secondItem = {
      ...firstItem,
      supplierId: 'supplier-b',
      supplier: { id: 'supplier-b', code: 'supplier-b', name: 'Supplier B' },
      requiredAreaM2: new Prisma.Decimal('25'),
    };
    const requestGroup = {
      ...calculation,
      requestId: 'request-id',
      title: 'Technical request',
      notes: null,
      sortOrder: 0,
      totalAmount: new Prisma.Decimal(0),
      cnyUsdRate: null,
      commercialSupplierId: null,
      commercialQualityClassId: null,
      commercialConfirmedAt: null,
      items: [firstItem, secondItem],
    };
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...requestGroup,
      request: { quotes: [], calculations: [requestGroup] },
    });
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping-id',
    });

    await service.createFromCalculation(
      'calc-id',
      { supplierId: 'global-supplier' },
      headCommercial,
    );

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      items: {
        create: Array<{
          supplierCode: string;
          supplierName: string;
        }>;
      };
    };
    expect(createData.items.create).toEqual([
      expect.objectContaining({
        supplierCode: 'supplier-a',
        supplierName: 'Supplier A',
      }),
      expect.objectContaining({
        supplierCode: 'supplier-b',
        supplierName: 'Supplier B',
      }),
    ]);
    expect(
      createData.items.create.map((item) => item.supplierCode),
    ).not.toContain('global-supplier');
    expect(prisma.supplier.findUnique).not.toHaveBeenCalledWith({
      where: { id: 'global-supplier' },
    });
  });

  it('copies calculation pricing snapshot onto the quote without catalog lookup', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      displayCurrency: 'USD',
      cnyUsdRate: new Prisma.Decimal('0.15'),
      sellingCoefficient: new Prisma.Decimal('2'),
      items: [
        {
          ...calculation.items[0],
          supplierPricePerM2: new Prisma.Decimal('80'),
          clientPricePerM2: new Prisma.Decimal('24'),
          pricePerM2: new Prisma.Decimal('24'),
          pricePerSheet: new Prisma.Decimal('66.98'),
          totalPrice: new Prisma.Decimal('401.88'),
        },
      ],
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      cnyUsdRate: Prisma.Decimal | null;
      sellingCoefficient: Prisma.Decimal;
      items: {
        create: Array<{
          supplierPricePerM2: Prisma.Decimal;
          pricePerM2: Prisma.Decimal;
          totalPrice: Prisma.Decimal;
          priceApprovedAt: Date | null;
        }>;
      };
    };
    expect(createData.cnyUsdRate).toBeNull();
    expect(createData.sellingCoefficient.toString()).toBe('2');
    expect(createData.items.create[0]?.supplierPricePerM2.toString()).toBe(
      '80',
    );
    expect(createData.items.create[0]?.pricePerM2.toString()).toBe('24');
    expect(createData.items.create[0]?.totalPrice.toString()).toBe('401.88');
    expect(createData.items.create[0]?.priceApprovedAt).toBeNull();
    expect(prisma.panelThicknessPricing).toBeUndefined();
  });

  it('snapshots manager technical fields onto the quote without live catalog JOIN', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      items: [
        {
          ...calculation.items[0],
          coating: 'PE',
          texture: 'woodgrain',
          customTypeDescription: 'Special fire-rated HPL',
          customWidthMm: 1400,
          customHeightMm: 3100,
          sheetsCount: 4,
          color: { colorCode: 'W100', colorName: 'White Oak' },
        },
      ],
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      items: {
        create: Array<{
          sheetsCount: number;
          customWidthMm: number | null;
          customHeightMm: number | null;
          coating: string | null;
          texture: string | null;
          customTypeDescription: string | null;
          colorCode: string | null;
          colorName: string | null;
          panelSizeName: string;
        }>;
      };
    };
    expect(createData.items.create[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 4,
        customWidthMm: 1400,
        customHeightMm: 3100,
        coating: 'PE',
        texture: 'woodgrain',
        customTypeDescription: 'Special fire-rated HPL',
        colorCode: 'W100',
        colorName: 'White Oak',
        panelSizeName: '1220×2440',
      }),
    );
  });

  it('snapshots the backend-calculated sheetsCount onto the quote', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      items: [
        {
          ...calculation.items[0],
          panelSize: {
            displayName: '1830×3050',
            areaM2: new Prisma.Decimal('5.5815'),
          },
          requiredAreaM2: new Prisma.Decimal('1000'),
          sheetsCount: 180,
        },
      ],
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      items: {
        create: Array<{ sheetsCount: number; requiredAreaM2: Prisma.Decimal }>;
      };
    };
    expect(createData.items.create[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 180,
        requiredAreaM2: new Prisma.Decimal('1000'),
        panelSizeName: '1830×3050',
      }),
    );
  });

  it('returns historical quote technical snapshot without catalog JOIN', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      managerId: 'manager-id',
      items: [
        {
          sheetsCount: 4,
          customWidthMm: 1400,
          customHeightMm: 3100,
          coating: 'PE',
          texture: 'woodgrain',
          customTypeDescription: 'Special fire-rated HPL',
          colorCode: 'W100',
          colorName: 'White Oak',
          panelSizeName: '1220×2440',
        },
      ],
    });

    const quote = await service.findOne('quote-id', manager);

    expect(quote.items[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 4,
        customWidthMm: 1400,
        customHeightMm: 3100,
        coating: 'PE',
        texture: 'woodgrain',
        customTypeDescription: 'Special fire-rated HPL',
        colorCode: 'W100',
        colorName: 'White Oak',
      }),
    );
  });

  it('lets HEAD snapshot production, delivery and validity without a note or client date', async () => {
    const validUntil = new Date('2026-08-20T00:00:00.000Z');
    const forgedDocumentDate = new Date('2026-08-14T00:00:00.000Z');

    await service.createFromCalculation(
      'calc-id',
      {
        productionTerms: '15–20 рабочих дней',
        deliveryTerms: 'Ориентировочно 4 недели после утверждения декора',
        validUntil,
        documentDate: forgedDocumentDate,
      } as never,
      headCommercial,
    );

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      productionTerms: string | null;
      deliveryTerms: string | null;
      productionDaysFrom: number | null;
      productionDaysTo: number | null;
      deliveryDaysFrom: number | null;
      deliveryDaysTo: number | null;
      validUntil: Date;
      documentDate: Date;
      commercialNote: string | null;
    };
    expect(createData.productionTerms).toBe('15–20 рабочих дней');
    expect(createData.deliveryTerms).toBe(
      'Ориентировочно 4 недели после утверждения декора',
    );
    expect(createData.productionDaysFrom).toBeNull();
    expect(createData.productionDaysTo).toBeNull();
    expect(createData.deliveryDaysFrom).toBeNull();
    expect(createData.deliveryDaysTo).toBeNull();
    expect(createData.validUntil).toEqual(validUntil);
    expect(createData.documentDate.getTime()).not.toBe(
      forgedDocumentDate.getTime(),
    );
    expect(
      Math.abs(createData.documentDate.getTime() - Date.now()),
    ).toBeLessThan(5_000);
    expect(createData.commercialNote).toBeNull();
  });

  it('copies CalculationRequest notes into Quote.internalCommercialNote at convert', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      request: {
        notes:
          'Клиент хочет жёлтый декор, окончательный цвет согласовать перед заказом.',
        quotes: [],
        calculations: [calculation],
      },
      lead: {
        ...calculation.lead,
        managerCommercialNote: null,
      },
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      commercialNote: string | null;
      internalCommercialNote: string | null;
    };
    expect(createData.commercialNote).toBeNull();
    expect(createData.internalCommercialNote).toBe(
      'Клиент хочет жёлтый декор, окончательный цвет согласовать перед заказом.',
    );
  });

  it('does not copy a leftover Lead manager note when CalculationRequest notes are empty', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      request: {
        notes: null,
        quotes: [],
        calculations: [calculation],
      },
      lead: {
        ...calculation.lead,
        managerCommercialNote: 'Пожелания клиента: CIP Tashkent',
      },
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      commercialNote: string | null;
      internalCommercialNote: string | null;
    };
    expect(createData.commercialNote).toBeNull();
    expect(createData.internalCommercialNote).toBeNull();
  });

  it('forbids MANAGER from overriding the Lead note snapshot at convert', async () => {
    await expect(
      service.createFromCalculation(
        'calc-id',
        { commercialNote: 'Quote snapshot note' },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('does not rewrite an existing Quote when later Lead source note is different', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      commercialNote: 'Original snapshot',
      items: [],
    });

    await expect(
      service.updateCommercialTerms(
        'quote-id',
        { commercialNote: 'Later source rewrite' },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_COMMERCIAL_NOTE_FORBIDDEN',
      }),
    });
    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
  });

  it('forbids MANAGER from snapshotting commercial terms at convert', async () => {
    await expect(
      service.createFromCalculation(
        'calc-id',
        {
          productionDaysFrom: 10,
          productionDaysTo: 20,
          deliveryDaysFrom: 14,
          deliveryDaysTo: 25,
          validUntil: new Date('2026-08-20T00:00:00.000Z'),
          commercialNote: 'Цена указана с учётом 1 контейнера CIP Tashkent.',
        },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('allows HEAD to write the commercial note', async () => {
    await service.createFromCalculation(
      'calc-id',
      { commercialNote: 'CIP Tashkent' },
      headCommercial,
    );

    const createData = prisma.panelQuote.create.mock.calls[0][0].data as {
      commercialNote: string | null;
    };
    expect(createData.commercialNote).toBe('CIP Tashkent');
  });

  it('rejects invalid production and delivery ranges from HEAD', async () => {
    await expect(
      service.createFromCalculation(
        'calc-id',
        { productionDaysFrom: 20, productionDaysTo: 10 },
        headCommercial,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_PRODUCTION_PERIOD',
      }),
    });
    await expect(
      service.createFromCalculation(
        'calc-id',
        { deliveryDaysFrom: 0, deliveryDaysTo: 14 },
        headCommercial,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_DELIVERY_PERIOD',
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('forbids DIRECTOR and ADMIN-only from crafting client-facing Quote terms', async () => {
    const crafted = {
      productionDaysFrom: 10,
      productionDaysTo: 20,
      deliveryDaysFrom: 14,
      deliveryDaysTo: 25,
      validUntil: new Date('2026-08-20T00:00:00.000Z'),
    };

    await expect(
      service.createFromCalculation('calc-id', crafted, director),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: 403,
      }),
    });
    await expect(
      service.createFromCalculation('calc-id', crafted, {
        ...manager,
        id: 'admin-id',
        roles: ['ADMIN'],
        permissions: [
          'quotes:create',
          'quotes:read_all',
          'calculations:read_all',
        ],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('lets HEAD update production, delivery and validity on a draft Quote', async () => {
    const draft = {
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.DRAFT,
      cnyUsdRate: new Prisma.Decimal('0.15'),
      sellingCoefficient: new Prisma.Decimal('2'),
      items: [],
    };
    prisma.panelQuote.findUnique.mockResolvedValue(draft);
    prisma.panelQuote.update.mockResolvedValue({
      ...draft,
      productionDaysFrom: 12,
    });

    await service.updateCommercialTerms(
      'quote-id',
      {
        productionDaysFrom: 12,
        productionDaysTo: 18,
        deliveryDaysFrom: 14,
        deliveryDaysTo: 21,
        validUntil: new Date('2026-09-01T00:00:00.000Z'),
      },
      headCommercial,
    );

    expect(prisma.panelQuote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productionDaysFrom: 12,
          productionDaysTo: 18,
          deliveryDaysFrom: 14,
          deliveryDaysTo: 21,
        }),
      }),
    );
    const updateData = prisma.panelQuote.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(updateData.cnyUsdRate).toBeUndefined();
    expect(updateData.sellingCoefficient).toBeUndefined();
    expect(updateData.documentDate).toBeUndefined();
  });

  it('saves text production/delivery terms and clears numeric duplicates', async () => {
    const draft = {
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.DRAFT,
      productionDaysFrom: 10,
      productionDaysTo: 20,
      deliveryDaysFrom: 14,
      deliveryDaysTo: 25,
      items: [],
    };
    prisma.panelQuote.findUnique.mockResolvedValue(draft);
    prisma.panelQuote.update.mockResolvedValue({
      ...draft,
      productionTerms: '15–20 рабочих дней',
      deliveryTerms: 'Ориентировочно 4 недели после утверждения декора',
      productionDaysFrom: null,
      productionDaysTo: null,
      deliveryDaysFrom: null,
      deliveryDaysTo: null,
    });

    await service.updateCommercialTerms(
      'quote-id',
      {
        productionTerms: '15–20 рабочих дней',
        deliveryTerms: 'Ориентировочно 4 недели после утверждения декора',
        validUntil: new Date('2026-09-01T00:00:00.000Z'),
      },
      headCommercial,
    );

    expect(prisma.panelQuote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productionTerms: '15–20 рабочих дней',
          deliveryTerms: 'Ориентировочно 4 недели после утверждения декора',
          productionDaysFrom: null,
          productionDaysTo: null,
          deliveryDaysFrom: null,
          deliveryDaysTo: null,
        }),
      }),
    );
  });

  it('forbids MANAGER from updating client-facing terms on a draft', async () => {
    const draft = {
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.DRAFT,
      items: [],
    };
    prisma.panelQuote.findUnique.mockResolvedValue(draft);
    prisma.panelQuote.update.mockResolvedValue(draft);

    await expect(
      service.updateCommercialTerms(
        'quote-id',
        {
          productionDaysFrom: 8,
          productionDaysTo: 12,
          commercialNote: 'CIP Tashkent',
        },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_CLIENT_TERMS_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
  });

  it('allows HEAD to mutate the commercial note after convert', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.DRAFT,
      finalizedAt: null,
      items: [],
    });
    prisma.panelQuote.update.mockResolvedValue({
      id: 'quote-id',
      commercialNote: 'HEAD note',
      items: [],
    });

    await service.updateCommercialTerms(
      'quote-id',
      { commercialNote: 'HEAD note' },
      headCommercial,
    );

    expect(prisma.panelQuote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ commercialNote: 'HEAD note' }),
      }),
    );
  });

  it('rejects a MANAGER payload that mixes terms with forged pricing fields', async () => {
    const draft = {
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.DRAFT,
      cnyUsdRate: new Prisma.Decimal('0.15'),
      sellingCoefficient: new Prisma.Decimal('2'),
      items: [],
    };
    prisma.panelQuote.findUnique.mockResolvedValue(draft);
    prisma.panelQuote.update.mockResolvedValue(draft);

    await expect(
      service.updateCommercialTerms(
        'quote-id',
        {
          productionDaysFrom: 10,
          productionDaysTo: 12,
          cnyUsdRate: '9.99',
          sellingCoefficient: '99',
          purchasePricePerM2Cny: '1',
          documentDate: new Date('2020-01-01T00:00:00.000Z'),
        } as never,
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_CLIENT_TERMS_FORBIDDEN',
      }),
    });
    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
  });

  it('locks client-facing term edits after the Quote leaves draft', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      items: [],
    });

    await expect(
      service.updateCommercialTerms(
        'quote-id',
        { productionDaysFrom: 10, productionDaysTo: 12 },
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_TERMS_LOCKED',
        statusCode: HttpStatus.CONFLICT,
      }),
    });
    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
  });

  it('rejects quote creation when calculation was not created under Stage 2', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      commercialConfirmedAt: null,
    });

    await expect(
      service.createFromCalculation('calc-id', {}, headCommercial),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CALCULATION_NOT_COMMERCIALLY_QUALIFIED',
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('rejects quote creation when Stage 2 has changed since the calculation', async () => {
    prisma.leadCommercialQualification.findUnique.mockResolvedValue({
      supplierId: 'new-supplier-id',
      qualityClassId: 'new-quality-id',
      status: 'CONFIRMED',
      confirmedAt: new Date('2026-08-18T00:00:00.000Z'),
    });

    await expect(
      service.createFromCalculation('calc-id', {}, headCommercial),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'COMMERCIAL_QUALIFICATION_CHANGED',
        statusCode: HttpStatus.CONFLICT,
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('rejects quote creation when supplier/quality match but confirmedAt does not', async () => {
    prisma.leadCommercialQualification.findUnique.mockResolvedValue({
      supplierId: 'supplier-id',
      qualityClassId: 'quality-id',
      status: 'CONFIRMED',
      confirmedAt: new Date('2026-08-18T00:00:00.000Z'),
    });

    await expect(
      service.createFromCalculation('calc-id', {}, headCommercial),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'COMMERCIAL_QUALIFICATION_CHANGED',
        statusCode: HttpStatus.CONFLICT,
      }),
    });
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('allows quote creation after an identical Stage-2 retry that does not change confirmedAt', async () => {
    prisma.leadCommercialQualification.findUnique.mockResolvedValue({
      supplierId: 'supplier-id',
      qualityClassId: 'quality-id',
      status: 'CONFIRMED',
      confirmedAt,
    });

    await service.createFromCalculation('calc-id', {}, headCommercial);

    expect(prisma.panelQuote.create).toHaveBeenCalled();
  });

  it('rejects quote creation when calculation is not finalized', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      status: CALCULATION_STATUS.DRAFT,
    });

    await expect(
      service.createFromCalculation('calc-id', {}, headCommercial),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CALCULATION_NOT_FINALIZED',
      }),
    });
  });

  it('allows draft to sent transition', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.DRAFT,
      finalizedAt: new Date(),
      pdfFileId: 'file-id',
      validUntil: new Date(Date.now() + 86_400_000),
      rejectionReason: null,
      items: [],
    });
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue({
      id: 'quote-id',
      status: QUOTE_STATUS.SENT,
      managerId: 'manager-id',
      leadId: 'lead-id',
      items: [],
    });
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-id',
      client: { email: null },
    });

    const result = await service.updateStatus(
      'quote-id',
      { status: QUOTE_STATUS.SENT },
      manager,
    );

    expect(result.status).toBe(QUOTE_STATUS.SENT);
  });

  it('blocks draft to approved transition', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.DRAFT,
      validUntil: new Date(Date.now() + 86_400_000),
      items: [],
    });

    await expect(
      service.updateStatus(
        'quote-id',
        { status: QUOTE_STATUS.APPROVED },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_QUOTE_TRANSITION',
        statusCode: HttpStatus.CONFLICT,
      }),
    });
  });

  it('forbids reading another manager quote without quotes:read_all', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      managerId: 'other-manager',
      items: [],
    });

    await expect(service.findOne('quote-id', manager)).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
  });

  it('denies Manager self-approval of a sent quote', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      finalizedAt: new Date('2026-08-23T10:00:00Z'),
      pdfFileId: 'file-id',
      validUntil: new Date(Date.now() + 86_400_000),
      items: [],
    });

    await expect(
      service.updateStatus(
        'quote-id',
        { status: QUOTE_STATUS.APPROVED },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
  });

  it('denies Manager approval even when they own the quote and have read_all', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      finalizedAt: new Date('2026-08-23T10:00:00Z'),
      pdfFileId: 'file-id',
      validUntil: new Date(Date.now() + 86_400_000),
      items: [],
    });

    await expect(
      service.updateStatus(
        'quote-id',
        { status: QUOTE_STATUS.APPROVED },
        managerWithReadAll,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
      }),
    });
  });

  it('denies DIRECTOR and ADMIN quote approval without quotes:approve', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      validUntil: new Date(Date.now() + 86_400_000),
      items: [],
    });

    const director: CurrentUser = {
      id: 'director-id',
      email: 'director@test.com',
      teamId: null,
      managerId: null,
      roles: ['DIRECTOR'],
      permissions: ['quotes:read', 'quotes:read_all', 'quotes:update'],
    };
    const admin: CurrentUser = {
      id: 'admin-id',
      email: 'admin@test.com',
      teamId: null,
      managerId: null,
      roles: ['ADMIN'],
      permissions: ['quotes:read', 'quotes:read_all', 'quotes:update'],
    };

    await expect(
      service.updateStatus(
        'quote-id',
        { status: QUOTE_STATUS.APPROVED },
        director,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
      }),
    });
    await expect(
      service.updateStatus(
        'quote-id',
        { status: QUOTE_STATUS.APPROVED },
        admin,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
      }),
    });
  });

  it('does not grant quote approval to DIRECTOR+ADMIN without quotes:approve', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      validUntil: new Date(Date.now() + 86_400_000),
      items: [],
    });

    const directorAdmin: CurrentUser = {
      id: 'director-admin-id',
      email: 'director-admin@test.com',
      teamId: null,
      managerId: null,
      roles: ['DIRECTOR', 'ADMIN'],
      permissions: [
        'quotes:read',
        'quotes:read_all',
        'quotes:update',
        'users:create',
      ],
    };

    await expect(
      service.updateStatus(
        'quote-id',
        { status: QUOTE_STATUS.APPROVED },
        directorAdmin,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
      }),
    });
  });

  it('keeps HEAD quote approval when ADMIN is also assigned', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      finalizedAt: new Date('2026-08-23T10:00:00Z'),
      pdfFileId: 'file-id',
      validUntil: new Date(Date.now() + 86_400_000),
      rejectionReason: null,
      items: [],
    });
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue({
      id: 'quote-id',
      status: QUOTE_STATUS.APPROVED,
      managerId: 'manager-id',
      leadId: 'lead-id',
      items: [],
    });
    prisma.notification.create.mockResolvedValue({});

    const headAdmin: CurrentUser = {
      ...head,
      id: 'head-admin-id',
      roles: ['HEAD', 'ADMIN'],
      permissions: [...head.permissions, 'users:create'],
    };

    const result = await service.updateStatus(
      'quote-id',
      { status: QUOTE_STATUS.APPROVED },
      headAdmin,
    );
    expect(result.status).toBe(QUOTE_STATUS.APPROVED);
  });

  it('allows authorized role to approve a sent quote', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      finalizedAt: new Date('2026-08-23T10:00:00Z'),
      pdfFileId: 'file-id',
      validUntil: new Date(Date.now() + 86_400_000),
      rejectionReason: null,
      items: [],
    });
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue({
      id: 'quote-id',
      status: QUOTE_STATUS.APPROVED,
      managerId: 'manager-id',
      leadId: 'lead-id',
      items: [],
    });
    prisma.notification.create.mockResolvedValue({});

    const result = await service.updateStatus(
      'quote-id',
      { status: QUOTE_STATUS.APPROVED },
      head,
    );

    expect(result.status).toBe(QUOTE_STATUS.APPROVED);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'QUOTE_APPROVED',
          entityType: 'PanelQuote',
          entityId: 'quote-id',
        }),
      }),
    );
  });

  it('allows only one competing status transition to win from the same state', async () => {
    let status: string = QUOTE_STATUS.SENT;
    const currentQuote = () => ({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status,
      validUntil: new Date(Date.now() + 86_400_000),
      rejectionReason: null,
      items: [],
    });
    prisma.panelQuote.findUnique.mockImplementation(async () => currentQuote());
    prisma.panelQuote.findUniqueOrThrow.mockImplementation(async () =>
      currentQuote(),
    );
    prisma.panelQuote.updateMany.mockImplementation(async ({ where, data }) => {
      if (status !== where.status) return { count: 0 };
      status = data.status;
      return { count: 1 };
    });
    prisma.notification.create.mockResolvedValue({});

    const outcomes = await Promise.allSettled([
      service.updateStatus('quote-id', { status: QUOTE_STATUS.APPROVED }, head),
      service.updateStatus(
        'quote-id',
        { status: QUOTE_STATUS.REJECTED, rejectionReason: 'No budget' },
        head,
      ),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect([QUOTE_STATUS.APPROVED, QUOTE_STATUS.REJECTED]).toContain(status);
    expect(prisma.activity.create).toHaveBeenCalledTimes(1);
  });

  it('does not convert an unapproved quote and does not create an offer', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      dealId: null,
      items: [],
    });

    await expect(service.convertToDeal('quote-id', head)).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          errorCode: 'QUOTE_NOT_APPROVED',
        }),
      },
    );
    expect(dealFactory.createFromQuote).not.toHaveBeenCalled();
  });

  it('does not convert an approved quote when the lead is not QUALIFIED', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      finalizedAt: new Date(),
      pdfFileId: 'file-id',
      dealId: null,
      items: [
        {
          supplierCode: 'wuya',
          priceApprovedAt: new Date(),
          pricePerM2: new Prisma.Decimal('20'),
          currencyCode: 'USD',
        },
      ],
    });
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      clientId: 'client-id',
      projectObjectId: null,
      dealId: null,
      status: 'NEW',
    });

    await expect(service.convertToDeal('quote-id', head)).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          errorCode: 'LEAD_NOT_QUALIFIED',
          statusCode: HttpStatus.BAD_REQUEST,
        }),
      },
    );
    expect(dealFactory.createFromQuote).not.toHaveBeenCalled();
  });

  it('converts approved quote to deal', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      calculationId: 'calc-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      finalizedAt: new Date(),
      pdfFileId: 'file-id',
      dealId: null,
      totalAmount: new Prisma.Decimal('1000'),
      displayCurrency: 'UZS',
      validUntil: new Date(Date.now() + 86_400_000),
      items: [
        {
          areaM2: new Prisma.Decimal('2.9768'),
          sheetsCount: 2,
          pricePerM2: new Prisma.Decimal('69000'),
          priceApprovedAt: new Date(),
          currencyCode: 'UZS',
          supplierPricePerM2: new Prisma.Decimal('60000'),
          totalPrice: new Prisma.Decimal('200'),
          supplierCode: 'wuya',
        },
      ],
    });
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      clientId: 'client-id',
      projectObjectId: null,
      dealId: null,
      status: 'QUALIFIED',
    });
    prisma.product.findUnique.mockResolvedValue({ id: 'product-id' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-id' });
    dealFactory.createFromQuote.mockResolvedValue({
      id: 'deal-id',
      title: 'Deal',
    });
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    prisma.panelQuote.updateMany.mockResolvedValue({ count: 1 });
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue({
      id: 'quote-id',
      status: QUOTE_STATUS.CONVERTED,
      dealId: 'deal-id',
      items: [],
    });
    prisma.calculationSession.update.mockResolvedValue({});
    prisma.task.create.mockResolvedValue({});

    const result = await service.convertToDeal('quote-id', head);

    expect(result.dealId).toBe('deal-id');
    expect(dealFactory.createFromQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        supplierId: 'supplier-id',
        serviceProductId: 'product-id',
      }),
    );
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead-id',
        deletedAt: null,
        OR: [{ dealId: 'deal-id' }, { dealId: null }],
        status: { in: ['QUALIFIED', 'CONVERTED'] },
      },
      data: { dealId: 'deal-id', status: 'CONVERTED' },
    });
    expect(prisma.panelQuote.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'quote-id',
        OR: [{ dealId: 'deal-id' }, { dealId: null }],
        status: QUOTE_STATUS.APPROVED,
      },
      data: {
        status: QUOTE_STATUS.CONVERTED,
        dealId: 'deal-id',
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'QUOTE_CONVERTED',
          entityId: 'quote-id',
        }),
      }),
    );
  });

  it('aborts with conflict when the lead was already claimed', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      calculationId: 'calc-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      finalizedAt: new Date(),
      pdfFileId: 'file-id',
      dealId: null,
      totalAmount: new Prisma.Decimal('1000'),
      displayCurrency: 'USD',
      validUntil: new Date(Date.now() + 86_400_000),
      items: [
        {
          areaM2: new Prisma.Decimal('2.9768'),
          sheetsCount: 2,
          pricePerM2: new Prisma.Decimal('20'),
          priceApprovedAt: new Date(),
          currencyCode: 'USD',
          supplierPricePerM2: new Prisma.Decimal('100'),
          totalPrice: new Prisma.Decimal('200'),
          supplierCode: 'wuya',
        },
      ],
    });
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      clientId: 'client-id',
      projectObjectId: null,
      dealId: null,
      status: 'QUALIFIED',
    });
    prisma.product.findUnique.mockResolvedValue({ id: 'product-id' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-id' });
    dealFactory.createFromQuote.mockResolvedValue({
      id: 'deal-id',
      title: 'Deal',
    });
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.convertToDeal('quote-id', head)).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          errorCode: 'LEAD_ALREADY_CONVERTED',
          statusCode: HttpStatus.CONFLICT,
        }),
      },
    );
  });

  it('aborts with conflict when the quote was already claimed', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      calculationId: 'calc-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      finalizedAt: new Date(),
      pdfFileId: 'file-id',
      dealId: null,
      totalAmount: new Prisma.Decimal('1000'),
      displayCurrency: 'USD',
      validUntil: new Date(Date.now() + 86_400_000),
      items: [
        {
          areaM2: new Prisma.Decimal('2.9768'),
          sheetsCount: 2,
          pricePerM2: new Prisma.Decimal('20'),
          priceApprovedAt: new Date(),
          currencyCode: 'USD',
          supplierPricePerM2: new Prisma.Decimal('100'),
          totalPrice: new Prisma.Decimal('200'),
          supplierCode: 'wuya',
        },
      ],
    });
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      clientId: 'client-id',
      projectObjectId: null,
      dealId: null,
      status: 'QUALIFIED',
    });
    prisma.product.findUnique.mockResolvedValue({ id: 'product-id' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-id' });
    dealFactory.createFromQuote.mockResolvedValue({
      id: 'deal-id',
      title: 'Deal',
    });
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    prisma.panelQuote.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.convertToDeal('quote-id', head)).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          errorCode: 'QUOTE_ALREADY_CONVERTED',
          statusCode: HttpStatus.CONFLICT,
        }),
      },
    );
  });

  it('records client acceptance by the owning Manager after HEAD approval', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      clientAcceptedAt: null,
      clientAcceptedById: null,
      items: [],
    });
    prisma.panelQuote.updateMany.mockResolvedValue({ count: 1 });
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue({
      id: 'quote-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      clientAcceptedAt: new Date('2026-08-17T10:00:00.000Z'),
      clientAcceptedById: 'manager-id',
      items: [],
    });

    const result = await service.recordClientAcceptance('quote-id', manager);

    expect(result.clientAcceptedById).toBe('manager-id');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'QUOTE_CLIENT_ACCEPTED',
          entityType: 'PanelQuote',
          entityId: 'quote-id',
          userId: 'manager-id',
        }),
      }),
    );
  });

  it('rejects client acceptance when the Quote is not internally approved', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      clientAcceptedAt: null,
      items: [],
    });

    await expect(
      service.recordClientAcceptance('quote-id', manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_NOT_APPROVED',
      }),
    });
    expect(prisma.panelQuote.updateMany).not.toHaveBeenCalled();
  });

  it('rejects client acceptance by a foreign Manager', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'other-manager',
      status: QUOTE_STATUS.APPROVED,
      clientAcceptedAt: null,
      items: [],
    });

    await expect(
      service.recordClientAcceptance('quote-id', manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_CLIENT_ACCEPT_FORBIDDEN',
      }),
    });
  });

  it('does not treat HEAD quotes:read_all as customer-contact acceptance', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      clientAcceptedAt: null,
      items: [],
    });

    await expect(
      service.recordClientAcceptance('quote-id', head),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_CLIENT_ACCEPT_FORBIDDEN',
      }),
    });
  });

  it('is idempotent on repeat client acceptance and does not duplicate audit', async () => {
    const accepted = {
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      clientAcceptedAt: new Date('2026-08-17T10:00:00.000Z'),
      clientAcceptedById: 'manager-id',
      items: [],
    };
    prisma.panelQuote.findUnique.mockResolvedValue(accepted);

    const result = await service.recordClientAcceptance('quote-id', manager);

    expect(result.clientAcceptedAt).toEqual(accepted.clientAcceptedAt);
    expect(prisma.panelQuote.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
