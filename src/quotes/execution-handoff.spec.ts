import { Prisma, QuoteComponentKind } from '@prisma/client';
import {
  createExecutionHandoff,
  readExecutionHandoff,
} from './execution-handoff';

describe('execution handoff basis', () => {
  it('freezes customer amounts and HPL FX from the accepted quote', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'deal-1' }]),
      dealExecutionHandoff: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { revision: null } }),
        create: jest.fn().mockResolvedValue({ id: 'handoff-1' }),
        update: jest.fn(),
      },
      dealExecutionComponent: { createMany: jest.fn() },
      activity: { create: jest.fn() },
    };

    await createExecutionHandoff(tx as never, {
      dealId: 'deal-1',
      leadId: 'lead-1',
      acceptedAt: new Date('2026-09-24T10:00:00.000Z'),
      acceptedById: 'manager-1',
      acceptanceNote: null,
      quote: {
        id: 'quote-1',
        versionNumber: 1,
        totalAmount: new Prisma.Decimal('1200'),
        displayCurrency: 'USD',
        cnyUsdRate: new Prisma.Decimal('0.14000000'),
        sellingCoefficient: new Prisma.Decimal('2'),
        items: [
          {
            panelTypeName: 'HPL',
            panelSizeName: '1220×2440',
            areaM2: new Prisma.Decimal('2.9768'),
            thicknessMm: new Prisma.Decimal('10'),
            sheetsCount: 10,
            pricePerM2: new Prisma.Decimal('40'),
            totalPrice: new Prisma.Decimal('1200'),
            currencyCode: 'USD',
          },
        ],
        componentSnapshots: [
          {
            kind: QuoteComponentKind.HPL,
            label: 'HPL',
            customerAmount: new Prisma.Decimal('1200'),
            currency: 'USD',
            customerSnapshot: { amount: '1200' },
          },
        ],
      },
    });

    const basis = tx.dealExecutionComponent.createMany.mock.calls[0][0]
      .data[0].basis as {
      cnyUsdRate: string;
      customerAmount: string;
      items: Array<{ pricePerM2: string }>;
    };
    expect(basis.cnyUsdRate).toBe('0.14');
    expect(basis.customerAmount).toBe('1200');
    expect(basis.items[0].pricePerM2).toBe('40');
    expect(JSON.stringify(basis)).not.toContain('supplierPrice');
  });

  it('flags technical drift without changing the accepted revision', async () => {
    const prisma = {
      dealExecutionHandoff: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'handoff-1',
            dealId: 'deal-1',
            leadId: 'lead-1',
            quoteId: 'quote-1',
            quoteVersion: 1,
            acceptedAt: new Date('2026-09-24T10:00:00.000Z'),
            acceptanceNote: null,
            status: 'ACTIVE',
            revision: 1,
            acceptedBy: { id: 'manager-1', firstName: 'A', lastName: 'B' },
            quote: {
              id: 'quote-1',
              versionNumber: 1,
              finalizedAt: new Date(),
              status: 'approved',
              cnyUsdRate: new Prisma.Decimal('0.14'),
              displayCurrency: 'USD',
              totalAmount: new Prisma.Decimal('1200'),
            },
            components: [
              {
                kind: QuoteComponentKind.FACADE,
                label: 'Подсистема',
                required: true,
                status: 'PENDING',
                sourceRevision: 2,
                technicalRevision: 4,
                customerAmount: new Prisma.Decimal('500'),
                currency: 'USD',
              },
              {
                kind: QuoteComponentKind.INSTALLATION,
                label: 'Монтаж',
                required: true,
                status: 'PENDING',
                sourceRevision: 1,
                technicalRevision: 3,
                customerAmount: new Prisma.Decimal('300'),
                currency: 'USD',
              },
            ],
          },
        ]),
      },
      facadeSubsystemCalculation: {
        findFirst: jest.fn().mockResolvedValue({ revision: 5 }),
      },
      installationCalculation: {
        findFirst: jest.fn().mockResolvedValue({ revision: 3 }),
      },
    };

    const view = await readExecutionHandoff(prisma as never, 'lead-1');
    const facade = view.active?.components.find(
      (component) => component.kind === QuoteComponentKind.FACADE,
    );
    const installation = view.active?.components.find(
      (component) => component.kind === QuoteComponentKind.INSTALLATION,
    );
    expect(facade?.changedAfterAcceptance).toBe(true);
    expect(facade?.technicalRevision).toBe(4);
    expect(facade?.customerAmount).toBe('500');
    expect(installation?.changedAfterAcceptance).toBe(false);
    expect(installation?.technicalRevision).toBe(3);
  });
});
