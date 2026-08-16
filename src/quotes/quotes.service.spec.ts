import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CALCULATION_STATUS } from '../calculations/calculation.constants';
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

  const prisma = {
    calculationSession: { findFirst: jest.fn(), update: jest.fn() },
    panelQuote: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    lead: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    product: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    task: { create: jest.fn() },
    notification: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const notificationService = { sendEmail: jest.fn() };
  const dealFactory = {
    createFromQuote: jest.fn(),
  };

  const calculation = {
    id: 'calc-id',
    leadId: 'lead-id',
    status: CALCULATION_STATUS.FINALIZED,
    createdById: 'manager-id',
    totalAmount: new Prisma.Decimal('1000'),
    displayCurrency: 'UZS',
    panelQuote: null,
    items: [
      {
        panelType: { code: 'exterior', displayNameRu: 'Экстерьерные' },
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
    );
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    prisma.calculationSession.findFirst.mockResolvedValue(calculation);
    prisma.panelQuote.create.mockResolvedValue({
      id: 'quote-id',
      status: QUOTE_STATUS.DRAFT,
      items: [],
    });
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('creates quote from finalized calculation', async () => {
    await service.createFromCalculation(
      'calc-id',
      { clientComment: 'Test' },
      manager,
    );

    expect(prisma.panelQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          calculationId: 'calc-id',
          status: QUOTE_STATUS.DRAFT,
        }),
      }),
    );
  });

  it('rejects quote creation when calculation is not finalized', async () => {
    prisma.calculationSession.findFirst.mockResolvedValue({
      ...calculation,
      status: CALCULATION_STATUS.DRAFT,
    });

    await expect(
      service.createFromCalculation('calc-id', {}, manager),
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
      validUntil: new Date(Date.now() + 86_400_000),
      rejectionReason: null,
      items: [],
    });
    prisma.panelQuote.update.mockResolvedValue({
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

  it('allows authorized role to approve a sent quote', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      validUntil: new Date(Date.now() + 86_400_000),
      rejectionReason: null,
      items: [],
    });
    prisma.panelQuote.update.mockResolvedValue({
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

  it('does not convert an unapproved quote and does not create an offer', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.SENT,
      dealId: null,
      items: [],
    });

    await expect(
      service.convertToDeal('quote-id', manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_NOT_APPROVED',
      }),
    });
    expect(dealFactory.createFromQuote).not.toHaveBeenCalled();
  });

  it('converts approved quote to deal', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      id: 'quote-id',
      calculationId: 'calc-id',
      leadId: 'lead-id',
      managerId: 'manager-id',
      status: QUOTE_STATUS.APPROVED,
      dealId: null,
      totalAmount: new Prisma.Decimal('1000'),
      displayCurrency: 'UZS',
      validUntil: new Date(Date.now() + 86_400_000),
      items: [
        {
          areaM2: new Prisma.Decimal('2.9768'),
          sheetsCount: 2,
          pricePerM2: new Prisma.Decimal('69000'),
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
    });
    prisma.product.findUnique.mockResolvedValue({ id: 'product-id' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-id' });
    dealFactory.createFromQuote.mockResolvedValue({
      id: 'deal-id',
      title: 'Deal',
    });
    prisma.panelQuote.update.mockResolvedValue({
      id: 'quote-id',
      status: QUOTE_STATUS.CONVERTED,
      dealId: 'deal-id',
      items: [],
    });
    prisma.calculationSession.update.mockResolvedValue({});
    prisma.task.create.mockResolvedValue({});

    const result = await service.convertToDeal('quote-id', manager);

    expect(result.dealId).toBe('deal-id');
    expect(dealFactory.createFromQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        supplierId: 'supplier-id',
        serviceProductId: 'product-id',
      }),
    );
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-id' },
      data: { dealId: 'deal-id' },
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
});
