import { BadRequestException } from '@nestjs/common';
import { PanelQuantityCalculator } from './panel-quantity-calculator.service';

describe('PanelQuantityCalculator', () => {
  const calculator = new PanelQuantityCalculator();
  const standardSize = {
    widthMm: 1220,
    heightMm: 2440,
  };
  const size1830x3050 = {
    widthMm: 1830,
    heightMm: 3050,
  };

  it('calculates 180 sheets for 1830×3050 and 1000 m²', () => {
    const result = calculator.calculate(1000, size1830x3050);

    expect(result.sheetsCount).toBe(180);
  });

  it('always rounds a fractional sheet count up', () => {
    const exactOneSheet = calculator.calculate(5.5815, size1830x3050);
    const justOverOneSheet = calculator.calculate(5.5816, size1830x3050);

    expect(exactOneSheet.sheetsCount).toBe(1);
    expect(justOverOneSheet.sheetsCount).toBe(2);
  });

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
