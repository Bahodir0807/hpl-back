import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { DealsService } from './deals.service';
import { DealPolicyService } from './services/deal-policy.service';
import { PricingPolicyService } from '../orders/services/pricing-policy.service';

describe('DealsService create-time owner assignment', () => {
  const prisma = {
    $transaction: jest.fn(),
  };

  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['deals:create'],
  };

  let service: DealsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DealsService(
      prisma as never,
      new DealPolicyService(),
      new PricingPolicyService(),
    );
  });

  it('rejects a manager creating a deal owned by another user', async () => {
    await expect(
      service.create(
        {
          title: 'Foreign deal',
          clientId: '11111111-1111-1111-1111-111111111111',
          ownerId: 'other-manager',
        },
        manager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('DealsService findOne object authorization', () => {
  const prisma = {
    deal: { findFirst: jest.fn() },
  };

  const installer: CurrentUser = {
    id: 'installer-id',
    email: 'installer@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.INSTALLER],
    permissions: [
      'deals:read',
      'installation:assess',
      'installation:confirm_work',
    ],
  };

  let service: DealsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DealsService(
      prisma as never,
      new DealPolicyService(),
      new PricingPolicyService(),
    );
  });

  it('does not let INSTALLER read a foreign Deal through GET /deals/:id', async () => {
    prisma.deal.findFirst.mockResolvedValue({
      id: 'foreign-deal',
      ownerId: 'manager-id',
      title: 'Foreign deal',
    });

    await expect(
      service.findOne('foreign-deal', installer),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
