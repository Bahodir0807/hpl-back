import { Prisma, QuoteComponentKind } from '@prisma/client';
import JSZip from 'jszip';
import {
  buildQuoteDocumentModel,
  CUSTOMER_QUOTE_SUBTITLE,
  CUSTOMER_QUOTE_TITLE,
  customerDocumentMetaViolations,
  QUOTE_PRICE_HEADER,
  QUOTE_TABLE_HEADERS,
  type QuoteDocumentSnapshot,
} from './quote-document.model';
import {
  fillDocumentXml,
  fillUzhplQuoteTemplate,
  fitQuoteOfferTableToPageWidth,
  loadUzhplQuoteTemplate,
} from './quote-docx-template';
import {
  customerFacingSnapshot,
  HPL_FACADE_CUSTOMER_SUBTITLE,
  HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE,
  HPL_INSTALLATION_CUSTOMER_SUBTITLE,
} from './quote-composition';

const W_T = /<w:t[^>]*>([^<]*)<\/w:t>/g;

function documentText(xml: string): string {
  return [...xml.matchAll(W_T)].map((match) => match[1]).join('');
}

async function filledXml(snapshot: QuoteDocumentSnapshot): Promise<string> {
  const buffer = await fillUzhplQuoteTemplate(
    loadUzhplQuoteTemplate(),
    buildQuoteDocumentModel(snapshot),
  );
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) {
    throw new Error('filled DOCX is missing document.xml');
  }
  return xml;
}

function offerTableXml(xml: string): string {
  const marker = QUOTE_TABLE_HEADERS[0];
  const markerIndex = xml.indexOf(marker);
  const tableStart = Math.max(
    xml.lastIndexOf('<w:tbl ', markerIndex),
    xml.lastIndexOf('<w:tbl>', markerIndex),
  );
  const tableEnd = xml.indexOf('</w:tbl>', tableStart);
  return xml.slice(tableStart, tableEnd);
}

function offerTableRowCount(xml: string): number {
  return (offerTableXml(xml).match(/<w:tr[\s>]/g) ?? []).length;
}

function offerTableGridWidths(xml: string): number[] {
  const grid = offerTableXml(xml).match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
  if (!grid) {
    return [];
  }
  return [...grid[0].matchAll(/w:w="(\d+)"/g)].map((match) => Number(match[1]));
}

function baseSnapshot(
  overrides?: Partial<QuoteDocumentSnapshot>,
): QuoteDocumentSnapshot {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2026-08-14T05:00:00.000Z'),
    documentDate: new Date('2020-01-01T00:00:00.000Z'),
    validUntil: new Date('2026-08-20T00:00:00.000Z'),
    totalAmount: new Prisma.Decimal('1296000'),
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
        panelSizeName: '1220 × 3050',
        thicknessMm: 6,
        sheetsCount: 2,
        areaM2: new Prisma.Decimal('475.5'),
        requiredAreaM2: new Prisma.Decimal('951'),
        pricePerM2: new Prisma.Decimal('576000'),
      },
      {
        panelSizeName: '1220 × 3050',
        thicknessMm: 8,
        sheetsCount: 1,
        areaM2: new Prisma.Decimal('951'),
        requiredAreaM2: new Prisma.Decimal('951'),
        pricePerM2: new Prisma.Decimal('720000'),
      },
    ],
    ...overrides,
  };
}

