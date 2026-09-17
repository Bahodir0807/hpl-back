import { DealStage, RoleName } from '@prisma/client';
import type { PolicyUser } from '../../../common/enums/role.enum';
import { DealPolicyService } from './deal-policy.service';

describe('DealPolicyService commercial lock', () => {
  const policy = new DealPolicyService();

  const manager: PolicyUser = {
    id: 'manager-id',
    roles: [RoleName.MANAGER],
    permissions: ['deals:update'],
  };

  const head: PolicyUser = {
    id: 'head-id',
    roles: [RoleName.HEAD],
    permissions: ['deals:update'],
  };

  const admin: PolicyUser = {
    id: 'admin-id',
    roles: [RoleName.ADMIN],
    permissions: ['deals:update'],
  };

  const director: PolicyUser = {
    id: 'director-id',
    roles: [RoleName.DIRECTOR],
    permissions: ['deals:read', 'deals:read_all'],
  };

  it('allows owner to mutate commercial fields on an open deal', () => {
    const perms = policy.getPermissions(manager, {
      ownerId: manager.id,
      stage: DealStage.QUALIFICATION,
    });

    expect(perms.canEdit).toBe(true);
    expect(perms.canMutateCommercial).toBe(true);
  });

  it('keeps operational canEdit after WON but locks commercial fields', () => {
    const perms = policy.getPermissions(manager, {
      ownerId: manager.id,
      stage: DealStage.WON,
    });

    expect(perms.canEdit).toBe(true);
    expect(perms.canChangeStage).toBe(false);
    expect(perms.canMutateCommercial).toBe(false);
  });

  it('locks commercial fields after LOST', () => {
    const perms = policy.getPermissions(manager, {
      ownerId: manager.id,
      stage: DealStage.LOST,
    });

    expect(perms.canMutateCommercial).toBe(false);
  });

  it('scopes a manager without deals:read_all to owned deals', () => {
    const deal = { ownerId: 'other-manager', stage: DealStage.QUALIFICATION };

    expect(policy.canReadDeal(manager, deal)).toBe(false);
    expect(policy.getScopeFilter(manager)).toEqual({ ownerId: manager.id });
  });

  it('gives DIRECTOR unscoped read without mutation rights', () => {
    const deal = { ownerId: manager.id, stage: DealStage.QUALIFICATION };

    expect(policy.canReadDeal(director, deal)).toBe(true);
    expect(policy.getScopeFilter(director)).toEqual({});
    expect(policy.getPermissions(director, deal).canEdit).toBe(false);
  });

  it('locks commercial fields after WON for HEAD and does not let ADMIN mutate', () => {
    const deal = { ownerId: manager.id, stage: DealStage.WON };

    expect(policy.getPermissions(head, deal).canEdit).toBe(true);
    expect(policy.getPermissions(head, deal).canMutateCommercial).toBe(false);
    expect(policy.getPermissions(admin, deal).canEdit).toBe(false);
    expect(policy.getPermissions(admin, deal).canMutateCommercial).toBe(false);
  });

  it('keeps DIRECTOR unscoped read when ADMIN is also assigned', () => {
    const directorAdmin: PolicyUser = {
      id: 'director-admin-id',
      roles: [RoleName.DIRECTOR, RoleName.ADMIN],
      permissions: ['deals:read', 'deals:read_all'],
    };
    const foreignDeal = { ownerId: manager.id, stage: DealStage.QUALIFICATION };

    expect(policy.canReadDeal(directorAdmin, foreignDeal)).toBe(true);
    expect(policy.getScopeFilter(directorAdmin)).toEqual({});
    expect(policy.getPermissions(directorAdmin, foreignDeal).canEdit).toBe(
      false,
    );
  });

  it('keeps HEAD mutation and unscoped read when ADMIN is also assigned', () => {
    const headAdmin: PolicyUser = {
      id: 'head-admin-id',
      roles: [RoleName.HEAD, RoleName.ADMIN],
      permissions: ['deals:update'],
    };
    const foreignDeal = { ownerId: manager.id, stage: DealStage.QUALIFICATION };

    expect(policy.canReadDeal(headAdmin, foreignDeal)).toBe(true);
    expect(policy.getScopeFilter(headAdmin)).toEqual({});
    expect(policy.getPermissions(headAdmin, foreignDeal).canEdit).toBe(true);
    expect(
      policy.getPermissions(headAdmin, foreignDeal).canBypassStageValidation,
    ).toBe(true);
  });

  it('keeps MANAGER owner-scoped when ADMIN is also assigned', () => {
    const managerAdmin: PolicyUser = {
      id: 'manager-admin-id',
      roles: [RoleName.MANAGER, RoleName.ADMIN],
      permissions: ['deals:update'],
    };
    const ownDeal = {
      ownerId: managerAdmin.id,
      stage: DealStage.QUALIFICATION,
    };
    const foreignDeal = { ownerId: manager.id, stage: DealStage.QUALIFICATION };

    expect(policy.canReadDeal(managerAdmin, foreignDeal)).toBe(false);
    expect(policy.getScopeFilter(managerAdmin)).toEqual({
      ownerId: managerAdmin.id,
    });
    expect(policy.getPermissions(managerAdmin, ownDeal).canEdit).toBe(true);
    expect(policy.getPermissions(managerAdmin, foreignDeal).canEdit).toBe(
      false,
    );
  });
});
