import { Prisma, QuoteComponentKind } from '@prisma/client';
import {
  customerFacingSnapshot,
  customerQuoteSubtitle,
  HPL_CUSTOMER_SUBTITLE,
  HPL_FACADE_CUSTOMER_SUBTITLE,
  HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE,
  HPL_INSTALLATION_CUSTOMER_SUBTITLE,
  positiveCustomerAmount,
  quoteDocumentExtraSections,
  quoteDocumentTotalsLines,
  snapshotContainsInternalLeak,
  sumAmountsByCurrency,
} from './quote-composition';

describe('quote composition totals', () => {
  it('does not blindly sum mixed currencies', () => {
    expect(
      sumAmountsByCurrency([
        { amount: '12000', currency: 'USD' },
        { amount: '8000', currency: 'EUR' },
        { amount: '15000', currency: 'USD' },
      ]),
    ).toEqual({
      byCurrency: [
        { currency: 'USD', amount: '27000.00' },
        { currency: 'EUR', amount: '8000.00' },
      ],
      grandTotal: null,
    });
  });

  it('returns a grand total only when every included amount shares one currency', () => {
    expect(
      sumAmountsByCurrency([
        { amount: '12000', currency: 'USD' },
        { amount: '8000', currency: 'usd' },
      ]),
    ).toEqual({
      byCurrency: [{ currency: 'USD', amount: '20000.00' }],
      grandTotal: { currency: 'USD', amount: '20000.00' },
    });
  });

  it('does not invent a total when an amount is missing', () => {
    expect(
      sumAmountsByCurrency([
        { amount: '12000', currency: 'USD' },
        { amount: null, currency: 'USD' },
      ]),
    ).toEqual({
      byCurrency: [{ currency: 'USD', amount: '12000.00' }],
      grandTotal: { currency: 'USD', amount: '12000.00' },
    });
  });
});

describe('quote composition customer snapshots', () => {
  it('keeps only customer-facing fields', () => {
    const snapshot = customerFacingSnapshot(QuoteComponentKind.INSTALLATION, {
      amount: '15000.00',
      currency: 'USD',
      description: 'Монтажные работы',
      workSummaries: [{ name: 'Монтаж HPL', unit: 'M2', quantity: '1000' }],
    });
    expect(snapshotContainsInternalLeak(snapshot)).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /purchasePrice|contractorName|pricePerUnit|cnyUsdRate|margin/,
    );
  });

  it('omits HPL from extra document sections so the existing table stays HPL-only', () => {
    const sections = quoteDocumentExtraSections([
      {
        kind: QuoteComponentKind.HPL,
        label: 'Поставка HPL-панелей',
        description: null,
        customerAmount: new Prisma.Decimal('12000'),
        currency: 'USD',
        customerSnapshot: customerFacingSnapshot(QuoteComponentKind.HPL, {
          amount: '12000.00',
          currency: 'USD',
        }),
      },
      {
        kind: QuoteComponentKind.FACADE,
        label: 'Фасадная подсистема',
        description: 'Фасадная подсистема',
        customerAmount: new Prisma.Decimal('8000'),
        currency: 'USD',
        customerSnapshot: customerFacingSnapshot(QuoteComponentKind.FACADE, {
          amount: '8000.00',
          currency: 'USD',
          description: 'Фасадная подсистема',
        }),
      },
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe('Фасадная подсистема');
    expect(sections[0]?.lines.join(' ')).toContain('8000.00 USD');
    expect(sections[0]?.lines.join(' ')).not.toMatch(/НДС 12%/);
  });

  it('shows a combined total only for a single customer currency', () => {
    const same = quoteDocumentTotalsLines([
      {
        kind: QuoteComponentKind.HPL,
        label: 'Поставка HPL-панелей',
        customerAmount: new Prisma.Decimal('12000'),
        currency: 'USD',
      },
      {
        kind: QuoteComponentKind.INSTALLATION,
        label: 'Монтажные работы',
        customerAmount: new Prisma.Decimal('15000'),
        currency: 'USD',
      },
    ]);
    expect(same.grandTotal).toBe('Итого: 27000.00 USD');
    expect(same.lines).toEqual([]);

    const mixed = quoteDocumentTotalsLines([
      {
        kind: QuoteComponentKind.HPL,
        label: 'Поставка HPL-панелей',
        customerAmount: new Prisma.Decimal('12000'),
        currency: 'USD',
      },
      {
        kind: QuoteComponentKind.FACADE,
        label: 'Фасадная подсистема',
        customerAmount: new Prisma.Decimal('8000'),
        currency: 'EUR',
      },
    ]);
    expect(mixed.grandTotal).toBeNull();
    expect(mixed.lines).toEqual([
      'Поставка HPL-панелей: 12000.00 USD',
      'Фасадная подсистема: 8000.00 EUR',
    ]);
  });

  it('keeps the HPL-only customer subtitle and reflects combined composition', () => {
    expect(customerQuoteSubtitle([])).toBe(HPL_CUSTOMER_SUBTITLE);
    expect(customerQuoteSubtitle([QuoteComponentKind.HPL])).toBe(
      HPL_CUSTOMER_SUBTITLE,
    );
    expect(
      customerQuoteSubtitle([
        QuoteComponentKind.HPL,
        QuoteComponentKind.FACADE,
      ]),
    ).toBe(HPL_FACADE_CUSTOMER_SUBTITLE);
    expect(
      customerQuoteSubtitle([
        QuoteComponentKind.HPL,
        QuoteComponentKind.INSTALLATION,
      ]),
    ).toBe(HPL_INSTALLATION_CUSTOMER_SUBTITLE);
    expect(
      customerQuoteSubtitle([
        QuoteComponentKind.HPL,
        QuoteComponentKind.FACADE,
        QuoteComponentKind.INSTALLATION,
      ]),
    ).toBe(HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE);
    expect(HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE).toContain(
      HPL_CUSTOMER_SUBTITLE,
    );
    expect(HPL_FACADE_CUSTOMER_SUBTITLE).not.toMatch(/НДС/);
    expect(HPL_INSTALLATION_CUSTOMER_SUBTITLE).not.toMatch(/НДС/);
    expect(HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE).not.toMatch(/НДС/);
  });

  it('treats a zero HPL amount as missing, not as a customer price', () => {
    expect(positiveCustomerAmount('0.00')).toBeNull();
    expect(positiveCustomerAmount('917.33')).toBe('917.33');
  });

  it('does not add extra totals for an HPL-only quote', () => {
    expect(
      quoteDocumentTotalsLines([
        {
          kind: QuoteComponentKind.HPL,
          label: 'Поставка HPL-панелей',
          customerAmount: new Prisma.Decimal('12000'),
          currency: 'USD',
        },
      ]),
    ).toEqual({ lines: [], grandTotal: null });
  });
});
