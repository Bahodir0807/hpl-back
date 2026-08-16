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
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
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

  it('denies HEAD confirming a payment', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-id',
      orderId: 'order-id',
      amount: 100,
      status: 'PENDING',
      createdById: 'manager-id',
    });
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-id',
      status: OrderStatus.WAITING_PAYMENT,
      deal: { ownerId: 'manager-id' },
    });

    await expect(
      service.confirmPayment(
        'payment-id',
        { status: PaymentRecordStatus.CONFIRMED },
        head,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
