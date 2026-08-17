import { RoleName } from '@prisma/client';
import type { PolicyUser } from './role.enum';
import {
  resolveUserRole,
  UserRole,
  hasUnscopedDealVisibility,
  hasUnscopedOrderVisibility,
} from './role.enum';

function user(roles: RoleName[]): PolicyUser {
  return { id: 'user-id', roles, permissions: [] };
}

describe('resolveUserRole', () => {
  it('maps Prisma business roles without FINANCIER or OBSERVER', () => {
    expect(resolveUserRole(user([RoleName.ADMIN]))).toBe(UserRole.ADMIN);
    expect(resolveUserRole(user([RoleName.DIRECTOR]))).toBe(UserRole.DIRECTOR);
    expect(resolveUserRole(user([RoleName.HEAD]))).toBe(UserRole.SALES_HEAD);
    expect(resolveUserRole(user([RoleName.ACCOUNTANT]))).toBe(
      UserRole.ACCOUNTANT,
    );
    expect(resolveUserRole(user([RoleName.STOREKEEPER]))).toBe(
      UserRole.STOREKEEPER,
    );
    expect(resolveUserRole(user([RoleName.INSTALLER]))).toBe(UserRole.INSTALLER);
    expect(resolveUserRole(user([RoleName.MANAGER]))).toBe(UserRole.MANAGER);
  });

  it('does not treat DIRECTOR or ADMIN as unscoped warehouse actors', () => {
    expect(hasUnscopedOrderVisibility(user([RoleName.DIRECTOR]))).toBe(true);
    expect(hasUnscopedDealVisibility(user([RoleName.DIRECTOR]))).toBe(true);
    expect(hasUnscopedOrderVisibility(user([RoleName.ADMIN]))).toBe(false);
    expect(hasUnscopedDealVisibility(user([RoleName.ADMIN]))).toBe(false);
    expect(hasUnscopedDealVisibility(user([RoleName.INSTALLER]))).toBe(false);
    expect(hasUnscopedOrderVisibility(user([RoleName.INSTALLER]))).toBe(false);
    expect(hasUnscopedOrderVisibility(user([RoleName.ACCOUNTANT]))).toBe(true);
  });
});
