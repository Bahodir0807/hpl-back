import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  FulfillmentSource,
  Prisma,
  RoleName,
  SupplierOrderStatus,
} from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { DealPolicyService } from '../deals/services/deal-policy.service';
import { SupplierOrdersService } from './supplier-orders.service';
import { SUPPLIER_ORDER_REMINDER_TYPE } from './supplier-order.constants';

describe('SupplierOrdersService', () => {
  const prisma = {
    deal: { findFirst: jest.fn() },
    supplier: { findUnique: jest.fn() },
    supplierOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    supplierOrderReminderClaim: { create: jest.fn() },
    notification: { createMany: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findMany: jest.fn() },
    order: { update: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: ['deals:read', 'deals:read_all', 'supplier_orders:manage'],
  };

  const directorAdmin: CurrentUser = {
    id: 'director-admin-id',
    email: 'director-admin@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.DIRECTOR, RoleName.ADMIN],
    permissions: [
      'deals:read',
      'deals:read_all',
      'supplier_orders:manage',
      'users:create',
    ],
  };

  const admin: CurrentUser = {
    id: 'admin-id',
    email: 'admin@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ADMIN],
    permissions: ['users:create'],
  };

  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['deals:read', 'deals:update'],
  };

  let service: SupplierOrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupplierOrdersService(
      prisma as never,
      new DealPolicyService(),
      {
        tryFinalize: jest.fn(),
        tryFinalizeDeal: jest.fn(),
        lockFulfillmentRows: jest.fn(),
      } as never,
    );
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
  });

  it('forbids ADMIN-only and MANAGER from creating a SupplierOrder', async () => {
    await expect(
      service.createForDeal(
        'deal-id',
        {
          supplierId: 'supplier-id',
          orderedAt: new Date('2026-08-17T00:00:00.000Z'),
          expectedReadyAt: new Date('2026-08-20T00:00:00.000Z'),
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createForDeal(
        'deal-id',
        {
          supplierId: 'supplier-id',
          orderedAt: new Date('2026-08-17T00:00:00.000Z'),
          expectedReadyAt: new Date('2026-08-20T00:00:00.000Z'),
        },
        manager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.supplierOrder.create).not.toHaveBeenCalled();
  });

  it('keeps DIRECTOR+ADMIN SupplierOrder authority because DIRECTOR is present', async () => {
    prisma.deal.findFirst.mockResolvedValue({
      id: 'deal-id',
      ownerId: 'manager-id',
      fulfillmentSource: FulfillmentSource.SUPPLIER_ORDER,
      panelQuotes: [
        {
          id: 'quote-id',
          status: 'converted',
          clientAcceptedAt: new Date('2026-08-17T00:00:00.000Z'),
        },
      ],
      order: null,
    });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-id' });
    prisma.supplierOrder.create.mockResolvedValue({
      id: 'so-id',
      status: SupplierOrderStatus.SENT_TO_PRODUCTION,
    });

    await service.createForDeal(
      'deal-id',
      {
        supplierId: 'supplier-id',
        orderedAt: new Date('2026-08-17T00:00:00.000Z'),
        expectedReadyAt: new Date('2026-08-20T00:00:00.000Z'),
      },
      directorAdmin,
    );

    expect(prisma.supplierOrder.create).toHaveBeenCalled();
  });

  it('rejects supplier ordering for a warehouse-stock Deal', async () => {
    prisma.deal.findFirst.mockResolvedValue({
      id: 'deal-id',
      ownerId: 'manager-id',
      fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
      panelQuotes: [],
      order: null,
    });

    await expect(
      service.createForDeal(
        'deal-id',
        {
          supplierId: 'supplier-id',
          orderedAt: new Date('2026-08-17T00:00:00.000Z'),
          expectedReadyAt: new Date('2026-08-20T00:00:00.000Z'),
        },
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'FULFILLMENT_SOURCE_CONFLICT',
      }),
    });
    expect(prisma.supplierOrder.create).not.toHaveBeenCalled();
  });

  it('rejects expectedReadyAt before orderedAt', async () => {
    await expect(
      service.createForDeal(
        'deal-id',
        {
          supplierId: 'supplier-id',
          orderedAt: new Date('2026-08-20T00:00:00.000Z'),
          expectedReadyAt: new Date('2026-08-19T00:00:00.000Z'),
        },
        head,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects nonsense status transitions such as DELIVERED → IN_PRODUCTION', async () => {
    prisma.supplierOrder.findUnique.mockResolvedValue({
      id: 'so-id',
      dealId: 'deal-id',
      status: SupplierOrderStatus.DELIVERED,
    });
    prisma.deal.findFirst.mockResolvedValue({
      ownerId: 'manager-id',
    });

    await expect(
      service.updateStatus('so-id', SupplierOrderStatus.IN_PRODUCTION, head),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.supplierOrder.update).not.toHaveBeenCalled();
  });

  it('allows only one competing status transition to win', async () => {
    let status = SupplierOrderStatus.SENT_TO_PRODUCTION;
    const currentOrder = () => ({
      id: 'so-id',
      dealId: 'deal-id',
      status,
    });
    prisma.supplierOrder.findUnique.mockImplementation(async () =>
      currentOrder(),
    );
    prisma.supplierOrder.findUniqueOrThrow.mockImplementation(async () =>
      currentOrder(),
    );
    prisma.supplierOrder.updateMany.mockImplementation(
      async ({ where, data }) => {
        if (status !== where.status) return { count: 0 };
        status = data.status;
        return { count: 1 };
      },
    );
    prisma.deal.findFirst.mockResolvedValue({ ownerId: 'manager-id' });

    const outcomes = await Promise.allSettled([
      service.updateStatus('so-id', SupplierOrderStatus.IN_PRODUCTION, head),
      service.updateStatus('so-id', SupplierOrderStatus.CANCELLED, head),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect([
      SupplierOrderStatus.IN_PRODUCTION,
      SupplierOrderStatus.CANCELLED,
    ]).toContain(status);
    expect(prisma.activity.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate ready-confirmation audit', async () => {
    prisma.supplierOrder.findUnique.mockResolvedValue({
      id: 'so-id',
      dealId: 'deal-id',
      status: SupplierOrderStatus.READY_FOR_SHIPMENT,
      readyConfirmedAt: new Date('2026-08-17T00:00:00.000Z'),
      readyConfirmedById: 'head-id',
    });
    prisma.deal.findFirst.mockResolvedValue({ ownerId: 'manager-id' });
    prisma.supplierOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-id',
      readyConfirmedAt: new Date('2026-08-17T00:00:00.000Z'),
    });

    await service.confirmReady('so-id', head);

    expect(prisma.supplierOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('creates a 2-day readiness reminder once and skips duplicate claims', async () => {
    const expectedReadyAt = new Date('2026-08-19T12:00:00.000Z');
    const today = new Date('2026-08-17T08:00:00.000Z');
    prisma.supplierOrder.findMany.mockResolvedValue([
      { id: 'so-id', expectedReadyAt },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'head-id' },
      { id: 'director-id' },
      { id: 'head-admin-id' },
    ]);
    prisma.supplierOrderReminderClaim.create.mockResolvedValue({});
    prisma.notification.createMany.mockResolvedValue({ count: 3 });

    const first = await service.processReadinessReminders(today);
    expect(first).toBe(3);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'head-admin-id',
          type: SUPPLIER_ORDER_REMINDER_TYPE.SOFT,
          relatedId: 'so-id',
        }),
      ]),
    });

    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const second = await service.processReadinessReminders(today);
    expect(second).toBe(0);
  });

  it('forbids ADMIN, ACCOUNTANT, STOREKEEPER and INSTALLER from confirming client delivery', async () => {
    const denied = [
      admin,
      {
        ...admin,
        id: 'accountant-id',
        roles: [RoleName.ACCOUNTANT],
        permissions: ['payments:confirm'],
      },
      {
        ...admin,
        id: 'storekeeper-id',
        roles: [RoleName.STOREKEEPER],
        permissions: ['deliveries:create'],
      },
      {
        ...admin,
        id: 'installer-id',
        roles: [RoleName.INSTALLER],
        permissions: ['installation:confirm_work'],
      },
    ];

    for (const actor of denied) {
      await expect(
        service.confirmClientDelivery('so-id', actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.supplierOrder.updateMany).not.toHaveBeenCalled();
  });

  it('rejects client delivery before SHIPPED and does not write a Delivery row', async () => {
    prisma.supplierOrder.findUnique.mockResolvedValue({
      id: 'so-id',
      dealId: 'deal-id',
      status: SupplierOrderStatus.READY_FOR_SHIPMENT,
      deliveredAt: null,
    });
    prisma.deal.findFirst.mockResolvedValue({ ownerId: 'manager-id' });

    await expect(
      service.confirmClientDelivery('so-id', head),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.supplierOrder.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent once client delivery is already confirmed', async () => {
    prisma.supplierOrder.findUnique.mockResolvedValue({
      id: 'so-id',
      dealId: 'deal-id',
      status: SupplierOrderStatus.DELIVERED,
      deliveredAt: new Date('2026-08-17T00:00:00.000Z'),
      deliveredById: 'manager-id',
    });
    prisma.deal.findFirst.mockResolvedValue({ ownerId: 'manager-id' });
    prisma.supplierOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-id',
      status: SupplierOrderStatus.DELIVERED,
    });

    await service.confirmClientDelivery('so-id', manager);

    expect(prisma.supplierOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
