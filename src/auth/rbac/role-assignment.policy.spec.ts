import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  ADMIN_PROVISIONABLE_ROLES,
  PROTECTED_BUSINESS_ACCOUNT_ERROR,
  PROTECTED_BUSINESS_ROLES,
  assertAdministrativePasswordResetAllowed,
  assertCreatableRoleNames,
} from './role-assignment.policy';

describe('role-assignment policy', () => {
  const admin = [RoleName.ADMIN];
  const director = [RoleName.DIRECTOR];

  it('partitions every RoleName into protected vs ADMIN-provisionable', () => {
    const allRoles = Object.values(RoleName);
    for (const role of allRoles) {
      const isProtected = PROTECTED_BUSINESS_ROLES.has(role);
      const isProvisionable = ADMIN_PROVISIONABLE_ROLES.has(role);
      expect(isProtected || isProvisionable).toBe(true);
      expect(isProtected && isProvisionable).toBe(false);
    }
  });

  it('lets ADMIN provision technical and operational roles', () => {
    expect(() =>
      assertCreatableRoleNames(admin, [RoleName.MANAGER]),
    ).not.toThrow();
    expect(() =>
      assertCreatableRoleNames(admin, [RoleName.STOREKEEPER]),
    ).not.toThrow();
    expect(() =>
      assertCreatableRoleNames(admin, [RoleName.ADMIN]),
    ).not.toThrow();
  });

  it.each([RoleName.DIRECTOR, RoleName.HEAD, RoleName.ACCOUNTANT] as const)(
    'forbids ADMIN from assigning %s',
    (role) => {
      expect(() => assertCreatableRoleNames(admin, [role])).toThrow(
        ForbiddenException,
      );
    },
  );

  it('forbids mixed payloads that include a protected business role', () => {
    expect(() =>
      assertCreatableRoleNames(admin, [RoleName.MANAGER, RoleName.DIRECTOR]),
    ).toThrow(ForbiddenException);
  });

  it('forbids DIRECTOR from assigning DIRECTOR, HEAD, ACCOUNTANT, or MANAGER via this API', () => {
    for (const role of [
      RoleName.DIRECTOR,
      RoleName.HEAD,
      RoleName.ACCOUNTANT,
      RoleName.MANAGER,
    ]) {
      expect(() => assertCreatableRoleNames(director, [role])).toThrow(
        ForbiddenException,
      );
    }
  });

  it.each([RoleName.DIRECTOR, RoleName.HEAD, RoleName.ACCOUNTANT] as const)(
    'forbids administrative password reset of %s',
    (role) => {
      expect(() => assertAdministrativePasswordResetAllowed([role])).toThrow(
        BusinessException,
      );
      try {
        assertAdministrativePasswordResetAllowed([role]);
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).getResponse()).toEqual(
          expect.objectContaining({
            errorCode: PROTECTED_BUSINESS_ACCOUNT_ERROR,
            statusCode: 403,
          }),
        );
      }
    },
  );

  it('allows administrative password reset of technical/operational roles', () => {
    expect(() =>
      assertAdministrativePasswordResetAllowed([RoleName.MANAGER]),
    ).not.toThrow();
    expect(() =>
      assertAdministrativePasswordResetAllowed([RoleName.ADMIN]),
    ).not.toThrow();
    expect(() =>
      assertAdministrativePasswordResetAllowed([RoleName.STOREKEEPER]),
    ).not.toThrow();
  });
});
