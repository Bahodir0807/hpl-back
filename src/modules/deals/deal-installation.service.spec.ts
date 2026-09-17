import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { DealCompletionService } from './deal-completion.service';
import { DealInstallationService } from './deal-installation.service';
import { DealPolicyService } from './services/deal-policy.service';

describe('DealInstallationService', () => {
  const prisma = {
    deal: { findFirst: jest.fn() },
    dealInstallation: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    notification: { createMany: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const dealCompletion = {
    lockFulfillmentRows: jest.fn(),
    tryFinalize: jest.fn(),
    tryFinalizeDeal: jest.fn(),
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: ['installation:schedule', 'installation:confirm_supervisor'],
  };
  const director: CurrentUser = {
    id: 'director-id',
    email: 'director@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.DIRECTOR],
    permissions: ['installation:schedule', 'installation:confirm_supervisor'],
  };
  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['deals:update'],
  };
  const admin: CurrentUser = {
    id: 'admin-id',
    email: 'admin@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ADMIN],
    permissions: ['users:create'],
  };

  let service: DealInstallationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DealInstallationService(
      prisma as never,
      new DealPolicyService(),
      dealCompletion as unknown as DealCompletionService,
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.deal.findFirst.mockResolvedValue({
      id: 'deal-id',
      ownerId: 'manager-id',
      installationRequiredSnapshot: true,
    });
    prisma.user.findMany.mockResolvedValue([]);
  });

  it('denies MANAGER and ADMIN-only from scheduling dates', async () => {
    const dto = {
      expectedInstallationAt: new Date('2026-08-20T00:00:00.000Z'),
      expectedCompletionAt: new Date('2026-08-21T00:00:00.000Z'),
    };

    await expect(
      service.schedule('deal-id', dto, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.schedule('deal-id', dto, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dealInstallation.create).not.toHaveBeenCalled();
  });

  it('rejects expectedCompletionAt before expectedInstallationAt', async () => {
    await expect(
      service.schedule(
        'deal-id',
        {
          expectedInstallationAt: new Date('2026-08-21T00:00:00.000Z'),
          expectedCompletionAt: new Date('2026-08-20T00:00:00.000Z'),
        },
        head,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows HEAD and DIRECTOR to schedule', async () => {
    prisma.dealInstallation.findUnique.mockResolvedValue(null);
    prisma.dealInstallation.create.mockResolvedValue({ id: 'job-id' });

    await service.schedule(
      'deal-id',
      {
        expectedInstallationAt: new Date('2026-08-20T00:00:00.000Z'),
        expectedCompletionAt: new Date('2026-08-21T00:00:00.000Z'),
      },
      head,
    );
    await service.schedule(
      'deal-id',
      {
        expectedInstallationAt: new Date('2026-08-20T00:00:00.000Z'),
        expectedCompletionAt: new Date('2026-08-21T00:00:00.000Z'),
      },
      director,
    );

    expect(prisma.dealInstallation.create).toHaveBeenCalledTimes(2);
  });

  it('returns an already confirmed installation without writing it again', async () => {
    prisma.dealInstallation.findUnique.mockResolvedValue({
      id: 'job-id',
      dealId: 'deal-id',
      installerConfirmedAt: null,
      installerConfirmedById: null,
      supervisorConfirmedAt: new Date('2026-08-20T10:00:00.000Z'),
      supervisorConfirmedById: 'head-id',
    });
    prisma.dealInstallation.findUniqueOrThrow.mockResolvedValue({
      id: 'job-id',
      supervisorConfirmedById: 'head-id',
    });

    await service.confirmSupervisor('deal-id', head);
    expect(prisma.dealInstallation.updateMany).not.toHaveBeenCalled();
  });

  it('records supervisor confirmation and finalizes the installation workflow', async () => {
    prisma.dealInstallation.findUnique.mockResolvedValue({
      id: 'job-id',
      dealId: 'deal-id',
      supervisorConfirmedAt: null,
      supervisorConfirmedById: null,
    });
    prisma.dealInstallation.updateMany.mockResolvedValue({ count: 1 });
    prisma.dealInstallation.findUniqueOrThrow.mockResolvedValue({
      id: 'job-id',
    });

    await service.confirmSupervisor('deal-id', head);

    expect(prisma.dealInstallation.updateMany).toHaveBeenCalledTimes(1);
    expect(dealCompletion.tryFinalize).toHaveBeenCalled();
  });
});
