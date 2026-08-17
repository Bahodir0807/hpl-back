import { RoleName } from '@prisma/client';
import {
  BUSINESS_MUTATION_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSION_SLUGS,
  TARGET_ROLE_NAMES,
  roleHasPermission,
} from './permission-matrix';

describe('permission matrix', () => {
  const allSlugs = PERMISSION_DEFINITIONS.map(([slug]) => slug);

  it('contains exactly the target business roles and not OBSERVER', () => {
    expect([...TARGET_ROLE_NAMES].sort()).toEqual(
      [
        RoleName.ADMIN,
        RoleName.DIRECTOR,
        RoleName.HEAD,
        RoleName.MANAGER,
        RoleName.ACCOUNTANT,
        RoleName.STOREKEEPER,
        RoleName.INSTALLER,
      ].sort(),
    );
    expect(Object.keys(ROLE_PERMISSION_SLUGS).sort()).toEqual(
      [...TARGET_ROLE_NAMES].sort(),
    );
    expect(Object.values(RoleName).sort()).toEqual([...TARGET_ROLE_NAMES].sort());
    expect(Object.values(RoleName)).not.toContain('FINANCIER');
  });

  it('does not seed ADMIN with all permissions or business mutations', () => {
    const adminSlugs = ROLE_PERMISSION_SLUGS[RoleName.ADMIN];

    expect(adminSlugs).toEqual([
      'auth:me',
      'users:read',
      'users:create',
      'users:write',
      'users:manage',
      'admin:queues',
    ]);
    expect(adminSlugs.length).toBeLessThan(allSlugs.length);

    for (const slug of BUSINESS_MUTATION_PERMISSIONS) {
      expect(roleHasPermission(RoleName.ADMIN, slug)).toBe(false);
    }
  });

  it('gives CurrencyRate manage only to DIRECTOR', () => {
    expect(roleHasPermission(RoleName.DIRECTOR, 'currency_rates:manage')).toBe(
      true,
    );
    expect(roleHasPermission(RoleName.DIRECTOR, 'currency_rates:read')).toBe(
      true,
    );

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.DIRECTOR) {
        continue;
      }

      expect(roleHasPermission(roleName, 'currency_rates:manage')).toBe(false);
    }
  });

  it('gives payment confirmation only to ACCOUNTANT', () => {
    expect(roleHasPermission(RoleName.ACCOUNTANT, 'payments:confirm')).toBe(
      true,
    );

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.ACCOUNTANT) {
        continue;
      }

      expect(roleHasPermission(roleName, 'payments:confirm')).toBe(false);
    }
  });

  it('gives Stage 2 and quote approval only to HEAD', () => {
    expect(roleHasPermission(RoleName.HEAD, 'leads:commercial_qualify')).toBe(
      true,
    );
    expect(roleHasPermission(RoleName.HEAD, 'quotes:approve')).toBe(true);

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.HEAD) {
        continue;
      }

      expect(roleHasPermission(roleName, 'leads:commercial_qualify')).toBe(
        false,
      );
      expect(roleHasPermission(roleName, 'quotes:approve')).toBe(false);
    }
  });

  it('keeps INSTALLER to authentication-only permissions', () => {
    expect([...ROLE_PERMISSION_SLUGS[RoleName.INSTALLER]]).toEqual(['auth:me']);
    expect(roleHasPermission(RoleName.INSTALLER, 'leads:create')).toBe(false);
    expect(roleHasPermission(RoleName.INSTALLER, 'inventory:manage')).toBe(
      false,
    );
    expect(roleHasPermission(RoleName.INSTALLER, 'orders:read')).toBe(false);
  });

  it('gives DIRECTOR read_all visibility without operational mutations', () => {
    expect(roleHasPermission(RoleName.DIRECTOR, 'leads:read_all')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'deals:read_all')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:read_all')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'payments:confirm')).toBe(false);
    expect(roleHasPermission(RoleName.DIRECTOR, 'leads:commercial_qualify')).toBe(
      false,
    );
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:approve')).toBe(false);
    expect(roleHasPermission(RoleName.DIRECTOR, 'inventory:manage')).toBe(false);
    expect(roleHasPermission(RoleName.DIRECTOR, 'admin:queues')).toBe(false);
  });
});
