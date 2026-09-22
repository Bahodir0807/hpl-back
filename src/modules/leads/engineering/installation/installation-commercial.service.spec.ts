/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  InstallationCalculationStatus,
  InstallationCommercialStatus,
  InstallationWorkUnit,
  Prisma,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { ROLE_PERMISSION_SLUGS } from '../../../../auth/rbac/permission-matrix';
import { InstallationCommercialService } from './installation-commercial.service';
import { INSTALLATION_PRICE_STATUS } from './installation-pricing.constants';

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

describe('InstallationCommercialService', () => {
  const prisma = {
    lead: { findFirst: jest.fn() },
    installationCalculation: { findUnique: jest.fn() },
    installationCommercialCalculation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    installationCommercialCalculationItem: { deleteMany: jest.fn() },
    installationContractorRate: { findMany: jest.fn() },
    currencyRate: { findFirst: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    notification: { create: jest.fn() },
    user: { findMany: jest.fn() },
    panelQuote: { create: jest.fn() },
    deal: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new InstallationCommercialService(prisma as never);
  const head = userFor(RoleName.HEAD);
  const director = userFor(RoleName.DIRECTOR);
  const engineer = userFor(RoleName.ENGINEER);
  const manager = userFor(RoleName.MANAGER, 'manager-1');

  const technical = {
    id: 'tech-1',
    leadId: 'lead-1',
    revision: 1,
    status: InstallationCalculationStatus.READY,
    items: [
      {
        id: 't-hpl',
        workTypeId: 'wt-hpl',
        workTypeCode: 'hpl_install_m2',
        workTypeName: 'Монтаж HPL',
        workTypeSnapshot: { unit: 'M2' },
        unit: InstallationWorkUnit.M2,
        quantity: new Prisma.Decimal('1000'),
        quantitySource: 'MANUAL',
        sortOrder: 0,
      },
      {
        id: 't-travel',
        workTypeId: 'wt-travel',
        workTypeCode: 'crew_travel',
        workTypeName: 'Выезд',
        workTypeSnapshot: { unit: 'HOUR' },
        unit: InstallationWorkUnit.HOUR,
        quantity: new Prisma.Decimal('8'),
        quantitySource: 'MANUAL',
        sortOrder: 1,
      },
    ],
  };

  const usdRate = {
    id: 'rate-usd',
    contractorId: 'crew-1',
    workTypeId: 'wt-hpl',
    unit: InstallationWorkUnit.M2,
    pricePerUnit: new Prisma.Decimal('12'),
    currency: 'USD',
    validFrom: new Date('2026-01-01'),
    validTo: null,
    isActive: true,
    note: null,
    contractor: {
      id: 'crew-1',
      name: 'Бригада А',
      type: 'INTERNAL_CREW',
      isActive: true,
    },
    workType: { code: 'hpl_install_m2', unit: InstallationWorkUnit.M2 },
  };

  const hourRate = {
    ...usdRate,
    id: 'rate-hour',
    contractorId: 'crew-2',
    workTypeId: 'wt-travel',
    unit: InstallationWorkUnit.HOUR,
    pricePerUnit: new Prisma.Decimal('25'),
    contractor: {
      id: 'crew-2',
      name: 'Подрядчик Б',
      type: 'EXTERNAL_CONTRACTOR',
      isActive: true,
    },
    workType: { code: 'crew_travel', unit: InstallationWorkUnit.HOUR },
  };

  const inactiveRate = { ...usdRate, id: 'rate-off', isActive: false };
  const eurRate = {
    ...hourRate,
    id: 'rate-eur',
    pricePerUnit: new Prisma.Decimal('20'),
    currency: 'EUR',
  };

  function commercialDraft(overrides: Record<string, unknown> = {}) {
    return {
      id: 'com-1',
      leadId: 'lead-1',
      installationCalculationId: 'tech-1',
      installationCalculationRevision: 1,
      revision: 1,
      isCurrent: true,
      status: InstallationCommercialStatus.DRAFT,
      technicalSnapshot: {},
      costIncomplete: true,
      costByCurrency: [],
      fxSnapshots: [],
      proposedCustomerAmount: new Prisma.Decimal('15000'),
      proposedCurrency: 'USD',
      approvedCustomerAmount: null,
      approvedCurrency: null,
      approvedById: null,
      approvedAt: null,
      approverRoleSnapshot: null,
      commercialNote: null,
      quoteCreated: false,
      dealCreated: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 'c-hpl',
          technicalItemId: 't-hpl',
          workTypeId: 'wt-hpl',
          workTypeCode: 'hpl_install_m2',
          workTypeName: 'Монтаж HPL',
          workTypeSnapshot: {},
          unit: 'M2',
          quantity: new Prisma.Decimal('1000'),
          quantitySource: 'MANUAL',
          selectedRateId: usdRate.id,
          rateSnapshot: { pricePerUnit: '12' },
          contractorId: 'crew-1',
          contractorName: 'Бригада А',
          pricePerUnit: new Prisma.Decimal('12'),
          currency: 'USD',
          lineCostTotal: new Prisma.Decimal('12000'),
          priceStatus: INSTALLATION_PRICE_STATUS.CONFIGURED,
          fxFromCurrency: 'USD',
          fxToCurrency: 'USD',
          fxRate: new Prisma.Decimal(1),
          fxRateId: null,
          fxEffectiveFrom: null,
          convertedAmount: new Prisma.Decimal('12000'),
          convertedCurrency: 'USD',
          sortOrder: 0,
        },
        {
          id: 'c-travel',
          technicalItemId: 't-travel',
          workTypeId: 'wt-travel',
          workTypeCode: 'crew_travel',
          workTypeName: 'Выезд',
          workTypeSnapshot: {},
          unit: 'HOUR',
          quantity: new Prisma.Decimal('8'),
          quantitySource: 'MANUAL',
          selectedRateId: hourRate.id,
          rateSnapshot: { pricePerUnit: '25' },
          contractorId: 'crew-2',
          contractorName: 'Подрядчик Б',
          pricePerUnit: new Prisma.Decimal('25'),
          currency: 'USD',
          lineCostTotal: new Prisma.Decimal('200'),
          priceStatus: INSTALLATION_PRICE_STATUS.CONFIGURED,
          fxFromCurrency: 'USD',
          fxToCurrency: 'USD',
          fxRate: new Prisma.Decimal(1),
          fxRateId: null,
          fxEffectiveFrom: null,
          convertedAmount: new Prisma.Decimal('200'),
          convertedCurrency: 'USD',
          sortOrder: 1,
        },
      ],
      ...overrides,
    };
  }

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
      title: 'Lead',
      qualification: { installationRequired: true },
    });
    prisma.installationCalculation.findUnique.mockResolvedValue(technical);
    prisma.installationContractorRate.findMany.mockResolvedValue([
      usdRate,
      hourRate,
      inactiveRate,
      eurRate,
    ]);
    prisma.currencyRate.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([{ id: head.id }, { id: director.id }]);
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.notification.create.mockResolvedValue({});
    prisma.installationCommercialCalculation.update.mockImplementation(
      async ({ data }) => {
        const createdItems = data?.items?.create;
        return {
          ...commercialDraft(),
          ...data,
          revision: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: Array.isArray(createdItems)
            ? createdItems.map((item: Record<string, unknown>, index: number) => ({
                ...commercialDraft().items[index],
                ...item,
                id: commercialDraft().items[index]?.id ?? `c-${index}`,
              }))
            : commercialDraft().items,
        };
      },
    );
    prisma.installationCommercialCalculation.create.mockImplementation(
      async ({ data }) => ({
        ...commercialDraft(),
        ...data,
        id: 'com-new',
        revision: data.revision ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: commercialDraft().items,
      }),
    );
  });

  it('lets HEAD approve installation without creating Quote or Deal', async () => {
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      commercialDraft({ status: InstallationCommercialStatus.READY_FOR_APPROVAL }),
    );
    const result = await service.approve(
      'lead-1',
      { expectedRevision: 1 },
      head,
    );
    expect(result.status).toBe(InstallationCommercialStatus.APPROVED);
    expect(result.quoteCreated).toBe(false);
    expect(result.dealCreated).toBe(false);
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('lets DIRECTOR approve installation without quotes:approve', async () => {
    expect(director.permissions).not.toContain('quotes:approve');
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      commercialDraft({ status: InstallationCommercialStatus.READY_FOR_APPROVAL }),
    );
    const result = await service.approve(
      'lead-1',
      { expectedRevision: 1 },
      director,
    );
    expect(result.approverRoleSnapshot).toBe(RoleName.DIRECTOR);
  });

  it('rejects ENGINEER and MANAGER approval', async () => {
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      commercialDraft({ status: InstallationCommercialStatus.READY_FOR_APPROVAL }),
    );
    await expectBusinessCode(
      service.approve('lead-1', { expectedRevision: 1 }, engineer),
      'FORBIDDEN',
    );
    await expectBusinessCode(
      service.approve('lead-1', { expectedRevision: 1 }, manager),
      'FORBIDDEN',
    );
  });

  it('does not treat a missing rate as zero cost', async () => {
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      commercialDraft({
        proposedCustomerAmount: new Prisma.Decimal('1'),
        items: [
          {
            ...commercialDraft().items[0],
            selectedRateId: null,
            pricePerUnit: null,
            lineCostTotal: null,
            priceStatus: INSTALLATION_PRICE_STATUS.NOT_CONFIGURED,
          },
        ],
      }),
    );
    await expectBusinessCode(
      service.submit('lead-1', { expectedRevision: 1 }, head),
      'INSTALLATION_COST_INCOMPLETE',
    );
  });

  it('does not add mixed currencies without FX', async () => {
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      commercialDraft({
        items: [
          commercialDraft().items[0],
          {
            ...commercialDraft().items[1],
            selectedRateId: eurRate.id,
            currency: 'EUR',
            lineCostTotal: new Prisma.Decimal('160'),
            fxRate: null,
            convertedAmount: null,
          },
        ],
      }),
    );
    await expectBusinessCode(
      service.submit('lead-1', { expectedRevision: 1 }, head),
      'INSTALLATION_FX_INCOMPLETE',
    );
  });

  it('flags stale technical basis after a later volume revision without changing the approved amount', async () => {
    const approved = commercialDraft({
      status: InstallationCommercialStatus.APPROVED,
      approvedCustomerAmount: new Prisma.Decimal('18000'),
      approvedCurrency: 'USD',
      approvedById: head.id,
      approvedAt: new Date('2026-09-22T05:32:18.482Z'),
      approverRoleSnapshot: RoleName.HEAD,
      installationCalculationRevision: 1,
    });
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      approved,
    );
    prisma.installationCalculation.findUnique.mockResolvedValue({
      ...technical,
      revision: 2,
    });
    const view = await service.getCurrent('lead-1', head);
    expect(view.staleTechnicalBasis).toBe(true);
    expect(view.calculation?.status).toBe(
      InstallationCommercialStatus.APPROVED,
    );
    expect(view.calculation?.approvedCustomerAmount).toBe('18000');
    expect(view.calculation?.approverRoleSnapshot).toBe(RoleName.HEAD);
  });

  it('keeps approved snapshots immutable and creates a new revision on reprice', async () => {
    const approved = commercialDraft({
      status: InstallationCommercialStatus.APPROVED,
      approvedCustomerAmount: new Prisma.Decimal('15000'),
      approvedCurrency: 'USD',
      approvedById: head.id,
      approvedAt: new Date('2026-09-22T00:00:00.000Z'),
      approverRoleSnapshot: RoleName.HEAD,
      installationCalculationRevision: 1,
    });
    prisma.installationCommercialCalculation.findFirst
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(approved);
    prisma.installationCalculation.findUnique.mockResolvedValue({
      ...technical,
      revision: 2,
    });
    await expectBusinessCode(
      service.patch(
        'lead-1',
        { expectedRevision: 1, proposedCustomerAmount: '1' },
        head,
      ),
      'INSTALLATION_COMMERCIAL_IMMUTABLE',
    );
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(approved);
    const repriced = await service.reprice('lead-1', {}, head);
    expect(prisma.installationCommercialCalculation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isCurrent: false } }),
    );
    expect(repriced.id).toBe('com-new');
    expect(approved.approvedCustomerAmount).toEqual(new Prisma.Decimal('15000'));
  });

  it('hides internal cost from the manager and shows approved customer amount', async () => {
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      commercialDraft({
        status: InstallationCommercialStatus.APPROVED,
        approvedCustomerAmount: new Prisma.Decimal('15000'),
        approvedCurrency: 'USD',
        approvedById: head.id,
        approvedAt: new Date(),
        approverRoleSnapshot: RoleName.HEAD,
      }),
    );
    const view = await service.getCurrent('lead-1', manager);
    expect(view.canReadCost).toBe(false);
    expect(view.rates).toEqual([]);
    expect(view.calculation?.approvedCustomerAmount).toBe('15000');
    expect(view.calculation?.items[0].pricePerUnit).toBeNull();
    expect(view.calculation?.costByCurrency).toEqual([]);
  });

  it('does not auto-assign a contractor when creating a commercial draft', async () => {
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(null);
    await service.createFromTechnical('lead-1', head);
    expect(prisma.installationCommercialCalculation.create).toHaveBeenCalled();
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('rejects applying an hourly rate to m² quantity', async () => {
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(
      commercialDraft(),
    );
    const patched = await service.patch(
      'lead-1',
      {
        expectedRevision: 1,
        selections: [{ itemId: 'c-hpl', rateId: hourRate.id }],
      },
      head,
    );
    const hpl = patched.items.find((item) => item.workTypeCode === 'hpl_install_m2');
    expect(hpl?.priceStatus).toBe(INSTALLATION_PRICE_STATUS.INCOMPATIBLE_UNIT);
    expect(hpl?.lineCostTotal).toBeNull();
  });

  it('does not copy live rate changes into an approved snapshot', async () => {
    const approved = commercialDraft({
      status: InstallationCommercialStatus.APPROVED,
      approvedCustomerAmount: new Prisma.Decimal('15000'),
      items: [
        {
          ...commercialDraft().items[0],
          rateSnapshot: { pricePerUnit: '12', rateId: usdRate.id },
          pricePerUnit: new Prisma.Decimal('12'),
        },
      ],
    });
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(approved);
    const view = await service.getCurrent('lead-1', head);
    expect(view.calculation?.items[0].pricePerUnit).toBe('12');
    expect(view.calculation?.approvedCustomerAmount).toBe('15000');
  });
});
