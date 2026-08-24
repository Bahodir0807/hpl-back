import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  DealStage,
  FulfillmentSource,
  OrderItemSource,
  OrderStatus,
  PaymentRecordStatus,
  Prisma,
  ProductPriceType,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { OrdersService } from './orders.service';
import { OrderPolicyService } from './services/order-policy.service';
import { PricingPolicyService } from './services/pricing-policy.service';

describe('OrdersService payment confirmation', () => {
  const prisma = {
    payment: { findUnique: jest.fn() },
    order: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: ['orders:read', 'payments:confirm'],
  };

  const admin: CurrentUser = {
    id: 'admin-id',
    email: 'admin@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ADMIN],
    permissions: ['orders:read', 'payments:confirm'],
  };

  const director: CurrentUser = {
    id: 'director-id',
    email: 'director@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.DIRECTOR],
    permissions: ['orders:read', 'payments:confirm'],
  };

  const accountant: CurrentUser = {
    id: 'accountant-id',
    email: 'accountant@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ACCOUNTANT],
    permissions: ['orders:read', 'payments:confirm'],
  };

  let service: OrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrdersService(
      prisma as never,
      {} as never,
      new OrderPolicyService(),
      new PricingPolicyService(),
      { tryFinalize: jest.fn() } as never,
    );
  });

  function mockPendingPayment(createdById = 'manager-id'): void {
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-id',
      orderId: 'order-id',
      amount: 100,
      status: 'PENDING',
      createdById,
    });
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-id',
      status: OrderStatus.WAITING_PAYMENT,
      deal: { ownerId: 'manager-id' },
    });
  }

  it('denies HEAD confirming a payment', async () => {
    mockPendingPayment();

    await expect(
      service.confirmPayment(
        'payment-id',
        { status: PaymentRecordStatus.CONFIRMED },
        head,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies ADMIN confirming a payment', async () => {
    mockPendingPayment();

    await expect(
      service.confirmPayment(
        'payment-id',
        { status: PaymentRecordStatus.CONFIRMED },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies DIRECTOR confirming a payment', async () => {
    mockPendingPayment();

    await expect(
      service.confirmPayment(
        'payment-id',
        { status: PaymentRecordStatus.CONFIRMED },
        director,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces maker-checker when ACCOUNTANT created the payment', async () => {
    mockPendingPayment(accountant.id);

    await expect(
      service.confirmPayment(
        'payment-id',
        { status: PaymentRecordStatus.CONFIRMED },
        accountant,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not treat ACCOUNTANT+ADMIN as ADMIN for payment policy', async () => {
    mockPendingPayment();
    const accountantAdmin: CurrentUser = {
      ...accountant,
      id: 'accountant-admin-id',
      roles: [RoleName.ACCOUNTANT, RoleName.ADMIN],
      permissions: ['orders:read', 'payments:confirm', 'users:create'],
    };

    prisma.$transaction = jest.fn(async () => {
      throw new Error('GF1_POLICY_PASSED');
    });

    await expect(
      service.confirmPayment(
        'payment-id',
        { status: PaymentRecordStatus.CONFIRMED },
        accountantAdmin,
      ),
    ).rejects.toThrow('GF1_POLICY_PASSED');
  });
});

describe('OrdersService fulfillment source authority', () => {
  const user: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: ['orders:create', 'deals:read_all'],
  };

  const dealItem = {
    id: 'deal-item-id',
    productId: 'product-id',
    quantityM2: 2,
    unitPrice: new Prisma.Decimal(100),
    totalPrice: new Prisma.Decimal(200),
    discount: new Prisma.Decimal(0),
    purchasePriceSnapshot: new Prisma.Decimal(50),
    source: OrderItemSource.SKU,
  };

  function setup(fulfillmentSource: FulfillmentSource | null) {
    const createdOrder = {
      id: 'order-id',
      dealId: 'deal-id',
      items: [
        {
          id: 'order-item-id',
          productId: dealItem.productId,
          quantity: dealItem.quantityM2,
        },
      ],
    };
    const prisma = {
      deal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'deal-id',
          ownerId: user.id,
          stage: DealStage.WON,
          fulfillmentSource,
          totalAmount: new Prisma.Decimal(200),
          items: [dealItem],
        }),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: dealItem.productId,
            type: ProductPriceType.BASE,
            amount: new Prisma.Decimal(100),
          },
        ]),
      },
      order: {
        create: jest.fn().mockResolvedValue(createdOrder),
        update: jest.fn().mockResolvedValue(createdOrder),
        findUnique: jest.fn().mockResolvedValue(createdOrder),
      },
      orderItem: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );

    const inventory = { reserveStock: jest.fn().mockResolvedValue([]) };
    const service = new OrdersService(
      prisma as never,
      inventory as never,
      new OrderPolicyService(),
      new PricingPolicyService(),
      { tryFinalize: jest.fn() } as never,
    );
    const dto = { dealId: 'deal-id' };

    return { createdOrder, dto, inventory, prisma, service };
  }

  it('uses warehouse reservation only for WAREHOUSE_STOCK', async () => {
    const { dto, inventory, prisma, service } = setup(
      FulfillmentSource.WAREHOUSE_STOCK,
    );

    await service.createFromDeal(dto, user);

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OrderStatus.WAITING_PAYMENT }),
      }),
    );
    expect(inventory.reserveStock).toHaveBeenCalledWith(
      'order-id',
      [{ productId: 'product-id', quantity: 2 }],
      prisma,
      user.id,
    );
  });

  it('creates a supplier client Order without reserving warehouse stock', async () => {
    const { dto, inventory, prisma, service } = setup(
      FulfillmentSource.SUPPLIER_ORDER,
    );

    await service.createFromDeal(dto, user);

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OrderStatus.PENDING_SUPPLIER }),
      }),
    );
    expect(inventory.reserveStock).not.toHaveBeenCalled();
  });

  it('rejects a historical null-source Deal without inferring from its shape', async () => {
    const { dto, inventory, prisma, service } = setup(null);

    const result = service.createFromDeal(dto, user);

    await expect(result).rejects.toBeInstanceOf(BusinessException);
    await expect(result).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'FULFILLMENT_SOURCE_REQUIRED',
      }),
    });
    expect(prisma.productPrice.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inventory.reserveStock).not.toHaveBeenCalled();
  });

  it('preserves insufficient-stock handling for WAREHOUSE_STOCK', async () => {
    const { dto, inventory, prisma, service } = setup(
      FulfillmentSource.WAREHOUSE_STOCK,
    );
    inventory.reserveStock.mockRejectedValueOnce(
      new BadRequestException('Insufficient stock'),
    );

    await service.createFromDeal(dto, user);

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-id' },
      data: { status: OrderStatus.WAITING_STOCK },
    });
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });

  it('does not create a duplicate Order or reservation on retry', async () => {
    const { dto, inventory, prisma, service } = setup(
      FulfillmentSource.WAREHOUSE_STOCK,
    );

    await service.createFromDeal(dto, user);
    prisma.order.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Duplicate deal Order', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['dealId'] },
      }),
    );

    await expect(service.createFromDeal(dto, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(inventory.reserveStock).toHaveBeenCalledTimes(1);
  });
});
