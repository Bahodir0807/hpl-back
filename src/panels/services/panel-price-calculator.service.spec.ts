import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  HPL_FIXTURE_CNY_USD_RATE,
  HPL_FIXTURE_ECONOMY_10MM_CNY_PER_M2,
  HPL_SELLING_COEFFICIENT,
} from '../pricing/hpl-pricing.constants';
import { PanelPriceCalculator } from './panel-price-calculator.service';

describe('PanelPriceCalculator', () => {
  const supplierId = 'supplier-1';
  const qualityClassId = 'quality-1';
  const fixtureRate = new Prisma.Decimal(HPL_FIXTURE_CNY_USD_RATE);
  const fixtureCny = new Prisma.Decimal(HPL_FIXTURE_ECONOMY_10MM_CNY_PER_M2);

  const prisma = {
    panelThicknessPricing: {
      findFirst: jest.fn(),
    },
    supplier: {
      findUnique: jest.fn(),
    },
  };

  const calculator = new PanelPriceCalculator(prisma as never);

  const baseInput = {
    supplierId,
    qualityClassId,
    thicknessMm: 10,
    widthMm: 1000,
    heightMm: 1000,
    sheets: 1,
    cnyUsdRate: fixtureRate,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.panelThicknessPricing.findFirst.mockResolvedValue({
      basePricePerM2: fixtureCny,
      currencyCode: 'CNY',
    });
    prisma.supplier.findUnique.mockResolvedValue({
      marginPercent: new Prisma.Decimal('15'),
    });
  });

  it('uses supplier CNY as the price source', async () => {
    const result = await calculator.calculate(baseInput);

    expect(result.supplierPricePerM2.toString()).toBe(fixtureCny.toString());
    expect(prisma.panelThicknessPricing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          supplierId,
          qualityClassId,
          thicknessMm: 10,
        }),
      }),
    );
  });

  it('applies CNY→USD FX exactly once', async () => {
    const result = await calculator.calculate(baseInput);
    const usdOnce = fixtureCny.mul(fixtureRate);

    expect(result.clientPricePerM2.toString()).toBe(
      usdOnce.mul(HPL_SELLING_COEFFICIENT).toDecimalPlaces(2).toString(),
    );
    expect(result.clientPricePerM2.toString()).not.toBe(
      usdOnce.mul(fixtureRate).mul(HPL_SELLING_COEFFICIENT).toString(),
    );
  });

  it('applies sheet area exactly once', async () => {
    const twoSqm = await calculator.calculate({
      ...baseInput,
      widthMm: 2000,
      heightMm: 1000,
    });
    const oneSqm = await calculator.calculate(baseInput);

    expect(twoSqm.areaM2.toString()).toBe('2');
    expect(oneSqm.areaM2.toString()).toBe('1');
    expect(twoSqm.total.toString()).toBe(
      oneSqm.total.mul(2).toDecimalPlaces(2).toString(),
    );
    expect(twoSqm.clientPricePerM2.toString()).toBe(
      oneSqm.clientPricePerM2.toString(),
    );
  });

  it('applies coefficient 2.0 exactly once', async () => {
    const result = await calculator.calculate(baseInput);
    const usd = fixtureCny.mul(fixtureRate);

    expect(result.sellingCoefficient.toString()).toBe('2');
    expect(result.clientPricePerM2.toString()).toBe(
      usd.mul(2).toDecimalPlaces(2).toString(),
    );
    expect(result.clientPricePerM2.toString()).not.toBe(
      usd.mul(2).mul(2).toDecimalPlaces(2).toString(),
    );
  });

  it('does not apply the old 15% supplier margin on top of the coefficient', async () => {
    const result = await calculator.calculate(baseInput);
    const withOldMargin = fixtureCny
      .mul(fixtureRate)
      .mul(HPL_SELLING_COEFFICIENT)
      .mul(new Prisma.Decimal('1.15'));

    expect(result.clientPricePerM2.toString()).toBe('20');
    expect(result.clientPricePerM2.toString()).not.toBe(
      withOldMargin.toDecimalPlaces(2).toString(),
    );
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
  });

  it('returns deterministic Decimal-compatible money', async () => {
    const first = await calculator.calculate({
      ...baseInput,
      widthMm: 1220,
      heightMm: 2440,
      sheets: 6,
    });
    const second = await calculator.calculate({
      ...baseInput,
      widthMm: 1220,
      heightMm: 2440,
      sheets: 6,
    });

    expect(first.total).toBeInstanceOf(Prisma.Decimal);
    expect(first.clientPricePerM2).toBeInstanceOf(Prisma.Decimal);
    expect(first.total.toString()).toBe(second.total.toString());
    expect(first.pricePerSheet.toString()).toBe(second.pricePerSheet.toString());
  });

  it('rejects rate <= 0', async () => {
    await expect(
      calculator.calculate({
        ...baseInput,
        cnyUsdRate: new Prisma.Decimal('0'),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_CURRENCY_RATE',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
    });

    await expect(
      calculator.calculate({
        ...baseInput,
        cnyUsdRate: new Prisma.Decimal('-1'),
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('rejects supplier price <= 0', async () => {
    prisma.panelThicknessPricing.findFirst.mockResolvedValue({
      basePricePerM2: new Prisma.Decimal('0'),
      currencyCode: 'CNY',
    });

    await expect(calculator.calculate(baseInput)).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_SUPPLIER_PRICE',
      }),
    });
  });

  it('rejects invalid quantity and non-CNY catalog currency', async () => {
    await expect(
      calculator.calculate({ ...baseInput, sheets: 0 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'INVALID_QUANTITY' }),
    });

    prisma.panelThicknessPricing.findFirst.mockResolvedValue({
      basePricePerM2: fixtureCny,
      currencyCode: 'UZS',
    });

    await expect(calculator.calculate(baseInput)).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'PRICING_CURRENCY_INVALID',
      }),
    });
  });

  it('throws PRICING_NOT_FOUND when thickness pricing is missing', async () => {
    prisma.panelThicknessPricing.findFirst.mockResolvedValue(null);

    await expect(
      calculator.calculate({ ...baseInput, thicknessMm: 99 }),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});
