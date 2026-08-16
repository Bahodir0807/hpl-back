import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PanelQuantityCalculator } from './panel-quantity-calculator.service';

describe('PanelQuantityCalculator', () => {
  const calculator = new PanelQuantityCalculator();
  const standardSize = {
    areaM2: new Prisma.Decimal('2.9768'),
  };

  it('calculates sheets and waste for a standard area', () => {
    const result = calculator.calculate(15.5, standardSize);

    expect(result.sheetsCount).toBe(6);
    expect(result.wastePercent.gt(0)).toBe(true);
    expect(result.actualAreaM2.toNumber()).toBeCloseTo(17.8608, 4);
  });

  it('returns one sheet with zero waste when area matches exactly', () => {
    const result = calculator.calculate('2.9768', standardSize);

    expect(result.sheetsCount).toBe(1);
    expect(result.wastePercent.toNumber()).toBe(0);
    expect(result.wasteAreaM2.toNumber()).toBe(0);
  });

  it('returns one sheet with high waste for minimal area', () => {
    const result = calculator.calculate(0.01, standardSize);

    expect(result.sheetsCount).toBe(1);
    expect(result.wastePercent.toNumber()).toBeCloseTo(99.66, 1);
  });

  it('throws for non-positive required area', () => {
    expect(() => calculator.calculate(-1, standardSize)).toThrow(
      BadRequestException,
    );
  });
});
