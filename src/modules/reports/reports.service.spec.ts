import {
  DealStage,
  ExpectedReceiptStatus,
  InstallationStatus,
  LeadStatus,
  LossReason,
  SupplierOrderStatus,
} from '@prisma/client';
import { ReportsService } from './reports.service';

describe('ReportsService operational overview', () => {
  function setup() {
    const prisma = {
      lead: { groupBy: jest.fn() },
      deal: { groupBy: jest.fn(), count: jest.fn(), findMany: jest.fn() },
      panelQuote: { count: jest.fn(), findMany: jest.fn() },
      supplierOrder: {
        groupBy: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      dealInstallation: { groupBy: jest.fn(), count: jest.fn() },
      stockBalance: { aggregate: jest.fn() },
      expectedReceipt: { groupBy: jest.fn() },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const service = new ReportsService(prisma as never, cache as never);
    return { prisma, service };
  }

  it('returns controlled counts, losses, overdue orders, warehouse state, and durations', async () => {
    const { prisma, service } = setup();
    prisma.lead.groupBy
      .mockResolvedValueOnce([
        { status: LeadStatus.NEW, _count: { id: 2 } },
        { status: LeadStatus.QUALIFIED, _count: { id: 1 } },
        { status: LeadStatus.CONVERTED, _count: { id: 3 } },
        { status: LeadStatus.LOST, _count: { id: 1 } },
      ])
      .mockResolvedValueOnce([
        { lostReasonCode: LossReason.PRICE, _count: { id: 1 } },
      ]);
    prisma.deal.groupBy
      .mockResolvedValueOnce([
        { lostReasonCode: LossReason.NO_STOCK, _count: { id: 2 } },
      ])
      .mockResolvedValueOnce([
        { stage: DealStage.NEGOTIATION, _count: { id: 2 } },
        { stage: DealStage.WON, _count: { id: 1 } },
      ]);
    prisma.panelQuote.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    prisma.deal.count.mockResolvedValue(1);
    prisma.supplierOrder.groupBy.mockResolvedValue([
      { status: SupplierOrderStatus.IN_PRODUCTION, _count: { id: 2 } },
      { status: SupplierOrderStatus.READY_FOR_SHIPMENT, _count: { id: 1 } },
    ]);
    prisma.supplierOrder.count.mockResolvedValue(1);
    prisma.dealInstallation.groupBy.mockResolvedValue([
      { status: InstallationStatus.SCHEDULED, _count: { id: 1 } },
      { status: InstallationStatus.COMPLETED, _count: { id: 2 } },
    ]);
    prisma.dealInstallation.count.mockResolvedValue(1);
    prisma.stockBalance.aggregate.mockResolvedValue({
      _count: { id: 2 },
      _sum: { onHand: 20, reserved: 4 },
    });
    prisma.expectedReceipt.groupBy.mockResolvedValue([
      { status: ExpectedReceiptStatus.PENDING, _count: { id: 2 } },
      { status: ExpectedReceiptStatus.PARTIALLY_RECEIVED, _count: { id: 1 } },
    ]);
    prisma.panelQuote.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-08-01T00:00:00Z'),
        clientAcceptedAt: new Date('2026-08-02T00:00:00Z'),
      },
    ]);
    prisma.supplierOrder.findMany.mockResolvedValue([]);
    prisma.deal.findMany.mockResolvedValue([]);

    const result = await service.getOverview({
      dateFrom: new Date('2026-08-01T00:00:00Z'),
      dateTo: new Date('2026-08-31T23:59:59Z'),
    });

    expect(result.leads).toMatchObject({
      total: 7,
      qualified: 4,
      converted: 3,
      lost: 1,
    });
    expect(result.leads.lossReasons).toEqual({ PRICE: 1 });
    expect(result.quotes).toEqual({
      created: 5,
      approved: 3,
      clientAccepted: 2,
    });
    expect(result.deals).toMatchObject({
      active: 2,
      won: 1,
      operationallyCompleted: 1,
      lossReasons: { NO_STOCK: 2 },
    });
    expect(result.supplierOrders.overdueReadiness).toBe(1);
    expect(result.warehouse).toMatchObject({
      stockRows: 2,
      available: 16,
      pendingPurchases: 2,
      partiallyReceivedPurchases: 1,
    });
    expect(result.averageDurationsHours.quoteCreatedToClientAccepted).toBe(24);
  });

  it('rejects an inverted date range', async () => {
    const { service } = setup();
    await expect(
      service.getOverview({
        dateFrom: new Date('2026-08-10T00:00:00Z'),
        dateTo: new Date('2026-08-01T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('keeps funnel totals separated when USD and legacy UZS coexist', async () => {
    const { prisma, service } = setup();
    prisma.deal.groupBy.mockResolvedValue([
      {
        stage: DealStage.NEGOTIATION,
        currency: 'USD',
        _count: { id: 2 },
        _sum: { totalAmount: 100 },
      },
      {
        stage: DealStage.NEGOTIATION,
        currency: 'UZS',
        _count: { id: 1 },
        _sum: { totalAmount: 1_000_000 },
      },
    ]);

    const result = await service.getFunnel({});
    const negotiation = result.stages.find(
      (stage) => stage.stage === DealStage.NEGOTIATION,
    );

    expect(negotiation).toMatchObject({
      count: 3,
      amount: null,
      currency: null,
      amounts: [
        { amount: 100, currency: 'USD' },
        { amount: 1_000_000, currency: 'UZS' },
      ],
    });
  });
});
