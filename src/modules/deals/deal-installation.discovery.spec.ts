import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DealStage,
  FulfillmentSource,
  InstallationStatus,
  OrderStatus,
  RoleName,
  SupplierOrderStatus,
} from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { DealCompletionService } from './deal-completion.service';
import { DealInstallationService } from './deal-installation.service';
import { DealPolicyService } from './services/deal-policy.service';
import { DISTINCT_INSTALLATION_ACTORS_MESSAGE } from './deal-fulfillment.constants';

describe('DealInstallationService discovery', () => {
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
  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: ['installation:assess', 'installation:schedule'],
  };
  const director: CurrentUser = {
    id: 'director-id',
    email: 'director@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.DIRECTOR],
    permissions: ['installation:assess', 'installation:confirm_supervisor'],
  };
  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['deals:read', 'deals:update'],
  };
  const admin: CurrentUser = {
    id: 'admin-id',
    email: 'admin@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ADMIN],
    permissions: ['users:create'],
  };

  const jobRow = {
    id: 'job-id',
    dealId: 'deal-id',
    status: InstallationStatus.SCHEDULED,
    expectedInstallationAt: new Date('2026-08-21T09:00:00.000Z'),
    expectedCompletionAt: new Date('2026-08-21T18:00:00.000Z'),
    assessmentComment: 'Need lift',
    workComment: null,
    assessedAt: new Date('2026-08-20T10:00:00.000Z'),
    assessedById: 'installer-id',
    startedAt: null,
    startedById: null,
    installerConfirmedAt: null,
    installerConfirmedById: null,
    supervisorConfirmedAt: null,
    supervisorConfirmedById: null,
    completedAt: null,
    createdAt: new Date('2026-08-19T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T10:00:00.000Z'),
    assessedBy: {
      id: 'installer-id',
      firstName: 'Ivan',
      lastName: 'Installer',
    },
    startedBy: null,
    installerConfirmedBy: null,
    supervisorConfirmedBy: null,
    deal: {
      id: 'deal-id',
      title: 'Facade install',
      stage: DealStage.WON,
      completedAt: null,
      installationRequiredSnapshot: true,
      fulfillmentSource: FulfillmentSource.SUPPLIER_ORDER,
      client: { id: 'client-id', name: 'Acme', phone: '+79990001122' },
      projectObject: {
        id: 'object-id',
        name: 'Warehouse',
        address: 'Lenina 1',
      },
      order: null,
      supplierOrders: [{ status: SupplierOrderStatus.DELIVERED }],
    },
  };

  let service: DealInstallationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DealInstallationService(
      prisma as never,
      new DealPolicyService(),
      dealCompletion as unknown as DealCompletionService,
    );
    prisma.$transaction.mockImplementation(async (arg) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg(prisma);
    });
    prisma.deal.findFirst.mockResolvedValue({
      id: 'deal-id',
      ownerId: 'manager-id',
      installationRequiredSnapshot: true,
    });
  });

  it('lets INSTALLER list jobs for deals they do not own', async () => {
    prisma.dealInstallation.findMany.mockResolvedValue([jobRow]);
    prisma.dealInstallation.count.mockResolvedValue(1);

    const result = await service.list({}, installer);

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'job-id',
      dealId: 'deal-id',
      status: InstallationStatus.SCHEDULED,
      installationRequiredSnapshot: true,
      dealCompletedAt: null,
    });
    expect(result.items[0].deal.client.name).toBe('Acme');
    expect(result.items[0].delivery.materialsDelivered).toBe(true);
    expect(result.items[0]).not.toHaveProperty('totalAmount');
    expect(prisma.dealInstallation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deal: {
            deletedAt: null,
            installationRequiredSnapshot: true,
          },
        },
      }),
    );
  });

  it('lets INSTALLER get a job by installation id and returns dealId', async () => {
    prisma.dealInstallation.findFirst.mockResolvedValue(jobRow);

    const result = await service.getById('job-id', installer);

    expect(result.id).toBe('job-id');
    expect(result.dealId).toBe('deal-id');
    expect(result.deal.title).toBe('Facade install');
    expect(result.assessedBy).toEqual({
      id: 'installer-id',
      firstName: 'Ivan',
      lastName: 'Installer',
    });
    expect(prisma.dealInstallation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-id', deal: { deletedAt: null } },
      }),
    );
  });

  it('lets HEAD and DIRECTOR list and read installation jobs', async () => {
    prisma.dealInstallation.findMany.mockResolvedValue([jobRow]);
    prisma.dealInstallation.count.mockResolvedValue(1);
    prisma.dealInstallation.findFirst.mockResolvedValue(jobRow);

    await expect(service.list({}, head)).resolves.toEqual(
      expect.objectContaining({ total: 1 }),
    );
    await expect(service.list({}, director)).resolves.toEqual(
      expect.objectContaining({ total: 1 }),
    );
    await expect(service.getById('job-id', head)).resolves.toEqual(
      expect.objectContaining({ dealId: 'deal-id' }),
    );
    await expect(service.getById('job-id', director)).resolves.toEqual(
      expect.objectContaining({ dealId: 'deal-id' }),
    );
  });

  it('denies MANAGER installation job list and get-by-id', async () => {
    await expect(service.list({}, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getById('job-id', manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.dealInstallation.findMany).not.toHaveBeenCalled();
    expect(prisma.dealInstallation.findFirst).not.toHaveBeenCalled();
  });

  it('denies ADMIN-only installation job list and get-by-id', async () => {
    await expect(service.list({}, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getById('job-id', admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.dealInstallation.findMany).not.toHaveBeenCalled();
    expect(prisma.dealInstallation.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the installation id does not resolve', async () => {
    prisma.dealInstallation.findFirst.mockResolvedValue(null);

    await expect(
      service.getById('missing-id', installer),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters requiringAction jobs to incomplete statuses', async () => {
    prisma.dealInstallation.findMany.mockResolvedValue([]);
    prisma.dealInstallation.count.mockResolvedValue(0);

    await service.list({ requiringAction: true }, installer);

    expect(prisma.dealInstallation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deal: {
            deletedAt: null,
            installationRequiredSnapshot: true,
          },
          completedAt: null,
          status: { not: InstallationStatus.COMPLETED },
        },
      }),
    );
  });

  it('lets INSTALLER start work on a deal they do not own', async () => {
    prisma.dealInstallation.findUnique.mockResolvedValue({
      id: 'job-id',
      dealId: 'deal-id',
      startedAt: null,
      completedAt: null,
    });
    prisma.dealInstallation.updateMany.mockResolvedValue({ count: 1 });
    prisma.dealInstallation.findUniqueOrThrow.mockResolvedValue({
      id: 'job-id',
      dealId: 'deal-id',
    });

    await service.start('deal-id', installer);

    expect(prisma.dealInstallation.updateMany).toHaveBeenCalled();
    expect(prisma.deal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'deal-id', deletedAt: null },
      }),
    );
  });

  it('keeps distinct-user confirmation on a foreign deal', async () => {
    prisma.dealInstallation.findUnique.mockResolvedValue({
      id: 'job-id',
      dealId: 'deal-id',
      installerConfirmedAt: new Date('2026-08-17T00:00:00.000Z'),
      installerConfirmedById: installer.id,
      supervisorConfirmedAt: null,
      supervisorConfirmedById: null,
    });

    await expect(
      service.confirmSupervisor('deal-id', {
        ...head,
        id: installer.id,
        roles: [RoleName.INSTALLER, RoleName.HEAD],
        permissions: [
          'installation:confirm_work',
          'installation:confirm_supervisor',
        ],
      }),
    ).rejects.toThrow(DISTINCT_INSTALLATION_ACTORS_MESSAGE);
    expect(prisma.dealInstallation.updateMany).not.toHaveBeenCalled();
  });
});

