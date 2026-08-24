import { FulfillmentSource, LeadStatus, Prisma } from '@prisma/client';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { QUOTE_STATUS } from './quote.constants';
import { QuotesService } from './quotes.service';

describe('QuotesService stock-only fulfillment', () => {
  const user: CurrentUser = {
    id: 'manager-id',
    email: 'manager@example.com',
    teamId: null,
    managerId: null,
    roles: ['HEAD'],
    permissions: ['quotes:read', 'quotes:update', 'quotes:approve'],
  };
  const quote = {
    id: 'quote-id',
    calculationId: 'calc-id',
    leadId: 'lead-id',
    managerId: user.id,
    dealId: null,
    status: QUOTE_STATUS.APPROVED,
    finalizedAt: new Date('2026-08-18T09:00:00Z'),
    pdfFileId: 'file-id',
    clientAcceptedAt: new Date('2026-08-18T10:00:00Z'),
    totalAmount: new Prisma.Decimal('600'),
    displayCurrency: 'USD',
    validUntil: new Date('2026-09-01T00:00:00Z'),
    deliveryCost: null,
    cnyUsdRate: new Prisma.Decimal('0.14'),
    sellingCoefficient: new Prisma.Decimal('1.2'),
    items: [
      {
        id: 'quote-item',
        areaM2: new Prisma.Decimal('3'),
        sheetsCount: 2,
        pricePerM2: new Prisma.Decimal('100'),
        priceApprovedAt: new Date('2026-08-18T08:00:00Z'),
        currencyCode: 'USD',
        supplierPricePerM2: new Prisma.Decimal('50'),
        totalPrice: new Prisma.Decimal('600'),
        thicknessMm: 12,
        supplierCode: 'SUP',
        colorCode: 'C01',
      },
    ],
  };

  function setup(status: 'SUFFICIENT' | 'INSUFFICIENT' = 'SUFFICIENT') {
    const prisma = {
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue(quote),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...quote,
          status: QUOTE_STATUS.CONVERTED,
        }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'lead-id',
          clientId: 'client-id',
          projectObjectId: null,
          dealId: null,
          status: LeadStatus.QUALIFIED,
          qualification: { stockOnly: true },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'service-product' }),
      },
      supplier: {
        findUnique: jest.fn().mockResolvedValue({ id: 'supplier-id' }),
      },
      order: {
        create: jest.fn().mockResolvedValue({
          id: 'order-id',
          items: [
            { id: 'order-item', productId: 'stock-product', quantity: 6 },
          ],
        }),
      },
      orderItem: { update: jest.fn() },
      calculationSession: { update: jest.fn() },
      activity: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      task: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    const dealFactory = {
      createFromQuote: jest
        .fn()
        .mockResolvedValue({ id: 'deal-id', title: 'Deal' }),
    };
    const stock = {
      check: jest.fn().mockResolvedValue({
        status,
        lines: [
          {
            quoteItemId: 'quote-item',
            productId: 'stock-product',
            sku: 'HPL-01',
            requiredQuantity: 6,
            availableQuantity: status === 'SUFFICIENT' ? 10 : 5,
            shortage: status === 'SUFFICIENT' ? 0 : 1,
            resolution: 'RESOLVED',
          },
        ],
      }),
    };
    const inventory = { reserveStock: jest.fn().mockResolvedValue([]) };
    const service = new QuotesService(
      prisma as never,
      { sendEmail: jest.fn() } as never,
      dealFactory as never,
      stock as never,
      inventory as never,
      { persistFinalPdf: jest.fn() } as never,
      { calculate: jest.fn() } as never,
      { getActiveCnyUsdRate: jest.fn() } as never,
    );
    return { prisma, dealFactory, stock, inventory, service };
  }

  it('creates a warehouse Order and reserves stock without a SupplierOrder', async () => {
    const { prisma, dealFactory, inventory, service } = setup();

    await service.convertToDeal('quote-id', user);

    expect(dealFactory.createFromQuote).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
        resolvedProductIds: { 'quote-item': 'stock-product' },
      }),
    );
    expect(prisma.order.create).toHaveBeenCalled();
    expect(inventory.reserveStock).toHaveBeenCalledWith(
      'order-id',
      [{ productId: 'stock-product', quantity: 6 }],
      prisma,
      user.id,
    );
    expect((prisma as any).supplierOrder).toBeUndefined();
  });

  it('returns STOCK_ONLY_INSUFFICIENT without creating Deal, Order, or SupplierOrder', async () => {
    const { prisma, dealFactory, service } = setup('INSUFFICIENT');

    await expect(service.convertToDeal('quote-id', user)).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          errorCode: 'STOCK_ONLY_INSUFFICIENT',
        }),
      },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(dealFactory.createFromQuote).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