describe('UZHPL DOCX template fill', () => {
  it('centers the orange accent rule relative to the page content', async () => {
    const xml = await filledXml(baseSnapshot());
    expect(xml).toMatch(/<w:jc w:val="center"\s*\/>/);
  });

  it('renders group titles and mixed currencies for multiple calculations', async () => {
    const xml = await filledXml(
      baseSnapshot({
        items: [
          {
            ...baseSnapshot().items[0],
            calculationGroupTitle: 'Расчёт 1',
            currencyCode: 'USD',
            pricePerM2: new Prisma.Decimal('300'),
          },
          {
            ...baseSnapshot().items[0],
            thicknessMm: 8,
            calculationGroupTitle: 'Расчёт 1',
            currencyCode: 'USD',
            pricePerM2: new Prisma.Decimal('310'),
          },
          {
            ...baseSnapshot().items[0],
            thicknessMm: 10,
            calculationGroupTitle: 'Расчёт 1',
            currencyCode: 'USD',
            pricePerM2: new Prisma.Decimal('320'),
          },
          {
            ...baseSnapshot().items[1],
            calculationGroupTitle: 'Расчёт 2',
            currencyCode: 'UZS',
            pricePerM2: new Prisma.Decimal('3500000'),
          },
          {
            ...baseSnapshot().items[1],
            thicknessMm: 12,
            calculationGroupTitle: 'Расчёт 2',
            currencyCode: 'UZS',
            pricePerM2: new Prisma.Decimal('3600000'),
          },
        ],
      }),
    );
    const text = documentText(xml);
    expect(text).toContain('Расчёт 1');
    expect(text).toContain('Расчёт 2');
    expect(text).toContain('300 USD');
    expect(text).toContain('сум');
    expect(text).toContain('Цена за м² с НДС 12%');
    expect(xml).toContain('tblHeader');

    const taglineText = 'надёжные решения из';
    const taglineIndex = xml.indexOf(taglineText);
    const taglineParagraphStart = xml.lastIndexOf('<w:p', taglineIndex);
    expect(taglineIndex).toBeGreaterThan(0);
    expect(xml.slice(taglineParagraphStart, taglineIndex)).not.toContain(
      '<w:br',
    );
  });

  it('fills Quote rows into the golden template table', async () => {
    const xml = await filledXml(baseSnapshot());
    const text = documentText(xml);

    for (const header of QUOTE_TABLE_HEADERS) {
      expect(text).toContain(header);
    }
    expect(text).toContain('1220 × 3050');
    expect(text).toContain('6 мм');
    expect(text).toContain('8 мм');
    expect(text).toContain('951');
    expect(text).toContain('576 000 сум');
    expect(text).toContain('720 000 сум');
    expect(text).toContain('10-20 дней');
    expect(text).toContain('14-25 дней');
  });

  it('keeps the client subtitle and excludes internal Quote metadata', async () => {
    const quote = baseSnapshot({
      id: '58e6f812-aaaa-4bbb-8ccc-ddddeeeeffff',
      versionNumber: 7,
    });
    const text = documentText(await filledXml(quote));

    expect(text).toContain(CUSTOMER_QUOTE_TITLE);
    expect(text).toContain(CUSTOMER_QUOTE_SUBTITLE);
    expect(text).not.toContain('КП v1');
    expect(text).not.toContain('КП v7');
    expect(text).not.toContain('КП v');
    expect(text).not.toContain(quote.id);
    expect(text).not.toContain(quote.id.slice(0, 8));
    expect(customerDocumentMetaViolations(text, quote)).toEqual([]);
  });

  it('renders a one-item Quote with a clean customer header', async () => {
    const quote = baseSnapshot({
      id: '58e6f812-aaaa-4bbb-8ccc-ddddeeeeffff',
      versionNumber: 1,
      items: [baseSnapshot().items[0]],
    });
    const text = documentText(await filledXml(quote));

    expect(text).toContain(CUSTOMER_QUOTE_TITLE);
    expect(text).toContain(CUSTOMER_QUOTE_SUBTITLE);
    expect(text).toContain('6 мм');
    expect(text).not.toContain('8 мм');
    expect(text).not.toContain('КП v');
    expect(text).not.toContain(quote.id);
    expect(text).not.toContain(quote.id.slice(0, 8));
  });

  it('strips a legacy КП v prefix from the customer subtitle', async () => {
    const originalZip = await JSZip.loadAsync(loadUzhplQuoteTemplate());
    const originalXml = await originalZip
      .file('word/document.xml')
      ?.async('string');
    if (!originalXml) {
      throw new Error('template is missing document.xml');
    }

    const polluted = originalXml.replace(
      '>на поставку <',
      '>КП v1 · 58e6f812 · на поставку <',
    );
    expect(documentText(polluted)).toContain('КП v1 · 58e6f812');

    const quote = baseSnapshot({
      id: '58e6f812-aaaa-4bbb-8ccc-ddddeeeeffff',
      versionNumber: 1,
    });
    const filled = fillDocumentXml(polluted, buildQuoteDocumentModel(quote));
    const text = documentText(filled);

    expect(text).toContain(CUSTOMER_QUOTE_TITLE);
    expect(text).toContain(CUSTOMER_QUOTE_SUBTITLE);
    expect(text).not.toContain('КП v');
    expect(text).not.toContain(quote.id.slice(0, 8));
    expect(customerDocumentMetaViolations(text, quote)).toEqual([]);
  });

  it('fits the offer table to the template page content width for PDF rendering', async () => {
    const quote = baseSnapshot({
      id: '58e6f812-aaaa-4bbb-8ccc-ddddeeeeffff',
      versionNumber: 2,
    });
    const filled = await filledXml(quote);
    const normalized = fitQuoteOfferTableToPageWidth(filled);
    const pdfSourceText = documentText(normalized);

    expect(filled).toContain('<w:tblW w:w="9678" w:type="dxa"');
    expect(filled).toContain('<w:tblHeader w:val="true"');
    expect(normalized).toContain('<w:tblW w:w="9412" w:type="dxa"');
    const pdfGrid = offerTableGridWidths(normalized);
    expect(pdfGrid.reduce((sum, width) => sum + width, 0)).toBe(9412);
    expect(pdfGrid[4]).toBeGreaterThanOrEqual(1720);
    expect(pdfSourceText).toContain(CUSTOMER_QUOTE_TITLE);
    expect(pdfSourceText).toContain(CUSTOMER_QUOTE_SUBTITLE);
    expect(pdfSourceText).not.toContain('КП v');
    expect(pdfSourceText).not.toContain(quote.id);
    expect(pdfSourceText).not.toContain(quote.id.slice(0, 8));
    expect(customerDocumentMetaViolations(pdfSourceText, quote)).toEqual([]);
  });

  it('creates one table row per Quote item', async () => {
    const xml = await filledXml(baseSnapshot());
    expect(xml).toContain('6 мм');
    expect(xml).toContain('8 мм');
    expect(xml.match(/1220 × 3050/g)?.length).toBeGreaterThanOrEqual(2);
    expect(offerTableRowCount(xml)).toBe(3);
  });

  it('does not pad the offer table with empty golden-template rows', async () => {
    const xml = await filledXml(
      baseSnapshot({
        items: [baseSnapshot().items[0]],
      }),
    );
    expect(offerTableRowCount(xml)).toBe(2);
  });

  it('keeps the requisites box intact for PDF pagination', async () => {
    const xml = await filledXml(baseSnapshot());
    expect(xml).not.toContain('lastRenderedPageBreak');
    expect(xml).toContain('<w:cantSplit');
    expect(documentText(xml)).toContain('Реквизиты:');
  });

  it('uses stored production and delivery snapshot ranges', async () => {
    const xml = await filledXml(
      baseSnapshot({
        productionDaysFrom: 3,
        productionDaysTo: 5,
        deliveryDaysFrom: 7,
        deliveryDaysTo: 9,
      }),
    );
    const text = documentText(xml);
    expect(text).toContain('3-5 дней');
    expect(text).toContain('7-9 дней');
    expect(text).not.toContain('10-20 дней');
    expect(text).not.toContain('14-25 дней');
  });

  it('uses the stored Manager commercial note and does not invent CIP text', async () => {
    const withNote = documentText(
      await filledXml(baseSnapshot({ commercialNote: 'FOB Shanghai' })),
    );
    expect(withNote).toContain('FOB Shanghai');
    expect(withNote).not.toContain('CIP Tashkent');

    const withoutNote = documentText(
      await filledXml(baseSnapshot({ commercialNote: null })),
    );
    expect(withoutNote).not.toContain('CIP Tashkent');
    expect(withoutNote).not.toContain('FOB Shanghai');
    expect(withoutNote).toContain('Все цены действительны до  20 августа.');
    expect(withoutNote).toContain(
      'Продукция UZHPL производится в соответствии с международными стандартами',
    );
  });

  it('renders validUntil and the automatic createdAt date', async () => {
    const text = documentText(await filledXml(baseSnapshot()));
    expect(text).toContain('Все цены действительны до  20 августа.');
    expect(text).toContain('Дата: 14 Августа  2026 г.');
    expect(text).not.toContain('1 Января');
    expect(text).not.toContain('Дата: 1 Января');
  });

  it('never writes internal purchase price or coefficient into the customer document', async () => {
    const xml = await filledXml(baseSnapshot());
    const text = documentText(xml);
    expect(text).not.toContain('purchasePricePerM2Cny');
    expect(text).not.toContain('supplierPricePerM2');
    expect(text).not.toContain('cnyUsdRate');
    expect(text).not.toContain('sellingCoefficient');
    expect(xml).not.toContain('purchasePrice');
  });

  it('regenerates an old Quote from its snapshot instead of later values', async () => {
    const oldXml = await filledXml(baseSnapshot());
    const laterXml = await filledXml(
      baseSnapshot({
        productionDaysFrom: 30,
        productionDaysTo: 40,
        commercialNote: 'New note',
        validUntil: new Date('2026-12-01T00:00:00.000Z'),
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    );

    expect(documentText(oldXml)).toContain('10-20 дней');
    expect(documentText(oldXml)).toContain('CIP Tashkent');
    expect(documentText(oldXml)).toContain('14 Августа  2026 г.');
    expect(documentText(laterXml)).toContain('30-40 дней');
    expect(documentText(laterXml)).toContain('New note');
    expect(documentText(laterXml)).toContain('1 декабря');
    expect(documentText(laterXml)).toContain('1 Ноября  2026 г.');
  });

  it('preserves static branding, requisites, contacts, signature and media', async () => {
    const original = loadUzhplQuoteTemplate();
    const filled = await fillUzhplQuoteTemplate(
      original,
      buildQuoteDocumentModel(baseSnapshot()),
    );
    const originalZip = await JSZip.loadAsync(original);
    const filledZip = await JSZip.loadAsync(filled);
    const xml = await filledZip.file('word/document.xml')?.async('string');
    const text = documentText(xml ?? '');

    expect(filled.subarray(0, 2).toString()).toBe('PK');
    expect(text).toContain('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ');
    expect(text).toContain('на поставку HPL-панелей');
    expect(text).toContain('ООО «Build Garanteed»');
    expect(text).toContain('ИНН: 310131876');
    expect(text).toContain('2020 8840 1056 0108 6002');
    expect(text).toContain('МФО: 00440');
    expect(text).toContain('Мы предлагаем:');
    expect(text).toContain('+998 78 122 31 51');
    expect(text).toContain('info@uzhpl.uz');
    expect(text).toContain('Шамсутдинов И.Ш');
    expect(text).toContain('UZHPL — надёжные решения из HPL');
    expect(text).toContain('Цена за м² с НДС 12%');
    expect(text).not.toMatch(/Цена за м²(?! с НДС 12%)/);
    expect(filledZip.file('word/media/image1.jpg')).toBeTruthy();
    expect(filledZip.file('word/media/image4.png')).toBeTruthy();
    expect(
      await filledZip.file('word/media/image1.jpg')?.async('nodebuffer'),
    ).toEqual(
      await originalZip.file('word/media/image1.jpg')?.async('nodebuffer'),
    );
    expect(
      await filledZip.file('word/media/image4.png')?.async('nodebuffer'),
    ).toEqual(
      await originalZip.file('word/media/image4.png')?.async('nodebuffer'),
    );
  });

  it.each([
    ['interior', 'Предложение на поставку интерьерных панелей'],
    ['exterior_with_uv', 'Предложение на поставку фасадных панелей'],
    ['furniture', 'Предложение на поставку мебельных панелей'],
    ['laboratory', 'Предложение на поставку лабораторных панелей'],
  ] as const)(
    'renders the %s offer heading from the Quote panel type snapshot',
    async (panelTypeCode, heading) => {
      const text = documentText(
        await filledXml(
          baseSnapshot({
            items: [
              { ...baseSnapshot().items[0], panelTypeCode },
              { ...baseSnapshot().items[1], panelTypeCode },
            ],
          }),
        ),
      );
      expect(text).toContain(heading);
      if (panelTypeCode !== 'interior') {
        expect(text).not.toContain('интерьерных панелей');
      }
    },
  );

  it('uses the generic HPL heading when no structured application exists', async () => {
    const text = documentText(
      await filledXml(
        baseSnapshot({
          items: [
            { ...baseSnapshot().items[0], panelTypeCode: 'custom-other' },
          ],
        }),
      ),
    );
    expect(text).toContain('Предложение на поставку HPL-панелей');
    expect(text).not.toContain('интерьерных панелей');
  });

  it('keeps the golden-template VAT-included price header and does not strip it', async () => {
    const originalZip = await JSZip.loadAsync(loadUzhplQuoteTemplate());
    const originalXml = await originalZip
      .file('word/document.xml')
      ?.async('string');
    const filledXmlText = await filledXml(baseSnapshot());
    const originalText = documentText(originalXml ?? '');
    const filledText = documentText(filledXmlText);

    expect(originalText).toContain(QUOTE_PRICE_HEADER);
    expect(filledText).toContain('Цена за м² с НДС 12%');
    expect(filledText).not.toMatch(/Цена за м²(?! с НДС 12%)/);
  });

  it('keeps the stored client price, delivery days, and excludes purchase CNY and logistics amounts', async () => {
    const text = documentText(
      await filledXml(
        baseSnapshot({
          deliveryCost: new Prisma.Decimal('99999'),
        }),
      ),
    );

    expect(text).toContain('576 000 сум');
    expect(text).toContain('720 000 сум');
    expect(text).not.toContain(String(Math.round(576000 * 1.12)));
    expect(text).not.toContain(String(Math.round(720000 * 1.12)));
    expect(text).not.toContain('99 999');
    expect(text).not.toContain('99999');
    expect(text).toContain('14-25 дней');
    expect(text).toContain('10-20 дней');
    expect(text).not.toContain('purchasePricePerM2Cny');
    expect(text).not.toContain('CNY');
  });

  it('renders the FURNITURE fixture heading, VAT-included header, and stored snapshot terms', async () => {
    const storedPrice = '576 000 сум';
    const text = documentText(
      await filledXml(
        baseSnapshot({
          items: [
            { ...baseSnapshot().items[0], panelTypeCode: 'furniture' },
            { ...baseSnapshot().items[1], panelTypeCode: 'furniture' },
          ],
        }),
      ),
    );

    expect(text).toContain('Предложение на поставку мебельных панелей');
    expect(text).toContain('Цена за м² с НДС 12%');
    expect(text).toContain(storedPrice);
    expect(text).toContain('10-20 дней');
    expect(text).toContain('14-25 дней');
    expect(text).not.toContain('интерьерных панелей');
  });

  it('keeps the HPL-only customer subtitle and omits empty combined sections', async () => {
    const text = documentText(await filledXml(baseSnapshot()));
    expect(text).toContain(CUSTOMER_QUOTE_SUBTITLE);
    expect(text).not.toContain('фасадной подсистемы');
    expect(text).not.toContain('монтажные работы');
    expect(text).not.toContain('Фасадная подсистема');
    expect(text).not.toContain('Монтажные работы');
    expect(text).toContain('Цена за м² с НДС 12%');
    expect(text).not.toMatch(/Цена за м²(?! с НДС 12%)/);
  });

  it.each([
    {
      name: 'HPL + facade',
      snapshots: [hplDocSnapshot(), facadeDocSnapshot('8000', 'USD')],
      subtitle: HPL_FACADE_CUSTOMER_SUBTITLE,
      present: ['Фасадная подсистема', '8000.00 USD'],
      absent: ['Монтажные работы'],
    },
    {
      name: 'HPL + installation',
      snapshots: [hplDocSnapshot(), installationDocSnapshot('15000', 'USD')],
      subtitle: HPL_INSTALLATION_CUSTOMER_SUBTITLE,
      present: ['Монтажные работы', '15000.00 USD'],
      absent: ['Фасадная подсистема'],
    },
    {
      name: 'HPL + facade + installation',
      snapshots: [
        hplDocSnapshot(),
        facadeDocSnapshot('8000', 'USD'),
        installationDocSnapshot('15000', 'USD'),
      ],
      subtitle: HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE,
      present: [
        'Фасадная подсистема',
        'Монтажные работы',
        '8000.00 USD',
        '15000.00 USD',
        'Итого: 35000.00 USD',
      ],
      absent: [] as string[],
    },
  ])(
    'renders the $name customer-facing subtitle and extra sections',
    async ({ snapshots, subtitle, present, absent }) => {
      const quote = baseSnapshot({
        id: '58e6f812-aaaa-4bbb-8ccc-ddddeeeeffff',
        componentSnapshots: snapshots,
      });
      const text = documentText(await filledXml(quote));
      expect(text).toContain(subtitle);
      expect(text).toContain('Цена за м² с НДС 12%');
      expect(text.split('НДС 12%')).toHaveLength(2);
      for (const fragment of present) {
        expect(text).toContain(fragment);
      }
      for (const fragment of absent) {
        expect(text).not.toContain(fragment);
      }
      expect(text).not.toContain(quote.id);
      expect(text).not.toMatch(/purchasePrice|contractorName|margin/);
      expect(customerDocumentMetaViolations(text, quote)).toEqual([]);
    },
  );

  it('does not invent a combined total when extra section currencies differ', async () => {
    const text = documentText(
      await filledXml(
        baseSnapshot({
          componentSnapshots: [
            hplDocSnapshot(),
            facadeDocSnapshot('8000', 'EUR'),
            installationDocSnapshot('15000', 'USD'),
          ],
        }),
      ),
    );
    expect(text).toContain(HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE);
    expect(text).toContain('Поставка HPL-панелей: 12000.00 USD');
    expect(text).toContain('Фасадная подсистема: 8000.00 EUR');
    expect(text).toContain('Монтажные работы: 15000.00 USD');
    expect(text).not.toContain('Итого:');
  });
});

function hplDocSnapshot() {
  return {
    kind: QuoteComponentKind.HPL,
    label: 'Поставка HPL-панелей',
    description: null,
    customerAmount: new Prisma.Decimal('12000'),
    currency: 'USD',
    customerSnapshot: customerFacingSnapshot(QuoteComponentKind.HPL, {
      amount: '12000.00',
      currency: 'USD',
    }),
  };
}

function facadeDocSnapshot(amount: string, currency: string) {
  return {
    kind: QuoteComponentKind.FACADE,
    label: 'Фасадная подсистема',
    description: 'Фасадная подсистема',
    customerAmount: new Prisma.Decimal(amount),
    currency,
    customerSnapshot: customerFacingSnapshot(QuoteComponentKind.FACADE, {
      amount: `${amount}.00`,
      currency,
      description: 'Фасадная подсистема',
    }),
  };
}

function installationDocSnapshot(amount: string, currency: string) {
  return {
    kind: QuoteComponentKind.INSTALLATION,
    label: 'Монтажные работы',
    description: 'Монтажные работы',
    customerAmount: new Prisma.Decimal(amount),
    currency,
    customerSnapshot: customerFacingSnapshot(QuoteComponentKind.INSTALLATION, {
      amount: `${amount}.00`,
      currency,
      description: 'Монтажные работы',
    }),
  };
}
