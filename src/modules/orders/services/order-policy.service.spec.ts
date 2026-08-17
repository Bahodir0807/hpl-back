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

  it('does not grant INSTALLER global order visibility from deals:read_all alone', () => {
    const installer: PolicyUser = {
      id: 'installer-id',
      roles: [RoleName.INSTALLER],
      permissions: ['orders:read', 'deals:read_all'],
    };

    expect(policy.getScopeFilter(installer)).toEqual({
      deal: { ownerId: installer.id },
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

  it('denies ADMIN payment confirmation', () => {
    const admin: PolicyUser = {
      id: 'admin-id',
      roles: [RoleName.ADMIN],
      permissions: ['payments:confirm'],
    };

    expect(policy.getPermissions(admin, order).canConfirmPayment).toBe(false);
  });

  it('denies DIRECTOR payment confirmation', () => {
    const director: PolicyUser = {
      id: 'director-id',
      roles: [RoleName.DIRECTOR],
      permissions: ['payments:confirm'],
    };

    expect(policy.getPermissions(director, order).canConfirmPayment).toBe(
      false,
    );
  });

  it('allows ACCOUNTANT to confirm payments', () => {
    const accountant: PolicyUser = {
      id: 'accountant-id',
      roles: [RoleName.ACCOUNTANT],
      permissions: ['payments:confirm'],
    };

    expect(policy.getPermissions(accountant, order).canConfirmPayment).toBe(
      true,
    );
    expect(policy.getPermissions(accountant, order).canAddPayment).toBe(false);
    expect(policy.getScopeFilter(accountant)).toEqual({});
  });
});
