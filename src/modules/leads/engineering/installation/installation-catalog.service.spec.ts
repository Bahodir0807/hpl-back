/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { InstallationWorkUnit, RoleName } from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { ROLE_PERMISSION_SLUGS } from '../../../../auth/rbac/permission-matrix';
import { InstallationCatalogService } from './installation-catalog.service';

function errorCode(error: unknown): string | undefined {
  if (error instanceof BusinessException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'errorCode' in response) {
      return String(response.errorCode);
    }
  }
  return undefined;
}

async function expectBusinessCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected BusinessException ${code}`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Expected BusinessException')
    ) {
      throw error;
    }
    expect(errorCode(error)).toBe(code);
  }
}

function userFor(role: RoleName): CurrentUser {
  return {
    id: `${role.toLowerCase()}-1`,
    email: `${role.toLowerCase()}@test.com`,
    teamId: null,
    managerId: null,
    roles: [role],
    permissions: [...ROLE_PERMISSION_SLUGS[role]],
  };
}

describe('InstallationCatalogService', () => {
  const prisma = {
    installationWorkType: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    installationContractor: { create: jest.fn(), findUnique: jest.fn() },
    installationContractorRate: { create: jest.fn() },
    supplier: { findUnique: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new InstallationCatalogService(prisma as never);
  const head = userFor(RoleName.HEAD);
  const engineer = userFor(RoleName.ENGINEER);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => unknown)(prisma);
      }
      return arg;
    });
  });

  it('does not let an engineer manage rates or contractors', async () => {
    await expectBusinessCode(
      service.createContractor(
        { name: 'Бригада', type: 'INTERNAL_CREW' },
        engineer,
      ),
      'FORBIDDEN',
    );
    await expectBusinessCode(
      service.createRate(
        {
          contractorId: 'c1',
          workTypeId: 'w1',
          unit: InstallationWorkUnit.M2,
          pricePerUnit: '10',
          currency: 'USD',
          validFrom: new Date().toISOString(),
        },
        engineer,
      ),
      'FORBIDDEN',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a crew without a User or INSTALLER role', async () => {
    prisma.installationContractor.create.mockResolvedValue({
      id: 'crew-1',
      name: 'Бригада А',
      type: 'INTERNAL_CREW',
      contactName: null,
      phone: null,
      note: null,
      supplierId: null,
      isActive: true,
      supplier: null,
    });
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    const created = await service.createContractor(
      { name: 'Бригада А', type: 'INTERNAL_CREW' },
      head,
    );
    expect(created.userId).toBeNull();
    expect(created.roleName).toBeNull();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a rate whose unit does not match the work type', async () => {
    prisma.installationContractor.findUnique.mockResolvedValue({
      id: 'c1',
    });
    prisma.installationWorkType.findUnique.mockResolvedValue({
      id: 'w1',
      unit: InstallationWorkUnit.M2,
    });
    await expectBusinessCode(
      service.createRate(
        {
          contractorId: 'c1',
          workTypeId: 'w1',
          unit: InstallationWorkUnit.HOUR,
          pricePerUnit: '10',
          currency: 'USD',
          validFrom: new Date().toISOString(),
        },
        head,
      ),
      'INSTALLATION_RATE_UNIT_MISMATCH',
    );
  });
});
