import { Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { BusinessException } from '../common/exceptions/business.exception';
import { QuoteDocumentService } from './quote-document.service';
import { convertDocxToPdf } from './quote-pdf-converter';
import {
  DELIVERY_REQUIRED_MESSAGE,
  PRODUCTION_REQUIRED_MESSAGE,
  QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
  QUOTE_PRICE_HEADER,
} from './quote-document.model';

jest.mock('./quote-pdf-converter', () => ({
  convertDocxToPdf: jest.fn(),
}));

describe('QuoteDocumentService', () => {
  beforeEach(() => {
    jest.mocked(convertDocxToPdf).mockReset();
  });

  const quote = {
    id: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    validUntil: new Date('2026-09-01T00:00:00.000Z'),
    totalAmount: new Prisma.Decimal('1250.50'),
    displayCurrency: 'USD',
    deliveryCost: new Prisma.Decimal('50'),
    clientComment: '<b>Клиент & условия</b>',
    commercialNote: 'Цена указана с учётом 1 контейнера CIP Tashkent.',
    productionDaysFrom: 10,
    productionDaysTo: 20,
    deliveryDaysFrom: 14,
    deliveryDaysTo: 25,
    documentDate: new Date('2026-08-14T00:00:00.000Z'),
    lead: { title: 'Lead', client: { name: 'ТОО Клиент & Co' } },
    items: [
      {
        panelTypeCode: 'exterior_with_uv',
        panelTypeName: 'Exterior',
        panelSizeName: '1220 x 2440',
        thicknessMm: 12,
        colorCode: 'C01',
        colorName: 'Белый',
        supplierName: 'Supplier',
        qualityClassName: 'A',
        sheetsCount: 2,
        areaM2: new Prisma.Decimal('2.9768'),
        requiredAreaM2: new Prisma.Decimal('5.95'),
        pricePerM2: new Prisma.Decimal('100'),
        totalPrice: new Prisma.Decimal('1200.50'),
        priceApprovedAt: new Date('2026-08-18T00:00:00.000Z'),
      },
    ],
  };

  it('generates a DOCX from the UZHPL template using stored Quote snapshot values', async () => {
    const prisma = {
      currencyRate: { findFirst: jest.fn() },
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue(quote),
      },
    };
    const service = new QuoteDocumentService(prisma as never);

    const result = await service.generateDocx(quote.id);

    expect(result.filename).toBe(`quote-${quote.id}.docx`);
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(result.buffer.length).toBeGreaterThan(5_000);
    expect(prisma.currencyRate.findFirst).not.toHaveBeenCalled();
    expect(convertDocxToPdf).not.toHaveBeenCalled();

    const zip = await JSZip.loadAsync(result.buffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    const text = [...(xml ?? '').matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
    expect(text).toContain(QUOTE_PRICE_HEADER);
    expect(text).toContain('100 USD');
    expect(text).not.toContain('112 USD');
    expect(text).toContain('14-25 дней');
    expect(text).not.toContain('50 USD');
  });

  it('renders PDF from the filled DOCX template rather than a separate layout', async () => {
    const prisma = {
      currencyRate: { findFirst: jest.fn() },
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue(quote),
      },
    };
    jest
      .mocked(convertDocxToPdf)
      .mockResolvedValue(
        Buffer.from('%PDF-1.4 mock from filled DOCX template'),
      );
    const service = new QuoteDocumentService(prisma as never);

    const result = await service.generate(quote.id);

    expect(result.filename).toBe(`quote-${quote.id}.pdf`);
    expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(jest.mocked(convertDocxToPdf)).toHaveBeenCalledTimes(1);
    const [docx] = jest.mocked(convertDocxToPdf).mock.calls[0];
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    const pdfSourceXml = await JSZip.loadAsync(docx).then((zip) =>
      zip.file('word/document.xml')?.async('string'),
    );
    const pdfSourceText = [
      ...(pdfSourceXml ?? '').matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g),
    ]
      .map((match) => match[1])
      .join('');
    expect(pdfSourceText).toContain(QUOTE_PRICE_HEADER);
    expect(pdfSourceText).toContain('100 USD');
    expect(pdfSourceText).not.toContain('112 USD');
    expect(prisma.currencyRate.findFirst).not.toHaveBeenCalled();
  });

  it('rejects customer DOCX when production terms are missing', async () => {
    const prisma = {
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue({
          ...quote,
          productionDaysFrom: null,
          productionDaysTo: null,
        }),
      },
    };
    const service = new QuoteDocumentService(prisma as never);

    await expect(service.generateDocx(quote.id)).rejects.toMatchObject({
      response: {
        errorCode: QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
        message: PRODUCTION_REQUIRED_MESSAGE,
      },
    });
    expect(convertDocxToPdf).not.toHaveBeenCalled();
  });

  it('rejects customer PDF when delivery terms are missing', async () => {
    const prisma = {
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue({
          ...quote,
          deliveryDaysFrom: null,
          deliveryDaysTo: 25,
        }),
      },
    };
    const service = new QuoteDocumentService(prisma as never);

    await expect(service.generate(quote.id)).rejects.toBeInstanceOf(
      BusinessException,
    );
    await expect(service.generate(quote.id)).rejects.toMatchObject({
      response: {
        errorCode: QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
        message: DELIVERY_REQUIRED_MESSAGE,
      },
    });
  });

  it('does not recreate a PDF when the quote already has a stored file', async () => {
    const prisma = {
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue({
          id: quote.id,
          pdfFileId: 'file-id',
        }),
      },
      file: { create: jest.fn() },
    };
    const service = new QuoteDocumentService(prisma as never);

    const result = await service.persistFinalPdf(quote.id, 'user-id');

    expect(result).toEqual({
      fileId: 'file-id',
      filename: `quote-${quote.id}.pdf`,
      created: false,
    });
    expect(convertDocxToPdf).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
  });

  it('does not regenerate a finalized PDF when its File row is missing', async () => {
    const prisma = {
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue({
          id: quote.id,
          pdfFileId: 'missing-file-id',
        }),
      },
      file: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new QuoteDocumentService(prisma as never);

    await expect(service.generate(quote.id)).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_PDF_FILE_MISSING',
        statusCode: 404,
      }),
    });
    expect(convertDocxToPdf).not.toHaveBeenCalled();
  });
});
