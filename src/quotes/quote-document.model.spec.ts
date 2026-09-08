import { Prisma } from '@prisma/client';
import {
  buildQuoteDocumentModel,
  customerDocumentMetaViolations,
  CUSTOMER_QUOTE_SUBTITLE,
  CUSTOMER_QUOTE_TITLE,
  formatQuoteDayRange,
  formatQuoteDocumentDate,
  formatQuoteRuDate,
  quoteCustomerDocumentIssues,
  quoteOfferHeading,
  QUOTE_PRICE_HEADER,
} from './quote-document.model';

describe('quote document snapshot mapping', () => {
  const snapshot = {
    id: 'quote-1',
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    documentDate: new Date('2026-08-14T00:00:00.000Z'),
    validUntil: new Date('2026-08-20T00:00:00.000Z'),
    totalAmount: new Prisma.Decimal('720000'),
    displayCurrency: 'UZS',
    deliveryCost: null,
    clientComment: null,
    commercialNote: 'Цена указана с учётом 1 контейнера CIP Tashkent.',
    productionDaysFrom: 10,
    productionDaysTo: 20,
    deliveryDaysFrom: 14,
    deliveryDaysTo: 25,
    lead: { title: 'Lead', client: { name: 'Клиент' } },
    items: [
      {
        panelTypeCode: 'interior',
        panelSizeName: '1220 × 2440',
        thicknessMm: 12,
        sheetsCount: 2,
        areaM2: new Prisma.Decimal('2.9768'),
        requiredAreaM2: new Prisma.Decimal('5.95'),
        pricePerM2: new Prisma.Decimal('576000'),
      },
    ],
  };

  it('does not expose internal Quote version or identifier in the document model', () => {
    const identified = {
      ...snapshot,
      id: '58e6f812-aaaa-4bbb-8ccc-ddddeeeeffff',
      versionNumber: 1,
    };
    const model = buildQuoteDocumentModel(identified);
    const serialized = JSON.stringify(model);

    expect(model).not.toHaveProperty('quoteReferenceLine');
    expect(serialized).not.toContain('КП v1');
    expect(serialized).not.toContain(identified.id);
    expect(serialized).not.toContain(identified.id.slice(0, 8));
    expect(customerDocumentMetaViolations(serialized, identified)).toEqual([]);
    expect(identified.versionNumber).toBe(1);
  });

  it('flags customer-facing version labels and ids', () => {
    const quote = {
      ...snapshot,
      id: '58e6f812-aaaa-4bbb-8ccc-ddddeeeeffff',
      versionNumber: 1,
    };

    expect(
      customerDocumentMetaViolations(
        `${CUSTOMER_QUOTE_TITLE}\nКП v1 · 58e6f812 · ${CUSTOMER_QUOTE_SUBTITLE}`,
        quote,
      ),
    ).toEqual(
      expect.arrayContaining([
        'quote-version-label',
        'quote-short-id',
        'quote-version-number',
      ]),
    );
    expect(
      customerDocumentMetaViolations(
        `${CUSTOMER_QUOTE_TITLE}\n${CUSTOMER_QUOTE_SUBTITLE}`,
        quote,
      ),
    ).toEqual([]);
  });

  it('renders КП table values from the Quote snapshot, not catalog defaults', () => {
    const model = buildQuoteDocumentModel(snapshot);

    expect(model.itemRows[0]).toEqual([
      '1220 × 2440',
      '12 мм',
      ' 5,95',
      '576 000 сум',
      '10-20 дней',
      '14-25 дней',
    ]);
    expect(model.commercialNote).toBe(
      'Цена указана с учётом 1 контейнера CIP Tashkent.',
    );
    expect(model.validUntilBullet).toBe(
      '• Все цены действительны до  20 августа.',
    );
    expect(model.documentDateLine).toBe('Дата: 18 Августа  2026 г.');
    expect(model.documentDateLine).not.toContain('14 Августа');
    expect(model.offerHeading).toBe(
      'Предложение на поставку интерьерных панелей',
    );
    expect(model.priceHeader).toBe(QUOTE_PRICE_HEADER);
    expect(model.priceHeader).toBe('Цена за м² с НДС 12%');
    expect(model.priceHeader).not.toBe('Цена за м²');
  });

  it('renders custom panel dimensions from the snapshot, not the catalog size name', () => {
    const model = buildQuoteDocumentModel({
      ...snapshot,
      items: [
        {
          ...snapshot.items[0],
          panelSizeName: '1220 × 2440',
          customWidthMm: 1400,
          customHeightMm: 3100,
        },
      ],
    });

    expect(model.itemRows[0][0]).toBe('1400×3100');
  });

  it('maps canonical HPL applications to the offer heading', () => {
    expect(quoteOfferHeading('INTERIOR')).toBe(
      'Предложение на поставку интерьерных панелей',
    );
    expect(quoteOfferHeading('EXTERIOR_WITH_UV')).toBe(
      'Предложение на поставку фасадных панелей',
    );
    expect(quoteOfferHeading('FURNITURE')).toBe(
      'Предложение на поставку мебельных панелей',
    );
    expect(quoteOfferHeading('LABORATORY')).toBe(
      'Предложение на поставку лабораторных панелей',
    );
    expect(quoteOfferHeading(null)).toBe('Предложение на поставку HPL-панелей');
  });

  it('uses Quote item panelTypeCode for the heading and does not parse display names', () => {
    const furniture = buildQuoteDocumentModel({
      ...snapshot,
      items: [
        {
          ...snapshot.items[0],
          panelTypeCode: 'furniture',
          panelTypeName: 'Интерьерная панель',
        },
      ],
    });
    expect(furniture.offerHeading).toBe(
      'Предложение на поставку мебельных панелей',
    );
  });

  it('does not add VAT or logistics to the stored customer price', () => {
    const storedPrice = '576 000 сум';
    const vatInflated = String(Math.round(576000 * 1.12));
    const model = buildQuoteDocumentModel({
      ...snapshot,
      deliveryCost: new Prisma.Decimal('99999'),
    });

    expect(model.itemRows[0]?.[3]).toBe(storedPrice);
    expect(model.itemRows[0]?.[3]).not.toContain('645');
    expect(JSON.stringify(model.itemRows)).not.toContain(vatInflated);
    expect(JSON.stringify(model.itemRows)).not.toContain('64 512');
    expect(JSON.stringify(model.itemRows)).not.toContain('99999');
    expect(JSON.stringify(model.itemRows)).not.toContain('99 999');
    expect(model.itemRows[0]?.[5]).toBe('14-25 дней');
    expect(model.itemRows[0]?.[5]).toMatch(/^\d+-\d+ дней$/);
    expect(model.itemRows[0]?.[5]).not.toMatch(/\d+\s*(сум|USD)/);
  });

  it('treats complete production and delivery ranges as ready for the customer document', () => {
    expect(quoteCustomerDocumentIssues(snapshot)).toEqual([]);
  });

  it('keeps an old Quote unchanged when later defaults differ', () => {
    const laterDefaults = buildQuoteDocumentModel({
      ...snapshot,
      productionDaysFrom: 3,
      productionDaysTo: 5,
      deliveryDaysFrom: 7,
      deliveryDaysTo: 9,
      commercialNote: 'FOB Shanghai',
      validUntil: new Date('2026-12-01T00:00:00.000Z'),
      documentDate: new Date('2026-11-01T00:00:00.000Z'),
    });

    const original = buildQuoteDocumentModel(snapshot);
    expect(original.itemRows[0]?.[4]).toBe('10-20 дней');
    expect(original.commercialNote).toContain('CIP Tashkent');
    expect(laterDefaults.itemRows[0]?.[4]).toBe('3-5 дней');
    expect(laterDefaults.commercialNote).toBe('FOB Shanghai');
    expect(original.documentDateLine).toBe('Дата: 18 Августа  2026 г.');
    expect(formatQuoteDayRange(undefined, undefined)).toBe('—');
    expect(formatQuoteRuDate(new Date('2026-08-20T00:00:00.000Z'))).toBe(
      '20 августа 2026',
    );
    expect(formatQuoteDocumentDate(new Date('2026-08-14T00:00:00.000Z'))).toBe(
      '14 Августа  2026 г.',
    );
  });

  it('prefers text commercial terms and uses numeric ranges only as a legacy fallback', () => {
    const withText = buildQuoteDocumentModel({
      ...snapshot,
      productionTerms: '15–20 рабочих дней',
      deliveryTerms: 'Ориентировочно 4 недели после утверждения декора',
      productionDaysFrom: 10,
      productionDaysTo: 20,
      deliveryDaysFrom: 14,
      deliveryDaysTo: 25,
    });
    expect(withText.itemRows[0]?.[4]).toBe('15–20 рабочих дней');
    expect(withText.itemRows[0]?.[5]).toBe(
      'Ориентировочно 4 недели после утверждения декора',
    );

    const legacyNumeric = buildQuoteDocumentModel(snapshot);
    expect(legacyNumeric.itemRows[0]?.[4]).toBe('10-20 дней');
    expect(legacyNumeric.itemRows[0]?.[5]).toBe('14-25 дней');
  });

  it('uses the automatic Quote createdAt date even if documentDate was forged', () => {
    const model = buildQuoteDocumentModel({
      ...snapshot,
      documentDate: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect(model.documentDateLine).toBe('Дата: 18 Августа  2026 г.');
    expect(model.documentDateLine).not.toContain('Января');
  });

  it('does not invent a commercial note when the snapshot note is empty', () => {
    const model = buildQuoteDocumentModel({
      ...snapshot,
      commercialNote: '   ',
    });
    expect(model.commercialNote).toBeNull();
    expect(JSON.stringify(model)).not.toContain('CIP Tashkent');
  });

  it('renders the Quote display currency without converting it', () => {
    const usd = buildQuoteDocumentModel({
      ...snapshot,
      displayCurrency: 'USD',
      items: [
        {
          ...snapshot.items[0],
          pricePerM2: new Prisma.Decimal('100.5'),
        },
      ],
    });
    expect(usd.itemRows[0]?.[3]).toBe('100,50 USD');
    expect(usd.itemRows[0]?.[3]).not.toContain('сум');
  });
});
