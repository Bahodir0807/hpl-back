import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import type { PolicyUser } from './role.enum';
import {
  hasAnyRole,
  hasRole,
  hasUnscopedDealVisibility,
  hasUnscopedOrderVisibility,
  hasUserModuleAccess,
} from './role.enum';

function user(roles: RoleName[]): PolicyUser {
  return { id: 'user-id', roles, permissions: [] };
}

describe('multi-role policy helpers', () => {
  it('inspects all assigned roles instead of collapsing to one', () => {
    const directorAdmin = user([RoleName.DIRECTOR, RoleName.ADMIN]);
    const headAdmin = user([RoleName.HEAD, RoleName.ADMIN]);
    const accountantAdmin = user([RoleName.ACCOUNTANT, RoleName.ADMIN]);

    expect(hasRole(directorAdmin, RoleName.DIRECTOR)).toBe(true);
    expect(hasRole(directorAdmin, RoleName.ADMIN)).toBe(true);
    expect(hasRole(directorAdmin, RoleName.HEAD)).toBe(false);

    expect(hasAnyRole(headAdmin, [RoleName.HEAD, RoleName.DIRECTOR])).toBe(true);
    expect(hasAnyRole(accountantAdmin, [RoleName.ACCOUNTANT])).toBe(true);
  });

  it('keeps unscoped deal/order visibility when ADMIN is also assigned', () => {
    expect(hasUnscopedDealVisibility(user([RoleName.DIRECTOR, RoleName.ADMIN]))).toBe(
      true,
    );
    expect(hasUnscopedOrderVisibility(user([RoleName.DIRECTOR, RoleName.ADMIN]))).toBe(
      true,
    );
    expect(hasUnscopedDealVisibility(user([RoleName.HEAD, RoleName.ADMIN]))).toBe(
      true,
    );
    expect(hasUnscopedOrderVisibility(user([RoleName.HEAD, RoleName.ADMIN]))).toBe(
      true,
    );
    expect(
      hasUnscopedDealVisibility(user([RoleName.ACCOUNTANT, RoleName.ADMIN])),
    ).toBe(true);
    expect(
      hasUnscopedOrderVisibility(user([RoleName.ACCOUNTANT, RoleName.ADMIN])),
    ).toBe(true);
  });

  it('does not grant unscoped visibility to ADMIN, INSTALLER, or MANAGER alone', () => {
    expect(hasUnscopedDealVisibility(user([RoleName.ADMIN]))).toBe(false);
    expect(hasUnscopedOrderVisibility(user([RoleName.ADMIN]))).toBe(false);
    expect(hasUnscopedDealVisibility(user([RoleName.INSTALLER]))).toBe(false);
    expect(hasUnscopedOrderVisibility(user([RoleName.INSTALLER]))).toBe(false);
    expect(hasUnscopedDealVisibility(user([RoleName.MANAGER]))).toBe(false);
    expect(hasUnscopedOrderVisibility(user([RoleName.MANAGER, RoleName.ADMIN]))).toBe(
      false,
    );
  });

  it('keeps user-module access when ADMIN is combined with a blocked business role', () => {
    expect(hasUserModuleAccess(user([RoleName.ADMIN]))).toBe(true);
    expect(hasUserModuleAccess(user([RoleName.DIRECTOR]))).toBe(true);
    expect(hasUserModuleAccess(user([RoleName.HEAD]))).toBe(true);
    expect(hasUserModuleAccess(user([RoleName.ACCOUNTANT, RoleName.ADMIN]))).toBe(
      true,
    );
    expect(hasUserModuleAccess(user([RoleName.MANAGER, RoleName.ADMIN]))).toBe(
      true,
    );
    expect(hasUserModuleAccess(user([RoleName.ACCOUNTANT]))).toBe(false);
    expect(hasUserModuleAccess(user([RoleName.MANAGER]))).toBe(false);
    expect(hasUserModuleAccess(user([RoleName.INSTALLER]))).toBe(false);
  });
});

describe('UsersService.assertUserModuleAccess contract', () => {
  it('is additive for ADMIN plus a business role', () => {
    expect(() => {
      if (!hasUserModuleAccess(user([RoleName.ACCOUNTANT, RoleName.ADMIN]))) {
        throw new ForbiddenException('Access denied');
      }
    }).not.toThrow();
  });
});
