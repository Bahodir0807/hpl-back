import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import type { PolicyUser } from '../../../common/enums/role.enum';
import {
  MANAGER_DISCOUNT_FORBIDDEN_MESSAGE,
  PricingPolicyService,
} from './pricing-policy.service';

describe('PricingPolicyService manager discount', () => {
  const policy = new PricingPolicyService();

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

  it('denies Manager injecting discount through DTO', () => {
    expect(() =>
      policy.assertManagerCannotAssignDiscount(manager, [{ discount: 5 }]),
    ).toThrow(ForbiddenException);
    expect(() =>
      policy.assertManagerCannotAssignDiscount(manager, [{ discount: 5 }]),
    ).toThrow(MANAGER_DISCOUNT_FORBIDDEN_MESSAGE);
  });

  it('allows Manager when discount is omitted or zero', () => {
    expect(() =>
      policy.assertManagerCannotAssignDiscount(manager, [{}]),
    ).not.toThrow();
    expect(() =>
      policy.assertManagerCannotAssignDiscount(manager, [{ discount: 0 }]),
    ).not.toThrow();
  });

  it('allows HEAD to assign discount in DTO', () => {
    expect(() =>
      policy.assertManagerCannotAssignDiscount(head, [{ discount: 10 }]),
    ).not.toThrow();
  });

  it('rejects Manager unitPrice below base as a discount', () => {
    expect(() =>
      policy.validateItemPrices(manager, [
        {
          productId: 'p1',
          price: 95,
          basePrice: 100,
          purchasePrice: 60,
        },
      ]),
    ).toThrow('Макс. 0%');
  });

  it('allows HEAD discount within the existing 15% cap', () => {
    expect(() =>
      policy.validateItemPrices(head, [
        {
          productId: 'p1',
          price: 90,
          basePrice: 100,
          purchasePrice: 60,
        },
      ]),
    ).not.toThrow();
  });
});
