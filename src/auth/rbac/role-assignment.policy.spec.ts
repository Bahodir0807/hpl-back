import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  ADMIN_PROVISIONABLE_ROLES,
  PROTECTED_BUSINESS_ACCOUNT_ERROR,
  assertAdministrativePasswordResetAllowed,
  assertCreatableRoleNames,
} from './role-assignment.policy';

describe('role-assignment policy', () => {
  const admin = [RoleName.ADMIN];
  const director = [RoleName.DIRECTOR];

  it('lets ADMIN provision every RoleName', () => {
    for (const role of Object.values(RoleName)) {
      expect(ADMIN_PROVISIONABLE_ROLES.has(role)).toBe(true);
      expect(() => assertCreatableRoleNames(admin, [role])).not.toThrow();
    }
  });

  it('lets ADMIN assign mixed payloads that include business roles', () => {
    expect(() =>
      assertCreatableRoleNames(admin, [RoleName.MANAGER, RoleName.DIRECTOR]),
    ).not.toThrow();
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
