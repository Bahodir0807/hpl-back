import { Prisma } from '@prisma/client';
import {
  BASE_FACADE_NORMS_V1,
  EXPECTED_QTY_FOR_1000_M2,
} from './facade-norms';
import { multiplyAreaByNorm } from './facade-decimal';

describe('facade consumption math', () => {
  it('keeps all 18 approved norms unchanged', () => {
    expect(BASE_FACADE_NORMS_V1).toHaveLength(18);
    expect(BASE_FACADE_NORMS_V1.map((item) => item.qtyPerM2)).toEqual([
      '1.06',
      '1.05',
      '1.16',
      '4.03',
      '0.81',
      '4.03',
      '0.81',
      '1.67',
      '0.67',
      '0.07',
      '0.09',
      '4.03',
      '1.61',
      '6.99',
      '1.34',
      '1.21',
      '12.09',
      '10.75',
    ]);
  });

  it('uses Decimal arithmetic for 1000 m² cladding', () => {
    const area = new Prisma.Decimal('1000');
    for (const def of BASE_FACADE_NORMS_V1) {
      expect(multiplyAreaByNorm(area, def.qtyPerM2).toFixed()).toBe(
        EXPECTED_QTY_FOR_1000_M2[def.code],
      );
    }
  });

  it('does not apply the 1.06 coefficient twice', () => {
    const cladding = new Prisma.Decimal('1000');
    const hpl = multiplyAreaByNorm(cladding, '1.06');
    expect(hpl.toFixed()).toBe('1060');
    expect(multiplyAreaByNorm(hpl, '1.06').toFixed()).not.toBe('1060');
  });
});
