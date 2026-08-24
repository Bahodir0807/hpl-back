import { RoleName } from '@prisma/client';
import { roleHasPermission } from './permission-matrix';

describe('Pass 8 RBAC boundaries', () => {
  it('limits company overview reports to HEAD and DIRECTOR roles', () => {
    expect(roleHasPermission(RoleName.HEAD, 'reports:read')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'reports:read')).toBe(true);
    expect(roleHasPermission(RoleName.MANAGER, 'reports:read')).toBe(false);
    expect(roleHasPermission(RoleName.ADMIN, 'reports:read')).toBe(false);
    expect(roleHasPermission(RoleName.ACCOUNTANT, 'reports:read')).toBe(false);
  });

  it('keeps loss mutation with sales roles and excludes ADMIN-only', () => {
    expect(roleHasPermission(RoleName.MANAGER, 'leads:update')).toBe(true);
    expect(roleHasPermission(RoleName.MANAGER, 'deals:update')).toBe(true);
    expect(roleHasPermission(RoleName.HEAD, 'leads:update')).toBe(true);
    expect(roleHasPermission(RoleName.HEAD, 'deals:update')).toBe(true);
    expect(roleHasPermission(RoleName.ADMIN, 'leads:update')).toBe(false);
    expect(roleHasPermission(RoleName.ADMIN, 'deals:update')).toBe(false);
  });

  it('allows Quote readers to use documents without granting ADMIN business read', () => {
    expect(roleHasPermission(RoleName.MANAGER, 'quotes:read')).toBe(true);
    expect(roleHasPermission(RoleName.HEAD, 'quotes:read')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:read')).toBe(true);
    expect(roleHasPermission(RoleName.ADMIN, 'quotes:read')).toBe(false);
  });
});