describe('DealInstallationService discovery mapper leak guard', () => {
  it('does not map quote or supplier price fields onto the job DTO', () => {
    const prisma = {
      dealInstallation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(async (queries: unknown[]) => Promise.all(queries)),
    };
    const service = new DealInstallationService(
      prisma as never,
      new DealPolicyService(),
      { lockFulfillmentRows: jest.fn(), tryFinalize: jest.fn() } as never,
    );
    const installer: CurrentUser = {
      id: 'installer-id',
      email: 'installer@test.com',
      teamId: null,
      managerId: null,
      roles: [RoleName.INSTALLER],
      permissions: ['installation:assess'],
    };

    prisma.dealInstallation.findFirst.mockResolvedValue({
      id: 'job-id',
      dealId: 'deal-id',
      status: InstallationStatus.IN_PROGRESS,
      expectedInstallationAt: null,
      expectedCompletionAt: null,
      assessmentComment: null,
      workComment: null,
      assessedAt: null,
      startedAt: new Date('2026-08-20T08:00:00.000Z'),
      installerConfirmedAt: null,
      supervisorConfirmedAt: null,
      completedAt: null,
      assessedBy: null,
      startedBy: {
        id: 'installer-id',
        firstName: 'Ivan',
        lastName: 'Installer',
      },
      installerConfirmedBy: null,
      supervisorConfirmedBy: null,
      deal: {
        id: 'deal-id',
        title: 'Stock job',
        stage: DealStage.WON,
        completedAt: null,
        installationRequiredSnapshot: true,
        fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
        client: { id: 'client-id', name: 'Beta', phone: null },
        projectObject: null,
        order: {
          id: 'order-id',
          status: OrderStatus.SHIPPED,
          deletedAt: null,
        },
        supplierOrders: [],
      },
    });

    return service.getById('job-id', installer).then((job) => {
      expect(job.dealId).toBe('deal-id');
      expect(job.delivery.materialsDelivered).toBe(true);
      expect(job.startedBy?.id).toBe('installer-id');
      expect(JSON.stringify(job)).not.toContain('purchasePrice');
      expect(JSON.stringify(job)).not.toContain('totalAmount');
      expect(JSON.stringify(job)).not.toContain('margin');
    });
  });
});
