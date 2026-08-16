import { OrderStatus, RoleName } from '@prisma/client';
import type { PolicyUser } from '../../../common/enums/role.enum';
import { OrderPolicyService } from './order-policy.service';

describe('OrderPolicyService scope', () => {
  const policy = new OrderPolicyService();

  const manager: PolicyUser = {
    id: 'manager-id',
    roles: [RoleName.MANAGER],
    permissions: ['orders:read'],
  };

  const order = {
    status: OrderStatus.WAITING_PAYMENT,
    deal: { ownerId: manager.id },
  };

  it('scopes managers without deals:read_all to their own deals', () => {
    expect(policy.getScopeFilter(manager)).toEqual({
      deal: { ownerId: manager.id },
    });
  });

  it('does not grant OBSERVER global order visibility from deals:read_all alone', () => {
    const observer: PolicyUser = {
      id: 'observer-id',
      roles: [RoleName.OBSERVER],
      permissions: ['orders:read', 'deals:read_all'],
    };

    expect(policy.getScopeFilter(observer)).toEqual({
      deal: { ownerId: observer.id },
    });
  });

  it('denies HEAD payment confirmation even if payments:confirm is present', () => {
    const head: PolicyUser = {
      id: 'head-id',
      roles: [RoleName.HEAD],
      permissions: ['payments:confirm'],
    };

    expect(policy.getPermissions(head, order).canConfirmPayment).toBe(false);
  });

  it('allows ADMIN to confirm payments', () => {
    const admin: PolicyUser = {
      id: 'admin-id',
      roles: [RoleName.ADMIN],
      permissions: ['payments:confirm'],
    };

    expect(policy.getPermissions(admin, order).canConfirmPayment).toBe(true);
  });
});
