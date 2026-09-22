/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  FacadeCalculationStatus,
  FacadeCommercialStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { ROLE_PERMISSION_SLUGS } from '../../../../auth/rbac/permission-matrix';
import { FacadeCommercialService } from './facade-commercial.service';
import { FACADE_PRICE_STATUS } from './facade-pricing.constants';

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

describe('FacadeCommercialService', () => {
  const prisma = {
    lead: { findFirst: jest.fn() },
    facadeSubsystemCalculation: { findUnique: jest.fn() },
    facadeCommercialCalculation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    facadeCommercialCalculationItem: { deleteMany: jest.fn() },
    facadeMaterialSupplierOffer: { findMany: jest.fn() },
    currencyRate: { findFirst: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    notification: { create: jest.fn() },
    user: { findMany: jest.fn() },
    panelQuote: { create: jest.fn() },
    deal: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new FacadeCommercialService(prisma as never);
  const head = userFor(RoleName.HEAD);
  const director = userFor(RoleName.DIRECTOR);
  const engineer = userFor(RoleName.ENGINEER);
  const manager = userFor(RoleName.MANAGER, 'manager-1');

  const technical = {
    id: 'tech-1',
    leadId: 'lead-1',
    revision: 1,
    status: FacadeCalculationStatus.CALCULATED,
    claddingAreaM2: new Prisma.Decimal('1000'),
    config: { code: 'HPL_FACADE_BASE_1220_3050' },
    normSet: { code: 'HPL_FACADE_BASE_1220_3050_V1' },
    items: [
      {
        id: 't-hpl',
        materialId: 'mat-hpl',
        materialCode: 'hpl_panel_1220_3050',
        materialName: 'HPL-панель',
        category: 'HPL',
        unit: 'M2',
        specSnapshot: {},
        finalQty: new Prisma.Decimal('1060'),
        sortOrder: 1,
      },
      {
        id: 't-mem',
        materialId: 'mat-mem',
        materialCode: 'membrane',
        materialName: 'Мембрана',
        category: 'MEMBRANE',
        unit: 'M2',
        specSnapshot: {},
        finalQty: new Prisma.Decimal('1160'),
        sortOrder: 2,
      },
    ],
  };

  const offerUsd = {
    id: 'offer-usd',
    materialId: 'mat-mem',
    supplierId: 'sup-1',
    purchasePrice: new Prisma.Decimal('4.5'),
    currency: 'USD',
    unit: 'M2',
    validFrom: new Date('2026-01-01'),
    validTo: null,
    isActive: true,
    availability: null,
    leadTimeDays: null,
    supplierSku: null,
    note: null,
    supplier: { id: 'sup-1', code: 'qa', name: 'QA Supplier' },
    material: { code: 'membrane' },
  };

  const offerCny = {
    ...offerUsd,
    id: 'offer-cny',
    purchasePrice: new Prisma.Decimal('30'),
    currency: 'CNY',
    isActive: true,
    supplier: { id: 'sup-2', code: 'cn', name: 'CN Supplier' },
  };

  const offerInactive = {
    ...offerUsd,
    id: 'offer-off',
    isActive: false,
    supplier: { id: 'sup-3', code: 'old', name: 'Old' },
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
      title: 'Lead',
      qualification: { ventFacadeKitRequired: true },
    });
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue(technical);
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.notification.create.mockResolvedValue({});
    prisma.user.findMany.mockResolvedValue([{ id: head.id }, { id: director.id }]);
    prisma.facadeMaterialSupplierOffer.findMany.mockResolvedValue([
      offerUsd,
      offerCny,
      offerInactive,
    ]);
    prisma.currencyRate.findFirst.mockResolvedValue({
      id: 'fx-1',
      rate: new Prisma.Decimal('0.14'),
      effectiveFrom: new Date('2026-01-01'),
    });
    prisma.facadeCommercialCalculationItem.deleteMany.mockResolvedValue({
      count: 0,
    });
  });

  function draftFromCreate(overrides: Record<string, unknown> = {}) {
    return {
      id: 'comm-1',
      leadId: 'lead-1',
      facadeCalculationId: 'tech-1',
      facadeCalculationRevision: 1,
      revision: 1,
      isCurrent: true,
      status: FacadeCommercialStatus.DRAFT,
      technicalSnapshot: {
        claddingAreaM2: '1000',
        configCode: 'HPL_FACADE_BASE_1220_3050',
        normSetCode: 'HPL_FACADE_BASE_1220_3050_V1',
      },
      procurementIncomplete: true,
      procurementByCurrency: [],
      fxSnapshots: [],
      proposedCustomerAmount: null,
      proposedCurrency: null,
      approvedCustomerAmount: null,
      approvedCurrency: null,
      approvedById: null,
      approvedAt: null,
      approverRoleSnapshot: null,
      commercialNote: null,
      quoteCreated: false,
      dealCreated: false,
      createdAt: new Date('2026-09-21T00:00:00.000Z'),
      updatedAt: new Date('2026-09-21T00:00:00.000Z'),
      items: [
        {
          id: 'c-hpl',
          materialCode: 'hpl_panel_1220_3050',
          materialName: 'HPL-панель',
          category: 'HPL',
          unit: 'M2',
          finalQty: new Prisma.Decimal('1060'),
          excludedFromSubsystemCommercialCost: true,
          selectedOfferId: null,
          offerSnapshot: null,
          purchasePrice: null,
          purchaseCurrency: null,
          linePurchaseTotal: null,
          priceStatus: FACADE_PRICE_STATUS.EXCLUDED,
          fxRate: null,
          sortOrder: 1,
        },
        {
          id: 'c-mem',
          materialCode: 'membrane',
          materialName: 'Мембрана',
          category: 'MEMBRANE',
          unit: 'M2',
          finalQty: new Prisma.Decimal('1160'),
          excludedFromSubsystemCommercialCost: false,
          selectedOfferId: null,
          offerSnapshot: null,
          purchasePrice: null,
          purchaseCurrency: null,
          linePurchaseTotal: null,
          priceStatus: FACADE_PRICE_STATUS.NOT_CONFIGURED,
          fxRate: null,
          sortOrder: 2,
        },
      ],
      ...overrides,
    };
  }

  it('creates a commercial snapshot that excludes the HPL 1.06 reference', async () => {
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(null);
    prisma.facadeCommercialCalculation.create.mockImplementation(
      async ({ data }) => {
        expect(data.quoteCreated).toBe(false);
        expect(data.dealCreated).toBe(false);
        const items = data.items.create as Array<{
          materialCode: string;
          excludedFromSubsystemCommercialCost: boolean;
          priceStatus: string;
        }>;
        const hpl = items.find((item) => item.materialCode === 'hpl_panel_1220_3050');
        expect(hpl?.excludedFromSubsystemCommercialCost).toBe(true);
        expect(hpl?.priceStatus).toBe(FACADE_PRICE_STATUS.EXCLUDED);
        return {
          ...draftFromCreate(),
          items: items.map((item, index) => ({
            ...item,
            id: `c-${index}`,
            finalQty: new Prisma.Decimal(
              item.materialCode === 'hpl_panel_1220_3050' ? '1060' : '1160',
            ),
          })),
        };
      },
    );

    const result = await service.createFromTechnical('lead-1', head);
    expect(result.quoteCreated).toBe(false);
    expect(result.dealCreated).toBe(false);
    expect(prisma.panelQuote.create).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('does not treat a missing offer as zero and blocks READY', async () => {
    const current = draftFromCreate();
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    await expectBusinessCode(
      service.submit('lead-1', { expectedRevision: 1 }, head),
      'FACADE_PROCUREMENT_INCOMPLETE',
    );
  });

  it('computes finalQty × purchasePrice exactly and keeps currencies separate', async () => {
    const current = draftFromCreate({ revision: 1 });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    prisma.facadeCommercialCalculation.update.mockImplementation(
      async ({ data }) => {
        const created = data.items.create as Array<{
          linePurchaseTotal: Prisma.Decimal | null;
          purchaseCurrency: string | null;
          materialCode: string;
        }>;
        const mem = created.find((item) => item.materialCode === 'membrane');
        expect(mem?.linePurchaseTotal?.toFixed()).toBe('5220');
        expect(mem?.purchaseCurrency).toBe('USD');
        expect(data.procurementByCurrency).toEqual([
          { currency: 'USD', amount: '5220' },
        ]);
        return {
          ...current,
          ...data,
          revision: 2,
          items: created.map((item, index) => ({
            id: index === 0 ? 'c-hpl' : 'c-mem',
            ...item,
            excludedFromSubsystemCommercialCost: item.materialCode === 'hpl_panel_1220_3050',
            finalQty: new Prisma.Decimal(
              item.materialCode === 'hpl_panel_1220_3050' ? '1060' : '1160',
            ),
            priceStatus:
              item.materialCode === 'hpl_panel_1220_3050'
                ? FACADE_PRICE_STATUS.EXCLUDED
                : FACADE_PRICE_STATUS.CONFIGURED,
            offerSnapshot: null,
            fxRate: null,
            sortOrder: index + 1,
          })),
        };
      },
    );

    await service.patch(
      'lead-1',
      {
        expectedRevision: 1,
        selections: [{ itemId: 'c-mem', offerId: 'offer-usd' }],
        proposedCurrency: 'USD',
      },
      head,
    );
  });

  it('rejects an inactive offer selection', async () => {
    const current = draftFromCreate();
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    prisma.facadeCommercialCalculation.update.mockImplementation(
      async ({ data }) => {
        const created = data.items.create as Array<{
          selectedOfferId: string | null;
          priceStatus: string;
          materialCode: string;
        }>;
        const mem = created.find((item) => item.materialCode === 'membrane');
        expect(mem?.selectedOfferId).toBeNull();
        expect(mem?.priceStatus).toBe(FACADE_PRICE_STATUS.NOT_CONFIGURED);
        return { ...current, revision: 2, items: current.items };
      },
    );
    await service.patch(
      'lead-1',
      {
        expectedRevision: 1,
        selections: [{ itemId: 'c-mem', offerId: 'offer-off' }],
      },
      head,
    );
  });

  it('blocks READY when FX for a foreign offer currency is missing', async () => {
    prisma.currencyRate.findFirst.mockResolvedValue(null);
    const current = draftFromCreate({
      proposedCustomerAmount: new Prisma.Decimal('8000'),
      proposedCurrency: 'USD',
      items: [
        draftFromCreate().items[0],
        {
          ...draftFromCreate().items[1],
          selectedOfferId: 'offer-cny',
          purchasePrice: new Prisma.Decimal('30'),
          purchaseCurrency: 'CNY',
          linePurchaseTotal: new Prisma.Decimal('34800'),
          priceStatus: FACADE_PRICE_STATUS.CONFIGURED,
          fxRate: null,
        },
      ],
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    await expectBusinessCode(
      service.submit('lead-1', { expectedRevision: 1 }, head),
      'FACADE_FX_INCOMPLETE',
    );
  });

  it('allows HEAD to approve and stores approver snapshot', async () => {
    const current = draftFromCreate({
      status: FacadeCommercialStatus.READY_FOR_APPROVAL,
      proposedCustomerAmount: new Prisma.Decimal('8000'),
      proposedCurrency: 'USD',
      procurementIncomplete: false,
      items: [
        draftFromCreate().items[0],
        {
          ...draftFromCreate().items[1],
          selectedOfferId: 'offer-usd',
          purchasePrice: new Prisma.Decimal('4.5'),
          purchaseCurrency: 'USD',
          linePurchaseTotal: new Prisma.Decimal('5220'),
          priceStatus: FACADE_PRICE_STATUS.CONFIGURED,
          fxRate: null,
        },
      ],
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    prisma.facadeCommercialCalculation.update.mockImplementation(
      async ({ data }) => ({
        ...current,
        ...data,
        revision: 2,
        approvedAt: data.approvedAt,
        items: current.items,
      }),
    );

    const result = await service.approve(
      'lead-1',
      { expectedRevision: 1 },
      head,
    );
    expect(result.status).toBe(FacadeCommercialStatus.APPROVED);
    expect(result.approvedById).toBe(head.id);
    expect(result.approverRoleSnapshot).toBe(RoleName.HEAD);
    expect(result.approvedCustomerAmount).toBe('8000');
    expect(result.quoteCreated).toBe(false);
  });

  it('allows DIRECTOR to approve without granting quotes:approve', async () => {
    expect(director.permissions).not.toContain('quotes:approve');
    const current = draftFromCreate({
      status: FacadeCommercialStatus.READY_FOR_APPROVAL,
      proposedCustomerAmount: new Prisma.Decimal('9100'),
      proposedCurrency: 'USD',
      items: [
        draftFromCreate().items[0],
        {
          ...draftFromCreate().items[1],
          selectedOfferId: 'offer-usd',
          purchasePrice: new Prisma.Decimal('4.5'),
          purchaseCurrency: 'USD',
          linePurchaseTotal: new Prisma.Decimal('5220'),
          priceStatus: FACADE_PRICE_STATUS.CONFIGURED,
        },
      ],
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    prisma.facadeCommercialCalculation.update.mockImplementation(
      async ({ data }) => ({
        ...current,
        ...data,
        revision: 2,
        items: current.items,
      }),
    );
    const result = await service.approve(
      'lead-1',
      { expectedRevision: 1 },
      director,
    );
    expect(result.approverRoleSnapshot).toBe(RoleName.DIRECTOR);
    expect(result.approvedCustomerAmount).toBe('9100');
  });

  it('returns 403 for ENGINEER and MANAGER approval', async () => {
    await expectBusinessCode(
      service.approve('lead-1', { expectedRevision: 1 }, engineer),
      'FORBIDDEN',
    );
    await expectBusinessCode(
      service.approve('lead-1', { expectedRevision: 1 }, manager),
      'FORBIDDEN',
    );
  });

  it('does not silently replace the first approver', async () => {
    const current = draftFromCreate({
      status: FacadeCommercialStatus.APPROVED,
      approvedById: head.id,
      approvedAt: new Date('2026-09-21T10:00:00.000Z'),
      proposedCustomerAmount: new Prisma.Decimal('8000'),
      proposedCurrency: 'USD',
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    await expectBusinessCode(
      service.approve('lead-1', { expectedRevision: 1 }, director),
      'FACADE_COMMERCIAL_ALREADY_APPROVED',
    );
  });

  it('keeps an approved snapshot immutable when the live offer price changes', async () => {
    const snapshotPrice = '4.5';
    const current = draftFromCreate({
      status: FacadeCommercialStatus.APPROVED,
      approvedCustomerAmount: new Prisma.Decimal('8000'),
      approvedCurrency: 'USD',
      approvedById: head.id,
      items: [
        draftFromCreate().items[0],
        {
          ...draftFromCreate().items[1],
          selectedOfferId: 'offer-usd',
          purchasePrice: new Prisma.Decimal(snapshotPrice),
          offerSnapshot: { purchasePrice: snapshotPrice, currency: 'USD' },
          linePurchaseTotal: new Prisma.Decimal('5220'),
          priceStatus: FACADE_PRICE_STATUS.CONFIGURED,
        },
      ],
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    prisma.facadeMaterialSupplierOffer.findMany.mockResolvedValue([
      { ...offerUsd, purchasePrice: new Prisma.Decimal('99') },
    ]);
    const view = await service.getCurrent('lead-1', head);
    const mem = view.calculation?.items.find(
      (item) => item.materialCode === 'membrane',
    );
    expect(mem?.purchasePrice).toBe(new Prisma.Decimal(snapshotPrice).toFixed());
    await expectBusinessCode(
      service.patch(
        'lead-1',
        { expectedRevision: 1, proposedCustomerAmount: '1' },
        head,
      ),
      'FACADE_COMMERCIAL_IMMUTABLE',
    );
  });

  it('does not mutate an approved commercial when technical revision changes', async () => {
    const current = draftFromCreate({
      status: FacadeCommercialStatus.APPROVED,
      facadeCalculationRevision: 1,
      approvedCustomerAmount: new Prisma.Decimal('8000'),
      approvedCurrency: 'USD',
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    prisma.facadeSubsystemCalculation.findUnique.mockResolvedValue({
      ...technical,
      revision: 2,
      claddingAreaM2: new Prisma.Decimal('1200'),
    });
    const view = await service.getCurrent('lead-1', head);
    expect(view.staleTechnicalBasis).toBe(true);
    expect(view.calculation?.approvedCustomerAmount).toBe('8000');
    expect(view.calculation?.facadeCalculationRevision).toBe(1);
    expect(view.calculation?.claddingAreaM2).toBe('1000');
  });

  it('repricing creates a new revision instead of patching approved', async () => {
    const current = draftFromCreate({
      status: FacadeCommercialStatus.APPROVED,
      revision: 3,
      isCurrent: true,
    });
    prisma.facadeCommercialCalculation.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ revision: 3 });
    prisma.facadeCommercialCalculation.update.mockResolvedValue({
      ...current,
      isCurrent: false,
    });
    prisma.facadeCommercialCalculation.create.mockImplementation(
      async ({ data }) => ({
        ...draftFromCreate({
          id: 'comm-2',
          revision: data.revision,
          status: FacadeCommercialStatus.DRAFT,
          isCurrent: true,
        }),
        items: data.items.create,
      }),
    );
    const created = await service.reprice('lead-1', { expectedRevision: 3 }, head);
    expect(created.id).toBe('comm-2');
    expect(created.status).toBe(FacadeCommercialStatus.DRAFT);
    expect(prisma.facadeCommercialCalculation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isCurrent: false }),
      }),
    );
  });

  it('hides procurement from MANAGER and shows approved customer amount', async () => {
    const current = draftFromCreate({
      status: FacadeCommercialStatus.APPROVED,
      approvedCustomerAmount: new Prisma.Decimal('8000'),
      approvedCurrency: 'USD',
      approvedById: head.id,
      items: [
        draftFromCreate().items[0],
        {
          ...draftFromCreate().items[1],
          purchasePrice: new Prisma.Decimal('4.5'),
          linePurchaseTotal: new Prisma.Decimal('5220'),
          priceStatus: FACADE_PRICE_STATUS.CONFIGURED,
        },
      ],
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    const view = await service.getCurrent('lead-1', manager);
    expect(view.canApprove).toBe(false);
    expect(view.canReadPurchase).toBe(false);
    expect(view.calculation?.approvedCustomerAmount).toBe('8000');
    expect(view.calculation?.items[1].purchasePrice).toBeNull();
    expect(view.calculation?.procurementByCurrency).toEqual([]);
  });

  it('forbids ENGINEER from reading commercial pricing', async () => {
    await expectBusinessCode(service.getCurrent('lead-1', engineer), 'FORBIDDEN');
  });

  it('snapshots FX and does not use a live rate after approval', async () => {
    const current = draftFromCreate({
      status: FacadeCommercialStatus.APPROVED,
      proposedCurrency: 'USD',
      approvedCustomerAmount: new Prisma.Decimal('8000'),
      approvedCurrency: 'USD',
      fxSnapshots: [
        { fromCurrency: 'CNY', toCurrency: 'USD', rate: '0.14', rateId: 'fx-1' },
      ],
      items: [
        draftFromCreate().items[0],
        {
          ...draftFromCreate().items[1],
          purchaseCurrency: 'CNY',
          fxRate: new Prisma.Decimal('0.14'),
          fxFromCurrency: 'CNY',
          fxToCurrency: 'USD',
          linePurchaseTotal: new Prisma.Decimal('34800'),
          priceStatus: FACADE_PRICE_STATUS.CONFIGURED,
        },
      ],
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(current);
    prisma.currencyRate.findFirst.mockResolvedValue({
      id: 'fx-2',
      rate: new Prisma.Decimal('0.99'),
      effectiveFrom: new Date(),
    });
    const view = await service.getCurrent('lead-1', head);
    expect(view.calculation?.items[1].fxRate).toBe(
      new Prisma.Decimal('0.14').toFixed(),
    );
    expect(view.calculation?.fxSnapshots).toEqual([
      { fromCurrency: 'CNY', toCurrency: 'USD', rate: '0.14', rateId: 'fx-1' },
    ]);
  });
});
