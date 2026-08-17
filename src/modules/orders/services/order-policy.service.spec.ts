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

  it('allows ACCOUNTANT+ADMIN to confirm and still see all orders', () => {
    const accountantAdmin: PolicyUser = {
      id: 'accountant-admin-id',
      roles: [RoleName.ACCOUNTANT, RoleName.ADMIN],
      permissions: ['payments:confirm', 'users:create'],
    };

    expect(policy.getPermissions(accountantAdmin, order).canConfirmPayment).toBe(
      true,
    );
    expect(policy.getPermissions(accountantAdmin, order).canAddPayment).toBe(
      false,
    );
    expect(policy.getScopeFilter(accountantAdmin)).toEqual({});
  });

  it('allows ACCOUNTANT plus a harmless role to confirm when ACCOUNTANT remains assigned', () => {
    const accountantInstaller: PolicyUser = {
      id: 'accountant-installer-id',
      roles: [RoleName.ACCOUNTANT, RoleName.INSTALLER],
      permissions: ['payments:confirm'],
    };

    expect(
      policy.getPermissions(accountantInstaller, order).canConfirmPayment,
    ).toBe(true);
  });

  it('keeps DIRECTOR+ADMIN unscoped without operational mutations', () => {
    const directorAdmin: PolicyUser = {
      id: 'director-admin-id',
      roles: [RoleName.DIRECTOR, RoleName.ADMIN],
      permissions: ['orders:read'],
    };
    const foreignOrder = {
      status: OrderStatus.WAITING_PAYMENT,
      deal: { ownerId: manager.id },
    };

    expect(policy.getScopeFilter(directorAdmin)).toEqual({});
    expect(policy.getPermissions(directorAdmin, foreignOrder)).toEqual({
      canEdit: false,
      canDelete: false,
      canAddPayment: false,
      canConfirmPayment: false,
      canCreateDelivery: false,
    });
  });

  it('keeps HEAD+ADMIN operational mutations without payment confirm', () => {
    const headAdmin: PolicyUser = {
      id: 'head-admin-id',
      roles: [RoleName.HEAD, RoleName.ADMIN],
      permissions: ['orders:read', 'payments:create'],
    };
    const foreignOrder = {
      status: OrderStatus.WAITING_PAYMENT,
      deal: { ownerId: manager.id },
    };

    expect(policy.getScopeFilter(headAdmin)).toEqual({});
    expect(policy.getPermissions(headAdmin, foreignOrder).canAddPayment).toBe(
      true,
    );
    expect(policy.getPermissions(headAdmin, foreignOrder).canConfirmPayment).toBe(
      false,
    );
  });

  it('keeps MANAGER+ADMIN owner-scoped without HEAD or ACCOUNTANT powers', () => {
    const managerAdmin: PolicyUser = {
      id: 'manager-admin-id',
      roles: [RoleName.MANAGER, RoleName.ADMIN],
      permissions: ['orders:read', 'payments:create'],
    };
    const ownOrder = {
      status: OrderStatus.WAITING_PAYMENT,
      deal: { ownerId: managerAdmin.id },
    };
    const foreignOrder = {
      status: OrderStatus.WAITING_PAYMENT,
      deal: { ownerId: manager.id },
    };

    expect(policy.getScopeFilter(managerAdmin)).toEqual({
      deal: { ownerId: managerAdmin.id },
    });
    expect(policy.getPermissions(managerAdmin, ownOrder).canAddPayment).toBe(
      true,
    );
    expect(policy.getPermissions(managerAdmin, foreignOrder).canAddPayment).toBe(
      false,
    );
    expect(policy.getPermissions(managerAdmin, ownOrder).canConfirmPayment).toBe(
      false,
    );
  });
});
