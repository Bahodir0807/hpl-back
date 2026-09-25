/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  EngineeringAssignmentStatus,
  FacadeAreaSource,
  FacadeCalculationStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { ROLE_PERMISSION_SLUGS } from '../../../../auth/rbac/permission-matrix';
import { FacadeCalculationService } from './facade-calculation.service';
import {
  BASE_FACADE_CONFIG_CODE,
  BASE_FACADE_NORMS_V1,
  BASE_FACADE_NORM_SET_CODE,
  EXPECTED_QTY_FOR_1000_M2,
} from './facade-norms';

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

describe('FacadeCalculationService', () => {
  const prisma = {
    lead: { findFirst: jest.fn() },
    leadEngineeringAssignment: { findFirst: jest.fn() },
    facadeSystemConfig: { findMany: jest.fn(), findUnique: jest.fn() },
    facadeMaterial: { findMany: jest.fn(), findFirst: jest.fn() },
    facadeNormSet: { findFirst: jest.fn() },
    facadeSubsystemCalculation: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    facadeSubsystemCalculationItem: {
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    facadeSubsystemCalculationRevision: { create: jest.fn() },
    panelQuote: { create: jest.fn() },
    deal: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const manager: CurrentUser = {
    id: 'manager-1',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: [...ROLE_PERMISSION_SLUGS[RoleName.MANAGER]],
  };

  const engineer: CurrentUser = {
    id: 'engineer-1',
    email: 'engineer@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ENGINEER],
    permissions: [...ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]],
  };

  const otherEngineer: CurrentUser = {
    id: 'engineer-2',
    email: 'engineer2@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ENGINEER],
    permissions: [...ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]],
  };

  const assignment = {
    id: 'assignment-1',
    leadId: 'lead-1',
    engineerId: engineer.id,
    status: EngineeringAssignmentStatus.ACTIVE,
    activeLeadId: 'lead-1',
  };

  const config = {
    id: 'config-1',
    code: BASE_FACADE_CONFIG_CODE,
    nameRu: 'Base',
    nameEn: 'Base',
    nameUz: 'Base',
    isCalculable: true,
    panelWidthMm: 1220,
    panelHeightMm: 3050,
    panelAreaM2: new Prisma.Decimal('3.721'),
  };

  const glueConfig = {
    id: 'config-glue',
    code: 'HPL_FACADE_GLUE',
    nameRu: 'Glue',
    nameEn: 'Glue',
    nameUz: 'Glue',
    isCalculable: false,
    panelWidthMm: null,
    panelHeightMm: null,
    panelAreaM2: null,
  };

  const materials = BASE_FACADE_NORMS_V1.map((def) => ({
    id: `mat-${def.code}`,
    code: def.code,
    nameRu: def.nameRu,
    nameEn: def.nameEn,
    nameUz: def.nameUz,
    category: def.category,
    unit: def.unit,
    spec: def.spec,
    isActive: true,
    sortOrder: def.sortOrder,
  }));

  const normSet = {
    id: 'norm-set-1',
    code: BASE_FACADE_NORM_SET_CODE,
    configId: config.id,
    isCurrent: true,
    norms: BASE_FACADE_NORMS_V1.map((def) => ({
      id: `norm-${def.code}`,
      qtyPerM2: new Prisma.Decimal(def.qtyPerM2),
      unit: def.unit,
      sortOrder: def.sortOrder,
      material: materials.find((item) => item.code === def.code),
    })),
  };

  let service: FacadeCalculationService;
  let store: {
    calculation: Record<string, unknown> | null;
    items: Array<Record<string, unknown>>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    store = { calculation: null, items: [] };
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => unknown)(prisma);
      }
      return arg;
    });
    prisma.facadeSubsystemCalculationItem.deleteMany.mockResolvedValue({
      count: 0,
    });
    prisma.facadeSubsystemCalculationRevision.create.mockResolvedValue({
      id: 'rev-1',
    });
    prisma.facadeSubsystemCalculation.create.mockImplementation(
      async ({ data }) => {
        store.calculation = {
          id: 'calc-1',
          revision: 1,
          notes: null,
          createdAt: new Date('2026-09-19T12:00:00.000Z'),
          updatedAt: new Date('2026-09-19T12:00:00.000Z'),
          ...data,
        };
        return store.calculation;
      },
    );
    prisma.facadeSubsystemCalculation.update.mockImplementation(
      async ({ data }) => {
        const current = store.calculation ?? { id: 'calc-1', revision: 1 };
        const nextRevision =
          data.revision && typeof data.revision === 'object'
            ? Number(current.revision ?? 1) + 1
            : (data.revision ?? current.revision);
        store.calculation = {
          ...current,
          ...data,
          revision: nextRevision,
          notes:
            data.notes === undefined
              ? (current.notes as string | null)
              : data.notes,
        };
        return {
          ...store.calculation,
          items: store.items,
          config,
          normSet,
        };
      },
    );
    prisma.facadeSubsystemCalculationItem.create.mockImplementation(
      async ({ data }) => {
        const item = { id: `item-${store.items.length + 1}`, ...data };
        store.items.push(item);
        return item;
      },
    );
    prisma.facadeSubsystemCalculationItem.update.mockImplementation(
      async ({ where, data }) => {
        const item = store.items.find((row) => row.id === where.id);
        Object.assign(item ?? {}, data);
        return item;
      },
    );
    prisma.facadeSubsystemCalculation.findUniqueOrThrow.mockImplementation(
      async () => ({
        ...store.calculation,
        items: store.items,
        config:
          store.calculation?.configId === glueConfig.id ? glueConfig : config,
        normSet: store.calculation?.normSetId ? normSet : null,
      }),
    );
    service = new FacadeCalculationService(prisma as never);
  });

  function mockLead(input?: {
    ventFacadeKitRequired?: boolean;
    installationRequired?: boolean;
    items?: Array<{ requiredAreaM2: Prisma.Decimal | null }>;
    requiredAreaM2?: Prisma.Decimal | null;
  }) {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      ownerId: manager.id,
      deletedAt: null,
      qualification: {
        ventFacadeKitRequired: input?.ventFacadeKitRequired ?? true,
        installationRequired: input?.installationRequired ?? false,
        requiredAreaM2: input?.requiredAreaM2 ?? null,
        items: input?.items ?? [],
      },
    });
  }

  function mockAssignedEngineer() {
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(assignment);
  }

  it('lets the assigned engineer open the calculator when subsystem is ordered', async () => {
    mockLead({ ventFacadeKitRequired: true });
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findMany.mockResolvedValue([config, glueConfig]);
    prisma.facadeMaterial.findMany.mockResolvedValue(materials);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(null);

    const result = await service.getWorkspace('lead-1', engineer);

    expect(result.applicable).toBe(true);
    expect(result.canEdit).toBe(true);
    expect(result.calculation).toBeNull();
    expect(result.quoteCreated).toBe(false);
    expect(result.dealCreated).toBe(false);
  });

  it('denies another engineer access to a foreign lead', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);

    await expectBusinessCode(
      service.getWorkspace('lead-1', otherEngineer),
      'FORBIDDEN',
    );
  });

  it('does not auto-create a subsystem calculation for installation-only', async () => {
    mockLead({
      ventFacadeKitRequired: false,
      installationRequired: true,
    });
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findMany.mockResolvedValue([config]);
    prisma.facadeMaterial.findMany.mockResolvedValue(materials);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(null);

    const workspace = await service.getWorkspace('lead-1', engineer);
    expect(workspace.applicable).toBe(false);
    expect(workspace.reason).toBe('INSTALLATION_ONLY');
    expect(workspace.calculation).toBeNull();

    await expectBusinessCode(
      service.calculate(
        'lead-1',
        {
          configCode: BASE_FACADE_CONFIG_CODE,
          claddingAreaM2: '1000',
        },
        engineer,
      ),
      'FACADE_NOT_APPLICABLE',
    );
  });

  it('creates one subsystem calculation when both subsystem and installation are ordered', async () => {
    mockLead({
      ventFacadeKitRequired: true,
      installationRequired: true,
    });
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findUnique.mockResolvedValue({
      ...config,
      code: 'HPL_DRY_6MM_50MM',
    });
    prisma.facadeNormSet.findFirst.mockResolvedValue(normSet);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(null);

    const result = await service.calculate(
      'lead-1',
      {
        configCode: 'HPL_DRY_6MM_50MM',
        claddingAreaM2: '1000',
        areaSource: FacadeAreaSource.ENGINEER_ENTERED,
      },
      engineer,
    );

    expect(result.items).toHaveLength(18);
    expect(result.quoteCreated).toBe(false);
    expect(result.dealCreated).toBe(false);
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('calculates 1000 m² from cladding area using the 18 approved norms', async () => {
    mockLead();
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findUnique.mockResolvedValue({
      ...config,
      code: 'HPL_DRY_6MM_50MM',
    });
    prisma.facadeNormSet.findFirst.mockResolvedValue(normSet);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(null);

    const result = await service.calculate(
      'lead-1',
      {
        configCode: 'HPL_DRY_6MM_50MM',
        claddingAreaM2: '1000',
      },
      engineer,
    );

    expect(result.items).toHaveLength(18);
    for (const item of result.items) {
      expect(item.calculatedQty).toBe(EXPECTED_QTY_FOR_1000_M2[item.materialCode]);
      expect(item.finalQty).toBe(EXPECTED_QTY_FOR_1000_M2[item.materialCode]);
      expect(item.qtyPerM2).toBe(
        BASE_FACADE_NORMS_V1.find((def) => def.code === item.materialCode)
          ?.qtyPerM2,
      );
    }
    expect(result.items[0].calculatedQty).toBe('1060');
  });

  it('uses qualification cladding area, not purchased sheet area', async () => {
    mockLead({
      items: [{ requiredAreaM2: new Prisma.Decimal('80') }],
      requiredAreaM2: new Prisma.Decimal('80'),
    });
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findMany.mockResolvedValue([config]);
    prisma.facadeMaterial.findMany.mockResolvedValue(materials);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(null);

    const workspace = await service.getWorkspace('lead-1', engineer);
    expect(workspace.suggestedArea.value).toBe('80');
    expect(workspace.suggestedArea.source).toBe(
      FacadeAreaSource.HPL_QUALIFICATION,
    );
  });

  it('keeps calculated quantity separate from a manual final quantity after reopen', async () => {
    mockLead();
    mockAssignedEngineer();
    store.calculation = {
      id: 'calc-1',
      leadId: 'lead-1',
      assignmentId: assignment.id,
      engineerId: engineer.id,
      configId: config.id,
      normSetId: normSet.id,
      claddingAreaM2: new Prisma.Decimal('1000'),
      areaSource: FacadeAreaSource.ENGINEER_ENTERED,
      status: FacadeCalculationStatus.CALCULATED,
      revision: 1,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.items = [
      {
        id: 'item-1',
        materialId: 'mat-hpl_panel_1220_3050',
        materialCode: 'hpl_panel_1220_3050',
        materialName: 'HPL-панель 1220×3050 мм',
        category: 'HPL',
        unit: 'M2',
        specSnapshot: { sizeMm: '1220×3050' },
        qtyPerM2: new Prisma.Decimal('1.06'),
        calculatedQty: new Prisma.Decimal('1060'),
        finalQty: new Prisma.Decimal('1060'),
        isManual: false,
        isExtra: false,
        note: null,
        sortOrder: 1,
      },
    ];
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue({
      ...store.calculation,
      items: store.items,
      config,
      normSet,
    });

    const saved = await service.saveDraft(
      'lead-1',
      {
        expectedRevision: 1,
        items: [{ id: 'item-1', finalQty: '1100', note: 'запас на узлы' }],
      },
      engineer,
    );

    expect(saved.items[0].calculatedQty).toBe('1060');
    expect(saved.items[0].finalQty).toBe('1100');
    expect(saved.items[0].isManual).toBe(true);
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
  });

  it('requires confirmation before recalculating over manual adjustments', async () => {
    mockLead();
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findUnique.mockResolvedValue(config);
    prisma.facadeNormSet.findFirst.mockResolvedValue(normSet);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue({
      id: 'calc-1',
      configId: config.id,
      normSetId: normSet.id,
      revision: 2,
      items: [
        {
          materialCode: 'hpl_panel_1220_3050',
          isManual: true,
          finalQty: new Prisma.Decimal('1100'),
          note: 'узлы',
        },
      ],
    });

    await expectBusinessCode(
      service.calculate(
        'lead-1',
        {
          configCode: BASE_FACADE_CONFIG_CODE,
          claddingAreaM2: '1200',
          expectedRevision: 2,
        },
        engineer,
      ),
      'FACADE_RECALC_CONFIRMATION_REQUIRED',
    );
  });

  it('keeps snapshots when the live catalog name later changes', async () => {
    mockLead();
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findMany.mockResolvedValue([config]);
    prisma.facadeMaterial.findMany.mockResolvedValue([
      { ...materials[0], nameRu: 'Новое имя из справочника' },
    ]);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue({
      id: 'calc-1',
      leadId: 'lead-1',
      assignmentId: assignment.id,
      engineerId: engineer.id,
      configId: config.id,
      normSetId: normSet.id,
      claddingAreaM2: new Prisma.Decimal('1000'),
      areaSource: FacadeAreaSource.ENGINEER_ENTERED,
      status: FacadeCalculationStatus.CALCULATED,
      revision: 3,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      config,
      normSet,
      items: [
        {
          id: 'item-1',
          materialId: materials[0].id,
          materialCode: materials[0].code,
          materialName: 'HPL-панель 1220×3050 мм',
          category: 'HPL',
          unit: 'M2',
          specSnapshot: { sizeMm: '1220×3050' },
          qtyPerM2: new Prisma.Decimal('1.06'),
          calculatedQty: new Prisma.Decimal('1060'),
          finalQty: new Prisma.Decimal('1060'),
          isManual: false,
          isExtra: false,
          note: null,
          sortOrder: 1,
        },
      ],
    });

    const workspace = await service.getWorkspace('lead-1', engineer);
    expect(workspace.calculation?.items[0].materialName).toBe(
      'HPL-панель 1220×3050 мм',
    );
    expect(workspace.calculation?.items[0].qtyPerM2).toBe('1.06');
    expect(workspace.catalog[0].hasPrice).toBe(false);
    expect(workspace.catalog[0].price).toBeNull();
  });

  it('does not invent quantities for an unsupported configuration', async () => {
    mockLead();
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findUnique.mockResolvedValue(glueConfig);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(null);

    const result = await service.calculate(
      'lead-1',
      {
        configCode: 'HPL_FACADE_GLUE',
        claddingAreaM2: '1000',
      },
      engineer,
    );

    expect(result.status).toBe(FacadeCalculationStatus.UNSUPPORTED);
    expect(result.ready).toBe(false);
    expect(result.items.filter((item) => !item.isExtra)).toHaveLength(0);
    expect(result.quoteCreated).toBe(false);
  });

  it('does not let a replaced engineer edit the calculation', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);

    await expectBusinessCode(
      service.saveDraft(
        'lead-1',
        { expectedRevision: 1, items: [] },
        otherEngineer,
      ),
      'FORBIDDEN',
    );
  });

  it('does not give ENGINEER commercial permissions', () => {
    expect(ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]).not.toContain(
      'quotes:approve',
    );
    expect(ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]).not.toContain(
      'leads:read_all',
    );
    expect(ROLE_PERMISSION_SLUGS[RoleName.DIRECTOR]).not.toContain(
      'quotes:approve',
    );
    expect(ROLE_PERMISSION_SLUGS[RoleName.HEAD]).toContain('quotes:approve');
  });

  it('rejects starting a new calculation on the historical base configuration', async () => {
    mockLead();
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findUnique.mockResolvedValue(config);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(null);

    await expectBusinessCode(
      service.calculate(
        'lead-1',
        { configCode: BASE_FACADE_CONFIG_CODE, claddingAreaM2: '10' },
        engineer,
      ),
      'FACADE_CONFIG_LEGACY',
    );
  });

  it('does not carry manual quantities into another system without confirmation', async () => {
    mockLead();
    mockAssignedEngineer();
    prisma.facadeSystemConfig.findUnique.mockResolvedValue({
      ...config,
      id: 'config-8',
      code: 'HPL_DRY_8MM_80MM',
    });
    prisma.facadeNormSet.findFirst.mockResolvedValue({
      ...normSet,
      id: 'norm-8',
      code: 'HPL_DRY_8MM_80MM_V1',
    });
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue({
      id: 'calc-1',
      leadId: 'lead-1',
      configId: config.id,
      normSetId: normSet.id,
      revision: 2,
      items: [
        {
          materialCode: 'hpl_panel_1220_3050',
          isManual: true,
          isExtra: false,
          finalQty: new Prisma.Decimal('99'),
        },
      ],
    });

    await expectBusinessCode(
      service.calculate(
        'lead-1',
        { configCode: 'HPL_DRY_8MM_80MM', claddingAreaM2: '10' },
        engineer,
      ),
      'FACADE_RECALC_CONFIRMATION_REQUIRED',
    );
  });

  it('rejects stale revisions instead of silently overwriting', async () => {
    mockLead();
    mockAssignedEngineer();
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue({
      id: 'calc-1',
      revision: 4,
      items: [],
    });

    await expectBusinessCode(
      service.saveDraft(
        'lead-1',
        { expectedRevision: 3, notes: 'old tab' },
        engineer,
      ),
      'FACADE_REVISION_CONFLICT',
    );
  });
});
