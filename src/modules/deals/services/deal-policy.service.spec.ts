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

  it('locks commercial fields after WON for HEAD and ADMIN', () => {
    const deal = { ownerId: manager.id, stage: DealStage.WON };

    expect(policy.getPermissions(head, deal).canEdit).toBe(true);
    expect(policy.getPermissions(head, deal).canMutateCommercial).toBe(false);
    expect(policy.getPermissions(admin, deal).canEdit).toBe(true);
    expect(policy.getPermissions(admin, deal).canMutateCommercial).toBe(false);
  });
});
