import { HttpStatus } from '@nestjs/common';
import {
  FacadeCommercialStatus,
  InstallationCommercialStatus,
  Prisma,
  QuoteComponentKind,
} from '@prisma/client';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { QuoteCompositionService } from './quote-composition.service';
import { QUOTE_STALE_COMPONENT_ACK_REQUIRED } from './quote-composition';

describe('QuoteCompositionService', () => {
  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    firstName: 'Head',
    lastName: 'Test',
    roles: ['HEAD'],
    permissions: ['quotes:read', 'quotes:read_all', 'quotes:approve'],
  };

  const prisma = {
    lead: { findFirst: jest.fn() },
    facadeCommercialCalculation: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    installationCommercialCalculation: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    panelQuoteComponentSnapshot: { createMany: jest.fn() },
  };

  const tx = prisma;
  let service: QuoteCompositionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QuoteCompositionService(prisma as never);
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      ownerId: 'manager-id',
      qualification: {
        ventFacadeKitRequired: true,
        installationRequired: true,
      },
      calculationRequests: [{ id: 'request-id', status: 'submitted' }],
      calculationSessions: [
        {
          id: 'calc-id',
          status: 'finalized',
          totalAmount: new Prisma.Decimal('12000'),
          displayCurrency: 'USD',
        },
      ],
    });
  });

  it('does not mark unapproved facade or installation as includeable', async () => {
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue({
      id: 'facade-id',
      status: FacadeCommercialStatus.DRAFT,
      revision: 1,
      facadeCalculationRevision: 1,
      approvedCustomerAmount: new Prisma.Decimal('8000'),
      approvedCurrency: 'USD',
      facadeCalculation: { revision: 1 },
    });
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue({
      id: 'install-id',
      status: InstallationCommercialStatus.READY_FOR_APPROVAL,
      revision: 1,
      installationCalculationRevision: 1,
      approvedCustomerAmount: null,
      approvedCurrency: null,
      installationCalculation: { revision: 1 },
      items: [],
    });

    const preview = await service.preview('lead-id', head);
    expect(preview.components.find((item) => item.kind === 'FACADE')?.includeInQuote).toBe(
      false,
    );
    expect(
      preview.components.find((item) => item.kind === 'INSTALLATION')?.includeInQuote,
    ).toBe(false);
    expect(
      preview.components.find((item) => item.kind === 'FACADE')?.readiness,
    ).toBe('AWAITING_APPROVAL');
    expect(JSON.stringify(preview)).not.toMatch(/"sourceId"/);
  });

  it('does not present a zero HPL session total as an approved customer price', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      ownerId: 'manager-id',
      qualification: {
        ventFacadeKitRequired: false,
        installationRequired: false,
      },
      calculationRequests: [{ id: 'request-id', status: 'submitted' }],
      calculationSessions: [
        {
          id: 'calc-id',
          status: 'quoted',
          totalAmount: new Prisma.Decimal('0'),
          displayCurrency: 'USD',
        },
      ],
    });
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue(null);
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(null);

    const preview = await service.preview('lead-id', head);
    const hpl = preview.components.find((item) => item.kind === 'HPL');
    expect(hpl?.readiness).toBe('READY');
    expect(hpl?.includeInQuote).toBe(true);
    expect(hpl?.amount).toBeNull();
    expect(hpl?.warning).toBe('Цена HPL ещё не утверждена');
    expect(preview.totals.grandTotal).toBeNull();
  });

  it('requires explicit acknowledgement before snapshotting a stale approved amount', async () => {
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue({
      id: 'facade-id',
      status: FacadeCommercialStatus.APPROVED,
      revision: 2,
      facadeCalculationRevision: 1,
      approvedCustomerAmount: new Prisma.Decimal('8000'),
      approvedCurrency: 'USD',
      facadeCalculation: { revision: 4 },
    });
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue(null);

    await expect(
      service.attachToQuote(
        tx as never,
        {
          id: 'quote-id',
          leadId: 'lead-id',
          calculationId: 'calc-id',
          requestId: 'request-id',
          totalAmount: new Prisma.Decimal('12000'),
          displayCurrency: 'USD',
          items: [],
        },
        {},
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: QUOTE_STALE_COMPONENT_ACK_REQUIRED,
        statusCode: HttpStatus.CONFLICT,
      }),
    });
    expect(prisma.panelQuoteComponentSnapshot.createMany).not.toHaveBeenCalled();
  });

  it('snapshots approved customer amounts after stale acknowledgement', async () => {
    prisma.facadeCommercialCalculation.findFirst.mockResolvedValue({
      id: 'facade-id',
      status: FacadeCommercialStatus.APPROVED,
      revision: 2,
      facadeCalculationRevision: 1,
      approvedCustomerAmount: new Prisma.Decimal('8000'),
      approvedCurrency: 'USD',
      facadeCalculation: { revision: 4 },
    });
    prisma.installationCommercialCalculation.findFirst.mockResolvedValue({
      id: 'install-id',
      status: InstallationCommercialStatus.APPROVED,
      revision: 3,
      installationCalculationRevision: 2,
      approvedCustomerAmount: new Prisma.Decimal('15000'),
      approvedCurrency: 'USD',
      installationCalculation: { revision: 2 },
      items: [
        {
          workTypeName: 'Монтаж HPL',
          unit: 'M2',
          quantity: new Prisma.Decimal('1000'),
        },
      ],
    });
    prisma.panelQuoteComponentSnapshot.createMany.mockResolvedValue({ count: 3 });
    prisma.facadeCommercialCalculation.updateMany.mockResolvedValue({ count: 1 });
    prisma.installationCommercialCalculation.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.attachToQuote(
      tx as never,
      {
        id: 'quote-id',
        leadId: 'lead-id',
        calculationId: 'calc-id',
        requestId: 'request-id',
        totalAmount: new Prisma.Decimal('12000'),
        displayCurrency: 'USD',
        items: [],
      },
      { acknowledgeStaleComponents: true },
    );

    const rows = prisma.panelQuoteComponentSnapshot.createMany.mock.calls[0][0]
      .data as Array<{ kind: QuoteComponentKind; customerSnapshot: object }>;
    expect(rows.map((row) => row.kind)).toEqual([
      QuoteComponentKind.HPL,
      QuoteComponentKind.FACADE,
      QuoteComponentKind.INSTALLATION,
    ]);
    expect(JSON.stringify(rows)).not.toMatch(
      /purchasePrice|contractorName|pricePerUnit|cnyUsdRate/,
    );
  });

  it('preserves HPL when a combined component is present', () => {
    expect(
      service.shouldPreserveHplSnapshot([QuoteComponentKind.HPL], [
        QuoteComponentKind.INSTALLATION,
      ]),
    ).toBe(true);
    expect(service.shouldPreserveHplSnapshot([QuoteComponentKind.HPL], [])).toBe(
      false,
    );
  });

  it('does not treat DIRECTOR quote approval as part of composition', () => {
    const director: CurrentUser = {
      ...head,
      id: 'director-id',
      roles: ['DIRECTOR'],
      permissions: ['quotes:read', 'quotes:read_all'],
    };
    expect(director.permissions).not.toContain('quotes:approve');
  });
});
