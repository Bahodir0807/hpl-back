import { DealStage, Prisma } from '@prisma/client';
import { DealFactory } from './deal-factory.service';

describe('DealFactory conversion approval', () => {
  const factory = new DealFactory();

  it('does not stamp DealOffer as approved when converting a quote', async () => {
    const tx = {
      deal: {
        create: jest.fn().mockResolvedValue({
          id: 'deal-id-12345678',
          title: 'КП #quote-id',
        }),
      },
      dealStageHistory: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      dealOffer: { create: jest.fn().mockResolvedValue({}) },
    };

    await factory.createFromQuote(tx as never, {
      quote: {
        id: 'quote-id',
        managerId: 'manager-id',
        totalAmount: new Prisma.Decimal('1000'),
        displayCurrency: 'UZS',
        validUntil: new Date('2026-09-01'),
        items: [
          {
            areaM2: new Prisma.Decimal('2'),
            sheetsCount: 1,
            pricePerM2: new Prisma.Decimal('100'),
            supplierPricePerM2: new Prisma.Decimal('60'),
            totalPrice: new Prisma.Decimal('200'),
          },
        ],
      },
      clientId: 'client-id',
      projectObjectId: null,
      serviceProductId: 'product-id',
      userId: 'head-id',
      supplierId: 'supplier-id',
    });

    expect(tx.dealOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isApproved: false,
          dealId: 'deal-id-12345678',
        }),
      }),
    );
    expect(tx.deal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stage: DealStage.QUALIFICATION,
        }),
      }),
    );
  });
});
