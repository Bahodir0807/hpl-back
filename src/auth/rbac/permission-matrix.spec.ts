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

  it('contains exactly the target business roles and not obsolete roles', () => {
    expect([...TARGET_ROLE_NAMES].sort()).toEqual(
      [
        RoleName.ADMIN,
        RoleName.DIRECTOR,
        RoleName.HEAD,
        RoleName.MANAGER,
        RoleName.ACCOUNTANT,
        RoleName.STOREKEEPER,
        RoleName.ENGINEER,
      ].sort(),
    );
    expect(Object.keys(ROLE_PERMISSION_SLUGS).sort()).toEqual(
      [...TARGET_ROLE_NAMES].sort(),
    );
    expect(Object.values(RoleName).sort()).toEqual(
      [...TARGET_ROLE_NAMES].sort(),
    );
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

  it('gives PanelThicknessPricing manage only to HEAD', () => {
    expect(roleHasPermission(RoleName.HEAD, 'panel_pricing:manage')).toBe(true);

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.HEAD) {
        continue;
      }

      expect(roleHasPermission(roleName, 'panel_pricing:manage')).toBe(false);
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

  it('gives client delivery confirmation to MANAGER, HEAD and DIRECTOR', () => {
    expect(
      roleHasPermission(
        RoleName.MANAGER,
        'supplier_orders:confirm_client_delivery',
      ),
    ).toBe(true);
    expect(
      roleHasPermission(
        RoleName.HEAD,
        'supplier_orders:confirm_client_delivery',
      ),
    ).toBe(true);
    expect(
      roleHasPermission(
        RoleName.DIRECTOR,
        'supplier_orders:confirm_client_delivery',
      ),
    ).toBe(true);

    for (const roleName of TARGET_ROLE_NAMES) {
      if (
        roleName === RoleName.MANAGER ||
        roleName === RoleName.HEAD ||
        roleName === RoleName.DIRECTOR
      ) {
        continue;
      }

      expect(
        roleHasPermission(roleName, 'supplier_orders:confirm_client_delivery'),
      ).toBe(false);
    }
  });

  it('gives installation schedule and supervisor confirmation only to HEAD and DIRECTOR', () => {
    for (const slug of [
      'installation:schedule',
      'installation:confirm_supervisor',
    ] as const) {
      expect(roleHasPermission(RoleName.HEAD, slug)).toBe(true);
      expect(roleHasPermission(RoleName.DIRECTOR, slug)).toBe(true);

      for (const roleName of TARGET_ROLE_NAMES) {
        if (roleName === RoleName.HEAD || roleName === RoleName.DIRECTOR) {
          continue;
        }

        expect(roleHasPermission(roleName, slug)).toBe(false);
      }
    }
  });

  it('gives installation:assess to HEAD and DIRECTOR only', () => {
    expect(roleHasPermission(RoleName.HEAD, 'installation:assess')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'installation:assess')).toBe(
      true,
    );

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.HEAD || roleName === RoleName.DIRECTOR) {
        continue;
      }

      expect(roleHasPermission(roleName, 'installation:assess')).toBe(false);
    }
  });

  it('gives DIRECTOR read_all visibility without unrelated operational mutations', () => {
    expect(roleHasPermission(RoleName.DIRECTOR, 'leads:read_all')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'deals:read_all')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:read_all')).toBe(true);
    expect(roleHasPermission(RoleName.DIRECTOR, 'payments:confirm')).toBe(
      false,
    );
    expect(
      roleHasPermission(RoleName.DIRECTOR, 'leads:commercial_qualify'),
    ).toBe(false);
    expect(
      roleHasPermission(RoleName.MANAGER, 'leads:commercial_qualify'),
    ).toBe(false);
    expect(roleHasPermission(RoleName.ADMIN, 'leads:commercial_qualify')).toBe(
      false,
    );
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:approve')).toBe(false);
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:client_accept')).toBe(
      false,
    );
    expect(roleHasPermission(RoleName.DIRECTOR, 'inventory:manage')).toBe(
      false,
    );
    expect(roleHasPermission(RoleName.DIRECTOR, 'admin:queues')).toBe(false);
  });

  it('gives Quote client acceptance only to MANAGER', () => {
    expect(roleHasPermission(RoleName.MANAGER, 'quotes:client_accept')).toBe(
      true,
    );

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.MANAGER) {
        continue;
      }

      expect(roleHasPermission(roleName, 'quotes:client_accept')).toBe(false);
    }
  });

  it('gives SupplierOrder manage only to HEAD and DIRECTOR', () => {
    expect(roleHasPermission(RoleName.HEAD, 'supplier_orders:manage')).toBe(
      true,
    );
    expect(roleHasPermission(RoleName.DIRECTOR, 'supplier_orders:manage')).toBe(
      true,
    );

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.HEAD || roleName === RoleName.DIRECTOR) {
        continue;
      }

      expect(roleHasPermission(roleName, 'supplier_orders:manage')).toBe(false);
    }
  });

  it('separates warehouse purchase planning from physical receiving', () => {
    expect(roleHasPermission(RoleName.HEAD, 'warehouse_purchases:plan')).toBe(
      true,
    );
    expect(
      roleHasPermission(RoleName.DIRECTOR, 'warehouse_purchases:plan'),
    ).toBe(true);
    expect(
      roleHasPermission(RoleName.STOREKEEPER, 'warehouse_purchases:receive'),
    ).toBe(true);

    expect(
      roleHasPermission(RoleName.STOREKEEPER, 'warehouse_purchases:plan'),
    ).toBe(false);
    expect(
      roleHasPermission(RoleName.HEAD, 'warehouse_purchases:receive'),
    ).toBe(false);
    expect(
      roleHasPermission(RoleName.DIRECTOR, 'warehouse_purchases:receive'),
    ).toBe(false);
    expect(roleHasPermission(RoleName.ADMIN, 'warehouse_purchases:plan')).toBe(
      false,
    );
    expect(
      roleHasPermission(RoleName.ADMIN, 'warehouse_purchases:receive'),
    ).toBe(false);
  });

  it('adds ENGINEER without commercial, financial, or global lead powers', () => {
    expect(Object.values(RoleName)).toContain(RoleName.ENGINEER);
    expect(Object.values(RoleName)).not.toContain('INSTALLER');
    expect(roleHasPermission(RoleName.ENGINEER, 'engineering:read')).toBe(true);
    expect(roleHasPermission(RoleName.ENGINEER, 'engineering:return')).toBe(
      true,
    );
    expect(roleHasPermission(RoleName.ENGINEER, 'engineering:complete')).toBe(
      true,
    );
    expect(
      roleHasPermission(RoleName.ENGINEER, 'engineering:update_technical'),
    ).toBe(true);
    expect(roleHasPermission(RoleName.ENGINEER, 'quotes:approve')).toBe(false);
    expect(roleHasPermission(RoleName.ENGINEER, 'leads:read_all')).toBe(false);
    expect(roleHasPermission(RoleName.ENGINEER, 'leads:assign')).toBe(false);
    expect(roleHasPermission(RoleName.ENGINEER, 'leads:commercial_qualify')).toBe(
      false,
    );
    expect(roleHasPermission(RoleName.ENGINEER, 'currency_rates:manage')).toBe(
      false,
    );
    expect(roleHasPermission(RoleName.ENGINEER, 'users:manage')).toBe(false);
    expect(roleHasPermission(RoleName.ENGINEER, 'payments:confirm')).toBe(false);
    expect(
      roleHasPermission(RoleName.ENGINEER, 'products:read_purchase_price'),
    ).toBe(false);
    expect(roleHasPermission(RoleName.ENGINEER, 'engineering:assign')).toBe(
      false,
    );
  });

  it('gives engineering:assign only to MANAGER and HEAD', () => {
    expect(roleHasPermission(RoleName.MANAGER, 'engineering:assign')).toBe(true);
    expect(roleHasPermission(RoleName.HEAD, 'engineering:assign')).toBe(true);

    for (const roleName of TARGET_ROLE_NAMES) {
      if (roleName === RoleName.MANAGER || roleName === RoleName.HEAD) {
        continue;
      }
      expect(roleHasPermission(roleName, 'engineering:assign')).toBe(false);
    }
  });

  it('does not grant DIRECTOR quotes:approve for Stage 1 engineering', () => {
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:approve')).toBe(false);
    expect(roleHasPermission(RoleName.DIRECTOR, 'engineering:assign')).toBe(
      false,
    );
  });

  it('grants HEAD and DIRECTOR facade subsystem commercial approval without global quotes:approve on DIRECTOR', () => {
    for (const slug of [
      'facade_pricing:read_purchase',
      'facade_pricing:manage_offers',
      'facade_pricing:prepare',
      'facade_pricing:approve',
    ] as const) {
      expect(roleHasPermission(RoleName.HEAD, slug)).toBe(true);
      expect(roleHasPermission(RoleName.DIRECTOR, slug)).toBe(true);
      expect(roleHasPermission(RoleName.ENGINEER, slug)).toBe(false);
      expect(roleHasPermission(RoleName.MANAGER, slug)).toBe(false);
      expect(roleHasPermission(RoleName.ACCOUNTANT, slug)).toBe(false);
      expect(roleHasPermission(RoleName.STOREKEEPER, slug)).toBe(false);
      expect(roleHasPermission(RoleName.ADMIN, slug)).toBe(false);
    }
    expect(roleHasPermission(RoleName.DIRECTOR, 'quotes:approve')).toBe(false);
    expect(roleHasPermission(RoleName.HEAD, 'quotes:approve')).toBe(true);
  });
});
