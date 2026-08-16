import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PanelPriceCalculator } from './panel-price-calculator.service';

describe('PanelPriceCalculator', () => {
  const supplierId = 'supplier-1';
  const qualityClassId = 'quality-1';

  const prisma = {
    panelThicknessPricing: {
      findFirst: jest.fn(),
    },
    supplier: {
      findUnique: jest.fn(),
    },
  };

  const calculator = new PanelPriceCalculator(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.panelThicknessPricing.findFirst.mockResolvedValue({
      basePricePerM2: new Prisma.Decimal('60000'),
    });
    prisma.supplier.findUnique.mockResolvedValue({
      marginPercent: new Prisma.Decimal('15'),
    });
  });

  it('applies supplier margin and recalculates pricePerSheet by size', async () => {
    const small = await calculator.calculate({
      supplierId,
      qualityClassId,
      thicknessMm: 10,
      widthMm: 1220,
      heightMm: 2440,
      sheets: 1,
    });
    const large = await calculator.calculate({
      supplierId,
      qualityClassId,
      thicknessMm: 10,
      widthMm: 1525,
      heightMm: 3050,
      sheets: 1,
    });

    expect(small.supplierPricePerM2.equals(new Prisma.Decimal('60000'))).toBe(
      true,
    );
    expect(small.clientPricePerM2.equals(new Prisma.Decimal('69000'))).toBe(
      true,
    );
    expect(small.clientPricePerM2.toString()).toBe(
      large.clientPricePerM2.toString(),
    );
    expect(small.pricePerSheet.toString()).not.toBe(large.pricePerSheet.toString());
  });

  it('throws PRICING_NOT_FOUND when thickness pricing is missing', async () => {
    prisma.panelThicknessPricing.findFirst.mockResolvedValue(null);

    await expect(
      calculator.calculate({
        supplierId,
        qualityClassId,
        thicknessMm: 99,
        widthMm: 1220,
        heightMm: 2440,
        sheets: 1,
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('uses zero margin when supplier marginPercent is null', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ marginPercent: null });

    const result = await calculator.calculate({
      supplierId,
      qualityClassId,
      thicknessMm: 10,
      widthMm: 1000,
      heightMm: 1000,
      sheets: 2,
    });

    expect(result.supplierPricePerM2.toString()).toBe(
      result.clientPricePerM2.toString(),
    );
    expect(result.areaM2.equals(new Prisma.Decimal(1))).toBe(true);
    expect(result.total.toString()).toBe(
      result.pricePerSheet.mul(2).toDecimalPlaces(2).toString(),
    );
  });
});
