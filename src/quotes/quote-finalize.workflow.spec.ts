import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { QUOTE_STATUS } from './quote.constants';
import { QuotesService } from './quotes.service';
import type { FinalizeQuoteDto } from './dto/update-quote-approved-pricing.dto';

describe('QuotesService approved pricing and history', () => {
  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: ['MANAGER'],
    permissions: [
      'quotes:create',
      'quotes:read',
      'quotes:update',
      'quotes:client_accept',
    ],
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: ['HEAD'],
    permissions: [
      'quotes:read',
      'quotes:read_all',
      'quotes:update',
      'quotes:approve',
      'calculations:read_all',
    ],
  };

  const quote = {
    id: 'quote-id',
    managerId: 'manager-id',
    clientId: 'client-id',
    requestId: 'request-id',
    status: QUOTE_STATUS.DRAFT,
    finalizedAt: null,
    pdfFileId: null,
    displayCurrency: 'USD',
    totalAmount: new Prisma.Decimal('200'),
    items: [
      {
        id: 'item-1',
        calculationId: 'calc-1',
        supplierCode: 'wuya',
        qualityClassCode: 'economy',
        thicknessMm: new Prisma.Decimal('10'),
        areaM2: new Prisma.Decimal('2.5'),
        sheetsCount: 2,
        requiredAreaM2: new Prisma.Decimal('5'),
        pricePerM2: new Prisma.Decimal('20'),
        currencyCode: 'USD',
        priceApprovedAt: null,
        totalPrice: new Prisma.Decimal('100'),
      },
      {
        id: 'item-2',
        calculationId: 'calc-2',
        supplierCode: 'wuya',
        qualityClassCode: 'economy',
        thicknessMm: new Prisma.Decimal('10'),
        areaM2: new Prisma.Decimal('2.5'),
        sheetsCount: 2,
        requiredAreaM2: new Prisma.Decimal('5'),
        pricePerM2: new Prisma.Decimal('20'),
        currencyCode: 'USD',
        priceApprovedAt: null,
        totalPrice: new Prisma.Decimal('100'),
      },
    ],
  };

  const prisma = {
    panelQuote: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    panelQuoteItem: { update: jest.fn() },
    calculationRequest: { updateMany: jest.fn(), findFirst: jest.fn() },
    calculationSession: { findFirst: jest.fn() },
    leadCommercialQualification: { findUnique: jest.fn() },
    supplierQualityMapping: { findFirst: jest.fn() },
    supplier: { findUnique: jest.fn() },
    qualityClass: { findUnique: jest.fn() },
    activity: { create: jest.fn() },
    notification: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const quoteDocumentService = {
    persistFinalPdf: jest.fn(),
    cleanupUncommittedFinalPdf: jest.fn(),
    generate: jest.fn(),
  };
  const panelPriceCalculator = { calculate: jest.fn() };
  const currencyRateService = { getActiveCnyUsdRate: jest.fn() };

  let service: QuotesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (arg: ((tx: typeof prisma) => unknown) | unknown[]) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.all(arg);
      },
    );
    prisma.panelQuote.findUnique.mockResolvedValue(quote);
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue(quote);
    prisma.panelQuote.update.mockResolvedValue(quote);
    prisma.panelQuote.updateMany.mockResolvedValue({ count: 1 });
    prisma.panelQuote.findMany.mockResolvedValue([
      quote,
      { ...quote, id: 'quote-2' },
    ]);
    prisma.panelQuote.count.mockResolvedValue(2);
    quoteDocumentService.persistFinalPdf.mockResolvedValue({
      fileId: 'file-id',
      filename: 'quote.pdf',
      created: true,
    });
    quoteDocumentService.cleanupUncommittedFinalPdf.mockResolvedValue(
      undefined,
    );
    prisma.notification.create.mockResolvedValue({});
    prisma.supplierQualityMapping.findFirst.mockResolvedValue({
      id: 'mapping-id',
    });
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'supplier-id',
      code: 'wuya',
      name: 'Wuya',
    });
    prisma.qualityClass.findUnique.mockResolvedValue({ id: 'quality-id' });
    currencyRateService.getActiveCnyUsdRate.mockResolvedValue(
      new Prisma.Decimal('0.1'),
    );
    panelPriceCalculator.calculate.mockResolvedValue({
      supplierPricePerM2: new Prisma.Decimal('10'),
      clientPricePerM2: new Prisma.Decimal('20'),
      pricePerSheet: new Prisma.Decimal('50'),
      total: new Prisma.Decimal('100'),
      areaM2: new Prisma.Decimal('2.5'),
      cnyUsdRate: new Prisma.Decimal('0.1'),
      sellingCoefficient: new Prisma.Decimal('2'),
    });
    service = new QuotesService(
      prisma as never,
      { sendEmail: jest.fn() } as never,
      { createFromQuote: jest.fn() } as never,
      { check: jest.fn() } as never,
      { reserveStock: jest.fn() } as never,
      quoteDocumentService as never,
      panelPriceCalculator as never,
      currencyRateService as never,
    );
  });

  it('forbids a manager from setting approved final price', async () => {
    await expect(
      service.updateApprovedPricing(
        'quote-id',
        { items: [{ id: 'item-1', purchasePricePerM2Cny: '300' }] },
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
  });

  it('forbids a manager from finalizing a quote', async () => {
    await expect(
      service.finalize('quote-id', {} as FinalizeQuoteDto, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
  });

  it('lets HEAD approve server-calculated USD prices from distinct CNY inputs', async () => {
    const unpricedQuote = {
      ...quote,
      totalAmount: new Prisma.Decimal(0),
      items: quote.items.map((item) => ({
        ...item,
        supplierPricePerM2: null,
        pricePerM2: null,
        currencyCode: null,
        pricePerSheet: null,
        totalPrice: null,
        priceApprovedAt: null,
      })),
    };
    prisma.panelQuote.findUnique
      .mockResolvedValueOnce(unpricedQuote)
      .mockResolvedValueOnce({
        ...unpricedQuote,
        items: [
          {
            ...unpricedQuote.items[0],
            pricePerM2: new Prisma.Decimal('20'),
            currencyCode: 'USD',
            priceApprovedAt: new Date(),
            totalPrice: new Prisma.Decimal('100'),
          },
          {
            ...unpricedQuote.items[1],
            pricePerM2: new Prisma.Decimal('24'),
            currencyCode: 'USD',
            priceApprovedAt: new Date(),
            totalPrice: new Prisma.Decimal('120'),
          },
        ],
      });

    await service.updateApprovedPricing(
      'quote-id',
      {
        items: [
          { id: 'item-1', purchasePricePerM2Cny: '100' },
          { id: 'item-2', purchasePricePerM2Cny: '120' },
        ],
      },
      head,
    );

    expect(prisma.panelQuoteItem.update).toHaveBeenCalledTimes(2);
    expect(
      prisma.panelQuoteItem.update.mock.calls[0][0].data.currencyCode,
    ).toBe('USD');
    expect(
      prisma.panelQuoteItem.update.mock.calls[1][0].data.currencyCode,
    ).toBe('USD');
    expect(
      prisma.panelQuoteItem.update.mock.calls[0][0].data.priceApprovedAt,
    ).toBeInstanceOf(Date);
    expect(panelPriceCalculator.calculate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ purchasePricePerM2Cny: '100' }),
    );
    expect(panelPriceCalculator.calculate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ purchasePricePerM2Cny: '120' }),
    );
  });

  it('previews the server calculation without approving or persisting it', async () => {
    const result = await service.previewPricing(
      'quote-id',
      { items: [{ id: 'item-1', purchasePricePerM2Cny: '80' }] },
      head,
    );

    expect(result.currencyCode).toBe('USD');
    expect(result.cnyUsdRate.toString()).toBe('0.1');
    expect(result.sellingCoefficient.toString()).toBe('2');
    expect(result.items[0].pricePerM2.toString()).toBe('20');
    expect(panelPriceCalculator.calculate).toHaveBeenCalledWith(
      expect.objectContaining({
        purchasePricePerM2Cny: '80',
        areaM2: new Prisma.Decimal('2.5'),
      }),
    );
    expect(prisma.panelQuoteItem.update).not.toHaveBeenCalled();
  });

  it('finalization persists snapshot PDF and links the quote to the client', async () => {
    const ready = {
      ...quote,
      productionDaysFrom: 10,
      productionDaysTo: 20,
      deliveryDaysFrom: 14,
      deliveryDaysTo: 25,
      items: quote.items.map((item) => ({
        ...item,
        priceApprovedAt: new Date(),
      })),
    };
    prisma.panelQuote.findUnique.mockResolvedValue(ready);
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue({
      ...ready,
      pdfFileId: 'file-id',
      finalizedAt: new Date(),
      approverId: head.id,
    });

    const result = await service.finalize(
      'quote-id',
      {
        productionDaysFrom: 10,
        productionDaysTo: 20,
        deliveryDaysFrom: 14,
        deliveryDaysTo: 25,
      } as FinalizeQuoteDto,
      head,
    );

    expect(quoteDocumentService.persistFinalPdf).toHaveBeenCalledWith(
      'quote-id',
      head.id,
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.panelQuote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdfFileId: 'file-id',
          approverId: head.id,
        }),
      }),
    );
    expect(result.clientId).toBe('client-id');
  });

  it('lists multiple quotes for a client without recalculating catalog prices', async () => {
    const listed = await service.findAll({ clientId: 'client-id' }, head);

    expect(listed.total).toBe(2);
    expect(listed.items).toHaveLength(2);
    expect(prisma.panelQuote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'client-id' }),
      }),
    );
  });

  it('does not recreate a stored PDF on a second fetch', async () => {
    quoteDocumentService.generate.mockResolvedValue({
      buffer: Buffer.from('%PDF-stored'),
      filename: 'quote.pdf',
    });
    const first = await quoteDocumentService.generate('quote-id');
    const second = await quoteDocumentService.generate('quote-id');
    expect(first.buffer.equals(second.buffer)).toBe(true);
    expect(quoteDocumentService.persistFinalPdf).not.toHaveBeenCalled();
  });

  it('loads a stored quote snapshot without catalog recalculation', async () => {
    const loaded = await service.findOne('quote-id', head);
    expect(loaded.items[0]?.pricePerM2).toEqual(quote.items[0]?.pricePerM2);
    expect(loaded.items[0]?.currencyCode).toBe('USD');
  });

  it('blocks a manager from downloading PDF before HEAD finalizes it', () => {
    try {
      service.assertCanDownloadCustomerDocument(
        { pdfFileId: null, finalizedAt: null },
        manager,
      );
      throw new Error('expected QUOTE_PDF_NOT_FINALIZED');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getResponse()).toEqual(
        expect.objectContaining({ errorCode: 'QUOTE_PDF_NOT_FINALIZED' }),
      );
    }
  });

  it('forbids a manager from creating a quote from a calculation request', async () => {
    await expect(
      service.createFromRequest('request-id', {} as never, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
  });

  it('forbids a manager from using the legacy convert-to-quote path', async () => {
    await expect(
      service.createFromCalculation('calc-id', {} as never, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_APPROVAL_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(prisma.calculationSession.findFirst).not.toHaveBeenCalled();
  });

  it('lets HEAD convert a submitted calculation request', async () => {
    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      status: 'submitted',
      quotes: [],
      calculations: [{ id: 'calc-1' }],
    });
    prisma.calculationSession.findFirst.mockResolvedValue({
      id: 'calc-1',
      status: 'finalized',
      createdById: manager.id,
      leadId: 'lead-id',
      clientId: 'client-id',
      requestId: 'request-id',
      displayCurrency: 'USD',
      totalAmount: new Prisma.Decimal('200'),
      commercialConfirmedAt: null,
      panelQuote: null,
      items: [
        {
          panelType: { code: 'interior', displayNameRu: 'Интерьер' },
          panelSize: {
            displayName: '1220×2440',
            areaM2: new Prisma.Decimal('2.5'),
            widthMm: 1000,
            heightMm: 2500,
          },
          supplier: { id: 'supplier-id', code: 'wuya', name: 'Wuya' },
          qualityClass: { code: 'economy', nameRu: 'Эконом' },
          color: null,
          panelTypeId: 'type-id',
          panelSizeId: 'size-id',
          supplierId: 'supplier-id',
          qualityClassId: 'quality-id',
          thicknessMm: new Prisma.Decimal('8'),
          requiredAreaM2: new Prisma.Decimal('5'),
          sheetsCount: 2,
          supplierPricePerM2: new Prisma.Decimal('10'),
          clientPricePerM2: new Prisma.Decimal('20'),
          pricePerSheet: new Prisma.Decimal('50'),
          totalPrice: new Prisma.Decimal('100'),
          wastePercent: new Prisma.Decimal('5'),
          coating: 'PE',
          texture: 'woodgrain',
          customTypeDescription: 'Special fire-rated HPL',
          customWidthMm: 1400,
          customHeightMm: 3100,
          color: {
            colorCode: 'W100',
            colorName: 'White Oak',
            supplierId: 'supplier-id',
          },
        },
      ],
      request: { calculations: [], quotes: [] },
      lead: { client: { id: 'client-id', name: 'Client', email: null } },
    });
    prisma.leadCommercialQualification.findUnique.mockResolvedValue(null);
    prisma.panelQuote.create.mockResolvedValue({
      id: 'quote-id',
      clientId: 'client-id',
      items: [],
    });
    prisma.activity.create.mockResolvedValue({});

    await service.createFromRequest('request-id', {}, head);

    expect(prisma.panelQuote.create).toHaveBeenCalled();
    const created = prisma.panelQuote.create.mock.calls[0][0].data as {
      items: { create: Array<{ priceApprovedAt: Date | null }> };
    };
    expect(created.items.create[0]?.priceApprovedAt).toBeNull();
    expect(created.items.create[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 2,
        customWidthMm: 1400,
        customHeightMm: 3100,
        coating: 'PE',
        texture: 'woodgrain',
        customTypeDescription: 'Special fire-rated HPL',
        colorCode: 'W100',
        colorName: 'White Oak',
      }),
    );
  });

  it('rejects finalization when items still have only calculator reference prices', async () => {
    prisma.panelQuote.findUnique.mockResolvedValue({
      ...quote,
      productionDaysFrom: 10,
      productionDaysTo: 20,
      deliveryDaysFrom: 14,
      deliveryDaysTo: 25,
    });

    await expect(
      service.finalize(
        'quote-id',
        {
          productionDaysFrom: 10,
          productionDaysTo: 20,
          deliveryDaysFrom: 14,
          deliveryDaysTo: 25,
        } as FinalizeQuoteDto,
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_PRICE_NOT_APPROVED',
      }),
    });
    expect(quoteDocumentService.persistFinalPdf).not.toHaveBeenCalled();
  });

  it('finalizes after explicit HEAD price and currency approval', async () => {
    const approved = {
      ...quote,
      productionDaysFrom: 10,
      productionDaysTo: 20,
      deliveryDaysFrom: 14,
      deliveryDaysTo: 25,
      items: quote.items.map((item) => ({
        ...item,
        priceApprovedAt: new Date(),
        currencyCode: item.id === 'item-2' ? 'UZS' : 'USD',
      })),
    };
    prisma.panelQuote.findUnique.mockResolvedValue(approved);
    prisma.panelQuote.findUniqueOrThrow.mockResolvedValue({
      ...approved,
      pdfFileId: 'file-id',
      finalizedAt: new Date(),
      approverId: head.id,
    });

    await service.finalize(
      'quote-id',
      {
        productionDaysFrom: 10,
        productionDaysTo: 20,
        deliveryDaysFrom: 14,
        deliveryDaysTo: 25,
      } as FinalizeQuoteDto,
      head,
    );

    expect(quoteDocumentService.persistFinalPdf).toHaveBeenCalled();
  });

  it('compensates a newly persisted PDF when the finalization transaction rolls back', async () => {
    const approved = {
      ...quote,
      productionTerms: '15–20 working days',
      deliveryTerms: 'Delivery in four weeks',
      items: quote.items.map((item) => ({
        ...item,
        priceApprovedAt: new Date(),
        currencyCode: 'USD',
      })),
    };
    prisma.panelQuote.findUnique.mockResolvedValue(approved);
    prisma.panelQuote.updateMany.mockRejectedValueOnce(
      new Error('transaction rollback'),
    );

    await expect(
      service.finalize('quote-id', {} as FinalizeQuoteDto, head),
    ).rejects.toThrow('transaction rollback');
    expect(
      quoteDocumentService.cleanupUncommittedFinalPdf,
    ).toHaveBeenCalledWith('file-id');
  });

  it('locks commercial fields after finalization for MANAGER and HEAD', async () => {
    const frozen = {
      ...quote,
      finalizedAt: new Date(),
      status: QUOTE_STATUS.DRAFT,
    };
    prisma.panelQuote.findUnique.mockResolvedValue(frozen);

    await expect(
      service.updateCommercialTerms(
        'quote-id',
        { commercialNote: 'rewrite' } as never,
        manager,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'QUOTE_COMMERCIAL_NOTE_FORBIDDEN',
      }),
    });
    await expect(
      service.updateApprovedPricing(
        'quote-id',
        { items: [{ id: 'item-1', purchasePricePerM2Cny: '999' }] },
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'QUOTE_TERMS_LOCKED' }),
    });
    await expect(
      service.updateCommercialTerms(
        'quote-id',
        { productionDaysFrom: 1, productionDaysTo: 2 } as never,
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'QUOTE_TERMS_LOCKED' }),
    });
    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
  });
});
