/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  EngineeringAssignmentStatus,
  InstallationCalculationStatus,
  InstallationQuantitySource,
  InstallationWorkUnit,
  Prisma,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { ROLE_PERMISSION_SLUGS } from '../../../../auth/rbac/permission-matrix';
import { InstallationCalculationService } from './installation-calculation.service';

function errorCode(error: unknown): string | undefined {
  if (error instanceof BusinessException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'errorCode' in response) {
      return String(response.errorCode);
    }
  }
  return undefined;
}

async function expectBusinessCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
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

function userFor(role: RoleName, id = `${role.toLowerCase()}-1`): CurrentUser {
  return {
    id,
    email: `${role.toLowerCase()}@test.com`,
    teamId: null,
    managerId: null,
    roles: [role],
    permissions: [...ROLE_PERMISSION_SLUGS[role]],
  };
}

describe('InstallationCalculationService', () => {
  const prisma = {
    lead: { findFirst: jest.fn() },
    leadEngineeringAssignment: { findFirst: jest.fn() },
    installationWorkType: { findMany: jest.fn() },
    installationCalculation: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    installationCalculationItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    installationCalculationRevision: { create: jest.fn() },
    panelQuote: { create: jest.fn() },
    deal: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const commercial = {
    onTechnicalRevisionChanged: jest.fn().mockResolvedValue(undefined),
  };

  const service = new InstallationCalculationService(
    prisma as never,
    commercial as never,
  );
  const engineer = userFor(RoleName.ENGINEER);
  const foreignEngineer = userFor(RoleName.ENGINEER, 'engineer-2');
  const manager = userFor(RoleName.MANAGER, 'manager-1');

  const workTypeM2 = {
    id: 'wt-hpl',
    code: 'hpl_install_m2',
    nameRu: 'Монтаж HPL',
    nameEn: 'HPL install',
    nameUz: 'HPL montaj',
    description: null,
    unit: InstallationWorkUnit.M2,
    category: 'CLADDING',
    isActive: true,
  };
  const workTypeHour = {
    id: 'wt-travel',
    code: 'crew_travel',
    nameRu: 'Выезд бригады',
    nameEn: 'Crew travel',
    nameUz: 'Brigada chiqishi',
    description: null,
    unit: InstallationWorkUnit.HOUR,
    category: 'TRAVEL',
    isActive: true,
  };

  const assignment = {
    id: 'assign-1',
    leadId: 'lead-1',
    engineerId: engineer.id,
    status: EngineeringAssignmentStatus.ACTIVE,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => unknown)(prisma);
      }
      return arg;
    });
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      ownerId: 'manager-1',
      qualification: {
        installationRequired: true,
        ventFacadeKitRequired: false,
        requiredAreaM2: new Prisma.Decimal('1000'),
        items: [],
      },
    });
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(assignment);
    prisma.installationWorkType.findMany.mockResolvedValue([
      workTypeM2,
      workTypeHour,
    ]);
    prisma.installationCalculation.findUnique.mockResolvedValue(null);
    prisma.installationCalculation.create.mockImplementation(async ({ data }) => ({
      id: 'calc-1',
      leadId: 'lead-1',
      assignmentId: data.assignmentId,
      engineerId: data.engineerId,
      status: InstallationCalculationStatus.DRAFT,
      revision: 1,
      note: data.note ?? null,
    }));
    prisma.installationCalculation.update.mockImplementation(async ({ data }) => ({
      id: 'calc-1',
      leadId: 'lead-1',
      assignmentId: assignment.id,
      engineerId: engineer.id,
      status: data.status ?? InstallationCalculationStatus.DRAFT,
      revision: 2,
      note: data.note ?? null,
    }));
    prisma.installationCalculation.findUniqueOrThrow.mockResolvedValue({
      id: 'calc-1',
      leadId: 'lead-1',
      assignmentId: assignment.id,
      engineerId: engineer.id,
      status: InstallationCalculationStatus.DRAFT,
      revision: 1,
      note: null,
      items: [
        {
          id: 'item-1',
          workTypeId: workTypeM2.id,
          workTypeCode: workTypeM2.code,
          workTypeName: workTypeM2.nameRu,
          unit: InstallationWorkUnit.M2,
          quantity: new Prisma.Decimal('1000'),
          quantitySource: InstallationQuantitySource.MANUAL,
          note: null,
          sortOrder: 0,
        },
      ],
    });
    prisma.installationCalculationItem.deleteMany.mockResolvedValue({ count: 0 });
    prisma.installationCalculationItem.createMany.mockResolvedValue({ count: 1 });
    prisma.installationCalculationRevision.create.mockResolvedValue({ id: 'rev-1' });
  });

  it('allows an installation-only lead without a facade calculation', async () => {
    const workspace = await service.getWorkspace('lead-1', engineer);
    expect(workspace.applicable).toBe(true);
    expect(workspace.reason).toBeNull();
    expect(workspace.canEdit).toBe(true);
    expect(workspace.approvedNormAvailable).toBe(false);
    expect(workspace.quoteCreated).toBe(false);
    expect(workspace.dealCreated).toBe(false);
  });

  it('does not auto-create an installation calculation for HPL-only', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-hpl',
      ownerId: 'manager-1',
      qualification: {
        installationRequired: false,
        ventFacadeKitRequired: false,
        requiredAreaM2: new Prisma.Decimal('100'),
        items: [],
      },
    });
    const workspace = await service.getWorkspace('lead-hpl', engineer);
    expect(workspace.applicable).toBe(false);
    expect(workspace.reason).toBe('INSTALLATION_NOT_REQUESTED');
    expect(workspace.calculation).toBeNull();
    await expectBusinessCode(
      service.saveDraft('lead-hpl', { items: [] }, engineer),
      'INSTALLATION_NOT_APPLICABLE',
    );
  });

  it('rejects a foreign engineer with 403', async () => {
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);
    await expectBusinessCode(
      service.getWorkspace('lead-1', foreignEngineer),
      'FORBIDDEN',
    );
  });

  it('rejects edits after the assignment is finished', async () => {
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);
    await expectBusinessCode(
      service.saveDraft(
        'lead-1',
        {
          items: [
            { workTypeId: workTypeM2.id, quantity: '10' },
          ],
        },
        engineer,
      ),
      'FORBIDDEN',
    );
  });

  it('saves manual quantities and increments revision', async () => {
    prisma.installationCalculation.findUnique.mockResolvedValue({
      id: 'calc-1',
      leadId: 'lead-1',
      revision: 1,
      note: null,
      items: [],
    });
    const saved = await service.saveDraft(
      'lead-1',
      {
        expectedRevision: 1,
        items: [
          { workTypeId: workTypeM2.id, quantity: '1200', note: 'ручной объём' },
          { workTypeId: workTypeHour.id, quantity: '8' },
        ],
      },
      engineer,
    );
    expect(prisma.installationCalculation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revision: { increment: 1 } }),
      }),
    );
    expect(saved.quoteCreated).toBe(false);
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('protects against stale revision writes', async () => {
    prisma.installationCalculation.findUnique.mockResolvedValue({
      id: 'calc-1',
      leadId: 'lead-1',
      revision: 4,
      items: [],
    });
    await expectBusinessCode(
      service.saveDraft(
        'lead-1',
        { expectedRevision: 3, items: [{ workTypeId: workTypeM2.id, quantity: '1' }] },
        engineer,
      ),
      'INSTALLATION_REVISION_CONFLICT',
    );
  });

  it('rejects APPROVED_NORM when no approved installation norms exist', async () => {
    await expectBusinessCode(
      service.saveDraft(
        'lead-1',
        {
          items: [
            {
              workTypeId: workTypeM2.id,
              quantity: '1',
              quantitySource: InstallationQuantitySource.APPROVED_NORM,
            },
          ],
        },
        engineer,
      ),
      'INSTALLATION_NORM_NOT_CONFIGURED',
    );
  });

  it('does not auto-apply confirmed area to hourly operations', async () => {
    await expectBusinessCode(
      service.saveDraft(
        'lead-1',
        {
          items: [
            {
              workTypeId: workTypeHour.id,
              quantity: '1',
              quantitySource: InstallationQuantitySource.CONFIRMED_AREA,
            },
          ],
        },
        engineer,
      ),
      'INSTALLATION_CONFIRMED_AREA_UNIT',
    );
  });

  it('uses confirmed cladding area only when the engineer selects it for m² work', async () => {
    await service.saveDraft(
      'lead-1',
      {
        items: [
          {
            workTypeId: workTypeM2.id,
            quantity: '1',
            quantitySource: InstallationQuantitySource.CONFIRMED_AREA,
          },
        ],
      },
      engineer,
    );
    expect(prisma.installationCalculationItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            quantity: new Prisma.Decimal('1000'),
            quantitySource: InstallationQuantitySource.CONFIRMED_AREA,
          }),
        ],
      }),
    );
  });

  it('does not let a manager edit the technical calculation', async () => {
    await expectBusinessCode(
      service.saveDraft(
        'lead-1',
        { items: [{ workTypeId: workTypeM2.id, quantity: '10' }] },
        manager,
      ),
      'INSTALLATION_EDIT_FORBIDDEN',
    );
  });
});
