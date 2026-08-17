import { ForbiddenException } from '@nestjs/common';
import { OrderStatus, PaymentRecordStatus, RoleName } from '@prisma/client';
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
      {} as never,
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
